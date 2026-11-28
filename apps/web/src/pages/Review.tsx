import { useState } from "react";
import { ME, cellHas, labels, liveEngagementIds, peopleIndex, planReviewQueue, wpStatuses, type WorkPaper } from "@falcon/core";
import { openEditor } from "../components/Editor";
import { openWorkpaperForm } from "../components/WorkpaperForm";
import { Icon } from "../components/Icon";
import { StepRow } from "../components/WorkPlan";
import { WorkpaperRow, useLookups } from "../components/rows";
import { AnimatedList, EmptyState, Segmented } from "../components/ui";
import { useSettings, useSnapshot } from "../lib/hooks";

export function ReviewPage() {
  const snap = useSnapshot();
  const settings = useSettings();
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
  // Work plan steps waiting for my review, grouped by engagement.
  const ix = peopleIndex(snap.people, settings);
  const steps = planReviewQueue(snap.planItems, snap.engagements, live, settings.myName, (cell) => cellHas(cell, ME, ix)).sort((a, b) => a.order - b.order);
  const stepGroups = snap.engagements
    .map((e) => ({ e, items: steps.filter((s) => s.engagementId === e.id) }))
    .filter((g) => g.items.length);
  const showSteps = role === "reviewer" && stepGroups.length > 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Work papers</h1>
          <p className="text-sm muted">
            {waiting} waiting for my review{steps.length ? ` · ${steps.length} work plan step${steps.length === 1 ? "" : "s"} pending review` : ""} · {toFix} of mine with points to fix
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => openWorkpaperForm()}>
          <Icon name="plus" size={16} /> Work paper
        </button>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented id="review-role" value={role} onChange={setRole} options={[{ value: "reviewer", label: "I review" }, { value: "preparer", label: "I prepare" }]} />
        <button className="btn btn-ghost btn-sm" onClick={() => setShowFinal(!showFinal)}>
          {showFinal ? "Hide final" : "Show final"}
        </button>
      </div>
      {showSteps &&
        stepGroups.map((g) => (
          <div key={g.e.id} className="space-y-1.5">
            <p className="px-1 text-sm font-semibold">
              Work plan · pending review <span className="font-normal muted">· {g.e.name} · {g.items.length}</span>
            </p>
            <div className="card divide-y divide-[var(--border)]">
              {g.items.map((s) => (
                <StepRow key={s.id} item={s} hasReview={!!g.e.planInfo?.hasReview} context={s.area} />
              ))}
            </div>
          </div>
        ))}
      {groups.length === 0 && !showSteps ? (
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
