import { tableNames, type Change, type EntityMap, type Settings, type TableName } from "./schema";

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

/** Loads every table, skipping soft-deleted records. */
export async function loadSnapshot(store: Store): Promise<Snapshot> {
  const entries = await Promise.all(
    tableNames.map(async (t) => [t, (await store.list(t)).filter((r) => !r.deleted)] as const),
  );
  return Object.fromEntries(entries) as unknown as Snapshot;
}
