/**
 * One Programme tab (build brief v2 A2): programmes (work plan areas,
 * collapsible) → worksteps (number, text, owner, readiness, workpaper chip
 * with its status), filters and search, TB figures per programme when a TB
 * exists, and workpapers that cover no step. The old Work plan and Work
 * programme views stay under "Legacy view" for one release.
 */
import { useMemo, useState } from "react";
import {
  ME,
  areaLabel,
  chainView,
  filterChain,
  labels,
  programmeView,
  readinessLabels,
  shortTitle,
  stepStateLabels,
  stepStates,
  type ChainFilter,
  type ChainProgramme,
  type ChainStep,
  type Readiness,
  type Snapshot,
  type StepState,
} from "@falcon/core";
import { proposeMigrationFor } from "../lib/chain";
import { useSettings, useToday } from "../lib/hooks";
import { toast } from "../lib/toast";
import { lakh } from "../lib/review";
import { useTNavigate } from "./TLink";
import { openEditor } from "./Editor";
import { Icon } from "./Icon";
import { EmptyState, Pill, statusTone, type Tone } from "./ui";
import { Bar, PlanImport, PlanInfoDetails, UnmatchedNames, WorkPlanTab } from "./WorkPlan";
import { WorkProgramme } from "./WorkProgramme";
import { openStepLinks, openWorkpaperForm } from "./WorkpaperForm";

const STATE_TONE: Record<StepState, Tone> = { open: "slate", wip: "blue", to_review: "indigo", in_review: "blue", points_raised: "amber", closed: "green", na: "slate" };
const READY_TONE: Record<Readiness, Tone> = { ready: "green", canStart: "blue", blocked: "red", likelyNa: "slate", noInput: "slate", suggested: "amber", unlinked: "slate" };
const SOURCE_LABEL: Record<string, string> = { tb_suggested: "TB suggested", ai: "AI", manual: "Added" };

const readKey = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeKey = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

export function ProgrammeTab({ snap, engagementId }: { snap: Snapshot; engagementId: string }) {
  const settings = useSettings();
  const today = useToday();
  const navigate = useTNavigate();
  const e = snap.engagements.find((x) => x.id === engagementId)!;
  const view = useMemo(() => chainView(snap, engagementId, today, settings), [snap, engagementId, today, settings]);
  const [f, setF] = useState<ChainFilter>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(JSON.parse(readKey(`prog-collapsed:${engagementId}`) ?? "[]") as string[]));
  const [legacy, setLegacy] = useState(() => readKey("prog-legacy") === "1");
  const [importing, setImporting] = useState(false);
  const shown = useMemo(() => filterChain(view, f, snap, settings), [view, f, snap, settings]);
  const tb = snap.trialBalances.find((t) => t.engagementId === engagementId);
  const tbView = useMemo(() => (tb ? programmeView(tb) : null), [tb]);
  const steps = snap.planItems.filter((s) => s.engagementId === engagementId);
  const pendingSetup = snap.proposals.find((p) => p.status === "pending" && p.tool === "migrate_programme" && p.engagementId === engagementId);
  const total = view.programmes.reduce((n, g) => n + g.applicable, 0);
  const closed = view.programmes.reduce((n, g) => n + g.closed, 0);
  const filtering = !!(f.person || f.state || f.readiness || f.programmeId || f.q);
  const team = snap.people.filter((p) => p.role !== "client").sort((a, b) => a.name.localeCompare(b.name));

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    writeKey(`prog-collapsed:${engagementId}`, JSON.stringify([...next]));
  };
  const setUp = async () => {
    const p = await proposeMigrationFor(engagementId);
    if (p) toast({ message: "Set-up is waiting in your Inbox", action: { label: "Open", run: () => navigate("/inbox") } });
    else toast({ message: "Nothing to set up: every step is under a programme." });
  };

  return (
    <div className="space-y-4">
      {/* Plan + progress */}
      <div className="card space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">{e.planInfo?.title[0] ?? "Programme"}</p>
            <p className="truncate text-xs muted">{[...(e.planInfo?.title.slice(1, 3) ?? []), e.planInfo?.file].filter(Boolean).join(" · ") || (steps.length ? `${steps.length} worksteps` : "Import the work plan to fill the programme.")}</p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button className="btn btn-soft btn-sm" onClick={() => openWorkpaperForm({ engagementId })}>
              <Icon name="plus" size={14} /> Workpaper
            </button>
            <button className="btn btn-soft btn-sm" onClick={() => setImporting(true)}>
              <Icon name="upload" size={14} /> {steps.length ? "Update plan" : "Import plan"}
            </button>
          </div>
        </div>
        {total > 0 && <Bar label="Closed" n={closed} of={total} color="bg-emerald-500" />}
        {e.planInfo && <PlanInfoDetails info={e.planInfo} />}
      </div>

      {(view.needsSetup || view.pendingItems.length > 0) && (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-amber-300 p-3 dark:border-amber-800">
          <p className="min-w-0 text-sm">
            {pendingSetup ? (
              <>Programme set-up is waiting in your Inbox: links to workpapers, owners and refs to tick.</>
            ) : (
              <>
                {view.needsSetup ? "Some steps aren't under a programme yet" : ""}
                {view.needsSetup && view.pendingItems.length ? "; " : ""}
                {view.pendingItems.length ? `${view.pendingItems.length} programme item${view.pendingItems.length === 1 ? "" : "s"} not yet shown as steps` : ""}.
              </>
            )}
          </p>
          {pendingSetup ? (
            <button className="btn btn-primary btn-sm" onClick={() => navigate("/inbox")}>
              Open Inbox
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => void setUp()}>
              Set up programmes
            </button>
          )}
        </div>
      )}

      <UnmatchedNames items={steps} people={snap.people} />

      {/* Filters */}
      {total > 0 && (
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-48 flex-1 items-center gap-2 rounded-xl border border-[var(--border)] px-2">
            <Icon name="search" size={14} className="muted" />
            <input className="w-full bg-transparent py-1.5 text-sm outline-none" placeholder="Step, RFI number or workpaper" value={f.q ?? ""} onChange={(ev) => setF({ ...f, q: ev.target.value || undefined })} aria-label="Search programme" />
          </label>
          <select className="input w-auto py-1 text-sm" value={f.person ?? ""} onChange={(ev) => setF({ ...f, person: ev.target.value || undefined })} aria-label="Person">
            <option value="">Everyone</option>
            <option value={ME}>Me</option>
            {team.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="input w-auto py-1 text-sm" value={f.state ?? ""} onChange={(ev) => setF({ ...f, state: (ev.target.value || undefined) as ChainFilter["state"] })} aria-label="Status">
            <option value="">Any status</option>
            <option value="open_any">Not closed</option>
            {stepStates.map((s) => (
              <option key={s} value={s}>
                {stepStateLabels[s]}
              </option>
            ))}
          </select>
          <select className="input w-auto py-1 text-sm" value={f.readiness ?? ""} onChange={(ev) => setF({ ...f, readiness: (ev.target.value || undefined) as Readiness })} aria-label="Readiness">
            <option value="">Any readiness</option>
            {(Object.keys(readinessLabels) as Readiness[]).map((r) => (
              <option key={r} value={r}>
                {readinessLabels[r]}
              </option>
            ))}
          </select>
          <select className="input w-auto py-1 text-sm" value={f.programmeId ?? ""} onChange={(ev) => setF({ ...f, programmeId: ev.target.value || undefined })} aria-label="Area">
            <option value="">All areas</option>
            {view.programmes.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          {filtering && (
            <button className="btn btn-ghost btn-sm" onClick={() => setF({})}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* Programmes */}
      {!view.programmes.length ? (
        <EmptyState icon="review" title="No programme yet" hint="Import the work plan: each area becomes a programme and each row a workstep. A TB adds balances and trend flags, but isn't needed." />
      ) : !shown.length ? (
        <EmptyState icon="check" title="No step matches" />
      ) : (
        <div className="space-y-3">
          {shown.map((g) => (
            <ProgrammeSection key={g.id} g={g} snap={snap} open={filtering || !collapsed.has(g.id)} onToggle={() => toggle(g.id)} tb={tbView && g.tbArea ? tbFor(tbView, g.tbArea) : undefined} />
          ))}
        </div>
      )}

      {/* Workpapers covering no step */}
      {view.unlinked.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="px-1 text-sm font-semibold">Unlinked workpapers</h3>
          <div className="card divide-y divide-[var(--border)]">
            {view.unlinked.map((w) => (
              <div key={w.id} className="flex items-center gap-3 px-3 py-2.5">
                <button className="min-w-0 flex-1 text-left" onClick={() => openEditor({ table: "workpapers", id: w.id })}>
                  <p className="truncate text-sm">
                    <span className="mr-1.5 font-mono text-xs muted">{w.ref}</span>
                    {w.title}
                  </p>
                  <p className="text-xs muted">{w.adHoc ? "Ad-hoc" : "Not linked yet"}</p>
                </button>
                <Pill tone={statusTone[w.status]}>{labels.wpStatus[w.status]}</Pill>
                <button className="btn btn-soft btn-sm" onClick={() => openStepLinks(w.id)}>
                  Link steps
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Legacy view (one release) */}
      <div className="pt-2">
        <button
          className="text-xs text-[var(--accent)]"
          onClick={() => {
            setLegacy(!legacy);
            writeKey("prog-legacy", legacy ? null : "1");
          }}
        >
          {legacy ? "▾ Hide legacy view" : "▸ Legacy view (old Work plan and Work programme tabs)"}
        </button>
        {legacy && (
          <div className="mt-3 space-y-6 rounded-2xl border border-dashed border-[var(--border)] p-3">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Work plan (legacy)</h3>
              <WorkPlanTab snap={snap} engagementId={engagementId} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Work programme (legacy)</h3>
              <WorkProgramme snap={snap} engagementId={engagementId} />
            </div>
          </div>
        )}
      </div>

      <PlanImport open={importing} onClose={() => setImporting(false)} engagement={e} existing={steps} people={snap.people} />
    </div>
  );
}

interface TbFigures {
  current: number;
  prior?: number;
  scope: string;
  flags: string[];
}
function tbFor(v: ReturnType<typeof programmeView>, area: string): TbFigures | undefined {
  const plan = v.plans.find((p) => p.area === area);
  if (!plan) return undefined;
  return { current: plan.current, prior: plan.prior, scope: plan.scope, flags: v.insights.filter((i) => i.area === area && i.status === "flag").map((i) => i.title) };
}

function ProgrammeSection({ g, snap, open, onToggle, tb }: { g: ChainProgramme; snap: Snapshot; open: boolean; onToggle: () => void; tb?: TbFigures }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onToggle} aria-expanded={open}>
          <span className="muted">{open ? "▾" : "▸"}</span>
          <span className="truncate font-semibold">{g.name}</span>
          {g.tbArea && g.tbArea !== g.name.toLowerCase() && <span className="hidden truncate text-xs muted sm:inline">{areaLabel(g.tbArea)}</span>}
        </button>
        <span className="shrink-0 text-xs muted">
          {g.closed}/{g.applicable} closed
        </span>
        {g.programme && (
          <button className="btn btn-ghost btn-sm shrink-0" onClick={() => openEditor({ table: "programmes", id: g.programme!.id })} aria-label={`Rename ${g.name}`}>
            <Icon name="edit" size={14} />
          </button>
        )}
      </div>
      {tb && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 border-t border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs">
          <span>
            TB <b>{lakh(tb.current)}</b>
            {tb.prior !== undefined && <> vs {lakh(tb.prior)} prior</>}
          </span>
          {tb.scope === "limited" && <span className="muted">below performance materiality</span>}
          {tb.flags.map((t) => (
            <span key={t} className="text-amber-700 dark:text-amber-400">
              ⚑ {t}
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {g.steps.map((x) => (
            <StepLine key={x.step.id} x={x} snap={snap} />
          ))}
          {!g.steps.length && <p className="px-3 py-2 text-sm muted">No steps.</p>}
        </div>
      )}
    </section>
  );
}

function StepLine({ x, snap }: { x: ChainStep; snap: Snapshot }) {
  const s = x.step;
  const [first, ...rest] = s.text.split("\n");
  const prep = x.wp?.preparerId ? snap.people.find((p) => p.id === x.wp!.preparerId)?.name : undefined;
  const procs = s.procedures ?? [];
  const off = x.state === "na";
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 ${off ? "opacity-50" : ""}`}>
      <Pill tone={STATE_TONE[x.state]}>{stepStateLabels[x.state]}</Pill>
      <button className="min-w-0 flex-1 text-left" onClick={() => openEditor({ table: "planItems", id: s.id })}>
        <p className={`text-sm ${x.state === "closed" ? "muted" : ""}`}>
          {s.number && <span className="mr-1.5 font-mono text-xs muted">{s.number}</span>}
          {first}
        </p>
        {rest.length > 0 && <p className="line-clamp-2 whitespace-pre-line text-xs muted">{rest.join("\n")}</p>}
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs muted">
          <span>{s.assignee || "No owner"}</span>
          {x.preparerDiffers && prep && <span className="text-amber-700 dark:text-amber-400">WP by {prep}</span>}
          {s.source && s.source !== "work_plan_import" && <span>· {SOURCE_LABEL[s.source]}</span>}
          {procs.length > 0 && (
            <span>
              · {procs.filter((p) => p.done).length}/{procs.length} procedures
            </span>
          )}
          {x.closedNoWp && <span className="text-amber-700 dark:text-amber-400">· closed in the plan with no workpaper</span>}
          {s.notes && <span>· note</span>}
        </p>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {x.wp ? (
          <button className="max-w-44 truncate rounded-lg border border-[var(--border)] px-2 py-0.5 text-xs" title={`${x.wp.ref} ${x.wp.title} · ${labels.wpStatus[x.wp.status]}`} onClick={() => openEditor({ table: "workpapers", id: x.wp!.id })}>
            <Icon name="review" size={12} className="mr-1 inline" />
            <span className="font-mono">{x.wp.ref}</span> {shortTitle(x.wp.title)}
          </button>
        ) : (
          !off && (
            <button className="btn btn-soft btn-sm" onClick={() => openWorkpaperForm({ stepIds: [s.id] })}>
              <Icon name="plus" size={12} /> Workpaper
            </button>
          )
        )}
        {x.readiness && x.state !== "closed" && !off && x.readiness !== "unlinked" && <Pill tone={READY_TONE[x.readiness]}>{readinessLabels[x.readiness]}</Pill>}
      </div>
    </div>
  );
}
