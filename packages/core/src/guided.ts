/**
 * Guided review scoped to what a workpaper covers (build brief v2 A8).
 *
 * The checklist is built from the workpaper's linked worksteps, not its area:
 *   1. Basics: a short firm-wide list for every workpaper (a synced setting).
 *   2. Per linked step: the step itself as the headline check, then its
 *      checks: saved once per step text at firm level (so the next workpaper
 *      or engagement with the same step gets them with no question), the
 *      step's procedures, and its RFI inputs ("received and used").
 *   3. Firm-library items the reviewer picks or matched to the step: these
 *      stay on the device (firm material, never synced or sent to the AI);
 *      the app merges them in, this module only knows their keys.
 *
 * Answers to everything except firm items are stored on the workpaper
 * (`reviewAnswers`), so they sync and the AI connection can read them.
 */
import { create, newId, update, type Ctx } from "./actions";
import { stepsOf, shortTitle } from "./chain";
import { rfiTitle } from "./rfi";
import type { InfoRequest, PlanItem, ReviewPoint, Settings, WorkPaper } from "./schema";
import type { Snapshot } from "./store";

export const DEFAULT_BASICS = ["Period covered", "Figures agree to BoA / TB", "Sources and RFI items referenced", "Casting and formulas checked", "Conclusion and open items written"];

export type ReviewAnswer = NonNullable<WorkPaper["reviewAnswers"]>[number];
export type ReviewOutcome = ReviewAnswer["answer"];

/** A step's text as a firm-level key: lower case words of its first line, no numbers or punctuation. */
export function stepKey(text: string): string {
  return text
    .split("\n")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b\d+(\.\d+)*\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
const STOP = new Set("the and for with from all any are was has have this that per its into vs check review verify obtain details along other if".split(" "));
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / Math.max(1, new Set([...a, ...b]).size);
};

/** The saved check set for a step: same text, or a very similar one (the plan is reused across engagements). */
export function checkSetFor(step: Pick<PlanItem, "text">, sets: Snapshot["checkSets"]) {
  const k = stepKey(step.text);
  const exact = sets.find((s) => !s.deleted && s.key === k);
  if (exact) return exact;
  const w = words(k);
  let best: (typeof sets)[number] | undefined;
  let score = 0;
  for (const s of sets) {
    if (s.deleted) continue;
    const j = jaccard(w, words(s.key));
    if (j > score) [best, score] = [s, j];
  }
  return score >= 0.8 ? best : undefined;
}

// ---------- Suggestions (once per step text) ----------

export interface CheckSuggestion {
  text: string;
  why?: string;
  source: "step" | "history" | "ai" | "manual";
  /** One line on where it came from. */
  reason: string;
}

/**
 * The checks a step's own text names: "Invoicing check - client-wise MoM,
 * recurring and non-recurring, BoA vs invoicing sheet" → client-wise MoM;
 * recurring and non-recurring; BoA vs invoicing sheet.
 */
export function stepParts(text: string): string[] {
  const first = text.split("\n")[0];
  const rest = text.split("\n").slice(1).map((l) => l.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean);
  const body = first.includes(" - ") || first.includes(" – ") ? first.split(/\s[-–]\s/).slice(1).join(" - ") : first;
  const parts = body
    .split(/[,;]|\band\s+(?=[A-Z])/)
    .map((p) => p.trim().replace(/[.:]$/, ""))
    .filter((p) => p.length >= 4);
  const all = [...(parts.length >= 2 ? parts : []), ...rest];
  return [...new Map(all.map((p) => [p.toLowerCase(), p])).values()].slice(0, 8);
}

/** History: review points raised on steps with the same text, here or on earlier engagements. */
export function historyChecks(step: PlanItem, snap: Pick<Snapshot, "reviewPoints" | "planItems" | "engagements">): CheckSuggestion[] {
  const k = stepKey(step.text);
  const sameSteps = new Map(snap.planItems.filter((s) => !s.deleted && stepKey(s.text) === k).map((s) => [s.id, s]));
  const eng = new Map(snap.engagements.map((e) => [e.id, e.name]));
  const seen = new Set<string>();
  const out: CheckSuggestion[] = [];
  for (const p of snap.reviewPoints) {
    if (p.deleted || p.private || !p.planItemId || !sameSteps.has(p.planItemId)) continue;
    const t = p.text.split("\n")[0].replace(/^[\d.]+\s*·\s*/, "").trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push({ text: t, source: "history", reason: `Raised as a review point${sameSteps.get(p.planItemId)!.engagementId !== step.engagementId ? ` on ${eng.get(sameSteps.get(p.planItemId)!.engagementId) ?? "another engagement"}` : " earlier"}.` });
  }
  return out.slice(0, 6);
}

/** Suggestions from the step itself and history (firm-library matches are added by the app, on the device). */
export function suggestStepChecks(step: PlanItem, snap: Pick<Snapshot, "reviewPoints" | "planItems" | "engagements">): CheckSuggestion[] {
  const parts = stepParts(step.text).map((t): CheckSuggestion => ({ text: t, source: "step", reason: "Named in the step." }));
  const merged = new Map<string, CheckSuggestion>();
  for (const c of [...parts, ...historyChecks(step, snap)]) {
    const k = c.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!merged.has(k)) merged.set(k, c);
  }
  return [...merged.values()];
}

/** Saves the checks the reviewer kept for a step, at firm level (by step text). */
export async function saveStepChecks(ctx: Ctx, step: PlanItem, checks: { text: string; why?: string; source: CheckSuggestion["source"] }[]) {
  const sets = await ctx.store.list("checkSets");
  const cur = checkSetFor(step, sets);
  const list = checks.map((c) => ({ id: newId(), text: c.text.trim(), why: c.why?.trim() || undefined, source: c.source })).filter((c) => c.text);
  if (cur) return update(ctx, "checkSets", cur.id, { checks: [...cur.checks, ...list.filter((c) => !cur.checks.some((x) => x.text.toLowerCase() === c.text.toLowerCase()))] });
  return create(ctx, "checkSets", { key: stepKey(step.text), stepText: step.text.split("\n")[0], checks: list });
}

// ---------- The review a workpaper shows ----------

export interface ReviewItem {
  /** Answer key: basic:<i>, step:<stepId>, check:<stepId>:<checkId>, proc:<stepId>:<procId>, input:<stepId>:<rfiId>. */
  key: string;
  kind: "basic" | "step" | "check" | "procedure" | "input";
  text: string;
  why?: string;
  /** Where it came from, for the reader. */
  source: "basics" | "workstep" | "step" | "history" | "ai" | "manual" | "procedure" | "input";
  stepId?: string;
  answer: ReviewOutcome;
  note?: string;
  /** Preparer's mark: done / not done on the workpaper. */
  prep?: "done" | "not_done";
  pointId?: string;
  /** Inputs: the RFI item's status. */
  rfiStatus?: InfoRequest["status"];
  rfiNumber?: string;
  /** Open items on the workpaper that explain a "not done" (A8 preparer flag). */
  openItems?: { text: string; rfiNumber?: string }[];
}

export interface ScopedReview {
  basics: ReviewItem[];
  steps: { step: PlanItem; items: ReviewItem[]; needsChecks: boolean }[];
  answered: number;
  total: number;
  startedAt?: string;
  points: { open: number; cleared: number };
}

const OUTCOME_LABEL: Record<ReviewOutcome, string> = { none: "pending", ok: "✓", flagged: "⚑", na: "n.a." };
export const outcomeLabel = (o: ReviewOutcome) => OUTCOME_LABEL[o];

/** The scoped review for a workpaper (no firm items: the app adds those on the device). */
export function scopedReview(snap: Pick<Snapshot, "planItems" | "checkSets" | "infoRequests" | "reviewPoints">, wp: WorkPaper, settings: Pick<Settings, "reviewBasics">): ScopedReview {
  const answers = new Map((wp.reviewAnswers ?? []).map((a) => [a.key, a]));
  const rfi = new Map(snap.infoRequests.filter((r) => !r.deleted).map((r) => [r.id, r]));
  const open = (wp.openItems ?? []).filter((o) => !o.resolved);
  const item = (base: Omit<ReviewItem, "answer">): ReviewItem => {
    const a = answers.get(base.key);
    const it: ReviewItem = { ...base, answer: a?.answer ?? "none", note: a?.note, prep: a?.prep, pointId: a?.pointId };
    if (it.prep === "not_done") it.openItems = explainNotDone(it, open, rfi);
    return it;
  };
  const basics = (settings.reviewBasics?.length ? settings.reviewBasics : DEFAULT_BASICS).map((t, i) => item({ key: `basic:${i}`, kind: "basic", text: t, source: "basics" }));
  const steps = stepsOf(wp.id, snap.planItems).map((s) => {
    const set = checkSetFor(s, snap.checkSets);
    const items: ReviewItem[] = [item({ key: `step:${s.id}`, kind: "step", text: shortTitle(s.text), why: s.text.includes("\n") || s.text.length > 70 ? s.text : undefined, source: "workstep", stepId: s.id })];
    for (const c of set?.checks ?? []) items.push(item({ key: `check:${s.id}:${c.id}`, kind: "check", text: c.text, why: c.why, source: c.source, stepId: s.id }));
    for (const p of s.procedures ?? []) items.push(item({ key: `proc:${s.id}:${p.id}`, kind: "procedure", text: p.text.split("\n")[0], why: p.why, source: "procedure", stepId: s.id }));
    if (s.inputs?.source === "manual" && !s.inputs.none)
      for (const id of s.inputs.rfiIds) {
        const r = rfi.get(id);
        if (r) items.push({ ...item({ key: `input:${s.id}:${id}`, kind: "input", text: `Input received and used: ${rfiTitle(r.description)}`, source: "input", stepId: s.id }), rfiStatus: r.status, rfiNumber: r.number });
      }
    return { step: s, items, needsChecks: !set };
  });
  const all = [...basics, ...steps.flatMap((x) => x.items)];
  const pts = snap.reviewPoints.filter((p) => !p.deleted && p.workpaperId === wp.id);
  return {
    basics,
    steps,
    answered: all.filter((i) => i.answer !== "none").length,
    total: all.length,
    startedAt: wp.reviewStartedAt,
    points: { open: pts.filter((p) => p.status !== "cleared").length, cleared: pts.filter((p) => p.status === "cleared").length },
  };
}

/** Open items that explain why something isn't done: same RFI item for inputs, else shared words. */
export function explainNotDone(it: Pick<ReviewItem, "kind" | "text" | "key">, open: NonNullable<WorkPaper["openItems"]>, rfi: Map<string, InfoRequest>) {
  const rfiId = it.kind === "input" ? it.key.split(":")[2] : undefined;
  const w = words(it.text);
  return open
    .filter((o) => (rfiId && o.rfiItemId === rfiId) || [...words(o.text)].filter((x) => w.has(x)).length >= 1)
    .map((o) => ({ text: o.text, rfiNumber: o.rfiItemId ? rfi.get(o.rfiItemId)?.number : undefined }));
}

// ---------- Answering ----------

/**
 * Records an answer (outcome, note and / or the preparer's mark). ⚑ raises a
 * review point on the workpaper (once), owned by the preparer, with the step
 * number and the item as context.
 */
export async function answerReviewItem(
  ctx: Ctx,
  wpId: string,
  key: string,
  change: { answer?: ReviewOutcome; note?: string; prep?: "done" | "not_done" | null; itemText?: string; stepId?: string; pointText?: string },
) {
  const wp = await ctx.store.get("workpapers", wpId);
  if (!wp || wp.deleted) throw new Error(`No work paper ${wpId}`);
  const at = (ctx.now?.() ?? new Date()).toISOString();
  const list = [...(wp.reviewAnswers ?? [])];
  const i = list.findIndex((a) => a.key === key);
  const cur: ReviewAnswer = i >= 0 ? list[i] : { key, answer: "none", at };
  const next: ReviewAnswer = { ...cur, at };
  if (change.answer !== undefined) next.answer = change.answer;
  if (change.note !== undefined) next.note = change.note || undefined;
  if (change.prep !== undefined) next.prep = change.prep ?? undefined;
  let point: ReviewPoint | undefined;
  if (next.answer === "flagged" && !cur.pointId) {
    const step = change.stepId ? await ctx.store.get("planItems", change.stepId) : undefined;
    const label = change.itemText ?? key;
    const text = change.pointText ?? `${step?.number ? `${step.number} · ` : ""}${label}${next.note ? `: ${next.note}` : ": please complete"}`;
    point = (await create(ctx, "reviewPoints", { workpaperId: wp.id, engagementId: wp.engagementId, text, planItemId: step?.id })).record;
    next.pointId = point.id;
  }
  if (i >= 0) list[i] = next;
  else list.push(next);
  const r = await update(ctx, "workpapers", wp.id, {
    reviewAnswers: list,
    reviewStartedAt: wp.reviewStartedAt ?? at,
    ...(point && wp.myRole === "reviewer" && wp.status !== "points_raised" ? { status: "points_raised" as const } : {}),
  });
  return { workpaper: r.record, point };
}

/** "Add a check for next time": a procedure on the workstep, so the next workpaper and engagement get it. */
export async function addCheckForNextTime(ctx: Ctx, stepId: string, text: string, why: string | undefined, fromWp: Pick<WorkPaper, "ref">) {
  const s = await ctx.store.get("planItems", stepId);
  if (!s || s.deleted) throw new Error(`No workstep ${stepId}`);
  return update(ctx, "planItems", s.id, { procedures: [...(s.procedures ?? []), { id: newId(), text: text.trim(), why: why?.trim() || undefined, done: false, addedFromReview: fromWp.ref }] });
}

/** Starts a guided review on a workpaper (stamps when). */
export async function startGuidedReview(ctx: Ctx, wpId: string) {
  const wp = await ctx.store.get("workpapers", wpId);
  if (!wp || wp.deleted) throw new Error(`No work paper ${wpId}`);
  if (wp.reviewStartedAt) return { workpaper: wp };
  return { workpaper: (await update(ctx, "workpapers", wp.id, { reviewStartedAt: (ctx.now?.() ?? new Date()).toISOString() })).record };
}

// ---------- Firm-library matching (keywords only: firm items never go to the AI) ----------

/**
 * Firm-library items that fit a step, by the words they share (title,
 * tests, why). "MoM" in the step finds "Month on month analysis" through a
 * small list of common abbreviations. Runs on the device.
 */
export function matchFirmItems(stepText: string, items: { key: string; title: string; tests?: string[]; why?: string }[], max = 4): { key: string; title: string; reason: string }[] {
  const expand = (s: string) => {
    let t = s.toLowerCase();
    for (const [re, full] of ABBR) t = t.replace(re, ` ${full} `);
    return t;
  };
  const w = words(expand(stepText));
  return items
    .map((it) => {
      const title = words(expand(it.title));
      const body = words(expand([...(it.tests ?? []), it.why ?? ""].join(" ")));
      const inTitle = [...title].filter((x) => w.has(x));
      const inBody = [...body].filter((x) => w.has(x) && !title.has(x));
      return { key: it.key, title: it.title, score: inTitle.length * 2 + inBody.length * 0.5, shared: [...inTitle, ...inBody.slice(0, 2)] };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => ({ key: x.key, title: x.title, reason: `Shares “${x.shared.slice(0, 3).join("”, “")}” with the step.` }));
}
const ABBR: [RegExp, string][] = [
  [/\bmom\b/g, "month on month"],
  [/\byoy\b/g, "year on year"],
  [/\bboa\b/g, "books of accounts"],
  [/\bcn\b/g, "credit notes"],
  [/\bar\b/g, "receivables"],
  [/\bap\b/g, "payables"],
  [/\bfar\b/g, "fixed asset register"],
  [/\bbrs\b/g, "bank reconciliation"],
  [/\btb\b/g, "trial balance"],
  [/\bgl\b/g, "general ledger"],
];

// ---------- AI drafts from the step text only ----------

/** Prompt for 2–4 review checks for a step, from its text and procedures (no firm material). */
export function draftChecksPrompt(input: { step: string; procedures: string[]; engagementType?: string }): string {
  return [
    "You help a chartered accountant review an audit / due diligence work paper.",
    `The work paper covers this workstep${input.engagementType ? ` (${input.engagementType})` : ""}:`,
    input.step,
    input.procedures.length ? `Procedures under the step:\n${input.procedures.map((p) => `- ${p}`).join("\n")}` : "",
    "Draft 2 to 4 short review checks the reviewer should tick on the work paper for this step: concrete, each one thing, no generic audit advice.",
    'Reply as JSON: {"checks":[{"text":"…","why":"one line"}]}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseDraftReply(text: string): { text: string; why?: string }[] {
  try {
    const j = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()) as { checks?: { text?: string; why?: string }[] };
    return (j.checks ?? []).filter((c) => typeof c.text === "string" && c.text.trim()).slice(0, 4).map((c) => ({ text: c.text!.trim(), why: c.why?.trim() || undefined }));
  } catch {
    return [];
  }
}

/** The "Ask AI what else to check" message: linked steps, procedures, open items and input status (never firm items). */
export function askAiPrompt(wp: WorkPaper, review: ScopedReview, engagementName: string): string {
  const lines = [`I'm reviewing work paper ${wp.ref} "${wp.title}" on ${engagementName}. It covers these worksteps:`];
  for (const s of review.steps) {
    lines.push(`- ${s.step.number ? `${s.step.number} ` : ""}${s.step.text.split("\n")[0]}`);
    for (const it of s.items.filter((x) => x.kind !== "step")) lines.push(`  · ${it.text}${it.kind === "input" && it.rfiStatus ? ` (RFI ${it.rfiNumber}: ${it.rfiStatus})` : ""} — ${outcomeLabel(it.answer)}${it.note ? ` (${it.note})` : ""}`);
  }
  const open = (wp.openItems ?? []).filter((o) => !o.resolved);
  if (open.length) lines.push(`Open items on the work paper: ${open.map((o) => o.text).join("; ")}.`);
  lines.push("What else should I check for these steps, and why? Be specific. Suggest the useful ones as checks; I can add them as procedures with update_step.");
  return lines.join("\n");
}
