/**
 * The app's side of the Programme → Workstep → Workpaper chain: queueing the
 * one-time set-up proposal per engagement (build brief v2 A1).
 */
import { OverlayStore, StepCloseError, carryForward, chaseResets, newId, resolveNaOpenItems, loadSnapshot, planMigration, proposeMigration, runTool, todayISO, updateStep, type Ctx, type PlanItem } from "@falcon/core";
import { act } from "./act";
import { toast } from "./toast";
import { getSettings, store } from "../db";
import { scheduleSync } from "./sync";

const ctx = () => ({ store, by: "app" as const });

/**
 * Engagements that were never set up get one proposal each in the Inbox.
 * One the user rejected isn't asked again here (the Programme tab can).
 */
export async function proposeMissingMigrations(): Promise<number> {
  const snap = await loadSnapshot(store, { raw: true });
  const settings = await getSettings();
  const asked = new Set(snap.proposals.filter((p) => p.tool === "migrate_programme").map((p) => p.engagementId));
  let n = 0;
  for (const e of snap.engagements) {
    if (asked.has(e.id) || !planMigration(snap, e.id, settings)) continue;
    if (await proposeMigration(ctx(), e.id)) n++;
  }
  if (n) scheduleSync();
  return n;
}

/** Asks again for one engagement (e.g. after a rejection, or new steps came in). */
export async function proposeMigrationFor(engagementId: string) {
  const p = await proposeMigration(ctx(), engagementId);
  if (p) scheduleSync();
  return p;
}

/**
 * Changes a step through the guard rail (A4): closing a step with no cleared
 * workpaper is refused with "Create workpaper / Mark N/A".
 */
export async function changeStep(step: PlanItem, patch: Parameters<typeof updateStep>[2], message: string | null = "Saved") {
  try {
    // Check first (outside act, so the refusal isn't a plain error toast).
    await updateStep({ ...ctx(), store: new OverlayStore(store) } as Ctx, step.id, patch);
  } catch (e) {
    if (e instanceof StepCloseError) {
      stepClosePrompt(step, e.message);
      return undefined;
    }
  }
  return act(message, (c) => updateStep(c, step.id, patch));
}

/** "Create workpaper / Mark N/A" for a step that can't close yet. */
export function stepClosePrompt(step: PlanItem, message: string) {
  toast({
    message,
    tone: "error",
    duration: 12000,
    actions: [
      {
        label: "Create workpaper",
        run: () => void import("../components/WorkpaperForm").then((m) => (step.workpaperId ? m.openStepLinks(step.workpaperId) : m.openWorkpaperForm({ stepIds: [step.id] }))),
      },
      { label: "Mark N/A", run: () => void markStepNa(step) },
    ],
  });
}


/**
 * Marks a step N/A (edge case 1): its workpaper is kept and unlinked; when
 * that leaves the workpaper covering nothing, offers to delete it.
 */
export async function markStepNa(step: PlanItem) {
  const wpId = step.workpaperId;
  const res = await act("Step marked N/A", (c) => updateStep(c, step.id, { applicable: false, workpaperId: null }));
  if (!res || !wpId) return;
  const snap = await loadSnapshot(store);
  const wp = snap.workpapers.find((w) => w.id === wpId);
  if (wp && !snap.planItems.some((s) => s.workpaperId === wpId))
    toast({
      message: `${wp.ref} ${wp.title} now covers no step. It's kept under Unlinked workpapers.`,
      duration: 12000,
      actions: [{ label: "Delete it", run: () => void import("@falcon/core").then((m) => act(`${wp.ref} deleted`, (c) => m.remove(c, "workpapers", wp.id))) }],
    });
}

/**
 * One-time chase recalculation (brief v2 B1): per engagement whose open RFI
 * items' chase dates don't follow the cadence, one proposal in the Inbox.
 * Not asked again for an engagement once proposed (Settings can reset any time).
 */
export async function proposeChaseResets(): Promise<number> {
  const snap = await loadSnapshot(store, { raw: true });
  const settings = await getSettings();
  const asked = new Set(snap.proposals.filter((p) => p.tool === "reset_chase_dates").map((p) => p.engagementId));
  let n = 0;
  for (const e of snap.engagements) {
    if (e.status === "closed" || asked.has(e.id) || !chaseResets(snap.infoRequests, settings, e.id).length) continue;
    const r = await runTool({ store, by: "app", propose: true }, "reset_chase_dates", { engagement: e.id });
    if (r.proposalId) n++;
  }
  if (n) scheduleSync();
  return n;
}

/** Open items waiting on RFI items marked N/A get resolved (edge case 9). */
export async function tidyOpenItems() {
  const r = await store.transaction(() => resolveNaOpenItems({ store, by: "app", batchId: newId() }));
  if (r.length) scheduleSync();
}

/** Moves open untimed tasks from earlier days to today (once a day; undoable). */
export async function carryTasksForward(today = todayISO()) {
  // One batch, so Undo puts them all back.
  const batchId = newId();
  const moved = await store.transaction(() => carryForward({ store, by: "app", batchId }, today));
  if (!moved.length) return 0;
  scheduleSync();
  toast({
    message: `${moved.length} open task${moved.length === 1 ? "" : "s"} carried to today`,
    action: { label: "Undo", run: () => void import("@falcon/core").then(async (m) => (await m.undoBatch(store, batchId), scheduleSync())) },
  });
  return moved.length;
}
