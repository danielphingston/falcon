import { useMemo, useState } from "react";
import {
  BLOCKER_HEAD,
  blockerHtml,
  blockerRows,
  blockersPlainText,
  createInfoRequest,
  engagementReadiness,
  liveEngagementIds,
  logChase,
  mailtoHref,
  namedIn,
  update,
  type Blocker,
  type EngagementReadiness,
  type PlanItem,
  type StepReadiness,
} from "@falcon/core";
import { openEditor } from "../components/Editor";
import { Icon } from "../components/Icon";
import { useLookups } from "../components/rows";
import { EmptyState, Pill, Segmented, type Tone } from "../components/ui";
import { act } from "../lib/act";
import { useSettings, useSnapshot, useToday } from "../lib/hooks";
import { linkWithAi, type LinkScope } from "../lib/readiness";
import { toast } from "../lib/toast";
import { downloadXlsx } from "../lib/xlsx";

type Tab = "ready" | "blocked" | "unlinked";

const stateTone: Record<Blocker["state"], Tone> = { pending: "amber", partial: "blue", not_requested: "red" };
const stateLabel: Record<Blocker["state"], string> = { pending: "Pending", partial: "Partly received", not_requested: "Not on the RFI" };

/**
 * Which work plan steps can be executed with the inputs received on the RFI,
 * and what's holding up the rest, with an export for the manager.
 */
export function ReadinessPage() {
  const snap = useSnapshot();
  const settings = useSettings();
  const today = useToday();
  const l = useLookups();
  const [engId, setEngId] = useState<string | null>(null);
  const [person, setPerson] = useState("");
  const [tab, setTab] = useState<Tab>("ready");
  const [view, setView] = useState<"step" | "input">("step");
  const [linking, setLinking] = useState<string | null>(null);

  const engs = useMemo(() => {
    if (!snap) return [];
    const live = liveEngagementIds(snap.engagements);
    const withPlan = new Set(snap.planItems.filter((i) => !i.deleted).map((i) => i.engagementId));
    return snap.engagements.filter((e) => live.has(e.id) && withPlan.has(e.id));
  }, [snap]);

  // Default to the engagement with the most open steps.
  const selected = engId ?? (engs.length ? [...engs].sort((a, b) => count(b.id) - count(a.id))[0].id : "");
  function count(id: string) {
    return snap?.planItems.filter((i) => i.engagementId === id && !i.deleted && i.status !== "closed").length ?? 0;
  }

  const scope = selected ? engs.filter((e) => e.id === selected) : engs;
  const people = useMemo(() => {
    const names = new Set<string>();
    for (const i of snap?.planItems ?? [])
      if (!i.deleted && scope.some((e) => e.id === i.engagementId) && i.status !== "closed")
        for (const p of (i.assignee ?? "").split(/\s*(?:[/,&+;]|\band\b)\s*/i)) if (p && !/^team$/i.test(p)) names.add(p);
    return [...names].sort();
  }, [snap, scope]);

  if (!snap) return null;
  const mine = (i: PlanItem) => !person || namedIn(i.assignee, person);
  const list: EngagementReadiness[] = scope.map((e) =>
    engagementReadiness(e, snap.planItems.filter(mine), snap.infoRequests, today, (id) => l.people.get(id)?.name),
  );
  const ready = list.flatMap((r) => r.ready);
  const blocked = list.flatMap((r) => r.blocked);
  const unlinked = list.flatMap((r) => r.unlinked);
  const total = ready.length + blocked.length + unlinked.length;
  const guessed = list.some((r) => r.steps.some((s) => s.source === "auto"));
  const noRfi = scope.filter((e) => !snap.infoRequests.some((r) => r.engagementId === e.id && !r.deleted));
  const multi = scope.length > 1;
  const label = selected ? (scope[0]?.name ?? "") : "All engagements";

  // What Link with AI would send (whole engagement, ignoring the person filter).
  const whole = selected && scope[0] ? engagementReadiness(scope[0], snap.planItems, snap.infoRequests, today) : undefined;
  const aiUnlinked = whole?.unlinked.length ?? 0;
  const aiAll = whole?.steps.filter((s) => s.source !== "manual").length ?? 0;

  const runAi = async (which: LinkScope) => {
    if (which === "all" && !confirm(`Ask the AI to re-check all ${aiAll} open steps? This uses more of your Gemini quota than linking only the ${aiUnlinked} unlinked ones. Links you set by hand are kept.`)) return;
    setLinking("Starting…");
    const r = await linkWithAi(selected, which, (done, n) => setLinking(`Linking ${done}/${n}…`));
    setLinking(null);
    if (typeof r === "string") return void toast({ message: r, tone: "error" });
    if (r.error) toast({ message: r.linked ? `Linked ${r.linked} steps; ${r.left} left. ${r.error}` : r.error, tone: "error" });
    else if (r.fallback) toast({ message: `Your usual model was busy, so ${r.fallback} did the linking.` });
  };

  // ---------- Export ----------
  const fileBase = `Blockers - ${label} - ${today}`;
  const exportXlsx = () => {
    const byInput = list.flatMap((r) =>
      r.byInput.map((g) => [
        r.engagement.name,
        g.blocker.input,
        g.blocker.rfiNumber ?? "",
        stateLabel[g.blocker.state],
        g.blocker.daysWaiting ?? "",
        g.blocker.from ?? "",
        g.steps.length,
        g.steps.map((s) => `${s.number} ${s.text.split("\n")[0]}`).join("\n"),
      ]),
    );
    downloadXlsx(fileBase, [
      { name: "Blockers", head: BLOCKER_HEAD, rows: blockerRows(list).map((r) => r.map((c, i) => (i === 8 && c ? Number(c) : c))) },
      { name: "By missing input", head: ["Engagement", "Missing input", "RFI no.", "Status", "Days waiting", "With (client)", "Steps held up", "Steps"], rows: byInput, widths: [22, 50, 9, 15, 13, 18, 13, 70] },
      {
        name: "Ready to execute",
        head: ["Engagement", "Step", "Area", "Work plan step", "Person responsible", "Inputs received"],
        rows: list.flatMap((r) =>
          r.ready.map((s) => [r.engagement.name, s.step.number, s.step.area, s.step.text.split("\n")[0], s.step.assignee ?? "", s.received.map((x) => (x.rfiNumber ? `RFI ${x.rfiNumber} ` : "") + x.input).join("\n") || "No client input needed"]),
        ),
        widths: [22, 7, 24, 70, 18, 60],
      },
    ]);
  };
  const copy = async () => {
    const html = blockerHtml(list);
    const text = blockersPlainText(list);
    try {
      if ("ClipboardItem" in window)
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      else await navigator.clipboard.writeText(text);
      toast({ message: "Copied the blockers table. Paste it into your email", tone: "success" });
    } catch {
      toast({ message: "Couldn't access the clipboard", tone: "error" });
    }
  };
  const me = settings.myName && settings.myName !== "Me" ? settings.myName : "";
  const emailHref = () => {
    const subject = `${label}: work plan blockers as at ${today}`;
    const wrap = (body: string) => mailtoHref(undefined, subject, `Hi,\n\nWhere the work plan stands against the inputs received from the client:\n\n${body}\n\nThanks,\n${me}`);
    const full = wrap(blockersPlainText(list));
    // Mail apps cut links past ~2,000 characters: send the main things holding work up and attach the Excel.
    if (full.length <= 1900) return full;
    for (let n = 12; n > 0; n--) {
      const href = wrap(
        list
          .filter((r) => r.blocked.length)
          .map((r) => {
            const top = r.byInput.slice(0, n).map((g) => `  - ${short(g.blocker.input, 70)}${g.blocker.rfiNumber ? ` (RFI ${g.blocker.rfiNumber})` : " (not on RFI)"}: holds up ${g.steps.length}`);
            return `${r.engagement.name}: ${r.ready.length} steps can be executed now, ${r.blocked.length} blocked.\nMain inputs holding work up:\n${top.join("\n")}${r.byInput.length > n ? `\n  …and ${r.byInput.length - n} more` : ""}`;
          })
          .join("\n\n") + "\n\nFull list in the attached Excel (Readiness → Export to Excel).",
      );
      if (href.length <= 1900 || n === 1) return href;
    }
    return full;
  };

  if (!engs.length)
    return (
      <div className="space-y-5">
        <Header />
        <EmptyState icon="check" title="No work plans yet" hint="Import an engagement's work plan (Work plan tab) and its RFI (RFI tab). This page then shows which steps can be done with what the client has sent." />
      </div>
    );

  return (
    <div className="space-y-5">
      <Header />

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Engagement" className="input w-auto max-w-[18rem]" value={selected} onChange={(ev) => (setEngId(ev.target.value), setPerson(""))}>
          {engs.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
          {engs.length > 1 && <option value="">All engagements</option>}
        </select>
        {people.length > 0 && (
          <select aria-label="Person" className="input w-auto" value={person} onChange={(ev) => setPerson(ev.target.value)}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        {selected && (
          <div className="ml-auto flex items-center gap-2">
            {!linking && aiAll > aiUnlinked && (
              <button className="text-xs text-[var(--accent)]" onClick={() => void runAi("all")} title="Ask the AI to check every open step, not only the unlinked ones">
                Re-check all with AI
              </button>
            )}
            <button
              className="btn btn-soft btn-sm"
              onClick={() => void runAi("unlinked")}
              disabled={!!linking || !aiUnlinked}
              title={aiUnlinked ? `Sends only the ${aiUnlinked} steps the app couldn't link, to save your Gemini quota` : "Every step is linked"}
            >
              <Icon name="sparkles" size={14} /> {linking ?? (aiUnlinked ? `Link ${aiUnlinked} with AI` : "All linked")}
            </button>
          </div>
        )}
      </div>

      {noRfi.length > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          No RFI imported for {noRfi.map((e) => e.name).join(", ")} yet. Import it in the engagement's RFI tab so the app knows what has come in.
        </p>
      )}

      <div className="card space-y-3 p-4">
        <div className="grid grid-cols-3 gap-2">
          <Tile n={ready.length} label="Ready to execute" tone="text-emerald-600 dark:text-emerald-400" on={tab === "ready"} onClick={() => setTab("ready")} />
          <Tile n={blocked.length} label="Blocked" tone="text-rose-600 dark:text-rose-400" on={tab === "blocked"} onClick={() => setTab("blocked")} />
          <Tile n={unlinked.length} label="Not linked yet" tone="muted" on={tab === "unlinked"} onClick={() => setTab("unlinked")} />
        </div>
        {total > 0 && (
          <div className="flex h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div className="bg-emerald-500" style={{ width: `${(ready.length / total) * 100}%` }} />
            <div className="bg-rose-500" style={{ width: `${(blocked.length / total) * 100}%` }} />
          </div>
        )}
        <p className="text-xs muted">
          Open steps only ({total}). {guessed ? "Inputs are matched to the RFI from the wording; tap a step to check or change what it needs, or use Link with AI." : "Tap a step to change the inputs it needs."}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          id="ready-tab"
          value={tab}
          onChange={setTab}
          options={[
            { value: "ready", label: `Ready ${ready.length}` },
            { value: "blocked", label: `Blockers ${blocked.length}` },
            { value: "unlinked", label: `Not linked ${unlinked.length}` },
          ]}
        />
        {tab === "blocked" && blocked.length > 0 && (
          <Segmented id="ready-view" value={view} onChange={setView} options={[{ value: "step", label: "By step" }, { value: "input", label: "By missing input" }]} />
        )}
      </div>

      {tab === "blocked" && blocked.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary btn-sm" onClick={exportXlsx}>
            <Icon name="download" size={14} /> Export to Excel
          </button>
          <button className="btn btn-soft btn-sm" onClick={() => void copy()}>
            <Icon name="copy" size={14} /> Copy for email
          </button>
          <a className="btn btn-soft btn-sm" href={emailHref()}>
            <Icon name="mail" size={14} /> Email manager
          </a>
        </div>
      )}

      {tab === "ready" &&
        (ready.length ? (
          <Grouped list={list} pick={(r) => r.ready} multi={multi} render={(s) => <ReadyRow s={s} />} />
        ) : (
          <EmptyState icon="check" title="Nothing ready yet" hint={blocked.length ? "Every linked step is still waiting on the client. See Blockers." : undefined} />
        ))}
      {tab === "blocked" &&
        (blocked.length ? (
          view === "step" ? (
            <Grouped list={list} pick={(r) => r.blocked} multi={multi} render={(s) => <BlockedRow s={s} />} />
          ) : (
            <ByInput list={list} today={today} multi={multi} />
          )
        ) : (
          <EmptyState icon="check" title="No blockers" hint="Every linked step has its inputs." />
        ))}
      {tab === "unlinked" &&
        (unlinked.length ? (
          <>
            <p className="px-1 text-sm muted">The app couldn't tell what these steps need. Tap one to pick its RFI items, or mark it as needing no client input.</p>
            <Grouped list={list} pick={(r) => r.unlinked} multi={multi} render={(s) => <UnlinkedRow s={s} />} />
          </>
        ) : (
          <EmptyState icon="check" title="Every step is linked" />
        ))}
    </div>
  );
}

function Header() {
  return (
    <header>
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Readiness</h1>
      <p className="text-sm muted">Which work plan steps can be executed with the inputs received on the RFI, and what's holding up the rest.</p>
    </header>
  );
}

function Tile({ n, label, tone, on, onClick }: { n: number; label: string; tone: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-xl border p-3 text-left transition ${on ? "border-[var(--accent)] bg-[var(--surface-2)]" : "border-[var(--border)]"}`}>
      <p className={`text-2xl font-bold ${tone}`}>{n}</p>
      <p className="text-xs muted">{label}</p>
    </button>
  );
}

/** Steps grouped by engagement (when several) and area. */
function Grouped({ list, pick, multi, render }: { list: EngagementReadiness[]; pick: (r: EngagementReadiness) => StepReadiness[]; multi: boolean; render: (s: StepReadiness) => React.ReactNode }) {
  return (
    <div className="space-y-4">
      {list.map((r) => {
        const steps = pick(r);
        if (!steps.length) return null;
        const areas: [string, StepReadiness[]][] = [];
        for (const s of steps) {
          const k = [s.step.group, s.step.area].filter(Boolean).join(" › ");
          const g = areas.find(([a]) => a === k);
          if (g) g[1].push(s);
          else areas.push([k, [s]]);
        }
        return (
          <div key={r.engagement.id} className="space-y-3">
            {multi && <p className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">{r.engagement.name}</p>}
            {areas.map(([area, rows]) => (
              <section key={area} className="space-y-1.5">
                <h3 className="px-1 text-sm font-semibold">{area || "Other steps"}</h3>
                <div className="card divide-y divide-[var(--border)]">{rows.map((s) => <div key={s.step.id}>{render(s)}</div>)}</div>
              </section>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function StepText({ step }: { step: PlanItem }) {
  return (
    <button className="min-w-0 flex-1 text-left" onClick={() => openEditor({ table: "planItems", id: step.id })}>
      <p className="text-sm">
        <span className="mr-1.5 font-mono text-xs muted">{step.number}</span>
        {step.text.split("\n")[0]}
      </p>
      {step.assignee && <p className="text-xs muted">{step.assignee}</p>}
    </button>
  );
}

function ReadyRow({ s }: { s: StepReadiness }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className="mt-0.5 shrink-0">
        <Pill tone="green">Ready</Pill>
      </span>
      <div className="min-w-0 flex-1">
        <StepText step={s.step} />
        <div className="mt-1 flex flex-wrap gap-1">
          {s.received.length ? (
            s.received.map((x, i) => (
              <span key={i} className="max-w-full truncate rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" title={x.input}>
                ✓ {x.rfiNumber ? `RFI ${x.rfiNumber} ` : ""}
                {short(x.input)}
              </span>
            ))
          ) : (
            <span className="text-[11px] muted">No client input needed</span>
          )}
        </div>
      </div>
    </div>
  );
}

function BlockedRow({ s }: { s: StepReadiness }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className="mt-0.5 shrink-0">
        <Pill tone="red">Blocked</Pill>
      </span>
      <div className="min-w-0 flex-1">
        <StepText step={s.step} />
        <ul className="mt-1 space-y-0.5">
          {s.blockers.map((b, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs">
              <Pill tone={stateTone[b.state]}>{stateLabel[b.state]}</Pill>
              <span className="min-w-0">
                {b.rfiNumber && <span className="font-mono muted">RFI {b.rfiNumber} </span>}
                {short(b.input, 90)}
                {b.daysWaiting !== undefined && <span className="muted"> · {b.daysWaiting}d</span>}
                {b.from && <span className="muted"> · {b.from}</span>}
              </span>
            </li>
          ))}
        </ul>
        {s.received.length > 0 && <p className="mt-1 text-[11px] muted">Has {s.received.length} of {s.received.length + s.blockers.length} inputs</p>}
      </div>
    </div>
  );
}

function UnlinkedRow({ s }: { s: StepReadiness }) {
  const none = () => act("Marked as needing no client input", (ctx) => update(ctx, "planItems", s.step.id, { inputs: { rfiIds: [], extra: [], none: true, source: "manual" } }));
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <StepText step={s.step} />
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button className="btn btn-soft btn-sm" onClick={() => openEditor({ table: "planItems", id: s.step.id })}>
          Link inputs
        </button>
        <button className="text-xs text-[var(--accent)]" onClick={() => void none()}>
          No input needed
        </button>
      </div>
    </div>
  );
}

/** Missing inputs, most-blocking first, with the steps each one holds up. */
function ByInput({ list, today, multi }: { list: EngagementReadiness[]; today: string; multi: boolean }) {
  const addToRfi = (r: EngagementReadiness, g: EngagementReadiness["byInput"][number]) =>
    act(`Added “${g.blocker.input}” to the RFI`, async (ctx) => {
      const added = await createInfoRequest(ctx, { engagementId: r.engagement.id, number: "", description: g.blocker.input, requestedOn: today, status: "pending", chaseLog: [] });
      const out = [added];
      // Steps whose inputs were set by hand or by the AI: point them at the new RFI item.
      for (const s of g.steps)
        if (s.inputs)
          out.push(
            await update(ctx, "planItems", s.id, {
              inputs: { ...s.inputs, rfiIds: [...s.inputs.rfiIds, added.record.id], extra: s.inputs.extra.filter((x) => x.name.toLowerCase() !== g.blocker.input.toLowerCase()) },
            }) as never,
          );
      return out;
    });
  return (
    <div className="space-y-4">
      {list.map((r) =>
        r.byInput.length ? (
          <div key={r.engagement.id} className="space-y-2">
            {multi && <p className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">{r.engagement.name}</p>}
            {r.byInput.map((g) => (
              <div key={(g.blocker.rfiId ?? g.blocker.input) + r.engagement.id} className="card space-y-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {g.blocker.rfiNumber && <span className="mr-1 font-mono text-xs muted">RFI {g.blocker.rfiNumber}</span>}
                      {g.blocker.input}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs muted">
                      <Pill tone={stateTone[g.blocker.state]}>{stateLabel[g.blocker.state]}</Pill>
                      {g.blocker.daysWaiting !== undefined && <span>{g.blocker.daysWaiting}d since requested</span>}
                      {g.blocker.from && <span>with {g.blocker.from}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {g.blocker.rfiId ? (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEditor({ table: "infoRequests", id: g.blocker.rfiId! })}>
                          Open
                        </button>
                        <button className="btn btn-soft btn-sm" onClick={() => void act("Chase logged", (ctx) => logChase(ctx, "infoRequests", g.blocker.rfiId!))}>
                          <Icon name="send" size={14} /> Chased
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-soft btn-sm" onClick={() => void addToRfi(r, g)}>
                        <Icon name="plus" size={14} /> Add to RFI
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs font-medium">
                  Holds up {g.steps.length} step{g.steps.length === 1 ? "" : "s"}:
                </p>
                <ul className="space-y-0.5 text-xs">
                  {g.steps.map((s) => (
                    <li key={s.id}>
                      <button className="text-left hover:underline" onClick={() => openEditor({ table: "planItems", id: s.id })}>
                        <span className="font-mono muted">{s.number}</span> {short(s.text.split("\n")[0], 110)}
                        {s.assignee && <span className="muted"> · {s.assignee}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}

const short = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
