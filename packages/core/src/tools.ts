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
import { AREA_IDS, areaLabel, programmeView, type AreaId } from "./audit";
import { planReviewStatuses, planStatuses, programItemStatuses, reviewOutcomes } from "./schema";
import { namedIn, planAwaitingReview, planProgress } from "./workplan";
import { ME, cellHas, peopleIndex } from "./people";
import { blockerText, engagementReadiness, itemsByStepsHeldUp, readinessLabels, rfiImpact } from "./readiness";
import { OverlayStore, diffLines, isAutoApply, propose, recordTitle } from "./proposals";
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
const timeArg = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .describe("Time as 24h HH:mm");

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
        time: i.kind === "task" ? i.record.dueTime : undefined,
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
    description: "Find records by text across engagements, tasks, work papers, review points, RFI items, work plan steps, follow-ups and people. Returns ids for use with other tools.",
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
    description:
      "Create a to-do, call or meeting. When the user gives a time (\"call Rahul at 3pm\", \"review meeting 10:30-11:30\"), set due AND time (and durationMinutes if an end time or length is given): it is then added to their Google Calendar at that time with a reminder. Assign it to a team member to track work you've pushed to them.",
    input: z.object({
      title: z.string(),
      engagement: z.string().optional().describe("Engagement id or name"),
      due: optDate,
      time: timeArg.optional().describe("Start time, 24h HH:mm, e.g. 15:00. Requires due."),
      durationMinutes: z.number().int().min(5).max(1440).optional().describe("Length in minutes; default 30"),
      priority: z.enum(priorities).optional(),
      assignee: z.string().optional().describe("Team member name or id; omit for me"),
      notes: z.string().optional(),
    }),
    async run(ctx, { engagement, assignee, time, ...rest }) {
      if (time && !rest.due) throw new Error("A time needs a date: pass due as well.");
      const engagementId = engagement ? (await resolveEngagement(ctx.store, engagement)).id : undefined;
      const assigneeId = (await resolvePerson(ctx, assignee, "team"))?.id;
      const r = await create(ctx, "tasks", { ...rest, dueTime: time, engagementId, assigneeId });
      return { created: brief("tasks", r.record), calendar: time ? "Added to Google Calendar at this time once synced (if Google is connected)." : undefined };
    },
  }),

  tool({
    name: "update_task",
    kind: "write",
    description: "Edit a task (title, date, time, length, priority) or mark it done. Set time to \"\" to make it untimed again.",
    input: z.object({
      id: z.string(),
      title: z.string().optional(),
      due: optDate,
      time: z.union([timeArg, z.literal("")]).optional().describe("Start time HH:mm, or \"\" to remove"),
      durationMinutes: z.number().int().min(5).max(1440).optional(),
      priority: z.enum(priorities).optional(),
      status: z.enum(taskStatuses).optional(),
      notes: z.string().optional(),
    }),
    async run(ctx, { id, status, time, ...rest }) {
      const patch = { ...rest, ...(time === undefined ? {} : { dueTime: time === "" ? null : time }) };
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
    name: "get_work_programme",
    kind: "read",
    description:
      "An engagement's TB-driven work programme: materiality, area balances (current and prior), trend flags, and procedures with status, reviewer outcome and notes. Optionally one area.",
    input: z.object({
      engagement: z.string(),
      area: z.enum(AREA_IDS as [AreaId, ...AreaId[]]).optional(),
    }),
    async run(ctx, { engagement, area }) {
      const e = await resolveEngagement(ctx.store, engagement);
      const tb = (await ctx.store.list("trialBalances")).find((t) => !t.deleted && t.engagementId === e.id);
      const items = (await ctx.store.list("programItems")).filter((i) => !i.deleted && i.engagementId === e.id && (!area || i.area === area));
      if (!tb) return { engagement: e.name, programme: "No trial balance imported yet: ask the user to upload it in the engagement's Programme tab.", items: items.length };
      const view = programmeView(tb);
      return {
        engagement: e.name,
        kind: tb.kind,
        industry: tb.industry,
        period: tb.periods[tb.currentIdx]?.label,
        comparative: tb.priorIdx !== undefined ? tb.periods[tb.priorIdx]?.label : undefined,
        materiality: view.materiality,
        areas: view.plans.filter((p) => !area || p.area === area).map((p) => ({ area: p.area, label: areaLabel(p.area), current: Math.round(p.current), prior: p.prior === undefined ? undefined : Math.round(p.prior), scope: p.scope })),
        trendFlags: view.insights.filter((i) => i.status === "flag" && (!area || i.area === area)).map((i) => ({ area: i.area, title: i.title, detail: i.detail })),
        procedures: items
          .sort((a, b) => a.order - b.order)
          .map((i) => ({ id: i.id, area: i.area, text: i.text, status: i.status, review: i.review, reviewNote: i.reviewNote, notes: i.notes, source: i.source })),
      };
    },
  }),

  tool({
    name: "add_program_items",
    kind: "write",
    description: "Add procedures (with why) to an engagement's work programme for an area, e.g. extra checks after the reviewer flagged something. Optionally under a flagged step (parentId).",
    input: z.object({
      engagement: z.string(),
      area: z.enum(AREA_IDS as [AreaId, ...AreaId[]]),
      items: z.array(z.object({ text: z.string(), why: z.string().optional() })).min(1),
      parentId: z.string().optional().describe("Id of the programme step these follow up on"),
    }),
    async run(ctx, { engagement, area, items, parentId }) {
      const e = await resolveEngagement(ctx.store, engagement);
      const all = (await ctx.store.list("programItems")).filter((i) => !i.deleted && i.engagementId === e.id);
      const parent = parentId ? all.find((i) => i.id === parentId) : undefined;
      const base = parent ? parent.order : Math.max(0, ...all.filter((i) => i.area === area).map((i) => i.order)) + 1;
      const ids = [];
      for (const [k, it] of items.entries())
        ids.push((await create(ctx, "programItems", { engagementId: e.id, area, text: it.text, why: it.why, source: "ai", parentId: parent?.id, order: base + 0.01 * (k + 1) })).record.id);
      return { added: ids.length, ids };
    },
  }),

  tool({
    name: "update_program_item",
    kind: "write",
    description: "Update a work-programme step: preparer status, reviewer outcome (ok / flagged / na) with a note, notes, or assignee.",
    input: z.object({
      id: z.string(),
      status: z.enum(programItemStatuses).optional(),
      review: z.enum(reviewOutcomes).optional(),
      reviewNote: z.string().optional(),
      notes: z.string().optional(),
      assignee: z.string().optional().describe("Team member name, or 'me'"),
    }),
    async run(ctx, { id, assignee, ...rest }) {
      const assigneeId = assignee === undefined ? undefined : ((await resolvePerson(ctx, assignee, "team"))?.id ?? null);
      const r = await update(ctx, "programItems", id, { ...rest, ...(assignee === undefined ? {} : { assigneeId }) });
      return { updated: brief("programItems", r.record) };
    },
  }),

  tool({
    name: "get_workload",
    kind: "read",
    description:
      "Everything one person has to complete (or 'me'), optionally on one engagement: work plan steps where they are the person responsible, steps waiting for their review, work papers they prepare or review, tasks, review points assigned to them and work-programme procedures. Use for 'how many items / work papers / steps does X have', 'what is pending with X'.",
    input: z.object({
      person: z.string().describe("Name, first name or initials as used in the work plan, or 'me'"),
      engagement: z.string().optional(),
      includeDone: z.boolean().optional().describe("Also list finished items"),
    }),
    async run(ctx, { person, engagement, includeDone }) {
      const snap = await loadSnapshot(ctx.store);
      const settings = await ctx.store.getSettings();
      const e = engagement ? await resolveEngagement(ctx.store, engagement) : undefined;
      const isMeRef = ["me", "myself", "i"].includes(norm(person)) || (settings.myName !== "Me" && nameKey(settings.myName) === nameKey(person));
      // People in the People list are linked by id; work plan cells hold the name as typed in the sheet.
      let p: Person | undefined;
      if (!isMeRef) p = await resolvePerson(ctx, person).catch(() => undefined);
      const fullName = isMeRef ? settings.myName : (p?.name ?? person);
      const names = [fullName, person];
      // Names in the sheet resolve to people through names, initials and aliases ("JK" → me, "Shahid/Sai Teja" → both).
      const ix = peopleIndex(snap.people, settings);
      const who = isMeRef ? ME : p?.id;
      const named = (cell: string | undefined) => (who ? cellHas(cell, who, ix) : false) || names.some((n) => n && n !== "Me" && namedIn(cell, n));
      const live = new Set(snap.engagements.filter((x) => !x.deleted && x.status !== "closed").map((x) => x.id));
      const inScope = (id: string | undefined) => (e ? id === e.id : !!id && live.has(id));
      const engName = new Map(snap.engagements.map((x) => [x.id, x.name]));
      const hasReview = new Map(snap.engagements.map((x) => [x.id, !!x.planInfo?.hasReview]));

      const steps = snap.planItems.filter((i) => !i.deleted && i.applicable && inScope(i.engagementId)).sort((a, b) => a.engagementId.localeCompare(b.engagementId) || a.order - b.order);
      const mySteps = steps.filter((i) => (p && i.assigneeId === p.id) || named(i.assignee));
      const openSteps = mySteps.filter((i) => i.status !== "closed");
      const reviewing = steps.filter((i) => (p && i.reviewerId === p.id) || named(i.reviewer));
      const toReview = reviewing.filter((i) => planAwaitingReview(i, hasReview.get(i.engagementId) ?? false));
      // Every step they review that isn't signed off yet (whatever its execution status).
      const reviewOpen = reviewing.filter((i) => i.reviewStatus !== "closed");
      const wps = snap.workpapers.filter((w) => !w.deleted && inScope(w.engagementId));
      const wpDone = (w: (typeof wps)[number]) => w.status === "final" || w.status === "cleared";
      const prepares = wps.filter((w) => (isMeRef ? w.myRole === "preparer" : p && w.preparerId === p.id));
      const reviews = wps.filter((w) => (isMeRef ? w.myRole === "reviewer" : p && w.reviewerId === p.id));
      const tasks = snap.tasks.filter((t) => !t.deleted && (!e || t.engagementId === e.id) && (isMeRef ? !t.assigneeId : p && t.assigneeId === p.id));
      const points = snap.reviewPoints.filter((r) => !r.deleted && inScope(r.engagementId) && p && r.assignedToId === p.id);
      const procs = snap.programItems.filter((i) => !i.deleted && inScope(i.engagementId) && p && i.assigneeId === p.id);
      const pick = <T,>(list: T[], done: (x: T) => boolean) => (includeDone ? list : list.filter((x) => !done(x)));

      return {
        person: fullName,
        inPeopleList: isMeRef || !!p,
        engagement: e?.name ?? "all live engagements",
        summary: {
          workPlanStepsToComplete: openSteps.length,
          workPlanStepsTotal: mySteps.length,
          workPlanStepsByStatus: Object.fromEntries(["open", "wip", "review", "closed"].map((s) => [s, mySteps.filter((i) => i.status === s).length])),
          workPlanStepsWaitingForTheirReview: toReview.length,
          workPlanStepsTheyReview: reviewOpen.length,
          workpapersToPrepare: prepares.filter((w) => !wpDone(w)).length,
          workpapersToReview: reviews.filter((w) => !wpDone(w)).length,
          openTasks: tasks.filter((t) => t.status !== "done").length,
          openReviewPoints: points.filter((r) => r.status !== "cleared").length,
          openProgrammeProcedures: procs.filter((i) => i.status !== "done" && i.status !== "na").length,
        },
        workPlanSteps: pick(mySteps, (i) => i.status === "closed").map((i) => ({ id: i.id, engagement: engName.get(i.engagementId), number: i.number, area: i.area, text: i.text.split("\n")[0], status: i.status, reviewStatus: i.reviewStatus, sharedWith: i.assignee })),
        stepsToReview: toReview.map((i) => ({ id: i.id, engagement: engName.get(i.engagementId), number: i.number, area: i.area, text: i.text.split("\n")[0], by: i.assignee })),
        stepsTheyReview: pick(reviewing, (i) => i.reviewStatus === "closed").map((i) => ({
          id: i.id,
          engagement: engName.get(i.engagementId),
          number: i.number,
          area: i.area,
          text: i.text.split("\n")[0],
          by: i.assignee,
          status: i.status,
          reviewStatus: i.reviewStatus ?? "open",
        })),
        workpapers: pick([...new Set([...prepares, ...reviews])], wpDone).map((w) => ({ id: w.id, ref: w.ref, title: w.title, engagement: engName.get(w.engagementId), status: w.status, role: prepares.includes(w) ? "prepares" : "reviews" })),
        tasks: pick(tasks, (t) => t.status === "done").map((t) => ({ id: t.id, title: t.title, due: t.due, status: t.status })),
        reviewPoints: pick(points, (r) => r.status === "cleared").map((r) => ({ id: r.id, text: r.text, status: r.status })),
      };
    },
  }),

  tool({
    name: "get_work_plan",
    kind: "read",
    description:
      "An engagement's imported work plan / audit programme (the Work plan tab): progress, steps per person, and the steps with number, area, procedure, person responsible, execution status (open / wip / review = review pending / closed), review status, reviewer, risk and hours. Filter by person, status or area.",
    input: z.object({
      engagement: z.string(),
      person: z.string().optional().describe("Only steps this person is responsible for or reviews"),
      status: z.enum(planStatuses).optional(),
      area: z.string().optional().describe("Area or phase text, e.g. 'Payroll' or 'Balance Sheet'"),
    }),
    async run(ctx, { engagement, person, status, area }) {
      const e = await resolveEngagement(ctx.store, engagement);
      const items = (await ctx.store.list("planItems")).filter((i) => !i.deleted && i.engagementId === e.id).sort((a, b) => a.order - b.order);
      if (!items.length) return { engagement: e.name, plan: "No work plan imported yet: ask the user to import it in the engagement's Work plan tab." };
      const pr = planProgress(items);
      const full = person ? ((await resolvePerson(ctx, person).catch(() => undefined))?.name ?? person) : "";
      const hit = items.filter(
        (i) =>
          (!person || namedIn(i.assignee, full) || namedIn(i.reviewer, full) || namedIn(i.assignee, person)) &&
          (!status || i.status === status) &&
          (!area || [i.area, i.phase, i.group].some((x) => x && norm(x).includes(norm(area)))),
      );
      return {
        engagement: e.name,
        file: e.planInfo?.file,
        progress: { steps: pr.total, applicable: pr.applicable, executed: pr.closed, reviewed: e.planInfo?.hasReview ? pr.reviewed : undefined, budgetHours: pr.budget, actualHours: pr.actual },
        byPerson: pr.byPerson.map((x) => ({ name: x.name, steps: x.steps, closed: x.closed, open: x.steps - x.closed })),
        matching: hit.length,
        steps: hit.slice(0, 120).map((i) => ({
          id: i.id,
          number: i.number,
          phase: i.phase,
          area: i.area,
          text: i.text,
          assignee: i.assignee,
          status: i.status,
          reviewStatus: i.reviewStatus,
          reviewer: i.reviewer,
          risk: i.risk,
          applicable: i.applicable,
          budgetHours: i.budgetHours,
          actualHours: i.actualHours,
          notes: i.notes,
        })),
      };
    },
  }),

  tool({
    name: "get_readiness",
    kind: "read",
    description:
      "Which open work plan steps can be executed now with the inputs received on the RFI, which are blocked (and by which missing RFI items or inputs not on the RFI), which only have suggested links the user hasn't confirmed yet, and which aren't linked to any input. Only confirmed links count as ready or blocked. Optionally for one person. Use for 'what can we do now', 'what's blocked and why', 'what is holding up Asha'.",
    input: z.object({
      engagement: z.string(),
      person: z.string().optional().describe("Only steps this person is responsible for"),
      includeRfi: z.boolean().optional().describe("Also return the engagement's RFI items (number, status, short description), e.g. to link steps with set_step_inputs"),
    }),
    async run(ctx, { engagement, person, includeRfi }) {
      const snap = await loadSnapshot(ctx.store);
      const e = await resolveEngagement(ctx.store, engagement);
      const rfi = includeRfi
        ? snap.infoRequests
            .filter((r) => r.engagementId === e.id)
            .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
            .map((r) => ({ number: r.number, section: r.section, status: r.status, description: r.description.split("\n")[0].slice(0, 140) }))
        : undefined;
      const full = person ? ((await resolvePerson(ctx, person).catch(() => undefined))?.name ?? person) : "";
      const plan = snap.planItems.filter((i) => !person || namedIn(i.assignee, full) || namedIn(i.assignee, person));
      const names = new Map(snap.people.map((p) => [p.id, p.name]));
      const r = engagementReadiness(e, plan, snap.infoRequests, todayISO(ctx.now?.()), (id) => names.get(id));
      if (!r.steps.length) return { engagement: e.name, message: "No open work plan steps (or no work plan imported)." };
      const line = (s: (typeof r.steps)[number]) => ({ id: s.step.id, number: s.step.number, area: s.step.area, text: s.step.text.split("\n")[0], assignee: s.step.assignee });
      // What has come in for a step (received, or partly), books marked.
      const inHand = (s: (typeof r.steps)[number]) =>
        s.inputs.filter((i) => i.state === "received" || i.state === "partial").map((i) => `${i.rfiNumber ? `RFI ${i.rfiNumber} ` : ""}${i.input.split("\n")[0]}${i.state === "partial" ? " (partly)" : ""}${i.books ? " [books]" : ""}`);
      return {
        engagement: e.name,
        note: "ready and blocked use only links the user confirmed. toConfirm are suggestions (by AI or the offline matcher) the user hasn't checked yet: never report them as ready or blocked; mention they still need confirming in Falcon (Readiness → To confirm).",
        states: "ready = every input in; canStart = some input (or the books side) in, so work can begin; blocked = nothing usable in; likelyNa = every input N/A (consider marking the step N/A); noInput = needs no client input.",
        counts: {
          ready: r.ready.length,
          canStart: r.canStart.length,
          blocked: r.blocked.length,
          likelyNa: r.likelyNa.length,
          noInput: r.noInput.length,
          toConfirm: r.suggested.length,
          notLinked: r.unlinked.length,
        },
        ready: r.ready.map((s) => ({ ...line(s), inHand: inHand(s) })),
        canStart: r.canStart.map((s) => ({ ...line(s), inHand: inHand(s), waitingFor: s.blockers.map(blockerText) })),
        blocked: r.blocked.map((s) => ({ ...line(s), inHand: inHand(s), because: s.blockers.map(blockerText) })),
        likelyNa: r.likelyNa.map(line),
        noInput: r.noInput.map(line),
        holdingUp: r.byInput.slice(0, 20).map((g) => ({ input: blockerText(g.blocker), steps: g.steps.map((s) => s.number) })),
        toConfirm: r.suggested.map((s) => ({
          ...line(s),
          suggestedBy: s.source === "ai" ? "AI" : "offline matcher",
          wouldBe: s.wouldBe,
          inputs: s.none ? ["no client input needed"] : [...s.received.map((x) => (x.rfiNumber ? `RFI ${x.rfiNumber} ` : "") + x.input + " (received)"), ...s.blockers.map(blockerText)],
        })),
        notLinked: r.unlinked.map(line),
        rfi,
      };
    },
  }),

  tool({
    name: "get_rfi_impact",
    kind: "read",
    description:
      "For an RFI item (by number like '3.1', id, or words): every work plan step it feeds, each step's readiness state and owner. Without an item: the open RFI items holding up the most steps. Use for 'what does 1.5 unlock', 'which steps need the bank statements', 'what should we chase first'.",
    input: z.object({
      engagement: z.string(),
      item: z.string().optional().describe("RFI number ('3.1'), id, or words from its description"),
    }),
    async run(ctx, { engagement, item }) {
      const snap = await loadSnapshot(ctx.store);
      const e = await resolveEngagement(ctx.store, engagement);
      const r = engagementReadiness(e, snap.planItems, snap.infoRequests, todayISO(ctx.now?.()));
      const rfi = snap.infoRequests.filter((x) => x.engagementId === e.id);
      if (!item)
        return {
          engagement: e.name,
          holdingUpMost: itemsByStepsHeldUp(r, rfi)
            .slice(0, 15)
            .map((x) => ({ number: x.item.number, item: x.item.description.split("\n")[0], status: x.item.status, steps: x.steps })),
        };
      const q = item.trim().replace(/^rfi\s*/i, "");
      const hit = rfi.find((x) => x.id === q) ?? rfi.find((x) => x.number === q) ?? rfi.find((x) => x.description.toLowerCase().includes(q.toLowerCase()));
      if (!hit) throw new Error(`No RFI item matches "${item}" on ${e.name}.`);
      const imp = rfiImpact(r, hit);
      return {
        engagement: e.name,
        item: { id: hit.id, number: hit.number, description: hit.description.split("\n")[0], status: hit.status },
        feeds: imp.steps.length,
        steps: imp.steps.map((s) => ({
          number: s.step.number,
          area: s.step.area,
          text: s.step.text.split("\n")[0],
          state: readinessLabels[s.state],
          owner: s.step.assignee,
          link: s.confirmed ? "confirmed" : "suggested, not confirmed",
        })),
      };
    },
  }),

  tool({
    name: "set_step_inputs",
    kind: "write",
    description:
      "Suggest which client inputs work plan steps need, for the Readiness page: RFI item numbers, inputs that aren't on the RFI (e.g. 'GSTR-2B for the period'), or that a step needs no client input. Several steps per call. These are suggestions: they show under To confirm and don't count until the user confirms them in Falcon (only the user can confirm). Steps the user already confirmed or set by hand are skipped. Get step ids and RFI numbers from get_readiness with includeRfi.",
    input: z.object({
      engagement: z.string(),
      steps: z
        .array(
          z.object({
            step: z.string().describe("Step id, or its number as shown on the plan (e.g. '7.3')"),
            rfi: z.array(z.string()).optional().describe("RFI item numbers the step needs"),
            notOnRfi: z.array(z.string()).optional().describe("Inputs the step needs that aren't on the RFI"),
            none: z.boolean().optional().describe("True when the step needs no client input"),
          }),
        )
        .min(1)
        .max(100),
      mode: z.enum(["replace", "add"]).optional().describe("replace (default) sets the step's inputs; add keeps what it has and adds these"),
    }),
    async run(ctx, { engagement, steps, mode }) {
      const e = await resolveEngagement(ctx.store, engagement);
      const plan = (await ctx.store.list("planItems")).filter((i) => !i.deleted && i.engagementId === e.id);
      const rfi = (await ctx.store.list("infoRequests")).filter((r) => !r.deleted && r.engagementId === e.id);
      const rfiId = (ref: string) => {
        const k = ref.replace(/^#|^rfi\s*/i, "").trim();
        return rfi.find((r) => r.id === k)?.id ?? rfi.find((r) => r.number.trim() === k)?.id;
      };
      const saved: string[] = [];
      const skipped: { step: string; why: string }[] = [];
      for (const s of steps) {
        const item = plan.find((i) => i.id === s.step) ?? plan.find((i) => i.number === s.step.trim());
        if (!item) {
          skipped.push({ step: s.step, why: "no such step on this engagement's work plan" });
          continue;
        }
        if (item.inputs?.source === "manual") {
          skipped.push({ step: item.number, why: "the user confirmed or set these inputs; left as they are" });
          continue;
        }
        const ids = (s.rfi ?? []).map(rfiId);
        const unknown = (s.rfi ?? []).filter((_, i) => !ids[i]);
        if (unknown.length) skipped.push({ step: item.number, why: `unknown RFI numbers ignored: ${unknown.join(", ")}` });
        const keep = mode === "add" && item.inputs ? item.inputs : { rfiIds: [], extra: [] as { name: string; received: boolean }[] };
        const rfiIds = [...new Set([...keep.rfiIds, ...ids.filter((x): x is string => !!x)])];
        const extra = [...keep.extra];
        for (const name of s.notOnRfi ?? []) if (name.trim() && !extra.some((x) => x.name.toLowerCase() === name.trim().toLowerCase())) extra.push({ name: name.trim(), received: false });
        const none = !!s.none && !rfiIds.length && !extra.length;
        await update(ctx, "planItems", item.id, { inputs: { rfiIds, extra, none: none || undefined, source: "ai" } });
        saved.push(item.number);
      }
      return { engagement: e.name, saved: saved.length, steps: saved, skipped };
    },
  }),

  tool({
    name: "add_point_challenges",
    kind: "write",
    description:
      "Save counter-questions on a review point ('have you also checked…?'), each with a one-line why. They show on the point for the reviewer to add or dismiss. Replaces earlier AI questions that are still open.",
    input: z.object({
      pointId: z.string(),
      questions: z.array(z.object({ question: z.string().min(3), why: z.string().optional() })).min(1).max(8),
    }),
    async run(ctx, { pointId, questions }) {
      const p = await ctx.store.get("reviewPoints", pointId);
      if (!p || p.deleted) throw new Error(`No review point with id ${pointId}`);
      if (p.private) throw new Error("This point came from a firm checklist, so the AI doesn't handle it.");
      const kept = (p.challenges ?? []).filter((q) => q.source !== "ai" || q.status !== "open");
      const seen = new Set(kept.map((q) => q.question.toLowerCase()));
      const fresh = questions
        .filter((q) => !seen.has(q.question.toLowerCase()))
        .map((q) => ({ question: q.question, why: q.why ?? "", source: "ai" as const, status: "open" as const }));
      await update(ctx, "reviewPoints", pointId, { challenges: [...kept, ...fresh] });
      return { added: fresh.length };
    },
  }),

  tool({
    name: "update_plan_step",
    kind: "write",
    description: "Update a work plan step (ids from get_work_plan or get_workload): execution status, review status, notes, actual hours or person responsible.",
    input: z.object({
      id: z.string(),
      status: z.enum(planStatuses).optional(),
      reviewStatus: z.enum(planReviewStatuses).optional(),
      notes: z.string().optional(),
      actualHours: z.number().min(0).optional(),
      assignee: z.string().optional().describe("Name as it should show on the plan"),
    }),
    async run(ctx, { id, assignee, ...rest }) {
      const p = assignee ? await resolvePerson(ctx, assignee).catch(() => undefined) : undefined;
      const r = await update(ctx, "planItems", id, { ...rest, ...(assignee === undefined ? {} : { assignee, assigneeId: p?.id }) });
      return { updated: brief("planItems", r.record) };
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
    name: "list_proposals",
    kind: "read",
    description:
      "Changes waiting for the user's approval (your proposals and those from imports), with what each would change. You can't approve or reject them; only the user can, in Falcon's Inbox. Use to check whether earlier proposals were accepted.",
    input: z.object({
      status: z.enum(["pending", "decided", "all"]).optional().describe("pending (default), decided (accepted/rejected/stale/void) or all"),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    async run(ctx, { status, limit }) {
      const all = (await ctx.store.list("proposals")).filter((p) => !p.deleted).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const pick = all.filter((p) => (status ?? "pending") === "all" || (status === "decided" ? p.status !== "pending" : p.status === "pending"));
      return {
        count: pick.length,
        proposals: pick.slice(0, limit ?? 20).map((p) => ({
          id: p.id,
          status: p.status,
          from: p.source,
          summary: p.summary,
          proposedAt: p.createdAt,
          decidedAt: p.decidedAt,
          reason: p.reason,
          changes: p.changes.slice(0, 10).map((c) => ({ table: c.table, action: c.action, record: recordTitle(c.table, c.after), fields: diffLines(c).slice(0, 8) })),
        })),
      };
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
  /** Set when the call's changes were queued for the user's approval instead of applied. */
  proposalId?: string;
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
    if (ctx.propose && def.kind !== "read") return await proposeTool(ctx, def, parsed.data, batchId);
    const result = await ctx.store.transaction(() => def.run({ ...ctx, batchId }, parsed.data));
    return { ok: true, result, batchId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), batchId };
  }
}

/**
 * Propose mode (AI callers): run the tool on an overlay that keeps its writes,
 * then queue them as one proposal for the user. Calls that only move task
 * dates or log chases (if the user allows) apply straight away.
 */
async function proposeTool(ctx: Omit<Ctx, "batchId">, def: ToolDef, input: unknown, batchId: string): Promise<ToolCallResult> {
  const overlay = new OverlayStore(ctx.store);
  const preview = await def.run({ ...ctx, store: overlay, batchId }, input);
  const changes = overlay.captured();
  if (!changes.length && !overlay.undone.length) return { ok: true, result: preview, batchId };
  const settings = await ctx.store.getSettings();
  if (!overlay.undone.length && isAutoApply(changes, settings.autoApply)) {
    const result = await ctx.store.transaction(() => def.run({ ...ctx, batchId }, input));
    return { ok: true, result, batchId };
  }
  const source = ctx.by === "connector" ? "connector" : ctx.by === "chat" ? "chat" : "app";
  const p = await ctx.store.transaction(() =>
    propose({ ...ctx, by: ctx.by }, { source, tool: def.name, changes, undoes: overlay.undone, opKey: `${def.name}:${JSON.stringify(input)}` }),
  );
  return {
    ok: true,
    batchId,
    proposalId: p.id,
    result: {
      proposed: true,
      proposalId: p.id,
      summary: p.summary,
      note: "Nothing has changed yet: this is waiting for the user's approval in Falcon (Inbox). You can't approve it. Records it would create don't exist until then, so put related changes in one call.",
      wouldReturn: preview,
    },
  };
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
