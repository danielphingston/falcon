import { format, parseISO } from "date-fns";
import { motion } from "motion/react";
import { useState } from "react";
import { formatMinutes, periodReport, reportText, shiftWeek, weekDays, weekStart } from "@falcon/core";
import { Icon } from "../components/Icon";
import { EmptyState, Section, Segmented } from "../components/ui";
import { useSnapshot, useToday } from "../lib/hooks";
import { toast } from "../lib/toast";

type Range = "today" | "week" | "last";

export function ReportsPage() {
  const snap = useSnapshot();
  const today = useToday();
  const [range, setRange] = useState<Range>("week");
  if (!snap) return null;

  const thisWeek = weekStart(today);
  const [from, to, title] =
    range === "today"
      ? [today, today, `Daily report · ${format(parseISO(today), "EEE d MMM yyyy")}`]
      : range === "week"
        ? [thisWeek, today, `Weekly report · week of ${format(parseISO(thisWeek), "d MMM yyyy")}`]
        : [shiftWeek(thisWeek, -1), weekDays(shiftWeek(thisWeek, -1))[6], `Weekly report · week of ${format(parseISO(shiftWeek(thisWeek, -1)), "d MMM yyyy")}`];
  const r = periodReport(snap, from, to, today);
  const maxMin = Math.max(1, ...r.byEngagement.map((b) => b.minutes));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportText(r, title));
      toast({ message: "Report copied", tone: "success" });
    } catch {
      toast({ message: "Couldn't access the clipboard", tone: "error" });
    }
  };

  const stats = [
    { n: r.tasksDone, label: "Tasks done", icon: "check" },
    { n: r.pointsCleared, label: "Review points cleared", icon: "edit" },
    { n: r.wpsFinal, label: "WPs finalised", icon: "review" },
    { n: r.irlReceived, label: "IRL items received", icon: "inbox" },
    { n: r.followUpsClosed, label: "Follow-ups closed", icon: "users" },
    { n: r.chases, label: "Chases sent", icon: "send" },
    { n: r.focusSessions, label: "Focus sessions", icon: "clock" },
    { n: formatMinutes(r.minutes), label: "Time logged", icon: "today" },
  ] as const;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Reports</h1>
          <p className="text-sm muted">{title}</p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented id="report-range" value={range} onChange={setRange} options={[{ value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "last", label: "Last week" }]} />
          <button className="btn btn-soft btn-sm" onClick={copy} aria-label="Copy report">
            <Icon name="copy" size={15} />
          </button>
        </div>
      </header>

      <motion.div key={range} className="grid grid-cols-2 gap-3 md:grid-cols-4" initial="hidden" animate="shown" variants={{ shown: { transition: { staggerChildren: 0.04 } } }}>
        {stats.map((s) => (
          <motion.div key={s.label} variants={{ hidden: { opacity: 0, y: 10 }, shown: { opacity: 1, y: 0 } }} className="card p-4">
            <Icon name={s.icon} size={18} className="text-brand-600" />
            <p className="mt-2 text-2xl font-bold tabular-nums">{s.n}</p>
            <p className="text-xs muted">{s.label}</p>
          </motion.div>
        ))}
      </motion.div>

      <Section title="Time by engagement" icon="briefcase">
        {r.byEngagement.length ? (
          <div className="card space-y-3 p-4">
            {r.byEngagement.map((b) => (
              <div key={b.engagementId ?? "other"}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium">{b.name}</span>
                  <span className="tabular-nums muted">{formatMinutes(b.minutes)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <motion.div className="h-full rounded-full bg-brand-500" initial={{ width: 0 }} animate={{ width: `${(b.minutes / maxMin) * 100}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="clock" title="No time logged in this period" />
        )}
      </Section>

      <Section title="Longest waiting" icon="inbox">
        {r.longestWaiting.length ? (
          <div className="card divide-y divide-[var(--border)]">
            {r.longestWaiting.map((w) => (
              <div key={w.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`grid h-9 min-w-12 place-items-center rounded-lg text-sm font-bold ${w.days >= 7 ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-[var(--surface-2)]"}`}>{w.days}d</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px]">{w.title}</p>
                  <p className="text-xs muted">
                    {w.kind === "irl" ? "IRL item" : "Follow-up"}
                    {w.person && ` · ${w.person}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="sparkles" title="Not waiting on anything" />
        )}
      </Section>

      <p className="text-center text-sm muted">
        {r.overdueNow ? `${r.overdueNow} item${r.overdueNow > 1 ? "s" : ""} overdue right now` : "Nothing overdue right now ✨"}
      </p>
    </div>
  );
}
