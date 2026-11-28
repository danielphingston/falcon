/**
 * Creating a workpaper always asks which worksteps it covers (build brief v2
 * A3): a searchable multi-select of the engagement's steps, grouped by
 * programme. Defaults (ref, title, preparer, reviewer) come from the picked
 * steps. "Not linked to any step" is an explicit ad-hoc option. The same
 * picker edits a workpaper's linked steps.
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  ME,
  chainView,
  createWorkpaperForSteps,
  labels,
  setWorkpaperSteps,
  shortTitle,
  todayISO,
  workpaperDefaults,
  wpStatuses,
  type ChainProgramme,
  type PlanItem,
  type Snapshot,
  type WorkPaper,
} from "@falcon/core";
import { act } from "../lib/act";
import { useSettings, useSnapshot } from "../lib/hooks";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";
import { Sheet } from "./ui";

// ---------- Host (any component can open the form) ----------

type Open = { key: number; mode: "create"; engagementId?: string; stepIds: string[] } | { key: number; mode: "links"; workpaperId: string };
let current: Open | null = null;
let nextKey = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** New workpaper; `stepIds` pre-selects steps (the "Create workpaper" shortcut on a step). */
export function openWorkpaperForm(opts: { engagementId?: string; stepIds?: string[] } = {}) {
  current = { key: nextKey++, mode: "create", engagementId: opts.engagementId, stepIds: opts.stepIds ?? [] };
  emit();
}
/** "Edit linked steps" on a workpaper. */
export function openStepLinks(workpaperId: string) {
  current = { key: nextKey++, mode: "links", workpaperId };
  emit();
}
const close = () => {
  current = null;
  emit();
};

export function WorkpaperFormHost() {
  const o = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const snap = useSnapshot();
  if (!o || !snap) return null;
  return o.mode === "create" ? <CreateForm key={o.key} snap={snap} engagementId={o.engagementId} initial={o.stepIds} /> : <LinksForm key={o.key} snap={snap} workpaperId={o.workpaperId} />;
}

// ---------- Step picker ----------

/** Multi-select of worksteps: grouped by programme, unlinked first, linked ones greyed with their workpaper, N/A hidden, searchable. */
export function StepPicker({
  snap,
  engagementId,
  value,
  onChange,
  currentWpId,
}: {
  snap: Snapshot;
  engagementId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  /** The workpaper being edited: its own steps aren't "linked elsewhere". */
  currentWpId?: string;
}) {
  const settings = useSettings();
  const [q, setQ] = useState("");
  const view = useMemo(() => chainView(snap, engagementId, todayISO(), settings), [snap, engagementId, settings]);
  const wps = new Map(snap.workpapers.map((w) => [w.id, w]));
  const words = q.trim().toLowerCase();
  const groups: { g: ChainProgramme; steps: PlanItem[] }[] = view.programmes
    .map((g) => {
      const steps = g.steps
        .map((x) => x.step)
        .filter((s) => s.applicable && (!words || `${s.number} ${s.text} ${g.name}`.toLowerCase().includes(words)));
      // Not yet linked first, keeping plan order within each.
      const free = steps.filter((s) => !s.workpaperId || s.workpaperId === currentWpId);
      return { g, steps: [...free, ...steps.filter((s) => !free.includes(s))] };
    })
    .filter((x) => x.steps.length);
  const toggle = (s: PlanItem, on: boolean) => {
    if (on && s.workpaperId && s.workpaperId !== currentWpId) {
      const other = wps.get(s.workpaperId);
      if (!confirm(`Step ${s.number || shortTitle(s.text)} is on “${other?.ref} ${other?.title}”. Move it to this workpaper?`)) return;
    }
    onChange(on ? [...value, s.id] : value.filter((id) => id !== s.id));
  };
  return (
    <div className="rounded-xl border border-[var(--border)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-2 py-1.5">
        <Icon name="search" size={14} className="muted" />
        <input className="w-full bg-transparent py-1 text-sm outline-none" placeholder="Search by number or words" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search worksteps" />
        {value.length > 0 && <span className="shrink-0 text-xs font-semibold text-[var(--accent)]">{value.length} picked</span>}
      </div>
      <div className="max-h-72 overflow-y-auto p-1">
        {!groups.length && <p className="p-3 text-sm muted">{words ? "No step matches." : "This engagement has no worksteps yet. Import the work plan, or make it ad-hoc."}</p>}
        {groups.map(({ g, steps }) => (
          <div key={g.id} className="py-1">
            <p className="px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">{g.name}</p>
            {steps.map((s) => {
              const other = s.workpaperId && s.workpaperId !== currentWpId ? wps.get(s.workpaperId) : undefined;
              const on = value.includes(s.id);
              return (
                <label key={s.id} className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-2)] ${other && !on ? "opacity-55" : ""}`}>
                  <input type="checkbox" className="mt-1" checked={on} onChange={(e) => toggle(s, e.target.checked)} />
                  <span className="min-w-0">
                    <span className="mr-1.5 font-mono text-xs muted">{s.number}</span>
                    {s.text.split("\n")[0]}
                    <span className="block text-xs muted">
                      {s.assignee || "No owner"}
                      {other && ` · on ${other.ref} ${other.title}`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- People select ----------

function PersonSelect({ snap, value, onChange, label, roles }: { snap: Snapshot; value: string; onChange: (v: string) => void; label: string; roles: string[] }) {
  const people = snap.people.filter((p) => roles.includes(p.role)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-semibold muted">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        <option value={ME}>Me</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------- Create ----------

function CreateForm({ snap, engagementId: initialEng, initial }: { snap: Snapshot; engagementId?: string; initial: string[] }) {
  const settings = useSettings();
  const fromStep = initial.length ? snap.planItems.find((s) => s.id === initial[0])?.engagementId : undefined;
  const live = snap.engagements.filter((e) => e.status !== "closed").sort((a, b) => a.name.localeCompare(b.name));
  const [engagementId, setEngagementId] = useState(initialEng ?? fromStep ?? "");
  const [stepIds, setStepIds] = useState<string[]>(initial);
  const [adHoc, setAdHoc] = useState(false);
  const d = useMemo(() => workpaperDefaults(stepIds, snap, settings), [stepIds, snap, settings]);
  // Typed values win over defaults; defaults follow the picked steps until the user types.
  const [typed, setTyped] = useState<{ ref?: string; title?: string; preparer?: string; reviewer?: string }>({});
  const [status, setStatus] = useState<WorkPaper["status"]>("not_started");
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const ref = typed.ref ?? d.ref;
  const title = typed.title ?? d.title;
  const preparer = typed.preparer ?? d.preparer ?? "";
  const reviewer = typed.reviewer ?? d.reviewer ?? "";
  const teamOwner = stepIds.length > 0 && !d.preparer;
  const dupRef = ref.trim() && snap.workpapers.some((w) => w.engagementId === engagementId && w.ref.trim().toLowerCase() === ref.trim().toLowerCase());
  const answered = adHoc || stepIds.length > 0;
  const ok = !!engagementId && answered && !!title.trim() && !!preparer;

  const save = async () => {
    if (!ok) return;
    let made: WorkPaper | undefined;
    const res = await act(`Workpaper ${ref || title} added${stepIds.length ? ` for ${stepIds.length} step${stepIds.length === 1 ? "" : "s"}` : ""}`, async (ctx) => {
      const r = await createWorkpaperForSteps(ctx, {
        engagementId,
        stepIds: adHoc ? [] : stepIds,
        adHoc,
        ref,
        title,
        preparerId: preparer,
        reviewerId: reviewer || undefined,
        status,
        due: due || undefined,
        notes: notes || undefined,
        area: d.area,
      });
      made = r.workpaper;
    });
    if (res && made) close();
  };

  return (
    <Sheet
      open
      onClose={close}
      title="New workpaper"
      footer={
        <>
          <div className="flex-1 text-xs muted">{!answered ? "Pick the worksteps it covers (or make it ad-hoc)." : !preparer ? "Say who prepares it." : ""}</div>
          <button className="btn btn-soft" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!ok} onClick={() => void save()}>
            Add
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {!initialEng && !fromStep && (
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold muted">Engagement</span>
            <select
              className="input"
              value={engagementId}
              onChange={(e) => {
                setEngagementId(e.target.value);
                setStepIds([]);
              }}
            >
              <option value="">Choose…</option>
              {live.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {engagementId && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">
              Which worksteps does this workpaper cover? <span className="text-rose-600">*</span>
            </p>
            {!adHoc && <StepPicker snap={snap} engagementId={engagementId} value={stepIds} onChange={setStepIds} />}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={adHoc} onChange={(e) => setAdHoc(e.target.checked)} />
              <span>
                Not linked to any step (ad-hoc)
                <span className="block text-xs muted">It sits under “Unlinked workpapers” until you link it.</span>
              </span>
            </label>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold muted">WP ref</span>
            <input className="input" value={ref} onChange={(e) => setTyped({ ...typed, ref: e.target.value })} placeholder="e.g. 7.1" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold muted">Status</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as WorkPaper["status"])}>
              {wpStatuses.map((s) => (
                <option key={s} value={s}>
                  {labels.wpStatus[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {dupRef && <p className="-mt-2 text-xs text-amber-600">Another workpaper on this engagement already has ref “{ref}”. That's allowed, but a distinct ref is easier to find.</p>}
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold muted">Title</span>
          <input className="input" value={title} onChange={(e) => setTyped({ ...typed, title: e.target.value })} placeholder="e.g. Revenue MoM" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <PersonSelect snap={snap} label="Preparer" roles={["team"]} value={preparer} onChange={(v) => setTyped({ ...typed, preparer: v })} />
          <PersonSelect snap={snap} label="Reviewer" roles={["team", "manager", "partner"]} value={reviewer} onChange={(v) => setTyped({ ...typed, reviewer: v })} />
        </div>
        {teamOwner && !typed.preparer && <p className="-mt-2 text-xs text-amber-600">The step owner isn't one person (e.g. “Team”): who prepares this workpaper?</p>}
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold muted">Due</span>
          <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold muted">Notes</span>
          <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
    </Sheet>
  );
}

// ---------- Edit linked steps ----------

function LinksForm({ snap, workpaperId }: { snap: Snapshot; workpaperId: string }) {
  const wp = snap.workpapers.find((w) => w.id === workpaperId);
  const [ids, setIds] = useState<string[]>(() => snap.planItems.filter((s) => s.workpaperId === workpaperId).map((s) => s.id));
  if (!wp) return null;
  const save = async () => {
    const res = await act(`Linked steps updated on ${wp.ref}`, async (ctx) => {
      await setWorkpaperSteps(ctx, wp.id, ids);
    });
    if (res) {
      if (!ids.length) toast({ message: `${wp.ref} now covers no step: it's listed under Unlinked workpapers.` });
      close();
    }
  };
  return (
    <Sheet
      open
      onClose={close}
      title={`Linked steps · ${wp.ref} ${wp.title}`}
      footer={
        <>
          <div className="flex-1" />
          <button className="btn btn-soft" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <p className="mb-2 text-sm font-semibold">Which worksteps does this workpaper cover?</p>
      <StepPicker snap={snap} engagementId={wp.engagementId} value={ids} onChange={setIds} currentWpId={wp.id} />
      <p className="mt-2 text-xs muted">Linked steps show this workpaper's status. Unticking a step leaves it open with no workpaper.</p>
    </Sheet>
  );
}
