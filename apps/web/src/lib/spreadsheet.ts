/**
 * Minimal, dependency-free spreadsheet reader for .xlsx and .csv. Reads cell
 * values (formulas give their cached result); ignores styles, charts and
 * macros. Uses the browser's DecompressionStream (Chrome 103+, Safari 16.4+).
 */
import type { SheetData } from "@falcon/core";

const MAX_BYTES = 20 * 1024 * 1024;

export async function readSpreadsheet(file: File): Promise<SheetData[]> {
  if (file.size > MAX_BYTES) throw new Error("That file is over 20 MB");
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv") || file.type === "text/csv") return [{ name: file.name.replace(/\.csv$/i, ""), rows: parseCsv(await file.text()) }];
  if (lower.endsWith(".xls")) throw new Error("Old .xls files aren't supported. In Excel, use File → Save As → Excel Workbook (.xlsx).");
  return readXlsx(new Uint8Array(await file.arrayBuffer()));
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

async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
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
  const files = new Map<string, Uint8Array>();
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
    // Only the parts we read: workbook, relationships, shared strings, worksheets.
    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) continue;
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(dataStart, dataStart + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflate(raw));
    else throw new Error("This .xlsx uses an unsupported compression method");
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

async function readXlsx(bytes: Uint8Array): Promise<SheetData[]> {
  const files = await unzip(bytes);
  const workbook = xml(files.get("xl/workbook.xml"));
  if (!workbook) throw new Error("This doesn't look like an Excel workbook");
  const rels = new Map(
    els(xml(files.get("xl/_rels/workbook.xml.rels")) ?? workbook, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target") ?? ""]),
  );
  const strings = els(xml(files.get("xl/sharedStrings.xml")) ?? workbook, "si").map(text);

  const sheets: SheetData[] = [];
  for (const s of els(workbook, "sheet")) {
    const rid = s.getAttribute("r:id") ?? s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = (rels.get(rid) ?? "").replace(/^\/?(xl\/)?/, "");
    const doc = xml(files.get(`xl/${target}`));
    if (!doc) continue;
    const rows: string[][] = [];
    for (const r of els(doc, "row")) {
      const ri = Number(r.getAttribute("r") ?? rows.length + 1) - 1;
      const row: string[] = (rows[ri] = rows[ri] ?? []);
      for (const c of els(r, "c")) {
        const t = c.getAttribute("t");
        const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
        const value = t === "s" ? (strings[Number(v)] ?? "") : t === "inlineStr" ? text(c) : t === "b" ? (v === "1" ? "TRUE" : "FALSE") : v;
        row[colIndex(c.getAttribute("r") ?? "A1")] = value;
      }
    }
    // Fill gaps so every row is a dense array.
    const width = Math.max(0, ...rows.map((r) => r?.length ?? 0));
    sheets.push({ name: s.getAttribute("name") ?? `Sheet ${sheets.length + 1}`, rows: Array.from(rows, (r) => Array.from({ length: width }, (_, i) => r?.[i] ?? "")) });
  }
  return sheets;
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
