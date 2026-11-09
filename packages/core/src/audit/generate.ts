/**
 * Builds a work programme from the mapped TB and the procedure library, and
 * looks up what to check next when a reviewer flags a procedure.
 */
import { natural } from "./analytics";
import { AREAS, AREA_IDS, type AreaId, type EngagementKind, type FollowUp, type Industry, type Procedure } from "./types";

/** Engagement kind implied by an engagement's free-text type. */
export function engagementKindFor(type: string | undefined): EngagementKind {
  const t = (type ?? "").toLowerCase();
  if (/due diligence|transaction|fdd|\bdd\b|quality of earnings/.test(t)) return "fdd";
  if (/internal/.test(t)) return "ia";
  return "audit";
}

export interface AreaPlan {
  area: AreaId;
  /** Natural-sign balance (or flow) for the current and comparative period. */
  current: number;
  prior?: number;
  /** full: all procedures; limited: core procedures only (below performance materiality). */
  scope: "full" | "limited";
}

/** Areas with balances, scoped against performance materiality; "general" is always included. */
export function planAreas(totals: Map<AreaId, number[]>, current: number, prior: number | undefined, performance: number): AreaPlan[] {
  const plans: AreaPlan[] = [];
  for (const area of AREA_IDS) {
    if (area === "general" || area === "unmapped") continue;
    const t = totals.get(area);
    if (!t || t.every((x) => Math.abs(x) < 1)) continue;
    const cur = natural(area, t[current] ?? 0);
    const pri = prior !== undefined ? natural(area, t[prior] ?? 0) : undefined;
    const big = Math.max(Math.abs(cur), Math.abs(pri ?? 0)) >= performance;
    plans.push({ area, current: cur, prior: pri, scope: performance <= 0 || big ? "full" : "limited" });
  }
  plans.push({ area: "general", current: 0, scope: "full" });
  return plans;
}

/** Library procedures for an area, filtered by engagement kind, industry and scope. */
export function proceduresFor(library: Procedure[], area: AreaId, kind: EngagementKind, industry: Industry, scope: "full" | "limited"): Procedure[] {
  return library.filter(
    (p) =>
      p.area === area &&
      p.kinds.includes(kind) &&
      (!p.industries || (industry !== "generic" && p.industries.includes(industry))) &&
      (scope === "full" || p.core),
  );
}

export interface ProgrammeDraft {
  area: AreaId;
  procedureId: string;
  text: string;
  why: string;
  assertions: string[];
  core: boolean;
  order: number;
}

/** Programme lines to add: library procedures for every planned area that aren't in the programme yet. */
export function draftProgramme(
  library: Procedure[],
  plans: AreaPlan[],
  kind: EngagementKind,
  industry: Industry,
  existingProcedureIds: Iterable<string>,
): ProgrammeDraft[] {
  const have = new Set(existingProcedureIds);
  const out: ProgrammeDraft[] = [];
  for (const plan of plans) {
    const areaOrder = AREA_IDS.indexOf(plan.area) * 1000;
    proceduresFor(library, plan.area, kind, industry, plan.scope).forEach((p, i) => {
      if (have.has(p.id)) return;
      out.push({ area: plan.area, procedureId: p.id, text: p.text, why: p.why, assertions: p.assertions, core: !!p.core, order: areaOrder + i });
    });
  }
  return out;
}

/** What else to check when a reviewer flags this procedure, and why. */
export function followUpsFor(library: Procedure[], procedureId: string | undefined): FollowUp[] {
  return (procedureId && library.find((p) => p.id === procedureId)?.followUps) || [];
}

export const areaLabel = (a: string) => (AREAS as Record<string, { label: string }>)[a]?.label ?? a;
