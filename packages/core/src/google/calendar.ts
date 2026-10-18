import { addDays, parseISO } from "date-fns";
import { toISODate } from "../dates";
import type { Settings } from "../schema";
import type { Snapshot } from "../store";
import { GoogleApiError, gfetch, type TokenGetter } from "./http";

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** An event the app manages, identified by a stable key stored on the event. */
export interface AppEvent {
  key: string;
  summary: string;
  allDay: boolean;
  /** YYYY-MM-DD for all-day events, ISO timestamp otherwise. */
  start: string;
  end: string;
  /** Popup reminder this many minutes before the start; undefined = no reminder. */
  reminderMinutes?: number;
}

export interface ExistingEvent extends AppEvent {
  id: string;
}

const DESCRIPTION = "Added by FDD Tracker. Changes made here are overwritten by the app.";
const KEY_DATES = [
  ["kickoff", "Kick-off"],
  ["dataRoom", "Data room opens"],
  ["draftReport", "Draft report"],
  ["finalReport", "Final report"],
] as const;

/** How far around today the app manages events. */
export const calendarWindow = (today: string) => ({
  from: toISODate(addDays(parseISO(today), -7)),
  to: toISODate(addDays(parseISO(today), 180)),
});

const allDay = (key: string, summary: string, date: string, reminderMinutes?: number): AppEvent => ({
  key,
  summary,
  allDay: true,
  start: date,
  end: toISODate(addDays(parseISO(date), 1)),
  reminderMinutes,
});

/** Calendar events the app should have right now, based on the data and settings. */
export function desiredEvents(
  s: Snapshot,
  settings: Pick<Settings, "calendarAlerts" | "calendarKeyDates" | "calendarDueDates">,
  today: string,
): AppEvent[] {
  const { from, to } = calendarWindow(today);
  const inWindow = (d?: string) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;
  const out: AppEvent[] = [];

  if (settings.calendarAlerts)
    for (const a of s.alerts)
      if (inWindow(a.fireAt) && !(a.fired && a.fireAt.slice(0, 10) < today))
        out.push({
          key: `alert:${a.id}`,
          summary: `🔔 ${a.title}`,
          allDay: false,
          start: a.fireAt,
          end: new Date(new Date(a.fireAt).getTime() + 15 * 60_000).toISOString(),
          reminderMinutes: 0,
        });

  if (settings.calendarKeyDates)
    for (const e of s.engagements) {
      if (e.status === "closed") continue;
      // All-day reminders count from midnight: 900 min ≈ 9am the day before.
      for (const [field, label] of KEY_DATES)
        if (inWindow(e[field])) out.push(allDay(`eng:${e.id}:${field}`, `📑 ${e.name}: ${label}`, e[field]!, 900));
    }

  const live = new Set(s.engagements.filter((e) => e.status !== "closed").map((e) => e.id));
  const ok = (eid?: string) => !eid || live.has(eid);

  // Tasks with a time are appointments: they go on the calendar at that time
  // whenever reminders are synced, even if all-day due dates are off.
  if (settings.calendarAlerts || settings.calendarDueDates)
    for (const t of s.tasks)
      if (t.status !== "done" && t.dueTime && inWindow(t.due) && ok(t.engagementId)) {
        const start = new Date(`${t.due}T${t.dueTime}:00`);
        out.push({
          key: `task:${t.id}`,
          summary: t.title,
          allDay: false,
          start: start.toISOString(),
          end: new Date(start.getTime() + (t.durationMinutes ?? 30) * 60_000).toISOString(),
          reminderMinutes: 10,
        });
      }

  if (settings.calendarDueDates) {
    for (const t of s.tasks)
      if (t.status !== "done" && !t.dueTime && inWindow(t.due) && ok(t.engagementId)) out.push(allDay(`task:${t.id}`, `✅ ${t.title}`, t.due!));
    for (const w of s.workpapers)
      if (w.status !== "final" && w.status !== "cleared" && inWindow(w.due) && ok(w.engagementId)) out.push(allDay(`wp:${w.id}`, `📄 ${w.ref} ${w.title}`, w.due!));
    for (const f of s.followUps) if (f.status === "waiting" && inWindow(f.due) && ok(f.engagementId)) out.push(allDay(`fu:${f.id}`, `⏳ ${f.about}`, f.due!));
  }
  return out;
}

const same = (a: AppEvent, b: AppEvent) =>
  a.summary === b.summary &&
  a.allDay === b.allDay &&
  (a.allDay ? a.start === b.start && a.end === b.end : Date.parse(a.start) === Date.parse(b.start) && Date.parse(a.end) === Date.parse(b.end)) &&
  a.reminderMinutes === b.reminderMinutes;

/** Diff between what the calendar has and what it should have. */
export function planCalendar(desired: AppEvent[], existing: ExistingEvent[]) {
  const byKey = new Map<string, ExistingEvent[]>();
  for (const e of existing) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  const insert: AppEvent[] = [];
  const update: { id: string; event: AppEvent }[] = [];
  const remove: string[] = [];
  const wanted = new Set(desired.map((d) => d.key));
  for (const d of desired) {
    const [first, ...dupes] = byKey.get(d.key) ?? [];
    if (!first) insert.push(d);
    else if (!same(d, first)) update.push({ id: first.id, event: d });
    remove.push(...dupes.map((x) => x.id));
  }
  for (const e of existing) if (!wanted.has(e.key)) remove.push(e.id);
  return { insert, update, remove };
}

// ---------- REST client ----------

interface GEvent {
  id: string;
  summary?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  reminders?: { useDefault?: boolean; overrides?: { method: string; minutes: number }[] };
  extendedProperties?: { private?: Record<string, string> };
  htmlLink?: string;
  status?: string;
}

/** An event from the user's calendar, for showing on Today. */
export interface DayEvent {
  id: string;
  summary: string;
  allDay: boolean;
  start: string;
  end: string;
  link?: string;
  /** True for events this app created. */
  ours: boolean;
}

const toBody = (e: AppEvent, extra: Record<string, string>) => ({
  summary: e.summary,
  description: DESCRIPTION,
  start: e.allDay ? { date: e.start } : { dateTime: e.start },
  end: e.allDay ? { date: e.end } : { dateTime: e.end },
  transparency: e.allDay ? "transparent" : "opaque",
  reminders: { useDefault: false, overrides: e.reminderMinutes === undefined ? [] : [{ method: "popup", minutes: e.reminderMinutes }] },
  extendedProperties: { private: extra },
});

const fromG = (g: GEvent): ExistingEvent => ({
  id: g.id,
  key: g.extendedProperties?.private?.fddKey ?? "",
  summary: g.summary ?? "",
  allDay: !!g.start.date,
  start: g.start.date ?? g.start.dateTime ?? "",
  end: g.end.date ?? g.end.dateTime ?? "",
  reminderMinutes: g.reminders?.overrides?.find((o) => o.method === "popup")?.minutes,
});

export function calendarClient(getToken: TokenGetter) {
  async function list(params: Record<string, string>): Promise<GEvent[]> {
    const out: GEvent[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ singleEvents: "true", maxResults: "250", ...params, ...(pageToken ? { pageToken } : {}) });
      const res = await gfetch(getToken, `${API}?${q}`);
      const body = (await res.json()) as { items?: GEvent[]; nextPageToken?: string };
      out.push(...(body.items ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out.filter((e) => e.status !== "cancelled");
  }

  return {
    /** Events this app manages within a date range. */
    async listAppEvents(from: string, to: string): Promise<ExistingEvent[]> {
      const items = await list({
        privateExtendedProperty: "fddApp=1",
        timeMin: new Date(`${from}T00:00:00`).toISOString(),
        timeMax: new Date(`${to}T23:59:59`).toISOString(),
      });
      return items.map(fromG).filter((e) => e.key);
    },

    /** Everything on the primary calendar for one local day. */
    async listDay(date: string): Promise<DayEvent[]> {
      const items = await list({
        orderBy: "startTime",
        timeMin: new Date(`${date}T00:00:00`).toISOString(),
        timeMax: new Date(`${date}T23:59:59`).toISOString(),
      });
      return items.map((g) => ({
        id: g.id,
        summary: g.summary ?? "(no title)",
        allDay: !!g.start.date,
        start: g.start.date ?? g.start.dateTime ?? "",
        end: g.end.date ?? g.end.dateTime ?? "",
        link: g.htmlLink,
        ours: g.extendedProperties?.private?.fddApp === "1" || g.extendedProperties?.private?.fddFocus === "1",
      }));
    },

    async insert(e: AppEvent) {
      await gfetch(getToken, API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toBody(e, { fddApp: "1", fddKey: e.key })) });
    },
    async update(id: string, e: AppEvent) {
      await gfetch(getToken, `${API}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toBody(e, { fddApp: "1", fddKey: e.key })) });
    },
    async remove(id: string) {
      try {
        await gfetch(getToken, `${API}/${id}`, { method: "DELETE" });
      } catch (err) {
        // Already gone is fine.
        if (!(err instanceof GoogleApiError && (err.status === 404 || err.status === 410))) throw err;
      }
    },

    /** A focus block the user schedules; not reconciled, so it stays even if the app changes. */
    async addFocusBlock(start: Date, minutes: number, label: string) {
      const e: AppEvent = {
        key: "",
        summary: `🎧 Focus: ${label}`,
        allDay: false,
        start: start.toISOString(),
        end: new Date(start.getTime() + minutes * 60_000).toISOString(),
        reminderMinutes: 5,
      };
      const res = await gfetch(getToken, API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toBody(e, { fddFocus: "1" })) });
      return ((await res.json()) as GEvent).htmlLink;
    },
  };
}

export type CalendarClient = ReturnType<typeof calendarClient>;

/** Brings the calendar in line with the data. Returns how many events changed. */
export async function reconcileCalendar(cal: CalendarClient, desired: AppEvent[], today: string) {
  const { from, to } = calendarWindow(today);
  const plan = planCalendar(desired, await cal.listAppEvents(from, to));
  for (const e of plan.insert) await cal.insert(e);
  for (const u of plan.update) await cal.update(u.id, u.event);
  for (const id of plan.remove) await cal.remove(id);
  return plan.insert.length + plan.update.length + plan.remove.length;
}
