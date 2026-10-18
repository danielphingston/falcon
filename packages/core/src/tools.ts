/**
 * Provider-neutral AI tools. Each tool has a zod input schema and a handler
 * that runs against a Store. Adapters (Gemini function declarations, MCP
 * tools) convert these; they never reimplement the logic.
 */
import { z } from "zod";
import {
  create,
  createEngagement,
  createFollowUp,
  createInfoRequest,
  newId,
  remove,
  setTaskDone,
  undoLast,
  update,
  logChase,
  type Ctx,
} from "./actions";
import { todayISO } from "./dates";
import { computeToday, titleOf } from "./today";
import { BADGES, chaseStreak, levelFor, pointEvents, ringFor, ringStreak } from "./game";
import { matchName, nameKey } from "./teamImport";
import { periodReport, shiftWeek, timesheet, timesheetText, weekDays, weekStart } from "./time";
import { loadSnapshot, type Store } from "./store";
import {
  engagementStatuses,
  followUpTypes,
  irlStatuses,
  personRoles,
  priorities,
  reviewPointStatuses,
  tableNames,
  taskStatuses,
  workTables,
  wpStatuses,
  type AnyEntity,
  type Engagement,
  type Person,
  type TableName,
} from "./schema";

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  /** "confirm" tools return a preview unless called with confirmed: true. */
  kind: "read" | "write" | "confirm";
  run(ctx: Ctx, input: z.output<S>): Promise<unknown>;
}

const tool = <S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> => def;

const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date as YYYY-MM-DD");
const optDate = dateArg.optional();

// ---------- Lookups ----------

const norm = (s: string) => s.toLowerCase().trim();

async function resolveEngagement(store: Store, ref: string): Promise<Engagement> {
  const all = (await store.list("engagements")).filter((e) => !e.deleted);
  const hit =
    all.find((e) => e.id === ref) ??
    all.find((e) => norm(e.name) === norm(ref)) ??
    all.filter((e) => e.status !== "closed").find((e) => norm(e.name).includes(norm(ref))) ??
    all.find((e) => norm(e.name).includes(norm(ref)));
  if (!hit)
    throw new Error(
      `No engagement matches "${ref}". Existing: ${all.map((e) => e.name).join(", ") || "none"}. Create it first with create_engagement.`,
    );
  return hit;
}

/** Finds a person by id or name; creates them when `createAs` is given and nobody matches. */
async function resolvePerson(ctx: Ctx, ref: string | undefined, createAs?: Person["role"]): Promise<Person | undefined> {
  if (!ref || ["me", "myself", "i"].includes(norm(ref))) return undefined;
  const myName = (await ctx.store.getSettings()).myName;
  if (myName && myName !== "Me" && nameKey(myName) === nameKey(ref)) return undefined;
  const all = (await ctx.store.list("people")).filter((p) => !p.deleted);
  const hit =
    all.find((p) => p.id === ref) ??
    matchName(ref, all) ??
    all.find((p) => norm(p.name).split(" ").some((part) => part === norm(ref))) ??
    all.find((p) => norm(p.name).includes(norm(ref)));
  if (hit) return hit;
  if (!createAs) throw new Error(`No person matches "${ref}". Add them with add_person.`);
  return (await create(ctx, "people", { name: ref, role: createAs })).record;
}

/** Person ids for a list of names, creating team contacts for new names; "me" is skipped. */
async function resolveTeam(ctx: Ctx, names: string[] | undefined): Promise<string[]> {
  const ids: string[] = [];
  for (const n of names ?? []) {
    const p = await resolvePerson(ctx, n, "team");
    if (p && !ids.includes(p.id)) ids.push(p.id);
  }
  return ids;
}

async function findAnywhere(store: Store, id: string): Promise<{ table: TableName; record: AnyEntity } | null> {
  for (const table of tableNames) {
    const record = await store.get(table, id);
    if (record && !record.deleted) return { table, record };
  }
  return null;
}

async function resolveWorkpaper(store: Store, ref: string, engagement?: string) {
  const all = (await store.list("workpapers")).filter((w) => !w.deleted);
  const engId = engagement ? (await resolveEngagement(store, engagement)).id : undefined;
  const scoped = engId ? all.filter((w) => w.engagementId === engId) : all;
  const byRef = scoped.filter((w) => norm(w.ref) === norm(ref));
  const hit = all.find((w) => w.id === ref) ?? (byRef.length === 1 ? byRef[0] : undefined);
  if (!hit) {
    if (byRef.length > 1) throw new Error(`WP ref "${ref}" exists on several engagements; pass the engagement too.`);
    throw new Error(`No work paper matches "${ref}".`);
  }
  return hit;
}

const brief = (table: TableName, r: AnyEntity): Record<string, unknown> => {
  const { createdAt, updatedAt, deleted, updatedBy, ...rest } = r as AnyEntity & Record<string, unknown>;
  void createdAt; void updatedAt; void deleted; void updatedBy;
  return { table, ...rest };
};

// ---------- Tools ----------

export const tools = [
  tool({
    name: "get_today",
    kind: "read",
    description:
      "Today's briefing: overdue and due-today items, IRL items and follow-ups to chase today (grouped by person), work papers waiting for my review, and open review points on my own work papers.",
    input: z.object({}),
    async run(ctx) {
      const snap = await loadSnapshot(ctx.store);
      const today = todayISO(ctx.now?.());
      const v = computeToday(snap, today);
      const eng = new Map(snap.engagements.map((e) => [e.id, e.name]));
      const line = (i: Parameters<typeof titleOf>[0]) => ({
        id: i.record.id,
        kind: i.kind,
        title: titleOf(i),
        engagement: "engagementId" in i.record && i.record.engagementId ? eng.get(i.record.engagementId) : undefined,
      });
      return {
        today,
        overdue: v.overdue.map((d) => ({ ...line(d), due: d.due })),
        dueToday: v.dueToday.map(line),
        chase: v.chase.map((g) => ({ person: g.person?.name ?? "Unassigned", items: g.items.map(line) })),
        toReview: v.toReview.map((w) => ({ id: w.id, ref: w.ref, title: w.title, engagement: eng.get(w.engagementId), status: w.status })),
        pointsToClear: v.pointsToClear.map((p) => ({ id: p.id, text: p.text, workpaperId: p.workpaperId })),
        doneToday: v.doneToday.length,
      };
    },
  }),

  tool({
    name: "search",
    kind: "read",
    description: "Find records by text across engagements, tasks, work papers, review points, IRL items, follow-ups and people. Returns ids for use with other tools.",
    input: z.object({
      query: z.string().describe("Text to look for; empty string lists everything in the chosen tables"),
      tables: z.array(z.enum(tableNames as [TableName, ...TableName[]])).optional(),
      includeDone: z.boolean().optional().describe("Include done/cleared/received/closed items"),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    async run(ctx, { query, tables, includeDone, limit }) {
      const q = norm(query);
      const out: Record<string, unknown>[] = [];
      const doneStates = new Set(["done", "final", "cleared", "received", "na", "closed"]);
      for (const table of tables ?? workTables) {
        for (const r of await ctx.store.list(table)) {
          if (r.deleted) continue;
          const status = (r as { status?: string }).status;
          if (!includeDone && status && doneStates.has(status)) continue;
          const text = Object.values(r).filter((v) => typeof v === "string").join(" ").toLowerCase();
          if (!q || text.includes(q)) out.push(brief(table, r));
        }
      }
      return { count: out.length, results: out.slice(0, limit ?? 30) };
    },
  }),

  tool({
    name: "create_engagement",
    kind: "write",
    description:
      "Create an engagement/assignment (e.g. a deal code name like 'Project Falcon', or a client name) with its type, status, lead and team. For a whole team allocation sheet, call this once per assignment (or update_engagement if it already exists).",
    input: z.object({
      name: z.string(),
      type: z.string().optional().describe("e.g. Due Diligence, Transaction Support, Stat Audit, Internal Audit, ITR"),
      status: z.enum(engagementStatuses).optional(),
      client: z.string().optional().describe("Target or client company"),
      side: z.enum(["buy", "sell", "other"]).optional(),
      lead: z.string().optional().describe("Who leads it; omit or 'me' when the user leads it"),
      team: z.array(z.string()).optional().describe("Team member names; new names become team contacts"),
      workstreams: z.array(z.string()).optional().describe("e.g. QoE, NWC, Net debt, Tax"),
      draftReport: optDate,
      finalReport: optDate,
      timesheetCode: z.string().optional(),
    }),
    async run(ctx, { workstreams, lead, team, ...input }) {
      const leadId = (await resolvePerson(ctx, lead, "team"))?.id;
      const teamIds = await resolveTeam(ctx, team);
      const r = await createEngagement(ctx, { ...input, leadId, team: teamIds.filter((id) => id !== leadId) }, workstreams ?? []);
      return { created: brief("engagements", r.record), workstreams: workstreams ?? [] };
    },
  }),

  tool({
    name: "update_engagement",
    kind: "write",
    description: "Change an engagement's status, type, lead, team, dates or details. `team` replaces the whole team; use addToTeam/removeFromTeam for single changes.",
    input: z.object({
      engagement: z.string().describe("Engagement id or name"),
      status: z.enum(engagementStatuses).optional(),
      type: z.string().optional(),
      name: z.string().optional(),
      client: z.string().optional(),
      lead: z.string().optional().describe("New lead's name, or 'me'"),
      team: z.array(z.string()).optional().describe("Full team (names), replacing the current one"),
      addToTeam: z.array(z.string()).optional(),
      removeFromTeam: z.array(z.string()).optional(),
      draftReport: optDate,
      finalReport: optDate,
      notes: z.string().optional(),
    }),
    async run(ctx, { engagement, lead, team, addToTeam, removeFromTeam, ...patch }) {
      const e = await resolveEngagement(ctx.store, engagement);
      let ids = team ? await resolveTeam(ctx, team) : [...(e.team ?? [])];
      if (addToTeam) ids = [...new Set([...ids, ...(await resolveTeam(ctx, addToTeam))])];
      if (removeFromTeam) {
        const drop = new Set((await Promise.all(removeFromTeam.map((n) => resolvePerson(ctx, n)))).map((p) => p?.id));
        ids = ids.filter((id) => !drop.has(id));
      }
      const leadId = lead === undefined ? e.leadId : (await resolvePerson(ctx, lead, "team"))?.id;
      const leadPatch = lead === undefined ? {} : { leadId: leadId ?? null };
      // The lead isn't also listed as a team member.
      const r = await update(ctx, "engagements", e.id, { ...patch, ...leadPatch, team: ids.filter((id) => id !== leadId) });
      return { updated: brief("engagements", r.record) };
    },
  }),

  tool({
    name: "add_person",
    kind: "write",
    description: "Add a contact: a client contact, manager, partner or team member.",
    input: z.object({
      name: z.string(),
      role: z.enum(personRoles),
      org: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
    }),
    async run(ctx, input) {
      return { created: brief("people", (await create(ctx, "people", input)).record) };
    },
  }),

  tool({
    name: "create_task",
    kind: "write",
    description: "Create a to-do. Assign it to a team member to track work you've pushed to them.",
    input: z.object({
      title: z.string(),
      engagement: z.string().optional().describe("Engagement id or name"),
      due: optDate,
      priority: z.enum(priorities).optional(),
      assignee: z.string().optional().describe("Team member name or id; omit for me"),
      notes: z.string().optional(),
    }),
    async run(ctx, { engagement, assignee, ...rest }) {
      const engagementId = engagement ? (await resolveEngagement(ctx.store, engagement)).id : undefined;
      const assigneeId = (await resolvePerson(ctx, assignee, "team"))?.id;
      return { created: brief("tasks", (await create(ctx, "tasks", { ...rest, engagementId, assigneeId })).record) };
    },
  }),

  tool({
    name: "update_task",
    kind: "write",
    description: "Edit a task or mark it done.",
    input: z.object({
      id: z.string(),
      title: z.string().optional(),
      due: optDate,
      priority: z.enum(priorities).optional(),
      status: z.enum(taskStatuses).optional(),
      notes: z.string().optional(),
    }),
    async run(ctx, { id, status, ...patch }) {
      if (Object.keys(patch).length) await update(ctx, "tasks", id, patch);
      const r = status ? (status === "in_progress" ? await update(ctx, "tasks", id, { status }) : await setTaskDone(ctx, id, status === "done")) : null;
      return { updated: brief("tasks", r?.record ?? (await ctx.store.get("tasks", id))!) };
    },
  }),

  tool({
    name: "create_workpaper",
    kind: "write",
    description: "Track a work paper. myRole 'preparer' = I execute it; 'reviewer' = I review someone else's.",
    input: z.object({
      engagement: z.string(),
      ref: z.string().describe("WP reference, e.g. B.2"),
      title: z.string(),
      myRole: z.enum(["preparer", "reviewer"]),
      workstream: z.string().optional().describe("Workstream name, e.g. NWC"),
      preparer: z.string().optional().describe("Preparer's name when I'm the reviewer"),
      reviewer: z.string().optional().describe("Reviewer's name when I'm the preparer"),
      status: z.enum(wpStatuses).optional(),
      due: optDate,
    }),
    async run(ctx, { engagement, workstream, preparer, reviewer, ...rest }) {
      const e = await resolveEngagement(ctx.store, engagement);
      let workstreamId: string | undefined;
      if (workstream) {
        const ws = (await ctx.store.list("workstreams")).filter((w) => !w.deleted && w.engagementId === e.id);
        workstreamId =
          ws.find((w) => norm(w.name) === norm(workstream))?.id ??
          (await create(ctx, "workstreams", { engagementId: e.id, name: workstream })).record.id;
      }
      const preparerId = (await resolvePerson(ctx, preparer, "team"))?.id;
      const reviewerId = (await resolvePerson(ctx, reviewer, "manager"))?.id;
      const r = await create(ctx, "workpapers", { ...rest, engagementId: e.id, workstreamId, preparerId, reviewerId });
      return { created: brief("workpapers", r.record) };
    },
  }),

  tool({
    name: "update_workpaper_status",
    kind: "write",
    description: "Move a work paper through: not_started → in_progress → prepared → in_review → points_raised → cleared → final.",
    input: z.object({
      workpaper: z.string().describe("WP id or ref"),
      engagement: z.string().optional().describe("Needed if the ref exists on several engagements"),
      status: z.enum(wpStatuses),
    }),
    async run(ctx, { workpaper, engagement, status }) {
      const w = await resolveWorkpaper(ctx.store, workpaper, engagement);
      return { updated: brief("workpapers", (await update(ctx, "workpapers", w.id, { status })).record) };
    },
  }),

  tool({
    name: "add_review_points",
    kind: "write",
    description: "Add one or more review points (review notes) to a work paper. Sets the WP to points_raised.",
    input: z.object({
      workpaper: z.string().describe("WP id or ref"),
      engagement: z.string().optional(),
      points: z.array(z.string()).min(1),
      raisedBy: z.string().optional().describe("Who raised them; omit for me"),
      assignedTo: z.string().optional().describe("Who must address them; omit for me"),
    }),
    async run(ctx, { workpaper, engagement, points, raisedBy, assignedTo }) {
      const w = await resolveWorkpaper(ctx.store, workpaper, engagement);
      const raisedById = (await resolvePerson(ctx, raisedBy, "manager"))?.id;
      const assignedToId = (await resolvePerson(ctx, assignedTo, "team"))?.id;
      const created = [];
      for (const text of points)
        created.push((await create(ctx, "reviewPoints", { workpaperId: w.id, engagementId: w.engagementId, text, raisedById, assignedToId })).record.id);
      if (w.status !== "points_raised") await update(ctx, "workpapers", w.id, { status: "points_raised" });
      return { workpaper: w.ref, added: created.length, ids: created };
    },
  }),

  tool({
    name: "update_review_point",
    kind: "write",
    description: "Mark a review point addressed or cleared (or reopen it).",
    input: z.object({ id: z.string(), status: z.enum(reviewPointStatuses) }),
    async run(ctx, { id, status }) {
      const r = await update(ctx, "reviewPoints", id, {
        status,
        clearedAt: status === "cleared" ? (ctx.now?.() ?? new Date()).toISOString() : null,
      });
      return { updated: brief("reviewPoints", r.record) };
    },
  }),

  tool({
    name: "add_irl_items",
    kind: "write",
    description: "Add items to an engagement's information request list (IRL), e.g. from a pasted email or screenshot. Next chase dates are set automatically.",
    input: z.object({
      engagement: z.string(),
      requestedFrom: z.string().optional().describe("Client contact's name; created if new"),
      requestedOn: optDate.describe("Defaults to today"),
      items: z
        .array(z.object({ number: z.string().optional(), description: z.string(), due: optDate }))
        .min(1),
    }),
    async run(ctx, { engagement, requestedFrom, requestedOn, items }) {
      const e = await resolveEngagement(ctx.store, engagement);
      const requestedFromId = (await resolvePerson(ctx, requestedFrom, "client"))?.id;
      const on = requestedOn ?? todayISO(ctx.now?.());
      const ids = [];
      for (const it of items)
        ids.push((await createInfoRequest(ctx, { ...it, number: it.number ?? "", engagementId: e.id, requestedFromId, requestedOn: on })).record.id);
      return { engagement: e.name, added: ids.length, ids };
    },
  }),

  tool({
    name: "update_irl_item",
    kind: "write",
    description: "Update an IRL item: mark received/partial/na, change due date or add notes.",
    input: z.object({
      id: z.string(),
      status: z.enum(irlStatuses).optional(),
      due: optDate,
      notes: z.string().optional(),
    }),
    async run(ctx, { id, ...patch }) {
      return { updated: brief("infoRequests", (await update(ctx, "infoRequests", id, patch)).record) };
    },
  }),

  tool({
    name: "log_chase",
    kind: "write",
    description: "Record that I chased an IRL item or nudged someone on a follow-up today. Moves the next chase date forward.",
    input: z.object({ ids: z.array(z.string()).min(1).describe("IRL item or follow-up ids") }),
    async run(ctx, { ids }) {
      const done = [];
      for (const id of ids) {
        const hit = await findAnywhere(ctx.store, id);
        if (!hit || (hit.table !== "infoRequests" && hit.table !== "followUps"))
          throw new Error(`${id} is not an IRL item or follow-up`);
        const r = await logChase(ctx, hit.table, id);
        done.push({ id, next: "nextChaseOn" in r.record ? r.record.nextChaseOn : (r.record as { nextNudgeOn?: string }).nextNudgeOn });
      }
      return { chased: done };
    },
  }),

  tool({
    name: "create_followup",
    kind: "write",
    description: "Track something I'm waiting on from a client, manager or team member.",
    input: z.object({
      about: z.string().describe("What I'm waiting for"),
      person: z.string().optional(),
      type: z.enum(followUpTypes).optional().describe("Defaults from the person's role"),
      engagement: z.string().optional(),
      due: optDate,
    }),
    async run(ctx, { person, engagement, type, ...rest }) {
      const p = await resolvePerson(ctx, person, type === "client" ? "client" : type === "team" ? "team" : type === "manager" ? "manager" : "other");
      const engagementId = engagement ? (await resolveEngagement(ctx.store, engagement)).id : undefined;
      const r = await createFollowUp(ctx, { ...rest, type, personId: p?.id, engagementId });
      return { created: brief("followUps", r.record) };
    },
  }),

  tool({
    name: "close_followup",
    kind: "write",
    description: "Mark a follow-up done (I got what I was waiting for).",
    input: z.object({ id: z.string() }),
    async run(ctx, { id }) {
      return { updated: brief("followUps", (await update(ctx, "followUps", id, { status: "done" })).record) };
    },
  }),

  tool({
    name: "create_alert",
    kind: "write",
    description: "Set a reminder that pops up at a given local date and time.",
    input: z.object({
      title: z.string(),
      at: z.string().describe("Local date-time, e.g. 2026-10-20T16:00"),
      itemId: z.string().optional().describe("Record the reminder is about"),
    }),
    async run(ctx, { title, at, itemId }) {
      const when = new Date(at);
      if (Number.isNaN(when.getTime())) throw new Error(`Can't read the time "${at}"`);
      const item = itemId ? await findAnywhere(ctx.store, itemId) : null;
      const r = await create(ctx, "alerts", { title, fireAt: when.toISOString(), itemTable: item?.table, itemId: item?.record.id });
      return { created: brief("alerts", r.record) };
    },
  }),

  tool({
    name: "log_time",
    kind: "write",
    description: "Log time worked, against an engagement and optionally a task. Use for timesheet hours.",
    input: z.object({
      minutes: z.number().int().min(1).max(1440).describe("Duration in minutes (e.g. 90 for 1.5h)"),
      date: optDate.describe("Defaults to today"),
      engagement: z.string().optional().describe("Engagement id or name; omit for admin/other time"),
      taskId: z.string().optional(),
      note: z.string().optional(),
    }),
    async run(ctx, { engagement, date, ...rest }) {
      const engagementId = engagement ? (await resolveEngagement(ctx.store, engagement)).id : undefined;
      const r = await create(ctx, "timeEntries", { ...rest, engagementId, date: date ?? todayISO(ctx.now?.()), source: "chat" });
      return { created: brief("timeEntries", r.record) };
    },
  }),

  tool({
    name: "weekly_report",
    kind: "read",
    description: "Summary for a week: items finished, chases, focus sessions, hours by engagement, a timesheet grid, longest-waiting items, overdue count.",
    input: z.object({ weekOf: optDate.describe("Any date in the week; defaults to this week") }),
    async run(ctx, { weekOf }) {
      const snap = await loadSnapshot(ctx.store);
      const settings = await ctx.store.getSettings();
      const today = todayISO(ctx.now?.());
      const start = weekStart(weekOf ?? today);
      const report = periodReport(snap, start, shiftWeek(start, 1) <= today ? weekDays(start)[6] : today, today);
      return { ...report, timesheet: timesheetText(timesheet(snap.timeEntries, snap.engagements, start, settings.timeIncrement)) };
    },
  }),

  tool({
    name: "get_stats",
    kind: "read",
    description: "Gamification stats: points, level, today's ring progress, streaks and badges earned.",
    input: z.object({}),
    async run(ctx) {
      const snap = await loadSnapshot(ctx.store);
      const settings = await ctx.store.getSettings();
      const today = todayISO(ctx.now?.());
      const points = pointEvents(snap).reduce((a, e) => a + e.points, 0);
      const ring = ringFor(snap, today, settings);
      return {
        level: levelFor(points),
        ring: { closed: ring.closed, due: ring.due, chases: ring.chases, focus: ring.focus },
        streak: ringStreak(snap.days, today, settings),
        noOverdueChasesStreak: chaseStreak(snap.days, today, settings),
        badges: snap.achievements.map((a) => ({ ...BADGES.find((b) => b.id === a.badge), earnedAt: a.earnedAt, earned: undefined })),
      };
    },
  }),

  tool({
    name: "delete_item",
    kind: "confirm",
    description: "Delete a record. First call without confirmed to get a preview, show it to the user, and only call again with confirmed: true after they agree.",
    input: z.object({ id: z.string(), confirmed: z.boolean().optional() }),
    async run(ctx, { id, confirmed }) {
      const hit = await findAnywhere(ctx.store, id);
      if (!hit) throw new Error(`Nothing found with id ${id}`);
      if (!confirmed) return { needsConfirmation: true, wouldDelete: brief(hit.table, hit.record) };
      await remove(ctx, hit.table, id);
      return { deleted: id, table: hit.table, undo: "Call undo_last to restore it." };
    },
  }),

  tool({
    name: "undo_last",
    kind: "write",
    description: "Undo the most recent change made through this chat.",
    input: z.object({}),
    async run(ctx) {
      const r = await undoLast(ctx.store, ctx.by);
      return r ? { undone: r.count } : { undone: 0, message: "Nothing to undo." };
    },
  }),
] as const satisfies readonly ToolDef<z.ZodType>[];

export type ToolName = (typeof tools)[number]["name"];

export interface ToolCallResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  batchId: string;
}

/** Validates input and runs a tool. All writes from one call share an undo batch. */
export async function runTool(
  ctx: Omit<Ctx, "batchId">,
  name: string,
  rawInput: unknown,
): Promise<ToolCallResult> {
  const batchId = newId();
  const def = tools.find((t) => t.name === name) as ToolDef | undefined;
  if (!def) return { ok: false, error: `Unknown tool ${name}`, batchId };
  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success)
    return { ok: false, error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, batchId };
  try {
    const result = await ctx.store.transaction(() => def.run({ ...ctx, batchId }, parsed.data));
    return { ok: true, result, batchId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), batchId };
  }
}

/** JSON Schema for each tool, for provider adapters. */
export function toolJsonSchemas() {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    kind: t.kind,
    parameters: z.toJSONSchema(t.input as z.ZodType, { io: "input" }),
  }));
}
