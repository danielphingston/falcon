import { format, parseISO } from "date-fns";
import { motion } from "motion/react";
import { BADGES, LEVELS, POINTS, dailyPoints } from "@fdd/core";
import { DailyRing, RingLegend } from "../components/Ring";
import { EmptyState, Section } from "../components/ui";
import { gameView } from "../lib/game";
import { useSettings, useSnapshot, useToday } from "../lib/hooks";
import { TLink } from "../components/TLink";

export function ProgressPage() {
  const snap = useSnapshot();
  const today = useToday();
  const settings = useSettings();
  if (!snap) return null;
  if (!settings.gamification)
    return (
      <div className="pt-6">
        <EmptyState
          icon="sparkles"
          title="Gamification is off"
          hint="Turn it on in Settings to get a daily ring, streaks, levels and badges."
          action={
            <TLink to="/settings" className="btn btn-primary">
              Open Settings
            </TLink>
          }
        />
      </div>
    );

  const v = gameView(snap, today, settings);
  const earned = new Map(snap.achievements.map((a) => [a.badge, a]));
  const history = dailyPoints(snap, today, 14);
  const maxPts = Math.max(10, ...history.map((h) => h.points));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Progress</h1>
        <p className="text-sm muted">Points come from finishing work and chasing, never from hours logged.</p>
      </header>

      {/* Level */}
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-brand-500 to-violet-600 p-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-widest opacity-80">Level {v.level.index + 1}</p>
          <p className="text-2xl font-bold">{v.level.name}</p>
          <p className="text-sm opacity-90">{v.points.toLocaleString()} points</p>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/25">
            <motion.div className="h-full rounded-full bg-white" initial={{ width: 0 }} animate={{ width: `${v.level.progress * 100}%` }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
          </div>
          <p className="mt-1.5 text-xs opacity-80">{v.level.next ? `${v.level.toNext} points to ${v.level.next}` : "Top of the ladder 🎉"}</p>
        </div>
        <div className="scrollbar-none flex gap-1 overflow-x-auto p-3">
          {LEVELS.map((l, i) => (
            <span key={l.name} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${i <= v.level.index ? "bg-brand-100 text-brand-700 dark:bg-indigo-950 dark:text-indigo-200" : "bg-[var(--surface-2)] muted"}`}>
              {l.name}
            </span>
          ))}
        </div>
      </div>

      {/* Ring + streaks */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card flex items-center gap-5 p-5">
          <DailyRing ring={v.ring} size={120} />
          <div className="space-y-2">
            <p className="font-semibold">{v.ring.closed ? "Ring closed today ✅" : "Today's ring"}</p>
            <RingLegend ring={v.ring} focusTarget={settings.focusTarget} />
          </div>
        </div>
        <div className="card grid grid-cols-2 gap-3 p-5">
          <StreakStat emoji="🔥" n={v.streak.current} label="Day streak" sub={`Best ${v.streak.best}`} />
          <StreakStat emoji="📨" n={v.chaseStreak.current} label="No overdue chases" sub={`Best ${v.chaseStreak.best}`} />
          <p className="col-span-2 text-xs muted">
            {v.streak.freezeAvailable ? "🧊 Streak freeze available this week: one missed working day won't break your streak." : "🧊 This week's streak freeze has been used."}
          </p>
        </div>
      </div>

      {/* 14-day points */}
      <Section title="Last 14 days" icon="flag">
        <div className="card flex h-40 items-end gap-1.5 p-4">
          {history.map((h, i) => (
            <div key={h.date} className="flex flex-1 flex-col items-center gap-1" title={`${h.date}: ${h.points} pts`}>
              <motion.div
                className={`w-full rounded-md ${h.date === today ? "bg-brand-600" : "bg-brand-300 dark:bg-indigo-800"}`}
                initial={{ height: 0 }}
                animate={{ height: `${(h.points / maxPts) * 100}px` }}
                transition={{ delay: i * 0.03, type: "spring", stiffness: 120, damping: 18 }}
                style={{ minHeight: h.points ? 4 : 2 }}
              />
              <span className="text-[10px] muted">{format(parseISO(h.date), "EEEEE")}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Badges */}
      <Section title="Badges" icon="sparkles" count={earned.size}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {BADGES.map((b, i) => {
            const got = earned.get(b.id);
            return (
              <motion.div
                key={b.id}
                className={`card p-4 text-center ${got ? "" : "opacity-50 grayscale"}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: got ? 1 : 0.5, scale: 1 }}
                transition={{ delay: i * 0.03 }}
                whileHover={got ? { y: -3, rotate: -1 } : {}}
              >
                <div className="text-3xl">{b.emoji}</div>
                <p className="mt-1 font-semibold">{b.name}</p>
                <p className="text-xs muted">{b.description}</p>
                {got && <p className="mt-1 text-[11px] font-medium text-brand-600">{format(new Date(got.earnedAt), "d MMM yyyy")}</p>}
              </motion.div>
            );
          })}
        </div>
      </Section>

      <Section title="How points work" icon="flag">
        <div className="card grid grid-cols-2 gap-2 p-4 text-sm sm:grid-cols-3">
          {(
            [
              ["Task done", POINTS.task],
              ["Chase sent", POINTS.chase],
              ["Review point cleared", POINTS.reviewPoint],
              ["WP → Final", POINTS.wpFinal],
              ["IRL complete", POINTS.irlComplete],
              ["Focus session", POINTS.focus],
            ] as const
          ).map(([label, n]) => (
            <p key={label}>
              <b className="text-brand-600">+{n}</b> <span className="muted">{label}</span>
            </p>
          ))}
        </div>
      </Section>
    </div>
  );
}

function StreakStat({ emoji, n, label, sub }: { emoji: string; n: number; label: string; sub: string }) {
  return (
    <div>
      <p className="text-3xl font-bold">
        {emoji}{" "}
        <motion.span key={n} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="inline-block tabular-nums">
          {n}
        </motion.span>
      </p>
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs muted">{sub}</p>
    </div>
  );
}
