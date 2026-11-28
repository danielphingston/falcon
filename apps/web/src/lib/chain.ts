/**
 * The app's side of the Programme → Workstep → Workpaper chain: queueing the
 * one-time set-up proposal per engagement (build brief v2 A1).
 */
import { loadSnapshot, planMigration, proposeMigration } from "@falcon/core";
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
