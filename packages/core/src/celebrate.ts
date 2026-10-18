import type { AnyEntity, EntityMap, TableName } from "./schema";
import type { Store } from "./store";

export type Celebration = "small" | "medium" | "irl_complete" | "engagement_closed";

/** Decides whether a change deserves confetti, and how much. */
export async function celebrationFor(
  store: Store,
  table: TableName,
  before: AnyEntity | null,
  after: AnyEntity,
): Promise<Celebration | null> {
  if (after.deleted) return null;
  const was = <T extends TableName>(t: T) => (table === t ? (before as EntityMap[T] | null) : null);
  const now = <T extends TableName>(t: T) => (table === t ? (after as EntityMap[T]) : null);

  switch (table) {
    case "tasks":
      return now("tasks")!.status === "done" && was("tasks")?.status !== "done" ? "small" : null;
    case "followUps":
      return now("followUps")!.status === "done" && was("followUps")?.status !== "done" ? "small" : null;
    case "reviewPoints":
      return now("reviewPoints")!.status === "cleared" && was("reviewPoints")?.status !== "cleared" ? "small" : null;
    case "workpapers":
      return now("workpapers")!.status === "final" && was("workpapers")?.status !== "final" ? "medium" : null;
    case "engagements":
      return now("engagements")!.status === "closed" && was("engagements")?.status !== "closed"
        ? "engagement_closed"
        : null;
    case "infoRequests": {
      const item = now("infoRequests")!;
      const prev = was("infoRequests");
      const isDone = (s: string) => s === "received" || s === "na";
      if (!isDone(item.status) || (prev && isDone(prev.status))) return null;
      const all = (await store.list("infoRequests")).filter(
        (r) => !r.deleted && r.engagementId === item.engagementId,
      );
      return all.every((r) => isDone(r.status)) ? "irl_complete" : "small";
    }
    default:
      return null;
  }
}
