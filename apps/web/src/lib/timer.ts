import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { create, todayISO } from "@falcon/core";
import { db } from "../db";
import { act } from "./act";

/** Persisted in IndexedDB so a running focus session survives reloads and app restarts. */
export interface TimerState {
  startedAt: number;
  durationMin: number;
  /** When paused, the moment it was paused. */
  pausedAt?: number;
  /** Total milliseconds spent paused so far. */
  pausedMs: number;
  label: string;
  taskId?: string;
  engagementId?: string;
}

const KEY = "timer";
/** A stopped session counts as a focus block if it ran at least this long (or its full length). */
const MIN_FOCUS_MIN = 20;

export const elapsedMs = (t: TimerState, now = Date.now()) => (t.pausedAt ?? now) - t.startedAt - t.pausedMs;
export const remainingMs = (t: TimerState, now = Date.now()) => Math.max(0, t.durationMin * 60_000 - elapsedMs(t, now));

async function save(t: TimerState | null) {
  if (t) await db.meta.put({ key: KEY, value: t });
  else await db.meta.delete(KEY);
}
export const readTimer = async () => ((await db.meta.get(KEY))?.value as TimerState | undefined) ?? null;

export async function startTimer(opts: Omit<TimerState, "startedAt" | "pausedMs" | "pausedAt">) {
  await save({ ...opts, startedAt: Date.now(), pausedMs: 0 });
}

export async function pauseTimer() {
  const t = await readTimer();
  if (t && !t.pausedAt) await save({ ...t, pausedAt: Date.now() });
}

export async function resumeTimer() {
  const t = await readTimer();
  if (t?.pausedAt) await save({ ...t, pausedMs: t.pausedMs + (Date.now() - t.pausedAt), pausedAt: undefined });
}

/** Ends the session. `log` records the time worked; the session is a focus block if long enough. */
export async function stopTimer(log: boolean) {
  const t = await readTimer();
  if (!t) return null;
  await save(null);
  if (!log) return null;
  const minutes = Math.round(elapsedMs(t) / 60_000);
  if (minutes < 1) return null;
  const focus = minutes >= Math.min(t.durationMin, MIN_FOCUS_MIN);
  return logSession(t, minutes, focus, todayISO());
}

let completing = false;
/** Called when the countdown reaches zero (possibly while the app was closed). Safe to call repeatedly. */
export async function completeTimer() {
  if (completing) return null;
  completing = true;
  try {
    const t = await readTimer();
    if (!t || t.pausedAt || remainingMs(t) > 0) return null;
    await save(null);
    const endedAt = t.startedAt + t.pausedMs + t.durationMin * 60_000;
    return await logSession(t, t.durationMin, true, todayISO(new Date(endedAt)));
  } finally {
    completing = false;
  }
}

async function logSession(t: TimerState, minutes: number, focus: boolean, date: string) {
  return act(focus ? `Focus session logged · ${minutes} min` : `${minutes} min logged`, (ctx) =>
    create(ctx, "timeEntries", {
      date,
      minutes,
      engagementId: t.engagementId,
      taskId: t.taskId,
      note: t.label || undefined,
      source: "timer",
      focus,
    }),
  );
}

/** The running timer (or null) plus a value that ticks every second while it runs. */
export function useTimer() {
  const timer = useLiveQuery(readTimer, []) ?? null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!timer || timer.pausedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);
  return { timer, now };
}

export const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
