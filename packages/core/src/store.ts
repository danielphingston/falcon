import { tableNames, type Change, type EntityMap, type Settings, type TableName } from "./schema";
import { applyDerivedStepStatus } from "./chain";

/**
 * Storage the actions and AI tools run against. The PWA implements it on
 * IndexedDB (Dexie); the connector will implement it on the Drive sync file.
 */
export interface Store {
  /** All records in a table, including soft-deleted ones. */
  list<T extends TableName>(table: T): Promise<EntityMap[T][]>;
  get<T extends TableName>(table: T, id: string): Promise<EntityMap[T] | undefined>;
  put<T extends TableName>(table: T, record: EntityMap[T]): Promise<void>;
  putChange(change: Change): Promise<void>;
  listChanges(): Promise<Change[]>;
  getSettings(): Promise<Settings>;
  /** Runs `fn` atomically where the backend supports it. */
  transaction<R>(fn: () => Promise<R>): Promise<R>;
}

export type Snapshot = {
  [K in TableName]: EntityMap[K][];
};

/**
 * Loads every table, skipping soft-deleted records. Steps linked to a
 * workpaper read with the workpaper's status (one status per piece of work);
 * `raw` keeps the stored records as they are (for building proposals).
 */
export async function loadSnapshot(store: Store, opts: { raw?: boolean } = {}): Promise<Snapshot> {
  const entries = await Promise.all(
    tableNames.map(async (t) => [t, (await store.list(t)).filter((r) => !r.deleted)] as const),
  );
  const snap = Object.fromEntries(entries) as unknown as Snapshot;
  if (!opts.raw) applyDerivedStepStatus(snap);
  return snap;
}
