import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import {
  AREAS,
  ENGAGEMENT_KINDS,
  INDUSTRIES,
  addFollowUps,
  answerCue,
  create,
  procedureLibrary,
  reviewCues,
  suggestionsFor,
  update,
  type AreaId,
  type Ctx,
  type ProgramItem,
  type ProcedureFollowUp,
  type ReviewCue,
  type WorkPaper,
} from "@falcon/core";
import { act } from "../lib/act";
import { sendMessage } from "../lib/chat";
import { useSnapshot } from "../lib/hooks";
import { lakh, wpContext } from "../lib/review";
import { Icon } from "./Icon";
import { useTNavigate } from "./TLink";

const AREA_OPTIONS = (Object.keys(AREAS) as AreaId[]).filter((a) => a !== "unmapped");

/**
 * Reviewer's cues inside a work paper: "has this been done on the WP?" for
 * each step of the WP's area, from the work programme or (without one) from
 * the procedure library. Answer them one at a time (guided) or as a list.
 * A "no" shows what more to check and why, and can become a review point.
 */
export function ReviewChecklist({ wp }: { wp: WorkPaper }) {
  const snap = useSnapshot();
  const navigate = useTNavigate();
  const [guided, setGuided] = useState(false);
  const c = useMemo(() => (snap ? wpContext(snap, wp) : null), [snap, wp]);
  const items = useMemo(
    () => (snap?.programItems ?? []).filter((i) => i.engagementId === wp.engagementId && !i.deleted),
    [snap, wp.engagementId],
  );
  const cues = useMemo(
    () =>
      c
        ? reviewCues({ library: procedureLibrary, areas: c.areas, kind: c.kind, industry: c.industry, items, workpaperId: wp.id, fromProgramme: c.hasProgramme })
        : [],
    [c, items, wp.id],
  );
  if (!snap || !c) return null;

  const setArea = (area: string) => act(null, (ctx) => update(ctx, "workpapers", wp.id, { area: area || null }));
  const areaLabel = c.areas.map((a) => AREAS[a]?.label ?? a).join(" + ");
  const answered = cues.filter((q) => q.review !== "none").length;
  const flagged = cues.filter((q) => q.review === "flagged");

  if (!c.areas.length)
    return (
      <div className="space-y-2 rounded-xl bg-[var(--surface-2)] px-3 py-2.5">
        <p className="text-xs muted">Which area does this work paper cover? The app will then ask you, step by step, whether each check has been done on it.</p>
        <AreaSelect value="" onChange={setArea} />
      </div>
    );

  const askAi = () => {
    const lines = [
      `I'm reviewing work paper ${wp.ref} "${wp.title}" on ${c.engagementName} (${ENGAGEMENT_KINDS[c.kind]}, ${INDUSTRIES[c.industry]} industry), area: ${areaLabel}.`,
      ...c.facts,
      flagged.length ? `I flagged these steps:\n${flagged.map((i) => `- ${i.text}${i.reviewNote ? ` (my note: ${i.reviewNote})` : ""}`).join("\n")}` : "Nothing flagged yet.",
      "What else should I check, and why? Be specific to this area and these findings. Then add the ones worth doing to the work programme with add_program_items.",
    ];
    navigate("/chat");
    void sendMessage(lines.filter(Boolean).join("\n"));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Review cues · {areaLabel}</h3>
        <span className="shrink-0 text-xs muted">
          {answered}/{cues.length} answered{flagged.length ? ` · ${flagged.length} flagged` : ""}
        </span>
      </div>
      {c.inferred && (
        <div className="flex flex-wrap items-center gap-2 text-xs muted">
          <span>Guessed from the title.</span>
          <AreaSelect value={c.areas[0]} onChange={setArea} label="Change area" />
        </div>
      )}
      {!c.hasProgramme && (
        <p className="text-xs muted">
          From the {ENGAGEMENT_KINDS[c.kind].toLowerCase()} procedure library. Upload the TB in the engagement's <b>Programme</b> tab to tailor these to the numbers.
        </p>
      )}
      {c.facts
        .filter((f) => f.startsWith("Trend flag"))
        .map((f) => (
          <div key={f} className="rounded-xl bg-amber-50 px-3 py-2 text-xs dark:bg-amber-950/40">
            ⚑ {f.replace(/^Trend flag: /, "")}
          </div>
        ))}

      <AnimatePresence mode="wait" initial={false}>
        {guided ? (
          <motion.div key="guided" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <GuidedReview cues={cues} items={items} wp={wp} onClose={() => setGuided(false)} onAskAi={askAi} />
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-1.5">
            <button className="btn btn-primary btn-sm w-full" onClick={() => setGuided(true)} disabled={!cues.length}>
              <Icon name="review" size={14} /> {answered ? (answered < cues.length ? "Continue guided review" : "Go through the cues again") : "Start guided review"}
            </button>
            {cues.map((q) => (
              <CueRow key={q.procedureId ?? q.itemId ?? q.text} cue={q} items={items} wp={wp} />
            ))}
            <button className="btn btn-soft btn-sm w-full" onClick={askAi}>
              <Icon name="sparkles" size={14} /> Ask AI what else to check
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AreaSelect({ value, onChange, label = "Programme area" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <select className="input max-w-60 py-1 text-xs" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">Choose area…</option>
      {AREA_OPTIONS.map((a) => (
        <option key={a} value={a}>
          {AREAS[a].label}
        </option>
      ))}
    </select>
  );
}

// ---------- shared answer logic ----------

function useAnswer(cue: ReviewCue, wp: WorkPaper) {
  const where = { engagementId: wp.engagementId, workpaperId: wp.id, library: procedureLibrary };
  const answer = (review: ProgramItem["review"], note?: string) => act(null, async (ctx) => void (await answerCue(ctx, cue, where, review, note)));
  const raisePoint = (text: string) =>
    act("Review point raised", async (ctx: Ctx) => {
      const r = await create(ctx, "reviewPoints", { workpaperId: wp.id, engagementId: wp.engagementId, text });
      if (wp.status !== "points_raised" && wp.myRole === "reviewer") await update(ctx, "workpapers", wp.id, { status: "points_raised" });
      return r;
    });
  return { answer, raisePoint };
}

const notDone = (cue: ReviewCue) => cue.status !== undefined && cue.status !== "done" && cue.status !== "na";

// ---------- list mode ----------

function CueRow({ cue, items, wp }: { cue: ReviewCue; items: ProgramItem[]; wp: WorkPaper }) {
  const { answer } = useAnswer(cue, wp);
  const item = cue.itemId ? items.find((i) => i.id === cue.itemId) : undefined;
  const isChild = !!item?.parentId;
  const btn = (review: ProgramItem["review"], label: string, on: string, title: string) => (
    <button
      onClick={() => void answer(cue.review === review ? "none" : review)}
      title={title}
      aria-pressed={cue.review === review}
      className={`grid h-7 min-w-7 place-items-center rounded-md border px-1 text-xs font-bold transition-colors ${cue.review === review ? on : "border-[var(--border)] muted hover:bg-[var(--surface-2)]"}`}
    >
      {label}
    </button>
  );
  return (
    <div className={isChild ? "ml-4 border-l-2 border-amber-300 pl-2" : ""}>
      <div className={`rounded-xl border px-3 py-2 ${cue.review === "flagged" ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20" : "border-[var(--border)]"}`}>
        <div className="flex items-start gap-2">
          <p className={`flex-1 text-sm ${cue.review === "ok" || cue.review === "na" ? "muted" : ""}`}>
            {cue.core && <span className="mr-1 text-[10px] font-semibold uppercase text-[var(--accent)]">key</span>}
            {cue.text}
            {notDone(cue) && cue.review === "none" && <span className="ml-1 text-[10px] font-semibold uppercase text-rose-500">not done by preparer</span>}
          </p>
          <div className="flex shrink-0 gap-1">
            {btn("ok", "✓", "border-emerald-500 bg-emerald-500 text-white", "Done on the WP")}
            {btn("flagged", "⚑", "border-amber-500 bg-amber-500 text-white", "Not done or not good enough")}
            {btn("na", "n.a.", "border-slate-400 bg-slate-400 text-white", "Not applicable")}
          </div>
        </div>
        <AnimatePresence initial={false}>
          {cue.review === "flagged" && item && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <FlagDetail cue={cue} item={item} items={items} wp={wp} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Note, "raise as review point" and what more to check for a flagged step. */
function FlagDetail({ cue, item, items, wp }: { cue: ReviewCue; item: ProgramItem; items: ProgramItem[]; wp: WorkPaper }) {
  const { answer, raisePoint } = useAnswer(cue, wp);
  const [note, setNote] = useState(cue.reviewNote ?? "");
  const [raised, setRaised] = useState(false);
  const suggestions = suggestionsFor(procedureLibrary, item, items);
  const addToProgramme = (f: ProcedureFollowUp) => act("Added to the work programme", (ctx) => addFollowUps(ctx, item, [f]));
  const saveNote = () => note !== (cue.reviewNote ?? "") && void answer("flagged", note);
  return (
    <div className="mt-2 space-y-2">
      <textarea
        className="input text-sm"
        rows={2}
        placeholder="What's missing or wrong? (e.g. ageing not tied to the TB)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={saveNote}
      />
      <div className="flex flex-wrap gap-1.5">
        <button
          className="btn btn-soft btn-sm"
          disabled={raised}
          onClick={async () => {
            saveNote();
            const text = note.trim() ? `${cue.text}: ${note.trim()}` : `Please complete: ${cue.text}`;
            if (await raisePoint(text)) setRaised(true);
          }}
        >
          <Icon name="edit" size={13} /> {raised ? "Raised as a review point" : "Raise as a review point"}
        </button>
      </div>
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
  );
}

// ---------- guided mode ----------

function GuidedReview({ cues, items, wp, onClose, onAskAi }: { cues: ReviewCue[]; items: ProgramItem[]; wp: WorkPaper; onClose: () => void; onAskAi: () => void }) {
  const firstOpen = cues.findIndex((q) => q.review === "none");
  const [idx, setIdx] = useState(firstOpen < 0 ? 0 : firstOpen);
  const [dir, setDir] = useState(1);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const done = idx >= cues.length;
  const cue = cues[Math.min(idx, cues.length - 1)];
  const { answer } = useAnswer(cue, wp);
  const item = cue?.itemId ? items.find((i) => i.id === cue.itemId) : undefined;

  const go = (to: number) => {
    setDir(to >= idx ? 1 : -1);
    setIdx(Math.max(0, Math.min(cues.length, to)));
  };
  const next = () => go(idx + 1);
  const reply = async (review: ProgramItem["review"]) => {
    await answer(review);
    setSkipped((s) => {
      const n = new Set(s);
      n.delete(idx);
      return n;
    });
    if (review !== "flagged") next();
  };

  const count = (r: ProgramItem["review"]) => cues.filter((q) => q.review === r).length;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-1 flex-wrap gap-1" aria-label="Progress">
          {cues.map((q, i) => (
            <button
              key={i}
              onClick={() => go(i)}
              title={q.text}
              className={`h-2 rounded-full transition-all ${i === idx ? "w-5" : "w-2"} ${
                q.review === "ok" ? "bg-emerald-500" : q.review === "flagged" ? "bg-amber-500" : q.review === "na" ? "bg-slate-400" : skipped.has(i) ? "bg-rose-300" : "bg-[var(--border)]"
              }`}
            />
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          List view
        </button>
      </div>

      <AnimatePresence mode="wait" custom={dir} initial={false}>
        {done ? (
          <motion.div key="summary" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-2 py-2 text-center">
            <p className="text-base font-semibold">Review pass complete</p>
            <p className="text-sm muted">
              {count("ok")} done · {count("flagged")} flagged · {count("na")} n.a. · {cues.length - count("ok") - count("flagged") - count("na")} unanswered
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {count("flagged") > 0 && (
                <button className="btn btn-soft btn-sm" onClick={() => go(cues.findIndex((q) => q.review === "flagged"))}>
                  Revisit flagged
                </button>
              )}
              {cues.some((q) => q.review === "none") && (
                <button className="btn btn-soft btn-sm" onClick={() => go(cues.findIndex((q) => q.review === "none"))}>
                  Answer the rest
                </button>
              )}
              <button className="btn btn-soft btn-sm" onClick={onAskAi}>
                <Icon name="sparkles" size={13} /> Ask AI what else to check
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={idx}
            custom={dir}
            initial={{ opacity: 0, x: 24 * dir }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 * dir }}
            transition={{ duration: 0.18 }}
            className="space-y-2"
          >
            <p className="text-xs font-semibold uppercase tracking-wide muted">
              {idx + 1} of {cues.length} · {AREAS[cue.area]?.label}
              {cue.core ? " · key step" : ""}
            </p>
            <p className="text-sm">Has this been done on the work paper?</p>
            <p className="text-base font-semibold leading-snug">{cue.text}</p>
            {cue.why && <p className="text-xs muted">Why it matters: {cue.why}</p>}
            {notDone(cue) && <p className="text-xs font-semibold text-rose-500">The preparer hasn't marked this step done.</p>}
            <div className="grid grid-cols-2 gap-1.5 pt-1 sm:grid-cols-4">
              <button className={`btn btn-sm ${cue.review === "ok" ? "btn-primary" : "btn-soft"}`} onClick={() => void reply("ok")}>
                <Icon name="check" size={14} /> Yes, done
              </button>
              <button
                className={`btn btn-sm ${cue.review === "flagged" ? "bg-amber-500 text-white" : "btn-soft"}`}
                onClick={() => void reply("flagged")}
              >
                <Icon name="flag" size={14} /> No / issue
              </button>
              <button className={`btn btn-sm ${cue.review === "na" ? "btn-primary" : "btn-soft"}`} onClick={() => void reply("na")}>
                N.A.
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSkipped((s) => new Set(s).add(idx));
                  next();
                }}
              >
                Skip
              </button>
            </div>
            {cue.review === "flagged" && item && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="overflow-hidden">
                <FlagDetail key={item.id} cue={cue} item={item} items={items} wp={wp} />
                <button className="btn btn-primary btn-sm mt-2 w-full" onClick={next}>
                  Next question
                </button>
              </motion.div>
            )}
            <div className="flex justify-between pt-1">
              <button className="btn btn-ghost btn-sm" onClick={() => go(idx - 1)} disabled={idx === 0}>
                ← Back
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => go(cues.length)}>
                Finish
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
