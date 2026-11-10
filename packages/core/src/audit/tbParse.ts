/**
 * Reads a trial balance from spreadsheet rows (Tally export or any Excel/CSV).
 *
 * Handles: title rows above the header; a two-row header ("Closing Balance"
 * over "Debit | Credit"); one or more periods; Dr/Cr in separate columns or as
 * a suffix ("1,23,456.00 Dr"); brackets for negatives; group headers and
 * sub-group subtotal rows (Tally's detailed TB), which are skipped so nothing
 * is counted twice; an optional explicit group column.
 */
import { isKnownGroup } from "./mapping";

export interface TbPeriodColumns {
  label: string;
  /** "Opening" columns: balance-sheet comparatives only (P&L opens at zero). */
  isOpening: boolean;
  net?: number;
  debit?: number;
  credit?: number;
}

export interface TbLayout {
  headerRow: number;
  nameCol: number;
  groupCol?: number;
  periods: TbPeriodColumns[];
}

export interface ParsedTbLine {
  ledger: string;
  /** Group path, outermost first. */
  groups: string[];
  /** Net balance per period: debit positive, credit negative. */
  balances: number[];
}

export interface ParsedTb {
  layout: TbLayout;
  lines: ParsedTbLine[];
  /** Sum of all lines per period; ~0 when the TB balances. */
  difference: number[];
  warnings: string[];
}

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const low = (s: string | undefined) => clean(s).toLowerCase();

/** "1,23,456.00 Dr" → 123456; "(500)" → -500; "500 Cr" → -500; "" → undefined. */
export function parseAmount(raw: string | undefined): number | undefined {
  let s = clean(raw);
  if (!s || s === "-" || s === "–") return undefined;
  let sign = 1;
  if (/\bcr\.?$/i.test(s)) {
    sign = -1;
    s = s.replace(/\bcr\.?$/i, "");
  } else s = s.replace(/\bdr\.?$/i, "");
  if (/^\(.*\)$/.test(s.trim())) {
    sign *= -1;
    s = s.trim().slice(1, -1);
  }
  s = s.replace(/[₹,\s]|rs\.?|inr/gi, "");
  if (s.startsWith("-")) {
    sign *= -1;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(s)) return undefined;
  return sign * Number(s);
}

const isAmountHeader = (h: string) => /debit|credit|^dr\.?$|^cr\.?$|balance|amount|closing|opening|^fy|20\d\d|19\d\d|\bmar|\bdec|\bsep|\bjun|ytd|current|previous|prior/.test(h);
const isNameHeader = (h: string) => /^(particulars|ledger( name)?|account( name| head)?|name|description|gl name|ledger account)$/.test(h);
const isGroupHeader = (h: string) => /^(group|under|parent|primary group|account group|group name|head|schedule)$/.test(h);

/** Finds the header row and which columns hold names, groups and amounts. */
export function detectLayout(rows: string[][]): TbLayout {
  let headerRow = -1;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cells = rows[r].map(low);
    if (cells.some(isNameHeader) && cells.some(isAmountHeader)) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0)
    for (let r = 0; r < Math.min(rows.length, 40); r++) {
      const cells = rows[r].map(low);
      if (cells.filter((c) => /debit|credit/.test(c)).length >= 2) {
        headerRow = r;
        break;
      }
    }
  if (headerRow < 0) throw new Error("Couldn't find the TB header. Expected a row with 'Particulars' (or Ledger / Account) and Debit/Credit or balance columns.");

  const header = rows[headerRow].map(low);
  // Labels from the row above (e.g. "Closing Balance" merged over Debit | Credit), carried right across merged cells.
  const above = headerRow > 0 ? rows[headerRow - 1].map(clean) : [];
  const carried: string[] = [];
  let last = "";
  for (let c = 0; c < header.length; c++) {
    if (above[c]) last = above[c];
    carried[c] = last;
  }

  let nameCol = header.findIndex(isNameHeader);
  if (nameCol < 0) nameCol = 0;
  const groupCol = header.findIndex(isGroupHeader);

  const periods: TbPeriodColumns[] = [];
  const byLabel = new Map<string, TbPeriodColumns>();
  for (let c = 0; c < header.length; c++) {
    if (c === nameCol || c === groupCol) continue;
    const h = header[c];
    if (!h && !carried[c]) continue;
    if (!isAmountHeader(h) && !(h === "" && carried[c])) continue;
    const isDr = /debit|^dr\.?$/.test(h);
    const isCr = /credit|^cr\.?$/.test(h);
    // Period label: the text above for Debit/Credit pairs, else the header itself.
    const raw = isDr || isCr ? carried[c] || h.replace(/\b(debit|credit|dr|cr)\b\.?/g, "").trim() || "Closing balance" : rows[headerRow][c];
    const label = clean(raw) || "Closing balance";
    const key = label.toLowerCase();
    let p = byLabel.get(key);
    if (!p) {
      p = { label, isOpening: /opening/i.test(label) };
      byLabel.set(key, p);
      periods.push(p);
    }
    if (isDr) p.debit = c;
    else if (isCr) p.credit = c;
    else p.net = c;
  }
  if (!periods.length) throw new Error("Couldn't find any amount columns in the TB.");
  return { headerRow, nameCol, groupCol: groupCol >= 0 ? groupCol : undefined, periods };
}

function amountsOf(row: string[], layout: TbLayout): (number | undefined)[] {
  return layout.periods.map((p) => {
    if (p.net !== undefined) return parseAmount(row[p.net]);
    const d = p.debit !== undefined ? parseAmount(row[p.debit]) : undefined;
    const c = p.credit !== undefined ? parseAmount(row[p.credit]) : undefined;
    if (d === undefined && c === undefined) return undefined;
    // Amounts in a Credit column are credits whatever their printed sign.
    return (d ?? 0) - Math.abs(c ?? 0);
  });
}

const SKIP = /^(grand total|total|difference in (opening|closing) balances?|net (profit|loss)|opening balance difference)$/i;

/** Parses the TB rows into ledger lines with group paths. */
export function parseTrialBalance(rows: string[][], layout: TbLayout = detectLayout(rows)): ParsedTb {
  const warnings: string[] = [];
  type Row = { name: string; group?: string; amounts: (number | undefined)[]; indent: number };
  const body: Row[] = [];
  for (const row of rows.slice(layout.headerRow + 1)) {
    const rawName = row[layout.nameCol] ?? "";
    const name = clean(rawName);
    if (!name || SKIP.test(name)) continue;
    const amounts = amountsOf(row, layout);
    body.push({ name, group: layout.groupCol !== undefined ? clean(row[layout.groupCol]) || undefined : undefined, amounts, indent: rawName.length - rawName.trimStart().length });
  }

  const lines: ParsedTbLine[] = [];
  const total = (a: (number | undefined)[]) => a.reduce<number>((s, x) => s + Math.abs(x ?? 0), 0);

  if (layout.groupCol !== undefined) {
    for (const r of body) if (r.amounts.some((a) => a !== undefined && a !== 0)) lines.push({ ledger: r.name, groups: r.group ? [r.group] : [], balances: r.amounts.map((a) => a ?? 0) });
  } else {
    // Infer the hierarchy. A row is a (sub-)group header when the blocks right
    // below it add up to its amounts in every period; nested sub-groups count
    // once, as their own subtotal. Known Tally groups need one child, other
    // names two (so two equal ledgers in a row aren't mistaken for a group).
    // Ledgers named like groups ("Purchases") stay ledgers unless rows below
    // actually sum to them. Computed bottom-up, so it's linear and stack-safe.
    const nRows = body.length;
    const same = (a: (number | undefined)[], b: number[]) => a.every((x, k) => Math.abs((x ?? 0) - b[k]) < 1);
    const end = new Array<number>(nRows);
    for (let i = nRows - 1; i >= 0; i--) {
      end[i] = i;
      const r = body[i];
      if (total(r.amounts) === 0) continue;
      const need = isKnownGroup(r.name) ? 1 : 2;
      const acc = r.amounts.map(() => 0);
      let children = 0;
      for (let j = i + 1; j < nRows && children < 400; j = end[j] + 1) {
        body[j].amounts.forEach((a, k) => (acc[k] += a ?? 0));
        children++;
        if (children >= need && same(r.amounts, acc)) {
          end[i] = end[j];
          break;
        }
      }
    }
    // Walk the tree; group headers without amounts (some exports) label the rows after them.
    let label: string | undefined;
    const walk = (from: number, to: number, path: string[]) => {
      for (let i = from; i <= to; i = end[i] + 1) {
        const r = body[i];
        if (end[i] > i) {
          walk(i + 1, end[i], [...path, r.name]);
          continue;
        }
        if (total(r.amounts) === 0) {
          if (path.length === 0 && isKnownGroup(r.name)) label = r.name;
          continue;
        }
        const groups = path.length ? path : label ? [label] : [];
        lines.push({ ledger: r.name, groups, balances: r.amounts.map((a) => a ?? 0) });
      }
    };
    walk(0, nRows - 1, []);
  }

  const difference = layout.periods.map((_, k) => Math.round(lines.reduce((s, l) => s + l.balances[k], 0) * 100) / 100);
  difference.forEach((d, k) => {
    if (Math.abs(d) >= 1 && !layout.periods[k].isOpening)
      warnings.push(`${layout.periods[k].label}: debits and credits differ by ${Math.abs(d).toLocaleString("en-IN")}. Check for missing ledgers, a subtotal row counted as a ledger, or the stock/P&L line.`);
  });
  if (!lines.length) warnings.push("No ledger lines with balances were found.");
  return { layout, lines, difference, warnings };
}
