import { z } from "zod";

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date like 2026-10-18");
export const isoDateTime = z.string().min(10);

export const actorSchema = z.enum(["app", "connector", "chat"]);
export type Actor = z.infer<typeof actorSchema>;

/** Fields every synced record carries. */
const base = {
  id: z.string(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deleted: z.boolean(),
  updatedBy: actorSchema,
};

// ---------- People ----------
export const personRoles = ["client", "manager", "partner", "team", "other"] as const;
export const personFields = z.object({
  name: z.string().trim().min(1),
  role: z.enum(personRoles).default("other"),
  org: z.string().optional(),
  /** e.g. "Article", "Senior", "Associate". */
  designation: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
});

// ---------- Engagements ----------
export const engagementStatuses = ["active", "on_hold", "closed"] as const;
export const engagementFields = z.object({
  name: z.string().trim().min(1),
  client: z.string().optional(),
  /** Kind of assignment, e.g. "Due Diligence", "Stat Audit", "Internal Audit", "ITR". */
  type: z.string().optional(),
  side: z.enum(["buy", "sell", "other"]).default("buy"),
  /** Who leads it; empty means me. */
  leadId: z.string().optional(),
  /** Team members working on it (person ids). Older records may lack this: read with `?? []`. */
  team: z.array(z.string()).default([]),
  status: z.enum(engagementStatuses).default("active"),
  kickoff: isoDate.optional(),
  dataRoom: isoDate.optional(),
  draftReport: isoDate.optional(),
  finalReport: isoDate.optional(),
  timesheetCode: z.string().optional(),
  color: z.string().optional(),
  notes: z.string().optional(),
  /** Set automatically when the engagement is closed. */
  closedAt: isoDateTime.optional(),
});

// ---------- Workstreams ----------
export const defaultWorkstreams = ["QoE", "NWC", "Net debt", "Tax"] as const;
export const workstreamFields = z.object({
  engagementId: z.string(),
  name: z.string().trim().min(1),
  ownerId: z.string().optional(),
});

// ---------- Tasks ----------
export const taskStatuses = ["todo", "in_progress", "done"] as const;
export const priorities = ["low", "normal", "high"] as const;
export const taskFields = z.object({
  title: z.string().trim().min(1),
  engagementId: z.string().optional(),
  workstreamId: z.string().optional(),
  due: isoDate.optional(),
  /** Local start time (HH:mm, 24h) on the due date; makes it a timed calendar event. */
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a time like 15:30").optional(),
  /** Length of the calendar event in minutes (default 30). */
  durationMinutes: z.number().int().min(5).max(24 * 60).optional(),
  priority: z.enum(priorities).default("normal"),
  status: z.enum(taskStatuses).default("todo"),
  /** Empty means "me". */
  assigneeId: z.string().optional(),
  notes: z.string().optional(),
  completedAt: isoDateTime.optional(),
});

// ---------- Work papers ----------
export const wpStatuses = [
  "not_started",
  "in_progress",
  "prepared",
  "in_review",
  "points_raised",
  "cleared",
  "final",
] as const;
export const workpaperFields = z.object({
  engagementId: z.string(),
  workstreamId: z.string().optional(),
  ref: z.string().trim().min(1),
  title: z.string().trim().min(1),
  myRole: z.enum(["preparer", "reviewer"]).default("preparer"),
  /** Empty means "me". */
  preparerId: z.string().optional(),
  reviewerId: z.string().optional(),
  status: z.enum(wpStatuses).default("not_started"),
  due: isoDate.optional(),
  notes: z.string().optional(),
  /** Set automatically when the WP reaches "final". */
  finalAt: isoDateTime.optional(),
});

// ---------- Review points ----------
export const reviewPointStatuses = ["open", "addressed", "cleared"] as const;
export const reviewPointFields = z.object({
  workpaperId: z.string(),
  engagementId: z.string(),
  text: z.string().trim().min(1),
  raisedById: z.string().optional(),
  assignedToId: z.string().optional(),
  status: z.enum(reviewPointStatuses).default("open"),
  clearedAt: isoDateTime.optional(),
});

// ---------- Info requests (IRL) ----------
export const irlStatuses = ["pending", "partial", "received", "na"] as const;
export const infoRequestFields = z.object({
  engagementId: z.string(),
  number: z.string().default(""),
  description: z.string().trim().min(1),
  requestedFromId: z.string().optional(),
  requestedOn: isoDate,
  due: isoDate.optional(),
  status: z.enum(irlStatuses).default("pending"),
  chaseLog: z.array(isoDate).default([]),
  nextChaseOn: isoDate.optional(),
  notes: z.string().optional(),
  /** Set automatically when the item becomes received / n.a. */
  receivedAt: isoDateTime.optional(),
});

// ---------- Follow-ups ----------
export const followUpTypes = ["client", "manager", "team", "other"] as const;
export const followUpFields = z.object({
  about: z.string().trim().min(1),
  personId: z.string().optional(),
  type: z.enum(followUpTypes).default("other"),
  engagementId: z.string().optional(),
  due: isoDate.optional(),
  nextNudgeOn: isoDate.optional(),
  nudgeLog: z.array(isoDate).default([]),
  status: z.enum(["waiting", "done"]).default("waiting"),
  notes: z.string().optional(),
  /** Set automatically when the follow-up is closed. */
  doneAt: isoDateTime.optional(),
});

// ---------- Alerts ----------
export const alertFields = z.object({
  title: z.string().trim().min(1),
  fireAt: isoDateTime,
  itemTable: z.string().optional(),
  itemId: z.string().optional(),
  fired: z.boolean().default(false),
});

// ---------- Time ----------
export const timeEntryFields = z.object({
  date: isoDate,
  minutes: z.number().int().min(1).max(24 * 60),
  engagementId: z.string().optional(),
  taskId: z.string().optional(),
  note: z.string().optional(),
  source: z.enum(["timer", "manual", "chat"]).default("manual"),
  /** A completed focus session (counts toward the daily ring). */
  focus: z.boolean().default(false),
});

// ---------- Gamification (system-written, not undoable) ----------
/** One per calendar day the app was used; id is the date. */
export const dayFields = z.object({
  date: isoDate,
  ringClosed: z.boolean().default(false),
  closedAt: isoDateTime.optional(),
  /** Chase items left overdue at the last check that day. */
  overdueChases: z.number().int().min(0).default(0),
});
export const achievementFields = z.object({
  badge: z.string(),
  earnedAt: isoDateTime,
});

export const fieldSchemas = {
  people: personFields,
  engagements: engagementFields,
  workstreams: workstreamFields,
  tasks: taskFields,
  workpapers: workpaperFields,
  reviewPoints: reviewPointFields,
  infoRequests: infoRequestFields,
  followUps: followUpFields,
  alerts: alertFields,
  timeEntries: timeEntryFields,
  days: dayFields,
  achievements: achievementFields,
} as const;

export type TableName = keyof typeof fieldSchemas;
export const tableNames = Object.keys(fieldSchemas) as TableName[];

export const entitySchemas = {
  people: personFields.extend(base),
  engagements: engagementFields.extend(base),
  workstreams: workstreamFields.extend(base),
  tasks: taskFields.extend(base),
  workpapers: workpaperFields.extend(base),
  reviewPoints: reviewPointFields.extend(base),
  infoRequests: infoRequestFields.extend(base),
  followUps: followUpFields.extend(base),
  alerts: alertFields.extend(base),
  timeEntries: timeEntryFields.extend(base),
  days: dayFields.extend(base),
  achievements: achievementFields.extend(base),
} as const;

export type EntityMap = { [K in TableName]: z.output<(typeof entitySchemas)[K]> };
export type InputMap = { [K in TableName]: z.input<(typeof fieldSchemas)[K]> };
export type FieldsMap = { [K in TableName]: z.output<(typeof fieldSchemas)[K]> };
export type AnyEntity = EntityMap[TableName];

export type Person = EntityMap["people"];
export type Engagement = EntityMap["engagements"];
export type Workstream = EntityMap["workstreams"];
export type Task = EntityMap["tasks"];
export type WorkPaper = EntityMap["workpapers"];
export type ReviewPoint = EntityMap["reviewPoints"];
export type InfoRequest = EntityMap["infoRequests"];
export type FollowUp = EntityMap["followUps"];
export type Alert = EntityMap["alerts"];
export type TimeEntry = EntityMap["timeEntries"];
export type DayRecord = EntityMap["days"];
export type Achievement = EntityMap["achievements"];

/** Tables holding the user's work (excludes system-written gamification state). */
export const workTables = [
  "people",
  "engagements",
  "workstreams",
  "tasks",
  "workpapers",
  "reviewPoints",
  "infoRequests",
  "followUps",
  "timeEntries",
] as const satisfies readonly TableName[];

/** One entry per record change; powers Undo (and later, points). */
export interface Change {
  id: string;
  at: string;
  /** Strictly increasing on a device; orders changes made in the same millisecond. */
  seq: number;
  by: Actor;
  batchId: string;
  table: TableName;
  recordId: string;
  action: "create" | "update" | "delete";
  before: AnyEntity | null;
  after: AnyEntity;
  undone: boolean;
}

export const settingsSchema = z.object({
  /** 0 = Sunday … 6 = Saturday */
  workingDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  holidays: z.array(isoDate).default([]),
  chaseDays: z
    .object({
      client: z.number().int().min(1).default(2),
      manager: z.number().int().min(1).default(2),
      team: z.number().int().min(1).default(1),
      other: z.number().int().min(1).default(2),
    })
    .default({ client: 2, manager: 2, team: 1, other: 2 }),
  motion: z.boolean().default(true),
  confetti: z.boolean().default(true),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  myName: z.string().default("Me"),
  gamification: z.boolean().default(true),
  /** Focus sessions per day for the daily ring. */
  focusTarget: z.number().int().min(0).max(12).default(3),
  focusMinutes: z.number().int().min(5).max(180).default(25),
  /** Timesheet rounding, in hours. */
  timeIncrement: z.number().min(0.05).max(1).default(0.25),
  /** ISO week (e.g. 2026-W43) whose recap was dismissed. */
  recapDismissed: z.string().default(""),
  /** OAuth client ID from Google Cloud (only needed if the build doesn't include one). */
  googleClientId: z.string().default(""),
  calendarAlerts: z.boolean().default(true),
  calendarKeyDates: z.boolean().default(true),
  calendarDueDates: z.boolean().default(false),
  /** Gemini model for the in-app chat. */
  geminiModel: z.string().default("gemini-3.8-flash"),
});

/** Settings that follow the user across devices; the rest (theme, Google setup…) stay per device. */
export const syncedSettingsKeys = [
  "workingDays",
  "holidays",
  "chaseDays",
  "myName",
  "gamification",
  "focusTarget",
  "focusMinutes",
  "timeIncrement",
  "calendarAlerts",
  "calendarKeyDates",
  "calendarDueDates",
] as const satisfies readonly (keyof z.output<typeof settingsSchema>)[];
export type Settings = z.output<typeof settingsSchema>;
export const defaultSettings = (): Settings => settingsSchema.parse({});

// ---------- Labels for UI and AI ----------
export const labels = {
  wpStatus: {
    not_started: "Not started",
    in_progress: "In progress",
    prepared: "Prepared",
    in_review: "In review",
    points_raised: "Points raised",
    cleared: "Cleared",
    final: "Final",
  },
  irlStatus: { pending: "Pending", partial: "Partial", received: "Received", na: "N/A" },
  taskStatus: { todo: "To do", in_progress: "In progress", done: "Done" },
  reviewPointStatus: { open: "Open", addressed: "Addressed", cleared: "Cleared" },
  engagementStatus: { active: "Active", on_hold: "On hold", closed: "Closed" },
  personRole: { client: "Client", manager: "Manager", partner: "Partner", team: "Team", other: "Other" },
  followUpType: { client: "Client", manager: "Manager", team: "Team", other: "Other" },
} as const;
