/**
 * Work plans: the engagement's audit programme / internal-audit plan from
 * Excel. Each procedure becomes a step with its area, person responsible,
 * execution and review status, risk, applicability and hours; every other
 * column is kept with its header. Other sheets (time summary, risks and
 * instructions…) are kept as plain reference tables. Re-importing an
 * updated plan updates the steps instead of duplicating them.
 */
import { create, newId, update, type Ctx } from "./actions";
import type { PlanItem } from "./schema";
import type { SheetData } from "./teamImport";

export interface PlanField {
  label: string;
  value: string;
  link?: string;
}

export interface PlanStep {
  /** Area number from the sheet + the step's position in the area ("6.3"). */
  number: string;
  phase?: string;
  group?: string;
  area: string;
  lead?: string;
  text: string;
  risk?: string;
  applicable: boolean;
  assignee?: string;
  status: PlanItem["status"];
  reviewStatus?: NonNullable<PlanItem["reviewStatus"]>;
  reviewer?: string;
  budgetHours?: number;
  actualHours?: number;
  fields?: PlanField[];
  order: number;
}

export interface ParsedPlan {
  sheet: string;
  steps: PlanStep[];
  title: string[];
  columns: string[];
  /** Lines under the table (time totals…). */
  notes: string[];
  /** Other sheets, as their non-empty rows. */
  tables: { name: string; rows: string[][] }[];
  hasReview: boolean;
  warnings: string[];
}

const clean = (v: unknown) =>
  String(v ?? "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** Like clean, but keeps line breaks (a step's sub-points). */
const cleanText = (v: unknown) =>
  String(v ?? "")
    .replace(/ /g, " ")
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
const norm = (v: unknown) => clean(v).toLowerCase();

/** "Open", "WIP", "Review Pending", "Closed" → app status. */
export function planStatus(v: unknown): PlanItem["status"] | undefined {
  const s = norm(v);
  if (!s) return undefined;
  if (/review pending|pending review|for review|to review|under review/.test(s)) return "review";
  if (/closed|done|complete|finished|cleared/.test(s)) return "closed";
  if (/wip|progress|ongoing|started|partial/.test(s)) return "wip";
  if (/open|not started|pending|yet|to do|todo/.test(s)) return "open";
  return undefined;
}
export function planReviewStatus(v: unknown): NonNullable<PlanItem["reviewStatus"]> | undefined {
  const s = planStatus(v);
  return s === "review" ? "open" : s;
}

type Col = "sno" | "phase" | "area" | "text" | "risk" | "applicable" | "assignee" | "reviewStatus" | "status" | "reviewer" | "budget" | "actual";

/** First match wins for each header cell. */
const HEADERS: [Col, RegExp][] = [
  ["sno", /^(s|sl|sr)\.?\s*no\.?$|^s\.?\s*no\.?$|^#$/],
  ["phase", /area as per|strategy|^phase$|^stage$/],
  ["area", /^(area|account head|head|section|cycle|module|process|workstream)$/],
  ["text", /^(particulars?|audit procedures?|procedures?( to be performed)?|checklist|activit(y|ies)|tasks?|work ?steps?|scope( of work)?)$/],
  ["reviewStatus", /status.*review|review status/],
  ["status", /^status\b|execution status/],
  ["risk", /risk/],
  ["applicable", /applicab/],
  ["assignee", /person responsible|responsib|assigned|^owner$|preparer|done by|executed by/],
  ["reviewer", /reviewed by|^reviewer/],
  ["budget", /budget/],
  ["actual", /actual/],
];

interface Header {
  row: number;
  cols: Partial<Record<Col, number>>;
  extras: { col: number; label: string }[];
  labels: string[];
  first: number;
}

function findHeader(rows: string[][]): Header | null {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const cols: Partial<Record<Col, number>> = {};
    const extras: { col: number; label: string }[] = [];
    const labels: string[] = [];
    let first = -1;
    rows[i].forEach((raw, j) => {
      const c = norm(raw);
      if (!c) return;
      if (first < 0) first = j;
      labels.push(clean(raw));
      const hit = HEADERS.find(([col, re]) => re.test(c) && cols[col] === undefined);
      if (hit) cols[hit[0]] = j;
      else extras.push({ col: j, label: clean(raw) });
    });
    if (cols.text !== undefined && (cols.sno !== undefined || cols.area !== undefined) && (cols.assignee !== undefined || cols.status !== undefined)) return { row: i, cols, extras, labels, first };
  }
  return null;
}

const hours = (v: string) => {
  const n = Number(v.replace(/[^0-9.]/g, ""));
  return v && Number.isFinite(n) && n >= 0 ? n : undefined;
};
const isLegend = (s: string) => s.length <= 20 && (!!planStatus(s) || /^(high|medium|low|yes|no)$/i.test(s));

/** Reads a work plan workbook: every plan sheet, plus other sheets as reference tables. */
export function parsePlan(sheets: SheetData[]): ParsedPlan | null {
  const steps: PlanStep[] = [];
  const out: ParsedPlan = { sheet: "", steps, title: [], columns: [], notes: [], tables: [], hasReview: false, warnings: [] };
  const planSheets: string[] = [];

  for (const sheet of sheets) {
    const h = findHeader(sheet.rows);
    if (!h) continue;
    planSheets.push(sheet.name);
    const { cols } = h;
    const get = (r: string[], c: Col) => (cols[c] !== undefined ? clean(r[cols[c]!]) : "");
    if (cols.reviewStatus !== undefined) out.hasReview = true;
    out.columns = [...new Set([...out.columns, ...h.labels])];

    // Title: the first two columns above the header (legends and sign-off blocks sit further right).
    if (!out.title.length)
      for (let i = 0; i < h.row; i++) {
        const t = [sheet.rows[i]?.[h.first], sheet.rows[i]?.[h.first + 1]].map(clean).filter((c) => c && !isLegend(c));
        if (t.length) out.title.push(t.join(" · "));
      }

    let phase: string | undefined;
    let group: string | undefined;
    let area = "";
    let areaNo = "";
    let areaCount = 0;
    let k = 0;
    let leads: string[] = [];
    let lastBullet = false;

    for (let i = h.row + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i] ?? [];
      const sno = get(r, "sno");
      const ph = get(r, "phase");
      const ar = get(r, "area");
      const text = cleanText(r[cols.text!]);
      const extras = h.extras
        .map(({ col, label }): PlanField | null => {
          const v = clean(r[col]);
          const link = sheet.links?.[`${i},${col}`];
          return v || link ? { label, value: v || link!, ...(link ? { link } : {}) } : null;
        })
        .filter((f): f is PlanField => !!f);
      const data = {
        assignee: get(r, "assignee"),
        risk: get(r, "risk"),
        applicable: get(r, "applicable"),
        reviewer: get(r, "reviewer"),
        budget: get(r, "budget"),
        actual: get(r, "actual"),
      };
      const hasData = Object.values(data).some(Boolean) || extras.length > 0;
      const statusText = get(r, "status");

      if (!sno && !ph && !ar && !text) {
        // Nothing but a status, or totals under the table ("Articles time | 69").
        const rest = r.map(clean).filter((c) => c && c !== statusText);
        if (rest.length) out.notes.push(rest.join(" "));
        continue;
      }
      if (ph && ph !== phase) {
        phase = ph;
        group = undefined; // groups ("Balance Sheet") belong to a phase
      }
      // "Balance Sheet" on its own: a group of areas.
      if (!sno && !text && ar && !hasData) {
        group = ar;
        continue;
      }
      if (ar && ar !== area) {
        area = ar;
        areaNo = sno || String(++areaCount);
        if (/^\d+$/.test(sno)) areaCount = Number(sno);
        k = 0;
        leads = [];
        lastBullet = false;
      } else if (sno && sno !== areaNo) {
        areaNo = sno;
        if (/^\d+$/.test(sno)) areaCount = Number(sno);
        k = 0;
        leads = [];
      }

      // "Review of -", "ROC Filings made during the year:", "Verify;" introduce the steps below.
      if (text && /[:;\-–]\s*$/.test(text) && text.length <= 80 && !data.risk && !data.budget && !data.actual) {
        const l = text.replace(/[\s:;\-–]+$/, "");
        if (leads.length && !lastBullet) leads.push(l);
        else leads = [l];
        lastBullet = false;
        continue;
      }
      const bullet = /^[-–•*]\s*/.test(text);
      if (!bullet && lastBullet && leads.length) leads.pop();
      lastBullet = bullet;

      const stepText = (text || area).replace(/^[-–•*]\s*/, "");
      if (!stepText) continue;
      k++;
      const appl = data.applicable;
      steps.push({
        number: areaNo ? `${areaNo}.${k}` : String(steps.length + 1),
        ...(phase ? { phase } : {}),
        ...(group ? { group } : {}),
        area: area || phase || "",
        ...(leads.length ? { lead: leads.join(" › ") } : {}),
        text: stepText,
        ...(data.risk ? { risk: data.risk } : {}),
        applicable: !/^(no|n|na|n\.a\.?|not applicable)$/i.test(appl),
        ...(data.assignee ? { assignee: data.assignee } : {}),
        status: planStatus(statusText) ?? "open",
        ...(cols.reviewStatus !== undefined ? { reviewStatus: planReviewStatus(get(r, "reviewStatus")) ?? "open" } : {}),
        ...(data.reviewer ? { reviewer: data.reviewer } : {}),
        ...(hours(data.budget) !== undefined ? { budgetHours: hours(data.budget) } : {}),
        ...(hours(data.actual) !== undefined ? { actualHours: hours(data.actual) } : {}),
        ...(extras.length ? { fields: extras } : {}),
        order: steps.length,
      });
    }
  }
  if (!steps.length) return null;
  out.sheet = planSheets.join(", ");

  // Every other sheet, kept as its non-empty rows (empty columns dropped).
  for (const s of sheets.filter((x) => !planSheets.includes(x.name))) {
    const rows = s.rows.map((r) => r.map(clean)).filter((r) => r.some(Boolean));
    if (!rows.length) continue;
    const used = new Set<number>();
    for (const r of rows) r.forEach((c, j) => c && used.add(j));
    const keep = [...used].sort((a, b) => a - b);
    out.tables.push({ name: s.name, rows: rows.slice(0, 500).map((r) => keep.map((j) => r[j] ?? "")) });
  }
  return out;
}

// ---------- applying to an engagement ----------

const key = (s: { phase?: string; area: string; lead?: string; text: string }) =>
  [s.phase, s.area, s.lead, s.text.split("\n")[0]].map((x) => (x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).join("|");

export interface PlanPlan {
  create: PlanStep[];
  update: { id: string; step: PlanStep; changes: string[]; takeStatus?: boolean; takeReview?: boolean }[];
  unchanged: number;
}

/** What importing this plan would do to the engagement's existing steps. */
export function planPlanImport(parsed: ParsedPlan, existing: PlanItem[]): PlanPlan {
  const byKey = new Map(existing.filter((e) => !e.deleted).map((e) => [key(e), e]));
  const plan: PlanPlan = { create: [], update: [], unchanged: 0 };
  for (const s of parsed.steps) {
    const old = byKey.get(key(s));
    if (!old) {
      plan.create.push(s);
      continue;
    }
    const changes: string[] = [];
    // Statuses follow the sheet only where the sheet itself changed since the last import,
    // so progress recorded in the app isn't undone by re-importing an older copy.
    const takeStatus = s.status !== (old.sheetStatus ?? old.status);
    const takeReview = (s.reviewStatus ?? "") !== ((old.sheetReviewStatus ?? old.reviewStatus) ?? "");
    if (takeStatus) changes.push(s.status !== old.status ? `status → ${s.status}` : "sheet status");
    if (takeReview) changes.push(s.reviewStatus !== old.reviewStatus ? `review → ${s.reviewStatus ?? "none"}` : "sheet review status");
    if ((s.assignee ?? "") !== (old.assignee ?? "")) changes.push("person");
    if ((s.reviewer ?? "") !== (old.reviewer ?? "")) changes.push("reviewer");
    if (s.budgetHours !== old.budgetHours || s.actualHours !== old.actualHours) changes.push("hours");
    if ((s.risk ?? "") !== (old.risk ?? "") || s.applicable !== old.applicable) changes.push("risk / applicability");
    if (JSON.stringify(s.fields ?? []) !== JSON.stringify(old.fields ?? [])) changes.push("other columns");
    if (s.number !== old.number || (s.group ?? "") !== (old.group ?? "")) changes.push("position");
    if (changes.length) plan.update.push({ id: old.id, step: s, changes, takeStatus, takeReview });
    else plan.unchanged++;
  }
  return plan;
}

/** Creates / updates the steps in one undoable batch and keeps the plan's details on the engagement. */
export async function applyPlan(
  ctx: Ctx,
  plan: PlanPlan,
  opts: { engagementId: string; parsed: ParsedPlan; file: string; resolvePerson?: (name: string) => string | undefined },
) {
  const batch: Ctx = { ...ctx, batchId: ctx.batchId ?? newId() };
  const out = [];
  const person = (n?: string) => (n ? opts.resolvePerson?.(n) : undefined);
  const fieldsOf = (s: PlanStep) => ({
    number: s.number,
    phase: s.phase,
    group: s.group,
    area: s.area,
    lead: s.lead,
    text: s.text,
    risk: s.risk,
    applicable: s.applicable,
    assignee: s.assignee,
    assigneeId: person(s.assignee),
    status: s.status,
    reviewStatus: s.reviewStatus,
    reviewer: s.reviewer,
    reviewerId: person(s.reviewer),
    budgetHours: s.budgetHours,
    actualHours: s.actualHours,
    fields: s.fields,
    order: s.order,
    sheetStatus: s.status,
    sheetReviewStatus: s.reviewStatus,
  });
  for (const s of plan.create) out.push(await create(batch, "planItems", { engagementId: opts.engagementId, ...fieldsOf(s) }));
  for (const u of plan.update) {
    const f = fieldsOf(u.step) as Record<string, unknown>;
    if (!u.takeStatus) delete f.status;
    if (!u.takeReview) delete f.reviewStatus;
    // Clear what the new sheet left empty; keep the app's own notes.
    for (const k of Object.keys(f)) if (f[k] === undefined) f[k] = null;
    out.push(await update(batch, "planItems", u.id, f as never));
  }
  const p = opts.parsed;
  out.push(
    await update(batch, "engagements", opts.engagementId, {
      planInfo: { file: opts.file, sheet: p.sheet, title: p.title, columns: p.columns, notes: p.notes, tables: p.tables, hasReview: p.hasReview, importedAt: new Date().toISOString() },
    }),
  );
  return out;
}

// ---------- reading progress ----------

export interface PlanProgress {
  total: number;
  applicable: number;
  closed: number;
  reviewed: number;
  budget: number;
  actual: number;
  byPerson: { name: string; steps: number; closed: number; budget: number; actual: number }[];
}

export function planProgress(items: PlanItem[]): PlanProgress {
  const live = items.filter((i) => !i.deleted);
  const appl = live.filter((i) => i.applicable);
  const people = new Map<string, { name: string; steps: number; closed: number; budget: number; actual: number }>();
  for (const i of appl) {
    const n = i.assignee || "Unassigned";
    const p = people.get(n) ?? { name: n, steps: 0, closed: 0, budget: 0, actual: 0 };
    p.steps++;
    if (i.status === "closed") p.closed++;
    p.budget += i.budgetHours ?? 0;
    p.actual += i.actualHours ?? 0;
    people.set(n, p);
  }
  return {
    total: live.length,
    applicable: appl.length,
    closed: appl.filter((i) => i.status === "closed").length,
    reviewed: appl.filter((i) => i.reviewStatus === "closed").length,
    budget: appl.reduce((n, i) => n + (i.budgetHours ?? 0), 0),
    actual: appl.reduce((n, i) => n + (i.actualHours ?? 0), 0),
    byPerson: [...people.values()].sort((a, b) => b.steps - a.steps),
  };
}

/**
 * A step waiting for the reviewer: marked "Review pending", or (in plans with a
 * review column) executed but not yet reviewed.
 */
export function planAwaitingReview(i: PlanItem, hasReview: boolean): boolean {
  if (i.deleted || !i.applicable) return false;
  return hasReview ? (i.status === "closed" || i.status === "review") && i.reviewStatus !== "closed" : i.status === "review";
}

/**
 * Steps waiting for my review across live engagements: reviewer is me, or the
 * step names no reviewer (or my name isn't set yet, so I can't tell).
 */
export function planReviewQueue(
  items: PlanItem[],
  engagements: { id: string; planInfo?: { hasReview?: boolean } }[],
  live: Set<string>,
  myName: string,
  /** Resolves a reviewer cell to "me" (names, initials, aliases); defaults to matching my name. */
  isMine?: (cell: string | undefined) => boolean,
): PlanItem[] {
  const hasReview = new Map(engagements.map((e) => [e.id, !!e.planInfo?.hasReview]));
  const known = !!myName && myName !== "Me";
  const mine = isMine ?? ((cell: string | undefined) => isMe(cell, myName));
  return items.filter((i) => live.has(i.engagementId) && planAwaitingReview(i, hasReview.get(i.engagementId) ?? false) && (!known || !i.reviewer || mine(i.reviewer)));
}

/**
 * Whether a "person responsible" cell names this person. Cells can name
 * several people ("Ravi/Dev", "Asha & Mira") or use initials.
 */
export function namedIn(cell: string | undefined, fullName: string): boolean {
  if (!cell) return false;
  return cell.split(/\s*(?:[/,&+;]|\band\b)\s*/i).some((part) => isMe(part, fullName));
}

/** Whether a sheet name ("JK", "Jayakrishnan") refers to the app's user. */
export function isMe(name: string | undefined, myName: string): boolean {
  if (!name || !myName || myName === "Me") return false;
  const n = name.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const me = myName.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const initials = me
    .split(/\s+/)
    .map((w) => w[0])
    .join("");
  const first = me.split(/\s+/)[0];
  return n === me || n === first || n.replace(/\s/g, "") === initials || (initials.length > 2 && n.replace(/\s/g, "") === initials.slice(0, 2));
}
