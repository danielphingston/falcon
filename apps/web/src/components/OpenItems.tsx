/**
 * A workpaper's open items (build brief v2 A5): what's still to do, each
 * optionally waiting on an RFI item. When that item comes in, the workpaper
 * is flagged "Inputs now in – re-review" (on Today, under To review) until
 * the reviewer marks it re-reviewed or the item is resolved.
 */
import { useState } from "react";
import { rfiTitle, newId, rereviewFlags, update, type OpenItem, type WorkPaper } from "@falcon/core";
import { act } from "../lib/act";
import { useSnapshot } from "../lib/hooks";
import { Icon } from "./Icon";
import { Pill, statusTone } from "./ui";

export function OpenItemsPanel({ wp }: { wp: WorkPaper }) {
  const snap = useSnapshot();
  const [text, setText] = useState("");
  const [rfi, setRfi] = useState("");
  if (!snap) return null;
  const items = wp.openItems ?? [];
  const rfiItems = snap.infoRequests.filter((r) => r.engagementId === wp.engagementId).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const rfiById = new Map(rfiItems.map((r) => [r.id, r]));
  const flagged = rereviewFlags({ workpapers: [wp], infoRequests: snap.infoRequests })[0]?.items ?? [];
  const save = (openItems: OpenItem[], msg: string) => act(msg, (ctx) => update(ctx, "workpapers", wp.id, { openItems }));

  const add = async () => {
    if (!text.trim()) return;
    const res = await save([...items, { id: newId(), text: text.trim(), rfiItemId: rfi || undefined, resolved: false }], "Open item added");
    if (res) {
      setText("");
      setRfi("");
    }
  };
  const seen = () => {
    const at = new Date().toISOString();
    const ids = new Set(flagged.map((o) => o.id));
    void save(items.map((o) => (ids.has(o.id) ? { ...o, rereviewSeenAt: at } : o)), "Marked re-reviewed");
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        Open items <span className="font-normal muted">{items.filter((o) => !o.resolved).length} open</span>
      </h3>
      {flagged.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
          <span>
            <b>Inputs now in – re-review.</b> {flagged.map((o) => `RFI ${rfiById.get(o.rfiItemId!)?.number ?? ""}`).join(", ")} received.
          </span>
          <button className="btn btn-soft btn-sm" onClick={seen}>
            Mark re-reviewed
          </button>
        </div>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          {items.map((o) => {
            const r = o.rfiItemId ? rfiById.get(o.rfiItemId) : undefined;
            return (
              <li key={o.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={o.resolved}
                  aria-label="Resolved"
                  onChange={(e) => void save(items.map((x) => (x.id === o.id ? { ...x, resolved: e.target.checked } : x)), e.target.checked ? "Open item resolved" : "Open item reopened")}
                />
                <span className={`min-w-0 flex-1 ${o.resolved ? "line-through muted" : ""}`}>
                  {o.text}
                  {(r || o.note) && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs muted">
                      {r && (
                        <>
                          RFI {r.number} <Pill tone={statusTone[r.status]}>{r.status}</Pill>
                        </>
                      )}
                      {o.note && <span>{o.note}</span>}
                    </span>
                  )}
                </span>
                <button className="muted" aria-label="Remove open item" onClick={() => void save(items.filter((x) => x.id !== o.id), "Open item removed")}>
                  <Icon name="x" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-40 flex-1" placeholder="e.g. UK entity values to be updated" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} aria-label="New open item" />
        <select className="input w-auto" value={rfi} onChange={(e) => setRfi(e.target.value)} aria-label="Waiting on RFI item">
          <option value="">No RFI item</option>
          {rfiItems.map((r) => (
            <option key={r.id} value={r.id}>
              {r.number} {rfiTitle(r.description).slice(0, 50)}
            </option>
          ))}
        </select>
        <button className="btn btn-soft" disabled={!text.trim()} onClick={() => void add()}>
          Add
        </button>
      </div>
    </div>
  );
}
