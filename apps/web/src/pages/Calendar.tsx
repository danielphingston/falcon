import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { calendarClient, calendarItems, googleItems, layoutDay, toISODate, weekDays, weekStart, type CalItem, type CalKind } from "@falcon/core";
import { openEditor } from "../components/Editor";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/ui";
import { getAccessToken, hasScope, readAuth } from "../lib/google";
import { useMediaQuery, useSnapshot, useToday } from "../lib/hooks";

type View = "week" | "month";

const KIND_STYLE: Record<CalKind, string> = {
  task: "bg-brand-100 text-brand-800 border-brand-300 dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-800",
  workpaper: "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800",
  irl: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  followup: "bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-800",
  alert: "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
  keydate: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
  google: "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600",
};
const KIND_LABEL: Record<CalKind, string> = {
  task: "Tasks",
  workpaper: "Work papers",
  irl: "IRL due",
  followup: "Follow-ups",
  alert: "Reminders",
  keydate: "Key dates",
  google: "Google Calendar",
};

const HOUR_PX = 48;

function openItem(item: CalItem) {
  if (item.kind === "google") {
    if (item.link) window.open(item.link, "_blank", "noopener");
  } else if (item.table && item.id) openEditor({ table: item.table, id: item.id });
}

/** Google events for the visible range, cached per range for the session. */
const googleCache = new Map<string, CalItem[]>();
function useGoogleItems(from: string, to: string): { items: CalItem[]; state: "off" | "loading" | "ok" | "error" } {
  const auth = useLiveQuery(readAuth, []);
  const key = `${from}|${to}`;
  const [, bump] = useState(0);
  const [state, setState] = useState<"off" | "loading" | "ok" | "error">("off");
  const enabled = hasScope(auth ?? null, "https://www.googleapis.com/auth/calendar.events");
  useEffect(() => {
    if (!enabled) return void setState("off");
    if (googleCache.has(key)) setState("ok");
    else setState("loading");
    let cancelled = false;
    calendarClient(getAccessToken)
      .listRange(from, to)
      .then((events) => {
        googleCache.set(key, googleItems(events));
        if (!cancelled) {
          setState("ok");
          bump((n) => n + 1);
        }
      })
      .catch(() => !cancelled && setState(googleCache.has(key) ? "ok" : "error"));
    return () => {
      cancelled = true;
    };
  }, [enabled, key, from, to]);
  return { items: enabled ? (googleCache.get(key) ?? []) : [], state };
}

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const today = useToday();
  const wide = useMediaQuery("(min-width: 768px)");
  const view = (params.get("view") === "month" ? "month" : "week") as View;
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : today;
  const [dir, setDir] = useState(0);
  const go = (patch: { view?: View; date?: string }, direction = 0) => {
    setDir(direction);
    const next = new URLSearchParams(params);
    if (patch.view) next.set("view", patch.view);
    if (patch.date) next.set("date", patch.date);
    setParams(next, { replace: true });
  };

  const [from, to, days] = useMemo(() => {
    if (view === "week") {
      const d = weekDays(weekStart(anchor));
      return [d[0], d[6], d];
    }
    const first = weekStart(toISODate(startOfMonth(parseISO(anchor))));
    const d = Array.from({ length: 42 }, (_, i) => toISODate(addDays(parseISO(first), i)));
    return [d[0], d[41], d];
  }, [view, anchor]);

  const snap = useSnapshot();
  const google = useGoogleItems(from, to);
  const items = useMemo(() => [...(snap ? calendarItems(snap, from, to) : []), ...google.items], [snap, from, to, google.items]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const i of items) m.set(i.date, [...(m.get(i.date) ?? []), i]);
    return m;
  }, [items]);

  const step = (n: number) =>
    go({ date: view === "week" ? toISODate(addDays(parseISO(anchor), 7 * n)) : toISODate(addMonths(parseISO(anchor), n)) }, n);

  const title =
    view === "month"
      ? format(parseISO(anchor), "MMMM yyyy")
      : `${format(parseISO(from), "d MMM")} – ${format(parseISO(to), "d MMM yyyy")}`;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Calendar</h1>
          <p className="text-sm muted">
            {title}
            {google.state === "loading" && " · loading Google Calendar…"}
            {google.state === "error" && " · couldn't load Google Calendar"}
          </p>
        </div>
        <Segmented id="cal-view" value={view} onChange={(v) => go({ view: v })} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-xl bg-[var(--surface-2)] p-1">
          <button className="btn btn-ghost btn-sm" onClick={() => step(-1)} aria-label={view === "week" ? "Previous week" : "Previous month"}>
            <Icon name="back" size={16} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => go({ date: today }, anchor < today ? 1 : -1)}>
            Today
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => step(1)} aria-label={view === "week" ? "Next week" : "Next month"}>
            <Icon name="chevron" size={16} />
          </button>
        </div>
        {view === "week" ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="muted">Week of</span>
            <input type="date" className="input w-auto py-1.5" value={anchor} onChange={(e) => e.target.value && go({ date: e.target.value }, e.target.value > anchor ? 1 : -1)} aria-label="Pick a week" />
          </label>
        ) : (
          <label className="flex items-center gap-2 text-sm">
            <span className="muted">Month</span>
            <input
              type="month"
              className="input w-auto py-1.5"
              value={anchor.slice(0, 7)}
              onChange={(e) => e.target.value && go({ date: `${e.target.value}-01` }, `${e.target.value}-01` > anchor ? 1 : -1)}
              aria-label="Pick a month"
            />
          </label>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div
          key={`${view}-${from}`}
          custom={dir}
          initial={{ opacity: 0, x: dir * 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -40 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          {view === "month" ? (
            <MonthView days={days} byDay={byDay} today={today} month={anchor.slice(0, 7)} onPickDay={(d) => go({ view: "week", date: d })} />
          ) : wide ? (
            <WeekGrid days={days} byDay={byDay} today={today} />
          ) : (
            <Agenda days={days} byDay={byDay} today={today} />
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs muted">
        {(Object.keys(KIND_LABEL) as CalKind[])
          .filter((k) => k !== "google" || google.state !== "off")
          .map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-sm border ${KIND_STYLE[k]}`} />
              {KIND_LABEL[k]}
            </span>
          ))}
        {google.state === "off" && <span>Connect Google in Settings to see your calendar here too.</span>}
      </div>
    </div>
  );
}

// ---------- Week (hour grid) ----------

function WeekGrid({ days, byDay, today }: { days: string[]; byDay: Map<string, CalItem[]>; today: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    scroller.current?.scrollTo({ top: HOUR_PX * 7.5 });
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="card overflow-hidden">
      {/* Day headers + all-day items */}
      <div className="grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))] border-b border-[var(--border)]">
        <div />
        {days.map((d) => {
          const allDay = (byDay.get(d) ?? []).filter((i) => !i.start);
          return (
            <div key={d} className="min-w-0 border-l border-[var(--border)] p-1.5">
              <button
                className="mb-1 flex w-full items-baseline gap-1.5 rounded-md px-1 text-left hover:bg-[var(--surface-2)]"
                onClick={() => openEditor({ table: "tasks", defaults: { due: d } })}
                title="Add a task on this day"
              >
                <span className="text-xs font-medium uppercase muted">{format(parseISO(d), "EEE")}</span>
                <span className={`grid size-7 place-items-center rounded-full text-sm font-bold ${d === today ? "bg-brand-600 text-white" : ""}`}>{format(parseISO(d), "d")}</span>
              </button>
              <div className="space-y-1">
                {allDay.slice(0, 4).map((i) => (
                  <Chip key={i.key} item={i} />
                ))}
                {allDay.length > 4 && <p className="px-1 text-[11px] muted">+{allDay.length - 4} more</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hour grid */}
      <div ref={scroller} className="relative max-h-[calc(100dvh-20rem)] min-h-80 overflow-y-auto">
        <div className="grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))]" style={{ height: HOUR_PX * 24 }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] muted" style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const timed = layoutDay((byDay.get(d) ?? []).filter((i) => i.start));
            return (
              <div
                key={d}
                className={`relative border-l border-[var(--border)] ${d === today ? "bg-brand-50/40 dark:bg-indigo-950/20" : ""}`}
                style={{ backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR_PX}px)` }}
                onClick={(e) => {
                  // Empty slot: new task at that time (rounded to the half hour).
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                  const mins = Math.min(23 * 60 + 30, Math.max(0, Math.round(((y / HOUR_PX) * 60) / 30) * 30));
                  openEditor({ table: "tasks", defaults: { due: d, dueTime: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` } });
                }}
              >
                {timed.map(({ item, col, cols }) => {
                  const start = Number(item.start!.slice(0, 2)) * 60 + Number(item.start!.slice(3, 5));
                  const height = Math.max(20, ((item.minutes ?? 30) / 60) * HOUR_PX - 2);
                  return (
                    <motion.button
                      key={item.key}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openItem(item);
                      }}
                      className={`absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm hover:z-10 hover:shadow-md ${KIND_STYLE[item.kind]} ${item.done ? "opacity-50 line-through" : ""}`}
                      style={{ top: (start / 60) * HOUR_PX + 1, height, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
                      title={`${item.start} ${item.title}${item.engagement ? ` · ${item.engagement}` : ""}`}
                    >
                      <span className="font-semibold">{item.start}</span> {item.title}
                      {height > 34 && item.engagement && <span className="block truncate opacity-75">{item.engagement}</span>}
                    </motion.button>
                  );
                })}
                {d === today && (
                  <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: (nowMin / 60) * HOUR_PX }}>
                    <span className="-ml-1 size-2 rounded-full bg-rose-500" />
                    <span className="h-px flex-1 bg-rose-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- Week (agenda, phones) ----------

function Agenda({ days, byDay, today }: { days: string[]; byDay: Map<string, CalItem[]>; today: string }) {
  return (
    <div className="space-y-3">
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        return (
          <div key={d} className={`card overflow-hidden ${d === today ? "ring-2 ring-brand-400" : ""}`}>
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
              <p className="text-sm font-semibold">
                {format(parseISO(d), "EEEE d MMM")}
                {d === today && <span className="ml-2 text-xs font-medium text-brand-600">Today</span>}
              </p>
              <button className="btn btn-ghost btn-sm" onClick={() => openEditor({ table: "tasks", defaults: { due: d } })} aria-label={`Add on ${d}`}>
                <Icon name="plus" size={15} />
              </button>
            </div>
            {list.length ? (
              <div className="divide-y divide-[var(--border)]">
                {list.map((i) => (
                  <button key={i.key} onClick={() => openItem(i)} className={`flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--surface-2)] ${i.done ? "opacity-50" : ""}`}>
                    <span className="w-12 shrink-0 text-xs font-semibold tabular-nums muted">{i.start ?? "All day"}</span>
                    <span className={`h-8 w-1 shrink-0 rounded-full border ${KIND_STYLE[i.kind]}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[15px] ${i.done ? "line-through" : ""}`}>{i.title}</span>
                      {(i.engagement || i.minutes) && (
                        <span className="block truncate text-xs muted">
                          {[i.engagement, i.start && i.minutes ? `${i.minutes} min` : null].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-4 py-3 text-sm muted">Nothing scheduled</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Month ----------

function MonthView({ days, byDay, today, month, onPickDay }: { days: string[]; byDay: Map<string, CalItem[]>; today: string; month: string; onPickDay: (d: string) => void }) {
  const wide = useMediaQuery("(min-width: 768px)");
  const max = wide ? 3 : 0;
  const last = toISODate(endOfMonth(parseISO(`${month}-01`)));
  // Drop a trailing week that's entirely next month.
  const shown = days[35] > last ? days.slice(0, 35) : days;
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-[var(--border)] text-center text-[11px] font-semibold uppercase muted">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {shown.map((d) => {
          const list = byDay.get(d) ?? [];
          const inMonth = d.startsWith(month);
          return (
            <button
              key={d}
              onClick={() => onPickDay(d)}
              className={`flex min-h-16 flex-col gap-1 border-b border-l border-[var(--border)] p-1 text-left first:border-l-0 hover:bg-[var(--surface-2)] md:min-h-28 md:p-1.5 [&:nth-child(7n+1)]:border-l-0 ${inMonth ? "" : "opacity-45"}`}
              title={`${format(parseISO(d), "EEEE d MMMM")}: open week`}
            >
              <span className={`grid size-6 place-items-center self-start rounded-full text-xs font-semibold ${d === today ? "bg-brand-600 text-white" : ""}`}>{format(parseISO(d), "d")}</span>
              {wide ? (
                <>
                  {list.slice(0, max).map((i) => (
                    <span key={i.key} className={`truncate rounded border px-1 py-px text-[10.5px] ${KIND_STYLE[i.kind]} ${i.done ? "line-through opacity-60" : ""}`}>
                      {i.start && <b>{i.start} </b>}
                      {i.title}
                    </span>
                  ))}
                  {list.length > max && <span className="px-1 text-[10.5px] muted">+{list.length - max} more</span>}
                </>
              ) : (
                list.length > 0 && (
                  <span className="flex flex-wrap gap-0.5">
                    {list.slice(0, 4).map((i) => (
                      <span key={i.key} className={`size-1.5 rounded-full border ${KIND_STYLE[i.kind]}`} />
                    ))}
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ item }: { item: CalItem }) {
  return (
    <button
      onClick={() => openItem(item)}
      className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] ${KIND_STYLE[item.kind]} ${item.done ? "line-through opacity-60" : ""}`}
      title={`${item.title}${item.engagement ? ` · ${item.engagement}` : ""}`}
    >
      {item.title}
    </button>
  );
}
