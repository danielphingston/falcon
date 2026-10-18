import Dexie, { type Table } from "dexie";
import {
  settingsSchema,
  syncedSettingsKeys,
  tableNames,
  type Change,
  type EntityMap,
  type Settings,
  type Store,
  type TableName,
} from "@fdd/core";

type Tables = { [K in TableName]: Table<EntityMap[K], string> };

class FddDB extends Dexie {
  changes!: Table<Change, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super("fdd-tracker");
    this.version(1).stores({
      people: "id, role",
      engagements: "id, status",
      workstreams: "id, engagementId",
      tasks: "id, engagementId, status, due",
      workpapers: "id, engagementId, status",
      reviewPoints: "id, workpaperId, engagementId, status",
      infoRequests: "id, engagementId, status",
      followUps: "id, personId, status",
      alerts: "id, fireAt",
      changes: "id, seq, batchId",
      meta: "key",
    });
    this.version(2).stores({
      timeEntries: "id, date, engagementId",
      days: "id, date",
      achievements: "id, badge",
    });
  }
}

export const db = new FddDB() as FddDB & Tables;
const table = <T extends TableName>(t: T) => db.table(t) as unknown as Table<EntityMap[T], string>;

export const store: Store = {
  list: (t) => table(t).toArray(),
  get: (t, id) => table(t).get(id),
  put: async (t, r) => {
    await table(t).put(r);
  },
  putChange: async (c) => {
    await db.changes.put(c);
  },
  listChanges: () => db.changes.toArray(),
  getSettings: getSettings,
  // The scope must be a native async function: Dexie only keeps its zone alive
  // across native `await`s inside nested async calls when it is.
  transaction: (fn) =>
    db.transaction("rw", [...tableNames.map((t) => db.table(t)), db.changes, db.meta], async () => await fn()),
};

export async function getSettings(): Promise<Settings> {
  const row = await db.meta.get("settings");
  const parsed = settingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : settingsSchema.parse({});
}

/**
 * Saves settings. Changing a synced setting stamps "settingsUpdatedAt" so it
 * wins on the next sync; settings arriving from sync pass their own stamp.
 */
export async function saveSettings(patch: Partial<Settings>, opts: { syncedAt?: string } = {}) {
  const next = settingsSchema.parse({ ...(await getSettings()), ...patch });
  await db.meta.put({ key: "settings", value: next });
  // Note: keep syncedSettingsKeys out of an `as` cast; the dev transform elided the import when it was.
  const synced: readonly string[] = syncedSettingsKeys;
  const touchesSynced = Object.keys(patch).some((k) => synced.includes(k));
  if (opts.syncedAt) await db.meta.put({ key: "settingsUpdatedAt", value: opts.syncedAt });
  else if (touchesSynced) await db.meta.put({ key: "settingsUpdatedAt", value: new Date().toISOString() });
  return next;
}

/** Ask the browser not to evict our data (important on iPhone). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}
