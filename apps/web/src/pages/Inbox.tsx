import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { closeChoices, defaultChoices, diffLines, recordTitle, type Proposal } from "@falcon/core";
import { Icon } from "../components/Icon";
import { useLookups } from "../components/rows";
import { EmptyState, Pill, Segmented, type Tone } from "../components/ui";
import { db } from "../db";
import { useSnapshot } from "../lib/hooks";
import { accept, acceptMany, reject, undo, usePendingProposals } from "../lib/proposals";

const SOURCE: Record<Proposal["source"], [string, string]> = {
  connector: ["✦", "Claude"],
  chat: ["✦", "Assistant"],
  import: ["⇪", "Import"],
  matcher: ["≈", "Matcher"],
  app: ["•", "Falcon"],
};
const STATUS: Record<Proposal["status"], [Tone, string]> = {
  pending: ["amber", "Pending"],
  accepted: ["green", "Accepted"],
  rejected: ["slate", "Rejected"],
  stale: ["red", "Stale"],
  void: ["red", "Void"],
};
const NOUN: Record<string, string> = {
  people: "Person",
  engagements: "Engagement",
  tasks: "Task",
  workpapers: "Work paper",
  reviewPoints: "Review point",
  infoRequests: "RFI item",
  followUps: "Follow-up",
  alerts: "Alert",
  timeEntries: "Time entry",
  programItems: "Programme item",
  planItems: "Workstep",
  programmes: "Programme",
  workstreams: "Workstream",
};
/** "nextChaseOn" → "Next chase on". */
const label = (f: string) => {
  const s = f.replace(/Id$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/**
 * Inbox: changes an AI (Claude, the in-app Assistant) or an import wants to
 * make. Nothing changes until you accept; each accepted change can be undone.
 */
export function InboxPage() {
  const pending = usePendingProposals();
  const snap = useSnapshot();
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const decided = useMemo(
    () => (snap?.proposals ?? []).filter((p) => p.status !== "pending" && Date.now() - new Date(p.decidedAt ?? p.updatedAt).getTime() < 30 * 86_400_000).sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")),
    [snap],
  );

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Inbox</h1>
        <p className="text-sm muted">Changes Claude, the Assistant or an import want to make. Nothing changes until you accept, and every accepted change can be undone.</p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented id="inbox-tab" value={tab} onChange={setTab} options={[{ value: "pending", label: `Pending ${pending.length}` }, { value: "decided", label: "Decided" }]} />
        {tab === "pending" && pending.length > 1 && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              if (confirm(`Apply all ${pending.length} pending changes? Each is checked and applied on its own; any whose record changed since are skipped and listed under Decided.`)) void acceptMany(pending.map((p) => p.id));
            }}
          >
            <Icon name="check" size={14} /> Accept all ({pending.length})
          </button>
        )}
      </div>

      {tab === "pending" ? (
        pending.length ? (
          <div className="space-y-3">
            {pending.map((p) => (
              <ProposalCard key={p.id} p={p} />
            ))}
          </div>
        ) : (
          <EmptyState icon="check" title="Nothing waiting" hint="When Claude or the Assistant wants to change something, it shows here for you to accept or reject." />
        )
      ) : decided.length ? (
        <div className="space-y-3">
          {decided.map((p) => (
            <ProposalCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <EmptyState icon="inbox" title="Nothing decided in the last 30 days" />
      )}
    </div>
  );
}

export function ProposalCard({ p, compact = false }: { p: Proposal; compact?: boolean }) {
  const l = useLookups();
  const [open, setOpen] = useState(!compact && p.changes.length <= 3);
  const [busy, setBusy] = useState(false);
  // Optional parts (links, owners…): ticked by default as proposed; the user picks before accepting.
  const [picked, setPicked] = useState<string[]>(() => (p.status === "pending" ? defaultChoices(p) : (p.chosen ?? [])));
  // An accepted proposal can be undone while its change hasn't been undone already.
  const undone = useLiveQuery(async () => (p.batchId ? (await db.changes.where("batchId").equals(p.batchId).toArray()).every((c) => c.undone) : false), [p.batchId]);
  // Linked records show by name, not id.
  const named = (field: string, v: string) =>
    field === "engagementId" ? (l.engagements.get(v)?.name ?? v) : /^(assigneeId|requestedFromId|personId|preparerId|reviewerId|assignedToId|raisedById|leadId)$/.test(field) ? (l.people.get(v)?.name ?? v) : field === "workpaperId" ? (l.workpapers.get(v)?.ref ?? v) : v;
  const [icon, who] = SOURCE[p.source];
  const [tone, status] = STATUS[p.status];
  const eng = p.engagementId ? l.engagements.get(p.engagementId)?.name : undefined;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs muted">
            <span className="font-semibold text-[var(--accent)]">
              {icon} {who}
            </span>
            {eng && <> · {eng}</>} · {ago(p.createdAt)}
            {p.tool && <> · {p.tool}</>}
          </p>
          <p className="mt-0.5 font-medium">{p.summary}</p>
          {p.reason && p.status !== "pending" && <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">{p.reason}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {p.status !== "pending" && <Pill tone={tone}>{status}</Pill>}
          {p.status === "pending" && (
            <>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run(() => accept(p.id, p.choices?.length ? picked : undefined))}>
                {p.choices?.length ? `Accept (${closeChoices(p, picked).length}/${p.choices.length} ticked)` : "Accept"}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => reject(p.id))}>
                Reject
              </button>
            </>
          )}
          {p.status === "accepted" && p.batchId && !undone && (
            <button className="btn btn-ghost btn-sm" onClick={() => void undo(p.batchId!)}>
              <Icon name="undo" size={14} /> Undo
            </button>
          )}
        </div>
      </div>
      {!!p.choices?.length && <Choices p={p} picked={picked} setPicked={setPicked} />}
      {!!p.changes.length && (
        <button className="mt-2 text-xs text-[var(--accent)]" onClick={() => setOpen((v) => !v)}>
          {open ? "▾ Hide details" : `▸ ${p.changes.length} change${p.changes.length === 1 ? "" : "s"}${p.choices?.length ? " always applied" : ""}`}
        </button>
      )}
      {open && (
        <ul className="mt-2 space-y-2">
          {p.changes.map((c, i) => (
            <li key={i} className="rounded-xl border border-[var(--border)] p-2 text-sm">
              <p className="text-xs">
                <span className="font-semibold">{c.action === "create" ? "New" : c.action === "delete" ? "Delete" : "Change"} {NOUN[c.table]?.toLowerCase() ?? c.table}</span>{" "}
                <span className="muted">{short(recordTitle(c.table, c.after) || recordTitle(c.table, c.before), 90)}</span>
              </p>
              <dl className="mt-1 grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-0.5 text-xs">
                {diffLines(c)
                  .slice(0, 14)
                  .map((d) => (
                    <div key={d.field} className="contents">
                      <dt className="muted">{label(d.field)}</dt>
                      <dd className="min-w-0 break-words">
                        {c.action !== "create" && (
                          <>
                            <span className="line-through muted">{short(named(d.field, d.from))}</span> →{" "}
                          </>
                        )}
                        <span className="font-medium">{short(named(d.field, d.to))}</span>
                      </dd>
                    </div>
                  ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Tick / untick each optional part of a proposal, grouped ("Links", "Owners"…). */
function Choices({ p, picked, setPicked }: { p: Proposal; picked: string[]; setPicked: (v: string[]) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<Proposal["choices"]>>();
    for (const c of p.choices ?? []) m.set(c.group || "Choices", [...(m.get(c.group || "Choices") ?? []), c]);
    return [...m.entries()];
  }, [p.choices]);
  const pending = p.status === "pending";
  const on = new Set(closeChoices(p, picked));
  const toggle = (key: string, v: boolean) => setPicked(v ? [...picked, key] : picked.filter((k) => k !== key));
  return (
    <div className="mt-2 space-y-2">
      {groups.map(([g, list]) => (
        <fieldset key={g} className="rounded-xl border border-[var(--border)] p-2">
          <legend className="flex items-center gap-2 px-1 text-xs font-semibold">
            {g} <span className="muted font-normal">{list.filter((c) => on.has(c.key)).length}/{list.length}</span>
            {pending && list.length > 2 && (
              <>
                <button type="button" className="text-[var(--accent)] font-normal" onClick={() => setPicked([...new Set([...picked, ...list.map((c) => c.key)])])}>
                  all
                </button>
                <button type="button" className="text-[var(--accent)] font-normal" onClick={() => setPicked(picked.filter((k) => !list.some((c) => c.key === k)))}>
                  none
                </button>
              </>
            )}
          </legend>
          <ul className="space-y-1">
            {list.map((c) => {
              const blocked = (c.requires ?? []).some((r) => !on.has(r));
              return (
                <li key={c.key}>
                  <label className={`flex items-start gap-2 text-sm ${blocked ? "opacity-50" : ""}`}>
                    <input type="checkbox" className="mt-1" disabled={!pending || blocked} checked={on.has(c.key)} onChange={(e) => toggle(c.key, e.target.checked)} />
                    <span className="min-w-0">
                      {c.label}
                      {c.detail && <span className="block text-xs muted">{c.detail}</span>}
                      {blocked && pending && <span className="block text-xs muted">Needs the link it depends on.</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}
