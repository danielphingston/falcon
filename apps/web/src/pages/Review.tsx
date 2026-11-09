import { useState } from "react";
import { labels, liveEngagementIds, wpStatuses, type WorkPaper } from "@falcon/core";
import { openEditor } from "../components/Editor";
import { Icon } from "../components/Icon";
import { WorkpaperRow, useLookups } from "../components/rows";
import { AnimatedList, EmptyState, Segmented } from "../components/ui";
import { useSnapshot } from "../lib/hooks";

export function ReviewPage() {
  const snap = useSnapshot();
  const l = useLookups();
  const [role, setRole] = useState<"reviewer" | "preparer">("reviewer");
  const [showFinal, setShowFinal] = useState(false);
  if (!snap) return null;

  const live = liveEngagementIds(snap.engagements);
  const wps = snap.workpapers.filter((w) => w.myRole === role && live.has(w.engagementId) && (showFinal || w.status !== "final"));
  const openPoints = (id: string) => snap.reviewPoints.filter((p) => p.workpaperId === id && p.status !== "cleared").length;
  // Most urgent statuses first for each role.
  const order: WorkPaper["status"][] =
    role === "reviewer"
      ? ["prepared", "in_review", "points_raised", "in_progress", "not_started", "cleared", "final"]
      : ["points_raised", "in_progress", "not_started", "prepared", "in_review", "cleared", "final"];
  const groups = order.filter((s) => wpStatuses.includes(s)).map((s) => ({ status: s, items: wps.filter((w) => w.status === s) })).filter((g) => g.items.length);
  const waiting = snap.workpapers.filter((w) => w.myRole === "reviewer" && live.has(w.engagementId) && (w.status === "prepared" || w.status === "in_review")).length;
  const toFix = snap.workpapers.filter((w) => w.myRole === "preparer" && live.has(w.engagementId) && w.status === "points_raised").length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Work papers</h1>
          <p className="text-sm muted">
            {waiting} waiting for my review · {toFix} of mine with points to fix
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => openEditor({ table: "workpapers", defaults: { myRole: role } })}>
          <Icon name="plus" size={16} /> Work paper
        </button>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented id="review-role" value={role} onChange={setRole} options={[{ value: "reviewer", label: "I review" }, { value: "preparer", label: "I prepare" }]} />
        <button className="btn btn-ghost btn-sm" onClick={() => setShowFinal(!showFinal)}>
          {showFinal ? "Hide final" : "Show final"}
        </button>
      </div>
      {groups.length === 0 ? (
        <EmptyState
          icon="review"
          title={role === "reviewer" ? "Nothing to review" : "No work papers of yours"}
          hint="Add work papers from an engagement, or here. Review points live inside each WP."
        />
      ) : (
        groups.map((g) => (
          <div key={g.status} className="space-y-1.5">
            <p className="px-1 text-sm font-semibold">
              {labels.wpStatus[g.status]} <span className="font-normal muted">· {g.items.length}</span>
            </p>
            <AnimatedList>
              {g.items.map((w) => (
                <WorkpaperRow key={w.id} wp={w} l={l} openPoints={openPoints(w.id)} />
              ))}
            </AnimatedList>
          </div>
        ))
      )}
    </div>
  );
}
