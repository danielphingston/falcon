/**
 * Bulk "assign contact" (build brief v2 B1): open RFI items with nobody to
 * chase, per engagement, ticked in bulk and given a client contact (or the
 * client's person responsible as a name). One undo batch.
 */
import { useMemo, useState } from "react";
import { assignContact, withoutContact, type Snapshot } from "@falcon/core";
import { act } from "../lib/act";
import { Sheet } from "./ui";

export function BulkAssign({ snap, open, onClose, engagementId: initial }: { snap: Snapshot; open: boolean; onClose: () => void; engagementId?: string }) {
  const all = useMemo(() => withoutContact(snap.infoRequests), [snap.infoRequests]);
  const engs = snap.engagements.filter((e) => all.some((r) => r.engagementId === e.id)).sort((a, b) => a.name.localeCompare(b.name));
  const [engagementId, setEngagementId] = useState(initial ?? engs[0]?.id ?? "");
  const items = all.filter((r) => r.engagementId === engagementId).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [who, setWho] = useState("");
  const [name, setName] = useState("");
  // Client contacts on this engagement first (brief v2 C5), then other clients.
  const clients = snap.people.filter((p) => p.role === "client").sort((a, b) => Number(!(a.engagementIds ?? []).includes(engagementId)) - Number(!(b.engagementIds ?? []).includes(engagementId)) || a.name.localeCompare(b.name));
  const ids = items.filter((r) => picked.has(r.id)).map((r) => r.id);
  const ok = ids.length > 0 && (who === "name" ? !!name.trim() : !!who);

  const save = async () => {
    const res = await act(`Contact set on ${ids.length} RFI item${ids.length === 1 ? "" : "s"}`, (ctx) => assignContact(ctx, ids, who === "name" ? { responsible: name } : { personId: who }));
    if (res) {
      setPicked(new Set());
      if (ids.length === items.length) onClose();
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Assign a contact"
      footer={
        <>
          <div className="flex-1 text-xs muted">{ids.length} of {items.length} ticked</div>
          <button className="btn btn-soft" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" disabled={!ok} onClick={() => void save()}>
            Assign
          </button>
        </>
      }
    >
      {!all.length ? (
        <p className="text-sm muted">Every open RFI item has someone to chase.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm muted">{all.length} open RFI items have nobody to chase, so they aren't counted as chases. Tick the ones one person has, and say who.</p>
          <select
            className="input"
            value={engagementId}
            onChange={(e) => {
              setEngagementId(e.target.value);
              setPicked(new Set());
            }}
            aria-label="Engagement"
          >
            {engs.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {all.filter((r) => r.engagementId === e.id).length}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <select className="input" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Contact">
              <option value="">Who has them?</option>
              {clients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.org ? ` · ${p.org}` : ""}
                  {(p.engagementIds ?? []).length && !(p.engagementIds ?? []).includes(engagementId) ? " (another engagement)" : ""}
                </option>
              ))}
              <option value="name">Type a name (client's person responsible)…</option>
            </select>
            {who === "name" && <input className="input" placeholder="e.g. Accounts team" value={name} onChange={(e) => setName(e.target.value)} />}
          </div>
          <div className="rounded-xl border border-[var(--border)]">
            <label className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-sm font-semibold">
              <input type="checkbox" checked={items.length > 0 && ids.length === items.length} onChange={(e) => setPicked(new Set(e.target.checked ? items.map((r) => r.id) : []))} />
              All {items.length}
            </label>
            <div className="max-h-80 overflow-y-auto">
              {items.map((r) => (
                <label key={r.id} className="flex items-start gap-2 px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={picked.has(r.id)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(r.id);
                      else next.delete(r.id);
                      setPicked(next);
                    }}
                  />
                  <span className="min-w-0">
                    <span className="mr-1.5 font-mono text-xs muted">{r.number}</span>
                    {r.description.split("\n")[0]}
                    {r.section && <span className="block text-xs muted">{r.section}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
