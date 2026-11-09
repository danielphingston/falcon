/**
 * Reviewer helpers for a work paper: which area(s) and engagement type it's
 * about, and AI counter-questions ("have you also checked…?") on review points.
 */
import {
  AREAS,
  engagementKindFor,
  challengePrompt,
  geminiJson,
  inferAreas,
  loadSnapshot,
  parseChallengeReply,
  procedureLibrary,
  programmeView,
  relatedChecks,
  update,
  type AreaId,
  type EngagementKind,
  type Industry,
  type ReviewPoint,
  type Snapshot,
  type WorkPaper,
} from "@falcon/core";
import { getSettings, store } from "../db";
import { chatAuth, friendlyError } from "./chat";
import { scheduleSync } from "./sync";

export const lakh = (x: number) =>
  Math.abs(x) >= 1e7 ? `${(x / 1e7).toFixed(2)} Cr` : Math.abs(x) >= 1e5 ? `${(x / 1e5).toFixed(2)} L` : Math.round(x).toLocaleString("en-IN");

export interface WpContext {
  areas: AreaId[];
  /** True when the areas were guessed from the title rather than set on the WP. */
  inferred: boolean;
  kind: EngagementKind;
  industry: Industry;
  engagementName: string;
  hasProgramme: boolean;
  facts: string[];
}

/** Area(s), engagement type, industry and known numbers for a work paper. */
export function wpContext(snap: Snapshot, wp: WorkPaper): WpContext {
  const eng = snap.engagements.find((e) => e.id === wp.engagementId);
  const ws = snap.workstreams.find((w) => w.id === wp.workstreamId);
  const tb = snap.trialBalances.find((t) => t.engagementId === wp.engagementId && !t.deleted);
  const set = wp.area && wp.area in AREAS ? [wp.area as AreaId] : [];
  const fromTitle = inferAreas(wp.title).filter((a) => a !== "general");
  const guessed = set.length ? [] : fromTitle.length ? fromTitle : inferAreas(ws?.name).filter((a) => a !== "general");
  const areas = set.length ? set : guessed;
  const facts: string[] = [];
  let hasProgramme = false;
  if (tb) {
    const view = programmeView(tb);
    hasProgramme = snap.programItems.some((i) => i.engagementId === wp.engagementId && !i.deleted);
    for (const a of areas) {
      const plan = view.plans.find((p) => p.area === a);
      if (plan)
        facts.push(
          `${AREAS[a].label}: ${lakh(plan.current)}${plan.prior !== undefined ? ` vs ${lakh(plan.prior)} prior` : ""}${plan.scope === "limited" ? " (below performance materiality)" : ""}`,
        );
      for (const i of view.insights.filter((x) => x.area === a && x.status === "flag")) facts.push(`Trend flag: ${i.title}. ${i.detail}`);
    }
    if (view.materiality) facts.push(`Performance materiality ${lakh(view.materiality.performance)}`);
  }
  return {
    areas,
    inferred: !set.length,
    kind: tb?.kind ?? engagementKindFor(eng?.type),
    industry: tb?.industry ?? "generic",
    engagementName: eng?.name ?? "the engagement",
    hasProgramme,
    facts,
  };
}

/** Offline counter-questions for a point (no AI). */
export function offlineChallenges(text: string, c: WpContext) {
  return relatedChecks(text, procedureLibrary, c.areas, c.kind, 3).map((q) => ({ ...q, source: "library" as const, status: "open" as const }));
}

/**
 * Asks Gemini to challenge a review point and stores the questions on it
 * (replacing earlier AI questions that are still open). Returns an error
 * sentence, or null on success. Silent no-op when AI isn't set up and
 * `quiet` is true.
 */
export async function challengeWithAi(pointId: string, quiet = false): Promise<string | null> {
  const auth = await chatAuth();
  if (typeof auth === "string") return quiet ? null : auth;
  const snap = await loadSnapshot(store);
  const point = snap.reviewPoints.find((p) => p.id === pointId);
  const wp = point && snap.workpapers.find((w) => w.id === point.workpaperId);
  if (!point || !wp) return null;
  const c = wpContext(snap, wp);
  const items = snap.programItems.filter((i) => i.engagementId === wp.engagementId && !i.deleted && (c.areas.includes(i.area as AreaId) || i.workpaperId === wp.id));
  const prompt = challengePrompt({
    engagement: c.engagementName,
    kind: c.kind,
    industry: c.industry,
    workpaper: `${wp.ref} ${wp.title}`.trim(),
    areas: c.areas,
    point: point.text,
    otherPoints: snap.reviewPoints.filter((p) => p.workpaperId === wp.id && p.id !== point.id && !p.deleted).map((p) => p.text),
    facts: c.facts,
    done: items.filter((i) => i.review === "ok").map((i) => i.text),
  });
  try {
    const settings = await getSettings();
    const qs = parseChallengeReply(await geminiJson(auth, settings.geminiModel, prompt));
    if (!qs.length) return quiet ? null : "The AI didn't return any questions. Try again.";
    const fresh = (await store.get("reviewPoints", pointId)) as ReviewPoint | undefined;
    if (!fresh) return null;
    const kept = (fresh.challenges ?? []).filter((q) => q.source !== "ai" || q.status !== "open");
    const seen = new Set(kept.map((q) => q.question.toLowerCase()));
    const challenges = [...kept, ...qs.filter((q) => !seen.has(q.question.toLowerCase())).map((q) => ({ ...q, source: "ai" as const, status: "open" as const }))];
    await update({ store, by: "app" }, "reviewPoints", pointId, { challenges });
    scheduleSync();
    return null;
  } catch (e) {
    return quiet ? null : friendlyError(e);
  }
}
