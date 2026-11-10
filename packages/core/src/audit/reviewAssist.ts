/**
 * Helps a reviewer: cues ("has this been done on the WP?") for a work paper,
 * and offline "have you also checked…?" counter-questions for a review point.
 * The AI version of the counter-questions builds on the same context.
 */
import { create, update, type Ctx } from "../actions";
import type { ProgramItem } from "../schema";
import { AREAS, type AreaId, type EngagementKind, type Industry, type Procedure } from "./types";

// ---------- Which area a work paper is about ----------

const AREA_WORDS: [RegExp, AreaId[]][] = [
  [/receivable|debtor|\bar\b|dso|collections?/i, ["receivables"]],
  [/inventor|stock|\bdio\b/i, ["inventory"]],
  [/payable|creditor|\bap\b|dpo/i, ["payables"]],
  [/\bcash\b|bank|\bbrs\b/i, ["cash_bank"]],
  [/\bnwc\b|working capital/i, ["receivables", "inventory", "payables"]],
  [/net debt|debt[- ]like|borrowing|loan|\bdebt\b/i, ["borrowings", "cash_bank"]],
  [/revenue|sales|income from operations|top ?line/i, ["revenue"]],
  [/\bqoe\b|quality of earnings|ebitda/i, ["revenue", "cogs_purchases", "employee_costs", "other_expenses"]],
  [/purchase|cogs|cost of (goods|sales|materials)|gross margin/i, ["cogs_purchases"]],
  [/payroll|salar|employee|staff|headcount/i, ["employee_costs"]],
  [/expense|opex|overhead|marketing|advertis/i, ["other_expenses"]],
  [/\bppe\b|fixed asset|property|plant|capex|\bfar\b/i, ["ppe"]],
  [/intangible|cwip|capital work|software/i, ["intangibles_cwip"]],
  [/depreciation|amorti[sz]/i, ["depreciation"]],
  [/interest|finance cost/i, ["finance_costs"]],
  [/\bgst\b|\btds\b|statutory|\bpf\b|\besi\b/i, ["statutory_dues"]],
  [/income tax|deferred tax|\btax\b/i, ["tax"]],
  [/provision|gratuity|contingen/i, ["provisions"]],
  [/investment/i, ["investments"]],
  [/advance|deposit|prepaid/i, ["loans_advances"]],
  [/equity|share capital|reserve|esop/i, ["equity_reserves"]],
  [/other income/i, ["other_income"]],
  [/planning|completion|going concern|related part|subsequent event|journal entr|representation|carve.?out/i, ["general"]],
];

/** Areas a work paper most likely covers, from its title / workstream (most specific first). */
export function inferAreas(...texts: (string | undefined)[]): AreaId[] {
  const t = texts.filter(Boolean).join(" ");
  const out: AreaId[] = [];
  for (const [re, areas] of AREA_WORDS) if (re.test(t)) for (const a of areas) if (!out.includes(a)) out.push(a);
  return out;
}

// ---------- Review cues ----------

export interface ReviewCue {
  /** Programme step this cue is (or will become). */
  itemId?: string;
  procedureId?: string;
  area: AreaId;
  /** The check, as written in the programme. */
  text: string;
  why?: string;
  core: boolean;
  /** Reviewer's answer so far. */
  review: ProgramItem["review"];
  reviewNote?: string;
  /** Preparer's status, if it's already a programme step. */
  status?: ProgramItem["status"];
}

/**
 * What to ask the reviewer for a work paper. With a TB-built programme
 * (`fromProgramme`), the programme steps for the WP's area(s). Otherwise
 * library procedures for the engagement type and industry (key steps first),
 * each replaced by its programme step once the reviewer has answered it.
 * Order stays stable as answers come in.
 */
export function reviewCues(opts: {
  library: Procedure[];
  areas: AreaId[];
  kind: EngagementKind;
  industry: Industry;
  items: ProgramItem[];
  workpaperId?: string;
  /** True when the engagement has a generated work programme: ask only its steps. */
  fromProgramme?: boolean;
  limitPerArea?: number;
}): ReviewCue[] {
  const { library, areas, kind, industry, workpaperId } = opts;
  const items = opts.items.filter((i) => !i.deleted);
  const out: ReviewCue[] = [];
  const used = new Set<string>();
  const fromItem = (i: ProgramItem): ReviewCue => {
    used.add(i.id);
    return { itemId: i.id, procedureId: i.procedureId, area: i.area as AreaId, text: i.text, why: i.why, core: i.core, review: i.review, reviewNote: i.reviewNote, status: i.status };
  };
  const byOrder = (a: ProgramItem, b: ProgramItem) => a.order - b.order;
  for (const area of areas) {
    const inArea = items.filter((i) => !used.has(i.id) && (i.area === area || (!!workpaperId && i.workpaperId === workpaperId)));
    if (opts.fromProgramme && inArea.length) {
      // Parents in order, each followed by its follow-ups.
      const tops = inArea.filter((i) => !i.parentId || !inArea.some((p) => p.id === i.parentId)).sort(byOrder);
      for (const t of tops) {
        out.push(fromItem(t));
        for (const k of inArea.filter((i) => i.parentId === t.id).sort(byOrder)) out.push(fromItem(k));
      }
      continue;
    }
    const procs = library
      .filter((p) => p.area === area && p.kinds.includes(kind) && (!p.industries || (industry !== "generic" && p.industries.includes(industry))))
      .sort((a, b) => Number(!!b.core) - Number(!!a.core))
      .slice(0, opts.limitPerArea ?? 14);
    for (const p of procs) {
      const it = inArea.find((i) => i.procedureId === p.id && !used.has(i.id));
      out.push(it ? fromItem(it) : { procedureId: p.id, area, text: p.text, why: p.why, core: !!p.core, review: "none" });
      if (it) for (const k of inArea.filter((i) => i.parentId === it.id && !used.has(i.id)).sort(byOrder)) out.push(fromItem(k));
    }
    // Steps added by hand, by the AI or as follow-ups that aren't under a listed step.
    for (const i of inArea.filter((i) => !used.has(i.id)).sort(byOrder)) out.push(fromItem(i));
  }
  return out;
}

/**
 * Records the reviewer's answer to a cue. A library cue becomes a programme
 * step on the spot (linked to the work paper), so the answer syncs and shows
 * in the Programme tab. Returns the step's id.
 */
export async function answerCue(
  ctx: Ctx,
  cue: ReviewCue,
  where: { engagementId: string; workpaperId: string; library: Procedure[] },
  review: ProgramItem["review"],
  reviewNote?: string,
): Promise<string> {
  const note = reviewNote !== undefined ? { reviewNote: reviewNote || null } : {};
  if (cue.itemId) {
    await update(ctx, "programItems", cue.itemId, { review, ...note });
    return cue.itemId;
  }
  const p = cue.procedureId ? where.library.find((x) => x.id === cue.procedureId) : undefined;
  const r = await create(ctx, "programItems", {
    engagementId: where.engagementId,
    area: cue.area,
    procedureId: cue.procedureId,
    text: cue.text,
    why: cue.why,
    assertions: p?.assertions ?? [],
    source: "library",
    core: cue.core,
    // The reviewer is answering "has this been done on the WP?"
    status: review === "ok" ? "done" : review === "na" ? "na" : "in_progress",
    workpaperId: where.workpaperId,
    review,
    ...(reviewNote ? { reviewNote } : {}),
    order: 9000 + Date.now() / 1e10,
  });
  return r.record.id;
}

// ---------- Counter-questions for a review point (offline) ----------

const STOP = new Set(
  "a an the and or of to in on for with by at from as is are was were be been not no this that these those it its into than then there their them has have had do does did please check confirm ensure whether if why how what which also all any more same such per vs".split(" "),
);
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/(ies|es|s)$/, ""));

export interface CounterQuestion {
  question: string;
  why: string;
}

/**
 * "Have you also checked…?" questions for a review point, without AI: finds
 * the library procedures closest to what the point is about and returns their
 * related checks (and the procedures themselves when they look untouched).
 */
export function relatedChecks(point: string, library: Procedure[], areas: AreaId[], kind: EngagementKind, max = 4): CounterQuestion[] {
  const want = new Set(tokens(point));
  if (want.size === 0) return [];
  const pool = library.filter((p) => (areas.length === 0 || areas.includes(p.area)) && p.kinds.includes(kind));
  const scored = pool
    .map((p) => {
      const words = new Set(tokens(`${p.text} ${p.why}`));
      let hit = 0;
      for (const w of want) if (words.has(w)) hit++;
      return { p, score: hit / Math.sqrt(words.size || 1) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const out: CounterQuestion[] = [];
  const seen = new Set<string>();
  const add = (q: CounterQuestion) => {
    const k = q.question.toLowerCase();
    if (!seen.has(k) && !point.toLowerCase().includes(q.question.toLowerCase().slice(0, 40))) {
      seen.add(k);
      out.push(q);
    }
  };
  for (const { p } of scored) for (const f of p.followUps) add({ question: f.text, why: f.why });
  return out.slice(0, max);
}

// ---------- AI challenge prompt ----------

export interface ChallengeContext {
  engagement: string;
  kind: EngagementKind;
  industry: Industry;
  workpaper: string;
  areas: AreaId[];
  point: string;
  otherPoints: string[];
  /** Balances / trend lines already known, e.g. "Receivables 1.00 Cr vs 75 L (+33%); revenue +10%". */
  facts: string[];
  /** Steps the reviewer has already ticked off, so the AI doesn't repeat them. */
  done: string[];
}

/** Instructions for the AI to challenge one review point with counter-questions. Asks for JSON. */
export function challengePrompt(c: ChallengeContext): string {
  return `You are a senior reviewer (chartered accountant, India) helping a team lead review a work paper. They have just written a review point. Challenge it: what else should be checked so the issue is fully understood and closed? Ask counter-questions of the form "Have you also checked …?", each specific and actionable, with a one-sentence reason (the risk it addresses).

Engagement: ${c.engagement} · ${c.kind === "fdd" ? "financial due diligence" : c.kind === "ia" ? "internal audit" : "statutory audit"} · industry: ${c.industry}
Work paper: ${c.workpaper}
Area(s): ${c.areas.map((a) => AREAS[a]?.label ?? a).join(", ") || "not set"}
${c.facts.length ? `Known numbers and trends:\n${c.facts.map((f) => `- ${f}`).join("\n")}\n` : ""}${c.done.length ? `Already reviewed as fine (don't repeat):\n${c.done.slice(0, 15).map((d) => `- ${d}`).join("\n")}\n` : ""}${c.otherPoints.length ? `Other review points on this WP:\n${c.otherPoints.slice(0, 10).map((p) => `- ${p}`).join("\n")}\n` : ""}
The review point to challenge:
"""${c.point}"""

Rules: 2 to 4 questions; don't restate the point; cover the root cause, the extent (is it isolated or wider?), the accounting / disclosure / CARO or QoE impact, and the evidence needed to close it, as relevant. Use Indian context (Ind AS / AS, Schedule III, SAs, GST, TDS, Companies Act) where it helps. Reply with JSON only: {"questions":[{"question":"Have you also checked …?","why":"…"}]}`;
}

/** Reads the AI's JSON reply (tolerating code fences or text around it). */
export function parseChallengeReply(text: string): CounterQuestion[] {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const j = JSON.parse(m[0]) as { questions?: { question?: unknown; why?: unknown }[] };
    return (j.questions ?? [])
      .filter((q) => typeof q.question === "string" && q.question.trim())
      .map((q) => ({ question: String(q.question).trim(), why: typeof q.why === "string" ? q.why.trim() : "" }))
      .slice(0, 5);
  } catch {
    return [];
  }
}
