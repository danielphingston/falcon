import { engagementsFor, labels, personRoles } from "@fdd/core";
import { openEditor } from "../components/Editor";
import { Icon } from "../components/Icon";
import { Avatar } from "../components/TeamAvatars";
import { AnimatedList, EmptyState, ListItem } from "../components/ui";
import { useSnapshot } from "../lib/hooks";

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
          <p className="text-sm muted">Your team, clients and managers</p>
        </div>
        <button className="btn btn-primary" onClick={() => openEditor({ table: "people" })}>
          <Icon name="plus" size={16} /> Person
        </button>
      </header>
      {snap.people.length === 0 && <EmptyState icon="users" title="No contacts yet" hint="Import your team allocation sheet from Engagements, or type @name in quick add." />}
      {personRoles.map((role) => {
        const list = snap.people.filter((p) => p.role === role).sort((a, b) => a.name.localeCompare(b.name));
        if (!list.length) return null;
        return (
          <div key={role} className="space-y-1.5">
            <p className="px-1 text-sm font-semibold">
              {labels.personRole[role]} <span className="font-normal muted">· {list.length}</span>
            </p>
            <AnimatedList>
              {list.map((p) => {
                const n = openCount(p.id);
                const on = engagementsFor(p, snap.engagements);
                return (
                  <ListItem key={p.id} id={p.id} onClick={() => openEditor({ table: "people", id: p.id })}>
                    <Avatar name={p.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px]">
                        {p.name}
                        {p.designation && <span className="text-xs muted"> · {p.designation}</span>}
                      </p>
                      <p className="truncate text-xs muted">
                        {on.length ? on.map((e) => e.name).join(", ") : [p.org, p.email].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      {on.length > 0 && <p className="font-semibold">{on.length} assignment{on.length > 1 ? "s" : ""}</p>}
                      {n > 0 && <p className="font-semibold text-amber-600">{n} open</p>}
                    </div>
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
