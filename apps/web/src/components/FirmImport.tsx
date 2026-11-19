import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { FIRM_SHEETS, parseFirmWorkbook, type ParsedFirmTemplate } from "@falcon/core";
import { saveTemplates } from "../lib/firm";
import { readSpreadsheet } from "../lib/spreadsheet";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";
import { Sheet } from "./ui";

interface Row {
  path: string;
  parsed: ParsedFirmTemplate | null;
  error?: string;
  include: boolean;
  name: string;
  why?: string;
}

const isOld = (path: string) => /(^|[\\/])0?\.?\s*dump([\\/]|$)/i.test(path) || /(^|[\\/])copy of /i.test(path) || /- copy\.xlsx$/i.test(path);

/**
 * Imports the firm's work-paper templates from its Excel workbooks (a whole
 * folder at once, or single files). Everything is read in the browser and
 * stored on this device only.
 */
export function FirmImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const read = async (list: FileList | null) => {
    if (!list?.length) return;
    const files = [...list].filter((f) => /\.xlsx$/i.test(f.name) && !f.name.startsWith("~$"));
    const out: Row[] = [];
    for (const [i, f] of files.entries()) {
      setBusy(`Reading ${i + 1} of ${files.length}: ${f.name}`);
      const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      try {
        const parsed = parseFirmWorkbook(f.name, await readSpreadsheet(f, { maxBytes: 60 * 1024 * 1024, sheets: FIRM_SHEETS }));
        out.push({ path, parsed, include: !!parsed, name: parsed?.name ?? f.name, why: parsed ? undefined : "No checklist, procedures or index found" });
      } catch (e) {
        out.push({ path, parsed: null, include: false, name: f.name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    // Old copies (Dump folders, "Copy of…") and duplicate names start unticked.
    for (const r of out) if (r.parsed && isOld(r.path)) Object.assign(r, { include: false, why: "Looks like an old copy" });
    const seen = new Set<string>();
    for (const r of [...out].sort((a, b) => Number(isOld(a.path)) - Number(isOld(b.path)))) {
      if (!r.parsed || !r.include) continue;
      const k = r.name.toLowerCase();
      if (seen.has(k)) Object.assign(r, { include: false, why: "Same name as another file" });
      seen.add(k);
    }
    setBusy(null);
    setRows(out.sort((a, b) => Number(!a.parsed) - Number(!b.parsed) || a.path.localeCompare(b.path)));
  };

  const chosen = (rows ?? []).filter((r) => r.include && r.parsed);
  const save = async () => {
    const res = await saveTemplates(chosen.map((r) => ({ ...r.parsed!, name: r.name.trim() || r.parsed!.name, sourceFile: r.path })));
    toast({ message: `${res.added} templates added${res.updated ? `, ${res.updated} updated` : ""}. They stay on this device.`, tone: "success" });
    setRows(null);
    onClose();
  };
  const patch = (path: string, p: Partial<Row>) => setRows((rs) => rs!.map((r) => (r.path === path ? { ...r, ...p } : r)));

  return (
    <Sheet
      open={open}
      onClose={() => {
        setRows(null);
        onClose();
      }}
      title="Import firm templates"
      footer={
        rows && (
          <div className="flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => setRows(null)}>
              Back
            </button>
            <button className="btn btn-primary flex-1" disabled={!chosen.length} onClick={() => void save()}>
              Save {chosen.length} template{chosen.length === 1 ? "" : "s"}
            </button>
          </div>
        )
      }
    >
      {!rows ? (
        <div className="space-y-3">
          <p className="text-sm">
            Pick the folder with the firm's work-paper templates (or individual workbooks). Falcon reads each one's <b>Checklist</b>, <b>Procedures</b> and <b>Index</b> sheets
            and turns them into review questions with their tests.
          </p>
          <p className="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-xs">
            🔒 Read in this browser and stored <b>on this device only</b>: not synced to Google Drive, not in backups, never sent to the AI. To use them on another device,
            export the library from Settings and import it there.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="btn btn-primary" disabled={!!busy} onClick={() => folderRef.current?.click()}>
              <Icon name="upload" size={16} /> Choose folder
            </button>
            <button className="btn btn-soft" disabled={!!busy} onClick={() => filesRef.current?.click()}>
              <Icon name="upload" size={16} /> Choose files
            </button>
          </div>
          {busy && (
            <motion.p className="text-xs muted" animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.2 }}>
              {busy}
            </motion.p>
          )}
          <input
            ref={folderRef}
            type="file"
            hidden
            multiple
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => {
              void read(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={filesRef}
            type="file"
            hidden
            multiple
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              void read(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs muted">
            {rows.filter((r) => r.parsed).length} of {rows.length} workbooks have questions. Untick any you don't want, and rename if needed. Re-importing a template with the
            same name updates it and keeps the checks you've added.
          </p>
          {rows.map((r) => (
            <div key={r.path} className={`rounded-xl border px-3 py-2 ${r.include ? "border-[var(--accent)]" : "border-[var(--border)]"} ${r.parsed ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-2">
                <input type="checkbox" className="mt-1.5" checked={r.include} disabled={!r.parsed} onChange={(e) => patch(r.path, { include: e.target.checked })} aria-label={`Include ${r.name}`} />
                <div className="min-w-0 flex-1">
                  {r.parsed ? (
                    <input className="input py-1 text-sm font-medium" value={r.name} onChange={(e) => patch(r.path, { name: e.target.value })} aria-label="Template name" />
                  ) : (
                    <p className="text-sm font-medium">{r.name}</p>
                  )}
                  <p className="mt-0.5 truncate text-[11px] muted" title={r.path}>
                    {r.path}
                  </p>
                  {r.parsed && (
                    <button className="mt-0.5 text-xs text-[var(--accent)]" onClick={() => setExpanded(expanded === r.path ? null : r.path)}>
                      {r.parsed.items.length} questions · {r.parsed.items.reduce((n, i) => n + i.tests.length, 0)} tests {expanded === r.path ? "▾" : "▸"}
                    </button>
                  )}
                  {(r.why || r.error) && <p className="text-xs text-amber-600 dark:text-amber-400">{r.error ?? r.why}</p>}
                </div>
              </div>
              <AnimatePresence initial={false}>
                {expanded === r.path && r.parsed && (
                  <motion.ol
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="ml-6 mt-1 list-decimal space-y-1 overflow-hidden pl-4 text-xs"
                  >
                    {r.parsed.items.map((it) => (
                      <li key={it.key}>
                        <span className="font-medium">{it.title}</span>
                        {it.tests.length > 0 && <span className="muted"> · {it.tests.length} tests</span>}
                      </li>
                    ))}
                  </motion.ol>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
