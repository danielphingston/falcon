import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useParams } from "react-router";
import {
  chaseEmail,
  create,
  createInfoRequest,
  formatMinutes,
  weekStart,
  irlHtml,
  irlRows,
  irlText,
  labels,
  mailtoHref,
  relativeDay,
  update,
  type Snapshot,
} from "@fdd/core";
import { openEditor } from "../components/Editor";
import { Icon } from "../components/Icon";
import { FollowUpRow, IrlRow, ReviewPointRow, TaskRow, WorkpaperRow, useLookups } from "../components/rows";
import { QuickAdd } from "../components/QuickAdd";
import { TLink, useTNavigate } from "../components/TLink";
import { AnimatedList, EmptyState, ListItem, Pill, Segmented, statusTone } from "../components/ui";
import { act } from "../lib/act";
import { useSettings, useSnapshot, useToday } from "../lib/hooks";
import { toast } from "../lib/toast";
import { NotFound } from "./NotFound";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "tasks", label: "Tasks" },
  { id: "workpapers", label: "Work papers" },
  { id: "points", label: "Review points" },
  { id: "irl", label: "IRL" },
  { id: "followups", label: "Follow-ups" },
  { id: "time", label: "Time" },
] as const;
type TabId = (typeof tabs)[number]["id"];

export function EngagementPage() {
  const { id, tab = "overview" } = useParams();
  const snap = useSnapshot();
  const navigate = useTNavigate();
  if (!snap) return null;
  const e = snap.engagements.find((x) => x.id === id);
  if (!e) return <NotFound />;
  const active = (tabs.some((t) => t.id === tab) ? tab : "overview") as TabId;

  const counts: Partial<Record<TabId, number>> = {
    tasks: snap.tasks.filter((t) => t.engagementId === e.id && t.status !== "done").length,
    workpapers: snap.workpapers.filter((w) => w.engagementId === e.id && w.status !== "final").length,
    points: snap.reviewPoints.filter((p) => p.engagementId === e.id && p.status !== "cleared").length,
    irl: snap.infoRequests.filter((r) => r.engagementId === e.id && (r.status === "pending" || r.status === "partial")).length,
    followups: snap.followUps.filter((f) => f.engagementId === e.id && f.status === "waiting").length,
  };

  return (
    <div className="space-y-5">
      <TLink to="/engagements" className="inline-flex items-center gap-1 text-sm font-medium muted hover:text-[var(--text)]">
        <Icon name="back" size={16} /> Engagements
      </TLink>
      <header className="flex items-start justify-between gap-3" style={{ viewTransitionName: `eng-${e.id}` }}>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">{e.name}</h1>
          <p className="text-sm muted">
            {e.client || "No target set"} · {e.side === "buy" ? "Buy-side" : e.side === "sell" ? "Sell-side" : "Other"}
            {e.timesheetCode && ` · ${e.timesheetCode}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Pill tone={statusTone[e.status]}>{labels.engagementStatus[e.status]}</Pill>
          <button className="btn btn-soft btn-sm" onClick={() => openEditor({ table: "engagements", id: e.id })} aria-label="Edit engagement">
            <Icon name="edit" size={15} />
          </button>
        </div>
      </header>

      <nav className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-[var(--border)] px-4 md:mx-0 md:px-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate(`/engagements/${e.id}${t.id === "overview" ? "" : `/${t.id}`}`, "fade")}
            className={`relative shrink-0 px-3 py-2.5 text-sm font-medium ${active === t.id ? "text-brand-700 dark:text-brand-200" : "muted hover:text-[var(--text)]"}`}
          >
            {t.label}
            {!!counts[t.id] && <span className="ml-1.5 rounded-full bg-[var(--surface-2)] px-1.5 text-xs">{counts[t.id]}</span>}
            {active === t.id && <motion.span layoutId="eng-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" />}
          </button>
        ))}
      </nav>

      <AnimatePresence mode="wait">
        <motion.div key={active} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
          {active === "overview" && <Overview snap={snap} id={e.id} />}
          {active === "tasks" && <TasksTab snap={snap} id={e.id} />}
          {active === "workpapers" && <WorkpapersTab snap={snap} id={e.id} />}
          {active === "points" && <PointsTab snap={snap} id={e.id} />}
          {active === "irl" && <IrlTab snap={snap} id={e.id} />}
          {active === "followups" && <FollowUpsTab snap={snap} id={e.id} />}
          {active === "time" && <TimeTab snap={snap} id={e.id} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

type TabProps = { snap: Snapshot; id: string };

function Overview({ snap, id }: TabProps) {
  const e = snap.engagements.find((x) => x.id === id)!;
  const today = useToday();
  const ws = snap.workstreams.filter((w) => w.engagementId === id);
  const people = new Map(snap.people.map((p) => [p.id, p]));
  const dates = [
    ["Kick-off", e.kickoff],
    ["Data room opens", e.dataRoom],
    ["Draft report", e.draftReport],
    ["Final report", e.finalReport],
  ] as const;
  const [wsName, setWsName] = useState("");

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold">Key dates</h3>
        <ul className="space-y-2 text-sm">
          {dates.map(([label, d]) => (
            <li key={label} className="flex justify-between">
              <span className="muted">{label}</span>
              <span className={d && d < today ? "muted" : "font-medium"}>{d ? `${d} · ${relativeDay(d, today)}` : "—"}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold">Workstreams</h3>
        <div className="flex flex-wrap gap-2">
          {ws.map((w) => (
            <button key={w.id} onClick={() => openEditor({ table: "workstreams", id: w.id })} className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-sm">
              {w.name}
              {w.ownerId && <span className="muted"> · {people.get(w.ownerId)?.name}</span>}
            </button>
          ))}
          {ws.length === 0 && <span className="text-sm muted">None yet</span>}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (!wsName.trim()) return;
            if (await act("Workstream added", (ctx) => create(ctx, "workstreams", { engagementId: id, name: wsName.trim() }))) setWsName("");
          }}
        >
          <input className="input" placeholder="Add workstream" value={wsName} onChange={(ev) => setWsName(ev.target.value)} />
          <button className="btn btn-soft" disabled={!wsName.trim()}>
            Add
          </button>
        </form>
      </div>
      {e.notes && (
        <div className="card p-4 md:col-span-2">
          <h3 className="mb-2 text-sm font-semibold">Notes</h3>
          <p className="whitespace-pre-wrap text-sm">{e.notes}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2 md:col-span-2">
        {e.status !== "closed" ? (
          <button className="btn btn-soft" onClick={() => act(`${e.name} closed`, (ctx) => update(ctx, "engagements", id, { status: "closed" }))}>
            <Icon name="check" size={16} /> Close engagement
          </button>
        ) : (
          <button className="btn btn-soft" onClick={() => act(`${e.name} reopened`, (ctx) => update(ctx, "engagements", id, { status: "active" }))}>
            Reopen engagement
          </button>
        )}
      </div>
    </div>
  );
}

function TasksTab({ snap, id }: TabProps) {
  const l = useLookups();
  const [showDone, setShowDone] = useState(false);
  const tasks = snap.tasks
    .filter((t) => t.engagementId === id && (showDone || t.status !== "done"))
    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.due ?? "9").localeCompare(b.due ?? "9"));
  return (
    <div className="space-y-3">
      <QuickAdd defaultEngagementId={id} />
      <div className="flex justify-end">
        <button className="btn btn-ghost btn-sm" onClick={() => setShowDone(!showDone)}>
          {showDone ? "Hide done" : "Show done"}
        </button>
      </div>
      {tasks.length ? (
        <AnimatedList>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} l={l} hideEngagement />
          ))}
        </AnimatedList>
      ) : (
        <EmptyState icon="check" title="No open tasks" hint="Use the bar above. Assign with @name to push work to your team." />
      )}
    </div>
  );
}

function WorkpapersTab({ snap, id }: TabProps) {
  const l = useLookups();
  const [role, setRole] = useState<"all" | "preparer" | "reviewer">("all");
  const wps = snap.workpapers
    .filter((w) => w.engagementId === id && (role === "all" || w.myRole === role))
    .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  const groups = [
    ...snap.workstreams.filter((w) => w.engagementId === id).map((w) => ({ id: w.id, name: w.name })),
    { id: "", name: "No workstream" },
  ]
    .map((g) => ({ ...g, items: wps.filter((w) => (w.workstreamId ?? "") === g.id) }))
    .filter((g) => g.items.length);
  const openPoints = (wpId: string) => snap.reviewPoints.filter((p) => p.workpaperId === wpId && p.status !== "cleared").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented id="wp-role" value={role} onChange={setRole} options={[{ value: "all", label: "All" }, { value: "preparer", label: "I prepare" }, { value: "reviewer", label: "I review" }]} />
        <button className="btn btn-primary" onClick={() => openEditor({ table: "workpapers", defaults: { engagementId: id, myRole: role === "reviewer" ? "reviewer" : "preparer" } })}>
          <Icon name="plus" size={16} /> Work paper
        </button>
      </div>
      {groups.length ? (
        groups.map((g) => (
          <div key={g.id} className="space-y-1.5">
            <p className="px-1 text-sm font-semibold">{g.name}</p>
            <AnimatedList>
              {g.items.map((w) => (
                <WorkpaperRow key={w.id} wp={w} l={l} openPoints={openPoints(w.id)} hideEngagement />
              ))}
            </AnimatedList>
          </div>
        ))
      ) : (
        <EmptyState icon="review" title="No work papers yet" hint="Track the WPs you prepare and the ones you review, with their review points." />
      )}
    </div>
  );
}

function PointsTab({ snap, id }: TabProps) {
  const l = useLookups();
  const [show, setShow] = useState<"open" | "all">("open");
  const points = snap.reviewPoints.filter((p) => p.engagementId === id && (show === "all" || p.status !== "cleared"));
  return (
    <div className="space-y-3">
      <Segmented id="rp-show" value={show} onChange={setShow} options={[{ value: "open", label: "Open" }, { value: "all", label: "All" }]} />
      {points.length ? (
        <AnimatedList>
          {points.map((p) => (
            <ReviewPointRow key={p.id} p={p} l={l} />
          ))}
        </AnimatedList>
      ) : (
        <EmptyState icon="check" title="No open review points" hint="Open a work paper to add review points." />
      )}
    </div>
  );
}

function IrlTab({ snap, id }: TabProps) {
  const l = useLookups();
  const today = useToday();
  const settings = useSettings();
  const e = snap.engagements.find((x) => x.id === id)!;
  const [show, setShow] = useState<"open" | "all">("open");
  const [bulk, setBulk] = useState("");
  const [from, setFrom] = useState("");
  const all = snap.infoRequests.filter((r) => r.engagementId === id);
  const items = all
    .filter((r) => show === "all" || r.status === "pending" || r.status === "partial")
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }) || a.createdAt.localeCompare(b.createdAt));
  const open = all.filter((r) => r.status === "pending" || r.status === "partial");
  const received = all.length - open.length;
  const clients = snap.people.filter((p) => p.role === "client");

  const copyTable = async () => {
    const rows = irlRows(all, today);
    try {
      if ("ClipboardItem" in window) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([irlHtml(rows)], { type: "text/html" }),
            "text/plain": new Blob([irlText(rows)], { type: "text/plain" }),
          }),
        ]);
      } else await navigator.clipboard.writeText(irlText(rows));
      toast({ message: `Copied ${rows.length} pending items. Paste into your email`, tone: "success" });
    } catch {
      toast({ message: "Couldn't access the clipboard", tone: "error" });
    }
  };

  // One chase email per client contact with pending items.
  const byPerson = new Map<string, typeof open>();
  for (const r of open) {
    const k = r.requestedFromId ?? "";
    byPerson.set(k, [...(byPerson.get(k) ?? []), r]);
  }

  const addBulk = async () => {
    const lines = bulk.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    const nextNum = Math.max(0, ...all.map((r) => Number(r.number) || 0)) + 1;
    const res = await act(`${lines.length} IRL item${lines.length > 1 ? "s" : ""} added`, async (ctx) => {
      const out = [];
      let n = nextNum;
      for (const line of lines) {
        // "12. Trial balance" / "12) TB" / "12 - TB" keep their number; otherwise number sequentially.
        const m = /^(\d+(?:\.\d+)*)[.)\-:\s]+(.+)$/.exec(line);
        const number = m ? m[1] : String(n++);
        out.push(await createInfoRequest(ctx, { engagementId: id, number, description: m ? m[2] : line, requestedOn: today, requestedFromId: from || undefined }));
      }
      return out;
    });
    if (res) setBulk("");
  };

  return (
    <div className="space-y-4">
      {all.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold">
              {received} of {all.length} received
            </span>
            <span className="muted">{open.length} pending</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <motion.div className="h-full rounded-full bg-emerald-500" animate={{ width: `${(received / all.length) * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
          </div>
          {open.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-soft btn-sm" onClick={copyTable}>
                <Icon name="copy" size={14} /> Copy pending table
              </button>
              {[...byPerson.entries()].map(([pid, list]) => {
                const person = pid ? l.people.get(pid) : undefined;
                const { subject, body } = chaseEmail(e, person, irlRows(list, today), settings.myName === "Me" ? "" : settings.myName);
                return (
                  <a key={pid || "none"} className="btn btn-soft btn-sm" href={mailtoHref(person?.email, subject, body)}>
                    <Icon name="mail" size={14} /> Email {person?.name.split(" ")[0] ?? "chase"} ({list.length})
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Segmented id="irl-show" value={show} onChange={setShow} options={[{ value: "open", label: "Pending" }, { value: "all", label: "All" }]} />
        <button className="btn btn-ghost btn-sm" onClick={() => openEditor({ table: "infoRequests", defaults: { engagementId: id, requestedOn: today } })}>
          <Icon name="plus" size={14} /> One item
        </button>
      </div>

      {items.length ? (
        <AnimatedList>
          {items.map((r) => (
            <IrlRow key={r.id} item={r} l={l} today={today} hideEngagement />
          ))}
        </AnimatedList>
      ) : (
        <EmptyState icon="inbox" title={all.length ? "Everything received 🎉" : "No IRL items yet"} hint={all.length ? undefined : "Paste your information request list below, one item per line."} />
      )}

      <div className="card space-y-2 p-4">
        <p className="text-sm font-semibold">Add IRL items</p>
        <textarea
          className="input font-mono text-sm"
          rows={4}
          placeholder={"Paste from your IRL tracker, one per line:\n1. Trial balance FY22–FY24\n2. Fixed asset register\nMonthly management accounts"}
          value={bulk}
          onChange={(ev) => setBulk(ev.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto flex-1" value={from} onChange={(ev) => setFrom(ev.target.value)} aria-label="Requested from">
            <option value="">Requested from…</option>
            {clients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={addBulk} disabled={!bulk.trim()}>
            Add {bulk.split("\n").filter((s) => s.trim()).length || ""} items
          </button>
        </div>
      </div>
    </div>
  );
}

function TimeTab({ snap, id }: TabProps) {
  const today = useToday();
  const entries = snap.timeEntries.filter((e) => e.engagementId === id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const total = entries.reduce((a, e) => a + e.minutes, 0);
  const week = entries.filter((e) => e.date >= weekStart(today)).reduce((a, e) => a + e.minutes, 0);
  const tasks = new Map(snap.tasks.map((t) => [t.id, t.title]));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3 text-center">
          <p className="text-xl font-bold">{formatMinutes(week)}</p>
          <p className="text-xs muted">This week</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xl font-bold">{formatMinutes(total)}</p>
          <p className="text-xs muted">All time</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xl font-bold">{entries.filter((e) => e.focus).length}</p>
          <p className="text-xs muted">Focus sessions</p>
        </div>
      </div>
      <div className="flex justify-end">
        <button className="btn btn-primary" onClick={() => openEditor({ table: "timeEntries", defaults: { engagementId: id, date: today } })}>
          <Icon name="plus" size={16} /> Log time
        </button>
      </div>
      {entries.length ? (
        <AnimatedList>
          {entries.map((e) => (
            <ListItem key={e.id} id={e.id} onClick={() => openEditor({ table: "timeEntries", id: e.id })}>
              <span className="w-16 shrink-0 text-xs muted">{relativeDay(e.date, today)}</span>
              <p className="min-w-0 flex-1 truncate text-[15px]">{e.note || (e.taskId && tasks.get(e.taskId)) || (e.focus ? "Focus session" : "Time entry")}</p>
              <span className="text-sm font-semibold">{formatMinutes(e.minutes)}</span>
            </ListItem>
          ))}
        </AnimatedList>
      ) : (
        <EmptyState icon="clock" title="No time logged" hint="Start a focus session from Time & focus, or log time here." />
      )}
    </div>
  );
}

function FollowUpsTab({ snap, id }: TabProps) {
  const l = useLookups();
  const today = useToday();
  const list = snap.followUps.filter((f) => f.engagementId === id).sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className="btn btn-primary" onClick={() => openEditor({ table: "followUps", defaults: { engagementId: id } })}>
          <Icon name="plus" size={16} /> Follow-up
        </button>
      </div>
      {list.length ? (
        <AnimatedList>
          {list.map((f) => (
            <FollowUpRow key={f.id} f={f} l={l} today={today} />
          ))}
        </AnimatedList>
      ) : (
        <EmptyState icon="inbox" title="Not waiting on anyone" hint="Track sign-offs, decisions and inputs you need from managers, team and client." />
      )}
    </div>
  );
}
