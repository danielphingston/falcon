import { useSyncExternalStore } from "react";
import {
  GoogleApiError,
  calendarClient,
  desiredEvents,
  driveAppDataFile,
  loadSnapshot,
  reconcileCalendar,
  syncWithRemote,
  tableNames,
  todayISO,
  type DayEvent,
  type LocalSide,
} from "@falcon/core";
import { db, getSettings, saveSettings, store } from "../db";
import { NeedsAuthError, getAccessToken, hasScope, readAuth } from "./google";

export type SyncState = "off" | "idle" | "syncing" | "error" | "needs-auth";
export interface SyncStatus {
  state: SyncState;
  lastSync?: number;
  message?: string;
  pulled?: number;
}

let status: SyncStatus = { state: "off" };
const listeners = new Set<() => void>();
const setStatus = (s: Partial<SyncStatus>) => {
  status = { ...status, ...s };
  listeners.forEach((l) => l());
};
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

/** The device's IndexedDB as seen by the sync algorithm. */
const local: LocalSide = {
  async snapshot() {
    const tables = Object.fromEntries(await Promise.all(tableNames.map(async (t) => [t, await db.table(t).toArray()]))) as never;
    const settingsUpdatedAt = ((await db.meta.get("settingsUpdatedAt"))?.value as string | undefined) ?? "";
    return { tables, settings: await getSettings(), settingsUpdatedAt };
  },
  async put(table, records) {
    await db.table(table).bulkPut(records);
  },
  async putSettings(patch, updatedAt) {
    await saveSettings(patch, { syncedAt: updatedAt });
  },
};

let running: Promise<void> | null = null;
let again = false;

/** Syncs with Drive and refreshes the calendar. Safe to call often; runs one at a time. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function runOnce() {
  const auth = await readAuth();
  if (!auth) return setStatus({ state: "off", message: undefined });
  setStatus({ state: "syncing" });
  try {
    let pulled = 0;
    if (hasScope(auth, DRIVE_SCOPE)) pulled = (await syncWithRemote(local, driveAppDataFile(getAccessToken))).pulled;
    if (hasScope(auth, CAL_SCOPE)) await syncCalendar();
    setStatus({ state: "idle", lastSync: Date.now(), message: undefined, pulled });
  } catch (e) {
    if (e instanceof NeedsAuthError || (e instanceof GoogleApiError && e.needsAuth)) setStatus({ state: "needs-auth", message: "Google session expired" });
    else setStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

async function syncCalendar() {
  const settings = await getSettings();
  const today = todayISO();
  const cal = calendarClient(getAccessToken);
  if (settings.calendarAlerts || settings.calendarKeyDates || settings.calendarDueDates)
    await reconcileCalendar(cal, desiredEvents(await loadSnapshot(store), settings, today), today);
  const events = await cal.listDay(today);
  await db.meta.put({ key: "calendarToday", value: { date: today, events, fetchedAt: Date.now() } });
}

export async function readCalendarToday(): Promise<DayEvent[] | null> {
  const v = (await db.meta.get("calendarToday"))?.value as { date: string; events: DayEvent[] } | undefined;
  return v && v.date === todayISO() ? v.events : null;
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Debounced sync after local edits. */
export function scheduleSync(delayMs = 4000) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delayMs);
}

/** Starts background syncing: now, when the app comes back into view, and every 5 minutes. */
export function startAutoSync() {
  void readAuth().then((a) => (a ? syncNow() : setStatus({ state: "off" })));
  const onVisible = () => document.visibilityState === "visible" && void syncNow();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);
  const id = setInterval(() => document.visibilityState === "visible" && void syncNow(), 5 * 60_000);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onVisible);
    clearInterval(id);
  };
}

export const markSignedOut = () => setStatus({ state: "off", message: undefined, lastSync: undefined });
