import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  BADGES,
  chaseStreak,
  entitySchemas,
  levelFor,
  newlyEarnedBadges,
  pointEvents,
  ringFor,
  ringStreak,
  type Settings,
  type Snapshot,
  type TableName,
} from "@falcon/core";
import { db } from "../db";
import { celebrate } from "./confetti";
import { toast } from "./toast";

/** Everything the UI shows about progress, derived from a snapshot. */
export function gameView(s: Snapshot, today: string, settings: Settings) {
  const points = pointEvents(s).reduce((a, e) => a + e.points, 0);
  return {
    points,
    level: levelFor(points),
    ring: ringFor(s, today, settings),
    streak: ringStreak(s.days, today, settings),
    chaseStreak: chaseStreak(s.days, today, settings),
  };
}

/** Writes system records (day log, badges) directly: they are not user edits and shouldn't be undoable. */
async function putSystem<T extends "days" | "achievements">(table: T, id: string, fields: Record<string, unknown>) {
  const at = new Date().toISOString();
  const existing = await db.table(table).get(id);
  const record = entitySchemas[table as TableName].parse({
    createdAt: at,
    ...existing,
    ...fields,
    id,
    updatedAt: at,
    deleted: false,
    updatedBy: "app",
  });
  await db.table(table).put(record);
}

// ---------- Level-up overlay state ----------
let levelUp: { name: string; points: number } | null = null;
const listeners = new Set<() => void>();
export function useLevelUp() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => levelUp,
  );
}
export function dismissLevelUp() {
  levelUp = null;
  listeners.forEach((l) => l());
}

/**
 * Watches the data and keeps gamification state current: records today's ring
 * and overdue chases, awards badges, and announces ring closes and level-ups.
 */
export function useGameEngine(snap: Snapshot | undefined, today: string, settings: Settings) {
  const busy = useRef(false);
  useEffect(() => {
    if (!snap || !settings.gamification || busy.current) return;
    busy.current = true;
    void (async () => {
      try {
        const v = gameView(snap, today, settings);
        const rec = snap.days.find((d) => d.date === today);

        // Today's day record.
        const closedNow = v.ring.closed && !rec?.ringClosed;
        if (!rec || rec.ringClosed !== v.ring.closed || rec.overdueChases !== v.ring.overdueChases) {
          await putSystem("days", today, {
            date: today,
            ringClosed: v.ring.closed,
            closedAt: v.ring.closed ? (rec?.closedAt ?? new Date().toISOString()) : rec?.closedAt,
            overdueChases: v.ring.overdueChases,
          });
        }
        if (closedNow && rec) {
          // Only celebrate a close that happened while using the app (rec existed before).
          const streak = v.streak.current + 1;
          toast({ message: `Daily ring closed! 🔥 ${streak}-day streak`, tone: "success" });
          void celebrate("medium");
        }

        // Badges.
        const fresh = newlyEarnedBadges({ s: snap, days: snap.days, bestStreak: v.streak.best }, snap.achievements);
        for (const id of fresh) {
          await putSystem("achievements", id, { badge: id, earnedAt: new Date().toISOString() });
          const b = BADGES.find((x) => x.id === id)!;
          toast({ message: `${b.emoji} Badge unlocked: ${b.name}`, tone: "success", duration: 6000 });
        }
        if (fresh.length) void celebrate("medium");

        // Level-ups (first run just records the current level).
        const seen = (await db.meta.get("level"))?.value as number | undefined;
        if (seen === undefined || v.level.index < seen) await db.meta.put({ key: "level", value: v.level.index });
        else if (v.level.index > seen) {
          await db.meta.put({ key: "level", value: v.level.index });
          levelUp = { name: v.level.name, points: v.points };
          listeners.forEach((l) => l());
          void celebrate("engagement_closed");
        }
      } finally {
        busy.current = false;
      }
    })();
  }, [snap, today, settings]);
}
