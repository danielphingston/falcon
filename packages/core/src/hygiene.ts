/**
 * Data clean-up: records left behind by engagements that no longer exist
 * (e.g. RFI copies imported under an engagement that was later deleted).
 * They inflate chase lists and reports. Closed and on-hold engagements still
 * exist, so their records are never orphans.
 */
import { remove, type Ctx } from "./actions";
import { propose, recordTitle } from "./proposals";
import { tableNames, type Proposal, type TableName } from "./schema";
import type { Snapshot } from "./store";

/** Tables whose records belong to an engagement. */
const OWNED = ["infoRequests", "planItems", "programItems", "trialBalances", "workpapers", "reviewPoints", "tasks", "followUps", "timeEntries", "workstreams"] as const satisfies readonly TableName[];

export interface OrphanGroup {
  /** The engagement id the records point to (it no longer exists). */
  engagementId: string;
  /** Name, if the engagement was deleted in the app (its tombstone is still known). */
  formerName?: string;
  counts: Partial<Record<(typeof OWNED)[number], number>>;
  records: { table: (typeof OWNED)[number]; id: string; title: string }[];
}

export function findOrphans(snapAll: Snapshot, deletedEngagements: { id: string; name: string }[] = []): OrphanGroup[] {
  const exists = new Set(snapAll.engagements.map((e) => e.id));
  const formerly = new Map(deletedEngagements.map((e) => [e.id, e.name]));
  const groups = new Map<string, OrphanGroup>();
  for (const table of OWNED)
    for (const r of snapAll[table] as { id: string; engagementId?: string; deleted?: boolean }[]) {
      if (r.deleted || !r.engagementId || exists.has(r.engagementId)) continue;
      const g = groups.get(r.engagementId) ?? { engagementId: r.engagementId, formerName: formerly.get(r.engagementId), counts: {}, records: [] };
      g.counts[table] = (g.counts[table] ?? 0) + 1;
      g.records.push({ table, id: r.id, title: recordTitle(table, r as never) });
      groups.set(r.engagementId, g);
    }
  return [...groups.values()].sort((a, b) => b.records.length - a.records.length);
}

/** Deletes the given orphan groups' records, as one undoable batch (call with a batchId). */
export async function deleteOrphans(ctx: Ctx, groups: OrphanGroup[]): Promise<number> {
  let n = 0;
  for (const g of groups)
    for (const r of g.records) {
      const cur = await ctx.store.get(r.table, r.id);
      if (cur && !cur.deleted) {
        await remove(ctx, r.table, r.id);
        n++;
      }
    }
  return n;
}

// ---------- As Inbox proposals (brief v2 B5) ----------

/** The live engagement an orphan group most likely belongs to: most RFI descriptions in common. */
export function guessHome(group: OrphanGroup, snap: Snapshot): { engagementId: string; name: string; share: number } | undefined {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const mine = new Set(snap.infoRequests.filter((r) => r.engagementId === group.engagementId && !r.deleted).map((r) => key(r.description.split("\n")[0])));
  if (!mine.size) return undefined;
  let best: { engagementId: string; name: string; share: number } | undefined;
  for (const e of snap.engagements) {
    if (e.deleted) continue;
    const theirs = new Set(snap.infoRequests.filter((r) => r.engagementId === e.id && !r.deleted).map((r) => key(r.description.split("\n")[0])));
    const common = [...mine].filter((k) => theirs.has(k)).length;
    const share = common / mine.size;
    if (share > (best?.share ?? 0)) best = { engagementId: e.id, name: e.name, share };
  }
  return best && best.share >= 0.3 ? best : undefined;
}

/** Records with history: chased, received, linked from a step / open item, or with points / workpapers. */
function hasHistory(group: OrphanGroup, snap: Snapshot): boolean {
  const ids = new Set(group.records.map((r) => r.id));
  const rfi = snap.infoRequests.filter((r) => ids.has(r.id));
  if (rfi.some((r) => r.chaseLog.length || r.status === "received" || r.status === "partial")) return true;
  if (snap.planItems.some((s) => s.inputs?.rfiIds.some((id) => ids.has(id)))) return true;
  if (snap.workpapers.some((w) => w.openItems?.some((o) => o.rfiItemId && ids.has(o.rfiItemId)))) return true;
  return group.records.some((r) => r.table === "workpapers" || r.table === "reviewPoints" || r.table === "timeEntries");
}

/**
 * One proposal per orphan group: delete its records, or move them to the
 * engagement they most likely belong to. Reassigning is the default when
 * they have history (edge case 14), deleting otherwise. Not asked again for
 * a group once proposed.
 */
export async function proposeOrphanCleanups(ctx: Ctx): Promise<number> {
  const all = Object.fromEntries(await Promise.all(tableNames.map(async (t) => [t, await ctx.store.list(t)] as const))) as unknown as Snapshot;
  const live = Object.fromEntries(Object.entries(all).map(([t, rows]) => [t, (rows as { deleted?: boolean }[]).filter((r) => !r.deleted)])) as unknown as Snapshot;
  const tomb = all.engagements.filter((e) => e.deleted).map((e) => ({ id: e.id, name: e.name }));
  const asked = new Set(live.proposals.filter((p) => p.tool === "orphan_cleanup").map((p) => p.opKey));
  let n = 0;
  for (const g of findOrphans(live, tomb)) {
    const opKey = `orphans:${g.engagementId}`;
    if (asked.has(opKey)) continue;
    const home = guessHome(g, live);
    const label = g.formerName ? `“${g.formerName}” (deleted)` : "an engagement that no longer exists";
    const key = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    // RFI items already on the matched engagement are just copies: delete those.
    const onHome = new Set(home ? live.infoRequests.filter((r) => r.engagementId === home.engagementId).map((r) => `${r.number}|${key(r.description.split("\n")[0])}`) : []);
    const rfiById = new Map(live.infoRequests.map((r) => [r.id, r]));
    const isCopy = (rec: OrphanGroup["records"][number]) => {
      const r = rec.table === "infoRequests" ? rfiById.get(rec.id) : undefined;
      return !!r && onHome.has(`${r.number}|${key(r.description.split("\n")[0])}`);
    };
    const copies = g.records.filter(isCopy);
    const rest = g.records.filter((r) => !isCopy(r));
    const history = hasHistory({ ...g, records: rest }, live);
    const describe = (recs: OrphanGroup["records"]) => {
      const c = new Map<string, number>();
      for (const r of recs) c.set(r.table, (c.get(r.table) ?? 0) + 1);
      return [...c.entries()].map(([t, k]) => `${k} ${t === "infoRequests" ? (k === 1 ? "RFI item" : "RFI items") : t}`).join(", ");
    };
    const del = (recs: OrphanGroup["records"]) => recs.map((r) => ({ table: r.table, recordId: r.id, action: "update" as const, before: { engagementId: g.engagementId }, set: { deleted: true } }));
    const choices: NonNullable<Proposal["choices"]> = [];
    if (copies.length && home)
      choices.push({
        key: "delete-copies",
        group: "Copies",
        label: `Delete ${describe(copies)} already on ${home.name}`,
        detail: `Same number and text as items on ${home.name}: copies from an earlier import.`,
        defaultOn: true,
        patches: del(copies),
      });
    if (rest.length) {
      if (home)
        choices.push({
          key: "reassign",
          group: "Other records",
          label: `Move ${describe(rest)} to ${home.name}`,
          detail: `${Math.round(home.share * 100)}% of these RFI items match ${home.name}.${history ? " They have history (chases, received, links), so moving is suggested." : ""}`,
          defaultOn: history,
          excludes: ["delete"],
          patches: rest.map((r) => ({ table: r.table, recordId: r.id, action: "update" as const, before: { engagementId: g.engagementId }, set: { engagementId: home.engagementId } })),
        });
      choices.push({
        key: "delete",
        group: "Other records",
        label: `Delete ${describe(rest)}`,
        detail: history ? (home ? "They have history: moving them keeps it." : "They have history but no engagement matches them: check before deleting.") : "Left behind; nothing links to them.",
        defaultOn: !history,
        excludes: home ? ["reassign"] : undefined,
        patches: del(rest),
      });
    }
    await propose(ctx, {
      source: "app",
      tool: "orphan_cleanup",
      summary: `${g.records.length} record${g.records.length === 1 ? "" : "s"} under ${label}${home ? ` (looks like ${home.name})` : ""}: clean up`,
      changes: [],
      choices,
      opKey,
    });
    n++;
  }
  return n;
}
