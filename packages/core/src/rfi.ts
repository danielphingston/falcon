/**
 * Request for Information (RFI) sheets: the list of documents asked of the
 * client, usually an Excel tracker with sections ("1 Generals", "8 Trade
 * Payables"…), numbered requests, status, dates and comments. Parsing turns
 * one into IRL items for an engagement; re-importing an updated RFI updates
 * those items instead of duplicating them.
 */
import { createInfoRequest, update, newId, type Ctx } from "./actions";
import type { InfoRequest } from "./schema";
import type { SheetData } from "./teamImport";

export interface RfiItem {
  /** App numbering: section.item (1.1, 1.2 … 1.10), not the sheet's decimal serials. */
  number: string;
  section?: string;
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
}

export interface ParsedRfi {
  sheet: string;
  items: RfiItem[];
  sections: string[];
  warnings: string[];
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

/** The sheet's status words → app status. */
export function rfiStatus(v: unknown): { status?: InfoRequest["status"]; notAvailable?: boolean } {
  const s = norm(v);
  if (!s) return {};
  if (/not\s*available|unavailable/.test(s)) return { status: "na", notAvailable: true };
  if (/not\s*applicable|^n\.?\s*a\.?$/.test(s)) return { status: "na" };
  if (/partial|partly|part\b/.test(s)) return { status: "partial" };
  if (/received|completed?|done|closed|provided|submitted/.test(s)) return { status: "received" };
  if (/pending|shared|requested|open|awaited|sent|wip|in progress/.test(s)) return { status: "pending" };
  return {};
}

type Col = "sno" | "desc" | "requestedOn" | "status" | "annexure" | "remarks" | "received" | "responsible" | "due" | "clientComment" | "clientRemarks";

const HEADERS: [Col, RegExp][] = [
  ["sno", /^(s|sl|sr)\.?\s*no\.?$|^s\.?\s*no\.?$|^no\.?$|^#$/],
  ["desc", /^(particulars?|description|information (required|requested)|documents? (required|requested)|details?|requirement|request|items?)$/],
  ["requestedOn", /date of request|requested on|request date|date requested|date shared/],
  ["status", /^status/],
  ["annexure", /annexure|format|template/],
  ["received", /date (of )?receiv|received on|receipt date/],
  ["responsible", /person responsible|responsib|owner|spoc|point of contact/],
  ["due", /^edr$|expected|due|target|timeline|deadline/],
  ["clientComment", /auditee|client('s)? (comment|remark|response)|management (comment|response)|response/],
  ["remarks", /^remarks?|^comments?|^notes?/],
];

function findHeader(rows: string[][]): { row: number; cols: Partial<Record<Col, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const cells = rows[i].map(norm);
    const cols: Partial<Record<Col, number>> = {};
    cells.forEach((c, j) => {
      if (!c) return;
      for (const [col, re] of HEADERS) {
        if (!re.test(c)) continue;
        // A second "Remarks" after the auditee's comment column is the client's remarks.
        if (col === "remarks" && cols.remarks !== undefined) {
          if (cols.clientComment !== undefined && j > cols.clientComment && cols.clientRemarks === undefined) cols.clientRemarks = j;
          break;
        }
        if (cols[col] === undefined) cols[col] = j;
        break;
      }
    });
    if (cols.desc !== undefined && (cols.sno !== undefined || cols.status !== undefined || cols.requestedOn !== undefined)) return { row: i, cols };
  }
  return null;
}

/**
 * Reads an RFI tracker. Picks the sheet with a "Particulars / Status / Date of
 * request" style header (preferring one named RFI / IRL / request).
 */
export function parseRfi(sheets: SheetData[]): ParsedRfi | null {
  const ordered = [...sheets].sort((a, b) => Number(/rfi|irl|request|requisition/i.test(b.name)) - Number(/rfi|irl|request|requisition/i.test(a.name)));
  for (const sheet of ordered) {
    const h = findHeader(sheet.rows);
    if (!h) continue;
    const { cols } = h;
    const get = (r: string[], c: Col) => (cols[c] !== undefined ? clean(r[cols[c]!]) : "");
    const items: RfiItem[] = [];
    const sections: string[] = [];
    const warnings: string[] = [];
    let section: string | undefined;
    let sectionNo = 0;
    let itemNo = 0;
    let cur: RfiItem | null = null;

    for (let i = h.row + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i] ?? [];
      const sno = get(r, "sno");
      const desc = clean(r[cols.desc!]).replace(/\r?\n\s*/g, "\n");
      const data = (["requestedOn", "status", "received", "due", "clientComment", "responsible"] as Col[]).some((c) => get(r, c));
      if (!sno && !desc) continue;

      // "8 | Trade Payables" (whole number, nothing else on the row) starts a section.
      if (/^\d{1,3}$/.test(sno) && desc && !data && !/^\d/.test(desc)) {
        section = desc;
        sections.push(desc);
        sectionNo++;
        itemNo = 0;
        cur = null;
        continue;
      }
      // A numbered row, or an un-numbered row with its own status/date, is a request.
      const isItem = (!!sno && /^\d/.test(sno)) || (cols.sno === undefined && !!desc) || (!sno && !!desc && data && !cur);
      if (isItem) {
        if (!desc) continue; // numbered but blank
        itemNo++;
        const st = rfiStatus(get(r, "status"));
        cur = {
          number: sectionNo ? `${sectionNo}.${itemNo}` : String(itemNo),
          section,
          description: desc,
          ...st,
          requestedOn: rfiDate(get(r, "requestedOn")),
          receivedOn: rfiDate(get(r, "received")),
          due: rfiDate(get(r, "due")),
          annexure: get(r, "annexure") || undefined,
          remarks: get(r, "remarks") || undefined,
          responsible: get(r, "responsible") || undefined,
          clientComment: [get(r, "clientComment"), get(r, "clientRemarks")].filter(Boolean).join(" · ") || undefined,
        };
        items.push(cur);
        continue;
      }
      // Sub-points ("- Sanction letter") under the current request.
      if (cur && desc) {
        cur.description += `\n${desc}`;
        const extra = get(r, "remarks");
        if (extra) cur.remarks = cur.remarks ? `${cur.remarks} · ${extra}` : extra;
      }
    }
    if (!items.length) continue;
    if (!sections.length) warnings.push("No sections found; requests are numbered 1, 2, 3…");
    return { sheet: sheet.name, items, sections, warnings };
  }
  return null;
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
    if (changes.length) plan.update.push({ id: old.id, item: it, changes });
    else plan.unchanged++;
  }
  return plan;
}

/**
 * Creates and updates the engagement's IRL items from an RFI in one undoable
 * batch. Chase history and the app's own notes are kept on updates.
 */
export async function applyRfi(
  ctx: Ctx,
  plan: RfiPlan,
  opts: { engagementId: string; today: string; requestedFromId?: string; resolvePerson?: (name: string) => string | undefined },
) {
  const batch: Ctx = { ...ctx, batchId: ctx.batchId ?? newId() };
  const out = [];
  const notesFor = (it: RfiItem) => [it.remarks, it.notAvailable ? "Client: not available" : ""].filter(Boolean).join("\n") || undefined;
  const fromFor = (it: RfiItem) => (it.responsible && opts.resolvePerson?.(it.responsible)) || opts.requestedFromId;
  for (const it of plan.create) {
    out.push(
      await createInfoRequest(batch, {
        engagementId: opts.engagementId,
        number: it.number,
        description: it.description,
        section: it.section,
        status: it.status ?? "pending",
        requestedOn: it.requestedOn ?? opts.today,
        due: it.due,
        annexure: it.annexure,
        responsible: it.responsible,
        clientComment: it.clientComment,
        notes: notesFor(it),
        requestedFromId: fromFor(it),
        ...(it.receivedOn && (it.status === "received" || it.status === "na") ? { receivedAt: `${it.receivedOn}T12:00:00.000Z` } : {}),
      }),
    );
  }
  for (const u of plan.update) {
    const it = u.item;
    out.push(
      await update(batch, "infoRequests", u.id, {
        description: it.description,
        number: it.number,
        ...(it.status ? { status: it.status } : {}),
        ...(it.due ? { due: it.due } : {}),
        ...(it.annexure ? { annexure: it.annexure } : {}),
        ...(it.responsible ? { responsible: it.responsible } : {}),
        ...(it.clientComment ? { clientComment: it.clientComment } : {}),
        ...(it.receivedOn && (it.status === "received" || it.status === "na") ? { receivedAt: `${it.receivedOn}T12:00:00.000Z` } : {}),
      }),
    );
  }
  return out;
}
