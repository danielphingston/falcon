/**
 * Data clean-up: records left behind by engagements that no longer exist
 * (e.g. RFI copies imported under an engagement that was later deleted).
 * They inflate chase lists and reports. Closed and on-hold engagements still
 * exist, so their records are never orphans.
 */
import { remove, type Ctx } from "./actions";
import { recordTitle } from "./proposals";
import type { TableName } from "./schema";
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
