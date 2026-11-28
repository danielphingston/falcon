/**
 * A step's procedures (build brief v2 A6): an optional checklist under the
 * step, each with a "why" and a done tick. "Checks for next time" from a
 * guided review land here too, so the next workpaper for the step gets them.
 */
import { useState } from "react";
import { newId, update, type PlanItem, type StepProcedure } from "@falcon/core";
import { act } from "../lib/act";
import { Icon } from "./Icon";

export function ProceduresPanel({ step }: { step: PlanItem }) {
  const list = step.procedures ?? [];
  const [text, setText] = useState("");
  const [why, setWhy] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const save = (procedures: StepProcedure[], msg: string | null) => act(msg, (ctx) => update(ctx, "planItems", step.id, { procedures: procedures.length ? procedures : null }));
  const add = async () => {
    if (!text.trim()) return;
    if (await save([...list, { id: newId(), text: text.trim(), why: why.trim() || undefined, done: false }], "Procedure added")) {
      setText("");
      setWhy("");
    }
  };
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        Procedures{" "}
        {list.length > 0 && (
          <span className="font-normal muted">
            {list.filter((p) => p.done).length}/{list.length} done
          </span>
        )}
      </h3>
      {list.length > 0 && (
        <ol className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          {list.map((p, i) => (
            <li key={p.id} className="px-3 py-2 text-sm">
              <div className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={p.done} aria-label="Done" onChange={(e) => void save(list.map((x) => (x.id === p.id ? { ...x, done: e.target.checked } : x)), null)} />
                <button className={`min-w-0 flex-1 text-left ${p.done ? "line-through muted" : ""}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <span className="mr-1.5 text-xs muted">{i + 1}.</span>
                  {p.text.split("\n")[0]}
                  {p.why && <span className="block text-xs muted">Why: {p.why}</span>}
                </button>
                <button className="muted" aria-label="Remove procedure" onClick={() => void save(list.filter((x) => x.id !== p.id), "Procedure removed")}>
                  <Icon name="x" size={14} />
                </button>
              </div>
              {open === p.id && p.text.includes("\n") && <p className="mt-1 whitespace-pre-line pl-6 text-xs muted">{p.text.split("\n").slice(1).join("\n")}</p>}
            </li>
          ))}
        </ol>
      )}
      <div className="grid gap-2 sm:grid-cols-[2fr_1.5fr_auto]">
        <input className="input" placeholder="Procedure, e.g. Agree billing register to BoA monthly" value={text} onChange={(e) => setText(e.target.value)} aria-label="New procedure" />
        <input className="input" placeholder="Why (optional)" value={why} onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} aria-label="Why" />
        <button className="btn btn-soft" disabled={!text.trim()} onClick={() => void add()}>
          Add
        </button>
      </div>
    </div>
  );
}
