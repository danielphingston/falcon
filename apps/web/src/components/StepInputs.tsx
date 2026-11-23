import { useState } from "react";
import { guessInputs, labels, update, type InfoRequest, type PlanItem } from "@falcon/core";
import { act } from "../lib/act";
import { useSnapshot } from "../lib/hooks";
import { Icon } from "./Icon";
import { Pill, type Tone } from "./ui";

const tone: Record<InfoRequest["status"], Tone> = { pending: "amber", partial: "blue", received: "green", na: "slate" };

/**
 * What a work plan step needs from the client: RFI items and inputs that aren't
 * on the RFI. Starts from the app's guess (or the AI's links); any change here
 * is saved as the user's own and isn't overwritten later.
 */
export function StepInputs({ item }: { item: PlanItem }) {
  const snap = useSnapshot();
  const [query, setQuery] = useState("");
  const [extraName, setExtraName] = useState("");
  if (!snap) return null;
  const rfi = snap.infoRequests.filter((r) => r.engagementId === item.engagementId && !r.deleted);
  const byId = new Map(rfi.map((r) => [r.id, r]));
  const guess = item.inputs ? undefined : guessInputs(item, rfi);
  const cur: { rfiIds: string[]; extra: { name: string; received: boolean }[]; none?: boolean } = item.inputs ?? { rfiIds: guess!.rfiIds, extra: guess!.missing.map((name) => ({ name, received: false })) };
  const rfiIds = cur.rfiIds.filter((id) => byId.has(id));

  const save = (next: { rfiIds?: string[]; extra?: { name: string; received: boolean }[]; none?: boolean }) =>
    act(null, (ctx) =>
      update(ctx, "planItems", item.id, {
        inputs: { rfiIds: next.rfiIds ?? rfiIds, extra: next.extra ?? cur.extra, none: next.none || undefined, source: "manual" },
      }),
    );
  const reset = () => act("Back to the automatic match", (ctx) => update(ctx, "planItems", item.id, { inputs: undefined }));

  const q = query.trim().toLowerCase();
  const options = q ? rfi.filter((r) => !rfiIds.includes(r.id) && `${r.number} ${r.description} ${r.section ?? ""}`.toLowerCase().includes(q)).slice(0, 8) : [];
  const source = item.inputs?.source === "manual" ? "Set by you" : item.inputs?.source === "ai" ? "Linked by AI" : "Matched from the wording";

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Inputs needed</h3>
        <span className="text-xs muted">
          {source}
          {item.inputs && (
            <button className="ml-2 text-[var(--accent)]" onClick={() => void reset()}>
              Reset
            </button>
          )}
        </span>
      </div>
      <div className="space-y-2 rounded-xl border border-[var(--border)] p-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!cur.none} onChange={(e) => void save({ none: e.target.checked, rfiIds: e.target.checked ? [] : rfiIds, extra: e.target.checked ? [] : cur.extra })} />
          No client input needed
        </label>
        {!cur.none && (
          <>
            {rfiIds.length === 0 && cur.extra.length === 0 && <p className="text-xs muted">Nothing linked yet. Search the RFI below.</p>}
            <ul className="space-y-1">
              {rfiIds.map((id) => {
                const r = byId.get(id)!;
                return (
                  <li key={id} className="flex items-start gap-2">
                    <Pill tone={tone[r.status]}>{labels.irlStatus[r.status]}</Pill>
                    <span className="min-w-0 flex-1">
                      {r.number && <span className="mr-1 font-mono text-xs muted">RFI {r.number}</span>}
                      {r.description.split("\n")[0]}
                    </span>
                    <button aria-label="Remove" className="muted" onClick={() => void save({ rfiIds: rfiIds.filter((x) => x !== id) })}>
                      <Icon name="x" size={14} />
                    </button>
                  </li>
                );
              })}
              {cur.extra.map((x, i) => (
                <li key={`x${i}`} className="flex items-start gap-2">
                  <button
                    title="Tap when it has come in"
                    onClick={() => void save({ extra: cur.extra.map((y, j) => (j === i ? { ...y, received: !y.received } : y)) })}
                  >
                    <Pill tone={x.received ? "green" : "red"}>{x.received ? "Received" : "Not on RFI"}</Pill>
                  </button>
                  <span className="min-w-0 flex-1">{x.name}</span>
                  <button aria-label="Remove" className="muted" onClick={() => void save({ extra: cur.extra.filter((_, j) => j !== i) })}>
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <input className="input py-1 text-sm" placeholder="Search the RFI to link an item…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the RFI" />
            {options.length > 0 && (
              <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                {options.map((r) => (
                  <li key={r.id}>
                    <button className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-[var(--surface-2)]" onClick={() => (void save({ rfiIds: [...rfiIds, r.id] }), setQuery(""))}>
                      <Icon name="plus" size={14} className="mt-0.5 shrink-0" />
                      <span className="min-w-0">
                        {r.number && <span className="mr-1 font-mono text-xs muted">{r.number}</span>}
                        {r.description.split("\n")[0]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const name = extraName.trim();
                if (!name) return;
                void save({ extra: [...cur.extra, { name, received: false }] });
                setExtraName("");
              }}
            >
              <input className="input py-1 text-sm" placeholder="Input not on the RFI, e.g. GSTR-2B" value={extraName} onChange={(e) => setExtraName(e.target.value)} aria-label="Input not on the RFI" />
              <button className="btn btn-soft btn-sm shrink-0" type="submit">
                Add
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
