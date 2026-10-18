import { addDays, format, getISOWeek, getISOWeekYear, parseISO, startOfISOWeek } from "date-fns";
import { daysBetween, toISODate } from "./dates";
import type { Engagement, TimeEntry } from "./schema";
import type { Snapshot } from "./store";

/** Monday of the week containing `iso`. */
export const weekStart = (iso: string): string => toISODate(startOfISOWeek(parseISO(iso)));
export const weekDays = (start: string): string[] => Array.from({ length: 7 }, (_, i) => toISODate(addDays(parseISO(start), i)));
export const isoWeekKey = (iso: string): string => {
  const d = parseISO(iso);
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`;
};
export const shiftWeek = (start: string, weeks: number) => toISODate(addDays(parseISO(start), weeks * 7));

/** Rounds minutes to the timesheet increment (in hours), e.g. 0.25. */
export const roundHours = (minutes: number, increment: number) => Math.round(minutes / 60 / increment) * increment;
export const formatHours = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0$/, ""));
export const formatMinutes = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);

export interface TimesheetRow {
  engagementId: string | null;
  name: string;
  code: string;
  /** Hours per day, Monday first, rounded to the increment. */
  hours: number[];
  total: number;
}

export interface Timesheet {
  days: string[];
  rows: TimesheetRow[];
  dayTotals: number[];
  total: number;
}

/** Engagement × day grid for one week. Unassigned time goes in an "Other" row. */
export function timesheet(entries: TimeEntry[], engagements: Engagement[], start: string, increment: number): Timesheet {
  const days = weekDays(start);
  const minutes = new Map<string, number[]>();
  for (const e of entries) {
    const i = days.indexOf(e.date);
    if (i < 0 || e.deleted) continue;
    const k = e.engagementId ?? "";
    if (!minutes.has(k)) minutes.set(k, Array(7).fill(0));
    minutes.get(k)![i] += e.minutes;
  }
  const eng = new Map(engagements.map((e) => [e.id, e]));
  const rows: TimesheetRow[] = [...minutes.entries()]
    .map(([k, mins]) => {
      const hours = mins.map((m) => roundHours(m, increment));
      const e = k ? eng.get(k) : undefined;
      return {
        engagementId: k || null,
        name: e?.name ?? (k ? "Deleted engagement" : "Other / admin"),
        code: e?.timesheetCode ?? "",
        hours,
        total: hours.reduce((a, b) => a + b, 0),
      };
    })
    .sort((a, b) => Number(!a.engagementId) - Number(!b.engagementId) || b.total - a.total);
  const dayTotals = days.map((_, i) => rows.reduce((s, r) => s + r.hours[i], 0));
  return { days, rows, dayTotals, total: dayTotals.reduce((a, b) => a + b, 0) };
}

/** Tab-separated, ready to paste into Excel or a timesheet tool. */
export function timesheetText(t: Timesheet): string {
  const head = ["Engagement", "Code", ...t.days.map((d) => format(parseISO(d), "EEE d MMM")), "Total"];
  const lines = t.rows.map((r) => [r.name, r.code, ...r.hours.map(formatHours), formatHours(r.total)]);
  lines.push(["Total", "", ...t.dayTotals.map(formatHours), formatHours(t.total)]);
  return [head, ...lines].map((l) => l.join("\t")).join("\n");
}

// ---------- Reports ----------

export interface PeriodReport {
  from: string;
  to: string;
  tasksDone: number;
  pointsCleared: number;
  wpsFinal: number;
  irlReceived: number;
  followUpsClosed: number;
  chases: number;
  focusSessions: number;
  minutes: number;
  byEngagement: { engagementId: string | null; name: string; minutes: number }[];
  overdueNow: number;
  longestWaiting: { kind: "irl" | "followup"; id: string; title: string; days: number; person?: string }[];
}

const inRange = (iso: string | undefined, from: string, to: string) => !!iso && iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;

export function periodReport(s: Snapshot, from: string, to: string, today: string): PeriodReport {
  const entries = s.timeEntries.filter((e) => e.date >= from && e.date <= to);
  const byEng = new Map<string, number>();
  for (const e of entries) byEng.set(e.engagementId ?? "", (byEng.get(e.engagementId ?? "") ?? 0) + e.minutes);
  const eng = new Map(s.engagements.map((e) => [e.id, e.name]));
  const people = new Map(s.people.map((p) => [p.id, p.name]));

  const waiting = [
    ...s.infoRequests
      .filter((r) => r.status === "pending" || r.status === "partial")
      .map((r) => ({ kind: "irl" as const, id: r.id, title: r.description, days: daysBetween(r.requestedOn, today), person: r.requestedFromId ? people.get(r.requestedFromId) : undefined })),
    ...s.followUps
      .filter((f) => f.status === "waiting")
      .map((f) => ({ kind: "followup" as const, id: f.id, title: f.about, days: daysBetween(f.createdAt.slice(0, 10), today), person: f.personId ? people.get(f.personId) : undefined })),
  ].sort((a, b) => b.days - a.days);

  const open = (due?: string) => !!due && due < today;
  return {
    from,
    to,
    tasksDone: s.tasks.filter((t) => inRange(t.completedAt, from, to)).length,
    pointsCleared: s.reviewPoints.filter((p) => inRange(p.clearedAt, from, to)).length,
    wpsFinal: s.workpapers.filter((w) => inRange(w.finalAt, from, to)).length,
    irlReceived: s.infoRequests.filter((r) => inRange(r.receivedAt, from, to)).length,
    followUpsClosed: s.followUps.filter((f) => inRange(f.doneAt, from, to)).length,
    chases: [...s.infoRequests.flatMap((r) => r.chaseLog), ...s.followUps.flatMap((f) => f.nudgeLog)].filter((d) => d >= from && d <= to).length,
    focusSessions: entries.filter((e) => e.focus).length,
    minutes: entries.reduce((a, e) => a + e.minutes, 0),
    byEngagement: [...byEng.entries()]
      .map(([k, minutes]) => ({ engagementId: k || null, name: k ? (eng.get(k) ?? "Deleted engagement") : "Other / admin", minutes }))
      .sort((a, b) => b.minutes - a.minutes),
    overdueNow:
      s.tasks.filter((t) => t.status !== "done" && open(t.due)).length +
      s.followUps.filter((f) => f.status === "waiting" && open(f.due)).length +
      s.workpapers.filter((w) => w.status !== "final" && w.status !== "cleared" && open(w.due)).length,
    longestWaiting: waiting.slice(0, 5),
  };
}

export function reportText(r: PeriodReport, title: string): string {
  const lines = [
    title,
    "",
    `Tasks done: ${r.tasksDone}`,
    `Review points cleared: ${r.pointsCleared}`,
    `Work papers finalised: ${r.wpsFinal}`,
    `IRL items received: ${r.irlReceived}`,
    `Follow-ups closed: ${r.followUpsClosed}`,
    `Chases sent: ${r.chases}`,
    `Focus sessions: ${r.focusSessions}`,
    `Time logged: ${formatMinutes(r.minutes)}`,
  ];
  if (r.byEngagement.length) lines.push("", "Time by engagement:", ...r.byEngagement.map((b) => `  ${b.name}: ${formatMinutes(b.minutes)}`));
  if (r.longestWaiting.length)
    lines.push("", "Longest waiting:", ...r.longestWaiting.map((w) => `  ${w.title}${w.person ? ` (${w.person})` : ""}: ${w.days}d`));
  lines.push("", `Overdue right now: ${r.overdueNow}`);
  return lines.join("\n");
}
