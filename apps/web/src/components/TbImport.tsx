import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import {
  AREAS,
  AREA_IDS,
  ENGAGEMENT_KINDS,
  INDUSTRIES,
  create,
  defaultPeriods,
  engagementKindFor,
  generateProgramme,
  mapLines,

  parseTrialBalance,
  procedureLibrary,
  update,
  type AreaId,
  type EngagementKind,
  type Industry,
  type ParsedTb,
  type SheetData,
  type TrialBalance,
} from "@falcon/core";
import { store } from "../db";
import { act } from "../lib/act";
import { useTable } from "../lib/hooks";
import { readSpreadsheet } from "../lib/spreadsheet";
import { Icon } from "./Icon";
import { Segmented, Sheet } from "./ui";

const inr = (x: number) => `${Math.abs(Math.round(x)).toLocaleString("en-IN")} ${x < 0 ? "Cr" : x > 0 ? "Dr" : ""}`;

type Lines = TrialBalance["lines"];

/**
 * Upload a TB (or re-open the current one to fix mapping): detect layout,
 * pick periods, review the area for each ledger, then save and generate the
 * work programme in one undoable step.
 */
export function TbImport({ open, onClose, engagementId, existing, startAt }: { open: boolean; onClose: () => void; engagementId: string; existing?: TrialBalance; startAt?: "file" | "mapping" }) {
  const engagement = (useTable("engagements") ?? []).find((e) => e.id === engagementId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"file" | "periods" | "mapping">(startAt === "mapping" && existing ? "mapping" : "file");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState(existing?.fileName ?? "");
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [parsed, setParsed] = useState<ParsedTb | null>(null);
  const [periods, setPeriods] = useState<TrialBalance["periods"]>(existing?.periods ?? []);
  const [currentIdx, setCurrentIdx] = useState(existing?.currentIdx ?? 0);
  const [priorIdx, setPriorIdx] = useState<number | undefined>(existing?.priorIdx);
  const [lines, setLines] = useState<Lines>(existing?.lines ?? []);
  const [kind, setKind] = useState<EngagementKind>((existing?.kind as EngagementKind) ?? engagementKindFor(engagement?.type));
  const [industry, setIndustry] = useState<Industry>((existing?.industry as Industry) ?? "generic");
  const [filter, setFilter] = useState<"all" | "unmapped">("all");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setStep(startAt === "mapping" && existing ? "mapping" : "file");
    setError("");
    onClose();
  };

  const read = (s: SheetData) => {
    try {
      const p = parseTrialBalance(s.rows);
      const ps = p.layout.periods.map((x) => ({ label: x.label, isOpening: x.isOpening }));
      const d = defaultPeriods(ps);
      setParsed(p);
      setPeriods(ps);
      setCurrentIdx(d.currentIdx);
      setPriorIdx(d.priorIdx);
      // Keep mappings you corrected last time, matched by ledger name.
      const mine = new Map((existing?.lines ?? []).filter((l) => l.mappedBy === "user").map((l) => [l.ledger.toLowerCase(), l.area]));
      setLines(mapLines(p).map((l) => (mine.has(l.ledger.toLowerCase()) ? { ...l, area: mine.get(l.ledger.toLowerCase())!, mappedBy: "user" as const } : l)));
      setError("");
      setStep("periods");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pick = async (file: File) => {
    setFileName(file.name);
    setError("");
    try {
      const all = await readSpreadsheet(file);
      setSheets(all);
      // Prefer a sheet that looks like a TB.
      const idx = Math.max(0, all.findIndex((s) => /trial|tb/i.test(s.name)));
      setSheetIdx(idx);
      read(all[idx]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) if (!l.excluded) m.set(l.area, (m.get(l.area) ?? 0) + (l.balances[currentIdx] ?? 0));
    return m;
  }, [lines, currentIdx]);
  const diff = lines.filter((l) => !l.excluded).reduce((s, l) => s + (l.balances[currentIdx] ?? 0), 0);
  const unmappedCount = lines.filter((l) => l.area === "unmapped" && !l.excluded).length;

  const save = async () => {
    setBusy(true);
    const fields = { engagementId, fileName, importedAt: new Date().toISOString(), periods, currentIdx, priorIdx, lines, kind, industry };
    const res = await act(existing ? "Trial balance updated" : "Trial balance imported and programme created", async (ctx) => {
      const r = existing ? await update(ctx, "trialBalances", existing.id, fields) : await create(ctx, "trialBalances", fields);
      const items = (await store.list("programItems")).filter((i) => i.engagementId === engagementId);
      const gen = await generateProgramme(ctx, procedureLibrary, r.record, items);
      return [r, ...gen] as never;
    });
    setBusy(false);
    if (res) close();
  };

  const setArea = (id: string, area: string) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, area, mappedBy: "user" as const } : l)));

  const footer =
    step === "periods" ? (
      <>
        <button className="btn btn-ghost" onClick={() => setStep("file")}>
          Back
        </button>
        <div className="flex-1" />
        <button className="btn btn-primary" onClick={() => setStep("mapping")}>
          Review mapping
        </button>
      </>
    ) : step === "mapping" ? (
      <>
        {!existing && (
          <button className="btn btn-ghost" onClick={() => setStep("periods")}>
            Back
          </button>
        )}
        <div className="flex-1" />
        <button className="btn btn-primary" onClick={save} disabled={busy || !lines.length}>
          {busy ? "Saving…" : existing ? "Save & update programme" : "Save & build programme"}
        </button>
      </>
    ) : undefined;

  return (
    <Sheet open={open} onClose={close} title={step === "mapping" ? "Map ledgers to areas" : existing ? "Re-import trial balance" : "Import trial balance"} footer={footer}>
      {step === "file" && (
        <div className="space-y-4">
          <p className="text-sm muted">
            Export the <b>Trial Balance</b> from Tally to Excel (detailed, with ledgers; add the previous year as a comparative column if you can), or use any Excel/CSV TB with Debit/Credit or balance columns. It's read on this device only.
          </p>
          <button
            className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border)] px-4 py-10 hover:border-brand-400"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) void pick(f);
            }}
          >
            <Icon name="upload" size={28} className="text-brand-600" />
            <span className="font-semibold">Choose the trial balance</span>
            <span className="text-xs muted">.xlsx or .csv · or drop it here</span>
          </button>
          <input ref={fileInput} type="file" hidden accept=".xlsx,.csv" onChange={(e) => (e.target.files?.[0] && void pick(e.target.files[0]), (e.target.value = ""))} />
          {sheets.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="muted">Sheet</span>
              <select
                className="input w-auto"
                value={sheetIdx}
                onChange={(e) => {
                  setSheetIdx(Number(e.target.value));
                  read(sheets[Number(e.target.value)]);
                }}
              >
                {sheets.map((s, i) => (
                  <option key={s.name} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {fileName && <b>{fileName}: </b>}
              {error}
            </p>
          )}
        </div>
      )}

      {step === "periods" && parsed && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <p className="text-sm muted">
            {fileName} · {parsed.lines.length} ledgers
          </p>
          <div className="space-y-2 rounded-2xl bg-[var(--surface-2)] p-3 text-sm">
            <label className="flex items-center justify-between gap-3">
              <span className="font-medium">Year under audit / review</span>
              <select className="input w-auto" value={currentIdx} onChange={(e) => setCurrentIdx(Number(e.target.value))}>
                {periods.map((p, i) => (
                  <option key={i} value={i}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="font-medium">Compare with</span>
              <select className="input w-auto" value={priorIdx ?? ""} onChange={(e) => setPriorIdx(e.target.value === "" ? undefined : Number(e.target.value))}>
                <option value="">No comparative</option>
                {periods.map((p, i) =>
                  i === currentIdx ? null : (
                    <option key={i} value={i}>
                      {p.label}
                      {p.isOpening ? " (balance sheet only)" : ""}
                    </option>
                  ),
                )}
              </select>
            </label>
            <p className="text-xs muted">Trend checks (e.g. receivables vs revenue growth) need a comparative period. An opening-balance column only supports balance-sheet comparisons.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium muted">Engagement type</span>
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value as EngagementKind)}>
                {Object.entries(ENGAGEMENT_KINDS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium muted">Industry</span>
              <select className="input" value={industry} onChange={(e) => setIndustry(e.target.value as Industry)}>
                {Object.entries(INDUSTRIES).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {parsed.warnings.map((w) => (
            <p key={w} className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              ⚠ {w}
            </p>
          ))}
        </motion.div>
      )}

      {step === "mapping" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className={Math.abs(diff) < 1 ? "text-emerald-600" : "text-amber-600"}>
              {Math.abs(diff) < 1 ? "✓ Debits equal credits" : `⚠ Out of balance by ${inr(diff)}`} · {lines.length} ledgers
            </span>
            <Segmented
              id="map-filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "unmapped", label: `Unmapped (${unmappedCount})` },
              ]}
            />
          </div>
          <p className="text-xs muted">Each ledger was placed by its Tally group and name. Fix any that look wrong; your corrections are remembered next time you import.</p>
          {AREA_IDS.filter((a) => lines.some((l) => l.area === a && (filter === "all" || a === "unmapped"))).map((area) => (
            <div key={area} className="overflow-hidden rounded-xl border border-[var(--border)]">
              <div className="flex items-center justify-between bg-[var(--surface-2)] px-3 py-2 text-sm">
                <span className="font-semibold">{AREAS[area].label}</span>
                <span className="tabular-nums muted">{inr(totals.get(area) ?? 0)}</span>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {lines
                  .filter((l) => l.area === area)
                  .map((l) => (
                    <div key={l.id} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${l.excluded ? "opacity-40" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{l.ledger}</p>
                        {l.groups.length > 0 && <p className="truncate text-[11px] muted">{l.groups.join(" › ")}</p>}
                      </div>
                      <span className="w-28 shrink-0 text-right text-xs tabular-nums">{inr(l.balances[currentIdx] ?? 0)}</span>
                      <select className="input w-36 shrink-0 py-1 text-xs" value={l.area} onChange={(e) => setArea(l.id, e.target.value)} aria-label={`Area for ${l.ledger}`}>
                        {AREA_IDS.filter((a) => a !== "general").map((a) => (
                          <option key={a} value={a}>
                            {AREAS[a as AreaId].label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </motion.div>
      )}
    </Sheet>
  );
}

