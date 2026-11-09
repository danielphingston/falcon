/**
 * Turns a parsed TB into a stored trial balance and work programme, and
 * applies reviewer flags. Pure planning lives in generate.ts / analytics.ts;
 * this file writes records through the normal actions (so everything syncs
 * and can be undone in one batch).
 */
import { create, newId, update, type Ctx, type Result } from "../actions";
import type { ProgramItem, TrialBalance } from "../schema";
import { areaTotals, suggestMateriality, trendInsights, type Insight, type Materiality } from "./analytics";
import { draftProgramme, followUpsFor, planAreas, type AreaPlan } from "./generate";
import { classifyLedger } from "./mapping";
import type { ParsedTb } from "./tbParse";
import type { AreaId, EngagementKind, FollowUp, Industry, Procedure } from "./types";

/** Lines for storage: each parsed ledger with an id and an automatic area. */
export function mapLines(parsed: ParsedTb): TrialBalance["lines"] {
  return parsed.lines.map((l) => ({
    id: newId(),
    ledger: l.ledger,
    groups: l.groups,
    area: classifyLedger(l.ledger, l.groups).area,
    balances: l.balances,
    mappedBy: "auto" as const,
  }));
}

/** Current period: the first non-opening column; comparative: the next one (or the opening column). */
export function defaultPeriods(periods: { isOpening: boolean }[]): { currentIdx: number; priorIdx?: number } {
  const currentIdx = Math.max(0, periods.findIndex((p) => !p.isOpening));
  const rest = periods.map((p, i) => ({ ...p, i })).filter((p) => p.i !== currentIdx);
  const prior = rest.find((p) => !p.isOpening) ?? rest[0];
  return { currentIdx, priorIdx: prior?.i };
}

export interface ProgrammeView {
  totals: Map<AreaId, number[]>;
  materiality: Materiality;
  plans: AreaPlan[];
  insights: Insight[];
}

/** Everything the programme screen shows, computed from the stored TB. */
export function programmeView(tb: Pick<TrialBalance, "lines" | "periods" | "currentIdx" | "priorIdx" | "materiality" | "performance">): ProgrammeView {
  const lines = tb.lines.map((l) => ({ ...l, area: l.area as AreaId }));
  const totals = areaTotals(lines, tb.periods.length);
  const suggested = suggestMateriality(totals, tb.currentIdx);
  const materiality: Materiality =
    tb.materiality !== undefined ? { ...suggested, basis: "set by you", overall: tb.materiality, performance: tb.performance ?? Math.round(tb.materiality * 0.75) } : suggested;
  return {
    totals,
    materiality,
    plans: planAreas(totals, tb.currentIdx, tb.priorIdx, materiality.performance),
    insights: trendInsights(totals, tb.currentIdx, tb.priorIdx, tb.periods),
  };
}

/** Adds the library procedures the programme doesn't have yet. Existing lines (and their progress) are kept. */
export async function generateProgramme(
  ctx: Ctx,
  library: Procedure[],
  tb: TrialBalance,
  existing: ProgramItem[],
): Promise<Result<"programItems">[]> {
  const view = programmeView(tb);
  const drafts = draftProgramme(library, view.plans, tb.kind as EngagementKind, tb.industry as Industry, existing.filter((i) => !i.deleted && i.procedureId).map((i) => i.procedureId!));
  const batch: Ctx = { ...ctx, batchId: ctx.batchId ?? newId() };
  const out: Result<"programItems">[] = [];
  for (const d of drafts)
    out.push(await create(batch, "programItems", { engagementId: tb.engagementId, area: d.area, procedureId: d.procedureId, text: d.text, why: d.why, assertions: d.assertions, source: "library", core: d.core, order: d.order }));
  return out;
}

/** What to check next for a flagged item: the library's follow-ups, minus ones already added. */
export function suggestionsFor(library: Procedure[], item: ProgramItem, all: ProgramItem[]): FollowUp[] {
  const added = new Set(all.filter((i) => !i.deleted && i.parentId === item.id).map((i) => i.text));
  return followUpsFor(library, item.procedureId).filter((f) => !added.has(f.text));
}

/** Adds follow-up checks under a flagged item (one undoable batch). */
export async function addFollowUps(ctx: Ctx, item: ProgramItem, followUps: FollowUp[], source: "followup" | "insight" | "ai" = "followup") {
  const batch: Ctx = { ...ctx, batchId: ctx.batchId ?? newId() };
  const out: Result<"programItems">[] = [];
  for (const [i, f] of followUps.entries())
    out.push(await create(batch, "programItems", { engagementId: item.engagementId, area: item.area, text: f.text, why: f.why, source, parentId: item.id, order: item.order + 0.01 * (i + 1) }));
  return out;
}

/** Records the reviewer's outcome on a step. */
export function reviewItem(ctx: Ctx, id: string, review: ProgramItem["review"], reviewNote?: string) {
  return update(ctx, "programItems", id, { review, ...(reviewNote !== undefined ? { reviewNote: reviewNote || null } : {}) });
}

/** % done per area and overall (n.a. lines count as done). */
export function progressOf(items: ProgramItem[]): { done: number; total: number; byArea: Map<string, { done: number; total: number }> } {
  const byArea = new Map<string, { done: number; total: number }>();
  let done = 0;
  let total = 0;
  for (const i of items) {
    if (i.deleted) continue;
    const a = byArea.get(i.area) ?? { done: 0, total: 0 };
    a.total++;
    total++;
    if (i.status === "done" || i.status === "na") {
      a.done++;
      done++;
    }
    byArea.set(i.area, a);
  }
  return { done, total, byArea };
}
