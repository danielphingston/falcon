/**
 * The firm's own work-paper templates, imported from its Excel workbooks.
 *
 * Templates are the firm's confidential material: the app keeps them on the
 * device only (no sync, no backups, never sent to the AI). This file holds the
 * pure parts: reading checklist tables out of a workbook, matching a work
 * paper to a template, and ordering the reviewer's questions.
 */
import type { SheetData } from "../teamImport";
import { inferAreas } from "./reviewAssist";
import type { AreaId } from "./types";

export type FirmItemKind = "inputs" | "check" | "risks" | "disclosure" | "sections";

export interface FirmItem {
  /** Stable within a template (survives re-imports while the wording stays). */
  key: string;
  /** Heading the item sits under in the workbook, e.g. "Recognition". */
  group?: string;
  title: string;
  kind: FirmItemKind;
  /** The individual tests ("1. … 2. …") to tick off. */
  tests: string[];
  /** Why it matters / what it covers, when the workbook says. */
  why?: string;
  /** Other columns worth showing (inputs required, potential risk…). */
  notes?: { label: string; text: string }[];
}

export interface FirmTemplate {
  id: string;
  name: string;
  sourceFile: string;
  areas: AreaId[];
  items: FirmItem[];
  importedAt: string;
}

/** A check the reviewer added while reviewing; asked again on later reviews. */
export interface LearnedCheck {
  id: string;
  text: string;
  why?: string;
  /** Applies to every WP using this template… */
  templateId?: string;
  /** …or every WP in this area (when no template is linked)… */
  area?: string;
  /** …or only this work paper. */
  workpaperId?: string;
  /** WP it was added on, for "added while reviewing C.4". */
  fromWorkpaperId?: string;
  createdAt: string;
}

/** The reviewer's answer to one firm question on one work paper. */
export interface FirmAnswer {
  /** `${workpaperId}|${key}` */
  id: string;
  workpaperId: string;
  /** FirmItem.key, or `learned:${LearnedCheck.id}`. */
  key: string;
  answer: "none" | "ok" | "flagged" | "na";
  note?: string;
  /** Per-test ticks, same order as FirmItem.tests. */
  tests?: boolean[];
  at: string;
}

// ---------- names ----------

/** "Client Name - FY 2025-26 - Accounts Receivable.xlsx" → "Accounts Receivable". */
export function templateNameFromFile(fileName: string): string {
  let s = fileName.replace(/^.*[\\/]/, "").replace(/\.(xlsx|xlsm|xls|csv)$/i, "");
  s = s.replace(/^copy of\s+/i, "").replace(/^\d+\.\s*/, "");
  const parts = s
    .split(/\s+-\s*|\s*-\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^(<<)?client( name)?(>>)?$/i.test(p) && !/^fy\s*\d{2,4}(\s*-\s*\d{2,4})?$/i.test(p) && !/^\d{4}-\d{2}$/.test(p) && !/^(copy|v\d+)$/i.test(p));
  let name = (parts.length ? parts.join(" - ") : s).replace(/^(<<)?client( name)?(>>)?\s*-?\s*/i, "");
  name = name.replace(/\s+(v\d+|copy)$/i, "").replace(/-\d+$/, "").replace(/\s+/g, " ").trim();
  return name || s;
}

// ---------- test splitting ----------

const clean = (s: unknown) =>
  String(s ?? "")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
const isJunk = (s: string) =>
  !s ||
  s.length < 3 ||
  /^[-+]?[\d,.]+(e[-+]?\d+)?%?$/i.test(s) ||
  /^#(div\/0!|ref!|n\/a|value!|name\?)$/i.test(s) ||
  /^(completed\s*\/\s*pending|yes|no|yes\s*\/\s*no|na|n\.a\.?|nil|-|a|tbd|wip)$/i.test(s);

/**
 * Splits "1.Tracking of long outstandings 2.Irregularities…" (or one test per
 * line) into separate tests. Only consecutive markers count (1, 2, 3… or
 * a, b, c…), so dates like 1.04.2025 or "Section 186" stay intact.
 */
export function splitTests(text: string): string[] {
  const out: string[] = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const l = clean(line).replace(/^[-•*·]\s*/, "");
    if (!l) continue;
    const cuts: number[] = [];
    for (const kind of ["num", "alpha"] as const) {
      const re = kind === "num" ? /(^|[\s;,])\(?(\d{1,2})[.)]\s*(?=[A-Za-z(])/g : /(^|[\s;,])\(?([a-h])[.)]\s+(?=[A-Za-z(])/g;
      let want = kind === "num" ? 1 : 0;
      const found: number[] = [];
      for (const m of l.matchAll(re)) {
        const n = kind === "num" ? Number(m[2]) : m[2].charCodeAt(0) - 97;
        if (n === want) {
          found.push(m.index! + m[1].length);
          want++;
        }
      }
      if (found.length >= 2 || (found.length === 1 && found[0] === 0)) {
        cuts.push(...found);
        break;
      }
    }
    if (!cuts.length) {
      out.push(l);
      continue;
    }
    if (cuts[0] > 0) out.push(l.slice(0, cuts[0]).trim().replace(/[:\-–]$/, "").trim());
    cuts.forEach((c, i) => out.push(l.slice(c, cuts[i + 1] ?? l.length).trim()));
  }
  return out
    .map((t) => t.replace(/^\(?(\d{1,2}|[a-h])[.)]\s*/, "").replace(/[;,]$/, "").trim())
    .filter((t) => !isJunk(t));
}

// ---------- workbook parsing ----------

const norm = (s: string) => clean(s).toLowerCase().replace(/\s+/g, " ");
const SNO = (s: string) => /^(s|sl|sr)\.?\s*(no|n)\.?$|^sno$|^s\.no\.?$|^sl\.\s*no\.?$/i.test(clean(s).replace(/\s+/g, " "));
const TITLE =
  /^(checklist|audit procedures?( to be performed| tracker)?|name of the procedures?|procedures to be performed|procedures? performed|area|particulars?|asset|questions?|audit programme|checks?)$/;
const TESTS = /^(details|sub-?procedures|procedures performed|audit procedures|check|analysis|particulars?)$/;
const NOTE = /^(inputs required|potential risks?|related risks?|risks?|points to be kept in mind|assertions?)$/;
const PROC_SHEET = /checklist|audit procedures?|procedures? (performed|to be performed)|procedure\s*&\s*scope|audit programme/i;

/** The only sheets parseFirmWorkbook reads (so big workbooks can skip the rest). */
export const FIRM_SHEETS = (name: string) => PROC_SHEET.test(name.trim()) || /^index$/i.test(name.trim());

interface Header {
  row: number;
  sno?: number;
  title: number;
  tests: number[];
  notes: { col: number; label: string }[];
  why?: number;
  assertions: boolean;
}

function findHeaders(rows: string[][]): Header[] {
  const out: Header[] = [];
  rows.forEach((r, i) => {
    const cells = r.map(norm);
    const titleCol = cells.findIndex((c) => TITLE.test(c));
    const assertionCol = cells.findIndex((c) => c === "assertion" || c === "assertions");
    const isAssertionTable = assertionCol >= 0 && (titleCol < 0 || /^checks?$/.test(cells[titleCol]));
    const aux = cells.some((c, j) => j !== titleCol && /details|sub-?procedures|procedures?|status|remarks|verified|performed|annexure|reference|risk|analysis|inputs required|work status|conclusion/.test(c));
    if (titleCol < 0 && assertionCol < 0) return;
    // "1 | Procedures to be performed | 1. Ageing…" is a data row, not a header.
    if (cells.some((c) => /^\d+(\.\d+)?$/.test(c))) return;
    if (!aux && !cells.some(SNO)) return;
    const title = titleCol >= 0 ? titleCol : assertionCol;
    const sno = cells.findIndex((c, j) => j < title && SNO(c));
    const tests = cells.map((c, j) => (j !== title && TESTS.test(c) ? j : -1)).filter((j) => j >= 0);
    const notes = cells.map((c, j) => (j !== title && NOTE.test(c) ? { col: j, label: clean(r[j]) } : null)).filter((x): x is { col: number; label: string } => !!x);
    const why = cells.findIndex((c, j) => j !== title && /^(remarks|purpose|objective)$/.test(c));
    out.push({ row: i, sno: sno >= 0 ? sno : undefined, title, tests, notes, why: why >= 0 ? why : undefined, assertions: isAssertionTable });
  });
  return out;
}

const kindOf = (title: string): FirmItemKind =>
  /^inputs?( required)?\b/i.test(title) ? "inputs" : /^(risk|potential risk)/i.test(title) ? "risks" : /disclosure/i.test(title) ? "disclosure" : "check";

const STOP_ROW = /^(assertions covered|applicable standards?|link to the standards?)$/i;

function parseTable(rows: string[][], h: Header, end: number): FirmItem[] {
  const items: FirmItem[] = [];
  let cur: FirmItem | null = null;
  let group: string | undefined;
  // Without a serial-number column: an unnumbered row among numbered ones, or a
  // repeated title, is a heading; the plain rows under it are its tests.
  let sawNumbered = false;
  let heading = false;
  for (let i = h.row + 1; i < end; i++) {
    const r = rows[i] ?? [];
    const firstText = clean(r.find((c) => clean(c)) ?? "");
    if (STOP_ROW.test(firstText)) break;
    const sno = h.sno !== undefined ? clean(r[h.sno]) : "";
    const rawTitle = clean(r[h.title]);
    const title = rawTitle.replace(/\s*\n\s*/g, " ");
    const tests = h.tests.flatMap((c) => splitTests(r[c] ?? ""));
    const notes = h.notes.map((n) => ({ label: n.label, text: clean(r[n.col]) })).filter((n) => n.text && !isJunk(n.text));
    const why = h.why !== undefined ? clean(r[h.why]) : "";
    if (!title && !tests.length && !notes.length) continue;

    // "A | Recognition" → a heading for the items below it.
    if (/^[A-Z]$/.test(sno) && title && !tests.length) {
      group = title;
      cur = null;
      continue;
    }
    // "a. Basic pay" under "Reconcile pay with the books:" → a test of that item.
    if (cur && /:\s*$/.test(cur.title) && /^\(?[a-z][.)]\s+/i.test(title)) {
      cur.tests.push(title.replace(/^\(?[a-z][.)]\s+/i, ""));
      continue;
    }
    if (h.sno === undefined && title) {
      const isNum = /^\(?\d{1,2}[.)]/.test(title);
      const again = items.find((it) => norm(it.title) === norm(title));
      if (heading && cur && !notes.length && !again) {
        cur.tests.push(...splitTests(rawTitle), ...tests);
        continue;
      }
      heading = false;
      if (again && !notes.length) {
        cur = again;
        heading = true;
        continue;
      }
      if (!isNum && sawNumbered && !notes.length && !tests.length) heading = true;
      if (isNum) sawNumbered = true;
    }
    const numbered = /^(\d+(\.\d+)?|#ref!)$/i.test(sno) || /^[a-z]$/.test(sno);
    const startsNew = h.sno !== undefined ? (numbered || (!sno && !cur)) && !!title : !!title;
    if (startsNew && !isJunk(title)) {
      // A title cell can itself be "1. Evaluate … 2. …" (or a list of inputs on separate lines).
      const parts = splitTests(rawTitle);
      const head = parts.length > 1 && !tests.length && h.tests.length === 0 && kindOf(parts[0]) === "check" ? parts[0] : title.replace(/^\(?\d{1,2}[.)]\s*/, "");
      cur = { key: "", group, title: head, kind: kindOf(head), tests: [...(parts.length > 1 && head === parts[0] ? parts.slice(1) : []), ...tests], notes: notes.length ? notes : undefined, why: why && !isJunk(why) ? why : undefined };
      if (h.assertions) cur.kind = "check";
      items.push(cur);
      continue;
    }
    if (!cur) continue;
    // Continuation row: more tests (or inputs) for the current item.
    if (title && !isJunk(title)) cur.tests.push(...splitTests(rawTitle));
    cur.tests.push(...tests);
    if (notes.length) cur.notes = [...(cur.notes ?? []), ...notes];
  }
  return items;
}

/** Sections listed on the workbook's Index sheet ("TB Extract", "Summary"…). */
function parseIndex(rows: string[][]): { title: string; why?: string }[] {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map(norm);
    let col = cells.findIndex((c) => c === "particulars" || c === "particular");
    if (col < 0) col = cells.findIndex((c) => c === "procedures performed");
    if (col < 0) col = cells.findIndex((c) => c === "index");
    if (col < 0) continue;
    const sno = cells.findIndex((c, j) => j < col && SNO(c));
    const why = cells.findIndex((c, j) => j > col && /^(remarks|purpose)$/.test(c));
    const out: { title: string; why?: string }[] = [];
    for (let k = i + 1; k < rows.length; k++) {
      const r = rows[k];
      if (sno >= 0 && !/^\d+$/.test(clean(r[sno]))) continue;
      const t = clean(r[col]).replace(/\s*\n\s*/g, " ");
      if (!t || isJunk(t) || /^(index|charts?|knowledge bank|reading|attachments?( \(if any\))?)$/i.test(t)) continue;
      const w = why >= 0 ? clean(r[why]) : "";
      out.push(w && !isJunk(w) ? { title: t, why: w } : { title: t });
    }
    if (out.length >= 2) return out;
  }
  return [];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export interface ParsedFirmTemplate {
  name: string;
  areas: AreaId[];
  items: FirmItem[];
  /** Sheets the questions came from. */
  sheets: string[];
}

/**
 * Reads a firm work-paper template: the checklist / procedures tables become
 * questions with their tests; the Index sheet becomes "are these sections
 * completed?" (or, with no checklist at all, one question per section).
 * Returns null when the workbook has nothing to ask.
 */
export function parseFirmWorkbook(fileName: string, sheets: SheetData[]): ParsedFirmTemplate | null {
  const name = templateNameFromFile(fileName);
  const items: FirmItem[] = [];
  const used: string[] = [];
  const procSheets = sheets.filter((s) => PROC_SHEET.test(s.name.trim()));
  for (const s of procSheets) {
    const headers = findHeaders(s.rows);
    const before = items.length;
    headers.forEach((h, i) => {
      if (h.assertions) return; // assertion definitions, not checks
      items.push(...parseTable(s.rows, h, headers[i + 1]?.row ?? s.rows.length));
    });
    if (items.length > before) used.push(s.name.trim());
  }

  const indexSheet = sheets.find((s) => /^index$/i.test(s.name.trim()));
  const sections = indexSheet ? parseIndex(indexSheet.rows) : [];
  if (sections.length) {
    used.push(indexSheet!.name.trim());
    if (items.filter((i) => i.kind === "check").length)
      items.push({ key: "", title: "Sections of the work paper completed", kind: "sections", tests: sections.map((s) => s.title), why: "Every section in the template's index should be filled in or marked not applicable." });
    else for (const s of sections) items.push({ key: "", title: s.title, kind: "check", tests: [], why: s.why });
  }
  if (!items.length) return null;

  // "Procedures to be performed: 1… 2… 3…" → one question per procedure.
  const GENERIC_HEAD = /^(procedures?( to be performed| performed)?|checks?( performed)?|audit procedures?( to be performed)?|work to be done)$/i;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "check" && GENERIC_HEAD.test(it.title.trim()) && it.tests.length > 1)
      items.splice(i, 1, ...it.tests.map((t): FirmItem => ({ key: "", group: it.group, title: t, kind: kindOf(t) === "inputs" ? "check" : kindOf(t), tests: [], why: it.why })));
  }

  // Inputs first, then checks in workbook order, then risks/disclosures, then sections.
  const rank: Record<FirmItemKind, number> = { inputs: 0, check: 1, risks: 2, disclosure: 2, sections: 3 };
  const ordered = items.map((it, i) => ({ it, i })).sort((a, b) => rank[a.it.kind] - rank[b.it.kind] || a.i - b.i).map((x) => x.it);
  const seen = new Map<string, number>();
  for (const it of ordered) {
    it.tests = [...new Set(it.tests.map(clean).filter((t) => !isJunk(t) && norm(t) !== norm(it.title)))];
    const base = slug(`${it.group ?? ""} ${it.title}`) || "item";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    it.key = n > 1 ? `${base}-${n}` : base;
  }
  return { name, areas: inferAreas(name).filter((a) => a !== "general"), items: ordered, sheets: used };
}

// ---------- matching a work paper to a template ----------

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !["the", "and", "for", "of", "client", "name", "fy", "as", "ind"].includes(w))
      .map((w) => w.replace(/(ies|es|s)$/, "")),
  );

const GENERIC = new Set(["reconciliation", "reco", "working", "workings", "analysi", "review", "check", "expense", "other", "verification", "account"]);

/** Templates ranked by how well they fit a work paper (best first, only plausible ones). */
export function matchTemplates(wp: { title: string; area?: string }, templates: Pick<FirmTemplate, "id" | "name" | "areas">[]): { id: string; score: number }[] {
  const wpWords = words(wp.title);
  const wpAreas = new Set<string>([...(wp.area ? [wp.area] : []), ...inferAreas(wp.title)]);
  return templates
    .map((t) => {
      const tw = words(t.name);
      // Generic words ("reconciliation", "workings") count for less than names like GST or PF.
      const weight = (w: string) => (GENERIC.has(w) ? 0.25 : 1);
      let hit = 0;
      let total = 0;
      for (const w of tw) {
        total += weight(w);
        if (wpWords.has(w)) hit += weight(w);
      }
      const nameScore = total ? hit / total : 0;
      const areaScore = t.areas.some((a) => wpAreas.has(a)) ? 0.6 : 0;
      return { id: t.id, score: nameScore + areaScore };
    })
    .filter((m) => m.score >= 0.5)
    .sort((a, b) => b.score - a.score || nameLen(a.id) - nameLen(b.id));
  function nameLen(id: string) {
    return templates.find((t) => t.id === id)?.name.length ?? 0;
  }
}

// ---------- the reviewer's questions ----------

export interface FirmCue {
  key: string;
  phase: "template" | "learned";
  title: string;
  kind: FirmItemKind | "learned";
  group?: string;
  tests: string[];
  why?: string;
  notes?: { label: string; text: string }[];
  answer: FirmAnswer["answer"];
  note?: string;
  testsDone: boolean[];
  /** Learned check not yet answered on this WP. */
  isNew?: boolean;
  learnedId?: string;
  addedOn?: string;
}

/** Checks that apply to a WP: its own, its template's and its area's. */
export function learnedFor(learned: LearnedCheck[], wp: { id: string; area?: string }, templateId?: string): LearnedCheck[] {
  return learned
    .filter((l) => (l.workpaperId ? l.workpaperId === wp.id : l.templateId ? l.templateId === templateId : !!l.area && l.area === wp.area))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Questions for a WP in order: the template's basics, then checks added along the way. */
export function firmCues(template: FirmTemplate | undefined, learned: LearnedCheck[], answers: FirmAnswer[], workpaperId: string): FirmCue[] {
  const byKey = new Map(answers.filter((a) => a.workpaperId === workpaperId).map((a) => [a.key, a]));
  const out: FirmCue[] = [];
  for (const it of template?.items ?? []) {
    const a = byKey.get(it.key);
    out.push({
      key: it.key,
      phase: "template",
      title: it.title,
      kind: it.kind,
      group: it.group,
      tests: it.tests,
      why: it.why,
      notes: it.notes,
      answer: a?.answer ?? "none",
      note: a?.note,
      testsDone: it.tests.map((_, i) => !!a?.tests?.[i]),
    });
  }
  for (const l of learned) {
    const key = `learned:${l.id}`;
    const a = byKey.get(key);
    out.push({
      key,
      phase: "learned",
      title: l.text,
      kind: "learned",
      tests: [],
      why: l.why,
      answer: a?.answer ?? "none",
      note: a?.note,
      testsDone: [],
      isNew: !a || a.answer === "none",
      learnedId: l.id,
      addedOn: l.createdAt.slice(0, 10),
    });
  }
  return out;
}
