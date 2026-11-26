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
  /** Other ways this person is written in sheets: "JK", "SaiTeja", "Majeed". */
  aliases: z.array(z.string()).optional(),
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
  /** The last work plan imported: title, columns, other sheets as reference tables. */
  planInfo: z
    .object({
      file: z.string(),
      sheet: z.string(),
      title: z.array(z.string()).default([]),
      columns: z.array(z.string()).default([]),
      notes: z.array(z.string()).default([]),
      /** Other sheets (summary, risks and instructions…) kept as plain rows. */
      tables: z.array(z.object({ name: z.string(), rows: z.array(z.array(z.string())) })).default([]),
      /** The plan has a separate review status column. */
      hasReview: z.boolean().default(false),
      importedAt: isoDateTime,
    })
    .optional(),
  /** The last RFI imported: its title block, notes to the client, section notes and columns (annexures excluded). */
  rfiInfo: z
    .object({
      file: z.string(),
      sheet: z.string(),
      title: z.array(z.string()).default([]),
      notes: z.array(z.string()).default([]),
      sectionNotes: z.record(z.string(), z.string()).default({}),
      columns: z.array(z.string()).default([]),
      importedAt: isoDateTime,
      /** Sheet name → header of the column that drives the status ("" = none). */
      statusColumns: z.record(z.string(), z.string()).optional(),
      /** Status word (lower case) → status, or "ignore". */
      statusMap: z.record(z.string(), z.enum(["pending", "partial", "received", "na", "ignore"])).optional(),
    })
    .optional(),
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
  /** Work-programme area this WP covers (e.g. "receivables"); drives the review checklist. */
  area: z.string().optional(),
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
  /** Raised from a firm checklist: never sent to the AI. */
  private: z.boolean().optional(),
  /** "Have you also checked…?" counter-questions on this point (AI or offline). */
  challenges: z
    .array(
      z.object({
        question: z.string(),
        why: z.string().default(""),
        source: z.enum(["ai", "library"]).default("library"),
        status: z.enum(["open", "added", "dismissed"]).default("open"),
      }),
    )
    .optional(),
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
  /** RFI section, e.g. "Trade Payables". */
  section: z.string().optional(),
  /** Annexure / format the client should fill, as named in the RFI. */
  annexure: z.string().optional(),
  /** Client-side person responsible, as written in the RFI (when not a contact in the app). */
  responsible: z.string().optional(),
  /** The client's (auditee's) comments from the RFI. */
  clientComment: z.string().optional(),
  /** Sub-heading within the section, e.g. "Bank" or "Employee Statutory Dues › ESIC". */
  subsection: z.string().optional(),
  /** The books (TB / GL / accounting backup): a comparison step can start once it's in. Unset = guessed from the text. */
  books: z.boolean().optional(),
  /** Every other RFI column for this request, with the sheet's own headers ("Criticality", "Remarks - Firm"…). */
  fields: z.array(z.object({ label: z.string(), value: z.string(), link: z.string().optional() })).optional(),
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

// ---------- Work programme ----------
/** One trial balance per engagement: mapped ledgers plus programme settings. */
export const trialBalanceFields = z.object({
  engagementId: z.string(),
  fileName: z.string().default(""),
  importedAt: isoDateTime,
  periods: z.array(z.object({ label: z.string(), isOpening: z.boolean().default(false) })).min(1),
  /** Index into periods for the year under audit, and the comparative. */
  currentIdx: z.number().int().min(0).default(0),
  priorIdx: z.number().int().min(0).optional(),
  lines: z
    .array(
      z.object({
        id: z.string(),
        ledger: z.string(),
        groups: z.array(z.string()).default([]),
        area: z.string(),
        /** Net per period, debit positive. */
        balances: z.array(z.number()),
        mappedBy: z.enum(["auto", "user"]).default("auto"),
        excluded: z.boolean().optional(),
      }),
    )
    .default([]),
  kind: z.enum(["audit", "fdd", "ia"]).default("audit"),
  industry: z.enum(["generic", "d2c", "manufacturing", "services", "trading"]).default("generic"),
  /** Overall and performance materiality (absolute amounts). */
  materiality: z.number().min(0).optional(),
  performance: z.number().min(0).optional(),
});

// ---------- Work plans (imported audit programme / IA plan) ----------
export const planStatuses = ["open", "wip", "review", "closed"] as const;
export const planReviewStatuses = ["open", "wip", "closed"] as const;
export const planItemFields = z.object({
  engagementId: z.string(),
  /** Sheet's own number for the area ("6"), shown with the step's position. */
  number: z.string().default(""),
  /** Phase, e.g. "Planning", "Fieldwork", "Finalisation of Draft". */
  phase: z.string().optional(),
  /** Top-level group row, e.g. "Balance Sheet", "Statement of Profit & Loss". */
  group: z.string().optional(),
  area: z.string().default(""),
  /** Lead-in the step sits under, e.g. "ROC Filings made during the year". */
  lead: z.string().optional(),
  text: z.string().trim().min(1),
  risk: z.string().optional(),
  /** False when the sheet says the step isn't applicable. */
  applicable: z.boolean().default(true),
  assignee: z.string().optional(),
  assigneeId: z.string().optional(),
  status: z.enum(planStatuses).default("open"),
  reviewStatus: z.enum(planReviewStatuses).optional(),
  reviewer: z.string().optional(),
  reviewerId: z.string().optional(),
  budgetHours: z.number().nonnegative().optional(),
  actualHours: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  /** Every other column, with the sheet's headers (remarks, sign-offs…). */
  fields: z.array(z.object({ label: z.string(), value: z.string(), link: z.string().optional() })).optional(),
  order: z.number().default(0),
  closedAt: isoDateTime.optional(),
  /** What the sheet said at the last import, so a re-import only changes statuses the sheet changed. */
  sheetStatus: z.enum(planStatuses).optional(),
  sheetReviewStatus: z.enum(planReviewStatuses).optional(),
  /**
   * Inputs the step needs, once set by the user or the AI (otherwise the app
   * guesses from the RFI): RFI items, extra inputs not on the RFI, or none.
   */
  inputs: z
    .object({
      rfiIds: z.array(z.string()).default([]),
      extra: z.array(z.object({ name: z.string().trim().min(1), received: z.boolean().default(false) })).default([]),
      none: z.boolean().optional(),
      /** manual: confirmed by the user. ai: an AI suggestion, not counted until confirmed. */
      source: z.enum(["manual", "ai"]),
      /** For confirmed links: what suggested them. */
      suggestedBy: z.enum(["ai", "matcher"]).optional(),
    })
    .optional(),
});

export const programItemStatuses = ["todo", "in_progress", "done", "na"] as const;
export const reviewOutcomes = ["none", "ok", "flagged", "na"] as const;
/** One line of an engagement's work programme. */
export const programItemFields = z.object({
  engagementId: z.string(),
  area: z.string(),
  /** Library procedure it came from, if any. */
  procedureId: z.string().optional(),
  text: z.string().trim().min(1),
  why: z.string().optional(),
  assertions: z.array(z.string()).default([]),
  source: z.enum(["library", "followup", "insight", "ai", "manual"]).default("manual"),
  /** For follow-ups: the item that was flagged. */
  parentId: z.string().optional(),
  core: z.boolean().default(false),
  status: z.enum(programItemStatuses).default("todo"),
  assigneeId: z.string().optional(),
  workpaperId: z.string().optional(),
  notes: z.string().optional(),
  /** Reviewer's outcome for this step. */
  review: z.enum(reviewOutcomes).default("none"),
  reviewNote: z.string().optional(),
  order: z.number().default(0),
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

// ---------- Proposals (changes waiting for the user's approval) ----------
export const proposalSources = ["chat", "connector", "import", "matcher", "app"] as const;
export const proposalStatuses = ["pending", "accepted", "rejected", "stale", "void"] as const;
export const proposalFields = z.object({
  /** Who proposed it: the in-app chat, Claude via the bridge, an import or the matcher. */
  source: z.enum(proposalSources),
  /** The tool that produced it, when an AI did. */
  tool: z.string().optional(),
  /** One line for the Inbox, e.g. "Create task “Call client”". */
  summary: z.string(),
  engagementId: z.string().optional(),
  /** Each record the proposal changes, with the version it was based on. */
  changes: z.array(
    z.object({
      table: z.string(),
      recordId: z.string(),
      action: z.enum(["create", "update", "delete"]),
      before: z.record(z.string(), z.unknown()).nullable(),
      after: z.record(z.string(), z.unknown()),
    }),
  ),
  /** Change-log entries the proposal would mark undone (an AI's undo_last). */
  undoesChanges: z.array(z.string()).optional(),
  status: z.enum(proposalStatuses).default("pending"),
  decidedAt: isoDateTime.optional(),
  /** Undo batch of the applied change, once accepted. */
  batchId: z.string().optional(),
  /** Why it couldn't be applied (stale / void). */
  reason: z.string().optional(),
  /** Same tool + input from the same source, so a retried call doesn't queue a duplicate. */
  opKey: z.string().optional(),
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
  trialBalances: trialBalanceFields,
  programItems: programItemFields,
  planItems: planItemFields,
  proposals: proposalFields,
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
  trialBalances: trialBalanceFields.extend(base),
  programItems: programItemFields.extend(base),
  planItems: planItemFields.extend(base),
  proposals: proposalFields.extend(base),
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
export type TrialBalance = EntityMap["trialBalances"];
export type TbLine = TrialBalance["lines"][number];
export type ProgramItem = EntityMap["programItems"];
export type PlanItem = EntityMap["planItems"];
export type Proposal = EntityMap["proposals"];

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
  "programItems",
  "planItems",
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
  /** Other ways the user is written in sheets ("JK"), so they resolve to "me". */
  myAliases: z.array(z.string()).default([]),
  /** Extra names that mean a group, not a person (besides "Team", "All"…). */
  groupNames: z.array(z.string()).default([]),
  /** AI changes that apply without waiting in the Inbox (everything else is proposed). */
  autoApply: z.array(z.enum(["taskDates", "chaseLogs"])).default(["taskDates", "chaseLogs"]),
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
  "autoApply",
  "myAliases",
  "groupNames",
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
  planStatus: { open: "Open", wip: "WIP", review: "Review pending", closed: "Closed" },
  planReviewStatus: { open: "Open", wip: "WIP", closed: "Closed" },
  personRole: { client: "Client", manager: "Manager", partner: "Partner", team: "Team", other: "Other" },
  followUpType: { client: "Client", manager: "Manager", team: "Team", other: "Other" },
} as const;
