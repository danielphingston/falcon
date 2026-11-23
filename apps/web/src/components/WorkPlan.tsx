import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import {
  applyPlan,
  isMe,
  labels,
  matchName,
  parsePlan,
  planAwaitingReview,
  planPlanImport,
  planProgress,
  update,
  type Engagement,
  type ParsedPlan,
  type PlanItem,
  type Snapshot,
} from "@falcon/core";
import { act } from "../lib/act";
import { useSettings } from "../lib/hooks";
import { readSpreadsheet } from "../lib/spreadsheet";
import { openEditor } from "./Editor";
import { Icon } from "./Icon";
import { EmptyState, Pill, Segmented, Sheet, type Tone } from "./ui";

const EXEC: PlanItem["status"][] = ["open", "wip", "review", "closed"];
const REVIEW: NonNullable<PlanItem["reviewStatus"]>[] = ["open", "wip", "closed"];
const tone: Record<string, Tone> = { open: "slate", wip: "blue", review: "amber", closed: "green" };
const fmtH = (h: number) => (Math.round(h * 100) / 100).toString();

type Show = "all" | "open" | "review" | "done" | "mine";

/**
 * The engagement's work plan (audit programme / IA plan) imported from Excel:
 * every procedure with who does it, who reviews it and where it stands.
 */
export function WorkPlanTab({ snap, engagementId }: { snap: Snapshot; engagementId: string }) {
  const settings = useSettings();
  const e = snap.engagements.find((x) => x.id === engagementId)!;
  const items = useMemo(() => snap.planItems.filter((i) => i.engagementId === engagementId && !i.deleted).sort((a, b) => a.order - b.order), [snap, engagementId]);
  const [importing, setImporting] = useState(false);
  const [show, setShow] = useState<Show>("all");
  const [person, setPerson] = useState("");
  const info = e.planInfo;
  const hasReview = !!info?.hasReview;
  const pr = useMemo(() => planProgress(items), [items]);

  const mine = (i: PlanItem) => isMe(i.assignee, settings.myName) || isMe(i.reviewer, settings.myName);
  const toReview = (i: PlanItem) => planAwaitingReview(i, hasReview);
  const done = (i: PlanItem) => i.status === "closed" && (!hasReview || i.reviewStatus === "closed");
  const visible = items.filter(
    (i) =>
      (!person || (i.assignee || "Unassigned") === person || i.reviewer === person) &&
      (show === "all" ||
        (show === "open" && i.applicable && i.status !== "closed") ||
        (show === "review" && toReview(i)) ||
        (show === "done" && done(i)) ||
        (show === "mine" && mine(i))),
  );

  if (!items.length)
    return (
      <div className="space-y-4">
        <EmptyState icon="review" title="No work plan yet" hint="Import the engagement's work plan or audit programme (Excel) to track every procedure, who does it and who reviews it." />
        <button className="btn btn-primary w-full" onClick={() => setImporting(true)}>
          <Icon name="upload" size={16} /> Import work plan
        </button>
        <PlanImport open={importing} onClose={() => setImporting(false)} engagement={e} existing={items} people={snap.people} />
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">{info?.title[0] ?? "Work plan"}</p>
            <p className="truncate text-xs muted">{[...(info?.title.slice(1, 4) ?? []), info?.file].filter(Boolean).join(" · ")}</p>
          </div>
          <button className="btn btn-soft btn-sm shrink-0" onClick={() => setImporting(true)}>
            <Icon name="upload" size={14} /> Update from work plan
          </button>
        </div>
        <Bar label="Executed" n={pr.closed} of={pr.applicable} color="bg-emerald-500" />
        {hasReview && <Bar label="Reviewed" n={pr.reviewed} of={pr.applicable} color="bg-brand-500" />}
        {pr.budget + pr.actual > 0 && (
          <p className="text-xs muted">
            Hours: {fmtH(pr.actual)} actual of {fmtH(pr.budget)} budgeted
            {pr.applicable < pr.total ? ` · ${pr.total - pr.applicable} steps not applicable` : ""}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {pr.byPerson.map((p) => (
            <button
              key={p.name}
              onClick={() => setPerson(person === p.name ? "" : p.name)}
              className={`rounded-full border px-2.5 py-1 text-xs ${person === p.name ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border)]"}`}
            >
              {p.name} · {p.closed}/{p.steps}
              {p.budget ? ` · ${fmtH(p.actual)}/${fmtH(p.budget)}h` : ""}
            </button>
          ))}
        </div>
        {info && <PlanInfoDetails info={info} />}
      </div>

      <Segmented
        id="plan-show"
        value={show}
        onChange={setShow}
        options={[
          { value: "all", label: `All ${items.length}` },
          { value: "open", label: `Open ${items.filter((i) => i.applicable && i.status !== "closed").length}` },
          { value: "review", label: `To review ${items.filter(toReview).length}` },
          { value: "done", label: "Done" },
          { value: "mine", label: "Mine" },
        ]}
      />
      {show === "mine" && settings.myName === "Me" && <p className="text-xs muted">Set your name in Settings so the app knows which steps are yours (initials like “JK” work too).</p>}

      {visible.length ? <Steps items={visible} hasReview={hasReview} /> : <EmptyState icon="check" title="Nothing here" />}
      <PlanImport open={importing} onClose={() => setImporting(false)} engagement={e} existing={items} people={snap.people} />
    </div>
  );
}

function Bar({ label, n, of, color }: { label: string; n: number; of: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="font-semibold">
          {label}: {n} of {of}
        </span>
        <span className="muted">{of ? Math.round((n / of) * 100) : 0}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <motion.div className={`h-full rounded-full ${color}`} animate={{ width: `${of ? (n / of) * 100 : 0}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
      </div>
    </div>
  );
}

/** Steps grouped by phase › group › area, with lead-ins as small headings. */
function Steps({ items, hasReview }: { items: PlanItem[]; hasReview: boolean }) {
  const out: { head: string; area: string; rows: PlanItem[] }[] = [];
  for (const i of items) {
    const head = [i.phase, i.group].filter(Boolean).join(" › ");
    const last = out[out.length - 1];
    if (last && last.head === head && last.area === i.area) last.rows.push(i);
    else out.push({ head, area: i.area, rows: [i] });
  }
  let lastHead = "";
  return (
    <div className="space-y-4">
      {out.map((g, gi) => {
        const showHead = g.head && g.head !== lastHead;
        lastHead = g.head;
        let lastLead = "";
        return (
          <section key={gi} className="space-y-1.5">
            {showHead && <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">{g.head}</p>}
            <div className="flex items-baseline justify-between px-1">
              <h3 className="text-sm font-semibold">{g.area}</h3>
              <span className="text-xs muted">
                {g.rows.filter((r) => r.status === "closed").length}/{g.rows.filter((r) => r.applicable).length} executed
              </span>
            </div>
            <div className="card divide-y divide-[var(--border)]">
              {g.rows.map((r) => {
                const lead = r.lead && r.lead !== lastLead ? r.lead : "";
                lastLead = r.lead ?? "";
                return (
                  <div key={r.id}>
                    {lead && <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide muted">{lead}</p>}
                    <StepRow item={r} hasReview={hasReview} />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function StepRow({ item, hasReview, context }: { item: PlanItem; hasReview: boolean; context?: string }) {
  const cycle = <T extends string>(list: T[], cur: T) => list[(list.indexOf(cur) + 1) % list.length];
  const setExec = () => act(null, (ctx) => update(ctx, "planItems", item.id, { status: cycle(EXEC, item.status) }));
  const setReview = () => act(null, (ctx) => update(ctx, "planItems", item.id, { reviewStatus: cycle(REVIEW, item.reviewStatus ?? "open") }));
  const [first, ...rest] = item.text.split("\n");
  const off = !item.applicable;
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 ${off ? "opacity-50" : ""}`}>
      <button onClick={() => void setExec()} title="Execution status: tap to change" className="mt-0.5 shrink-0" disabled={off}>
        <Pill tone={tone[item.status]}>{labels.planStatus[item.status]}</Pill>
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={() => openEditor({ table: "planItems", id: item.id })}>
        <p className={`text-sm ${item.status === "closed" ? "muted" : ""}`}>
          <span className="mr-1.5 font-mono text-xs muted">{item.number}</span>
          {first}
        </p>
        {rest.length > 0 && <p className="whitespace-pre-line text-xs muted">{rest.join("\n")}</p>}
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs muted">
          {context && <span>{context}</span>}
          {item.assignee && <span>{item.assignee}</span>}
          {item.reviewer && <span>review: {item.reviewer}</span>}
          {(item.budgetHours || item.actualHours) && (
            <span>
              {fmtH(item.actualHours ?? 0)}/{fmtH(item.budgetHours ?? 0)}h
            </span>
          )}
          {item.notes && <span>· note</span>}
        </p>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {off ? <Pill>N/A</Pill> : item.risk && <Pill tone={/high/i.test(item.risk) ? "red" : /medium/i.test(item.risk) ? "amber" : "slate"}>{item.risk}</Pill>}
        {hasReview && !off && (
          <button onClick={() => void setReview()} title="Review status: tap to change">
            <Pill tone={tone[item.reviewStatus ?? "open"]}>Review: {labels.planReviewStatus[item.reviewStatus ?? "open"]}</Pill>
          </button>
        )}
      </div>
    </div>
  );
}

function PlanInfoDetails({ info }: { info: NonNullable<Engagement["planInfo"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button className="text-[var(--accent)]" onClick={() => setOpen((v) => !v)}>
        {open ? "▾ Hide plan details" : `▸ Plan details${info.tables.length ? ` · ${info.tables.map((t) => t.name).join(", ")}` : ""}`}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 space-y-3">
              {info.title.length > 4 && <p>{info.title.slice(4).join(" · ")}</p>}
              {info.notes.length > 0 && (
                <ul className="space-y-0.5">
                  {info.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
              {info.tables.map((t) => (
                <div key={t.name} className="space-y-1">
                  <p className="font-semibold">{t.name}</p>
                  <div className="max-h-72 overflow-auto rounded-lg border border-[var(--border)]">
                    <table className="w-full border-collapse text-[11px]">
                      <tbody>
                        {t.rows.map((r, i) => (
                          <tr key={i} className="border-b border-[var(--border)] align-top">
                            {r.map((c, j) => (
                              <td key={j} className="max-w-64 px-2 py-1">
                                {c}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              <p className="muted">
                Columns: {info.columns.join(" · ")}
                <br />
                Imported {new Date(info.importedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} from sheet “{info.sheet}”.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PlanImport({ open, onClose, engagement, existing, people }: { open: boolean; onClose: () => void; engagement: Engagement; existing: PlanItem[]; people: Snapshot["people"] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState("");
  const [parsed, setParsed] = useState<ParsedPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => (parsed ? planPlanImport(parsed, existing) : null), [parsed, existing]);
  const pr = useMemo(() => (parsed ? planProgress(parsed.steps.map((s, i) => ({ ...s, id: String(i), engagementId: "", createdAt: "", updatedAt: "" })) as unknown as PlanItem[]) : null), [parsed]);

  const read = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const p = parsePlan(await readSpreadsheet(f, { maxBytes: 40 * 1024 * 1024 }));
      if (!p) throw new Error("Couldn't find a work plan in this file. It needs a header row with Sl No (or Area), Particulars / Audit Procedures, and Person Responsible or Status.");
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
    if (!plan || !parsed) return;
    const res = await act(`Work plan imported: ${plan.create.length} new${plan.update.length ? `, ${plan.update.length} updated` : ""}`, (ctx) =>
      applyPlan(ctx, plan, { engagementId: engagement.id, parsed, file, resolvePerson: (n) => matchName(n, people)?.id }),
    );
    if (res) close();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={existing.length ? "Update from work plan" : "Import work plan"}
      footer={
        parsed &&
        plan && (
          <div className="flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => setParsed(null)}>
              Back
            </button>
            <button className="btn btn-primary flex-1" onClick={() => void save()}>
              {plan.create.length || plan.update.length ? `Import ${[plan.create.length && `${plan.create.length} new`, plan.update.length && `${plan.update.length} updates`].filter(Boolean).join(" + ")}` : "Save plan details"}
            </button>
          </div>
        )
      }
    >
      {!parsed ? (
        <div className="space-y-3">
          <p className="text-sm">
            Upload the engagement's work plan or audit programme (Excel). Each procedure becomes a step with its area, person responsible, execution and review status, risk, applicability and hours.
            Every other column is kept, and other sheets (time summary, risks and instructions…) are saved for reference.
          </p>
          <p className="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-xs">Updated the plan in Excel? Import it again: matching steps are updated, new ones added, your notes kept. Nothing is duplicated.</p>
          <button className="btn btn-primary w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} /> {busy ? "Reading…" : "Choose work plan file"}
          </button>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".xlsx,.csv"
            onChange={(ev) => {
              void read(ev.target.files?.[0]);
              ev.target.value = "";
            }}
          />
        </div>
      ) : (
        plan &&
        pr && (
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--border)] px-3 py-2">
              <p className="truncate text-sm font-semibold" title={file}>
                {file}
              </p>
              <p className="text-xs muted">
                Sheet “{parsed.sheet}” · {parsed.steps.length} steps{pr.applicable < pr.total ? ` (${pr.total - pr.applicable} not applicable)` : ""} · {parsed.columns.length} columns
                {parsed.hasReview ? " · with review status" : ""}
              </p>
              {parsed.title.length > 0 && <p className="mt-1 text-xs">{parsed.title.join(" · ")}</p>}
              {pr.budget > 0 && (
                <p className="mt-1 text-xs muted">
                  Hours: {fmtH(pr.budget)} budgeted, {fmtH(pr.actual)} actual
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                {pr.byPerson.map((p) => (
                  <Pill key={p.name}>
                    {p.name} {p.steps}
                  </Pill>
                ))}
              </div>
              {parsed.tables.length > 0 && <p className="mt-1 text-xs muted">Also kept for reference: {parsed.tables.map((t) => t.name).join(", ")}</p>}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                [plan.create.length, "new"],
                [plan.update.length, "to update"],
                [plan.unchanged, "unchanged"],
              ].map(([n, l]) => (
                <div key={l} className="rounded-xl bg-[var(--surface-2)] py-2">
                  <p className="text-lg font-semibold">{n}</p>
                  <p className="text-xs muted">{l}</p>
                </div>
              ))}
            </div>
            {plan.update.slice(0, 8).map((u) => (
              <p key={u.id} className="text-xs">
                <span className="font-mono muted">{u.step.number}</span> {u.step.text.split("\n")[0].slice(0, 60)} <span className="muted">· {u.changes.join(", ")}</span>
              </p>
            ))}
          </div>
        )
      )}
    </Sheet>
  );
}
