import { format, parseISO } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { calendarClient, formatHours, formatMinutes, shiftWeek, timesheet, timesheetText, weekStart } from "@falcon/core";
import { openEditor } from "../components/Editor";
import { toLocalInput } from "../components/forms";
import { Icon } from "../components/Icon";
import { AnimatedList, EmptyState, ListItem, Section, Sheet } from "../components/ui";
import { NeedsAuthError, getAccessToken, hasScope, readAuth } from "../lib/google";
import { syncNow } from "../lib/sync";
import { byId, useSettings, useTable, useToday } from "../lib/hooks";
import { mmss, pauseTimer, remainingMs, resumeTimer, startTimer, stopTimer, useTimer } from "../lib/timer";
import { toast } from "../lib/toast";

export function TimePage() {
  const today = useToday();
  const entries = useTable("timeEntries") ?? [];
  const engagements = useTable("engagements") ?? [];
  const tasks = byId(useTable("tasks"));
  const engById = byId(engagements);
  const settings = useSettings();
  const [week, setWeek] = useState(() => weekStart(today));

  const todays = entries.filter((e) => e.date === today).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const todayMin = todays.reduce((a, e) => a + e.minutes, 0);
  const sheet = timesheet(entries, engagements, week, settings.timeIncrement);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(timesheetText(sheet));
      toast({ message: "Timesheet copied. Paste into Excel or your timesheet tool", tone: "success" });
    } catch {
      toast({ message: "Couldn't access the clipboard", tone: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Time & focus</h1>
        <p className="text-sm muted">{formatMinutes(todayMin)} logged today</p>
      </header>

      <FocusTimer />
      <FocusBlock />

      <Section
        title="Today's log"
        icon="clock"
        count={todays.length}
        action={
          <button className="btn btn-ghost btn-sm text-brand-600" onClick={() => openEditor({ table: "timeEntries", defaults: { date: today } })}>
            <Icon name="plus" size={14} /> Log time
          </button>
        }
      >
        {todays.length ? (
          <AnimatedList>
            {todays.map((e) => (
              <ListItem key={e.id} id={e.id} onClick={() => openEditor({ table: "timeEntries", id: e.id })}>
                <span className={`grid size-9 shrink-0 place-items-center rounded-xl text-sm ${e.focus ? "bg-brand-50 text-brand-600 dark:bg-indigo-950 dark:text-indigo-300" : "bg-[var(--surface-2)]"}`}>
                  {e.focus ? "🎧" : <Icon name="clock" size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px]">{e.note || (e.taskId && tasks.get(e.taskId)?.title) || (e.focus ? "Focus session" : "Time entry")}</p>
                  <p className="text-xs muted">{(e.engagementId && engById.get(e.engagementId)?.name) || "Other / admin"}</p>
                </div>
                <span className="text-sm font-semibold">{formatMinutes(e.minutes)}</span>
              </ListItem>
            ))}
          </AnimatedList>
        ) : (
          <EmptyState icon="clock" title="Nothing logged yet today" hint="Run a focus session above, or log time manually." />
        )}
      </Section>

      <Section
        title="Timesheet"
        icon="today"
        action={
          <div className="flex items-center gap-1">
            <button className="btn btn-ghost btn-sm" onClick={() => setWeek(shiftWeek(week, -1))} aria-label="Previous week">
              <Icon name="back" size={16} />
            </button>
            <span className="text-sm font-medium">
              {format(parseISO(sheet.days[0]), "d MMM")}–{format(parseISO(sheet.days[6]), "d MMM")}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setWeek(shiftWeek(week, 1))} aria-label="Next week">
              <Icon name="chevron" size={16} />
            </button>
          </div>
        }
      >
        <motion.div key={week} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="card overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs muted">
                <th className="px-3 py-2 text-left font-medium">Engagement</th>
                {sheet.days.map((d) => (
                  <th key={d} className={`px-2 py-2 text-right font-medium ${d === today ? "text-brand-600" : ""}`}>
                    {format(parseISO(d), "EEE d")}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((r) => (
                <tr key={r.engagementId ?? "other"} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-medium">{r.name}</p>
                    {r.code && <p className="font-mono text-[11px] muted">{r.code}</p>}
                  </td>
                  {r.hours.map((h, i) => (
                    <td key={i} className={`px-2 py-2 text-right tabular-nums ${h ? "" : "muted"}`}>
                      {h ? formatHours(h) : "–"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatHours(r.total)}</td>
                </tr>
              ))}
              {sheet.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center muted">
                    No time logged this week
                  </td>
                </tr>
              )}
            </tbody>
            {sheet.rows.length > 0 && (
              <tfoot>
                <tr className="bg-[var(--surface-2)] font-semibold">
                  <td className="px-3 py-2">Total</td>
                  {sheet.dayTotals.map((h, i) => (
                    <td key={i} className="px-2 py-2 text-right tabular-nums">
                      {h ? formatHours(h) : "–"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">{formatHours(sheet.total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </motion.div>
        <div className="flex justify-between gap-2 px-1">
          <p className="text-xs muted">Rounded to {settings.timeIncrement}h. Timesheet codes come from each engagement.</p>
          <button className="btn btn-soft btn-sm shrink-0" onClick={copy} disabled={!sheet.rows.length}>
            <Icon name="copy" size={14} /> Copy for timesheet
          </button>
        </div>
      </Section>
    </div>
  );
}

/** Reserve deep-work time in Google Calendar so meetings don't eat the day. */
function FocusBlock() {
  const auth = useLiveQuery(readAuth, []);
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const next = new Date();
  next.setMinutes(next.getMinutes() < 30 ? 30 : 60, 0, 0);
  const [when, setWhen] = useState(() => toLocalInput(next.toISOString()));
  const [minutes, setMinutes] = useState(Math.max(60, settings.focusMinutes));
  const [label, setLabel] = useState("");
  if (!hasScope(auth ?? null, "https://www.googleapis.com/auth/calendar.events")) return null;

  const save = async () => {
    setBusy(true);
    try {
      const link = await calendarClient(getAccessToken).addFocusBlock(new Date(when), minutes, label.trim() || "Deep work");
      toast({ message: "Focus block added to your calendar", tone: "success", action: link ? { label: "Open", run: () => window.open(link, "_blank") } : undefined });
      setOpen(false);
      setLabel("");
      void syncNow();
    } catch (e) {
      toast({ message: e instanceof NeedsAuthError ? "Reconnect Google in Settings first" : e instanceof Error ? e.message : "Couldn't add the block", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn btn-soft w-full" onClick={() => setOpen(true)}>
        <Icon name="calendar" size={16} /> Block focus time in Google Calendar
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Block focus time"
        footer={
          <>
            <div className="flex-1" />
            <button className="btn btn-soft" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? "Adding…" : "Add to calendar"}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium muted">What for</span>
            <input className="input" placeholder="e.g. Falcon QoE bridge" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium muted">Starts</span>
            <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            {[60, 90, 120, 180].map((m) => (
              <button key={m} onClick={() => setMinutes(m)} className={`rounded-full border px-3 py-1 text-sm font-semibold ${minutes === m ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-indigo-950 dark:text-indigo-200" : "border-[var(--border)]"}`}>
                {m / 60}h
              </button>
            ))}
          </div>
          <p className="text-xs muted">Shows as busy, with a reminder 5 minutes before.</p>
        </div>
      </Sheet>
    </>
  );
}

function FocusTimer() {
  const { timer, now } = useTimer();
  const settings = useSettings();
  const engagements = (useTable("engagements") ?? []).filter((e) => e.status !== "closed");
  const tasks = (useTable("tasks") ?? []).filter((t) => t.status !== "done");
  const [taskId, setTaskId] = useState("");
  const [engagementId, setEngagementId] = useState("");
  const [minutes, setMinutes] = useState(settings.focusMinutes);
  const [label, setLabel] = useState("");

  const total = (timer?.durationMin ?? minutes) * 60_000;
  const left = timer ? remainingMs(timer, now) : total;
  const ratio = timer ? 1 - left / total : 0;
  const R = 88;
  const C = 2 * Math.PI * R;

  const start = () => {
    const task = tasks.find((t) => t.id === taskId);
    void startTimer({
      durationMin: minutes,
      taskId: task?.id,
      engagementId: engagementId || task?.engagementId,
      label: label.trim() || task?.title || "",
    });
  };

  return (
    <div className="card flex flex-col items-center gap-5 p-6 md:flex-row md:items-center md:gap-8">
      <div className="relative grid size-52 shrink-0 place-items-center">
        <svg viewBox="0 0 200 200" className="absolute inset-0 -rotate-90">
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="12" />
          <motion.circle
            cx="100"
            cy="100"
            r={R}
            fill="none"
            stroke="url(#focus-grad)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={C}
            animate={{ strokeDashoffset: C * (1 - ratio) }}
            transition={{ duration: 0.9, ease: "linear" }}
          />
          <defs>
            <linearGradient id="focus-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#818cf8" />
              <stop offset="1" stopColor="#4f46e5" />
            </linearGradient>
          </defs>
        </svg>
        <div className="text-center">
          <motion.p key={timer ? "run" : "idle"} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-4xl font-bold tabular-nums tracking-tight">
            {mmss(left)}
          </motion.p>
          <p className="mt-1 text-xs font-medium uppercase tracking-wider muted">{timer ? (timer.pausedAt ? "Paused" : "Focus") : "Ready"}</p>
        </div>
      </div>

      <div className="w-full flex-1 space-y-3">
        <AnimatePresence mode="wait">
          {timer ? (
            <motion.div key="running" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">
              <div>
                <p className="text-xs muted">Working on</p>
                <p className="text-lg font-semibold">{timer.label || "Deep work"}</p>
                {timer.engagementId && <p className="text-sm muted">{engagements.find((e) => e.id === timer.engagementId)?.name}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {timer.pausedAt ? (
                  <button className="btn btn-primary" onClick={() => void resumeTimer()}>
                    Resume
                  </button>
                ) : (
                  <button className="btn btn-soft" onClick={() => void pauseTimer()}>
                    Pause
                  </button>
                )}
                <button className="btn btn-soft" onClick={() => void stopTimer(true)}>
                  <Icon name="check" size={16} /> Stop & log
                </button>
                <button className="btn btn-ghost text-rose-600" onClick={() => void stopTimer(false)}>
                  Discard
                </button>
              </div>
              <p className="text-xs muted">Sessions of 20+ minutes count toward your daily focus ring.</p>
            </motion.div>
          ) : (
            <motion.div key="idle" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {[25, 50, 90].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMinutes(m)}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${minutes === m ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-indigo-950 dark:text-indigo-200" : "border-[var(--border)]"}`}
                  >
                    {m} min
                  </button>
                ))}
                <input
                  type="number"
                  min={5}
                  max={180}
                  className="input w-24"
                  value={minutes}
                  onChange={(e) => setMinutes(Math.min(180, Math.max(5, Number(e.target.value) || 25)))}
                  aria-label="Custom minutes"
                />
              </div>
              <select className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)} aria-label="Task">
                <option value="">Pick a task (optional)</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              {!taskId && (
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" placeholder="What are you working on?" value={label} onChange={(e) => setLabel(e.target.value)} />
                  <select className="input" value={engagementId} onChange={(e) => setEngagementId(e.target.value)} aria-label="Engagement">
                    <option value="">No engagement</option>
                    {engagements.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button className="btn btn-primary w-full py-3 text-base" onClick={start}>
                Start focus
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
