import { labels, personRoles } from "@fdd/core";
import { openEditor } from "../components/Editor";
import { Icon } from "../components/Icon";
import { AnimatedList, EmptyState, ListItem } from "../components/ui";
import { useSnapshot } from "../lib/hooks";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function PeoplePage() {
  const snap = useSnapshot();
  if (!snap) return null;
  const openCount = (id: string) =>
    snap.infoRequests.filter((r) => r.requestedFromId === id && (r.status === "pending" || r.status === "partial")).length +
    snap.followUps.filter((f) => f.personId === id && f.status === "waiting").length +
    snap.tasks.filter((t) => t.assigneeId === id && t.status !== "done").length;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">People</h1>
          <p className="text-sm muted">Clients, managers and team you track follow-ups with</p>
        </div>
        <button className="btn btn-primary" onClick={() => openEditor({ table: "people" })}>
          <Icon name="plus" size={16} /> Person
        </button>
      </header>
      {snap.people.length === 0 && <EmptyState icon="users" title="No contacts yet" hint="People are added automatically when you type @name in quick add." />}
      {personRoles.map((role) => {
        const list = snap.people.filter((p) => p.role === role).sort((a, b) => a.name.localeCompare(b.name));
        if (!list.length) return null;
        return (
          <div key={role} className="space-y-1.5">
            <p className="px-1 text-sm font-semibold">{labels.personRole[role]}</p>
            <AnimatedList>
              {list.map((p) => {
                const n = openCount(p.id);
                return (
                  <ListItem key={p.id} id={p.id} onClick={() => openEditor({ table: "people", id: p.id })}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: `hsl(${hue(p.name)} 55% 50%)` }}>
                      {initials(p.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px]">{p.name}</p>
                      <p className="truncate text-xs muted">{[p.org, p.email].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                    {n > 0 && <span className="text-xs font-semibold text-amber-600">{n} open</span>}
                  </ListItem>
                );
              })}
            </AnimatedList>
          </div>
        );
      })}
    </div>
  );
}
