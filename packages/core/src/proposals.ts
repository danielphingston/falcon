/**
 * Proposals: changes an AI (or an import) wants to make, waiting for the user.
 *
 * Any tool can run in "propose" mode: it runs against an overlay of the data
 * that records every write instead of saving it. What it would have changed
 * becomes one proposal. Only the user, in the app, can accept it; accepting
 * re-checks each record (changed since → stale, deleted → void) and applies
 * the whole proposal as one undoable batch.
 */
import { applyRecord, create, newId, update, type Ctx } from "./actions";
import type { AnyEntity, Change, Proposal, Settings, TableName } from "./schema";
import { loadSnapshot, type Store } from "./store";
import { rfiTitle } from "./rfi";

export type Captured = Proposal["changes"][number];

/** A store that reads through to the real one but keeps every write to itself. */
export class OverlayStore implements Store {
  private writes = new Map<string, AnyEntity>();
  /** New change-log entries the tool wrote, in order. */
  readonly changes: Change[] = [];
  /** Existing change-log entries the tool marked undone (undo_last). */
  readonly undone: string[] = [];

  constructor(private readonly base: Store) {}

  async list<T extends TableName>(table: T) {
    const rows = new Map((await this.base.list(table)).map((r) => [r.id, r as AnyEntity]));
    for (const [k, v] of this.writes) if (k.startsWith(`${table}:`)) rows.set(v.id, v);
    return [...rows.values()] as never;
  }
  async get<T extends TableName>(table: T, id: string) {
    return (this.writes.get(`${table}:${id}`) ?? (await this.base.get(table, id))) as never;
  }
  async put<T extends TableName>(table: T, record: unknown) {
    const r = record as AnyEntity;
    this.writes.set(`${table}:${r.id}`, r);
  }
  async putChange(change: Change) {
    const existing = (await this.base.listChanges()).some((c) => c.id === change.id);
    if (existing && change.undone) this.undone.push(change.id);
    else this.changes.push(change);
  }
  async listChanges() {
    const ours = new Set(this.undone);
    return [...(await this.base.listChanges()).map((c) => (ours.has(c.id) ? { ...c, undone: true } : c)), ...this.changes];
  }
  getSettings() {
    return this.base.getSettings();
  }
  async transaction<R>(fn: () => Promise<R>) {
    return fn();
  }

  /** One entry per record: the version it started from and where it ended up. */
  captured(): Captured[] {
    const byRecord = new Map<string, Captured>();
    for (const c of this.changes) {
      const k = `${c.table}:${c.recordId}`;
      const prev = byRecord.get(k);
      byRecord.set(k, {
        table: c.table,
        recordId: c.recordId,
        action: prev?.action === "create" ? "create" : c.action,
        before: (prev ? prev.before : c.before) as Captured["before"],
        after: c.after as Captured["after"],
      });
    }
    // A record created and deleted in the same call never existed.
    return [...byRecord.values()].filter((c) => !(c.action === "create" && c.after.deleted));
  }
}

// ---------- Auto-apply ----------

const IGNORED = new Set(["updatedAt", "updatedBy"]);

/** Fields that differ between two versions of a record. */
export function changedFields(before: Record<string, unknown> | null, after: Record<string, unknown>): string[] {
  if (!before) return Object.keys(after).filter((k) => !IGNORED.has(k));
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => !IGNORED.has(k) && JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

const RULES: Record<Settings["autoApply"][number], (c: Captured) => boolean> = {
  // Moving a task's date or time.
  taskDates: (c) => c.table === "tasks" && c.action === "update" && changedFields(c.before, c.after).every((f) => ["due", "dueTime", "durationMinutes"].includes(f)),
  // Logging a chase on an RFI item or follow-up.
  chaseLogs: (c) =>
    (c.table === "infoRequests" || c.table === "followUps") &&
    c.action === "update" &&
    changedFields(c.before, c.after).every((f) => ["chaseLog", "nextChaseOn", "nudgeLog", "nextNudgeOn"].includes(f)) &&
    // A chase was logged (resetting chase dates in bulk is a proposal).
    changedFields(c.before, c.after).some((f) => f === "chaseLog" || f === "nudgeLog"),
};

/** True when every change is of a type the user lets apply straight away. */
export function isAutoApply(changes: Captured[], types: Settings["autoApply"]): boolean {
  return changes.length > 0 && changes.every((c) => types.some((t) => RULES[t](c)));
}

// ---------- Describing ----------

const NOUNS: Record<string, [string, string]> = {
  people: ["person", "people"],
  engagements: ["engagement", "engagements"],
  workstreams: ["workstream", "workstreams"],
  tasks: ["task", "tasks"],
  workpapers: ["work paper", "work papers"],
  reviewPoints: ["review point", "review points"],
  infoRequests: ["RFI item", "RFI items"],
  followUps: ["follow-up", "follow-ups"],
  alerts: ["alert", "alerts"],
  timeEntries: ["time entry", "time entries"],
  programItems: ["programme item", "programme items"],
  planItems: ["workstep", "worksteps"],
  programmes: ["programme", "programmes"],
  checkSets: ["review check set", "review check sets"],
};

/** "Call client", "RFI 5.10 Bank statements"… */
export function recordTitle(table: string, r: Record<string, unknown> | null | undefined): string {
  if (!r) return "";
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
  const first = (t: string) => t.split("\n")[0].slice(0, 80);
  if (table === "infoRequests") return `${s("number") ? `RFI ${s("number")} ` : ""}${rfiTitle(s("description")).slice(0, 80)}`;
  if (table === "planItems") return `${s("number") ? `${s("number")} ` : ""}${first(s("text"))}`;
  if (table === "workpapers") return `${s("ref")} ${s("title")}`.trim();
  return first(s("title") || s("name") || s("about") || s("text") || s("description") || s("note"));
}

/** One line for the Inbox, e.g. "Create task “Call client” · update 2 RFI items". */
export function summarise(changes: Captured[], undoes = 0): string {
  const groups = new Map<string, Captured[]>();
  for (const c of changes) {
    const k = `${c.action}:${c.table}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const verb = { create: "Create", update: "Update", delete: "Delete" } as const;
  const parts = [...groups.values()].map((g) => {
    const [one, many] = NOUNS[g[0].table] ?? [g[0].table, g[0].table];
    const v = verb[g[0].action];
    if (g.length === 1) {
      const t = recordTitle(g[0].table, g[0].after);
      return `${v} ${one}${t ? ` “${t}”` : ""}`;
    }
    return `${v} ${g.length} ${many}`;
  });
  if (undoes) parts.push(`undo ${undoes} earlier change${undoes === 1 ? "" : "s"}`);
  return parts.join(" · ") || "No changes";
}

// ---------- Creating ----------

/** The engagement a set of changes is about, when they share one. */
function engagementOf(changes: Captured[]): string | undefined {
  const ids = new Set(changes.map((c) => (c.table === "engagements" ? c.recordId : (c.after.engagementId as string | undefined))).filter(Boolean));
  return ids.size === 1 ? [...ids][0] : undefined;
}

/**
 * Saves captured changes as a pending proposal (or returns the pending one
 * already made for the same tool call, so a retried call isn't queued twice).
 */
export async function propose(
  ctx: Ctx,
  opts: {
    source: Proposal["source"];
    tool?: string;
    changes: Captured[];
    undoes?: string[];
    opKey?: string;
    summary?: string;
    choices?: Proposal["choices"];
    engagementId?: string;
  },
): Promise<Proposal> {
  if (opts.opKey) {
    const dup = (await ctx.store.list("proposals")).find((p) => !p.deleted && p.status === "pending" && p.opKey === opts.opKey && p.source === opts.source);
    if (dup) return dup;
  }
  const { record } = await create(ctx, "proposals", {
    source: opts.source,
    tool: opts.tool,
    summary: opts.summary ?? summarise(opts.changes, opts.undoes?.length ?? 0),
    engagementId: opts.engagementId ?? engagementOf(opts.changes),
    changes: opts.changes,
    choices: opts.choices?.length ? opts.choices : undefined,
    undoesChanges: opts.undoes?.length ? opts.undoes : undefined,
    status: "pending",
    opKey: opts.opKey,
  });
  return record;
}

// ---------- Deciding ----------

export interface Decision {
  status: Proposal["status"];
  batchId?: string;
  reason?: string;
  /** Choices left out because their records changed since they were proposed. */
  skipped?: string[];
}

/** The choices that apply when the user doesn't pick: every default-on one whose requirements are on too. */
export function defaultChoices(p: Pick<Proposal, "choices">): string[] {
  return closeChoices(p, (p.choices ?? []).filter((c) => c.defaultOn).map((c) => c.key));
}

/** Drops picked choices whose required choices aren't picked. */
export function closeChoices(p: Pick<Proposal, "choices">, picked: string[]): string[] {
  // Of two choices that exclude each other, the one picked first stays.
  const kept: string[] = [];
  for (const k of picked) {
    const c = (p.choices ?? []).find((x) => x.key === k);
    if (!c || kept.includes(k)) continue;
    if (kept.some((x) => c.excludes?.includes(x) || (p.choices ?? []).find((y) => y.key === x)?.excludes?.includes(k))) continue;
    kept.push(k);
  }
  let keys = new Set(kept);
  for (;;) {
    const next = new Set([...keys].filter((k) => ((p.choices ?? []).find((c) => c.key === k)?.requires ?? []).every((r) => keys.has(r))));
    if (next.size === keys.size) return [...next];
    keys = next;
  }
}

/**
 * Accepts a proposal: only the user, in the app (`by: "app"`), may do this.
 * Applies every change or none. Undoing the returned batch reverses the change
 * and puts the proposal back to pending.
 */
export async function acceptProposal(ctx: Ctx, id: string, opts: { choices?: string[] } = {}): Promise<Decision> {
  if (ctx.by !== "app") throw new Error("Only the user can approve proposals, in Falcon.");
  const p = await ctx.store.get("proposals", id);
  if (!p || p.deleted) throw new Error("No such proposal.");
  if (p.status !== "pending") return { status: p.status, reason: "Already decided." };

  // Check every record is still as the proposal saw it.
  for (const c of p.changes) {
    const table = c.table as TableName;
    const cur = (await ctx.store.get(table, c.recordId)) as AnyEntity | undefined;
    if (c.action === "create") {
      if (cur) return mark(ctx, p, "void", "A record with the same id already exists.");
      continue;
    }
    if (!cur || cur.deleted) return mark(ctx, p, "void", `The ${NOUNS[table]?.[0] ?? "record"} it changes was deleted.`);
    // Changed since: a newer version stamp, or any field that differs (stamps can tie within a millisecond).
    if (c.before && (cur.updatedAt !== c.before.updatedAt || changedFields(c.before, cur as never).length > 0))
      return mark(ctx, p, "stale", `“${recordTitle(table, cur as never) || "A record"}” changed after this was proposed. Ask again for a fresh proposal.`);
  }

  const batchId = newId();
  const applied: Ctx = { ...ctx, by: p.source === "chat" || p.source === "connector" ? p.source : "app", batchId };
  const picked = closeChoices(p, opts.choices ?? defaultChoices(p));
  const skipped: string[] = [];
  await ctx.store.transaction(async () => {
    for (const c of p.changes) {
      const table = c.table as TableName;
      const cur = ((await ctx.store.get(table, c.recordId)) as AnyEntity | undefined) ?? null;
      await applyRecord(applied, table, c.action, c.action === "create" ? null : cur, c.after);
    }
    // Ticked choices, field by field, on top of the records as they now are.
    const done = new Set<string>();
    for (const ch of (p.choices ?? []).filter((x) => picked.includes(x.key))) {
      if ((ch.requires ?? []).some((r) => !done.has(r))) {
        skipped.push(ch.key);
        continue;
      }
      if (!(await choiceFresh(ctx, ch.patches))) {
        skipped.push(ch.key);
        continue;
      }
      for (const pt of ch.patches) {
        const table = pt.table as TableName;
        if (pt.action === "create") await applyRecord(applied, table, "create", null, pt.set);
        else await update(applied, table, pt.recordId, pt.set as never);
      }
      done.add(ch.key);
    }
    if (p.undoesChanges?.length) {
      const all = await ctx.store.listChanges();
      for (const cid of p.undoesChanges) {
        const ch = all.find((x) => x.id === cid);
        if (ch && !ch.undone) await ctx.store.putChange({ ...ch, undone: true });
      }
    }
    // In the same batch, so undoing the change puts the proposal back to pending.
    await update({ ...ctx, batchId }, "proposals", p.id, {
      status: "accepted",
      decidedAt: (ctx.now?.() ?? new Date()).toISOString(),
      batchId,
      ...(p.choices?.length ? { chosen: picked.filter((k) => !skipped.includes(k)) } : {}),
      ...(skipped.length ? { reason: `${skipped.length} choice${skipped.length === 1 ? "" : "s"} left out: changed since proposed.` } : {}),
    });
  });
  return { status: "accepted", batchId, ...(skipped.length ? { skipped } : {}) };
}

/** A choice still fits: records it creates don't exist yet, and fields it updates still hold the values it saw. */
async function choiceFresh(ctx: Ctx, patches: NonNullable<Proposal["choices"]>[number]["patches"]): Promise<boolean> {
  for (const pt of patches) {
    const cur = (await ctx.store.get(pt.table as TableName, pt.recordId)) as Record<string, unknown> | undefined;
    if (pt.action === "create") {
      if (cur) return false;
      continue;
    }
    if (!cur || cur.deleted) return false;
    for (const [k, v] of Object.entries(pt.before ?? {})) if (JSON.stringify(cur[k] ?? null) !== JSON.stringify(v ?? null)) return false;
  }
  return true;
}

async function mark(ctx: Ctx, p: Proposal, status: "stale" | "void" | "rejected", reason?: string): Promise<Decision> {
  await update(ctx, "proposals", p.id, { status, reason, decidedAt: (ctx.now?.() ?? new Date()).toISOString() });
  return { status, reason };
}

export async function rejectProposal(ctx: Ctx, id: string): Promise<Decision> {
  if (ctx.by !== "app") throw new Error("Only the user can decide on proposals, in Falcon.");
  const p = await ctx.store.get("proposals", id);
  if (!p || p.deleted || p.status !== "pending") return { status: p?.status ?? "void" };
  return mark(ctx, p, "rejected");
}

/** Accepts each pending proposal on its own: failures don't stop the rest. */
export async function acceptAll(ctx: Ctx, ids: string[]): Promise<{ id: string; decision: Decision }[]> {
  const out: { id: string; decision: Decision }[] = [];
  for (const id of ids) {
    try {
      out.push({ id, decision: await acceptProposal(ctx, id) });
    } catch (e) {
      out.push({ id, decision: { status: "void", reason: e instanceof Error ? e.message : String(e) } });
    }
  }
  return out;
}

/** Field-by-field differences for showing a change: label, old value, new value. */
export function diffLines(c: Captured): { field: string; from: string; to: string }[] {
  const show = (v: unknown): string => (v === undefined || v === null || v === "" ? "—" : typeof v === "string" ? v : JSON.stringify(v));
  const skip = new Set(["id", "createdAt", "deleted", "updatedAt", "updatedBy"]);
  if (c.action === "delete") return [{ field: "record", from: recordTitle(c.table, c.before) || "—", to: "deleted" }];
  return changedFields(c.before, c.after)
    .filter((f) => !skip.has(f))
    .map((f) => ({ field: f, from: show(c.before?.[f]), to: show(c.after[f]) }));
}

/** Pending proposals, newest first (for the tools and the Inbox badge). */
export async function pendingProposals(store: Store): Promise<Proposal[]> {
  return (await loadSnapshot(store)).proposals.filter((p) => p.status === "pending").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
