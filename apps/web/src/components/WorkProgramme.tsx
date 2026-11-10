import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import {
  AREAS,
  ASSERTIONS,
  ENGAGEMENT_KINDS,
  INDUSTRIES,

  areaLabel,
  create,
  generateProgramme,
  procedureLibrary,
  programmeView,
  progressOf,
  update,
  type AreaId,
  type Insight,
  type ProgramItem,
  type Snapshot,
  type TrialBalance,
} from "@falcon/core";
import { act } from "../lib/act";
import { toast } from "../lib/toast";
import { openEditor } from "./Editor";
import { Icon } from "./Icon";
import { TbImport } from "./TbImport";
import { EmptyState, Pill } from "./ui";

const inr = (x: number) => Math.round(x).toLocaleString("en-IN");
const lakh = (x: number) => (Math.abs(x) >= 1e7 ? `${(x / 1e7).toFixed(2)} Cr` : Math.abs(x) >= 1e5 ? `${(x / 1e5).toFixed(2)} L` : inr(x));

const STATUS_NEXT: Record<ProgramItem["status"], ProgramItem["status"]> = { todo: "done", in_progress: "done", done: "todo", na: "todo" };
const REVIEW_ICON: Record<ProgramItem["review"], string> = { none: "", ok: "✓", flagged: "⚑", na: "n.a." };

/** The engagement's work programme: TB-driven areas, procedures, trend checks and progress. */
export function WorkProgramme({ snap, engagementId }: { snap: Snapshot; engagementId: string }) {
  const tb = snap.trialBalances.find((t) => t.engagementId === engagementId);
  const items = useMemo(() => snap.programItems.filter((i) => i.engagementId === engagementId).sort((a, b) => a.order - b.order), [snap.programItems, engagementId]);
  const [importing, setImporting] = useState<false | "file" | "mapping">(false);
  const view = useMemo(() => (tb ? programmeView(tb) : null), [tb]);
  const progress = progressOf(items);
  const people = new Map(snap.people.map((p) => [p.id, p]));
  const wps = new Map(snap.workpapers.map((w) => [w.id, w]));

  if (!tb || !view)
    return (
      <>
        <EmptyState
          icon="briefcase"
          title="Build the work programme from the TB"
          hint="Upload the trial balance. Each ledger is mapped to an area (receivables, inventory, GST dues…), materiality is set, trends are checked, and you get a checklist of procedures for every material area, tailored to the engagement type and industry."
          action={
            <button className="btn btn-primary" onClick={() => setImporting("file")}>
              <Icon name="upload" size={16} /> Upload trial balance
            </button>
          }
        />
        <TbImport open={!!importing} onClose={() => setImporting(false)} engagementId={engagementId} />
      </>
    );

  const flagged = view.insights.filter((i) => i.status === "flag");
  const setTb = (patch: Partial<TrialBalance>, message: string) =>
    act(message, async (ctx) => {
      const r = await update(ctx, "trialBalances", tb.id, patch as never);
      const gen = await generateProgramme(ctx, procedureLibrary, r.record, items);
      return [r, ...gen] as never;
    });

  const copy = async () => {
    const rows = [["Area", "Procedure", "Assertions", "Status", "Assigned to", "WP", "Review", "Notes"]];
    for (const i of items)
      rows.push([
        areaLabel(i.area),
        i.text,
        i.assertions.map((a) => (ASSERTIONS as Record<string, string>)[a] ?? a).join(", "),
        i.status,
        i.assigneeId ? (people.get(i.assigneeId)?.name ?? "") : "",
        i.workpaperId ? (wps.get(i.workpaperId)?.ref ?? "") : "",
        i.review === "none" ? "" : i.review,
        [i.notes, i.reviewNote].filter(Boolean).join(" | "),
      ]);
    await navigator.clipboard.writeText(rows.map((r) => r.map((c) => c.replace(/\s+/g, " ")).join("\t")).join("\n"));
    toast({ message: `Copied ${items.length} steps. Paste into Excel`, tone: "success" });
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-sm">
            <p className="font-semibold">
              {ENGAGEMENT_KINDS[tb.kind]} · {INDUSTRIES[tb.industry]}
            </p>
            <p className="text-xs muted">
              {tb.fileName || "Trial balance"} · {tb.periods[tb.currentIdx]?.label}
              {tb.priorIdx !== undefined && ` vs ${tb.periods[tb.priorIdx]?.label}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button className="btn btn-soft btn-sm" onClick={() => setImporting("mapping")}>
              <Icon name="edit" size={14} /> Mapping
            </button>
            <button className="btn btn-soft btn-sm" onClick={() => setImporting("file")}>
              <Icon name="upload" size={14} /> New TB
            </button>
            <button className="btn btn-soft btn-sm" onClick={copy} title="Copy the programme as a table for Excel">
              <Icon name="copy" size={14} /> Copy
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] muted">Materiality ({view.materiality.basis})</span>
            <input
              key={view.materiality.overall}
              className="input py-1 tabular-nums"
              inputMode="numeric"
              defaultValue={inr(view.materiality.overall)}
              onBlur={(e) => {
                const v = Number(e.target.value.replace(/[^\d.]/g, ""));
                if (v > 0 && v !== view.materiality.overall) void setTb({ materiality: v, performance: Math.round(v * 0.75) }, "Materiality updated");
              }}
              aria-label="Overall materiality"
            />
          </label>
          <div>
            <p className="text-[11px] muted">Performance materiality</p>
            <p className="py-1 font-semibold tabular-nums">{inr(view.materiality.performance)}</p>
          </div>
          <div>
            <p className="text-[11px] muted">Trend flags</p>
            <p className={`py-1 font-semibold ${flagged.length ? "text-amber-600" : "text-emerald-600"}`}>{flagged.length ? `${flagged.length} to look at` : "None"}</p>
          </div>
          <div>
            <p className="text-[11px] muted">Done</p>
            <p className="py-1 font-semibold">
              {progress.done}/{progress.total}
            </p>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <motion.div className="h-full rounded-full bg-emerald-500" animate={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
        </div>
      </div>

      {/* Areas */}
      {view.plans.map((plan) => (
        <AreaCard
          key={plan.area}
          area={plan.area}
          current={plan.current}
          prior={plan.prior}
          scope={plan.scope}
          insights={view.insights.filter((i) => i.area === plan.area)}
          items={items.filter((i) => i.area === plan.area)}
          engagementId={engagementId}
          people={people}
          wps={wps}
          hasComparative={tb.priorIdx !== undefined}
        />
      ))}
      {view.insights.some((i) => i.area === "unmapped") && (
        <AreaCard area="unmapped" current={0} scope="limited" insights={view.insights.filter((i) => i.area === "unmapped")} items={items.filter((i) => i.area === "unmapped")} engagementId={engagementId} people={people} wps={wps} hasComparative={false} />
      )}

      <TbImport open={!!importing} startAt={importing || "file"} onClose={() => setImporting(false)} engagementId={engagementId} existing={tb} key={`${tb.updatedAt}-${importing}`} />
    </div>
  );
}

function AreaCard({
  area,
  current,
  prior,
  scope,
  insights,
  items,
  engagementId,
  people,
  wps,
  hasComparative,
}: {
  area: AreaId;
  current: number;
  prior?: number;
  scope: "full" | "limited";
  insights: Insight[];
  items: ProgramItem[];
  engagementId: string;
  people: Map<string, { name: string }>;
  wps: Map<string, { ref: string }>;
  hasComparative: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const done = items.filter((i) => i.status === "done" || i.status === "na").length;
  const flags = insights.filter((i) => i.status === "flag");
  const change = prior ? (current - prior) / Math.abs(prior) : undefined;
  const top = items.filter((i) => !i.parentId);
  const kids = (id: string) => items.filter((i) => i.parentId === id);
  const nextOrder = (items.at(-1)?.order ?? 0) + 1;

  const addInsightChecks = (ins: Insight) =>
    act(`${ins.followUps.length} checks added`, async (ctx) => {
      const out = [];
      for (const [k, f] of ins.followUps.entries())
        if (!items.some((i) => i.text === f.text)) out.push(await create(ctx, "programItems", { engagementId, area, text: f.text, why: f.why, source: "insight", order: nextOrder + k * 0.01 }));
      return out;
    });

  return (
    <div className="card overflow-hidden">
      <button className="flex w-full items-center gap-3 p-4 text-left hover:bg-[var(--surface-2)]" onClick={() => setOpen(!open)} aria-expanded={open}>
        <motion.span animate={{ rotate: open ? 90 : 0 }} className="muted">
          <Icon name="chevron" size={16} />
        </motion.span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {AREAS[area].label}
            {scope === "limited" && area !== "unmapped" && <Pill tone="slate">Below materiality · key steps</Pill>}
            {flags.length > 0 && <Pill tone="amber">⚑ {flags.length} trend flag{flags.length > 1 ? "s" : ""}</Pill>}
          </p>
          {area !== "general" && area !== "unmapped" && (
            <p className="text-xs tabular-nums muted">
              {lakh(current)}
              {hasComparative && prior !== undefined && ` · prior ${lakh(prior)}`}
              {change !== undefined && ` · ${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%`}
            </p>
          )}
        </div>
        <div className="w-20 shrink-0 text-right">
          <p className="text-xs font-semibold">
            {done}/{items.length}
          </p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
          </div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-[var(--border)]">
            {insights.length > 0 && (
              <div className="space-y-2 p-3">
                {insights.map((ins) => (
                  <div key={ins.id} className={`rounded-xl px-3 py-2 text-sm ${ins.status === "flag" ? "bg-amber-50 dark:bg-amber-950/40" : "bg-emerald-50 dark:bg-emerald-950/30"}`}>
                    <p className="font-semibold">
                      {ins.status === "flag" ? "⚑ " : "✓ "}
                      {ins.title}
                    </p>
                    <p className="text-xs muted">{ins.detail}</p>
                    {ins.status === "flag" && ins.followUps.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {ins.followUps.map((f) => (
                          <p key={f.text} className="text-xs">
                            • {f.text} <span className="muted">({f.why})</span>
                          </p>
                        ))}
                        <button className="btn btn-soft btn-sm mt-1" onClick={() => void addInsightChecks(ins)}>
                          <Icon name="plus" size={13} /> Add these checks to the programme
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="divide-y divide-[var(--border)]">
              {top.map((i) => (
                <div key={i.id}>
                  <ItemRow item={i} people={people} wps={wps} />
                  {kids(i.id).map((k) => (
                    <div key={k.id} className="border-l-2 border-amber-300 pl-4">
                      <ItemRow item={k} people={people} wps={wps} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <form
              className="flex gap-2 border-t border-[var(--border)] p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!draft.trim()) return;
                if (await act("Step added", (ctx) => create(ctx, "programItems", { engagementId, area, text: draft.trim(), source: "manual", order: nextOrder }))) setDraft("");
              }}
            >
              <input className="input py-1.5 text-sm" placeholder="Add a procedure…" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button className="btn btn-soft btn-sm" disabled={!draft.trim()}>
                Add
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ItemRow({ item, people, wps }: { item: ProgramItem; people: Map<string, { name: string }>; wps: Map<string, { ref: string }> }) {
  const done = item.status === "done";
  const na = item.status === "na";
  const tag = item.source === "followup" ? "Follow-up" : item.source === "insight" ? "Trend check" : item.source === "ai" ? "AI" : item.source === "manual" ? "Added" : null;
  return (
    <div className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-[var(--surface-2)]" onClick={() => openEditor({ table: "programItems", id: item.id })}>
      <button
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "Mark not done" : "Mark done"}
        onClick={(e) => {
          e.stopPropagation();
          void act(null, (ctx) => update(ctx, "programItems", item.id, { status: STATUS_NEXT[item.status] }));
        }}
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-2 ${done ? "border-emerald-500 bg-emerald-500 text-white" : na ? "border-slate-300 bg-slate-200 dark:bg-slate-700" : "border-slate-300 dark:border-slate-600"}`}
      >
        {done && <Icon name="check" size={12} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${done || na ? "muted line-through" : ""}`}>
          {item.core && <span className="mr-1 text-[10px] font-bold uppercase text-brand-600">Key</span>}
          {item.text}
        </p>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] muted">
          {tag && <span className="font-semibold text-amber-600">{tag}</span>}
          {item.assertions.slice(0, 3).map((a) => (
            <span key={a}>{(ASSERTIONS as Record<string, string>)[a] ?? a}</span>
          ))}
          {item.assigneeId && <span>→ {people.get(item.assigneeId)?.name}</span>}
          {item.workpaperId && <span>WP {wps.get(item.workpaperId)?.ref}</span>}
          {na && <span>n.a.</span>}
        </div>
        {item.why && <p className="mt-0.5 text-[11px] italic muted">{item.why}</p>}
      </div>
      {item.review !== "none" && (
        <span className={`shrink-0 rounded-full px-1.5 text-xs font-bold ${item.review === "flagged" ? "bg-amber-100 text-amber-700" : item.review === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`} title={item.reviewNote}>
          {REVIEW_ICON[item.review]}
        </span>
      )}
    </div>
  );
}

