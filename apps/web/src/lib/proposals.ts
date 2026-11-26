/**
 * The app's side of proposals: accepting and rejecting (only the user can, so
 * these always run as "app"), with an Undo toast, and the pending count.
 */
import { acceptAll, acceptProposal, rejectProposal, undoBatch, type Proposal } from "@falcon/core";
import { store } from "../db";
import { useSnapshot } from "./hooks";
import { scheduleSync } from "./sync";
import { toast } from "./toast";
import { announceUnlocked } from "./unlocked";

const ctx = () => ({ store, by: "app" as const });

const why = (status: Proposal["status"], reason?: string) =>
  status === "stale" ? `Not applied: ${reason ?? "the record changed since."}` : status === "void" ? `Not applied: ${reason ?? "the record no longer exists."}` : "Already decided.";

export async function accept(id: string): Promise<boolean> {
  try {
    const d = await acceptProposal(ctx(), id);
    scheduleSync();
    if (d.status !== "accepted") {
      toast({ message: why(d.status, d.reason), tone: "error" });
      return false;
    }
    toast({ message: "Applied", action: { label: "Undo", run: () => void undo(d.batchId!) } });
    void announceUnlocked(d.batchId);
    return true;
  } catch (e) {
    toast({ message: e instanceof Error ? e.message : "Couldn't apply it", tone: "error" });
    return false;
  }
}

export async function reject(id: string) {
  await rejectProposal(ctx(), id);
  scheduleSync();
}

/** Accepts each separately; says how many applied and how many couldn't be. */
export async function acceptMany(ids: string[]) {
  const res = await acceptAll(ctx(), ids);
  scheduleSync();
  const ok = res.filter((r) => r.decision.status === "accepted").length;
  const failed = res.length - ok;
  toast({ message: `Applied ${ok}${failed ? `; ${failed} couldn't be (changed or deleted since): see Decided` : ""}`, tone: failed ? "error" : "success" });
  return res;
}

/** Undoes an accepted proposal: its changes revert and it goes back to pending. */
export async function undo(batchId: string) {
  await undoBatch(store, batchId);
  scheduleSync();
  toast({ message: "Undone; it's back in your Inbox", duration: 2200 });
}

export function usePendingProposals(): Proposal[] {
  const snap = useSnapshot();
  return (snap?.proposals ?? []).filter((p) => p.status === "pending").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
