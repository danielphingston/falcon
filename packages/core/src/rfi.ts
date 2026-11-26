/**
 * Request for Information (RFI / IRL) sheets: the list of documents asked of
 * the client, usually an Excel tracker with sections ("1 General", "8 Trade
 * Payables"…), numbered requests, status, dates and comments. Parsing turns
 * one into IRL items for an engagement; re-importing an updated RFI updates
 * those items instead of duplicating them.
 *
 * Layouts differ by team and engagement, so columns are found by their
 * headers, and every column that isn't one of the app's own fields is kept
 * with its header ("Criticality", "Folder link", "Remarks - Firm"…).
 * Annexure sheets (A, A1, A2…, "Annexure …") are not read.
 */
import { createInfoRequest, update, newId, type Ctx } from "./actions";
import type { InfoRequest } from "./schema";
import type { SheetData } from "./teamImport";

export interface RfiField {
  label: string;
  value: string;
  /** The cell's web link, e.g. a "Folder link" to the data room. */
  link?: string;
}

export interface RfiItem {
  /** App numbering: section.item (1.1, 1.2 … 1.10), not the sheet's decimal serials. */
  number: string;
  section?: string;
  /** Sub-heading inside the section ("Bank", "Employee Statutory Dues › ESIC"). */
  subsection?: string;
  /** The request, with its sub-points on following lines. */
  description: string;
  status?: InfoRequest["status"];
  /** Sheet said "Not available" (kept as n.a. with a note). */
  notAvailable?: boolean;
  requestedOn?: string;
  receivedOn?: string;
  due?: string;
  annexure?: string;
  remarks?: string;
  responsible?: string;
  clientComment?: string;
  /** Every other column, with the sheet's header as the label. */
  fields?: RfiField[];
}

export interface RfiInfo {
  /** Title block above the table: client, engagement, period, "Last updated: …". */
  title: string[];
  /** Notes to the client (a Notes sheet, and notes under the table). */
  notes: string[];
  /** Explanatory text under a section heading. */
  sectionNotes: Record<string, string>;
  /** The table's column headers, as in the sheet. */
  columns: string[];
  /** Per sheet: the status-like columns found, and the one that drives Falcon's status. */
  statusColumns: { sheet: string; options: string[]; chosen: string }[];
  /** Each distinct status value in the chosen columns, how often, and what it maps to (undefined = not recognised). */
  statusValues: { value: string; count: number; status?: InfoRequest["status"] | "ignore"; fromMap: boolean }[];
}

/** Choices remembered per engagement: which column is the status, and how its words map. */
export interface RfiParseOptions {
  /** Sheet name → header of the status column ("" = no status column). */
  statusColumns?: Record<string, string>;
  /** Status word (lower case, single spaces) → status, or "ignore" to leave unchanged. */
  statusMap?: Record<string, InfoRequest["status"] | "ignore">;
}

/** "Partially  Received " → "partially received": the key used in a status map. */
export const statusKey = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Which status column to trust by default: the firm's own ("V&S Status",
 * "Status", "Status of Input") over the client's ("Status Acme", "Current
 * Status", "Client status").
 */
export function rankStatusColumn(label: string, clientWord?: string): number {
  const l = label.toLowerCase();
  if ((clientWord && l.includes(clientWord)) || /client|auditee|management|current/.test(l)) return -5;
  if (/v\s*&\s*s|\bour\b|firm|internal|auditor/.test(l)) return 3;
  if (/^status$|status of input|input status/.test(l.trim())) return 2;
  return 0;
}

export interface ParsedRfi {
  sheet: string;
  items: RfiItem[];
  sections: string[];
  warnings: string[];
  info: RfiInfo;
}

const clean = (v: unknown) =>
  String(v ?? "")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
const norm = (v: unknown) => clean(v).toLowerCase();

/** Excel serial (45748) or a typed date (31/03/2026, 31-Mar-26, 2026-03-31) → YYYY-MM-DD. */
export function rfiDate(v: unknown): string | undefined {
  const s = clean(v);
  if (!s) return undefined;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s));
    if (n < 30000 || n > 80000) return undefined;
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = /^(\d{1,2})[\s\-/]*([a-z]{3})[a-z]*[\s\-/,]*(\d{2,4})$/i.exec(s);
  if (m && months.includes(m[2].toLowerCase())) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${String(months.indexOf(m[2].toLowerCase()) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return undefined;
}

/** The sheet's status words → app status. "To be received" is still pending. */
/** The item's criticality / priority from the RFI sheet, tidied ("high" → "High"). */
export function rfiCriticality(item: { fields?: { label: string; value: string }[] }): string | undefined {
  const v = item.fields?.find((f) => /critical|priority/i.test(f.label))?.value?.trim();
  return v ? v[0].toUpperCase() + v.slice(1).toLowerCase() : undefined;
}

/** Sort rank for criticality chips: High, Medium, Low, then anything else. */
export function criticalityRank(c: string): number {
  return /critical/i.test(c) ? 0 : /high/i.test(c) ? 1 : /medium|moderate/i.test(c) ? 2 : /low/i.test(c) ? 3 : 4;
}

export function rfiStatus(v: unknown):{ status?: InfoRequest["status"]; notAvailable?: boolean } {
  const s = norm(v);
  if (!s) return {};
  if (/not\s*available|unavailable/.test(s)) return { status: "na", notAvailable: true };
  if (/not\s*applicable|^n\.?\s*a\.?$/.test(s)) return { status: "na" };
  if (/partial|partly|part\b/.test(s)) return { status: "partial" };
  if (/to be received|yet to|not (yet )?received|pending|shared|requested|open|awaited|sent|wip|in progress/.test(s)) return { status: "pending" };
  if (/received|completed?|done|closed|provided|submitted/.test(s)) return { status: "received" };
  return {};
}

// ---------- finding the table ----------

type Col = "sno" | "ref" | "area" | "desc" | "requestedOn" | "status" | "annexure" | "received" | "responsible" | "due" | "clientComment" | "remarks";

/** First match wins for each header cell. */
const HEADERS: [Col, RegExp][] = [
  ["sno", /^(s|sl|sr)\.?\s*no\.?$|^s\.?\s*no\.?$|^#$/],
  ["ref", /^(file|ref(erence)?|request|irl|rfi|item|doc(ument)?|query)\.?\s*(no|number|#|ref)\.?$/],
  ["area", /^(area|section|category|head|module|function|process|cycle|workstream)$/],
  [
    "desc",
    /^(particulars?|description|checklist|information (required|requested|sought)|documents? (required|requested)|details?|requirements?|request|items?|information|data required|quer(y|ies)|inputs? required)$/,
  ],
  ["requestedOn", /date of request|requested on|request date|date requested|date shared|date of requisition/],
  ["received", /date (of )?(receipt|received|input|submission)|received on|input date|date provided/],
  ["status", /^status/],
  ["annexure", /^annexure|^format$|^template$/],
  ["responsible", /person responsible|responsib|^owner$|spoc|point of contact|^poc$|^part(y|ies)$|contact person/],
  ["due", /^edr$|expected|^due|target date|timeline|deadline/],
  ["clientComment", /auditee|client('s)? (comment|remark|response)|management (comment|response)/],
  ["remarks", /^remarks?$|^comments?$|^notes?$/],
];

interface Header {
  row: number;
  cols: Partial<Record<Col, number>>;
  /** Columns that aren't one of the app's fields: kept with their header. */
  extras: { col: number; label: string }[];
  labels: string[];
}

function findHeader(rows: string[][]): Header | null {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const cols: Partial<Record<Col, number>> = {};
    const extras: { col: number; label: string }[] = [];
    const labels: string[] = [];
    rows[i].forEach((raw, j) => {
      const c = norm(raw);
      if (!c) return;
      labels.push(clean(raw));
      const hit = HEADERS.find(([col, re]) => re.test(c) && cols[col] === undefined);
      if (hit) cols[hit[0]] = j;
      else extras.push({ col: j, label: clean(raw) });
    });
    if (cols.desc !== undefined && (cols.sno !== undefined || cols.ref !== undefined || cols.status !== undefined || cols.requestedOn !== undefined)) return { row: i, cols, extras, labels };
  }
  return null;
}

const isAnnexure = (name: string) => /^a\d*$|annex|^format/i.test(name.trim());
const isNotes = (name: string) => /^(notes?|instructions?|read ?me|guidelines?)$/i.test(name.trim());
/** Legend cells next to the title ("Received", "To be Received", "High"…), not text. */
const isLegend = (s: string) => (s.length <= 25 && !!rfiStatus(s).status) || /^(high|medium|low|critical)$/i.test(s);

/**
 * The sheet's request number, recovered from Excel's decimal serial: "2.1"
 * after 2.9 is 2.10, "4.0999999999999996" is 4.1. Returns null when the cell
 * isn't a section.item number.
 */
export function rfiNumber(raw: string, prev: { major: number; minor: number } | null): { major: number; minor: number } | null {
  const s = clean(raw);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  // Written out with a trailing zero ("5.10", "8.20": Excel's displayed text), the number is exact.
  const exact = /^(\d+)\.(\d*0|\d{2,})$/.exec(s);
  if (exact && exact[2].length <= 3 && Number(exact[2]) > 0) return { major: Number(exact[1]), minor: Number(exact[2]) };
  const n = Number(s);
  const major = Math.floor(n + 1e-9);
  const frac = (Math.round((n - major) * 100) / 100).toFixed(2).slice(2).replace(/0+$/, "");
  if (!frac) return null;
  const candidates = [Number(frac), Number(frac + "0")];
  const after = prev && prev.major === major ? prev.minor : 0;
  const minor = candidates.find((c) => c > after) ?? candidates[0];
  return { major, minor };
}

/** Title block above the header: client, engagement, period, "Last updated: <date>" (legends skipped). */
function titleLines(rows: string[][], upto: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < upto; i++) {
    const cells = (rows[i] ?? []).map(clean);
    const parts: string[] = [];
    cells.forEach((c, j) => {
      if (!c || isLegend(c)) return;
      if (j > 0 && /:\s*$/.test(cells[j - 1] ?? "")) return; // value of a "Label:" cell, added below
      if (/:\s*$/.test(c)) {
        const v = cells.slice(j + 1).find((x) => x);
        parts.push(v ? `${c} ${rfiDate(v) ?? v}` : c);
      } else parts.push(c);
    });
    if (parts.length) out.push(parts.join(" · "));
  }
  return [...new Set(out)];
}

/** The client's name's first distinctive word, to spot the client's own columns ("Remarks [Acme]" for Acme Pvt Ltd). */
function clientWord(title: string[]): string | undefined {
  const line = title.find((t) => /private limited|pvt|ltd|limited|llp|inc\b|corp/i.test(t)) ?? title[0];
  const w = line?.split(/[\s,.-]+/).find((x) => x.length >= 4 && !/^(client|name|the|private|limited)$/i.test(x));
  return w?.toLowerCase();
}

/**
 * Reads an RFI / IRL workbook: every request sheet (one with a
 * "Particulars / Checklist" style header; annexure sheets skipped) plus a
 * Notes sheet if there is one.
 */
export function parseRfi(sheets: SheetData[], opts: RfiParseOptions = {}): ParsedRfi | null {
  const candidates = sheets
    .filter((s) => !isAnnexure(s.name) && !isNotes(s.name))
    .sort((a, b) => Number(/rfi|irl|request|requisition/i.test(b.name)) - Number(/rfi|irl|request|requisition/i.test(a.name)));
  const items: RfiItem[] = [];
  const sections: string[] = [];
  const warnings: string[] = [];
  const info: RfiInfo = { title: [], notes: [], sectionNotes: {}, columns: [], statusColumns: [], statusValues: [] };
  const seenValues = new Map<string, { value: string; count: number; status?: InfoRequest["status"] | "ignore"; fromMap: boolean }>();
  /** The sheet's word → status, through the user's map first; unknown words aren't guessed. */
  const mapStatus = (raw: string): { status?: InfoRequest["status"]; notAvailable?: boolean } => {
    const v = clean(raw);
    if (!v) return {};
    const k = statusKey(v);
    const mapped = opts.statusMap?.[k];
    const known = mapped === undefined ? rfiStatus(v) : {};
    const status = mapped ?? known.status;
    const seen = seenValues.get(k) ?? { value: v, count: 0, status, fromMap: mapped !== undefined };
    seen.count++;
    seenValues.set(k, seen);
    if (mapped === "ignore" || !status) return {};
    return mapped !== undefined ? { status: mapped as InfoRequest["status"] } : known;
  };
  const used: string[] = [];
  let sectionNo = 0;

  for (const sheet of candidates) {
    const h = findHeader(sheet.rows);
    if (!h) continue;
    const { cols } = h;
    const before = items.length;
    const title = titleLines(sheet.rows, h.row);
    if (!info.title.length) info.title = title;
    info.columns = [...new Set([...info.columns, ...h.labels])];
    const cw = clientWord(title);
    // The client's own columns ("Remarks - Acme", "Acme Status") are the client's comment.
    // A second plain "Remarks" after the auditee's comment column is the client's too.
    const clientCols = h.extras.filter(
      (e) => (cw && e.label.toLowerCase().includes(cw)) || (cols.clientComment !== undefined && e.col > cols.clientComment && /^remarks?$/i.test(e.label)),
    );
    // The status column: the user's choice for this sheet, else the firm's own over the client's.
    const statusOpts = h.labels.length ? sheet.rows[h.row].map((c, j) => ({ col: j, label: clean(c) })).filter((x) => /status/i.test(x.label)) : [];
    if (statusOpts.length) {
      const want = opts.statusColumns?.[sheet.name];
      const chosen =
        want !== undefined
          ? statusOpts.find((x) => x.label.toLowerCase() === want.toLowerCase())
          : [...statusOpts].sort((a, b) => rankStatusColumn(b.label, cw) - rankStatusColumn(a.label, cw))[0];
      const usable = chosen && rankStatusColumn(chosen.label, cw) > -5 ? chosen : want !== undefined ? chosen : undefined;
      // Every other status column is kept as information, with its header.
      for (const x of statusOpts)
        if (x.col !== usable?.col && !h.extras.some((e) => e.col === x.col) && !clientCols.some((e) => e.col === x.col)) h.extras.push({ col: x.col, label: x.label });
      if (usable) {
        cols.status = usable.col;
        const i = h.extras.findIndex((e) => e.col === usable.col);
        if (i >= 0) h.extras.splice(i, 1);
        const j = clientCols.findIndex((e) => e.col === usable.col);
        if (j >= 0) clientCols.splice(j, 1);
      } else delete cols.status;
      info.statusColumns.push({ sheet: sheet.name, options: statusOpts.map((x) => x.label), chosen: usable?.label ?? "" });
    }
    const extras = h.extras.filter((e) => !clientCols.includes(e));
    const get = (r: string[], c: Col) => (cols[c] !== undefined ? clean(r[cols[c]!]) : "");
    const hasArea = cols.area !== undefined;
    const hasRef = cols.ref !== undefined;
    const structured = hasArea || hasRef; // newer layouts: Area / File No columns

    let section: string | undefined;
    let itemNo = 0;
    let sub: string[] = [];
    let lastWasSub = false;
    let cur: RfiItem | null = null;
    let footer = false;

    let rowIdx = 0;
    const linkAt = (col: number) => sheet.links?.[`${rowIdx},${col}`];
    const extrasOf = (r: string[]) =>
      extras
        .map(({ col, label }): RfiField | null => {
          const v = clean(r[col]);
          const link = linkAt(col);
          if (!v && !link) return null;
          return { label, value: v ? (/date/i.test(label) ? (rfiDate(v) ?? v) : v) : link!, ...(link ? { link } : {}) };
        })
        .filter((f): f is RfiField => !!f);
    // With more than one client column, keep their headers: "Acme Status: Shared · Remarks [Acme]: …".
    const clientOf = (r: string[]) => {
      const parts = [
        ...(get(r, "clientComment") ? [{ label: clean(sheet.rows[h.row][cols.clientComment!]), v: get(r, "clientComment") }] : []),
        ...clientCols.map((c) => ({ label: c.label, v: clean(r[c.col]) })),
      ].filter((p) => p.v);
      const many = (cols.clientComment !== undefined ? 1 : 0) + clientCols.length > 1;
      return parts.map((p) => (many && !/^remarks?$|auditee|client|management/i.test(p.label ?? "") ? `${p.label}: ${p.v}` : p.v)).join(" · ");
    };
    let prevNum: { major: number; minor: number } | null = null;
    const startSection = (name: string, sno: string) => {
      section = name;
      sectionNo = /^\d{1,3}$/.test(sno) ? Number(sno) : sectionNo + 1;
      if (!sections.includes(name)) sections.push(name);
      itemNo = 0;
      prevNum = null;
      sub = [];
      lastWasSub = false;
      cur = null;
    };
    const heading = (label: string) => {
      const l = label.replace(/:\s*$/, "").trim();
      if (lastWasSub) sub.push(l);
      else if (sub.length >= 2 && l.length <= 12) sub[sub.length - 1] = l; // "PF" after "Employee Statutory Dues › ESIC"
      else sub = [l];
      lastWasSub = true;
      cur = null;
    };

    for (let i = h.row + 1; i < sheet.rows.length; i++) {
      rowIdx = i;
      const r = sheet.rows[i] ?? [];
      const text = r.map(clean).filter(Boolean);
      if (!text.length) continue;
      if (footer) {
        info.notes.push(text.join(" "));
        continue;
      }
      const sno = get(r, "sno");
      const ref = get(r, "ref");
      const area = get(r, "area");
      const desc = clean(r[cols.desc!]).replace(/\r?\n\s*/g, "\n");
      const strong = !!(get(r, "status") || get(r, "requestedOn") || get(r, "received"));
      const anyData = strong || !!(get(r, "due") || get(r, "responsible") || clientOf(r) || extrasOf(r).length);

      // "Please Note: …" below the table.
      if (!desc && !ref && !area && sno && !/^\d/.test(sno)) {
        footer = true;
        info.notes.push(text.join(" "));
        continue;
      }
      if (hasArea && area) startSection(area, sno);
      else if (!structured && /^\d{1,3}$/.test(sno) && desc && !anyData && !/^\d/.test(desc)) {
        // Older layout: "8 | Trade Payables" on its own row.
        startSection(desc, sno);
        continue;
      }
      if (!desc) {
        // Extra columns on a row of their own belong to the request above.
        if (cur) {
          const f = extrasOf(r);
          if (f.length) cur.fields = [...(cur.fields ?? []), ...f];
        }
        continue;
      }

      const num = hasRef ? ref : sno;
      const numbered = !!num && /^\d/.test(num);
      const bullet = /^[-•*·]|^\(?[a-z0-9]{1,2}[.)]\s/i.test(desc);
      let kind: "item" | "heading" | "note" | "more";
      if (numbered) kind = !strong && structured && /:\s*$/.test(desc) && !anyData ? "heading" : "item";
      else if (bullet && cur) kind = "more";
      else if (strong) kind = "item";
      else if (structured) kind = desc.length > 70 && !/:\s*$/.test(desc) ? "note" : "heading";
      else kind = cur ? "more" : "item";

      if (kind === "heading") {
        // A numbered heading ("2.13 Sales farming:") still uses up its number.
        const hn: { major: number; minor: number } | null = numbered ? rfiNumber(num, prevNum) : null;
        if (hn) {
          prevNum = hn;
          itemNo = Math.max(itemNo, hn.minor);
        }
        heading(desc);
        continue;
      }
      if (kind === "note") {
        const k = section ?? "";
        info.sectionNotes[k] = info.sectionNotes[k] ? `${info.sectionNotes[k]}\n${desc}` : desc;
        continue;
      }
      if (kind === "more" && cur) {
        const c: RfiItem = cur;
        c.description += `\n${desc}`;
        const extra = get(r, "remarks");
        if (extra) c.remarks = c.remarks ? `${c.remarks} · ${extra}` : extra;
        const f = extrasOf(r);
        if (f.length) c.fields = [...(c.fields ?? []), ...f];
        continue;
      }
      // Keep the sheet's own number (clients name files by it); otherwise number in order.
      const sn: { major: number; minor: number } | null = numbered ? rfiNumber(num, prevNum) : null;
      let number: string;
      if (sn && (!sectionNo || sn.major === sectionNo)) {
        number = `${sn.major}.${sn.minor}`;
        prevNum = sn;
        itemNo = Math.max(itemNo, sn.minor);
      } else {
        itemNo++;
        number = sectionNo ? `${sectionNo}.${itemNo}` : String(itemNo);
        prevNum = sectionNo ? { major: sectionNo, minor: itemNo } : prevNum;
      }
      // Two items never share a number (e.g. a mis-read 5.1 next to a real 5.1): the later one takes the next free number.
      if (items.some((x) => x.number === number)) {
        const major = number.includes(".") ? number.split(".")[0] : "";
        let k = itemNo;
        while (items.some((x) => x.number === (major ? `${major}.${k}` : String(k)))) k++;
        itemNo = k;
        number = major ? `${major}.${k}` : String(k);
        warnings.push(`Two rows had the same number; the second was renumbered to ${number}. Check it against the sheet.`);
      }
      lastWasSub = false;
      const st = mapStatus(get(r, "status"));
      const fields = extrasOf(r);
      const descLink = linkAt(cols.desc!);
      if (descLink) fields.unshift({ label: "Link", value: descLink, link: descLink });
      const item: RfiItem = {
        number,
        section,
        ...(sub.length ? { subsection: sub.join(" › ") } : {}),
        description: desc,
        ...st,
        requestedOn: rfiDate(get(r, "requestedOn")),
        receivedOn: rfiDate(get(r, "received")),
        due: rfiDate(get(r, "due")),
        annexure: get(r, "annexure") || undefined,
        remarks: get(r, "remarks") || undefined,
        responsible: get(r, "responsible") || undefined,
        clientComment: clientOf(r) || undefined,
        ...(fields.length ? { fields } : {}),
      };
      items.push(item);
      cur = item;
    }
    if (items.length > before) used.push(sheet.name);
  }
  if (!items.length) return null;

  // Notes to the client on a sheet of their own (title lines it repeats are left out).
  for (const s of sheets.filter((x) => isNotes(x.name))) {
    for (const r of s.rows) {
      const line = r.map(clean).filter(Boolean).join(" ");
      if (line && !info.title.includes(line) && !/^notes?:?$/i.test(line) && !info.notes.includes(line)) info.notes.push(line);
    }
  }
  if (!sections.length) warnings.push("No sections found; requests are numbered 1, 2, 3…");
  const skipped = sheets.filter((s) => isAnnexure(s.name)).map((s) => s.name);
  if (skipped.length) warnings.push(`Annexure sheets not imported: ${skipped.join(", ")}`);
  info.statusValues = [...seenValues.values()].sort((a, b) => b.count - a.count);
  const unknown = info.statusValues.filter((v) => !v.status);
  if (unknown.length) warnings.push(`Status words not recognised (left unchanged): ${unknown.map((v) => `“${v.value}”`).join(", ")}. Map them below.`);
  return { sheet: used.join(", "), items, sections, warnings, info };
}

// ---------- applying an RFI to an engagement ----------

/** Same request across RFI versions: section + first line of the description. */
export const rfiKey = (section: string | undefined, description: string) =>
  `${(section ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${description.split("\n")[0].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;

export interface RfiPlan {
  create: RfiItem[];
  update: { id: string; item: RfiItem; changes: string[] }[];
  unchanged: number;
}

const sameFields = (a: RfiField[] | undefined, b: RfiField[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** What importing this RFI would do to an engagement's existing items. */
export function planRfi(parsed: ParsedRfi, existing: InfoRequest[]): RfiPlan {
  const byKey = new Map(existing.filter((e) => !e.deleted).map((e) => [rfiKey(e.section, e.description), e]));
  const plan: RfiPlan = { create: [], update: [], unchanged: 0 };
  for (const it of parsed.items) {
    const old = byKey.get(rfiKey(it.section, it.description));
    if (!old) {
      plan.create.push(it);
      continue;
    }
    const changes: string[] = [];
    if (it.status && it.status !== old.status) changes.push(`status → ${it.status}`);
    if (it.due && it.due !== old.due) changes.push("expected date");
    if (it.clientComment && it.clientComment !== old.clientComment) changes.push("client comment");
    if (it.description !== old.description) changes.push("wording");
    if ((it.annexure ?? "") !== (old.annexure ?? "") && it.annexure) changes.push("annexure");
    if (it.responsible && it.responsible !== old.responsible) changes.push("person responsible");
    if ((it.subsection ?? "") !== (old.subsection ?? "")) changes.push("sub-heading");
    if (it.fields && !sameFields(it.fields, old.fields)) changes.push("other columns");
    if (changes.length) plan.update.push({ id: old.id, item: it, changes });
    else plan.unchanged++;
  }
  return plan;
}

/**
 * Creates and updates the engagement's IRL items from an RFI in one undoable
 * batch, and keeps the RFI's title, notes and columns on the engagement.
 * Chase history and the app's own notes are kept on updates.
 */
export async function applyRfi(
  ctx: Ctx,
  plan: RfiPlan,
  opts: { engagementId: string; today: string; requestedFromId?: string; resolvePerson?: (name: string) => string | undefined; file?: string; parsed?: ParsedRfi; statusMap?: RfiParseOptions["statusMap"] },
) {
  const batch: Ctx = { ...ctx, batchId: ctx.batchId ?? newId() };
  const out = [];
  const notesFor = (it: RfiItem) => [it.remarks, it.notAvailable ? "Client: not available" : ""].filter(Boolean).join("\n") || undefined;
  const fromFor = (it: RfiItem) => (it.responsible && opts.resolvePerson?.(it.responsible)) || opts.requestedFromId;
  const received = (it: RfiItem) => (it.receivedOn && (it.status === "received" || it.status === "na") ? { receivedAt: `${it.receivedOn}T12:00:00.000Z` } : {});
  for (const it of plan.create) {
    out.push(
      await createInfoRequest(batch, {
        engagementId: opts.engagementId,
        number: it.number,
        description: it.description,
        section: it.section,
        subsection: it.subsection,
        status: it.status ?? "pending",
        requestedOn: it.requestedOn ?? opts.today,
        due: it.due,
        annexure: it.annexure,
        responsible: it.responsible,
        clientComment: it.clientComment,
        notes: notesFor(it),
        requestedFromId: fromFor(it),
        ...(it.fields?.length ? { fields: it.fields } : {}),
        ...received(it),
      }),
    );
  }
  for (const u of plan.update) {
    const it = u.item;
    out.push(
      await update(batch, "infoRequests", u.id, {
        description: it.description,
        number: it.number,
        subsection: it.subsection ?? null,
        ...(it.status ? { status: it.status } : {}),
        ...(it.due ? { due: it.due } : {}),
        ...(it.annexure ? { annexure: it.annexure } : {}),
        ...(it.responsible ? { responsible: it.responsible } : {}),
        ...(it.clientComment ? { clientComment: it.clientComment } : {}),
        ...(it.fields ? { fields: it.fields } : {}),
        ...received(it),
      }),
    );
  }
  if (opts.parsed) {
    const { info, sheet } = opts.parsed;
    out.push(
      await update(batch, "engagements", opts.engagementId, {
        rfiInfo: {
          file: opts.file ?? "",
          sheet,
          title: info.title,
          notes: info.notes,
          sectionNotes: info.sectionNotes,
          columns: info.columns,
          importedAt: new Date().toISOString(),
          // Remembered for the next version of this IRL: which column is the status, and how its words map.
          statusColumns: Object.fromEntries(info.statusColumns.map((c) => [c.sheet, c.chosen])),
          ...(opts.statusMap && Object.keys(opts.statusMap).length ? { statusMap: opts.statusMap } : {}),
        },
      }),
    );
  }
  return out;
}
