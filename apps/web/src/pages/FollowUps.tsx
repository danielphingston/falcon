import { useState } from "react";
import { liveEngagementIds, type FollowUp, type InfoRequest } from "@fdd/core";
import { openEditor } from "../components/Editor";
import { Icon } from "../components/Icon";
import { FollowUpRow, IrlRow, personLabel, useLookups } from "../components/rows";
import { AnimatedList, EmptyState, Segmented } from "../components/ui";
import { useSnapshot, useToday } from "../lib/hooks";

type Kind = "all" | "client" | "manager" | "team";

/** "Waiting on" inbox: every open IRL item and follow-up, grouped by person. */
export function FollowUpsPage() {
  const snap = useSnapshot();
  const today = useToday();
  const l = useLookups();
  const [kind, setKind] = useState<Kind>("all");
  if (!snap) return null;

  const live = liveEngagementIds(snap.engagements);
  const inLive = (eid?: string) => !eid || live.has(eid);
  const roleOf = (pid?: string) => (pid ? snap.people.find((p) => p.id === pid)?.role : undefined);
  const matches = (type: string) => kind === "all" || type === kind || (kind === "manager" && type === "partner");

  const groups = new Map<string, { irl: InfoRequest[]; fu: FollowUp[]; oldest: string }>();
  const add = (pid: string | undefined, since: string, push: (g: { irl: InfoRequest[]; fu: FollowUp[] }) => void) => {
    const k = pid ?? "";
    const g = groups.get(k) ?? { irl: [], fu: [], oldest: since };
    push(g);
    if (since < g.oldest) g.oldest = since;
    groups.set(k, g);
  };
  for (const r of snap.infoRequests)
    if ((r.status === "pending" || r.status === "partial") && inLive(r.engagementId) && matches("client"))
      add(r.requestedFromId, r.requestedOn, (g) => g.irl.push(r));
  for (const f of snap.followUps)
    if (f.status === "waiting" && inLive(f.engagementId) && matches(f.type === "other" ? (roleOf(f.personId) ?? "other") : f.type))
      add(f.personId, f.createdAt.slice(0, 10), (g) => g.fu.push(f));

  const sorted = [...groups.entries()].sort((a, b) => a[1].oldest.localeCompare(b[1].oldest));
  const total = sorted.reduce((s, [, g]) => s + g.irl.length + g.fu.length, 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Waiting on</h1>
          <p className="text-sm muted">
            {total} open item{total === 1 ? "" : "s"} across {sorted.length} {sorted.length === 1 ? "person" : "people"}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => openEditor({ table: "followUps" })}>
          <Icon name="plus" size={16} /> Follow-up
        </button>
      </header>
      <Segmented
        id="fu-kind"
        value={kind}
        onChange={setKind}
        options={[
          { value: "all", label: "All" },
          { value: "client", label: "Clients" },
          { value: "manager", label: "Managers" },
          { value: "team", label: "Team" },
        ]}
      />
      {sorted.length === 0 ? (
        <EmptyState icon="inbox" title="Not waiting on anyone" hint="Open IRL items and follow-ups show up here, longest-waiting first." />
      ) : (
        sorted.map(([pid, g]) => {
          const person = pid ? l.people.get(pid) : undefined;
          return (
            <div key={pid || "none"} className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <p className="text-sm font-semibold">
                  {personLabel(person)} <span className="font-normal muted">· {g.irl.length + g.fu.length}</span>
                </p>
                {person?.email && (
                  <a className="btn btn-ghost btn-sm" href={`mailto:${person.email}`}>
                    <Icon name="mail" size={14} />
                  </a>
                )}
              </div>
              <AnimatedList>
                {g.fu.map((f) => (
                  <FollowUpRow key={f.id} f={f} l={l} today={today} />
                ))}
                {g.irl.map((r) => (
                  <IrlRow key={r.id} item={r} l={l} today={today} />
                ))}
              </AnimatedList>
            </div>
          );
        })
      )}
    </div>
  );
}
