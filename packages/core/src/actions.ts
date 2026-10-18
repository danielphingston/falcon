import { addWorkingDays, todayISO } from "./dates";
import {
  entitySchemas,
  fieldSchemas,
  type Actor,
  type AnyEntity,
  type Change,
  type EntityMap,
  type InputMap,
  type TableName,
} from "./schema";
import type { Store } from "./store";

export interface Ctx {
  store: Store;
  by: Actor;
  /** Changes sharing a batch are undone together. */
  batchId?: string;
  now?: () => Date;
}

export const newId = (): string => crypto.randomUUID();
const nowOf = (ctx: Pick<Ctx, "now">) => (ctx.now ? ctx.now() : new Date());

export class NotFoundError extends Error {}

let lastSeq = 0;
const nextSeq = (now: Date) => (lastSeq = Math.max(lastSeq + 1, now.getTime() * 1000));
const newestFirst = (a: Change, b: Change) => b.seq - a.seq;

async function logChange(
  ctx: Ctx,
  table: TableName,
  action: Change["action"],
  before: AnyEntity | null,
  after: AnyEntity,
): Promise<Change> {
  const change: Change = {
    id: newId(),
    at: nowOf(ctx).toISOString(),
    seq: nextSeq(nowOf(ctx)),
    by: ctx.by,
    batchId: ctx.batchId ?? newId(),
    table,
    recordId: after.id,
    action,
    before,
    after,
    undone: false,
  };
  await ctx.store.putChange(change);
  return change;
}

/** Status that counts as "finished" per table, and the timestamp field recording when. */
const completion: Partial<Record<TableName, { field: string; done: (r: Record<string, unknown>) => boolean }>> = {
  tasks: { field: "completedAt", done: (r) => r.status === "done" },
  workpapers: { field: "finalAt", done: (r) => r.status === "final" },
  reviewPoints: { field: "clearedAt", done: (r) => r.status === "cleared" },
  infoRequests: { field: "receivedAt", done: (r) => r.status === "received" || r.status === "na" },
  followUps: { field: "doneAt", done: (r) => r.status === "done" },
  engagements: { field: "closedAt", done: (r) => r.status === "closed" },
};

/** Sets or clears the completion timestamp so reports and points never depend on callers. */
function stampCompletion(table: TableName, rec: Record<string, unknown>, at: string) {
  const c = completion[table];
  if (!c) return;
  if (c.done(rec)) rec[c.field] ??= at;
  else delete rec[c.field];
}

export interface Result<T extends TableName> {
  record: EntityMap[T];
  before: EntityMap[T] | null;
  change: Change;
}

export async function create<T extends TableName>(
  ctx: Ctx,
  table: T,
  input: InputMap[T],
): Promise<Result<T>> {
  const fields = fieldSchemas[table].parse(input) as Record<string, unknown>;
  const at = nowOf(ctx).toISOString();
  stampCompletion(table, fields, at);
  const record = entitySchemas[table].parse({
    ...fields,
    id: newId(),
    createdAt: at,
    updatedAt: at,
    deleted: false,
    updatedBy: ctx.by,
  }) as EntityMap[T];
  await ctx.store.put(table, record);
  const change = await logChange(ctx, table, "create", null, record);
  return { record, before: null, change };
}

const stripUndefined = <O extends object>(o: O): Partial<O> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<O>;

/**
 * Applies a patch. Keys set to `null` are cleared (made undefined);
 * keys that are `undefined` are left alone.
 */
export async function update<T extends TableName>(
  ctx: Ctx,
  table: T,
  id: string,
  patch: { [K in keyof InputMap[T]]?: InputMap[T][K] | null },
): Promise<Result<T>> {
  const before = await ctx.store.get(table, id);
  if (!before || before.deleted) throw new NotFoundError(`No ${table} record with id ${id}`);
  const merged: Record<string, unknown> = { ...before, ...stripUndefined(patch) };
  for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
  stampCompletion(table, merged, nowOf(ctx).toISOString());
  merged.updatedAt = nowOf(ctx).toISOString();
  merged.updatedBy = ctx.by;
  const record = entitySchemas[table].parse(merged) as EntityMap[T];
  await ctx.store.put(table, record);
  const change = await logChange(ctx, table, "update", before, record);
  return { record, before, change };
}

export async function remove<T extends TableName>(ctx: Ctx, table: T, id: string): Promise<Result<T>> {
  const before = await ctx.store.get(table, id);
  if (!before || before.deleted) throw new NotFoundError(`No ${table} record with id ${id}`);
  const record = {
    ...before,
    deleted: true,
    updatedAt: nowOf(ctx).toISOString(),
    updatedBy: ctx.by,
  } as EntityMap[T];
  await ctx.store.put(table, record);
  const change = await logChange(ctx, table, "delete", before, record);
  return { record, before, change };
}

/** Reverts every change in a batch, newest first. Returns how many were reverted. */
export async function undoBatch(store: Store, batchId: string, now: Date = new Date()): Promise<number> {
  const changes = (await store.listChanges())
    .filter((c) => c.batchId === batchId && !c.undone)
    .sort(newestFirst);
  return store.transaction(async () => {
    for (const c of changes) {
      const at = now.toISOString();
      const restored =
        c.before === null
          ? { ...c.after, deleted: true, updatedAt: at }
          : { ...c.before, updatedAt: at };
      await store.put(c.table, restored as never);
      await store.putChange({ ...c, undone: true });
    }
    return changes.length;
  });
}

/** Undoes the most recent batch, optionally only one made by `by`. */
export async function undoLast(store: Store, by?: Actor): Promise<{ batchId: string; count: number } | null> {
  const last = (await store.listChanges())
    .filter((c) => !c.undone && (!by || c.by === by))
    .sort(newestFirst)[0];
  if (!last) return null;
  return { batchId: last.batchId, count: await undoBatch(store, last.batchId) };
}

// ---------- Domain helpers ----------

async function chaseInterval(ctx: Ctx, personId: string | undefined, fallback: keyof ChaseDays): Promise<number> {
  const settings = await ctx.store.getSettings();
  if (personId) {
    const p = await ctx.store.get("people", personId);
    if (p && (p.role === "client" || p.role === "manager" || p.role === "team")) return settings.chaseDays[p.role];
    if (p?.role === "partner") return settings.chaseDays.manager;
  }
  return settings.chaseDays[fallback];
}
type ChaseDays = { client: number; manager: number; team: number; other: number };

/** First chase date for a new IRL item or follow-up. */
export async function firstChaseDate(ctx: Ctx, from: string, personId: string | undefined, kind: keyof ChaseDays) {
  const settings = await ctx.store.getSettings();
  return addWorkingDays(from, await chaseInterval(ctx, personId, kind), settings);
}

/** Logs a chase today and pushes the next chase date out by the person's interval. */
export async function logChase(ctx: Ctx, table: "infoRequests" | "followUps", id: string) {
  const today = todayISO(nowOf(ctx));
  const settings = await ctx.store.getSettings();
  if (table === "infoRequests") {
    const item = await ctx.store.get("infoRequests", id);
    if (!item || item.deleted) throw new NotFoundError(`No IRL item ${id}`);
    const days = await chaseInterval(ctx, item.requestedFromId, "client");
    return update(ctx, "infoRequests", id, {
      chaseLog: [...item.chaseLog, today],
      nextChaseOn: addWorkingDays(today, days, settings),
    });
  }
  const item = await ctx.store.get("followUps", id);
  if (!item || item.deleted) throw new NotFoundError(`No follow-up ${id}`);
  const days = await chaseInterval(ctx, item.personId, item.type);
  return update(ctx, "followUps", id, {
    nudgeLog: [...item.nudgeLog, today],
    nextNudgeOn: addWorkingDays(today, days, settings),
  });
}

export async function setTaskDone(ctx: Ctx, id: string, done: boolean) {
  return update(ctx, "tasks", id, { status: done ? "done" : "todo" });
}

/** Creates an IRL item, filling in the first chase date. */
export async function createInfoRequest(ctx: Ctx, input: InputMap["infoRequests"]) {
  const nextChaseOn =
    input.nextChaseOn ?? (await firstChaseDate(ctx, input.requestedOn, input.requestedFromId, "client"));
  return create(ctx, "infoRequests", { ...input, nextChaseOn });
}

/** Follow-up type implied by a person's role (partners count as managers). */
export function followUpTypeFor(role: string | undefined): keyof ChaseDays {
  if (role === "client" || role === "manager" || role === "team") return role;
  return role === "partner" ? "manager" : "other";
}

/** Creates a follow-up, inferring its type from the person and filling in the first nudge date. */
export async function createFollowUp(ctx: Ctx, input: InputMap["followUps"]) {
  const today = todayISO(nowOf(ctx));
  const person = input.personId ? await ctx.store.get("people", input.personId) : undefined;
  const type = input.type && input.type !== "other" ? input.type : followUpTypeFor(person?.role);
  const nextNudgeOn = input.nextNudgeOn ?? input.due ?? (await firstChaseDate(ctx, today, input.personId, type));
  return create(ctx, "followUps", { ...input, type, nextNudgeOn });
}

/** Creates an engagement with its default workstreams in one undoable batch. */
export async function createEngagement(
  ctx: Ctx,
  input: InputMap["engagements"],
  workstreams: readonly string[] = [],
) {
  const batch: Ctx = { ...ctx, batchId: ctx.batchId ?? newId() };
  const eng = await create(batch, "engagements", input);
  for (const name of workstreams) await create(batch, "workstreams", { engagementId: eng.record.id, name });
  return eng;
}
