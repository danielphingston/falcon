import type {
  Engagement,
  FollowUp,
  InfoRequest,
  OpenItem,
  Person,
  ReviewPoint,
  Task,
  WorkPaper,
} from "./schema";
import { update, type Ctx } from "./actions";
import { daysBetween } from "./dates";
import type { Snapshot } from "./store";
import { ME, pointOwner } from "./people";
import { chaseOpen, hasContact } from "./chase";
import { unlockedSteps, type Readiness } from "./readiness";
import type { PlanItem } from "./schema";

export type DueItem =
  | { kind: "task"; record: Task; due: string }
  | { kind: "workpaper"; record: WorkPaper; due: string }
  | { kind: "irl"; record: InfoRequest; due: string }
  | { kind: "followup"; record: FollowUp; due: string }
  | { kind: "point"; record: ReviewPoint; due: string };

export type ChaseItem =
  | { kind: "irl"; record: InfoRequest; since: string }
  | { kind: "followup"; record: FollowUp; since: string };

export interface ChaseGroup {
  person: Person | null;
  /** The client contact as written in the RFI, when not a person in the app. */
  name?: string;
  items: ChaseItem[];
}

export interface TodayView {
  /** Past due: tasks (untimed ones are "carried"), review points I owe, follow-ups, WPs, RFI items. */
  overdue: DueItem[];
  dueToday: DueItem[];
  chase: ChaseGroup[];
  /** RFI items due a chase that have nobody to chase (4.2): not counted as chases. */
  assignContact: InfoRequest[];
  /** Workpapers waiting for my review, in my order (drag order, else due date); includes re-reviews. */
  toReview: WorkPaper[];
  /** Workpapers whose open items' RFI inputs have come in since: "Inputs now in – re-review" (A5). */
  rereview: { wp: WorkPaper; items: OpenItem[] }[];
  /** Steps that became ready or can-start since yesterday (RFI items received). */
  unlocked: { step: PlanItem; to: Readiness }[];
  /** Open review points I owe with no due date reached yet. */
  pointsToClear: ReviewPoint[];
  /** Timed tasks (meetings, calls) whose day has passed: shown as past, never carried. */
  past: Task[];
  doneToday: Task[];
}

/** An open untimed task from an earlier day, or one carried forward to today. */
export const isCarried = (t: Task, today: string) => t.status !== "done" && !!t.due && !t.dueTime && (t.due < today || (!!t.carried && t.due === today));

/**
 * Carry-forward (brief v2 B2): open untimed tasks dated before today move to
 * today, counting the days carried ("carried ×n"); the first due date is
 * kept. Run each morning, or on the next open after days without the app
 * (everything moves once, counting every day). Meetings and calls (timed)
 * are never carried.
 */
export async function carryForward(ctx: Ctx, today: string) {
  const out = [];
  for (const t of await ctx.store.list("tasks")) {
    if (t.deleted || t.status === "done" || !t.due || t.dueTime || t.due >= today) continue;
    out.push(await update(ctx, "tasks", t.id, { due: today, carried: (t.carried ?? 0) + Math.max(1, daysBetween(t.due, today)), firstDue: t.firstDue ?? t.due }));
  }
  return out;
}

const irlOpen = (r: InfoRequest) => r.status === "pending" || r.status === "partial";
const wpOpenForReview = (w: WorkPaper) => w.status === "prepared" || w.status === "in_review";

/** Engagements whose items should show up in day-to-day lists. */
export function liveEngagementIds(engagements: Engagement[]): Set<string> {
  return new Set(engagements.filter((e) => e.status !== "closed").map((e) => e.id));
}

export function computeToday(s: Snapshot, today: string, yesterday?: string): TodayView {
  const live = liveEngagementIds(s.engagements);
  const inLive = (engagementId?: string) => !engagementId || live.has(engagementId);

  const wpById = new Map(s.workpapers.map((w) => [w.id, w]));
  const iOwe = (p: ReviewPoint) => !p.deleted && p.status === "open" && inLive(p.engagementId) && pointOwner(p, wpById.get(p.workpaperId)) === ME;

  const due: DueItem[] = [];
  const past: Task[] = [];
  for (const t of s.tasks)
    if (t.status !== "done" && t.due && t.due <= today && inLive(t.engagementId)) {
      if (t.due < today && t.dueTime) past.push(t);
      else due.push({ kind: "task", record: t, due: t.due });
    }
  for (const p of s.reviewPoints) if (iOwe(p) && p.due && p.due <= today) due.push({ kind: "point", record: p, due: p.due });
  for (const w of s.workpapers)
    if (w.status !== "final" && w.status !== "cleared" && w.due && w.due <= today && inLive(w.engagementId))
      due.push({ kind: "workpaper", record: w, due: w.due });
  for (const r of s.infoRequests)
    if (irlOpen(r) && r.due && r.due <= today && inLive(r.engagementId))
      due.push({ kind: "irl", record: r, due: r.due });
  for (const f of s.followUps)
    if (f.status === "waiting" && f.due && f.due <= today && inLive(f.engagementId))
      due.push({ kind: "followup", record: f, due: f.due });
  // By date, then timed items in time order before untimed ones.
  const timeOf = (d: DueItem) => (d.kind === "task" && d.record.dueTime) || "99:99";
  due.sort((a, b) => a.due.localeCompare(b.due) || timeOf(a).localeCompare(timeOf(b)));

  const chaseItems: { personId?: string; name?: string; item: ChaseItem }[] = [];
  const assignContact: InfoRequest[] = [];
  for (const r of s.infoRequests)
    if (chaseOpen(r) && r.nextChaseOn && r.nextChaseOn <= today && inLive(r.engagementId)) {
      if (!hasContact(r)) assignContact.push(r);
      else chaseItems.push({ personId: r.requestedFromId, name: r.responsible?.trim(), item: { kind: "irl", record: r, since: r.requestedOn } });
    }
  for (const f of s.followUps)
    if (f.status === "waiting" && f.nextNudgeOn && f.nextNudgeOn <= today && inLive(f.engagementId))
      chaseItems.push({ personId: f.personId, item: { kind: "followup", record: f, since: f.createdAt.slice(0, 10) } });

  const people = new Map(s.people.map((p) => [p.id, p]));
  const groups = new Map<string, ChaseGroup>();
  for (const { personId, name, item } of chaseItems) {
    const person = personId ? people.get(personId) : undefined;
    const key = person ? person.id : name ? `name:${name.toLowerCase()}` : "";
    if (!groups.has(key)) groups.set(key, { person: person ?? null, ...(!person && name ? { name } : {}), items: [] });
    groups.get(key)!.items.push(item);
  }
  const chase = [...groups.values()].sort((a, b) => b.items.length - a.items.length);
  const rereview = rereviewFlags(s).filter((x) => inLive(x.wp.engagementId));

  return {
    overdue: due.filter((d) => d.due < today),
    dueToday: due.filter((d) => d.due === today),
    chase,
    toReview: reviewQueue([
      ...s.workpapers.filter((w) => w.myRole === "reviewer" && wpOpenForReview(w) && inLive(w.engagementId)),
      ...rereview.filter((x) => !wpOpenForReview(x.wp) || x.wp.myRole !== "reviewer").map((x) => x.wp),
    ]),
    rereview,
    assignContact,
    unlocked: yesterday ? unlockedSince(s, yesterday, today, live) : [],
    pointsToClear: s.reviewPoints.filter((p) => iOwe(p) && !(p.due && p.due <= today)),
    past,
    doneToday: s.tasks.filter((t) => t.status === "done" && t.completedAt?.slice(0, 10) === today),
  };
}

export function titleOf(item: DueItem | ChaseItem): string {
  switch (item.kind) {
    case "task":
      return item.record.title;
    case "workpaper":
      return `${item.record.ref} ${item.record.title}`;
    case "irl":
      return item.record.number ? `#${item.record.number} ${item.record.description}` : item.record.description;
    case "followup":
      return item.record.about;
    case "point":
      return item.record.text;
  }
}

/**
 * Steps unlocked since `since` (5.1): compares readiness now with readiness as
 * if the RFI items received or partly received since then were still pending.
 */
export function unlockedSince(s: Snapshot, since: string, today: string, live = liveEngagementIds(s.engagements)) {
  const moved = (r: InfoRequest) => !r.deleted && r.status !== "pending" && r.updatedAt.slice(0, 10) >= since;
  const out: { step: PlanItem; to: Readiness }[] = [];
  for (const e of s.engagements) {
    if (e.deleted || !live.has(e.id)) continue;
    const rfi = s.infoRequests.filter((r) => r.engagementId === e.id && !r.deleted);
    if (!rfi.some(moved)) continue;
    const plan = s.planItems.filter((i) => i.engagementId === e.id && !i.deleted);
    const before = rfi.map((r) => (moved(r) ? { ...r, status: "pending" as const } : r));
    for (const u of unlockedSteps(e, plan, rfi, before, today)) out.push({ step: u.step, to: u.to });
  }
  return out;
}

/** The To review order (A7): dragged order first, then by due date, then ref. */
export function reviewQueue(wps: WorkPaper[]): WorkPaper[] {
  return [...new Map(wps.map((w) => [w.id, w])).values()].sort(
    (a, b) =>
      (a.reviewOrder ?? Infinity) - (b.reviewOrder ?? Infinity) ||
      (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
      a.ref.localeCompare(b.ref, undefined, { numeric: true }),
  );
}

/**
 * Re-review flags (A5): open items still unresolved whose RFI item is now
 * received, and the reviewer hasn't marked as re-reviewed since it came in.
 */
export function rereviewFlags(s: Pick<Snapshot, "workpapers" | "infoRequests">): { wp: WorkPaper; items: OpenItem[] }[] {
  const rfi = new Map(s.infoRequests.filter((r) => !r.deleted).map((r) => [r.id, r]));
  const out: { wp: WorkPaper; items: OpenItem[] }[] = [];
  for (const wp of s.workpapers) {
    if (wp.deleted || wp.status === "final") continue;
    const items = (wp.openItems ?? []).filter((o) => {
      if (o.resolved || !o.rfiItemId) return false;
      const r = rfi.get(o.rfiItemId);
      if (!r || r.status !== "received") return false;
      return !o.rereviewSeenAt || (r.receivedAt ?? r.updatedAt) > o.rereviewSeenAt;
    });
    if (items.length) out.push({ wp, items });
  }
  return out;
}

/**
 * Open items waiting on an RFI item that's been marked N/A are resolved,
 * noted "RFI marked N/A" (edge case 9). Run as housekeeping; one batch.
 */
export async function resolveNaOpenItems(ctx: Ctx) {
  const rfi = new Map((await ctx.store.list("infoRequests")).filter((r) => !r.deleted).map((r) => [r.id, r]));
  const out = [];
  for (const wp of await ctx.store.list("workpapers")) {
    if (wp.deleted || !wp.openItems?.some((o) => !o.resolved && o.rfiItemId && rfi.get(o.rfiItemId)?.status === "na")) continue;
    const openItems = wp.openItems.map((o) => (!o.resolved && o.rfiItemId && rfi.get(o.rfiItemId)?.status === "na" ? { ...o, resolved: true, note: [o.note, "RFI marked N/A"].filter(Boolean).join(" · ") } : o));
    out.push(await update(ctx, "workpapers", wp.id, { openItems }));
  }
  return out;
}
