/**
 * "What this unlocked" (build brief 2.4): after RFI items change (marked
 * received, partly received, N/A…), names the work plan steps that moved
 * forward (blocked → can start, or → ready) and whose they are.
 */
import { loadSnapshot, todayISO, unlockedSteps, unlockedText, type InfoRequest } from "@falcon/core";
import { store } from "../db";
import { toast } from "./toast";

/** Looks at one undo batch's RFI changes and shows a toast if they unlocked steps. */
export async function announceUnlocked(batchId: string | undefined) {
  if (!batchId) return;
  const changes = (await store.listChanges()).filter((c) => c.batchId === batchId && c.table === "infoRequests" && !c.undone);
  if (!changes.length) return;
  const snap = await loadSnapshot(store);
  const today = todayISO();
  const before = new Map(changes.filter((c) => c.before).map((c) => [c.recordId, c.before as InfoRequest]));
  const created = new Set(changes.filter((c) => !c.before).map((c) => c.recordId));
  // The RFI as it was before this batch: earlier versions back, new items out.
  const rfiBefore = snap.infoRequests.filter((r) => !created.has(r.id)).map((r) => before.get(r.id) ?? r);
  const messages: string[] = [];
  for (const id of new Set(changes.map((c) => (c.after as InfoRequest).engagementId))) {
    const e = snap.engagements.find((x) => x.id === id);
    if (!e) continue;
    const list = unlockedSteps(e, snap.planItems, snap.infoRequests, rfiBefore, today);
    if (list.length) messages.push(`${snap.engagements.length > 1 ? `${e.name}: ` : ""}${unlockedText(list)}`);
  }
  if (messages.length) toast({ message: messages.join(" · "), tone: "success", duration: 9000 });
}
