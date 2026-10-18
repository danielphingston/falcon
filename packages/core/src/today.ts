import type {
  Engagement,
  FollowUp,
  InfoRequest,
  Person,
  ReviewPoint,
  Task,
  WorkPaper,
} from "./schema";
import type { Snapshot } from "./store";

export type DueItem =
  | { kind: "task"; record: Task; due: string }
  | { kind: "workpaper"; record: WorkPaper; due: string }
  | { kind: "irl"; record: InfoRequest; due: string }
  | { kind: "followup"; record: FollowUp; due: string };

export type ChaseItem =
  | { kind: "irl"; record: InfoRequest; since: string }
  | { kind: "followup"; record: FollowUp; since: string };

export interface ChaseGroup {
  person: Person | null;
  items: ChaseItem[];
}

export interface TodayView {
  overdue: DueItem[];
  dueToday: DueItem[];
  chase: ChaseGroup[];
  toReview: WorkPaper[];
  pointsToClear: ReviewPoint[];
  doneToday: Task[];
}

const irlOpen = (r: InfoRequest) => r.status === "pending" || r.status === "partial";
const wpOpenForReview = (w: WorkPaper) => w.status === "prepared" || w.status === "in_review";

/** Engagements whose items should show up in day-to-day lists. */
export function liveEngagementIds(engagements: Engagement[]): Set<string> {
  return new Set(engagements.filter((e) => e.status !== "closed").map((e) => e.id));
}

export function computeToday(s: Snapshot, today: string): TodayView {
  const live = liveEngagementIds(s.engagements);
  const inLive = (engagementId?: string) => !engagementId || live.has(engagementId);

  const due: DueItem[] = [];
  for (const t of s.tasks)
    if (t.status !== "done" && t.due && t.due <= today && inLive(t.engagementId))
      due.push({ kind: "task", record: t, due: t.due });
  for (const w of s.workpapers)
    if (w.status !== "final" && w.status !== "cleared" && w.due && w.due <= today && inLive(w.engagementId))
      due.push({ kind: "workpaper", record: w, due: w.due });
  for (const r of s.infoRequests)
    if (irlOpen(r) && r.due && r.due <= today && inLive(r.engagementId))
      due.push({ kind: "irl", record: r, due: r.due });
  for (const f of s.followUps)
    if (f.status === "waiting" && f.due && f.due <= today && inLive(f.engagementId))
      due.push({ kind: "followup", record: f, due: f.due });
  due.sort((a, b) => a.due.localeCompare(b.due));

  const chaseItems: { personId?: string; item: ChaseItem }[] = [];
  for (const r of s.infoRequests)
    if (irlOpen(r) && r.nextChaseOn && r.nextChaseOn <= today && inLive(r.engagementId))
      chaseItems.push({ personId: r.requestedFromId, item: { kind: "irl", record: r, since: r.requestedOn } });
  for (const f of s.followUps)
    if (f.status === "waiting" && f.nextNudgeOn && f.nextNudgeOn <= today && inLive(f.engagementId))
      chaseItems.push({ personId: f.personId, item: { kind: "followup", record: f, since: f.createdAt.slice(0, 10) } });

  const people = new Map(s.people.map((p) => [p.id, p]));
  const groups = new Map<string, ChaseGroup>();
  for (const { personId, item } of chaseItems) {
    const key = personId && people.has(personId) ? personId : "";
    if (!groups.has(key)) groups.set(key, { person: key ? people.get(key)! : null, items: [] });
    groups.get(key)!.items.push(item);
  }
  const chase = [...groups.values()].sort((a, b) => b.items.length - a.items.length);

  const myWpIds = new Set(
    s.workpapers.filter((w) => w.myRole === "preparer" && inLive(w.engagementId)).map((w) => w.id),
  );

  return {
    overdue: due.filter((d) => d.due < today),
    dueToday: due.filter((d) => d.due === today),
    chase,
    toReview: s.workpapers.filter((w) => w.myRole === "reviewer" && wpOpenForReview(w) && inLive(w.engagementId)),
    pointsToClear: s.reviewPoints.filter(
      (p) => p.status === "open" && myWpIds.has(p.workpaperId) && !p.assignedToId,
    ),
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
  }
}
