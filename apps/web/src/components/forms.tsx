import { useMemo, useState, type ReactNode } from "react";
import {
  defaultWorkstreams,
  engagementStatuses,
  followUpTypes,
  irlStatuses,
  labels,
  personRoles,
  priorities,
  reviewPointStatuses,
  taskStatuses,
  wpStatuses,
  type TableName,
} from "@fdd/core";
import { useTable } from "../lib/hooks";

export type FieldType = "text" | "textarea" | "date" | "time" | "minutes" | "datetime" | "select" | "person" | "people" | "engagement" | "workstream" | "toggles" | "hours" | "task";

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  /** For "person": which roles to offer first. */
  roles?: string[];
  /** Hide in edit mode (e.g. workstreams picked only on create). */
  createOnly?: boolean;
  half?: boolean;
  /** For "text": suggestions offered as you type. */
  suggest?: string[];
}

export const ASSIGNMENT_TYPES = ["Due Diligence", "Transaction Support", "Stat Audit", "Internal Audit", "Tax Audit", "ITR", "Valuation", "Advisory"];

const opts = <K extends string>(values: readonly K[], map: Record<K, string>) =>
  values.map((v) => ({ value: v, label: map[v] }));

export const formDefs: Record<TableName, FieldDef[]> = {
  tasks: [
    { name: "title", label: "Task", type: "text", required: true, placeholder: "e.g. Draft QoE adjustments" },
    { name: "engagementId", label: "Engagement", type: "engagement" },
    { name: "due", label: "Due", type: "date", half: true },
    { name: "priority", label: "Priority", type: "select", options: opts(priorities, { low: "Low", normal: "Normal", high: "High" }), half: true },
    { name: "dueTime", label: "Time (adds to calendar)", type: "time", half: true },
    { name: "durationMinutes", label: "Length (min)", type: "minutes", placeholder: "30", half: true },
    { name: "status", label: "Status", type: "select", options: opts(taskStatuses, labels.taskStatus), half: true },
    { name: "assigneeId", label: "Assigned to", type: "person", roles: ["team"], half: true },
    { name: "notes", label: "Notes", type: "textarea" },
  ],
  engagements: [
    { name: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Project Falcon" },
    { name: "type", label: "Type", type: "text", placeholder: "e.g. Due Diligence", suggest: ASSIGNMENT_TYPES, half: true },
    { name: "status", label: "Status", type: "select", options: opts(engagementStatuses, labels.engagementStatus), half: true },
    { name: "client", label: "Target / client", type: "text", placeholder: "Optional; code names are safer" },
    { name: "leadId", label: "Lead", type: "person", roles: ["team", "manager"], half: true },
    { name: "side", label: "Side (DD)", type: "select", options: [{ value: "buy", label: "Buy-side" }, { value: "sell", label: "Sell-side" }, { value: "other", label: "Other / n.a." }], half: true },
    { name: "team", label: "Team", type: "people", roles: ["team"] },
    { name: "workstreams", label: "Workstreams", type: "toggles", options: [...defaultWorkstreams, "Payroll", "Commercial"].map((w) => ({ value: w, label: w })), createOnly: true },
    { name: "kickoff", label: "Kick-off", type: "date", half: true },
    { name: "dataRoom", label: "Data room opens", type: "date", half: true },
    { name: "draftReport", label: "Draft report", type: "date", half: true },
    { name: "finalReport", label: "Final report", type: "date", half: true },
    { name: "timesheetCode", label: "Timesheet code", type: "text" },
    { name: "notes", label: "Notes", type: "textarea" },
  ],
  workstreams: [
    { name: "name", label: "Workstream", type: "text", required: true },
    { name: "ownerId", label: "Owner", type: "person", roles: ["team", "manager"] },
  ],
  workpapers: [
    { name: "ref", label: "WP ref", type: "text", required: true, placeholder: "B.2", half: true },
    { name: "myRole", label: "My role", type: "select", options: [{ value: "preparer", label: "I prepare" }, { value: "reviewer", label: "I review" }], half: true },
    { name: "title", label: "Title", type: "text", required: true, placeholder: "e.g. NWC analysis" },
    { name: "engagementId", label: "Engagement", type: "engagement", required: true },
    { name: "workstreamId", label: "Workstream", type: "workstream", half: true },
    { name: "status", label: "Status", type: "select", options: opts(wpStatuses, labels.wpStatus), half: true },
    { name: "preparerId", label: "Preparer", type: "person", roles: ["team"], half: true },
    { name: "reviewerId", label: "Reviewer", type: "person", roles: ["manager", "partner"], half: true },
    { name: "due", label: "Due", type: "date", half: true },
    { name: "notes", label: "Notes", type: "textarea" },
  ],
  reviewPoints: [
    { name: "text", label: "Review point", type: "textarea", required: true },
    { name: "status", label: "Status", type: "select", options: opts(reviewPointStatuses, labels.reviewPointStatus), half: true },
    { name: "assignedToId", label: "To address", type: "person", roles: ["team"], half: true },
    { name: "raisedById", label: "Raised by", type: "person", roles: ["manager", "partner"] },
  ],
  infoRequests: [
    { name: "number", label: "IRL #", type: "text", placeholder: "12", half: true },
    { name: "status", label: "Status", type: "select", options: opts(irlStatuses, labels.irlStatus), half: true },
    { name: "description", label: "Item requested", type: "textarea", required: true },
    { name: "engagementId", label: "Engagement", type: "engagement", required: true },
    { name: "requestedFromId", label: "Requested from", type: "person", roles: ["client"] },
    { name: "requestedOn", label: "Requested on", type: "date", required: true, half: true },
    { name: "due", label: "Due", type: "date", half: true },
    { name: "nextChaseOn", label: "Next chase", type: "date", half: true },
    { name: "notes", label: "Notes", type: "textarea" },
  ],
  followUps: [
    { name: "about", label: "Waiting for", type: "text", required: true, placeholder: "e.g. Sign-off on NWC adjustments" },
    { name: "personId", label: "From", type: "person", half: true },
    { name: "type", label: "Type", type: "select", options: opts(followUpTypes, labels.followUpType), half: true },
    { name: "engagementId", label: "Engagement", type: "engagement" },
    { name: "due", label: "Needed by", type: "date", half: true },
    { name: "nextNudgeOn", label: "Next nudge", type: "date", half: true },
    { name: "status", label: "Status", type: "select", options: [{ value: "waiting", label: "Waiting" }, { value: "done", label: "Done" }] },
    { name: "notes", label: "Notes", type: "textarea" },
  ],
  people: [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "role", label: "Role", type: "select", options: opts(personRoles, labels.personRole), half: true },
    { name: "designation", label: "Designation", type: "text", placeholder: "e.g. Article, Senior", suggest: ["Article", "Associate", "Senior", "Assistant Manager", "Manager", "Team Lead"], half: true },
    { name: "org", label: "Organisation", type: "text", half: true },
    { name: "email", label: "Email", type: "text", half: true },
    { name: "phone", label: "Phone", type: "text", half: true },
    { name: "notes", label: "Notes", type: "textarea" },
  ],
  alerts: [
    { name: "title", label: "Remind me to", type: "text", required: true },
    { name: "fireAt", label: "When", type: "datetime", required: true },
  ],
  timeEntries: [
    { name: "minutes", label: "Hours", type: "hours", required: true, half: true },
    { name: "date", label: "Date", type: "date", required: true, half: true },
    { name: "engagementId", label: "Engagement", type: "engagement" },
    { name: "taskId", label: "Task", type: "task" },
    { name: "note", label: "Note", type: "text", placeholder: "What you worked on" },
  ],
  days: [],
  achievements: [],
};

export type FormValues = Record<string, string | string[]>;

/** ISO timestamp → value for <input type="datetime-local">. */
export const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function RecordForm({
  fields,
  initial,
  mode,
  onSubmit,
  children,
  formId,
}: {
  fields: FieldDef[];
  initial: FormValues;
  mode: "create" | "edit";
  onSubmit: (values: FormValues) => void;
  children?: ReactNode;
  formId: string;
}) {
  const [values, setValues] = useState<FormValues>(initial);
  const set = (name: string, v: string | string[]) => setValues((s) => ({ ...s, [name]: v }));
  const people = useTable("people");
  const engagements = useTable("engagements");
  const workstreams = useTable("workstreams");
  const tasks = useTable("tasks");
  const visible = fields.filter((f) => !(f.createOnly && mode === "edit"));

  const wsOptions = useMemo(
    () => (workstreams ?? []).filter((w) => w.engagementId === values.engagementId),
    [workstreams, values.engagementId],
  );

  const control = (f: FieldDef) => {
    const v = (values[f.name] as string) ?? "";
    const common = { id: `${formId}-${f.name}`, className: "input", required: f.required };
    switch (f.type) {
      case "textarea":
        return <textarea {...common} rows={3} value={v} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />;
      case "date":
        return <input {...common} type="date" value={v} onChange={(e) => set(f.name, e.target.value)} />;
      case "time":
        return <input {...common} type="time" step={300} value={v} onChange={(e) => set(f.name, e.target.value)} />;
      case "minutes":
        return <input {...common} type="number" min={5} max={1440} step={5} inputMode="numeric" value={v} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />;
      case "people": {
        const selected = (values[f.name] as string[]) ?? [];
        const list = [...(people ?? [])].sort(
          (a, b) => Number(!f.roles?.includes(a.role)) - Number(!f.roles?.includes(b.role)) || a.name.localeCompare(b.name),
        );
        return (
          <div className="flex flex-wrap gap-1.5">
            {list.map((p) => {
              const on = selected.includes(p.id);
              return (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => set(f.name, on ? selected.filter((s) => s !== p.id) : [...selected, p.id])}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-indigo-950 dark:text-indigo-200" : "border-[var(--border)]"}`}
                >
                  {on && "✓ "}
                  {p.name}
                </button>
              );
            })}
            {!list.length && <span className="text-xs muted">Add people first (People page), or import your team sheet.</span>}
          </div>
        );
      }
      case "hours":
        return <input {...common} type="number" min={0.05} max={24} step={0.05} inputMode="decimal" value={v} placeholder="1.5" onChange={(e) => set(f.name, e.target.value)} />;
      case "task":
        return (
          <select {...common} value={v} onChange={(e) => set(f.name, e.target.value)}>
            <option value="">None</option>
            {(tasks ?? [])
              .filter((t) => (t.status !== "done" || t.id === v) && (!values.engagementId || t.engagementId === values.engagementId))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        );
      case "datetime":
        return <input {...common} type="datetime-local" value={v} onChange={(e) => set(f.name, e.target.value)} />;
      case "select":
        return (
          <select {...common} value={v} onChange={(e) => set(f.name, e.target.value)}>
            {f.options!.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case "engagement":
        return (
          <select {...common} value={v} onChange={(e) => set(f.name, e.target.value)}>
            <option value="">{f.required ? "Choose…" : "None"}</option>
            {(engagements ?? [])
              .filter((e) => e.status !== "closed" || e.id === v)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        );
      case "workstream":
        return (
          <select {...common} value={v} onChange={(e) => set(f.name, e.target.value)}>
            <option value="">None</option>
            {wsOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        );
      case "person": {
        const list = [...(people ?? [])].sort(
          (a, b) => Number(!f.roles?.includes(a.role)) - Number(!f.roles?.includes(b.role)) || a.name.localeCompare(b.name),
        );
        return (
          <select {...common} value={v} onChange={(e) => set(f.name, e.target.value)}>
            <option value="">{f.name === "personId" || f.name === "requestedFromId" ? "Nobody yet" : "Me"}</option>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {labels.personRole[p.role]}
              </option>
            ))}
          </select>
        );
      }
      case "toggles": {
        const selected = (values[f.name] as string[]) ?? [];
        return (
          <div className="flex flex-wrap gap-2">
            {f.options!.map((o) => {
              const on = selected.includes(o.value);
              return (
                <button
                  type="button"
                  key={o.value}
                  onClick={() => set(f.name, on ? selected.filter((s) => s !== o.value) : [...selected, o.value])}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    on ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-indigo-950 dark:text-indigo-200" : "border-[var(--border)]"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        );
      }
      default:
        return (
          <>
            <input {...common} type="text" value={v} placeholder={f.placeholder} list={f.suggest ? `${formId}-${f.name}-list` : undefined} autoFocus={f === visible[0] && mode === "create"} onChange={(e) => set(f.name, e.target.value)} />
            {f.suggest && (
              <datalist id={`${formId}-${f.name}-list`}>
                {f.suggest.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </>
        );
    }
  };

  return (
    <form
      id={formId}
      className="grid grid-cols-2 gap-x-3 gap-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      {visible.map((f) => (
        <label key={f.name} htmlFor={`${formId}-${f.name}`} className={`flex flex-col gap-1 ${f.half ? "col-span-1" : "col-span-2"}`}>
          <span className="text-xs font-medium muted">{f.label}</span>
          {control(f)}
        </label>
      ))}
      {children && <div className="col-span-2">{children}</div>}
    </form>
  );
}

/**
 * Turns form values into a record patch. Empty strings become `undefined` on
 * create and `null` (clear) on edit. datetime-local values become ISO.
 */
export function valuesToPatch(fields: FieldDef[], values: FormValues, mode: "create" | "edit") {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "toggles") continue;
    const raw = values[f.name];
    if (raw === undefined) continue;
    if (f.type === "people") {
      out[f.name] = raw;
      continue;
    }
    if (raw === "") {
      if (mode === "edit") out[f.name] = null;
      continue;
    }
    out[f.name] =
      f.type === "datetime"
        ? new Date(raw as string).toISOString()
        : f.type === "hours"
          ? Math.max(1, Math.round(Number(raw) * 60))
          : f.type === "minutes"
            ? Math.min(1440, Math.max(5, Math.round(Number(raw))))
            : f.type === "time"
              ? (raw as string).slice(0, 5)
              : raw;
  }
  return out;
}
