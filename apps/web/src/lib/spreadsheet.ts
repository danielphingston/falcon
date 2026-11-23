/**
 * Minimal, dependency-free spreadsheet reader for .xlsx and .csv. Reads cell
 * values (formulas give their cached result); ignores styles, charts and
 * macros. Uses the browser's DecompressionStream (Chrome 103+, Safari 16.4+).
 */
import type { SheetData } from "@falcon/core";

export interface ReadOptions {
  /** Default 20 MB. */
  maxBytes?: number;
  /** Read only the sheets whose names pass (others are skipped without being decompressed). */
  sheets?: (name: string) => boolean;
}

export async function readSpreadsheet(file: File, opts: ReadOptions = {}): Promise<SheetData[]> {
  const max = opts.maxBytes ?? 20 * 1024 * 1024;
  if (file.size > max) throw new Error(`That file is over ${Math.round(max / 1024 / 1024)} MB`);
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv") || file.type === "text/csv") return [{ name: file.name.replace(/\.csv$/i, ""), rows: parseCsv(await file.text()) }];
  if (lower.endsWith(".xls")) throw new Error("Old .xls files aren't supported. In Excel, use File → Save As → Excel Workbook (.xlsx).");
  return readXlsx(new Uint8Array(await file.arrayBuffer()), opts.sheets);
}

// ---------- CSV ----------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const delim = (text.split("\n", 1)[0].match(/;/g)?.length ?? 0) > (text.split("\n", 1)[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

// ---------- ZIP ----------

/** Zip entries we read, decompressed only when asked for. */
async function unzip(bytes: Uint8Array): Promise<Map<string, () => Promise<Uint8Array>>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory record: scan back from the end (comment can be up to 64 KB).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("This doesn't look like an Excel (.xlsx) file");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map<string, () => Promise<Uint8Array>>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("The .xlsx file is damaged");
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    // Only the parts we read: workbook, relationships, shared strings, worksheets (and their links).
    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml|worksheets\/_rels\/[^/]+\.xml\.rels)$/.test(name)) continue;
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(dataStart, dataStart + size);
    if (method !== 0 && method !== 8) throw new Error("This .xlsx uses an unsupported compression method");
    files.set(name, () => (method === 0 ? Promise.resolve(raw) : inflate(raw)));
  }
  return files;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser can't read .xlsx files. Update it, or save the sheet as CSV.");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- XLSX ----------

const xml = (bytes: Uint8Array | undefined) => (bytes ? new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml") : null);
const els = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagName(tag));
const text = (node: Element) => els(node, "t").map((t) => t.textContent ?? "").join("");

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

async function readXlsx(bytes: Uint8Array, only?: (name: string) => boolean): Promise<SheetData[]> {
  const zip = await unzip(bytes);
  const get = async (name: string) => zip.get(name)?.();
  const workbook = xml(await get("xl/workbook.xml"));
  if (!workbook) throw new Error("This doesn't look like an Excel workbook");
  const rels = new Map(
    els(xml(await get("xl/_rels/workbook.xml.rels")) ?? workbook, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target") ?? ""]),
  );
  const strings = els(xml(await get("xl/sharedStrings.xml")) ?? workbook, "si").map(text);

  const sheets: SheetData[] = [];
  for (const s of els(workbook, "sheet")) {
    if (only && !only(s.getAttribute("name") ?? "")) continue;
    const rid = s.getAttribute("r:id") ?? s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = (rels.get(rid) ?? "").replace(/^\/?(xl\/)?/, "");
    const bytesOfSheet = await get(`xl/${target}`);
    if (!bytesOfSheet) continue;
    const sheetXml = new TextDecoder().decode(bytesOfSheet);
    const rows = scanSheet(sheetXml, strings);
    const links = await sheetLinks(sheetXml, get, `xl/${target}`);
    // Dense rows, but only as wide as the table: a stray value thousands of
    // columns out (seen in real RFIs) is cut at the first gap of 64+ empty columns.
    const used = new Set<number>();
    for (const r of rows) if (r) r.forEach((_, i) => used.add(i));
    const cols = [...used].sort((a, b) => a - b);
    let width = 0;
    for (const c of cols) {
      if (c - width > 64) break;
      width = c + 1;
    }
    sheets.push({
      name: s.getAttribute("name") ?? `Sheet ${sheets.length + 1}`,
      rows: Array.from(rows, (r) => Array.from({ length: width }, (_, i) => r?.[i] ?? "")),
      ...(links ? { links } : {}),
    });
  }
  return sheets;
}

/** Web links on cells (<hyperlinks> + the sheet's relationships), keyed "row,col". */
async function sheetLinks(sheetXml: string, get: (name: string) => Promise<Uint8Array | undefined>, sheetPath: string) {
  const tags = sheetXml.match(/<hyperlink\b[^>]*>/g);
  if (!tags) return undefined;
  const relPath = sheetPath.replace(/worksheets\/([^/]+)$/, "worksheets/_rels/$1.rels");
  const relBytes = await get(relPath);
  const relText = relBytes ? new TextDecoder().decode(relBytes) : "";
  const targets = new Map<string, string>();
  for (const m of relText.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\sId="([^"]+)"/.exec(m[0])?.[1];
    const t = /\sTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) targets.set(id, unescapeXml(t));
  }
  const out: Record<string, string> = {};
  for (const tag of tags) {
    const ref = /\sref="([A-Z]+)(\d+)(?::[A-Z]+\d+)?"/.exec(tag);
    const id = /\sr:id="([^"]+)"/.exec(tag)?.[1];
    const url = id ? targets.get(id) : undefined;
    if (ref && url && /^(https?:|mailto:)/i.test(url)) out[`${Number(ref[2]) - 1},${colIndex(ref[1])}`] = url;
  }
  return Object.keys(out).length ? out : undefined;
}

const unescapeXml = (s: string) =>
  s.indexOf("&") < 0
    ? s
    : s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
        e === "lt" ? "<" : e === "gt" ? ">" : e === "quot" ? '"' : e === "apos" ? "'" : e === "amp" ? "&" : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))),
      );

/**
 * Reads cell values from worksheet XML with a plain scan instead of a DOM.
 * Real workbooks often carry formatting across thousands of empty cells (a
 * 300-row RFI can be ~100 MB of XML); those are skipped, so only cells with
 * values cost anything.
 */
function scanSheet(xmlText: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  let row = -1;
  let col = -1;
  let pos = 0;
  for (;;) {
    const lt = xmlText.indexOf("<", pos);
    if (lt < 0) break;
    const tagEnd = xmlText.indexOf(">", lt);
    if (tagEnd < 0) break;
    const c1 = xmlText.charCodeAt(lt + 1);
    const c2 = xmlText.charCodeAt(lt + 2);
    // <row …>
    if (c1 === 114 /* r */ && xmlText.startsWith("ow", lt + 2) && (xmlText[lt + 4] === " " || xmlText[lt + 4] === ">")) {
      const r = /\sr="(\d+)"/.exec(xmlText.slice(lt, tagEnd));
      row = r ? Number(r[1]) - 1 : row + 1;
      col = -1;
      pos = tagEnd + 1;
      continue;
    }
    // <c …/> or <c …>…</c>
    if (c1 === 99 /* c */ && (c2 === 32 || c2 === 62)) {
      if (xmlText.charCodeAt(tagEnd - 1) === 47 /* / */) {
        // Empty cell, formatting only (Excel always writes r="…", so no need to track it).
        col++;
        pos = tagEnd + 1;
        continue;
      }
      const attrs = xmlText.slice(lt + 2, tagEnd);
      const ref = /\sr="([A-Z]+)(\d*)"/.exec(" " + attrs);
      col = ref ? colIndex(ref[1]) : col + 1;
      const end = xmlText.indexOf("</c>", tagEnd);
      if (end < 0) break;
      const inner = xmlText.slice(tagEnd + 1, end);
      pos = end + 4;
      const t = /\st="(\w+)"/.exec(" " + attrs)?.[1];
      let value: string;
      if (t === "inlineStr") value = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("");
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v === undefined) continue;
        value = t === "s" ? (strings[Number(v)] ?? "") : t === "b" ? (v === "1" ? "TRUE" : "FALSE") : v;
      }
      value = t === "s" ? value : unescapeXml(value);
      if (value === "") continue;
      const r = ref?.[2] ? Number(ref[2]) - 1 : row;
      (rows[r] = rows[r] ?? [])[col] = value;
      continue;
    }
    pos = tagEnd + 1;
  }
  return rows;
}

/** Plain-text rendering of sheets, for sending a spreadsheet to the AI assistant. */
export function sheetsToText(fileName: string, sheets: SheetData[], maxChars = 60_000): string {
  const parts = sheets.map((s) => {
    const rows = s.rows.filter((r) => r.some((c) => c.trim()));
    return `Sheet "${s.name}":\n${rows.map((r) => r.map((c) => c.trim()).join(" | ").replace(/( \| )+$/, "")).join("\n")}`;
  });
  const out = `[Spreadsheet: ${fileName}]\n${parts.join("\n\n")}`;
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n…(truncated)` : out;
}
