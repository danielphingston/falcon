import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { applyTeamImport, labels, parseTeamAllocation, planTeamImport, type Allocation } from "@falcon/core";
import { saveSettings } from "../db";
import { act } from "../lib/act";
import { useSettings, useSnapshot } from "../lib/hooks";
import { readSpreadsheet } from "../lib/spreadsheet";
import { Icon } from "./Icon";
import { useTNavigate } from "./TLink";
import { Pill, Sheet, statusTone } from "./ui";

const badge = { create: ["New", "green"], update: ["Update", "blue"], unchanged: ["No change", "slate"] } as const;

/** Import a team allocation spreadsheet: preview first, then one undoable batch. */
export function ImportAllocation({ open, onClose }: { open: boolean; onClose: () => void }) {
  const snap = useSnapshot();
  const settings = useSettings();
  const navigate = useTNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [alloc, setAlloc] = useState<Allocation | null>(null);
  const [error, setError] = useState("");
  const [me, setMe] = useState<string>("");
  const [setName, setSetName] = useState(true);
  const [busy, setBusy] = useState(false);

  const plan = useMemo(() => (alloc && snap ? planTeamImport(alloc, snap, me || undefined) : null), [alloc, snap, me]);
  const nameOf = (key?: string) => (key ? (plan?.people.find((p) => p.key === key)?.name ?? "?") : "You");

  const reset = () => {
    setAlloc(null);
    setError("");
    setFileName("");
  };
  const close = () => {
    reset();
    onClose();
  };

  const pick = async (file: File) => {
    setError("");
    setFileName(file.name);
    try {
      const a = parseTeamAllocation(await readSpreadsheet(file));
      setAlloc(a);
      setMe(a.suggestedMe ?? "");
    } catch (e) {
      setAlloc(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    const nNew = plan.engagements.filter((e) => e.action === "create").length;
    const nUpd = plan.engagements.filter((e) => e.action === "update").length;
    const res = await act(`Imported: ${nNew} new, ${nUpd} updated`, (ctx) => applyTeamImport(ctx, plan));
    if (res && me && setName && settings.myName === "Me") await saveSettings({ myName: me });
    setBusy(false);
    if (res) {
      close();
      navigate("/engagements");
    }
  };

  const counts = plan && {
    create: plan.engagements.filter((e) => e.action === "create").length,
    update: plan.engagements.filter((e) => e.action === "update").length,
    unchanged: plan.engagements.filter((e) => e.action === "unchanged").length,
    newPeople: plan.people.filter((p) => !p.existingId && isUsed(p.key)).length,
  };
  function isUsed(key: string) {
    return !!plan?.engagements.some((e) => e.leadKey === key || e.teamKeys.includes(key));
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Import team allocation"
      footer={
        plan ? (
          <>
            <button className="btn btn-ghost" onClick={reset}>
              Choose another file
            </button>
            <div className="flex-1" />
            <button className="btn btn-primary" onClick={run} disabled={busy || !(counts!.create + counts!.update)}>
              {busy ? "Importing…" : counts!.create + counts!.update ? `Import ${counts!.create + counts!.update}` : "Nothing to import"}
            </button>
          </>
        ) : undefined
      }
    >
      {!plan ? (
        <div className="space-y-4">
          <p className="text-sm muted">
            Pick the Excel (.xlsx) or CSV file with your <b>Assignments</b> sheet (assignment, type, status, team columns) and optionally a <b>Members</b> sheet. The first Team column is taken as the person leading it. Nothing is sent anywhere; the file is read on this device.
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
            <span className="font-semibold">Choose a spreadsheet</span>
            <span className="text-xs muted">.xlsx or .csv · or drop it here</span>
          </button>
          <input ref={fileInput} type="file" hidden accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => (e.target.files?.[0] && void pick(e.target.files[0]), (e.target.value = ""))} />
          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {fileName && <b>{fileName}: </b>}
              {error}
            </p>
          )}
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <p className="text-sm muted">{fileName}</p>

          <div className="space-y-2 rounded-2xl bg-[var(--surface-2)] p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">Which name in the sheet is you?</span>
              <select className="input w-auto" value={me} onChange={(e) => setMe(e.target.value)}>
                <option value="">None of these</option>
                {alloc!.members.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                    {m.designation ? ` (${m.designation})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs muted">You won't be added as a contact. Assignments you lead show you as the lead.</p>
            {me && settings.myName === "Me" && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={setName} onChange={(e) => setSetName(e.target.checked)} /> Also set my name in the app to “{me}”
              </label>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              [counts!.create, "New"],
              [counts!.update, "Updated"],
              [counts!.newPeople, "New people"],
            ].map(([n, l]) => (
              <div key={l} className="card py-2">
                <p className="text-xl font-bold">{n}</p>
                <p className="text-[11px] muted">{l}</p>
              </div>
            ))}
          </div>

          {plan.warnings.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {plan.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Assignments</h3>
            {plan.engagements.map((e, i) => (
              <div key={i} className={`rounded-xl border border-[var(--border)] p-3 ${e.action === "unchanged" ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{e.name}</p>
                    <p className="text-xs muted">
                      {e.type ?? "No type"} · Lead: <b>{nameOf(e.leadKey)}</b>
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Pill tone={statusTone[e.status]}>{labels.engagementStatus[e.status]}</Pill>
                    <Pill tone={badge[e.action][1]}>{badge[e.action][0]}</Pill>
                  </div>
                </div>
                {e.teamKeys.length > 0 && <p className="mt-1.5 text-xs">{e.teamKeys.map(nameOf).join(", ")}</p>}
                {e.action === "update" && <p className="mt-1 text-[11px] text-sky-700 dark:text-sky-300">Changes: {e.changes.join(", ")}</p>}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Team</h3>
            <div className="flex flex-wrap gap-1.5">
              {plan.people.filter((p) => isUsed(p.key)).map((p) => (
                <span key={p.key} className={`rounded-full px-2.5 py-1 text-xs ${p.existingId ? "bg-[var(--surface-2)]" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"}`}>
                  {p.name}
                  {p.designation ? ` · ${p.designation}` : ""}
                  {!p.existingId && " · new"}
                </span>
              ))}
            </div>
          </div>
          <p className="text-xs muted">Importing again later updates these engagements instead of duplicating them. Everything can be undone in one tap.</p>
        </motion.div>
      )}
    </Sheet>
  );
}
