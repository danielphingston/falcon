import { z } from "zod";
import { entitySchemas, settingsSchema, tableNames, type AnyEntity, type EntityMap, type Settings, type TableName } from "./schema";

export const BACKUP_VERSION = 1;

export interface Backup {
  app: "fdd-tracker";
  version: number;
  exportedAt: string;
  settings?: Settings;
  tables: { [K in TableName]: EntityMap[K][] };
}

const backupSchema = z.object({
  app: z.literal("fdd-tracker"),
  version: z.number().int(),
  exportedAt: z.string(),
  settings: settingsSchema.optional(),
  tables: z.object(
    Object.fromEntries(tableNames.map((t) => [t, z.array(entitySchemas[t]).default([])])) as {
      [K in TableName]: z.ZodDefault<z.ZodArray<(typeof entitySchemas)[K]>>;
    },
  ),
});

/** Validates an imported/synced file. Throws a readable error if it's not ours or is corrupt. */
export function parseBackup(json: unknown): Backup {
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Not a valid FDD Tracker backup (${issue?.path.join(".") || "root"}: ${issue?.message})`);
  }
  if (parsed.data.version > BACKUP_VERSION)
    throw new Error("This backup is from a newer version of the app. Update the app first.");
  return parsed.data as Backup;
}

/**
 * Per-record last-write-wins merge. Deletes travel as tombstones, so a record
 * deleted on one device stays deleted. Ties keep the local copy.
 */
export function mergeRecords<T extends AnyEntity>(local: T[], remote: T[]): { merged: T[]; changed: T[] } {
  const byId = new Map(local.map((r) => [r.id, r]));
  const changed: T[] = [];
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || r.updatedAt > l.updatedAt) {
      byId.set(r.id, r);
      changed.push(r);
    }
  }
  return { merged: [...byId.values()], changed };
}
