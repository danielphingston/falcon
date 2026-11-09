import {
  celebrationFor,
  computeToday,
  loadSnapshot,
  newId,
  todayISO,
  undoBatch,
  type Ctx,
  type Result,
  type TableName,
} from "@falcon/core";
import { store } from "../db";
import { celebrate } from "./confetti";
import { scheduleSync } from "./sync";
import { toast } from "./toast";

/**
 * Runs one or more core actions as a single undoable batch, then shows an
 * Undo toast and fires confetti when something got finished.
 */
export async function act<T extends TableName>(
  message: string | null,
  fn: (ctx: Ctx) => Promise<Result<T> | Result<T>[] | void>,
): Promise<Result<T>[] | undefined> {
  const batchId = newId();
  const ctx: Ctx = { store, by: "app", batchId };
  const before = await openDueCount();
  let results: Result<T>[];
  try {
    const out = await store.transaction(() => fn(ctx));
    results = out ? (Array.isArray(out) ? out : [out]) : [];
  } catch (e) {
    toast({ message: e instanceof Error ? e.message : "Something went wrong", tone: "error" });
    return undefined;
  }

  scheduleSync();

  if (message)
    toast({
      message,
      action: {
        label: "Undo",
        run: async () => {
          await undoBatch(store, batchId);
          scheduleSync();
          toast({ message: "Undone", duration: 1800 });
        },
      },
    });

  let best: Awaited<ReturnType<typeof celebrationFor>> = null;
  const rank = { small: 1, medium: 2, irl_complete: 3, engagement_closed: 4 } as const;
  for (const r of results) {
    const c = await celebrationFor(store, r.change.table, r.before, r.record);
    if (c && (!best || rank[c] > rank[best])) best = c;
  }
  if (best) {
    if (best === "irl_complete") toast({ message: "IRL complete! Every item received 🎉", tone: "success" });
    if (best === "engagement_closed") toast({ message: "Engagement closed. Great work 🎆", tone: "success" });
    const after = await openDueCount();
    if (before > 0 && after === 0 && best === "small") {
      void celebrate("day_cleared");
      toast({ message: "Day cleared! Nothing overdue or due today ✨", tone: "success" });
    } else void celebrate(best);
  }
  return results;
}

async function openDueCount() {
  const v = computeToday(await loadSnapshot(store), todayISO());
  return v.overdue.length + v.dueToday.length;
}

/** Sets which way the page slides for the next view transition. */
export function setNavDirection(dir: "forward" | "back" | "fade") {
  document.documentElement.dataset.nav = dir;
}

const depth = (path: string) => path.split("/").filter(Boolean).length;
export function directionFor(from: string, to: string): "forward" | "back" | "fade" {
  const a = depth(from);
  const b = depth(to);
  return b > a ? "forward" : b < a ? "back" : "fade";
}
