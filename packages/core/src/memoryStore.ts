import { defaultSettings, tableNames, type Change, type EntityMap, type Settings, type TableName } from "./schema";
import type { Store } from "./store";

/** In-memory Store, used by tests and as a base for file-backed stores. */
export class MemoryStore implements Store {
  tables: { [K in TableName]: Map<string, EntityMap[K]> };
  changes: Change[] = [];
  settings: Settings;

  constructor(settings: Partial<Settings> = {}) {
    this.tables = Object.fromEntries(tableNames.map((t) => [t, new Map()])) as MemoryStore["tables"];
    this.settings = { ...defaultSettings(), ...settings };
  }

  async list<T extends TableName>(table: T): Promise<EntityMap[T][]> {
    return [...(this.tables[table] as Map<string, EntityMap[T]>).values()];
  }
  async get<T extends TableName>(table: T, id: string) {
    return (this.tables[table] as Map<string, EntityMap[T]>).get(id);
  }
  async put<T extends TableName>(table: T, record: EntityMap[T]) {
    (this.tables[table] as Map<string, EntityMap[T]>).set(record.id, record);
  }
  async putChange(change: Change) {
    const i = this.changes.findIndex((c) => c.id === change.id);
    if (i >= 0) this.changes[i] = change;
    else this.changes.push(change);
  }
  async listChanges() {
    return [...this.changes];
  }
  async getSettings() {
    return this.settings;
  }
  async transaction<R>(fn: () => Promise<R>) {
    return fn();
  }
}
