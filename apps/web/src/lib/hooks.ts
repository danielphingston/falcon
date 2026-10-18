import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { defaultSettings, loadSnapshot, todayISO, type EntityMap, type Settings, type Snapshot, type TableName } from "@fdd/core";
import { db, getSettings, store } from "../db";

/** Live, non-deleted records of a table. `undefined` while loading. */
export function useTable<T extends TableName>(t: T): EntityMap[T][] | undefined {
  return useLiveQuery(
    async () => ((await db.table(t).toArray()) as EntityMap[T][]).filter((r) => !r.deleted),
    [t],
  );
}

export function useRecord<T extends TableName>(t: T, id: string | undefined): EntityMap[T] | null | undefined {
  return useLiveQuery(async () => {
    if (!id) return null;
    const r = (await db.table(t).get(id)) as EntityMap[T] | undefined;
    return r && !r.deleted ? r : null;
  }, [t, id]);
}

export function useSnapshot(): Snapshot | undefined {
  return useLiveQuery(() => loadSnapshot(store), []);
}

export function useSettings(): Settings {
  return useLiveQuery(getSettings, []) ?? defaultSettings();
}

/** Today's date, refreshed when the day rolls over or the app comes back into view. */
export function useToday(): string {
  const [today, setToday] = useState(todayISO());
  useEffect(() => {
    const tick = () => setToday(todayISO());
    const id = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return today;
}

export function useMediaQuery(q: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return match;
}

export const byId = <T extends { id: string }>(items: T[] | undefined) => new Map((items ?? []).map((i) => [i.id, i]));
