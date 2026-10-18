import { format, parseISO } from "date-fns";
import { motion } from "motion/react";
import { computeToday, logChase, type DueItem } from "@fdd/core";
import { openEditor } from "../components/Editor";
import { Icon } from "../components/Icon";
import { QuickAdd } from "../components/QuickAdd";
import { FollowUpRow, IrlRow, ReviewPointRow, TaskRow, WorkpaperRow, useLookups } from "../components/rows";
import { AnimatedList, EmptyState, Section } from "../components/ui";
import { act } from "../lib/act";
import { useSettings, useSnapshot, useTable, useToday } from "../lib/hooks";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function TodayPage() {
  const snap = useSnapshot();
  const today = useToday();
  const settings = useSettings();
  const l = useLookups();
  const alerts = (useTable("alerts") ?? []).filter((a) => !a.fired && a.fireAt.slice(0, 10) <= today).sort((a, b) => a.fireAt.localeCompare(b.fireAt));
  if (!snap) return null;

  const v = computeToday(snap, today);
  const openPoints = (wpId: string) => snap.reviewPoints.filter((p) => p.workpaperId === wpId && p.status !== "cleared").length;
  const nothing = !v.overdue.length && !v.dueToday.length && !v.chase.length && !v.toReview.length && !v.pointsToClear.length;
  const firstRun = snap.engagements.length === 0 && snap.tasks.length === 0;

  const row = (d: DueItem) => {
    switch (d.kind) {
      case "task":
        return <TaskRow key={d.record.id} task={d.record} l={l} />;
      case "workpaper":
        return <WorkpaperRow key={d.record.id} wp={d.record} l={l} openPoints={openPoints(d.record.id)} />;
      case "irl":
        return <IrlRow key={d.record.id} item={d.record} l={l} today={today} />;
      case "followup":
        return <FollowUpRow key={d.record.id} f={d.record} l={l} today={today} />;
    }
  };

  const stagger = { hidden: {}, shown: { transition: { staggerChildren: 0.06 } } };
  const rise = { hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 30 } } } as const;

  return (
    <motion.div variants={stagger} initial="hidden" animate="shown" className="space-y-6">
      <motion.header variants={rise}>
        <p className="text-sm font-medium muted">{format(parseISO(today), "EEEE, d MMMM")}</p>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          {greeting()}
          {settings.myName && settings.myName !== "Me" ? `, ${settings.myName.split(" ")[0]}` : ""}
        </h1>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Stat n={v.overdue.length} label="overdue" tone="text-rose-600" />
          <Stat n={v.dueToday.length} label="due today" tone="text-amber-600" />
          <Stat n={v.chase.reduce((s, g) => s + g.items.length, 0)} label="to chase" tone="text-brand-600" />
          <Stat n={v.toReview.length} label="to review" tone="text-sky-600" />
          <Stat n={v.doneToday.length} label="done today" tone="text-emerald-600" />
        </div>
      </motion.header>

      <motion.div variants={rise}>
        <QuickAdd autoFocus={false} />
      </motion.div>

      {alerts.length > 0 && (
        <motion.div variants={rise}>
          <Section title="Reminders" icon="bell" count={alerts.length}>
            <AnimatedList>
              {alerts.map((a) => (
                <div key={a.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-[var(--surface-2)]" onClick={() => openEditor({ table: "alerts", id: a.id })}>
                  <Icon name="bell" size={18} className="text-brand-600" />
                  <p className="flex-1 text-[15px]">{a.title}</p>
                  <span className="text-xs muted">{format(new Date(a.fireAt), "HH:mm")}</span>
                </div>
              ))}
            </AnimatedList>
          </Section>
        </motion.div>
      )}

      {firstRun ? (
        <motion.div variants={rise}>
          <EmptyState
            icon="briefcase"
            title="Welcome to FDD Tracker"
            hint="Start by adding an engagement. Or open Settings and load sample data to look around first."
            action={
              <button className="btn btn-primary" onClick={() => openEditor({ table: "engagements" })}>
                <Icon name="plus" size={16} /> New engagement
              </button>
            }
          />
        </motion.div>
      ) : nothing ? (
        <motion.div variants={rise}>
          <EmptyState icon="sparkles" title="All clear for today ✨" hint="Nothing overdue, nothing to chase, no reviews waiting. Good time for deep work." />
        </motion.div>
      ) : null}

      {v.overdue.length > 0 && (
        <motion.div variants={rise}>
          <Section title="Overdue" count={v.overdue.length} icon="clock">
            <AnimatedList>{v.overdue.map(row)}</AnimatedList>
          </Section>
        </motion.div>
      )}

      {v.dueToday.length > 0 && (
        <motion.div variants={rise}>
          <Section title="Due today" count={v.dueToday.length} icon="today">
            <AnimatedList>{v.dueToday.map(row)}</AnimatedList>
          </Section>
        </motion.div>
      )}

      {v.chase.length > 0 && (
        <motion.div variants={rise}>
          <Section title="Chase today" count={v.chase.reduce((s, g) => s + g.items.length, 0)} icon="send">
            <div className="space-y-3">
              {v.chase.map((g) => (
                <div key={g.person?.id ?? "none"} className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-sm font-semibold">
                      {g.person?.name ?? "No contact set"} <span className="font-normal muted">· {g.items.length}</span>
                    </p>
                    {g.items.length > 1 && (
                      <button
                        className="btn btn-ghost btn-sm text-brand-600"
                        onClick={() =>
                          act(`${g.items.length} chases logged`, async (ctx) => {
                            const out = [];
                            for (const i of g.items) out.push(await logChase(ctx, i.kind === "irl" ? "infoRequests" : "followUps", i.record.id));
                            return out as never;
                          })
                        }
                      >
                        Chased all
                      </button>
                    )}
                  </div>
                  <AnimatedList>
                    {g.items.map((i) =>
                      i.kind === "irl" ? <IrlRow key={i.record.id} item={i.record} l={l} today={today} /> : <FollowUpRow key={i.record.id} f={i.record} l={l} today={today} />,
                    )}
                  </AnimatedList>
                </div>
              ))}
            </div>
          </Section>
        </motion.div>
      )}

      {v.toReview.length > 0 && (
        <motion.div variants={rise}>
          <Section title="Waiting for my review" count={v.toReview.length} icon="review">
            <AnimatedList>
              {v.toReview.map((w) => (
                <WorkpaperRow key={w.id} wp={w} l={l} openPoints={openPoints(w.id)} />
              ))}
            </AnimatedList>
          </Section>
        </motion.div>
      )}

      {v.pointsToClear.length > 0 && (
        <motion.div variants={rise}>
          <Section title="Review points on my WPs" count={v.pointsToClear.length} icon="edit">
            <AnimatedList>
              {v.pointsToClear.map((p) => (
                <ReviewPointRow key={p.id} p={p} l={l} />
              ))}
            </AnimatedList>
          </Section>
        </motion.div>
      )}

      {v.doneToday.length > 0 && (
        <motion.div variants={rise}>
          <Section title="Done today" count={v.doneToday.length} icon="check">
            <AnimatedList>
              {v.doneToday.map((t) => (
                <TaskRow key={t.id} task={t} l={l} />
              ))}
            </AnimatedList>
          </Section>
        </motion.div>
      )}
    </motion.div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1">
      <motion.b key={n} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={`inline-block ${n ? tone : "muted"}`}>
        {n}
      </motion.b>{" "}
      <span className="muted">{label}</span>
    </span>
  );
}
