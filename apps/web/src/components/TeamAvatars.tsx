import type { Person } from "@fdd/core";

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function Avatar({ name, size = 28, ring }: { name: string; size?: number; ring?: boolean }) {
  return (
    <span
      title={name}
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${ring ? "ring-2 ring-amber-400" : "ring-2 ring-[var(--surface)]"}`}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue(name)} 55% 50%)` }}
    >
      {initials(name)}
    </span>
  );
}

/** Overlapping avatars for an engagement's lead (amber ring) and team. */
export function TeamAvatars({ ids, people, leadId, max = 6 }: { ids: string[]; people: Map<string, Person>; leadId?: string; max?: number }) {
  const list = ids.map((id) => people.get(id)).filter((p): p is Person => !!p);
  if (!list.length) return null;
  return (
    <div className="mt-3 flex items-center">
      <div className="flex -space-x-2">
        {list.slice(0, max).map((p) => (
          <Avatar key={p.id} name={p.name} ring={p.id === leadId} />
        ))}
      </div>
      {list.length > max && <span className="ml-2 text-xs muted">+{list.length - max}</span>}
      <span className="ml-2 truncate text-xs muted">{list.length === 1 ? list[0].name : `${list.length} people`}</span>
    </div>
  );
}
