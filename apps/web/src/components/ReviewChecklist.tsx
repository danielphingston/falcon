import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import {
  AREAS,
  ENGAGEMENT_KINDS,
  INDUSTRIES,
  addFollowUps,
  answerCue,
  create,
  firmCues,
  learnedFor,
  procedureLibrary,
  reviewCues,
  suggestionsFor,
  update,
  type AreaId,
  type Ctx,
  type FirmCue,
  type FirmTemplate,
  type LearnedCheck,
  type ProgramItem,
  type ProcedureFollowUp,
  type ReviewCue,
  type WorkPaper,
} from "@falcon/core";
import { act } from "../lib/act";
import { sendMessage } from "../lib/chat";
import { addLearned, linkTemplate, removeLearned, setAnswer, templateFor, useFirmAnswers, useFirmLearned, useFirmLink, useFirmTemplates } from "../lib/firm";
import { useSnapshot } from "../lib/hooks";
import { wpContext } from "../lib/review";
import { Icon } from "./Icon";
import { useTNavigate } from "./TLink";
import { ScopedReview, hasLinkedSteps } from "./ScopedReview";

const AREA_OPTIONS = (Object.keys(AREAS) as AreaId[]).filter((a) => a !== "unmapped");
type Review = ProgramItem["review"];

/** One question in the review, whatever it came from. */
interface Step {
  id: string;
  phase: "firm" | "learned" | "further";
  title: string;
  why?: string;
  group?: string;
  tests: string[];
  testsDone: boolean[];
  notes?: { label: string; text: string }[];
  review: Review;
  note?: string;
  core?: boolean;
  isNew?: boolean;
  addedOn?: string;
  notDone?: boolean;
  learned?: LearnedCheck;
  /** Further checks only: the programme cue behind it. */
  cue?: ReviewCue;
}

const PHASE: Record<Step["phase"], string> = { firm: "Firm checklist", learned: "Checks you added", further: "Further checks" };

/**
 * The reviewer's questions inside a work paper, in order: the firm template's
 * basics ("has this been done on the WP?" with its tests), then checks you
 * added on earlier reviews, then further checks from the work programme or
 * the procedure library. Answer them one at a time or as a list. Anything
 * you add is asked again next time.
 */
export function ReviewChecklist({ wp }: { wp: WorkPaper }) {
  const snap = useSnapshot();
  // Covers worksteps: the review is built from them (brief v2 A8); otherwise the area-based checklist below.
  if (snap && hasLinkedSteps(snap, wp.id)) return <ScopedReview wp={wp} snap={snap} />;
  return <AreaChecklist wp={wp} />;
}

/** The area-based checklist, for workpapers that cover no workstep (ad-hoc / not linked yet). */
function AreaChecklist({ wp }: { wp: WorkPaper }) {
  const snap = useSnapshot();
  const navigate = useTNavigate();
  const [guided, setGuided] = useState(false);
  const templates = useFirmTemplates();
  const learnedAll = useFirmLearned();
  const answers = useFirmAnswers(wp.id);
  const link = useFirmLink(wp.id);

  const c = useMemo(() => (snap ? wpContext(snap, wp) : null), [snap, wp]);
  const items = useMemo(() => (snap?.programItems ?? []).filter((i) => i.engagementId === wp.engagementId && !i.deleted), [snap, wp.engagementId]);
  const cues = useMemo(
    () => (c ? reviewCues({ library: procedureLibrary, areas: c.areas, kind: c.kind, industry: c.industry, items, workpaperId: wp.id, fromProgramme: c.hasProgramme }) : []),
    [c, items, wp.id],
  );
  const { template, linked, matches } = useMemo(() => templateFor(wp, templates, link), [wp, templates, link]);
  const area = c?.areas[0];
  const learned = useMemo(() => learnedFor(learnedAll ?? [], { id: wp.id, area }, template?.id), [learnedAll, wp.id, area, template?.id]);
  const firm = useMemo(() => firmCues(template, learned, answers ?? [], wp.id), [template, learned, answers, wp.id]);

  const steps: Step[] = useMemo(
    () => [
      ...firm.map(
        (f: FirmCue): Step => ({
          id: `firm:${f.key}`,
          phase: f.phase === "learned" ? "learned" : "firm",
          title: f.title,
          why: f.why,
          group: f.group,
          tests: f.tests,
          testsDone: f.testsDone,
          notes: f.notes,
          review: f.answer,
          note: f.note,
          isNew: f.isNew,
          addedOn: f.addedOn,
          learned: f.learnedId ? learned.find((l) => l.id === f.learnedId) : undefined,
        }),
      ),
      ...cues.map(
        (q): Step => ({
          id: `prog:${q.procedureId ?? q.itemId ?? q.text}`,
          phase: "further",
          title: q.text,
          why: q.why,
          tests: [],
          testsDone: [],
          review: q.review,
          note: q.reviewNote,
          core: q.core,
          notDone: q.status !== undefined && q.status !== "done" && q.status !== "na",
          cue: q,
        }),
      ),
    ],
    [firm, cues, learned],
  );

  if (!snap || !c) return null;

  const setArea = (a: string) => act(null, (ctx) => update(ctx, "workpapers", wp.id, { area: a || null }));
  const areaLabel = c.areas.map((a) => AREAS[a]?.label ?? a).join(" + ");
  const answered = steps.filter((s) => s.review !== "none").length;
  const flaggedCount = steps.filter((s) => s.review === "flagged").length;
  const reminders = steps.filter((s) => s.phase === "learned" && s.isNew);

  const askAi = () => {
    // Only the library / programme checks go to the AI, never the firm's checklist.
    const flagged = cues.filter((q) => q.review === "flagged");
    const lines = [
      `I'm reviewing work paper ${wp.ref} "${wp.title}" on ${c.engagementName} (${ENGAGEMENT_KINDS[c.kind]}, ${INDUSTRIES[c.industry]} industry), area: ${areaLabel || "not set"}.`,
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
        <h3 className="text-sm font-semibold">Review{template ? ` · ${template.name}` : areaLabel ? ` · ${areaLabel}` : ""}</h3>
        <span className="shrink-0 text-xs muted">
          {answered}/{steps.length} answered{flaggedCount ? ` · ${flaggedCount} flagged` : ""}
        </span>
      </div>

      <TemplateLine wp={wp} templates={templates} template={template} linked={linked} matchIds={matches.map((m) => m.id)} />
      {c.inferred && (
        <div className="flex flex-wrap items-center gap-2 text-xs muted">
          <span>{c.areas.length ? "Area guessed from the title." : "Area for further checks:"}</span>
          <AreaSelect value={c.areas[0] ?? ""} onChange={setArea} label="Change area" />
        </div>
      )}
      {c.facts
        .filter((f) => f.startsWith("Trend flag"))
        .map((f) => (
          <div key={f} className="rounded-xl bg-amber-50 px-3 py-2 text-xs dark:bg-amber-950/40">
            ⚑ {f.replace(/^Trend flag: /, "")}
          </div>
        ))}

      <AnimatePresence initial={false}>
        {reminders.length > 0 && !guided && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/40"
          >
            <p className="text-sm font-semibold">
              🔔 {reminders.length === 1 ? "A check you added is" : `${reminders.length} checks you added are`} still to be confirmed on this WP
            </p>
            <div className="mt-1.5 space-y-1.5">
              {reminders.map((s) => (
                <StepRow key={s.id} step={s} wp={wp} items={items} compact />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {steps.length === 0 ? (
        <div className="space-y-2 rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-xs muted">
          <p>Choose the firm template or the area this work paper covers, and the app will ask you, step by step, whether each check has been done on it.</p>
          <AreaSelect value="" onChange={setArea} />
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          {guided ? (
            <motion.div key="guided" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <GuidedReview steps={steps} items={items} wp={wp} template={template} area={area} onClose={() => setGuided(false)} onAskAi={askAi} />
            </motion.div>
          ) : (
            <motion.div key="list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-1.5">
              <button className="btn btn-primary btn-sm w-full" onClick={() => setGuided(true)}>
                <Icon name="review" size={14} />{" "}
                {answered ? (answered < steps.length ? "Continue guided review" : "Go through the questions again") : template ? "Start review: firm basics first" : "Start guided review"}
              </button>
              {(["firm", "learned", "further"] as const).map((phase) => {
                const list = steps.filter((s) => s.phase === phase);
                if (!list.length) return null;
                return (
                  <div key={phase} className="space-y-1.5 pt-1">
                    <p className="text-xs font-semibold uppercase tracking-wide muted">
                      {PHASE[phase]}
                      {phase === "firm" && template ? ` · ${template.name}` : phase === "further" && areaLabel ? ` · ${areaLabel}` : ""}
                    </p>
                    {phase === "further" && !c.hasProgramme && (
                      <p className="text-xs muted">From the {ENGAGEMENT_KINDS[c.kind].toLowerCase()} procedure library. Upload the TB in the engagement's Programme tab to tailor these.</p>
                    )}
                    {list.map((s) => (
                      <StepRow key={s.id} step={s} wp={wp} items={items} />
                    ))}
                  </div>
                );
              })}
              <AddCheck wp={wp} template={template} area={area} />
              <button className="btn btn-soft btn-sm w-full" onClick={askAi}>
                <Icon name="sparkles" size={14} /> Ask AI what else to check
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

// ---------- template choice ----------

function TemplateLine({
  wp,
  templates,
  template,
  linked,
  matchIds,
}: {
  wp: WorkPaper;
  templates: FirmTemplate[] | undefined;
  template: FirmTemplate | undefined;
  linked: boolean;
  matchIds: string[];
}) {
  const [choosing, setChoosing] = useState(false);
  if (!templates) return null;
  if (!templates.length)
    return <p className="text-xs muted">Import the firm's work-paper templates (Settings → Firm checklists) to be asked the firm's basics first.</p>;
  const ordered = [...templates].sort((a, b) => Number(matchIds.includes(b.id)) - Number(matchIds.includes(a.id)) || a.name.localeCompare(b.name));
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs muted">
      <span>
        🔒 {template ? (
          <>
            Firm template: <b className="text-[var(--text)]">{template.name}</b>
            {linked ? "" : " (matched from the title)"}
          </>
        ) : linked ? (
          "No firm template for this WP"
        ) : (
          "No firm template matched"
        )}
      </span>
      {choosing ? (
        <select
          className="input max-w-64 py-1 text-xs"
          autoFocus
          value={linked ? (template?.id ?? "none") : "auto"}
          onChange={(e) => {
            void linkTemplate(wp.id, e.target.value === "none" ? null : (e.target.value as string));
            setChoosing(false);
          }}
          onBlur={() => setChoosing(false)}
          aria-label="Firm template"
        >
          <option value="auto">Match automatically</option>
          <option value="none">No template</option>
          {ordered.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      ) : (
        <button className="text-[var(--accent)] underline" onClick={() => setChoosing(true)}>
          {template ? "change" : "choose"}
        </button>
      )}
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

// ---------- answering ----------

function raisePoint(wp: WorkPaper, text: string, isPrivate: boolean) {
  return act("Review point raised", async (ctx: Ctx) => {
    const r = await create(ctx, "reviewPoints", { workpaperId: wp.id, engagementId: wp.engagementId, text, ...(isPrivate ? { private: true } : {}) });
    if (wp.status !== "points_raised" && wp.myRole === "reviewer") await update(ctx, "workpapers", wp.id, { status: "points_raised" });
    return r;
  });
}

/** Saves an answer for any kind of step. "Yes, done" on a firm item ticks all its tests. */
function answerStep(step: Step, wp: WorkPaper, review: Review, note?: string) {
  if (step.cue) {
    const where = { engagementId: wp.engagementId, workpaperId: wp.id, library: procedureLibrary };
    return act(null, async (ctx) => void (await answerCue(ctx, step.cue!, where, review, note)));
  }
  const key = step.id.slice("firm:".length);
  return setAnswer(wp.id, key, {
    answer: review,
    ...(note !== undefined ? { note } : {}),
    ...(review === "ok" && step.tests.length ? { tests: step.tests.map(() => true) } : {}),
  });
}

const setTest = (step: Step, wp: WorkPaper, i: number, on: boolean) =>
  setAnswer(wp.id, step.id.slice("firm:".length), { tests: step.tests.map((_, j) => (j === i ? on : !!step.testsDone[j])) });

// ---------- list mode ----------

function StepRow({ step, wp, items, compact }: { step: Step; wp: WorkPaper; items: ProgramItem[]; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const item = step.cue?.itemId ? items.find((i) => i.id === step.cue!.itemId) : undefined;
  const isChild = !!item?.parentId;
  const doneTests = step.testsDone.filter(Boolean).length;
  const btn = (review: Review, label: string, on: string, title: string) => (
    <button
      onClick={() => void answerStep(step, wp, step.review === review ? "none" : review)}
      title={title}
      aria-pressed={step.review === review}
      className={`grid h-7 min-w-7 place-items-center rounded-md border px-1 text-xs font-bold transition-colors ${step.review === review ? on : "border-[var(--border)] muted hover:bg-[var(--surface-2)]"}`}
    >
      {label}
    </button>
  );
  return (
    <div className={isChild ? "ml-4 border-l-2 border-amber-300 pl-2" : ""}>
      <div
        className={`rounded-xl border px-3 py-2 ${step.review === "flagged" ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20" : compact ? "border-amber-200 bg-[var(--surface)] dark:border-amber-900" : "border-[var(--border)]"}`}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className={`text-sm ${step.review === "ok" || step.review === "na" ? "muted" : ""}`}>
              {step.isNew && <span className="mr-1 rounded bg-amber-500 px-1 text-[10px] font-bold uppercase text-white">new</span>}
              {step.core && <span className="mr-1 text-[10px] font-semibold uppercase text-[var(--accent)]">key</span>}
              {step.group && <span className="muted">{step.group} › </span>}
              {step.title}
              {step.notDone && step.review === "none" && <span className="ml-1 text-[10px] font-semibold uppercase text-rose-500">not done by preparer</span>}
            </p>
            {(step.tests.length > 0 || step.why || step.notes?.length || step.learned) && (
              <button className="text-xs text-[var(--accent)]" onClick={() => setOpen((v) => !v)}>
                {step.tests.length ? `${doneTests}/${step.tests.length} tests ticked` : "Details"} {open ? "▾" : "▸"}
              </button>
            )}
          </div>
          <div className="flex shrink-0 gap-1">
            {btn("ok", "✓", "border-emerald-500 bg-emerald-500 text-white", "Done on the WP")}
            {btn("flagged", "⚑", "border-amber-500 bg-amber-500 text-white", "Not done or not good enough")}
            {btn("na", "n.a.", "border-slate-400 bg-slate-400 text-white", "Not applicable")}
          </div>
        </div>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <StepDetails step={step} wp={wp} />
            </motion.div>
          )}
          {step.review === "flagged" && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              {step.cue && item ? <ProgrammeFlag step={step} item={item} items={items} wp={wp} /> : !step.cue ? <FirmFlag step={step} wp={wp} /> : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Tests to tick, why it matters, other notes; for learned checks, when and where they were added. */
function StepDetails({ step, wp }: { step: Step; wp: WorkPaper }) {
  return (
    <div className="mt-1.5 space-y-1.5 text-xs">
      {step.tests.length > 0 && (
        <ul className="space-y-1">
          {step.tests.map((t, i) => (
            <li key={i}>
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={!!step.testsDone[i]} onChange={(e) => void setTest(step, wp, i, e.target.checked)} />
                <span className={step.testsDone[i] ? "muted line-through" : ""}>{t}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {step.why && <p className="muted">Why it matters: {step.why}</p>}
      {step.notes?.map((n, i) => (
        <p key={i} className="whitespace-pre-line muted">
          <b>{n.label}:</b> {n.text}
        </p>
      ))}
      {step.learned && (
        <p className="flex items-center justify-between gap-2 muted">
          <span>
            You added this on {step.addedOn} ·{" "}
            {step.learned.workpaperId ? "this WP only" : step.learned.templateId ? "every WP on this template" : `every ${AREAS[step.learned.area as AreaId]?.label ?? step.learned.area} WP`}
          </span>
          <button className="text-rose-600 underline" onClick={() => void removeLearned(step.learned!)}>
            Stop asking
          </button>
        </p>
      )}
    </div>
  );
}

/** Firm or learned step flagged: what's missing, raise it as a review point (kept off the AI). */
function FirmFlag({ step, wp }: { step: Step; wp: WorkPaper }) {
  const [note, setNote] = useState(step.note ?? "");
  const [raised, setRaised] = useState(false);
  const saveNote = () => note !== (step.note ?? "") && void answerStep(step, wp, "flagged", note);
  const open = step.tests.filter((_, i) => !step.testsDone[i]);
  return (
    <div className="mt-2 space-y-2">
      <textarea
        className="input text-sm"
        rows={2}
        placeholder="What's missing or wrong?"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={saveNote}
      />
      <button
        className="btn btn-soft btn-sm"
        disabled={raised}
        onClick={async () => {
          saveNote();
          const detail = note.trim() || (open.length && open.length < step.tests.length ? `still open: ${open.join("; ")}` : "");
          const text = detail ? `${step.title}: ${detail}` : `Please complete: ${step.title}`;
          if (await raisePoint(wp, text, true)) setRaised(true);
        }}
      >
        <Icon name="edit" size={13} /> {raised ? "Raised as a review point" : "Raise as a review point"}
      </button>
    </div>
  );
}

/** Programme / library step flagged: note, review point, and what more to check and why. */
function ProgrammeFlag({ step, item, items, wp }: { step: Step; item: ProgramItem; items: ProgramItem[]; wp: WorkPaper }) {
  const [note, setNote] = useState(step.note ?? "");
  const [raised, setRaised] = useState(false);
  const suggestions = suggestionsFor(procedureLibrary, item, items);
  const addToProgramme = (f: ProcedureFollowUp) => act("Added to the work programme", (ctx) => addFollowUps(ctx, item, [f]));
  const saveNote = () => note !== (step.note ?? "") && void answerStep(step, wp, "flagged", note);
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
      <button
        className="btn btn-soft btn-sm"
        disabled={raised}
        onClick={async () => {
          saveNote();
          const text = note.trim() ? `${step.title}: ${note.trim()}` : `Please complete: ${step.title}`;
          if (await raisePoint(wp, text, false)) setRaised(true);
        }}
      >
        <Icon name="edit" size={13} /> {raised ? "Raised as a review point" : "Raise as a review point"}
      </button>
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
                <button className="btn btn-ghost btn-sm" onClick={() => void raisePoint(wp, `${f.text} (${f.why})`, false)}>
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

// ---------- learning: add a check for next time ----------

function AddCheck({ wp, template, area, startOpen, onDone }: { wp: WorkPaper; template?: FirmTemplate; area?: string; startOpen?: boolean; onDone?: () => void }) {
  const [open, setOpenState] = useState(!!startOpen);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    if (!v) onDone?.();
  };
  const [text, setText] = useState("");
  const scopes = [
    ...(template ? [{ id: "template", label: `Every “${template.name}” WP` }] : []),
    ...(!template && area ? [{ id: "area", label: `Every ${AREAS[area as AreaId]?.label ?? area} WP` }] : []),
    { id: "wp", label: "Only this WP" },
  ];
  const [scope, setScope] = useState(scopes[0].id);
  const save = async () => {
    if (!text.trim()) return;
    const s = scopes.some((x) => x.id === scope) ? scope : scopes[0].id;
    await addLearned(
      {
        text,
        fromWorkpaperId: wp.id,
        ...(s === "template" ? { templateId: template!.id } : s === "area" ? { area } : { workpaperId: wp.id }),
      },
      s === "wp" ? "the next time you open this WP" : s === "template" ? `on every ${template!.name} WP` : `on every ${AREAS[area as AreaId]?.label ?? area} WP`,
    );
    setText("");
    setOpen(false);
  };
  if (!open)
    return (
      <button className="btn btn-ghost btn-sm w-full" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} /> Add a check for next time
      </button>
    );
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 rounded-xl border border-dashed border-[var(--accent)] px-3 py-2">
      <p className="text-xs font-semibold">A check the app should ask about from now on</p>
      <textarea
        className="input text-sm"
        rows={2}
        autoFocus
        placeholder="e.g. Check that the ageing ties to the balance confirmations received"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-64 py-1 text-xs" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Ask this on">
          {scopes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={() => void save()}>
          Save check
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

// ---------- guided mode ----------

function GuidedReview({
  steps,
  items,
  wp,
  template,
  area,
  onClose,
  onAskAi,
}: {
  steps: Step[];
  items: ProgramItem[];
  wp: WorkPaper;
  template?: FirmTemplate;
  area?: string;
  onClose: () => void;
  onAskAi: () => void;
}) {
  const firstOpen = steps.findIndex((s) => s.review === "none");
  const [idx, setIdx] = useState(firstOpen < 0 ? 0 : firstOpen);
  const [dir, setDir] = useState(1);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const done = idx >= steps.length;
  const step = steps[Math.min(idx, steps.length - 1)];
  const item = step?.cue?.itemId ? items.find((i) => i.id === step.cue!.itemId) : undefined;

  const go = (to: number) => {
    setDir(to >= idx ? 1 : -1);
    setIdx(Math.max(0, Math.min(steps.length, to)));
    setAdding(false);
  };
  const next = () => go(idx + 1);
  const reply = async (review: Review) => {
    await answerStep(step, wp, review);
    setSkipped((s) => {
      const n = new Set(s);
      n.delete(step.id);
      return n;
    });
    if (review !== "flagged") next();
  };
  const count = (r: Review) => steps.filter((s) => s.review === r).length;
  const phaseIndex = steps.filter((s) => s.phase === step?.phase).indexOf(step);
  const phaseTotal = steps.filter((s) => s.phase === step?.phase).length;
  const enteringPhase = idx > 0 && !done && steps[idx - 1]?.phase !== step.phase;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-1" aria-label="Progress">
          {steps.map((s, i) => (
            <span key={s.id} className="contents">
              {i > 0 && steps[i - 1].phase !== s.phase && <span className="mx-0.5 h-3 w-px bg-[var(--border)]" />}
              <button
                onClick={() => go(i)}
                title={`${PHASE[s.phase]}: ${s.title}`}
                className={`h-2 rounded-full transition-all ${i === idx ? "w-5" : "w-2"} ${
                  s.review === "ok"
                    ? "bg-emerald-500"
                    : s.review === "flagged"
                      ? "bg-amber-500"
                      : s.review === "na"
                        ? "bg-slate-400"
                        : skipped.has(s.id)
                          ? "bg-rose-300"
                          : s.isNew
                            ? "bg-amber-300"
                            : "bg-[var(--border)]"
                }`}
              />
            </span>
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
              {count("ok")} done · {count("flagged")} flagged · {count("na")} n.a. · {steps.length - count("ok") - count("flagged") - count("na")} unanswered
            </p>
            {(["firm", "learned", "further"] as const).map((p) => {
              const list = steps.filter((s) => s.phase === p);
              if (!list.length) return null;
              const ok = list.filter((s) => s.review === "ok" || s.review === "na").length;
              return (
                <p key={p} className="text-xs muted">
                  {PHASE[p]}: {ok}/{list.length} cleared
                </p>
              );
            })}
            <div className="flex flex-wrap justify-center gap-1.5 pt-1">
              {count("flagged") > 0 && (
                <button className="btn btn-soft btn-sm" onClick={() => go(steps.findIndex((s) => s.review === "flagged"))}>
                  Revisit flagged
                </button>
              )}
              {steps.some((s) => s.review === "none") && (
                <button className="btn btn-soft btn-sm" onClick={() => go(steps.findIndex((s) => s.review === "none"))}>
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
            key={step.id}
            custom={dir}
            initial={{ opacity: 0, x: 24 * dir }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 * dir }}
            transition={{ duration: 0.18 }}
            className="space-y-2"
          >
            {enteringPhase && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-lg bg-[var(--surface-2)] px-2 py-1 text-xs">
                {step.phase === "learned" ? "Firm basics done. Now the checks you added on earlier reviews." : "Now the further checks for this area."}
              </motion.p>
            )}
            <p className="text-xs font-semibold uppercase tracking-wide muted">
              {PHASE[step.phase]} · {phaseIndex + 1} of {phaseTotal}
              {step.core ? " · key step" : ""}
              {step.isNew ? " · new" : ""}
            </p>
            <p className="text-sm">{step.phase === "learned" ? "You asked to be reminded. Has this been done on the work paper?" : "Has this been done on the work paper?"}</p>
            <p className="text-base font-semibold leading-snug">
              {step.group && <span className="font-normal muted">{step.group} › </span>}
              {step.title}
            </p>
            {(step.tests.length > 0 || step.why || step.notes?.length || step.learned) && <StepDetails step={step} wp={wp} />}
            {step.notDone && <p className="text-xs font-semibold text-rose-500">The preparer hasn't marked this step done.</p>}
            <div className="grid grid-cols-2 gap-1.5 pt-1 sm:grid-cols-4">
              <button className={`btn btn-sm ${step.review === "ok" ? "btn-primary" : "btn-soft"}`} onClick={() => void reply("ok")}>
                <Icon name="check" size={14} /> Yes, done
              </button>
              <button className={`btn btn-sm ${step.review === "flagged" ? "bg-amber-500 text-white" : "btn-soft"}`} onClick={() => void reply("flagged")}>
                <Icon name="flag" size={14} /> No / issue
              </button>
              <button className={`btn btn-sm ${step.review === "na" ? "btn-primary" : "btn-soft"}`} onClick={() => void reply("na")}>
                N.A.
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSkipped((s) => new Set(s).add(step.id));
                  next();
                }}
              >
                Skip
              </button>
            </div>
            {step.review === "flagged" && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="overflow-hidden">
                {step.cue && item ? <ProgrammeFlag key={step.id} step={step} item={item} items={items} wp={wp} /> : !step.cue ? <FirmFlag key={step.id} step={step} wp={wp} /> : null}
                <button className="btn btn-primary btn-sm mt-2 w-full" onClick={next}>
                  Next question
                </button>
              </motion.div>
            )}
            <Collapsible open={adding}>
              <AddCheck wp={wp} template={template} area={area} startOpen onDone={() => setAdding(false)} />
            </Collapsible>
            <div className="flex items-center justify-between pt-1">
              <button className="btn btn-ghost btn-sm" onClick={() => go(idx - 1)} disabled={idx === 0}>
                ← Back
              </button>
              {!adding && (
                <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
                  <Icon name="plus" size={13} /> New check
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => go(steps.length)}>
                Finish
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
