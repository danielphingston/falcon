import { BACKUP_VERSION, mergeRecords, parseBackup, type Backup } from "../merge";
import { syncedSettingsKeys, tableNames, type EntityMap, type Settings, type TableName } from "../schema";
import type { RemoteFile } from "./drive";

/** What the sync needs from the device's local database. */
export interface LocalSide {
  /** Every record (tombstones included), plus synced settings and when they last changed. */
  snapshot(): Promise<{ tables: Backup["tables"]; settings: Settings; settingsUpdatedAt: string }>;
  /** Store records that came from another device. */
  put<T extends TableName>(table: T, records: EntityMap[T][]): Promise<void>;
  /** Store synced settings that came from another device. */
  putSettings(patch: Partial<Settings>, updatedAt: string): Promise<void>;
}

export interface SyncResult {
  /** Records received from other devices. */
  pulled: number;
  /** Whether this device uploaded a new version. */
  pushed: boolean;
  version: string | null;
}

const pick = (s: Settings) => Object.fromEntries(syncedSettingsKeys.map((k) => [k, s[k]])) as Partial<Settings>;

/**
 * Two-way sync with one remote JSON file: download, merge per record (newest
 * wins, deletes travel as tombstones), store what's new locally, then upload
 * if this device has anything the remote lacks. If another device uploads in
 * between, start over (up to 3 times).
 */
export async function syncWithRemote(local: LocalSide, remote: RemoteFile, now: () => Date = () => new Date()): Promise<SyncResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { content, version } = await remote.read();
    const theirs = content ? parseBackup(content) : null;
    const mine = await local.snapshot();
    let pulled = 0;
    let needPush = !theirs;
    const tables = {} as Backup["tables"];

    for (const t of tableNames) {
      const remoteRecs = (theirs?.tables[t] ?? []) as EntityMap[typeof t][];
      const { merged, changed } = mergeRecords(mine.tables[t] as EntityMap[typeof t][], remoteRecs);
      if (changed.length) {
        await local.put(t, changed);
        pulled += changed.length;
      }
      // Push if any merged record is missing remotely or newer than the remote copy.
      const remoteById = new Map(remoteRecs.map((r) => [r.id, r.updatedAt]));
      if (!needPush) needPush = merged.some((r) => (remoteById.get(r.id) ?? "") < r.updatedAt);
      (tables as Record<string, unknown>)[t] = merged;
    }

    let settings = mine.settings;
    let settingsUpdatedAt = mine.settingsUpdatedAt;
    if (theirs?.settings && (theirs.settingsUpdatedAt ?? "") > mine.settingsUpdatedAt) {
      await local.putSettings(pick(theirs.settings), theirs.settingsUpdatedAt!);
      settings = { ...mine.settings, ...pick(theirs.settings) };
      settingsUpdatedAt = theirs.settingsUpdatedAt!;
    } else if (mine.settingsUpdatedAt > (theirs?.settingsUpdatedAt ?? "")) needPush = true;

    if (!needPush) return { pulled, pushed: false, version };

    // Someone else wrote since we downloaded: merge again from the top.
    if ((await remote.version()) !== version) continue;

    const backup: Backup = {
      app: "fdd-tracker",
      version: BACKUP_VERSION,
      exportedAt: now().toISOString(),
      settings: { ...settings, googleClientId: "" },
      settingsUpdatedAt,
      tables,
    };
    const written = await remote.write(backup);
    return { pulled, pushed: true, version: written.version };
  }
  throw new Error("Sync kept conflicting with another device. Try again in a moment.");
}
