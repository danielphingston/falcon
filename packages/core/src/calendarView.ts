/**
 * Everything the in-app calendar shows for a date range, as one flat list:
 * timed tasks and reminders go in the hour grid; due dates and key dates are
 * all-day items.
 */
import { addDays, parseISO } from "date-fns";
import { toISODate } from "./dates";
import type { TableName } from "./schema";
import type { Snapshot } from "./store";

export type CalKind = "task" | "workpaper" | "irl" | "followup" | "alert" | "keydate" | "google";

export interface CalItem {
  /** Unique within the list. */
  key: string;
  kind: CalKind;
  title: string;
  /** YYYY-MM-DD (local). */
  date: string;
  /** HH:mm start for timed items. */
  start?: string;
  /** Minutes long for timed items. */
  minutes?: number;
  done: boolean;
  /** Record to open when tapped (not for Google events). */
  table?: TableName;
  id?: string;
  engagement?: string;
  /** Link for Google events. */
  link?: string;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** App items between `from` and `to` (inclusive, YYYY-MM-DD). */
export function calendarItems(s: Snapshot, from: string, to: string): CalItem[] {
  const inRange = (d?: string) => !!d && d >= from && d <= to;
  const eng = new Map(s.engagements.map((e) => [e.id, e]));
  const live = (id?: string) => !id || eng.get(id)?.status !== "closed";
  const out: CalItem[] = [];

  for (const t of s.tasks)
    if (inRange(t.due) && live(t.engagementId))
      out.push({
        key: `task:${t.id}`,
        kind: "task",
        title: t.title,
        date: t.due!,
        start: t.dueTime,
        minutes: t.dueTime ? (t.durationMinutes ?? 30) : undefined,
        done: t.status === "done",
        table: "tasks",
        id: t.id,
        engagement: t.engagementId ? eng.get(t.engagementId)?.name : undefined,
      });

  for (const w of s.workpapers)
    if (inRange(w.due) && live(w.engagementId))
      out.push({ key: `wp:${w.id}`, kind: "workpaper", title: `${w.ref} ${w.title}`, date: w.due!, done: w.status === "final" || w.status === "cleared", table: "workpapers", id: w.id, engagement: eng.get(w.engagementId)?.name });

  for (const r of s.infoRequests)
    if (inRange(r.due) && live(r.engagementId))
      out.push({ key: `irl:${r.id}`, kind: "irl", title: `IRL: ${r.description}`, date: r.due!, done: r.status === "received" || r.status === "na", table: "infoRequests", id: r.id, engagement: eng.get(r.engagementId)?.name });

  for (const f of s.followUps)
    if (inRange(f.due) && live(f.engagementId))
      out.push({ key: `fu:${f.id}`, kind: "followup", title: `Waiting: ${f.about}`, date: f.due!, done: f.status === "done", table: "followUps", id: f.id, engagement: f.engagementId ? eng.get(f.engagementId)?.name : undefined });

  for (const a of s.alerts) {
    const at = new Date(a.fireAt);
    const date = toISODate(at);
    if (inRange(date)) out.push({ key: `alert:${a.id}`, kind: "alert", title: a.title, date, start: hhmm(at), minutes: 15, done: a.fired, table: "alerts", id: a.id });
  }

  const keyDates = [
    ["kickoff", "Kick-off"],
    ["dataRoom", "Data room"],
    ["draftReport", "Draft report"],
    ["finalReport", "Final report"],
  ] as const;
  for (const e of s.engagements)
    if (e.status !== "closed")
      for (const [field, label] of keyDates)
        if (inRange(e[field])) out.push({ key: `kd:${e.id}:${field}`, kind: "keydate", title: `${e.name}: ${label}`, date: e[field]!, done: false, table: "engagements", id: e.id, engagement: e.name });

  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? "") || a.title.localeCompare(b.title));
}

/** Google Calendar events (from listRange) as calendar items, split per day for multi-day events. */
export function googleItems(events: { id: string; summary: string; allDay: boolean; start: string; end: string; link?: string; ours: boolean }[]): CalItem[] {
  const out: CalItem[] = [];
  for (const e of events) {
    if (e.ours) continue; // the app's own events are shown from local data
    if (e.allDay) {
      // All-day end dates are exclusive.
      for (let d = parseISO(e.start); toISODate(d) < e.end; d = addDays(d, 1))
        out.push({ key: `g:${e.id}:${toISODate(d)}`, kind: "google", title: e.summary, date: toISODate(d), done: false, link: e.link });
    } else {
      const s = new Date(e.start);
      const en = new Date(e.end);
      out.push({ key: `g:${e.id}`, kind: "google", title: e.summary, date: toISODate(s), start: hhmm(s), minutes: Math.max(15, Math.round((en.getTime() - s.getTime()) / 60000)), done: false, link: e.link });
    }
  }
  return out;
}

export interface Placed<T> {
  item: T;
  /** Column within overlapping group, and how many columns the group has. */
  col: number;
  cols: number;
}

/** Lays out one day's timed items side by side where they overlap. */
export function layoutDay<T extends { start?: string; minutes?: number }>(items: T[]): Placed<T>[] {
  const toMin = (t?: string) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : 0);
  const sorted = [...items].sort((a, b) => toMin(a.start) - toMin(b.start));
  const placed: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let groupEnd = -1;
  const colEnds: number[] = [];
  const flush = () => {
    const cols = Math.max(1, ...group.map((p) => p.col + 1));
    group.forEach((p) => (p.cols = cols));
    group = [];
    colEnds.length = 0;
  };
  for (const item of sorted) {
    const s = toMin(item.start);
    const e = s + (item.minutes ?? 30);
    if (s >= groupEnd) flush();
    let col = colEnds.findIndex((end) => end <= s);
    if (col < 0) col = colEnds.length;
    colEnds[col] = e;
    const p = { item, col, cols: 1 };
    group.push(p);
    placed.push(p);
    groupEnd = Math.max(groupEnd, e);
  }
  flush();
  return placed;
}
