/**
 * Guided review built from what the workpaper covers (build brief v2 A8):
 * firm-wide basics, then one block per linked workstep (the step itself,
 * its checks, procedures and inputs), then firm-library items: those matched
 * to the step once (saved by step text, on this device) or picked from the
 * library. Nothing from the library shows unless matched or picked.
 *
 * Firm items keep their answers on this device and are never sent to the AI;
 * everything else is answered on the workpaper (synced, visible to the AI).
 */
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import {
  addCheckForNextTime,
  answerReviewItem,
  askAiPrompt,
  checkSetFor,
  create,
  draftChecksPrompt,
  geminiJson,
  matchFirmItems,
  parseDraftReply,
  saveStepChecks,
  scopedReview,
  startGuidedReview,
  stepKey,
  suggestStepChecks,
  update,
  type CheckSuggestion,
  type FirmItem,
  type FirmTemplate,
  type PlanItem,
  type ReviewItem,
  type ReviewOutcome,
  type Snapshot,
  type WorkPaper,
} from "@falcon/core";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSettings } from "../db";
import { act } from "../lib/act";
import { chatAuth, friendlyError, sendMessage } from "../lib/chat";
import { setAnswer, templateFor, useFirmAnswers, useFirmLink, useFirmTemplates } from "../lib/firm";
import { useSettings } from "../lib/hooks";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";
import { useTNavigate } from "./TLink";
import { Pill, statusTone } from "./ui";

/** One row in the scoped review: a synced item, or a firm-library item (device only). */
interface Row {
  key: string;
  text: string;
  why?: string;
  tag: string;
  answer: ReviewOutcome;
  note?: string;
  prep?: "done" | "not_done";
  stepId?: string;
  item?: ReviewItem;
  firm?: FirmItem;
  testsDone?: boolean[];
  rfiStatus?: string;
  openItems?: { text: string; rfiNumber?: string }[];
}

const TAG: Record<string, string> = { basics: "basics", workstep: "step", step: "from step", history: "history", ai: "AI draft", manual: "added", procedure: "procedure", input: "input" };

export function ScopedReview({ wp, snap }: { wp: WorkPaper; snap: Snapshot }) {
  const settings = useSettings();
  const navigate = useTNavigate();
  const templates = useFirmTemplates();
  const link = useFirmLink(wp.id);
  const firmAnswers = useFirmAnswers(wp.id);
  const stepItems = useLiveQuery(() => db.firmStepItems.toArray(), []);
  const { template } = useMemo(() => templateFor(wp, templates, link), [wp, templates, link]);
  const review = useMemo(() => scopedReview(snap, wp, settings), [snap, wp, settings]);
  const [guided, setGuided] = useState(false);
  const [openSteps, setOpenSteps] = useState<Set<string>>(() => new Set(review.steps.length <= 1 ? review.steps.map((s) => s.step.id) : []));

  const fAns = new Map((firmAnswers ?? []).map((a) => [a.key, a]));
  const tmplById = new Map((templates ?? []).map((t) => [t.id, t]));
  const firmFor = (key: string): FirmItem[] => {
    const rec = stepItems?.find((x) => x.key === key);
    const t = rec ? tmplById.get(rec.templateId) : undefined;
    return rec && t ? rec.itemKeys.map((k) => t.items.find((i) => i.key === k)).filter((i): i is FirmItem => !!i) : [];
  };
  const firmRow = (it: FirmItem, stepId?: string): Row => {
    const a = fAns.get(it.key);
    return { key: `firm:${it.key}`, text: it.title, why: it.why, tag: "firm", answer: a?.answer ?? "none", note: a?.note, stepId, firm: it, testsDone: it.tests.map((_, i) => !!a?.tests?.[i]) };
  };
  const synced = (i: ReviewItem): Row => ({ key: i.key, text: i.text, why: i.why, tag: TAG[i.source] ?? i.source, answer: i.answer, note: i.note, prep: i.prep, stepId: i.stepId, item: i, rfiStatus: i.rfiStatus, openItems: i.openItems });

  const basics = review.basics.map(synced);
  const blocks = review.steps.map((s) => ({ ...s, rows: [...s.items.map(synced), ...firmFor(`step:${stepKey(s.step.text)}`).map((f) => firmRow(f, s.step.id))] }));
  const picked = firmFor(`wp:${wp.id}`).map((f) => firmRow(f));
  const shownFirm = new Set([...blocks.flatMap((b) => b.rows), ...picked].filter((r) => r.firm).map((r) => r.firm!.key));
  // Answers given before the review was scoped (against the area template) stay visible.
  const other = (firmAnswers ?? []).filter((a) => a.answer !== "none" && !a.key.startsWith("learned:") && !shownFirm.has(a.key));
  const all = [...basics, ...blocks.flatMap((b) => b.rows), ...picked];
  const answered = all.filter((r) => r.answer !== "none").length;
  const flagged = all.filter((r) => r.answer === "flagged").length;
  const engName = snap.engagements.find((e) => e.id === wp.engagementId)?.name ?? "the engagement";

  const askAi = () => {
    navigate("/chat");
    void sendMessage(askAiPrompt(wp, review, engName));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Review · {review.steps.length === 1 ? `step ${review.steps[0].step.number || shortLabel(review.steps[0].step)}` : `${review.steps.length} steps`}</h3>
        <span className="shrink-0 text-xs muted">
          {answered}/{all.length} answered{flagged ? ` · ${flagged} flagged` : ""}
        </span>
      </div>
      <p className="text-xs muted">Built from the worksteps this workpaper covers.{template ? ` Firm library: ${template.name}.` : ""}</p>

      {guided ? (
        <Walk rows={all} wp={wp} onClose={() => setGuided(false)} onAskAi={askAi} />
      ) : (
        <>
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={() => {
              setGuided(true);
              if (!wp.reviewStartedAt) void act(null, (ctx) => startGuidedReview(ctx, wp.id).then(() => undefined));
            }}
          >
            <Icon name="review" size={14} /> {answered ? (answered < all.length ? "Continue review" : "Go through again") : "Start review: basics first"}
          </button>

          <Group title="Basics" hint="Every workpaper">
            {basics.map((r) => (
              <ItemRow key={r.key} r={r} wp={wp} />
            ))}
          </Group>

          {blocks.map((b) => {
            const open = openSteps.has(b.step.id);
            const done = b.rows.filter((r) => r.answer !== "none").length;
            return (
              <div key={b.step.id} className="rounded-xl border border-[var(--border)]">
                <button
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  onClick={() => {
                    const n = new Set(openSteps);
                    if (n.has(b.step.id)) n.delete(b.step.id);
                    else n.add(b.step.id);
                    setOpenSteps(n);
                  }}
                  aria-expanded={open}
                >
                  <span className="min-w-0 text-sm font-semibold">
                    {open ? "▾" : "▸"} {b.step.number && <span className="font-mono text-xs muted">{b.step.number} </span>}
                    {shortLabel(b.step)}
                  </span>
                  <span className="shrink-0 text-xs muted">
                    {done}/{b.rows.length}
                  </span>
                </button>
                {open && (
                  <div className="space-y-1.5 px-2 pb-2">
                    {b.needsChecks && <StepSetup step={b.step} snap={snap} template={template} />}
                    {b.rows.map((r) => (
                      <ItemRow key={r.key} r={r} wp={wp} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {template && <LibraryPicker wp={wp} template={template} shown={shownFirm} />}
          {picked.length > 0 && (
            <Group title={`From the ${template?.name ?? "firm"} library`} hint="Added to this workpaper">
              {picked.map((r) => (
                <ItemRow key={r.key} r={r} wp={wp} />
              ))}
            </Group>
          )}
          {other.length > 0 && (
            <Group title="Other checks answered" hint="Answered before the review was scoped to the steps">
              {other.map((a) => {
                const it = template?.items.find((i) => i.key === a.key);
                return (
                  <p key={a.key} className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-xs">
                    {a.answer === "ok" ? "✓" : a.answer === "flagged" ? "⚑" : "n.a."} {it?.title ?? a.key}
                    {a.note && <span className="muted"> · {a.note}</span>}
                  </p>
                );
              })}
            </Group>
          )}

          <NextTime wp={wp} steps={review.steps.map((s) => s.step)} />
          <button className="btn btn-soft btn-sm w-full" onClick={askAi}>
            <Icon name="sparkles" size={14} /> Ask AI what else to check
          </button>
        </>
      )}
    </div>
  );
}

const shortLabel = (s: PlanItem) => {
  const t = s.text.split("\n")[0];
  return t.length > 70 ? `${t.slice(0, 67)}…` : t;
};

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 pt-1">
      <p className="text-xs font-semibold uppercase tracking-wide muted">
        {title}
        {hint && <span className="font-normal normal-case"> · {hint}</span>}
      </p>
      {children}
    </div>
  );
}

// ---------- answering ----------

async function answer(wp: WorkPaper, r: Row, change: { answer?: ReviewOutcome; note?: string; prep?: "done" | "not_done" | null }) {
  if (r.firm) {
    // Firm items: answer on this device; ⚑ raises a private point (kept off the AI), owned by the preparer.
    await setAnswer(wp.id, r.firm.key, {
      ...(change.answer !== undefined ? { answer: change.answer } : {}),
      ...(change.note !== undefined ? { note: change.note } : {}),
      ...(change.answer === "ok" && r.firm.tests.length ? { tests: r.firm.tests.map(() => true) } : {}),
    });
    if (change.answer === "flagged" && r.answer !== "flagged")
      await act("Review point raised", async (ctx) => {
        const step = r.stepId ? await ctx.store.get("planItems", r.stepId) : undefined;
        const pt = await create(ctx, "reviewPoints", { workpaperId: wp.id, engagementId: wp.engagementId, text: `${step?.number ? `${step.number} · ` : ""}${r.text}: please complete`, planItemId: step?.id, private: true });
        if (wp.myRole === "reviewer" && wp.status !== "points_raised") await update(ctx, "workpapers", wp.id, { status: "points_raised" });
        return pt;
      });
    return;
  }
  const flaggedNow = change.answer === "flagged" && r.answer !== "flagged";
  await act(flaggedNow ? "Review point raised for the preparer" : null, (ctx) =>
    answerReviewItem(ctx, wp.id, r.key, { ...change, itemText: r.item?.kind === "step" ? `Step: ${r.text}` : r.text, stepId: r.stepId }).then(() => undefined),
  );
}

function ItemRow({ r, wp }: { r: Row; wp: WorkPaper }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(r.note ?? "");
  const btn = (o: ReviewOutcome, label: string, on: string, title: string) => (
    <button
      onClick={() => void answer(wp, r, { answer: r.answer === o ? "none" : o })}
      title={title}
      aria-pressed={r.answer === o}
      className={`grid h-7 min-w-7 place-items-center rounded-md border px-1 text-xs font-bold transition-colors ${r.answer === o ? on : "border-[var(--border)] muted hover:bg-[var(--surface-2)]"}`}
    >
      {label}
    </button>
  );
  const details = !!(r.why || r.firm?.tests.length || r.firm?.notes?.length || r.openItems?.length || r.item);
  return (
    <div className={`rounded-xl border px-3 py-2 ${r.answer === "flagged" ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20" : "border-[var(--border)]"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${r.answer === "ok" || r.answer === "na" ? "muted" : ""} ${r.item?.kind === "step" ? "font-medium" : ""}`}>
            <span className={`mr-1 rounded px-1 text-[10px] font-semibold uppercase ${r.firm ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" : "bg-[var(--surface-2)] muted"}`}>{r.firm ? "🔒 firm" : r.tag}</span>
            {r.text}
            {r.rfiStatus && (
              <span className="ml-1">
                <Pill tone={statusTone[r.rfiStatus]}>{r.rfiStatus}</Pill>
              </span>
            )}
            {r.prep === "not_done" && <span className="ml-1 text-[10px] font-semibold uppercase text-rose-500">not done by preparer</span>}
          </p>
          {r.prep === "not_done" && r.openItems?.length ? (
            <p className="text-xs text-rose-600 dark:text-rose-400">
              Why: {r.openItems.map((o) => `${o.text}${o.rfiNumber ? ` (RFI ${o.rfiNumber})` : ""}`).join("; ")}
            </p>
          ) : null}
          {details && (
            <button className="text-xs text-[var(--accent)]" onClick={() => setOpen((v) => !v)}>
              {r.firm?.tests.length ? `${r.testsDone?.filter(Boolean).length ?? 0}/${r.firm.tests.length} tests` : "Details"} {open ? "▾" : "▸"}
            </button>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          {btn("ok", "✓", "border-emerald-500 bg-emerald-500 text-white", "Done on the WP")}
          {btn("flagged", "⚑", "border-amber-500 bg-amber-500 text-white", "Not done or not good enough: raises a review point for the preparer")}
          {btn("na", "n.a.", "border-slate-400 bg-slate-400 text-white", "Not applicable")}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-1.5 space-y-1.5 text-xs">
              {r.firm?.tests.map((t, i) => (
                <label key={i} className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!!r.testsDone?.[i]}
                    onChange={(e) => void setAnswer(wp.id, r.firm!.key, { tests: r.firm!.tests.map((_, j) => (j === i ? e.target.checked : !!r.testsDone?.[j])) })}
                  />
                  <span className={r.testsDone?.[i] ? "muted line-through" : ""}>{t}</span>
                </label>
              ))}
              {r.why && <p className="whitespace-pre-line muted">{r.item?.kind === "step" ? r.why : `Why: ${r.why}`}</p>}
              {r.firm?.notes?.map((n, i) => (
                <p key={i} className="whitespace-pre-line muted">
                  <b>{n.label}:</b> {n.text}
                </p>
              ))}
              {!r.firm && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="muted">Preparer:</span>
                  {(["done", "not_done"] as const).map((p) => (
                    <button key={p} className={`rounded-md border px-1.5 py-0.5 ${r.prep === p ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)] muted"}`} onClick={() => void answer(wp, r, { prep: r.prep === p ? null : p })}>
                      {p === "done" ? "done" : "not done"}
                    </button>
                  ))}
                </div>
              )}
              <textarea className="input text-sm" rows={2} placeholder="Note (what's missing or wrong)" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (r.note ?? "") && void answer(wp, r, { note })} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- one-time set-up of a step's checks ----------

function StepSetup({ step, snap, template }: { step: PlanItem; snap: Snapshot; template?: FirmTemplate }) {
  const firm = useMemo(() => (template ? matchFirmItems(step.text, template.items) : []), [step.text, template]);
  const [drafts, setDrafts] = useState<CheckSuggestion[]>([]);
  const own = useMemo(() => suggestStepChecks(step, snap), [step, snap]);
  const list = [...own, ...drafts];
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const inputs = step.inputs?.source === "manual" ? step.inputs.rfiIds.length : 0;

  const draft = async () => {
    const auth = await chatAuth();
    if (typeof auth === "string") return toast({ message: auth, tone: "error" });
    setBusy(true);
    try {
      const s = await getSettings();
      const eng = snap.engagements.find((e) => e.id === step.engagementId);
      const reply = await geminiJson(auth, s.geminiModel, draftChecksPrompt({ step: step.text, procedures: (step.procedures ?? []).map((p) => p.text), engagementType: eng?.type }));
      const got = parseDraftReply(reply).map((c): CheckSuggestion => ({ ...c, source: "ai", reason: "Drafted by AI from the step text." }));
      if (!got.length) toast({ message: "The AI didn't suggest any checks. Try again." });
      setDrafts(got);
    } catch (e) {
      toast({ message: friendlyError(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    const keep = list.filter((c) => !off.has(`s:${c.text}`)).map((c) => ({ text: c.text, why: c.why, source: c.source }));
    const firmKeep = firm.filter((f) => !off.has(`f:${f.key}`)).map((f) => f.key);
    const res = await act("Review checks saved for this step", (ctx) => saveStepChecks(ctx, step, keep));
    if (res && template && firmKeep.length) await db.firmStepItems.put({ key: `step:${stepKey(step.text)}`, templateId: template.id, itemKeys: firmKeep, at: new Date().toISOString() });
  };
  const tick = (k: string) => {
    const n = new Set(off);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setOff(n);
  };
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-[var(--accent)] px-3 py-2">
      <p className="text-xs font-semibold">Checks for this step (asked once; every workpaper and engagement with this step gets them)</p>
      {firm.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide muted">🔒 Firm library{template ? ` · ${template.name}` : ""}</p>
          {firm.map((f) => (
            <label key={f.key} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={!off.has(`f:${f.key}`)} onChange={() => tick(`f:${f.key}`)} />
              <span>
                {f.title}
                <span className="block text-xs muted">{f.reason}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {list.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide muted">From the step, history and AI</p>
          {list.map((c) => (
            <label key={c.text} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={!off.has(`s:${c.text}`)} onChange={() => tick(`s:${c.text}`)} />
              <span>
                {c.text}
                <span className="block text-xs muted">{c.reason}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {inputs > 0 && <p className="text-xs muted">The step's {inputs} confirmed input{inputs === 1 ? "" : "s"} are checked too (“received and used”), with their RFI status.</p>}
      {!firm.length && !list.length && <p className="text-xs muted">Nothing in the library or the step text to suggest.</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary btn-sm" onClick={() => void save()}>
          Save {list.filter((c) => !off.has(`s:${c.text}`)).length + firm.filter((f) => !off.has(`f:${f.key}`)).length} checks
        </button>
        {!drafts.length && (
          <button className="btn btn-soft btn-sm" disabled={busy} onClick={() => void draft()}>
            <Icon name="sparkles" size={13} /> {busy ? "Drafting…" : "Draft checks with AI"}
          </button>
        )}
      </div>
      {!drafts.length && <p className="text-[11px] muted">AI drafts use the step text and procedures only, never the firm library.</p>}
    </div>
  );
}

// ---------- library picker, next time, guided walk ----------

function LibraryPicker({ wp, template, shown }: { wp: WorkPaper; template: FirmTemplate; shown: Set<string> }) {
  const [open, setOpen] = useState(false);
  const left = template.items.filter((i) => !shown.has(i.key));
  if (!left.length) return null;
  const add = async (key: string) => {
    const k = `wp:${wp.id}`;
    const cur = await db.firmStepItems.get(k);
    await db.firmStepItems.put({ key: k, templateId: template.id, itemKeys: [...new Set([...(cur?.templateId === template.id ? cur.itemKeys : []), key])], at: new Date().toISOString() });
  };
  return open ? (
    <div className="space-y-1 rounded-xl border border-[var(--border)] p-2">
      <p className="text-xs font-semibold">Add checks from the {template.name} library</p>
      <div className="max-h-56 space-y-0.5 overflow-y-auto">
        {left.map((i) => (
          <button key={i.key} className="block w-full rounded-lg px-2 py-1 text-left text-sm hover:bg-[var(--surface-2)]" onClick={() => void add(i.key)}>
            + {i.group && <span className="muted">{i.group} › </span>}
            {i.title}
          </button>
        ))}
      </div>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
        Done
      </button>
    </div>
  ) : (
    <button className="btn btn-ghost btn-sm w-full" onClick={() => setOpen(true)}>
      <Icon name="plus" size={14} /> Add checks from the {template.name} library ({left.length})
    </button>
  );
}

/** "Add a check for next time": saved as a procedure on the workstep, so the next workpaper and engagement get it. */
function NextTime({ wp, steps }: { wp: WorkPaper; steps: PlanItem[] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [stepId, setStepId] = useState(steps[0]?.id ?? "");
  if (!open)
    return (
      <button className="btn btn-ghost btn-sm w-full" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} /> Add a check for next time
      </button>
    );
  const save = async () => {
    if (!text.trim() || !stepId) return;
    if (await act("Saved on the step for next time", (ctx) => addCheckForNextTime(ctx, stepId, text, undefined, wp))) {
      setText("");
      setOpen(false);
    }
  };
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-[var(--accent)] px-3 py-2">
      <p className="text-xs font-semibold">A check to ask next time (saved as a procedure on the step)</p>
      <textarea className="input text-sm" rows={2} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Tie the MoM totals to the invoicing sheet for every month" />
      <div className="flex flex-wrap gap-2">
        {steps.length > 1 && (
          <select className="input max-w-64 py-1 text-xs" value={stepId} onChange={(e) => setStepId(e.target.value)} aria-label="Step">
            {steps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.number} {shortLabel(s)}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={() => void save()}>
          Save check
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Walk({ rows, wp, onClose, onAskAi }: { rows: Row[]; wp: WorkPaper; onClose: () => void; onAskAi: () => void }) {
  const first = rows.findIndex((r) => r.answer === "none");
  const [idx, setIdx] = useState(first < 0 ? 0 : first);
  const done = idx >= rows.length;
  const r = rows[Math.min(idx, rows.length - 1)];
  const reply = async (o: ReviewOutcome) => {
    await answer(wp, r, { answer: o });
    if (o !== "flagged") setIdx(idx + 1);
  };
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-1 flex-wrap gap-1" aria-label="Progress">
          {rows.map((x, i) => (
            <button
              key={x.key}
              onClick={() => setIdx(i)}
              title={x.text}
              className={`h-2 rounded-full ${i === idx ? "w-5" : "w-2"} ${x.answer === "ok" ? "bg-emerald-500" : x.answer === "flagged" ? "bg-amber-500" : x.answer === "na" ? "bg-slate-400" : "bg-[var(--border)]"}`}
            />
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          List view
        </button>
      </div>
      {done || !r ? (
        <div className="space-y-2 py-2 text-center">
          <p className="font-semibold">Review pass complete</p>
          <p className="text-sm muted">
            {rows.filter((x) => x.answer === "ok").length} done · {rows.filter((x) => x.answer === "flagged").length} flagged · {rows.filter((x) => x.answer === "none").length} unanswered
          </p>
          <button className="btn btn-soft btn-sm" onClick={onAskAi}>
            <Icon name="sparkles" size={13} /> Ask AI what else to check
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide muted">
            {r.firm ? "🔒 Firm library" : r.tag} · {idx + 1} of {rows.length}
          </p>
          <p className="text-sm">Has this been done on the work paper?</p>
          <p className="text-base font-semibold leading-snug">{r.text}</p>
          {r.why && <p className="whitespace-pre-line text-xs muted">{r.why}</p>}
          {r.prep === "not_done" && <p className="text-xs font-semibold text-rose-500">Not done by preparer{r.openItems?.length ? `: ${r.openItems.map((o) => o.text).join("; ")}` : ""}</p>}
          <div className="grid grid-cols-2 gap-1.5 pt-1 sm:grid-cols-4">
            <button className={`btn btn-sm ${r.answer === "ok" ? "btn-primary" : "btn-soft"}`} onClick={() => void reply("ok")}>
              <Icon name="check" size={14} /> Yes, done
            </button>
            <button className={`btn btn-sm ${r.answer === "flagged" ? "bg-amber-500 text-white" : "btn-soft"}`} onClick={() => void reply("flagged")}>
              <Icon name="flag" size={14} /> No / issue
            </button>
            <button className={`btn btn-sm ${r.answer === "na" ? "btn-primary" : "btn-soft"}`} onClick={() => void reply("na")}>
              N.A.
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setIdx(idx + 1)}>
              Skip
            </button>
          </div>
          {r.answer === "flagged" && <p className="text-xs text-amber-700 dark:text-amber-300">A review point was raised for the preparer. Add detail in the list view's note.</p>}
          <div className="flex justify-between pt-1">
            <button className="btn btn-ghost btn-sm" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
              ← Back
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setIdx(rows.length)}>
              Finish
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Whether a workpaper's review is scoped to steps (it covers at least one). */
export const hasLinkedSteps = (snap: Snapshot, wpId: string) => snap.planItems.some((s) => s.workpaperId === wpId);
export { checkSetFor };
