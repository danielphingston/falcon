import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import {
  AREAS,
  ENGAGEMENT_KINDS,
  INDUSTRIES,
  addFollowUps,
  create,
  procedureLibrary,
  programmeView,
  reviewItem,
  suggestionsFor,
  update,
  type AreaId,
  type ProgramItem,
  type ProcedureFollowUp,
  type WorkPaper,
} from "@fdd/core";
import { act } from "../lib/act";
import { sendMessage } from "../lib/chat";
import { useSnapshot } from "../lib/hooks";
import { Icon } from "./Icon";
import { useTNavigate } from "./TLink";

const lakh = (x: number) => (Math.abs(x) >= 1e7 ? `${(x / 1e7).toFixed(2)} Cr` : Math.abs(x) >= 1e5 ? `${(x / 1e5).toFixed(2)} L` : Math.round(x).toLocaleString("en-IN"));

/**
 * Reviewer's checklist inside a work paper: the programme steps for the WP's
 * area, each marked ✓ / ⚑ / n.a. Flagging shows what more to check and why,
 * which can become programme steps or review points, or go to the assistant.
 */
export function ReviewChecklist({ wp }: { wp: WorkPaper }) {
  const snap = useSnapshot();
  const navigate = useTNavigate();
  const area = wp.area as AreaId | undefined;
  const tb = snap?.trialBalances.find((t) => t.engagementId === wp.engagementId);
  const items = useMemo(
    () => (snap?.programItems ?? []).filter((i) => i.engagementId === wp.engagementId && (i.area === area || i.workpaperId === wp.id)).sort((a, b) => a.order - b.order),
    [snap, wp.engagementId, wp.id, area],
  );
  const view = useMemo(() => (tb ? programmeView(tb) : null), [tb]);
  if (!snap) return null;

  if (!area)
    return (
      <p className="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-xs muted">
        Set this work paper's <b>Programme area</b> above to get a review checklist from the engagement's work programme.
      </p>
    );
  if (!items.length)
    return (
      <p className="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-xs muted">
        No work-programme steps for {AREAS[area]?.label ?? area} yet. Build the programme from the engagement's <b>Programme</b> tab (upload the TB).
      </p>
    );

  const plan = view?.plans.find((p) => p.area === area);
  const insights = (view?.insights ?? []).filter((i) => i.area === area && i.status === "flag");
  const reviewed = items.filter((i) => i.review !== "none").length;
  const flagged = items.filter((i) => i.review === "flagged");
  const top = items.filter((i) => !i.parentId || !items.some((p) => p.id === i.parentId));
  const kids = (id: string) => items.filter((i) => i.parentId === id);

  const askAi = () => {
    const engagement = snap.engagements.find((e) => e.id === wp.engagementId);
    const lines = [
      `I'm reviewing work paper ${wp.ref} "${wp.title}" on ${engagement?.name ?? "this engagement"} (${tb ? ENGAGEMENT_KINDS[tb.kind] : "audit"}, ${tb ? INDUSTRIES[tb.industry] : "general"} industry), area: ${AREAS[area]?.label ?? area}.`,
      plan ? `Balance: ${lakh(plan.current)}${plan.prior !== undefined ? `, prior period ${lakh(plan.prior)}` : ""}.` : "",
      insights.length ? `Trend flags: ${insights.map((i) => `${i.title}: ${i.detail}`).join(" ")}` : "",
      flagged.length
        ? `I flagged these steps:\n${flagged.map((i) => `- ${i.text}${i.reviewNote ? ` (my note: ${i.reviewNote})` : ""}`).join("\n")}`
        : "Nothing flagged yet.",
      "What else should I check, and why? Be specific to this area and these findings. Then add the ones worth doing to the work programme with add_program_items.",
    ];
    navigate("/chat");
    void sendMessage(lines.filter(Boolean).join("\n"));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Review checklist · {AREAS[area]?.label ?? area}</h3>
        <span className="text-xs muted">
          {reviewed}/{items.length} reviewed{flagged.length ? ` · ${flagged.length} flagged` : ""}
        </span>
      </div>
      {insights.map((ins) => (
        <div key={ins.id} className="rounded-xl bg-amber-50 px-3 py-2 text-xs dark:bg-amber-950/40">
          <p className="font-semibold">⚑ {ins.title}</p>
          <p className="muted">{ins.detail}</p>
        </div>
      ))}
      <div className="space-y-1.5">
        {top.map((i) => (
          <div key={i.id} className="space-y-1.5">
            <CheckRow item={i} all={items} wp={wp} />
            {kids(i.id).map((k) => (
              <div key={k.id} className="ml-4 border-l-2 border-amber-300 pl-2">
                <CheckRow item={k} all={items} wp={wp} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <button className="btn btn-soft btn-sm w-full" onClick={askAi}>
        <Icon name="sparkles" size={14} /> Ask AI what else to check
      </button>
    </div>
  );
}

function CheckRow({ item, all, wp }: { item: ProgramItem; all: ProgramItem[]; wp: WorkPaper }) {
  const [note, setNote] = useState(item.reviewNote ?? "");
  const suggestions = item.review === "flagged" ? suggestionsFor(procedureLibrary, item, all) : [];
  const set = (review: ProgramItem["review"]) => act(null, (ctx) => reviewItem(ctx, item.id, item.review === review ? "none" : review));
  const btn = (review: ProgramItem["review"], label: string, on: string, title: string) => (
    <button
      onClick={() => void set(review)}
      title={title}
      aria-pressed={item.review === review}
      className={`grid h-7 min-w-7 place-items-center rounded-md border px-1 text-xs font-bold transition-colors ${item.review === review ? on : "border-[var(--border)] muted hover:bg-[var(--surface-2)]"}`}
    >
      {label}
    </button>
  );
  const addToProgramme = (f: ProcedureFollowUp) => act("Added to the work programme", (ctx) => addFollowUps(ctx, item, [f]));
  const raisePoint = (text: string) =>
    act("Review point raised", async (ctx) => {
      const r = await create(ctx, "reviewPoints", { workpaperId: wp.id, engagementId: wp.engagementId, text });
      if (wp.status !== "points_raised" && wp.myRole === "reviewer") await update(ctx, "workpapers", wp.id, { status: "points_raised" });
      return r;
    });

  return (
    <div className={`rounded-xl border px-3 py-2 ${item.review === "flagged" ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20" : "border-[var(--border)]"}`}>
      <div className="flex items-start gap-2">
        <p className={`flex-1 text-sm ${item.review === "ok" || item.review === "na" ? "muted" : ""}`}>
          {item.text}
          {item.status !== "done" && item.status !== "na" && <span className="ml-1 text-[10px] font-semibold uppercase text-rose-500">not done by preparer</span>}
        </p>
        <div className="flex shrink-0 gap-1">
          {btn("ok", "✓", "border-emerald-500 bg-emerald-500 text-white", "Reviewed, fine")}
          {btn("flagged", "⚑", "border-amber-500 bg-amber-500 text-white", "Flag: something's wrong or incomplete")}
          {btn("na", "n.a.", "border-slate-400 bg-slate-400 text-white", "Not applicable")}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {item.review === "flagged" && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 space-y-2">
              <textarea
                className="input text-sm"
                rows={2}
                placeholder="What did you find? (e.g. 3 debtors > 180 days not provided for)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => note !== (item.reviewNote ?? "") && void act(null, (ctx) => reviewItem(ctx, item.id, "flagged", note))}
              />
              {note.trim() && (
                <button className="btn btn-soft btn-sm" onClick={() => void raisePoint(note.trim())}>
                  <Icon name="edit" size={13} /> Raise this as a review point
                </button>
              )}
              {suggestions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">What more to check, and why</p>
                  {suggestions.map((f) => (
                    <div key={f.text} className="rounded-lg bg-[var(--surface)] px-2.5 py-2 text-xs">
                      <p className="font-medium">{f.text}</p>
                      <p className="muted">{f.why}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <button className="btn btn-soft btn-sm" onClick={() => void addToProgramme(f)}>
                          <Icon name="plus" size={12} /> Add to programme
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => void raisePoint(`${f.text} (${f.why})`)}>
                          Raise review point
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
