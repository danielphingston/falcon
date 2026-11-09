import type { ReactNode } from "react";
import {
  daysBetween,
  labels,
  logChase,
  relativeDay,
  setTaskDone,
  update,
  type Engagement,
  type FollowUp,
  type InfoRequest,
  type Person,
  type ReviewPoint,
  type Task,
  type WorkPaper,
} from "@falcon/core";
import { act } from "../lib/act";
import { byId, useTable, useToday } from "../lib/hooks";
import { openEditor } from "./Editor";
import { Icon } from "./Icon";
import { Checkbox, ListItem, Pill, statusTone } from "./ui";

export function useLookups() {
  const people = byId(useTable("people"));
  const engagements = byId(useTable("engagements"));
  const workpapers = byId(useTable("workpapers"));
  return { people, engagements, workpapers };
}
type Lookups = ReturnType<typeof useLookups>;

function Due({ due, done, time }: { due?: string; done?: boolean; time?: string }) {
  const today = useToday();
  if (!due) return null;
  const late = !done && due < today;
  const isToday = due === today;
  return (
    <span className={`inline-flex items-center gap-1 ${late ? "font-semibold text-rose-600" : isToday ? "font-semibold text-amber-600" : ""}`}>
      <Icon name={time ? "calendar" : "clock"} size={12} />
      {relativeDay(due, today)}
      {time && ` ${time}`}
    </span>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs muted">{children}</div>;
}

const engName = (l: Lookups, id?: string) => (id ? l.engagements.get(id)?.name : undefined);
const personName = (l: Lookups, id?: string) => (id ? l.people.get(id)?.name : undefined);

export function TaskRow({ task, l, hideEngagement }: { task: Task; l: Lookups; hideEngagement?: boolean }) {
  const done = task.status === "done";
  return (
    <ListItem id={task.id} onClick={() => openEditor({ table: "tasks", id: task.id })}>
      <Checkbox checked={done} onChange={(on) => act(on ? "Task done" : "Task reopened", (ctx) => setTaskDone(ctx, task.id, on))} />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[15px] ${done ? "line-through muted" : ""}`}>
          {task.priority === "high" && !done && <Icon name="flag" size={13} className="mr-1 inline text-rose-500" />}
          {task.title}
        </p>
        <Meta>
          {!hideEngagement && engName(l, task.engagementId) && <span>{engName(l, task.engagementId)}</span>}
          {task.assigneeId && <span>→ {personName(l, task.assigneeId)}</span>}
          <Due due={task.due} done={done} time={task.dueTime} />
        </Meta>
      </div>
      {task.status === "in_progress" && <Pill tone="blue">In progress</Pill>}
    </ListItem>
  );
}

export function WorkpaperRow({ wp, l, openPoints, hideEngagement }: { wp: WorkPaper; l: Lookups; openPoints?: number; hideEngagement?: boolean }) {
  const done = wp.status === "final";
  return (
    <ListItem id={wp.id} onClick={() => openEditor({ table: "workpapers", id: wp.id })}>
      <span className="grid h-9 min-w-11 shrink-0 place-items-center rounded-lg bg-[var(--surface-2)] px-1.5 font-mono text-xs font-semibold">{wp.ref}</span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[15px] ${done ? "muted" : ""}`}>{wp.title}</p>
        <Meta>
          {!hideEngagement && <span>{engName(l, wp.engagementId)}</span>}
          <span>{wp.myRole === "reviewer" ? `I review${wp.preparerId ? ` · by ${personName(l, wp.preparerId)}` : ""}` : `I prepare${wp.reviewerId ? ` · rev. ${personName(l, wp.reviewerId)}` : ""}`}</span>
          {!!openPoints && <span className="font-semibold text-amber-600">{openPoints} open point{openPoints > 1 ? "s" : ""}</span>}
          <Due due={wp.due} done={done || wp.status === "cleared"} />
        </Meta>
      </div>
      <select
        className="rounded-lg border border-transparent bg-transparent py-1 text-right text-xs font-semibold outline-none hover:border-[var(--border)]"
        value={wp.status}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => act(`${wp.ref} → ${labels.wpStatus[e.target.value as WorkPaper["status"]]}`, (ctx) => update(ctx, "workpapers", wp.id, { status: e.target.value as WorkPaper["status"] }))}
        aria-label="Work paper status"
      >
        {Object.entries(labels.wpStatus).map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </ListItem>
  );
}

export function IrlRow({ item, l, today, hideEngagement }: { item: InfoRequest; l: Lookups; today: string; hideEngagement?: boolean }) {
  const open = item.status === "pending" || item.status === "partial";
  const chaseDue = open && item.nextChaseOn && item.nextChaseOn <= today;
  return (
    <ListItem id={item.id} onClick={() => openEditor({ table: "infoRequests", id: item.id })}>
      <Checkbox
        checked={!open}
        label="Mark received"
        onChange={(on) => act(on ? "Marked received" : "Reopened", (ctx) => update(ctx, "infoRequests", item.id, { status: on ? "received" : "pending" }))}
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[15px] ${!open ? "line-through muted" : ""}`}>
          {item.number && <span className="mr-1.5 font-mono text-xs muted">#{item.number}</span>}
          {item.description}
        </p>
        <Meta>
          {!hideEngagement && <span>{engName(l, item.engagementId)}</span>}
          {item.requestedFromId && <span>from {personName(l, item.requestedFromId)}</span>}
          {open && <span>{daysBetween(item.requestedOn, today)}d waiting</span>}
          {item.chaseLog.length > 0 && <span>chased {item.chaseLog.length}×</span>}
          <Due due={item.due} done={!open} />
        </Meta>
      </div>
      {item.status === "partial" && <Pill tone="blue">Partial</Pill>}
      {chaseDue && <ChaseButton onClick={() => act("Chase logged", (ctx) => logChase(ctx, "infoRequests", item.id))} />}
    </ListItem>
  );
}

export function FollowUpRow({ f, l, today }: { f: FollowUp; l: Lookups; today: string }) {
  const done = f.status === "done";
  const chaseDue = !done && f.nextNudgeOn && f.nextNudgeOn <= today;
  return (
    <ListItem id={f.id} onClick={() => openEditor({ table: "followUps", id: f.id })}>
      <Checkbox checked={done} label="Mark received" onChange={(on) => act(on ? "Follow-up closed" : "Reopened", (ctx) => update(ctx, "followUps", f.id, { status: on ? "done" : "waiting" }))} />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[15px] ${done ? "line-through muted" : ""}`}>{f.about}</p>
        <Meta>
          {f.personId && <span>{personName(l, f.personId)}</span>}
          {engName(l, f.engagementId) && <span>{engName(l, f.engagementId)}</span>}
          {!done && <span>{daysBetween(f.createdAt.slice(0, 10), today)}d waiting</span>}
          {f.nudgeLog.length > 0 && <span>nudged {f.nudgeLog.length}×</span>}
          <Due due={f.due} done={done} />
        </Meta>
      </div>
      {chaseDue && <ChaseButton onClick={() => act("Nudge logged", (ctx) => logChase(ctx, "followUps", f.id))} />}
    </ListItem>
  );
}

export function ReviewPointRow({ p, l }: { p: ReviewPoint; l: Lookups }) {
  const wp = l.workpapers.get(p.workpaperId);
  const cleared = p.status === "cleared";
  return (
    <ListItem id={p.id} onClick={() => openEditor({ table: "workpapers", id: p.workpaperId })}>
      <Checkbox
        checked={cleared}
        label="Clear review point"
        onChange={(on) => act(on ? "Point cleared" : "Point reopened", (ctx) => update(ctx, "reviewPoints", p.id, { status: on ? "cleared" : "open", clearedAt: on ? new Date().toISOString() : null }))}
      />
      <div className="min-w-0 flex-1">
        <p className={`line-clamp-2 text-[15px] ${cleared ? "line-through muted" : ""}`}>{p.text}</p>
        <Meta>
          {wp && (
            <span>
              {wp.ref} {wp.title}
            </span>
          )}
          {p.raisedById && <span>by {personName(l, p.raisedById)}</span>}
        </Meta>
      </div>
      <Pill tone={statusTone[p.status]}>{labels.reviewPointStatus[p.status]}</Pill>
    </ListItem>
  );
}

function ChaseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="btn btn-soft btn-sm shrink-0 text-brand-700 dark:text-brand-200"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon name="send" size={13} /> Chased
    </button>
  );
}

export const personLabel = (p?: Person | null) => (p ? `${p.name}${p.org ? ` · ${p.org}` : ""}` : "Unassigned");
export const engagementSort = (a: Engagement, b: Engagement) =>
  Number(a.status === "closed") - Number(b.status === "closed") || a.name.localeCompare(b.name);
