import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { rfiTitle, applyRfi, matchName, parseRfi, planRfi, statusKey, type InfoRequest, type ParsedRfi, type Person, type RfiParseOptions, type SheetData } from "@falcon/core";
import { useSnapshot } from "../lib/hooks";
import { act } from "../lib/act";
import { readSpreadsheet } from "../lib/spreadsheet";
import { Icon } from "./Icon";
import { Pill, Sheet } from "./ui";

/**
 * Imports the RFI (request for information) sent to the client into this
 * engagement's request list. Re-importing a later version of the same RFI
 * updates statuses, dates and comments instead of adding duplicates.
 */
export function RfiImport({
  open,
  onClose,
  engagementId,
  existing,
  clients,
  today,
}: {
  open: boolean;
  onClose: () => void;
  engagementId: string;
  existing: InfoRequest[];
  clients: Person[];
  today: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedRfi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [showSections, setShowSections] = useState(false);
  // The file's sheets and the status choices; changing a choice re-reads the sheets at once.
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [opts, setOpts] = useState<RfiParseOptions>({});
  const saved = useSnapshot()?.engagements.find((e) => e.id === engagementId)?.rfiInfo;
  const reparse = (sh: SheetData[], o: RfiParseOptions) => {
    const p = parseRfi(sh, o);
    if (p) setParsed(p);
    setOpts(o);
  };
  const plan = useMemo(() => (parsed ? planRfi(parsed, existing) : null), [parsed, existing]);

  const read = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const sh = await readSpreadsheet(f, { maxBytes: 40 * 1024 * 1024 });
      // Start from what was chosen for this engagement's last IRL, if anything.
      const o: RfiParseOptions = { statusColumns: saved?.statusColumns, statusMap: saved?.statusMap };
      const p = parseRfi(sh, o);
      setSheets(sh);
      setOpts(o);
      if (!p) throw new Error("Couldn't find a request list in this file. It needs a header row with Particulars (and Sl No, Status or Date of request).");
      setParsed(p);
      setFile(f.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setParsed(null);
    setError(null);
    onClose();
  };

  const save = async () => {
    if (!plan) return;
    const n = plan.create.length + plan.update.length;
    const res = await act(
      `RFI imported: ${plan.create.length} new${plan.update.length ? `, ${plan.update.length} updated` : ""}`,
      (ctx) =>
        applyRfi(ctx, plan, {
          engagementId,
          today,
          requestedFromId: from || undefined,
          resolvePerson: (name) => matchName(name, clients)?.id,
          file,
          parsed: parsed ?? undefined,
          statusMap: opts.statusMap,
        }),
    );
    if (res || n === 0) close();
  };

  const statusCount = (s: InfoRequest["status"]) => parsed?.items.filter((i) => (i.status ?? "pending") === s).length ?? 0;

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Import RFI"
      footer={
        parsed &&
        plan && (
          <div className="flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => setParsed(null)}>
              Back
            </button>
            <button className="btn btn-primary flex-1" disabled={!plan.create.length && !plan.update.length} onClick={() => void save()}>
              {plan.create.length || plan.update.length
                ? `Import ${plan.create.length ? `${plan.create.length} new` : ""}${plan.create.length && plan.update.length ? " + " : ""}${plan.update.length ? `${plan.update.length} updates` : ""}`
                : "Nothing to change"}
            </button>
          </div>
        )
      }
    >
      {!parsed ? (
        <div className="space-y-3">
          <p className="text-sm">
            Upload the RFI you sent to the client (Excel). Each request becomes an item here, grouped by its section, with its status, request date, expected date, annexure,
            remarks and the client's comments, so you can track and chase it.
          </p>
          <p className="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-xs">
            Got an updated RFI back from the client? Import it again: existing requests are updated (status, dates, comments) and your chase history is kept. New requests are
            added.
          </p>
          <button className="btn btn-primary w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} /> {busy ? "Reading…" : "Choose RFI file"}
          </button>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => {
              void read(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      ) : (
        plan && (
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--border)] px-3 py-2">
              <p className="truncate text-sm font-semibold" title={file}>
                {file}
              </p>
              <p className="text-xs muted">
                Sheet “{parsed.sheet}” · {parsed.items.length} requests in {parsed.sections.length || "no"} sections
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Pill tone="amber">{statusCount("pending")} pending</Pill>
                {statusCount("partial") > 0 && <Pill tone="blue">{statusCount("partial")} partial</Pill>}
                <Pill tone="green">{statusCount("received")} received</Pill>
                {statusCount("na") > 0 && <Pill>{statusCount("na")} n.a.</Pill>}
              </div>
              {parsed.info.title.length > 0 && <p className="mt-2 text-xs">{parsed.info.title.join(" · ")}</p>}
              <p className="mt-1 text-xs muted">
                {parsed.info.columns.length} columns captured
                {parsed.info.notes.length ? ` · ${parsed.info.notes.length} notes to the client` : ""}
                {Object.keys(parsed.info.sectionNotes).length ? ` · ${Object.keys(parsed.info.sectionNotes).length} section notes` : ""}
              </p>
              {parsed.warnings.map((w) => (
                <p key={w} className="mt-1 text-xs text-amber-600">
                  {w}
                </p>
              ))}
            </div>

            {sheets && <StatusChoices parsed={parsed} opts={opts} onChange={(o) => reparse(sheets, o)} />}

            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat n={plan.create.length} label="new" />
              <Stat n={plan.update.length} label="to update" />
              <Stat n={plan.unchanged} label="unchanged" />
            </div>

            {plan.update.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold">Updates</p>
                {plan.update.slice(0, 8).map((u) => (
                  <p key={u.id} className="text-xs">
                    <span className="font-mono muted">#{u.item.number}</span> {rfiTitle(u.item.description).slice(0, 70)} <span className="muted">· {u.changes.join(", ")}</span>
                  </p>
                ))}
                {plan.update.length > 8 && <p className="text-xs muted">…and {plan.update.length - 8} more</p>}
              </div>
            )}

            {plan.create.length > 0 && (
              <label className="block space-y-1">
                <span className="text-xs font-semibold">Requested from (for new requests without a matching person responsible)</span>
                <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
                  <option value="">Nobody in particular</option>
                  {clients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button className="text-xs text-[var(--accent)]" onClick={() => setShowSections((v) => !v)}>
              {showSections ? "▾ Hide" : "▸ Show"} sections
            </button>
            <AnimatePresence initial={false}>
              {showSections && (
                <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-0.5 overflow-hidden text-xs">
                  {(parsed.sections.length ? parsed.sections : ["Requests"]).map((s) => {
                    const list = parsed.items.filter((i) => (i.section ?? "Requests") === s);
                    return (
                      <li key={s} className="flex justify-between gap-2">
                        <span>{s}</span>
                        <span className="muted">
                          {list.length} · {list.filter((i) => i.status === "received" || i.status === "na").length} closed
                        </span>
                      </li>
                    );
                  })}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        )
      )}
    </Sheet>
  );
}

const STATUS_CHOICES: { value: string; label: string }[] = [
  { value: "received", label: "Received" },
  { value: "partial", label: "Partially received" },
  { value: "pending", label: "Pending" },
  { value: "na", label: "N/A" },
  { value: "ignore", label: "Leave unchanged" },
];

/**
 * Which column is the status on each sheet (the firm's, not the client's),
 * and what each status word means. Remembered for this engagement's next IRL.
 */
function StatusChoices({ parsed, opts, onChange }: { parsed: ParsedRfi; opts: RfiParseOptions; onChange: (o: RfiParseOptions) => void }) {
  const cols = parsed.info.statusColumns.filter((c) => c.options.length);
  const values = parsed.info.statusValues;
  const unknown = values.filter((v) => !v.status).length;
  const [open, setOpen] = useState(unknown > 0);
  if (!cols.length && !values.length) return null;
  return (
    <div className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((v) => !v)}>
        <span className="font-semibold">
          Status: {cols.map((c) => `${c.sheet} → ${c.chosen || "none"}`).join(" · ") || "none"}
        </span>
        <span className="text-xs text-[var(--accent)]">{unknown ? `${unknown} not recognised` : open ? "Hide" : "Change"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {cols.map((c) => (
            <label key={c.sheet} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs">
                Status column on <b>{c.sheet}</b>
              </span>
              <select
                className="input w-auto py-1 text-sm"
                value={c.chosen}
                onChange={(e) => onChange({ ...opts, statusColumns: { ...opts.statusColumns, [c.sheet]: e.target.value } })}
                aria-label={`Status column on ${c.sheet}`}
              >
                {c.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
                <option value="">None: don't set statuses from this sheet</option>
              </select>
            </label>
          ))}
          {values.length > 0 && (
            <div>
              <p className="mb-1 text-xs muted">What each status word means. Blank cells never change an item.</p>
              <ul className="divide-y divide-[var(--border)]">
                {values.map((v) => (
                  <li key={v.value} className={`flex flex-wrap items-center justify-between gap-2 py-1.5 ${v.status ? "" : "text-amber-700 dark:text-amber-300"}`}>
                    <span>
                      “{v.value}” <span className="text-xs muted">· {v.count}</span>
                    </span>
                    <select
                      className="input w-auto py-1 text-sm"
                      value={v.status ?? ""}
                      onChange={(e) => onChange({ ...opts, statusMap: { ...opts.statusMap, [statusKey(v.value)]: e.target.value as never } })}
                      aria-label={`Meaning of ${v.value}`}
                    >
                      {!v.status && <option value="">Not recognised: pick one</option>}
                      {STATUS_CHOICES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-2)] py-2">
      <p className="text-lg font-semibold">{n}</p>
      <p className="text-xs muted">{label}</p>
    </div>
  );
}
