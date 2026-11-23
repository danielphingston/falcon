import { AnimatePresence, motion } from "motion/react";
import { useState, useSyncExternalStore } from "react";
import {
  create,
  createEngagement,
  createFollowUp,
  createInfoRequest,
  defaultWorkstreams,
  labels,
  logChase,
  remove,
  todayISO,
  update,
  type AnyEntity,
  type EntityMap,
  type TableName,
} from "@falcon/core";
import { act } from "../lib/act";
import { useRecord, useTable } from "../lib/hooks";
import { formDefs, RecordForm, toLocalInput, valuesToPatch, type FormValues } from "./forms";
import { Icon } from "./Icon";
import { Checkbox, Pill, Sheet, statusTone } from "./ui";
import { ReviewChecklist } from "./ReviewChecklist";
import { ReviewPointsPanel } from "./ReviewPoints";

// ---------- Editor stack (any component can open one) ----------

interface Entry {
  key: number;
  open: boolean;
  table: TableName;
  id?: string;
  defaults?: Record<string, unknown>;
  onCreated?: (record: AnyEntity) => void;
}
let entries: Entry[] = [];
let nextKey = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openEditor(e: Omit<Entry, "key" | "open">) {
  entries = [...entries, { ...e, key: nextKey++, open: true }];
  emit();
}
function closeEditor(key: number) {
  entries = entries.map((e) => (e.key === key ? { ...e, open: false } : e));
  emit();
  setTimeout(() => {
    entries = entries.filter((e) => e.key !== key);
    emit();
  }, 400);
}

export function EditorHost() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => entries,
  );
  return (
    <>
      {list.map((e) => (
        <Editor key={e.key} entry={e} />
      ))}
    </>
  );
}

const nouns: Record<TableName, string> = {
  tasks: "task",
  engagements: "engagement",
  workstreams: "workstream",
  workpapers: "work paper",
  reviewPoints: "review point",
  infoRequests: "RFI item",
  followUps: "follow-up",
  people: "contact",
  alerts: "reminder",
  timeEntries: "time entry",
  days: "day",
  achievements: "badge",
  trialBalances: "trial balance",
  programItems: "programme step",
  planItems: "work plan step",
};

function recordToValues(table: TableName, r: Record<string, unknown> | null | undefined): FormValues {
  const out: FormValues = {};
  for (const f of formDefs[table]) {
    const v = r?.[f.name];
    if (f.type === "toggles") out[f.name] = (v as string[]) ?? [...defaultWorkstreams];
    else if (f.type === "people") out[f.name] = (v as string[] | undefined) ?? [];
    else if (f.type === "datetime") out[f.name] = typeof v === "string" ? toLocalInput(v) : "";
    else if (f.type === "hours") out[f.name] = typeof v === "number" ? String(Math.round((v / 60) * 100) / 100) : "";
    else out[f.name] = v === undefined || v === null ? "" : String(v);
  }
  // Context for pickers (e.g. a programme step's work-paper list); not saved.
  if (typeof r?.engagementId === "string" && !("engagementId" in out)) out.engagementId = r.engagementId;
  // Sensible defaults for selects so the form shows what will be saved.
  for (const f of formDefs[table])
    if (f.type === "select" && !out[f.name] && f.options?.length)
      out[f.name] =
        { status: f.options[0].value, priority: "normal", side: "buy", myRole: "preparer", role: "other", type: "other" }[f.name] ??
        f.options[0].value;
  if (table === "infoRequests" && !out.requestedOn) out.requestedOn = todayISO();
  if (table === "timeEntries" && !out.date) out.date = todayISO();
  return out;
}

function Editor({ entry }: { entry: Entry }) {
  const record = useRecord(entry.table, entry.id);
  const mode = entry.id ? "edit" : "create";
  if (entry.id && record === undefined) return null; // loading
  if (entry.id && record === null) return null; // deleted while open
  const fields = formDefs[entry.table];
  const formId = `form-${entry.key}`;
  const close = () => closeEditor(entry.key);
  const title = `${mode === "create" ? "New" : "Edit"} ${nouns[entry.table]}`;

  const save = async (values: FormValues) => {
    const patch = valuesToPatch(fields, values, mode) as never;
    const t = entry.table;
    if (mode === "create") {
      const res = await act(`${nouns[t][0].toUpperCase()}${nouns[t].slice(1)} added`, (ctx) => {
        if (t === "engagements") return createEngagement(ctx, patch, values.workstreams as string[]);
        if (t === "infoRequests") return createInfoRequest(ctx, patch);
        if (t === "followUps") return createFollowUp(ctx, patch);
        return create(ctx, t, patch);
      });
      if (res?.[0]) {
        entry.onCreated?.(res[0].record);
        close();
      }
    } else {
      // Completion timestamps (completedAt, finalAt, …) are stamped by core.
      const p = patch as Record<string, unknown>;
      const before = record as Record<string, unknown>;
      if (t === "alerts" && p.fireAt !== before.fireAt) p.fired = false;
      const res = await act("Saved", (ctx) => update(ctx, t, entry.id!, p as never));
      if (res) close();
    }
  };

  const initial = recordToValues(entry.table, (record ?? entry.defaults) as Record<string, unknown> | undefined);

  return (
    <Sheet
      open={entry.open}
      onClose={close}
      title={title}
      footer={
        <>
          {mode === "edit" && (
            <button
              className="btn btn-ghost text-rose-600"
              onClick={async () => {
                if (await act(`${nouns[entry.table]} deleted`, (ctx) => remove(ctx, entry.table, entry.id!))) close();
              }}
            >
              <Icon name="trash" size={16} /> Delete
            </button>
          )}
          <div className="flex-1" />
          <button className="btn btn-soft" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" form={formId}>
            {mode === "create" ? "Add" : "Save"}
          </button>
        </>
      }
    >
      <RecordForm key={record ? record.updatedAt : "new"} fields={fields} initial={initial} mode={mode} onSubmit={save} formId={formId} />
      {mode === "edit" && record && <Extras table={entry.table} record={record} />}
    </Sheet>
  );
}

// ---------- Per-type extras shown under the form ----------

function Extras({ table, record }: { table: TableName; record: AnyEntity }) {
  const remindable = table === "tasks" || table === "infoRequests" || table === "followUps" || table === "workpapers";
  return (
    <div className="mt-5 space-y-5">
      {table === "workpapers" && <ReviewChecklist wp={record as EntityMap["workpapers"]} />}
      {table === "workpapers" && <ReviewPointsPanel wp={record as EntityMap["workpapers"]} />}
      {table === "infoRequests" && <RfiDetails item={record as EntityMap["infoRequests"]} />}
      {table === "planItems" && <PlanDetails item={record as EntityMap["planItems"]} />}
      {(table === "infoRequests" || table === "followUps") && (
        <ChasePanel table={table} record={record as EntityMap["infoRequests"] | EntityMap["followUps"]} />
      )}
      {remindable && (
        <button
          className="btn btn-soft w-full"
          onClick={() => {
            const tomorrow9 = new Date();
            tomorrow9.setDate(tomorrow9.getDate() + 1);
            tomorrow9.setHours(9, 0, 0, 0);
            const r = record as unknown as Record<string, string>;
            openEditor({
              table: "alerts",
              defaults: { title: r.title ?? r.about ?? r.description, fireAt: tomorrow9.toISOString(), itemTable: table, itemId: record.id },
            });
          }}
        >
          <Icon name="bell" size={16} /> Remind me
        </button>
      )}
    </div>
  );
}

/** Where a work plan step sits and everything else the plan said about it. */
function PlanDetails({ item }: { item: EntityMap["planItems"] }) {
  const rows: { label: string; value: string; link?: string }[] = [
    ...(item.phase ? [{ label: "Phase", value: item.phase }] : []),
    ...(item.group ? [{ label: "Group", value: item.group }] : []),
    ...(item.lead ? [{ label: "Under", value: item.lead }] : []),
    ...(!item.applicable ? [{ label: "Applicability", value: "Not applicable" }] : []),
    ...(item.fields ?? []),
  ];
  if (!rows.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">From the work plan</h3>
      <dl className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] text-sm">
        {rows.map((f, i) => (
          <div key={i} className="flex gap-3 px-3 py-2">
            <dt className="w-36 shrink-0 muted">{f.label}</dt>
            <dd className="min-w-0 whitespace-pre-line break-words">
              {f.link ? (
                <a className="text-[var(--accent)] underline" href={f.link} target="_blank" rel="noopener noreferrer">
                  {f.value === f.link ? "Open link" : f.value} ↗
                </a>
              ) : (
                f.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Everything else the RFI said about this request, with the sheet's own column names. */
function RfiDetails({ item }: { item: EntityMap["infoRequests"] }) {
  const fields = item.fields ?? [];
  if (!fields.length && !item.subsection && !item.description.includes("\n")) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">From the RFI</h3>
      <dl className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] text-sm">
        {(item.section || item.subsection) && (
          <div className="flex gap-3 px-3 py-2">
            <dt className="w-36 shrink-0 muted">Section</dt>
            <dd className="min-w-0">{[item.section, item.subsection].filter(Boolean).join(" › ")}</dd>
          </div>
        )}
        {item.description.includes("\n") && (
          <div className="flex gap-3 px-3 py-2">
            <dt className="w-36 shrink-0 muted">Sub-points</dt>
            <dd className="min-w-0 whitespace-pre-line">{item.description.split("\n").slice(1).join("\n")}</dd>
          </div>
        )}
        {fields.map((f, i) => (
          <div key={i} className="flex gap-3 px-3 py-2">
            <dt className="w-36 shrink-0 muted">{f.label}</dt>
            <dd className="min-w-0 break-words">
              {f.link ? (
                <a className="text-[var(--accent)] underline" href={f.link} target="_blank" rel="noopener noreferrer">
                  {f.value === f.link ? "Open link" : f.value} ↗
                </a>
              ) : (
                f.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ChasePanel({ table, record }: { table: "infoRequests" | "followUps"; record: EntityMap["infoRequests"] | EntityMap["followUps"] }) {
  const isIrl = table === "infoRequests";
  const log = isIrl ? (record as EntityMap["infoRequests"]).chaseLog : (record as EntityMap["followUps"]).nudgeLog;
  const next = isIrl ? (record as EntityMap["infoRequests"]).nextChaseOn : (record as EntityMap["followUps"]).nextNudgeOn;
  return (
    <div className="rounded-2xl bg-[var(--surface-2)] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Chased {log.length}×</p>
          <p className="text-xs muted">{next ? `Next chase ${next}` : "No chase scheduled"}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => act("Chase logged", (ctx) => logChase(ctx, table, record.id))}>
          <Icon name="send" size={14} /> Chased today
        </button>
      </div>
      {log.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {log.map((d, i) => (
            <Pill key={i}>{d}</Pill>
          ))}
        </div>
      )}
    </div>
  );
}
