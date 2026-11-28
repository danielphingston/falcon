/**
 * The one chain (build brief v2): Programme (area) → Workstep → Workpaper.
 *
 * - A workstep's status comes from its workpaper (one status per piece of
 *   work). Steps with no workpaper keep the status they were imported with
 *   until they get one.
 * - Workpaper ↔ step links live on the step (`workpaperId`); a workpaper's
 *   steps are read back from them.
 * - The migration that sets this up for an existing engagement is a proposal:
 *   programmes and moving old programme items in are the main change;
 *   each suggested link, owner change, ref change and new workpaper is a
 *   choice the user ticks in the Inbox. One undo batch.
 */
import { newId, type Ctx } from "./actions";
import { inferAreas } from "./audit/reviewAssist";
import { areaLabel } from "./audit/generate";
import { cellIds, peopleIndex, ME } from "./people";
import { propose, type Captured } from "./proposals";
import { loadSnapshot, type Snapshot } from "./store";
import type { PlanItem, Programme, ProgramItem, Proposal, Settings, WorkPaper } from "./schema";
import { wpStatuses } from "./schema";

// ---------- Status ----------

export const stepStates = ["open", "wip", "to_review", "in_review", "points_raised", "closed", "na"] as const;
export type StepState = (typeof stepStates)[number];
export const stepStateLabels: Record<StepState, string> = {
  open: "Open",
  wip: "WIP",
  to_review: "To review",
  in_review: "In review",
  points_raised: "Points raised",
  closed: "Closed",
  na: "N/A",
};

/** What a step shows for its workpaper's status (brief 4.4). */
export function wpStepState(status: WorkPaper["status"] | undefined): StepState {
  switch (status) {
    case "in_progress":
      return "wip";
    case "prepared":
      return "to_review";
    case "in_review":
      return "in_review";
    case "points_raised":
      return "points_raised";
    case "cleared":
    case "final":
      return "closed";
    default:
      return "open";
  }
}

/** Status a step had before it had a workpaper (the imported execution / review status). */
export function legacyStepState(step: Pick<PlanItem, "status" | "reviewStatus">): StepState {
  if (step.status === "closed") return step.reviewStatus === "wip" ? "in_review" : "closed";
  if (step.reviewStatus === "closed") return "closed";
  if (step.reviewStatus === "wip") return "in_review";
  if (step.status === "review") return "to_review";
  if (step.status === "wip") return "wip";
  return "open";
}

/** A step's one status: N/A, else its workpaper's, else what it was imported with. */
export function stepState(step: Pick<PlanItem, "applicable" | "status" | "reviewStatus" | "workpaperId">, wp?: Pick<WorkPaper, "status" | "deleted"> | null): StepState {
  if (!step.applicable) return "na";
  if (step.workpaperId && wp && !wp.deleted) return wpStepState(wp.status);
  return legacyStepState(step);
}

/** Closed in the imported plan with no workpaper behind it (brief A4: shown, not allowed for new closes). */
export const closedWithoutWorkpaper = (step: PlanItem, wp?: WorkPaper | null) => step.applicable && !(step.workpaperId && wp && !wp.deleted) && legacyStepState(step) === "closed";

/** The old execution / review statuses for a state, so readers of the work plan see the same one status. */
function legacyFor(state: StepState): Pick<PlanItem, "status" | "reviewStatus"> {
  switch (state) {
    case "wip":
    case "points_raised":
      return { status: "wip", reviewStatus: state === "points_raised" ? "wip" : "open" };
    case "to_review":
      return { status: "review", reviewStatus: "open" };
    case "in_review":
      return { status: "review", reviewStatus: "wip" };
    case "closed":
      return { status: "closed", reviewStatus: "closed" };
    default:
      return { status: "open", reviewStatus: "open" };
  }
}

/**
 * Gives every step that has a workpaper the workpaper's status, in a loaded
 * snapshot (not stored), so readiness, workload and Today all read one status.
 */
export function applyDerivedStepStatus(snap: Pick<Snapshot, "planItems" | "workpapers">) {
  const wps = new Map(snap.workpapers.map((w) => [w.id, w]));
  snap.planItems = snap.planItems.map((s) => {
    const wp = s.workpaperId ? wps.get(s.workpaperId) : undefined;
    if (!wp || wp.deleted) return s;
    const l = legacyFor(wpStepState(wp.status));
    return l.status === s.status && l.reviewStatus === s.reviewStatus ? s : { ...s, ...l };
  });
}

/** The steps a workpaper covers, in plan order. */
export function stepsOf(wpId: string, steps: PlanItem[]): PlanItem[] {
  return steps.filter((s) => !s.deleted && s.workpaperId === wpId).sort((a, b) => a.order - b.order);
}

/** Workpapers on an engagement that cover no step. */
export function unlinkedWorkpapers(engagementId: string, snap: Pick<Snapshot, "workpapers" | "planItems">): WorkPaper[] {
  const linked = new Set(snap.planItems.filter((s) => !s.deleted && s.workpaperId).map((s) => s.workpaperId));
  return snap.workpapers.filter((w) => !w.deleted && w.engagementId === engagementId && !linked.has(w.id));
}

/** Short title from a step's text: its first line, up to the first dash or colon. */
export function shortTitle(text: string): string {
  const first = text.split("\n")[0].trim();
  const head = first.split(/\s[-–:]\s|:\s/)[0].trim();
  const t = head.length >= 4 ? head : first;
  return t.length > 70 ? `${t.slice(0, 67).trimEnd()}…` : t;
}

// ---------- Programmes ----------

/** Process areas: no TB balances behind them. */
const PROCESS = /^(general|tb review|trial balance review|report(ing)?|related part|planning|completion|.*\bit\b.*controls?|general & it|controls?)/i;
const EXTRA: [RegExp, string][] = [
  [/asset management|fixed assets?|\bfar\b/i, "ppe"],
  [/share capital|reserves|equity/i, "equity_reserves"],
];

/** TB area a work plan area maps to (Sales → revenue, Payroll → employee_costs…); none for process areas. */
export function tbAreaFor(name: string): string | undefined {
  if (PROCESS.test(name.trim())) return undefined;
  for (const [re, a] of EXTRA) if (re.test(name)) return a;
  return inferAreas(name).find((a) => a !== "general");
}

/** The programme name a step goes under: its area text, else group / phase, else "General". */
export const programmeNameOf = (s: Pick<PlanItem, "area" | "group" | "phase">) => (s.area || s.group || s.phase || "General").trim();

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Programmes on an engagement, in order. */
export const programmesOf = (engagementId: string, programmes: Programme[]) =>
  programmes.filter((p) => !p.deleted && p.engagementId === engagementId).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

// ---------- Matching workpapers to steps ----------

const STOP = new Set(
  "a an and the of to in on for with vs v versus by at as from or is be review reviews check checks checking verify verification working workings workpaper workpapers wp sheet details detail".split(" "),
);
const stem = (w: string) => (w.length <= 4 ? w : w.replace(/(ies)$/, "y").replace(/(ing|s)$/, ""));

interface Words {
  /** Significant words, stemmed. */
  words: string[];
  /** Every word in order as written (for acronyms). */
  all: string[];
}
function words(text: string): Words {
  const all = text.replace(/&/g, " ").split(/[^A-Za-z0-9]+/).filter(Boolean);
  return { all, words: all.map((w) => w.toLowerCase()).filter((w) => !STOP.has(w)).map(stem) };
}

/** Edit distance, capped (for "recievable" ≈ "receivable"). */
function close(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 6 || b.length < 6 || Math.abs(a.length - b.length) > 1) return false;
  let diff = 0;
  // Same letters with one swap / substitution.
  if (a.length === b.length) {
    const d = [...a].map((c, i) => (c === b[i] ? -1 : i)).filter((i) => i >= 0);
    if (d.length === 1) return true;
    return d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]];
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0, j = 0; i < s.length; i++, j++) {
    if (s[i] !== l[j]) {
      if (++diff > 1) return false;
      i--;
    }
  }
  return true;
}

/** "cn" ↔ "credit notes", "cce" ↔ "cash & cash equivalents" (initials of consecutive words). */
function acronymIn(token: string, w: Words, exact = false): boolean {
  if (token.length < 2 || token.length > 4) return false;
  // Words that can expand an acronym: real words, not acronyms themselves ("CMRR").
  const ws = w.all.filter((x) => !["and", "of", "the"].includes(x.toLowerCase()));
  const initials = ws.map((x) => x[0].toLowerCase()).join("");
  if (exact) return initials === token;
  for (let i = initials.indexOf(token); i >= 0; i = initials.indexOf(token, i + 1))
    if (ws.slice(i, i + token.length).every((x) => x.length >= 3 && x !== x.toUpperCase())) return true;
  return false;
}

/** Share of the workpaper title's words found in a text (by word, close spelling or acronym). */
function cover(title: Words, target: Words, rawTitle: string, exactAcronym = false): number {
  if (!title.words.length) return 0;
  const acr = new Set(
    rawTitle
      .split(/[^A-Za-z0-9]+/)
      .filter((t) => /^[A-Z][A-Za-z]{1,3}$/.test(t) && /[A-Z].*[A-Z]|^[A-Z]{2,}$/.test(t))
      .map((t) => t.toLowerCase()),
  );
  let hit = 0;
  for (const t of title.words) {
    if (target.words.some((x) => close(x, t))) hit++;
    else if (acr.has(t) && acronymIn(t, target, exactAcronym)) hit++;
  }
  return hit / title.words.length;
}

export interface LinkSuggestion {
  workpaperId: string;
  stepIds: string[];
  /** Why: "title words", "whole area", "ref". */
  basis: "title" | "area";
  score: number;
}

/**
 * Suggests which steps each workpaper covers: by title words and area first,
 * ref only as a tie-breaker (refs repeat and are often arbitrary). A title
 * that names the whole area ("Accounts receivable", "CCE workings") covers
 * the area's steps that no other workpaper matches by its title.
 */
export function suggestLinks(steps: PlanItem[], wps: WorkPaper[], programmes: Programme[]): LinkSuggestion[] {
  const live = steps.filter((s) => !s.deleted && s.applicable && !s.workpaperId);
  const progOf = new Map(programmes.map((p) => [p.id, p]));
  const progName = (s: PlanItem) => (s.programmeId ? progOf.get(s.programmeId)?.name : undefined) ?? programmeNameOf(s);
  const progTb = (s: PlanItem) => (s.programmeId ? progOf.get(s.programmeId)?.tbArea : undefined) ?? tbAreaFor(programmeNameOf(s));
  const out: LinkSuggestion[] = [];
  const claimed = new Map<string, { wp: string; score: number }>();

  // 1. Title matches (best step, or ties).
  const byTitle: LinkSuggestion[] = [];
  const areaWide: { wp: WorkPaper; area: string }[] = [];
  for (const wp of wps) {
    const t = words(wp.title);
    const wpAreas = new Set([wp.area, ...inferAreas(wp.title)].filter(Boolean) as string[]);
    // Whole area named by the title?
    const areaNames = [...new Set(live.map(progName))];
    const whole = areaNames.find((n) => cover(t, words(n), wp.title, true) === 1);
    if (whole) {
      areaWide.push({ wp, area: whole });
      continue;
    }
    const scored = live
      .map((s) => {
        const text = cover(t, words(s.text), wp.title);
        const area = wpAreas.has(progTb(s) ?? "") ? 0.3 : 0;
        const ref = wp.ref.trim() && wp.ref.trim() === s.number ? 0.15 : 0;
        return { s, text, score: text + area + ref, ref };
      })
      .filter((x) => x.text >= 0.6 || (x.text >= 0.5 && x.ref > 0))
      .sort((a, b) => b.score - a.score);
    if (!scored.length) continue;
    const best = scored.filter((x) => x.score >= scored[0].score - 1e-9);
    byTitle.push({ workpaperId: wp.id, stepIds: best.map((x) => x.s.id), basis: "title", score: scored[0].score });
  }
  // A step goes to the workpaper that matches it best.
  for (const l of byTitle)
    for (const id of l.stepIds) {
      const c = claimed.get(id);
      if (!c || c.score < l.score) claimed.set(id, { wp: l.workpaperId, score: l.score });
    }
  for (const l of byTitle) {
    const ids = l.stepIds.filter((id) => claimed.get(id)?.wp === l.workpaperId);
    if (ids.length) out.push({ ...l, stepIds: ids });
  }
  // 2. Whole-area titles take the area's remaining steps.
  for (const a of areaWide) {
    const ids = live.filter((s) => progName(s) === a.area && !claimed.has(s.id)).map((s) => s.id);
    if (ids.length) out.push({ workpaperId: a.wp.id, stepIds: ids, basis: "area", score: 1 });
  }
  return out;
}

// ---------- Migration ----------

const SOURCE: Record<ProgramItem["source"], NonNullable<PlanItem["source"]>> = {
  library: "tb_suggested",
  insight: "tb_suggested",
  followup: "tb_suggested",
  ai: "ai",
  manual: "manual",
};
const ITEM_STATUS: Record<ProgramItem["status"], PlanItem["status"]> = { todo: "open", in_progress: "wip", done: "closed", na: "open" };

/** Workpaper status that keeps a step's imported progress (brief A1 / edge case 18). */
function wpStatusFor(step: PlanItem): WorkPaper["status"] | undefined {
  switch (legacyStepState(step)) {
    case "wip":
      return "in_progress";
    case "to_review":
      return "prepared";
    case "in_review":
      return "in_review";
    case "closed":
      return "cleared";
    default:
      return undefined;
  }
}

export interface MigrationPlan {
  engagementId: string;
  changes: Captured[];
  choices: NonNullable<Proposal["choices"]>;
  summary: string;
  /** Workpapers no step was suggested for. */
  unlinked: WorkPaper[];
}

const stamp = (now: Date, by: Ctx["by"]) => ({ createdAt: now.toISOString(), updatedAt: now.toISOString(), deleted: false, updatedBy: by });

/**
 * What setting up the chain on an engagement would do: programmes from the
 * work plan's areas (and for old programme items' areas), every step under
 * its programme, old programme items as steps, and suggestions (links,
 * owners, refs, workpapers for steps already under way). Null when there's
 * nothing to do.
 */
export function planMigration(snap: Snapshot, engagementId: string, settings: Pick<Settings, "myName" | "myAliases" | "groupNames">, opts: { now?: Date; by?: Ctx["by"] } = {}): MigrationPlan | null {
  const now = opts.now ?? new Date();
  const by = opts.by ?? "app";
  const steps = snap.planItems.filter((s) => !s.deleted && s.engagementId === engagementId).sort((a, b) => a.order - b.order);
  const items = snap.programItems.filter((i) => !i.deleted && i.engagementId === engagementId && !i.migratedToId).sort((a, b) => a.area.localeCompare(b.area) || a.order - b.order);
  const wps = snap.workpapers.filter((w) => !w.deleted && w.engagementId === engagementId);
  const progs = programmesOf(engagementId, snap.programmes);
  const changes: Captured[] = [];
  const choices: MigrationPlan["choices"] = [];
  const people = new Map(snap.people.map((p) => [p.id, p]));
  const ix = peopleIndex(snap.people, settings);

  // Programmes: one per work plan area, then one per TB area of old programme items.
  const byName = new Map(progs.map((p) => [key(p.name), p]));
  const newProgs: Programme[] = [];
  let order = Math.max(0, ...progs.map((p) => p.order));
  const ensure = (name: string, tbArea?: string): Programme => {
    const hit = byName.get(key(name)) ?? (tbArea ? [...byName.values()].find((p) => p.tbArea === tbArea) : undefined);
    if (hit) return hit;
    const p: Programme = { id: newId(), engagementId, name, tbArea, order: ++order, ...stamp(now, by) };
    byName.set(key(name), p);
    newProgs.push(p);
    return p;
  };
  const stepProg = new Map<string, Programme>();
  for (const s of steps) if (!s.programmeId || !progs.some((p) => p.id === s.programmeId)) stepProg.set(s.id, ensure(programmeNameOf(s), tbAreaFor(programmeNameOf(s))));
  const itemProg = new Map(items.map((i) => [i.id, ensure(areaLabel(i.area), i.area === "general" || i.area === "unmapped" ? undefined : i.area)]));
  for (const p of newProgs) changes.push({ table: "programmes", recordId: p.id, action: "create", before: null, after: p as never });

  // Steps under their programme.
  const nextSteps: PlanItem[] = steps.map((s) => s);
  for (const s of steps) {
    const p = stepProg.get(s.id);
    if (!p) continue;
    const after = { ...s, programmeId: p.id, updatedAt: now.toISOString(), updatedBy: by };
    changes.push({ table: "planItems", recordId: s.id, action: "update", before: s as never, after: after as never });
    nextSteps[nextSteps.indexOf(s)] = after;
  }

  // Old programme items become steps (status Open unless done; no owner unless set), kept read-only.
  let maxOrder = Math.max(0, ...steps.map((s) => s.order));
  for (const it of items) {
    const p = itemProg.get(it.id)!;
    const owner = it.assigneeId ? people.get(it.assigneeId) : undefined;
    const step: PlanItem = {
      id: newId(),
      engagementId,
      number: "",
      area: p.name,
      text: it.text,
      applicable: it.status !== "na",
      status: ITEM_STATUS[it.status],
      assignee: owner?.name,
      assigneeId: owner?.id,
      notes: [it.why, it.notes].filter(Boolean).join("\n") || undefined,
      order: ++maxOrder,
      programmeId: p.id,
      source: SOURCE[it.source],
      fromProgramItemId: it.id,
      workpaperId: it.workpaperId && wps.some((w) => w.id === it.workpaperId) ? it.workpaperId : undefined,
      ...stamp(now, by),
    };
    changes.push({ table: "planItems", recordId: step.id, action: "create", before: null, after: step as never });
    changes.push({ table: "programItems", recordId: it.id, action: "update", before: it as never, after: { ...it, migratedToId: step.id, updatedAt: now.toISOString(), updatedBy: by } as never });
    nextSteps.push(step);
  }

  // Suggested links, for workpapers that cover no step yet.
  const linkedWp = new Set(nextSteps.filter((s) => s.workpaperId).map((s) => s.workpaperId));
  const candidates = wps.filter((w) => !linkedWp.has(w.id) && !w.adHoc);
  const allProgs = [...progs, ...newProgs];
  const links = suggestLinks(nextSteps, candidates, allProgs);
  const stepById = new Map(nextSteps.map((s) => [s.id, s]));
  const nameOf = (id: string | undefined) => (!id ? "me" : id === ME ? "me" : (people.get(id)?.name ?? "someone"));
  for (const l of links) {
    const wp = wps.find((w) => w.id === l.workpaperId)!;
    const ss = l.stepIds.map((id) => stepById.get(id)!);
    const linkKey = (st: PlanItem) => `link:${wp.id}:${st.id}`;
    for (const st of ss)
      choices.push({
        key: linkKey(st),
        group: "Links",
        label: `${wp.ref} ${wp.title} ↔ ${st.number ? `${st.number} ` : ""}${shortTitle(st.text)}`,
        detail: l.basis === "area" ? `The title names the whole area: suggested for each step there that no other workpaper matches. Untick the ones it doesn't cover.` : `Matched on title words.`,
        defaultOn: true,
        patches: [{ table: "planItems", recordId: st.id, action: "update", before: { workpaperId: st.workpaperId ?? null }, set: { workpaperId: wp.id } }],
      });
    // Ref → first step number (refs repeat, so they're never used to match on their own).
    const first = ss.find((x) => x.number);
    if (first && wp.ref.trim() !== first.number)
      choices.push({
        key: `ref:${wp.id}`,
        group: "Refs",
        label: `Set ref of “${wp.title}” to ${first.number} (now ${wp.ref})`,
        defaultOn: true,
        requires: [linkKey(first)],
        patches: [{ table: "workpapers", recordId: wp.id, action: "update", before: { ref: wp.ref }, set: { ref: first.number } }],
      });
    // Preparer ≠ step owner: ask (default no; both are shown on the step).
    const prep = wp.preparerId ? people.get(wp.preparerId) : undefined;
    if (prep)
      for (const st of ss) {
        if (st.assigneeId === prep.id || cellIds(st.assignee, ix).includes(prep.id)) continue;
        choices.push({
          key: `owner:${st.id}`,
          group: "Owners",
          label: `Change owner of ${st.number || shortTitle(st.text)} to ${prep.name}?`,
          detail: `${wp.title} is prepared by ${prep.name}; the plan says ${st.assignee || "nobody"}. Leave unticked to keep both.`,
          defaultOn: false,
          requires: [linkKey(st)],
          patches: [{ table: "planItems", recordId: st.id, action: "update", before: { assignee: st.assignee ?? null, assigneeId: st.assigneeId ?? null }, set: { assignee: prep.name, assigneeId: prep.id } }],
        });
      }
  }

  // Steps already under way with no workpaper: a workpaper at the matching status, so no review state is lost.
  const willLink = new Set(links.flatMap((l) => l.stepIds));
  for (const s of nextSteps) {
    if (!s.applicable || s.workpaperId || willLink.has(s.id) || s.fromProgramItemId) continue;
    const status = wpStatusFor(s);
    if (!status) continue;
    const ids = cellIds(s.assignee, ix);
    const prepId = ids.length === 1 && ids[0] !== ME ? ids[0] : undefined;
    const revIds = cellIds(s.reviewer, ix);
    const revId = revIds.length === 1 && revIds[0] !== ME ? revIds[0] : undefined;
    const wp: WorkPaper = {
      id: newId(),
      engagementId,
      ref: s.number || "WP",
      title: shortTitle(s.text),
      myRole: !revId && prepId ? "reviewer" : "preparer",
      preparerId: prepId,
      reviewerId: revId,
      status,
      ...stamp(now, by),
    };
    const k = `wp:${s.id}`;
    choices.push({
      key: k,
      group: "New workpapers",
      label: `Workpaper for ${s.number ? `${s.number} ` : ""}${shortTitle(s.text)} at ${wpStatuses.includes(status) ? status.replace(/_/g, " ") : status}`,
      detail: `The plan has this step as ${legacyStepState(s).replace(/_/g, " ")} with no workpaper; this keeps that progress.${ids.length === 1 && ids[0] !== ME ? ` Preparer ${nameOf(ids[0])}.` : ""}`,
      defaultOn: true,
      patches: [
        { table: "workpapers", recordId: wp.id, action: "create", before: null, set: wp as never },
        { table: "planItems", recordId: s.id, action: "update", before: { workpaperId: null }, set: { workpaperId: wp.id } },
      ],
    });
  }

  if (!changes.length && !choices.length) return null;
  const linkedAfter = new Set([...linkedWp, ...links.map((l) => l.workpaperId)]);
  const unlinked = wps.filter((w) => !linkedAfter.has(w.id));
  const parts = [
    newProgs.length ? `${newProgs.length} programme${newProgs.length === 1 ? "" : "s"}` : "",
    items.length ? `${items.length} programme item${items.length === 1 ? "" : "s"} as steps` : "",
    links.length ? `${links.length} workpaper link${links.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return {
    engagementId,
    changes,
    choices,
    unlinked,
    summary: `Set up programmes → steps → workpapers${parts.length ? `: ${parts.join(", ")}` : ""}`,
  };
}

/** Queues the migration for an engagement as one proposal (or returns the pending one). */
export async function proposeMigration(ctx: Ctx, engagementId: string): Promise<Proposal | null> {
  // Stored records as they are (not with derived statuses): proposals compare against them.
  const snap = await loadSnapshot(ctx.store, { raw: true });
  const settings = await ctx.store.getSettings();
  const plan = planMigration(snap, engagementId, settings, { now: ctx.now?.(), by: ctx.by });
  if (!plan) return null;
  return propose(ctx, {
    source: "app",
    tool: "migrate_programme",
    summary: plan.summary,
    engagementId,
    changes: plan.changes,
    choices: plan.choices,
    opKey: `migrate:${engagementId}`,
  });
}
