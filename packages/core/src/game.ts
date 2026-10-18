/**
 * Light gamification. Everything is derived from the records themselves
 * (completion timestamps, chase logs, focus entries), so it stays consistent
 * across devices and Undo takes points back automatically. Points reward
 * finishing work and chasing; logging hours earns nothing, by design.
 */
import { addDays, parseISO } from "date-fns";
import { isWorkingDay, toISODate } from "./dates";
import type { Achievement, DayRecord, Settings } from "./schema";
import type { Snapshot } from "./store";
import { isoWeekKey, periodReport, weekDays, type PeriodReport } from "./time";

export const POINTS = {
  task: 5,
  chase: 3,
  reviewPoint: 5,
  wpFinal: 20,
  irlComplete: 30,
  focus: 10,
} as const;

export interface PointEvent {
  date: string;
  points: number;
  kind: keyof typeof POINTS;
}

export function pointEvents(s: Snapshot): PointEvent[] {
  const ev: PointEvent[] = [];
  const push = (iso: string | undefined, kind: keyof typeof POINTS) => iso && ev.push({ date: iso.slice(0, 10), points: POINTS[kind], kind });
  for (const t of s.tasks) push(t.completedAt, "task");
  for (const r of s.infoRequests) for (const d of r.chaseLog) push(d, "chase");
  for (const f of s.followUps) for (const d of f.nudgeLog) push(d, "chase");
  for (const p of s.reviewPoints) push(p.clearedAt, "reviewPoint");
  for (const w of s.workpapers) push(w.finalAt, "wpFinal");
  for (const e of s.timeEntries) if (e.focus) push(e.date, "focus");
  for (const e of s.engagements) {
    const items = s.infoRequests.filter((r) => r.engagementId === e.id);
    if (items.length && items.every((r) => r.status === "received" || r.status === "na")) {
      const last = items.map((r) => r.receivedAt ?? r.updatedAt).sort().at(-1);
      push(last, "irlComplete");
    }
  }
  return ev;
}

export const LEVELS = [
  { name: "Article Assistant", min: 0 },
  { name: "Associate", min: 100 },
  { name: "Senior", min: 300 },
  { name: "Assistant Manager", min: 700 },
  { name: "Manager", min: 1500 },
  { name: "AVP", min: 3000 },
  { name: "Director", min: 5000 },
  { name: "Partner", min: 8000 },
] as const;

export function levelFor(points: number) {
  let i = 0;
  while (i + 1 < LEVELS.length && points >= LEVELS[i + 1].min) i++;
  const next = LEVELS[i + 1];
  return {
    index: i,
    name: LEVELS[i].name,
    points,
    next: next?.name,
    /** 0..1 progress to the next level (1 at the top). */
    progress: next ? (points - LEVELS[i].min) / (next.min - LEVELS[i].min) : 1,
    toNext: next ? next.min - points : 0,
  };
}

// ---------- Daily ring ----------

export interface RingPart {
  done: number;
  total: number;
  /** 0..1 */
  ratio: number;
}
export interface Ring {
  due: RingPart;
  chases: RingPart;
  focus: RingPart;
  closed: boolean;
  overdueChases: number;
}

const part = (done: number, total: number): RingPart => ({ done, total, ratio: total === 0 ? 1 : Math.min(1, done / total) });

export function ringFor(s: Snapshot, today: string, settings: Pick<Settings, "focusTarget">): Ring {
  const isToday = (iso?: string) => iso?.slice(0, 10) === today;
  const dueBy = (d?: string) => !!d && d <= today;

  const dueDone =
    s.tasks.filter((t) => isToday(t.completedAt) && dueBy(t.due)).length +
    s.followUps.filter((f) => isToday(f.doneAt) && dueBy(f.due)).length;
  const dueOpen =
    s.tasks.filter((t) => t.status !== "done" && dueBy(t.due)).length +
    s.followUps.filter((f) => f.status === "waiting" && dueBy(f.due)).length;

  const chasedToday =
    s.infoRequests.reduce((n, r) => n + r.chaseLog.filter((d) => d === today).length, 0) +
    s.followUps.reduce((n, f) => n + f.nudgeLog.filter((d) => d === today).length, 0);
  const openIrl = s.infoRequests.filter((r) => r.status === "pending" || r.status === "partial");
  const openFu = s.followUps.filter((f) => f.status === "waiting");
  const chaseDue = openIrl.filter((r) => dueBy(r.nextChaseOn)).length + openFu.filter((f) => dueBy(f.nextNudgeOn)).length;
  const overdueChases =
    openIrl.filter((r) => !!r.nextChaseOn && r.nextChaseOn < today).length + openFu.filter((f) => !!f.nextNudgeOn && f.nextNudgeOn < today).length;

  const focusDone = s.timeEntries.filter((e) => e.focus && e.date === today).length;

  const due = part(dueDone, dueDone + dueOpen);
  const chases = part(chasedToday, chasedToday + chaseDue);
  const focus = part(focusDone, settings.focusTarget);
  return { due, chases, focus, closed: due.ratio >= 1 && chases.ratio >= 1 && focus.ratio >= 1, overdueChases };
}

// ---------- Streaks ----------

export interface Streak {
  current: number;
  best: number;
  /** Whether this week's streak freeze is still unused. */
  freezeAvailable: boolean;
}

/**
 * Consecutive working days meeting `good`. Non-working days are skipped.
 * One missed working day per ISO week is covered by a freeze. Today only
 * counts once it's good; an unfinished today never breaks the streak.
 */
export function streakFor(
  days: DayRecord[],
  today: string,
  settings: Pick<Settings, "workingDays" | "holidays">,
  good: (d: DayRecord | undefined) => boolean,
): Streak {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = days.map((d) => d.date).sort()[0];
  if (!first) return { current: 0, best: 0, freezeAvailable: true };
  const frozen = new Set<string>();
  let run = 0;
  let best = 0;
  for (let d = parseISO(first); toISODate(d) <= today; d = addDays(d, 1)) {
    const iso = toISODate(d);
    if (!isWorkingDay(iso, settings)) continue;
    const ok = good(byDate.get(iso));
    if (ok) best = Math.max(best, ++run);
    else if (iso === today) continue;
    else if (run > 0 && !frozen.has(isoWeekKey(iso))) frozen.add(isoWeekKey(iso));
    else run = 0;
  }
  return { current: run, best, freezeAvailable: !frozen.has(isoWeekKey(today)) };
}

export const ringStreak = (days: DayRecord[], today: string, s: Pick<Settings, "workingDays" | "holidays">) =>
  streakFor(days, today, s, (d) => !!d?.ringClosed);
export const chaseStreak = (days: DayRecord[], today: string, s: Pick<Settings, "workingDays" | "holidays">) =>
  streakFor(days, today, s, (d) => !!d && d.overdueChases === 0);

// ---------- Badges ----------

export interface BadgeContext {
  s: Snapshot;
  days: DayRecord[];
  bestStreak: number;
}

export const BADGES = [
  {
    id: "first_close",
    name: "First Close",
    emoji: "🏁",
    description: "Close your first engagement",
    earned: ({ s }: BadgeContext) => s.engagements.some((e) => e.status === "closed"),
  },
  {
    id: "irl_zero",
    name: "IRL Zero",
    emoji: "📭",
    description: "Every IRL item received on an engagement",
    earned: ({ s }: BadgeContext) =>
      s.engagements.some((e) => {
        const items = s.infoRequests.filter((r) => r.engagementId === e.id);
        return items.length > 0 && items.every((r) => r.status === "received" || r.status === "na");
      }),
  },
  {
    id: "clean_sheet",
    name: "Clean Sheet",
    emoji: "🧼",
    description: "One of your WPs finalised with zero review points",
    earned: ({ s }: BadgeContext) =>
      s.workpapers.some((w) => w.myRole === "preparer" && w.status === "final" && !s.reviewPoints.some((p) => p.workpaperId === w.id)),
  },
  {
    id: "reviewers_eye",
    name: "Reviewer's Eye",
    emoji: "🔍",
    description: "50 review points raised on WPs you review",
    earned: ({ s }: BadgeContext) => {
      const mine = new Set(s.workpapers.filter((w) => w.myRole === "reviewer").map((w) => w.id));
      return s.reviewPoints.filter((p) => mine.has(p.workpaperId)).length >= 50;
    },
  },
  {
    id: "chaser",
    name: "Chaser",
    emoji: "📨",
    description: "100 chases logged",
    earned: ({ s }: BadgeContext) => s.infoRequests.reduce((n, r) => n + r.chaseLog.length, 0) + s.followUps.reduce((n, f) => n + f.nudgeLog.length, 0) >= 100,
  },
  {
    id: "deep_work",
    name: "Deep Work",
    emoji: "🎧",
    description: "10 focus sessions in one week",
    earned: ({ s }: BadgeContext) => {
      const perWeek = new Map<string, number>();
      for (const e of s.timeEntries) if (e.focus) perWeek.set(isoWeekKey(e.date), (perWeek.get(isoWeekKey(e.date)) ?? 0) + 1);
      return [...perWeek.values()].some((n) => n >= 10);
    },
  },
  {
    id: "early_bird",
    name: "Early Bird",
    emoji: "🌅",
    description: "Close the daily ring before 1pm",
    earned: ({ days }: BadgeContext) => days.some((d) => d.ringClosed && d.closedAt && new Date(d.closedAt).getHours() < 13),
  },
  {
    id: "deal_season",
    name: "Deal Season",
    emoji: "💼",
    description: "5 engagements running at once",
    earned: ({ s }: BadgeContext) => s.engagements.filter((e) => e.status === "active").length >= 5,
  },
  {
    id: "iron_streak",
    name: "Iron Streak",
    emoji: "🔥",
    description: "A 20-day streak",
    earned: ({ bestStreak }: BadgeContext) => bestStreak >= 20,
  },
] as const;

export type BadgeId = (typeof BADGES)[number]["id"];

/** Badges whose condition holds now but that haven't been recorded yet. */
export function newlyEarnedBadges(ctx: BadgeContext, achievements: Achievement[]): BadgeId[] {
  const have = new Set(achievements.map((a) => a.badge));
  return BADGES.filter((b) => !have.has(b.id) && b.earned(ctx)).map((b) => b.id);
}

// ---------- Weekly recap ----------

export interface WeeklyRecap {
  week: string;
  from: string;
  to: string;
  points: number;
  itemsCleared: number;
  ringDays: number;
  bestDay: { date: string; points: number } | null;
  badges: Achievement[];
  report: PeriodReport;
}

export function weeklyRecap(s: Snapshot, days: DayRecord[], start: string, today: string): WeeklyRecap {
  const dates = weekDays(start);
  const from = dates[0];
  const to = dates[6];
  const events = pointEvents(s).filter((e) => e.date >= from && e.date <= to);
  const perDay = new Map<string, number>();
  for (const e of events) perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.points);
  const best = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const report = periodReport(s, from, to, today);
  return {
    week: isoWeekKey(from),
    from,
    to,
    points: events.reduce((a, e) => a + e.points, 0),
    itemsCleared: report.tasksDone + report.pointsCleared + report.wpsFinal + report.irlReceived + report.followUpsClosed,
    ringDays: days.filter((d) => d.date >= from && d.date <= to && d.ringClosed).length,
    bestDay: best ? { date: best[0], points: best[1] } : null,
    badges: s.achievements.filter((a) => a.earnedAt.slice(0, 10) >= from && a.earnedAt.slice(0, 10) <= to),
    report,
  };
}

/** Points per day for the last `n` days, oldest first. */
export function dailyPoints(s: Snapshot, today: string, n: number): { date: string; points: number }[] {
  const events = pointEvents(s);
  return Array.from({ length: n }, (_, i) => {
    const date = toISODate(addDays(parseISO(today), i - n + 1));
    return { date, points: events.filter((e) => e.date === date).reduce((a, e) => a + e.points, 0) };
  });
}
