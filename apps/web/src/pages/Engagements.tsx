import { motion } from "motion/react";
import { useState } from "react";
import { engagementPeople, labels, relativeDay, type Engagement } from "@falcon/core";
import { openEditor } from "../components/Editor";
import { Icon } from "../components/Icon";
import { ImportAllocation } from "../components/ImportAllocation";
import { TeamAvatars } from "../components/TeamAvatars";
import { engagementSort } from "../components/rows";
import { TLink, useTNavigate } from "../components/TLink";
import { EmptyState, Pill, Segmented, statusTone } from "../components/ui";
import { useSnapshot, useToday } from "../lib/hooks";

export function nextKeyDate(e: Engagement, today: string) {
  const dates = [
    ["Kick-off", e.kickoff],
    ["Data room", e.dataRoom],
    ["Draft report", e.draftReport],
    ["Final report", e.finalReport],
  ].filter((d): d is [string, string] => !!d[1] && d[1] >= today);
  dates.sort((a, b) => a[1].localeCompare(b[1]));
  return dates[0];
}

export function EngagementsPage() {
  const snap = useSnapshot();
  const today = useToday();
  const navigate = useTNavigate();
  const [filter, setFilter] = useState<"live" | "closed">("live");
  const [importing, setImporting] = useState(false);
  if (!snap) return null;
  const people = new Map(snap.people.map((p) => [p.id, p]));

  const list = snap.engagements.filter((e) => (filter === "live" ? e.status !== "closed" : e.status === "closed")).sort(engagementSort);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Engagements</h1>
          <p className="text-sm muted">{snap.engagements.filter((e) => e.status !== "closed").length} live</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented id="eng-filter" value={filter} onChange={setFilter} options={[{ value: "live", label: "Live" }, { value: "closed", label: "Closed" }]} />
          <button className="btn btn-soft" onClick={() => setImporting(true)} title="Import a team allocation spreadsheet">
            <Icon name="upload" size={16} /> Import
          </button>
          <button
            className="btn btn-primary"
            onClick={() => openEditor({ table: "engagements", onCreated: (r) => navigate(`/engagements/${r.id}`, "forward") })}
          >
            <Icon name="plus" size={16} /> New
          </button>
        </div>
      </header>

      <ImportAllocation open={importing} onClose={() => setImporting(false)} />

      {list.length === 0 ? (
        <EmptyState
          icon="briefcase"
          title={filter === "live" ? "No live engagements" : "Nothing closed yet"}
          hint={filter === "live" ? "Add your current assignments, or import your team allocation sheet." : undefined}
          action={
            filter === "live" ? (
              <button className="btn btn-soft" onClick={() => setImporting(true)}>
                <Icon name="upload" size={16} /> Import from Excel
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((e, i) => {
            const irlOpen = snap.infoRequests.filter((r) => r.engagementId === e.id && (r.status === "pending" || r.status === "partial")).length;
            const irlTotal = snap.infoRequests.filter((r) => r.engagementId === e.id).length;
            const wps = snap.workpapers.filter((w) => w.engagementId === e.id);
            const wpDone = wps.filter((w) => w.status === "final" || w.status === "cleared").length;
            const points = snap.reviewPoints.filter((p) => p.engagementId === e.id && p.status !== "cleared").length;
            const tasks = snap.tasks.filter((t) => t.engagementId === e.id && t.status !== "done").length;
            const key = nextKeyDate(e, today);
            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, type: "spring", stiffness: 300, damping: 30 }}
                whileHover={{ y: -2 }}
              >
                <TLink to={`/engagements/${e.id}`} className="card block p-4 transition-shadow hover:shadow-lg hover:shadow-slate-900/5">
                  <div className="flex items-start justify-between gap-2" style={{ viewTransitionName: `eng-${e.id}` }}>
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold">{e.name}</p>
                      <p className="truncate text-sm muted">
                        {e.type || (e.side === "buy" ? "Buy-side" : e.side === "sell" ? "Sell-side" : "Engagement")}
                        {e.client && e.client !== e.name ? ` · ${e.client}` : ""}
                      </p>
                    </div>
                    <Pill tone={statusTone[e.status]}>{labels.engagementStatus[e.status]}</Pill>
                  </div>
                  <TeamAvatars ids={engagementPeople(e)} people={people} leadId={e.leadId} />
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                    <Metric n={tasks} label="Tasks" />
                    <Metric n={irlOpen} label="IRL open" />
                    <Metric n={points} label="Points" />
                    <Metric n={wps.length - wpDone} label="WPs open" />
                  </div>
                  {irlTotal > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[11px] muted">
                        <span>IRL received</span>
                        <span>
                          {irlTotal - irlOpen}/{irlTotal}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                        <motion.div className="h-full rounded-full bg-emerald-500" initial={{ width: 0 }} animate={{ width: `${((irlTotal - irlOpen) / irlTotal) * 100}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
                      </div>
                    </div>
                  )}
                  {key && (
                    <p className="mt-3 text-xs muted">
                      <Icon name="flag" size={12} className="mr-1 inline" />
                      {key[0]} · {relativeDay(key[1], today)}
                    </p>
                  )}
                </TLink>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-2)] py-2">
      <p className={`text-lg font-bold ${n ? "" : "muted"}`}>{n}</p>
      <p className="text-[10px] font-medium uppercase tracking-wide muted">{label}</p>
    </div>
  );
}
