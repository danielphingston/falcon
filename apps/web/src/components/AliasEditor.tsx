import { useState } from "react";
import { Icon } from "./Icon";

/**
 * The other ways a person is written in sheets ("JK", "SaiTeja"): chips with ×
 * and a field to add one. Used on a person and, for you, in Settings.
 */
export function AliasEditor({ aliases, onChange, hint }: { aliases: string[]; onChange: (next: string[]) => void; hint?: string }) {
  const [text, setText] = useState("");
  const add = () => {
    const v = text.trim();
    if (!v) return;
    onChange([...new Set([...aliases, v])]);
    setText("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {aliases.length === 0 && <span className="text-xs muted">None yet</span>}
        {aliases.map((a) => (
          <span key={a} className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-sm">
            {a}
            <button aria-label={`Remove ${a}`} className="muted" onClick={() => onChange(aliases.filter((x) => x !== a))}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="input py-1 text-sm" placeholder="e.g. JK, SaiTeja" value={text} onChange={(e) => setText(e.target.value)} aria-label="Add another name" />
        <button className="btn btn-soft btn-sm shrink-0" type="submit">
          Add
        </button>
      </form>
      {hint && <p className="text-xs muted">{hint}</p>}
    </div>
  );
}
