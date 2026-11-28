import { useMemo, useState } from "react";
import { rfiTitle,
  BLOCKER_HEAD,
  blockerHtml,
  blockerRows,
  blockersPlainText,
  confirmedInputs,
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
  type StepInput,
  type InfoRequest,
  readinessLabels,
  rfiImpact,
  itemsByStepsHeldUp,
} from "@falcon/core";
import { openEditor } from "../components/Editor";
import { Icon } from "../components/Icon";
import { useLookups } from "../components/rows";
import { EmptyState, Pill, Segmented, Sheet, type Tone } from "../components/ui";
import { act } from "../lib/act";
import { useSettings, useSnapshot, useToday } from "../lib/hooks";
import { linkWithAi, type LinkScope } from "../lib/readiness";
import { toast } from "../lib/toast";
import { downloadXlsx } from "../lib/xlsx";

type Tab = "ready" | "canStart" | "blocked" | "likelyNa" | "suggested" | "unlinked";

/** Saves suggestions as the user's confirmed links, as one undoable action. */
const confirmSteps = (steps: StepReadiness[], message?: string) =>
  steps.length
    ? act(message ?? `Confirmed ${steps.length} step${steps.length === 1 ? "" : "s"}`, async (ctx) => {
        const out = [];
        for (const s of steps) out.push(await update(ctx, "planItems", s.step.id, { inputs: confirmedInputs(s) }));
        return out;
      })
    : undefined;

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
  const [warnFor, setWarnFor] = useState<LinkScope | null>(null);

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
  // "No input needed" steps sit with Ready: nothing stops them.
  const ready = list.flatMap((r) => [...r.ready, ...r.noInput]);
  const canStart = list.flatMap((r) => r.canStart);
  const blocked = list.flatMap((r) => r.blocked);
  const likelyNa = list.flatMap((r) => r.likelyNa);
  const suggested = list.flatMap((r) => r.suggested);
  const unlinked = list.flatMap((r) => r.unlinked);
  const total = ready.length + canStart.length + blocked.length + likelyNa.length + suggested.length + unlinked.length;
  const notReady = canStart.length + blocked.length;
  const aiSuggested = suggested.filter((s) => s.source === "ai");
  const noRfi = scope.filter((e) => !snap.infoRequests.some((r) => r.engagementId === e.id && !r.deleted));
  const multi = scope.length > 1;
  const label = selected ? (scope[0]?.name ?? "") : "All engagements";

  // What Link with AI would send (whole engagement, ignoring the person filter).
  const whole = selected && scope[0] ? engagementReadiness(scope[0], snap.planItems, snap.infoRequests, today) : undefined;
  const aiUnlinked = whole?.unlinked.filter((s) => s.source !== "manual").length ?? 0;
  const aiAll = whole?.steps.filter((s) => s.source !== "manual").length ?? 0;

  // The warning shows before every run, unless the user turned it off for "link unlinked" on this device.
  // "Re-check all" always asks, since it uses much more of the quota.
  const askAi = (which: LinkScope) => {
    let skip = false;
    try {
      skip = which === "unlinked" && localStorage.getItem(AI_WARN_KEY) === "off";
    } catch {
      /* storage blocked: always warn */
    }
    if (skip) void runAi(which);
    else setWarnFor(which);
  };

  const runAi = async (which: LinkScope) => {
    setWarnFor(null);
    setLinking("Starting…");
    const r = await linkWithAi(selected, which, (done, n) => setLinking(`Linking ${done}/${n}…`));
    setLinking(null);
    if (typeof r === "string") return void toast({ message: r, tone: "error" });
    if (r.error) toast({ message: r.linked ? `Linked ${r.linked} steps; ${r.left} left. ${r.error}` : r.error, tone: "error" });
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
      {
        name: "Summary",
        head: ["Engagement", "Ready", "Can start", "Blocked", "Likely N/A", "No input needed", "Not confirmed yet (not in this file)", "Not linked", "As at"],
        rows: list.map((r) => [r.engagement.name, r.ready.length, r.canStart.length, r.blocked.length, r.likelyNa.length, r.noInput.length, r.suggested.length, r.unlinked.length, today]),
        widths: [28, 16, 10, 34, 12, 12],
      },
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
      <AiWarning
        which={warnFor}
        steps={warnFor === "all" ? aiAll : aiUnlinked}
        model={settings.geminiModel}
        onCancel={() => setWarnFor(null)}
        onGo={(which) => void runAi(which)}
      />

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
              <button className="text-xs text-[var(--accent)]" onClick={() => askAi("all")} title="Ask the AI to check every open step, not only the unlinked ones">
                Re-check all with AI
              </button>
            )}
            <button
              className="btn btn-soft btn-sm"
              onClick={() => askAi("unlinked")}
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile n={ready.length} label="Ready" hint="every input in" tone="text-emerald-600 dark:text-emerald-400" on={tab === "ready"} onClick={() => setTab("ready")} />
          <Tile n={canStart.length} label="Can start" hint="some input in" tone="text-sky-600 dark:text-sky-400" on={tab === "canStart"} onClick={() => setTab("canStart")} />
          <Tile n={blocked.length} label="Blocked" hint="nothing usable in" tone="text-rose-600 dark:text-rose-400" on={tab === "blocked"} onClick={() => setTab("blocked")} />
          <Tile n={likelyNa.length} label="Likely N/A" hint="every input N/A" tone="text-slate-500" on={tab === "likelyNa"} onClick={() => setTab("likelyNa")} />
          <Tile n={suggested.length} label="To confirm" hint="suggested links" tone="text-amber-600 dark:text-amber-400" on={tab === "suggested"} onClick={() => setTab("suggested")} />
          <Tile n={unlinked.length} label="Not linked" hint="nothing to go on" tone="muted" on={tab === "unlinked"} onClick={() => setTab("unlinked")} />
        </div>
        {total > 0 && (
          <div className="flex h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div className="bg-emerald-500" style={{ width: `${(ready.length / total) * 100}%` }} />
            <div className="bg-sky-500" style={{ width: `${(canStart.length / total) * 100}%` }} />
            <div className="bg-rose-500" style={{ width: `${(blocked.length / total) * 100}%` }} />
            <div className="bg-slate-400" style={{ width: `${(likelyNa.length / total) * 100}%` }} />
            <div className="bg-amber-300 dark:bg-amber-700" style={{ width: `${(suggested.length / total) * 100}%` }} />
          </div>
        )}
        <p className="text-xs muted">
          Open steps only ({total}). Tap a tile to see its steps. Only links you've confirmed count.
          {suggested.length > 0 && ` ${suggested.length} step${suggested.length === 1 ? " has" : "s have"} suggested links (from AI or the offline matcher) to check under To confirm.`}
        </p>
      </div>

      {selected && scope[0] && <RfiLookup r={list[0]} rfi={snap.infoRequests} />}

      {(tab === "blocked" || tab === "canStart") && notReady > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented id="ready-view" value={view} onChange={setView} options={[{ value: "step", label: "By step" }, { value: "input", label: "By missing input" }]} />
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
      {(tab === "blocked" || tab === "canStart") && view === "input" && notReady > 0 && <ByInput list={list} today={today} multi={multi} />}

      {tab === "ready" &&
        (ready.length ? (
          <Grouped list={list} pick={(r) => [...r.ready, ...r.noInput]} multi={multi} render={(s) => <StepRow s={s} />} />
        ) : (
          <EmptyState
            icon="check"
            title="Nothing ready yet"
            hint={suggested.length ? "Confirm the suggested links under To confirm and ready steps show here." : notReady ? "Every confirmed step is still waiting on something. See Can start and Blocked." : undefined}
          />
        ))}
      {tab === "canStart" &&
        view === "step" &&
        (canStart.length ? (
          <>
            <p className="px-1 text-sm muted">Something is in (or the books are), so work can begin. The workpaper stays partly complete until the rest arrives.</p>
            <Grouped list={list} pick={(r) => r.canStart} multi={multi} render={(s) => <StepRow s={s} />} />
          </>
        ) : (
          <EmptyState icon="check" title="Nothing here" hint="Steps with some inputs in show here." />
        ))}
      {tab === "blocked" &&
        view === "step" &&
        (blocked.length ? (
          <Grouped list={list} pick={(r) => r.blocked} multi={multi} render={(s) => <StepRow s={s} />} />
        ) : (
          <EmptyState icon="check" title="No blocked steps" hint={suggested.length ? "None among confirmed steps. Suggested links under To confirm aren't counted yet." : "Every confirmed step has at least something in."} />
        ))}
      {tab === "likelyNa" &&
        (likelyNa.length ? (
          <>
            <p className="px-1 text-sm muted">Every input of these steps is N/A. If the step doesn't apply either, mark it N/A: it leaves the plan's counts (with Undo).</p>
            <Grouped list={list} pick={(r) => r.likelyNa} multi={multi} render={(s) => <StepRow s={s} />} />
          </>
        ) : (
          <EmptyState icon="check" title="Nothing likely N/A" />
        ))}
      {tab === "suggested" &&
        (suggested.length ? (
          <ToConfirm list={list} multi={multi} suggested={suggested} aiSuggested={aiSuggested} />
        ) : (
          <EmptyState icon="check" title="Nothing to confirm" hint="Suggested links from the AI or the offline matcher show here for you to check." />
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

/**
 * Search by RFI item (build brief 2.3): type a number or words, see every step
 * the item feeds with its state and owner. Empty, it lists the open items
 * holding up the most steps.
 */
function RfiLookup({ r, rfi }: { r: EngagementReadiness; rfi: InfoRequest[] }) {
  const [q, setQ] = useState("");
  const items = rfi.filter((x) => !x.deleted && x.engagementId === r.engagement.id);
  const term = q.trim().toLowerCase().replace(/^rfi\s*/, "");
  const hits = term
    ? items.filter((x) => x.number === term || x.number.startsWith(term + ".") || x.description.toLowerCase().includes(term)).slice(0, 6)
    : [];
  const top = itemsByStepsHeldUp(r, rfi).slice(0, 5);
  return (
    <div className="card space-y-2 p-3">
      <input className="input py-1.5 text-sm" placeholder="Find an RFI item: number (e.g. 1.5) or words" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an RFI item" />
      {!term && top.length > 0 && (
        <p className="text-xs muted">
          Holding up the most steps:{" "}
          {top.map((t, i) => (
            <button key={t.item.id} className="text-[var(--accent)] hover:underline" onClick={() => setQ(t.item.number)}>
              {i ? ", " : ""}RFI {t.item.number} ({t.steps})
            </button>
          ))}
        </p>
      )}
      {term && !hits.length && <p className="text-xs muted">No RFI item matches.</p>}
      {hits.map((item) => {
        const imp = rfiImpact(r, item);
        return (
          <div key={item.id} className="rounded-xl border border-[var(--border)] p-2">
            <button className="text-left text-sm font-medium hover:underline" onClick={() => openEditor({ table: "infoRequests", id: item.id })}>
              <span className="mr-1 font-mono text-xs muted">RFI {item.number}</span>
              {rfiTitle(item.description)} <span className="text-xs muted">· {item.status}</span>
            </button>
            {imp.steps.length ? (
              <ul className="mt-1 space-y-0.5 text-xs">
                {imp.steps.map((s) => (
                  <li key={s.step.id}>
                    <button className="text-left hover:underline" onClick={() => openEditor({ table: "planItems", id: s.step.id })}>
                      <span className="font-mono muted">{s.step.number}</span> {short(s.step.text.split("\n")[0], 80)}
                      <span className="muted">
                        {" "}
                        · {readinessLabels[s.state]}
                        {s.step.assignee && ` · ${s.step.assignee}`}
                        {!s.confirmed && " · suggested"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs muted">Not linked to any work plan step yet.</p>
            )}
          </div>
        );
      })}
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

function Tile({ n, label, hint, tone, on, onClick }: { n: number; label: string; hint?: string; tone: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-xl border p-3 text-left transition ${on ? "border-[var(--accent)] bg-[var(--surface-2)]" : "border-[var(--border)]"}`}
    >
      <p className={`text-2xl font-bold ${tone}`}>{n}</p>
      <p className="text-xs font-medium">{label}</p>
      {hint && <p className="text-[11px] muted">{hint}</p>}
    </button>
  );
}

/** Steps grouped by engagement (when several) and area. */
function Grouped({
  list,
  pick,
  multi,
  render,
  areaAction,
}: {
  list: EngagementReadiness[];
  pick: (r: EngagementReadiness) => StepReadiness[];
  multi: boolean;
  render: (s: StepReadiness) => React.ReactNode;
  /** Optional button beside each area heading, e.g. "Confirm all 4". */
  areaAction?: (rows: StepReadiness[]) => React.ReactNode;
}) {
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
                <div className="flex items-center justify-between gap-2 px-1">
                  <h3 className="text-sm font-semibold">{area || "Other steps"}</h3>
                  {areaAction?.(rows)}
                </div>
                <div className="card divide-y divide-[var(--border)]">{rows.map((s) => <div key={s.step.id}>{render(s)}</div>)}</div>
              </section>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Suggested links waiting for the user: confirm one step, a whole area, every
 * AI suggestion, or the ticked ones. Confirming saves them as the user's own,
 * and only then do they count as ready or blocked.
 */
function ToConfirm({ list, multi, suggested, aiSuggested }: { list: EngagementReadiness[]; multi: boolean; suggested: StepReadiness[]; aiSuggested: StepReadiness[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const byId = new Map(suggested.map((s) => [s.step.id, s]));
  const chosen = [...picked].map((id) => byId.get(id)).filter((s): s is StepReadiness => !!s);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const done = () => setPicked(new Set());
  const allPicked = chosen.length === suggested.length;
  return (
    <div className="space-y-3">
      <p className="px-1 text-sm muted">
        Check what each step needs, then confirm. Suggestions don't count as ready or blocked until you do. <span className="font-medium">✦ AI</span> suggestions come from Link with AI or an AI app;{" "}
        <span className="font-medium">≈ Matcher</span> ones from Falcon's offline matching.
      </p>
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--bg)]/90 px-1 py-2 backdrop-blur">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={allPicked && suggested.length > 0} onChange={() => setPicked(allPicked ? new Set() : new Set(suggested.map((s) => s.step.id)))} aria-label="Select all" />
          {chosen.length ? `${chosen.length} selected` : "Select"}
        </label>
        {chosen.length > 0 && (
          <button className="btn btn-primary btn-sm" onClick={() => void confirmSteps(chosen)?.then(done)}>
            <Icon name="check" size={14} /> Confirm selected ({chosen.length})
          </button>
        )}
        {aiSuggested.length > 0 && (
          <button
            className="btn btn-soft btn-sm ml-auto"
            onClick={() => {
              if (confirm(`Confirm all ${aiSuggested.length} AI suggestions without checking each one? They'll count as ready or blocked straight away. One Undo reverses this.`))
                void confirmSteps(aiSuggested, `Confirmed ${aiSuggested.length} AI suggestion${aiSuggested.length === 1 ? "" : "s"}`)?.then(done);
            }}
          >
            ✦ Confirm all AI suggestions ({aiSuggested.length})
          </button>
        )}
      </div>
      <Grouped
        list={list}
        pick={(r) => r.suggested}
        multi={multi}
        areaAction={(rows) => (
          <button className="text-xs font-medium text-[var(--accent)]" onClick={() => void confirmSteps(rows)}>
            Confirm all {rows.length}
          </button>
        )}
        render={(s) => <SuggestedRow s={s} picked={picked.has(s.step.id)} onPick={() => toggle(s.step.id)} />}
      />
    </div>
  );
}

function SuggestedRow({ s, picked, onPick }: { s: StepReadiness; picked: boolean; onPick: () => void }) {
  const noInput = () => act("Marked as needing no client input", (ctx) => update(ctx, "planItems", s.step.id, { inputs: { rfiIds: [], extra: [], none: true, source: "manual" } }));
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 ${picked ? "bg-[var(--surface-2)]" : ""}`}>
      <input type="checkbox" className="mt-1.5 shrink-0" checked={picked} onChange={onPick} aria-label={`Select step ${s.step.number}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <StepText step={s.step} />
          <span
            className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${s.source === "ai" ? "bg-brand-100 text-brand-700 dark:bg-indigo-950 dark:text-indigo-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
            title={s.source === "ai" ? "Suggested by AI" : "Suggested by Falcon's offline matcher"}
          >
            {s.source === "ai" ? "✦ AI" : "≈ Matcher"}
          </span>
        </div>
        <ul className="mt-1 space-y-0.5 text-xs">
          {s.none && <li className="muted">Needs no client input</li>}
          {s.received.map((x, i) => (
            <li key={`r${i}`} className="flex items-start gap-1.5">
              <span className="text-emerald-600 dark:text-emerald-400">●</span>
              <span className="min-w-0">
                {x.rfiNumber && <span className="font-mono muted">RFI {x.rfiNumber} </span>}
                {short(x.input, 90)} <span className="muted">· received</span>
              </span>
            </li>
          ))}
          {s.blockers.map((b, i) => (
            <li key={`b${i}`} className="flex items-start gap-1.5">
              <span className={b.state === "not_requested" ? "text-rose-600 dark:text-rose-400" : "text-amber-500"}>{b.state === "not_requested" ? "▲" : "○"}</span>
              <span className="min-w-0">
                {b.rfiNumber && <span className="font-mono muted">RFI {b.rfiNumber} </span>}
                {b.state === "not_requested" ? (
                  <>Not on the RFI: {b.input}</>
                ) : (
                  <>
                    {short(b.input, 90)}
                    <span className="muted"> · {stateLabel[b.state].toLowerCase()}</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="text-xs muted">
            Would be: <b className={s.wouldBe === "ready" || s.wouldBe === "noInput" ? "text-emerald-600 dark:text-emerald-400" : s.wouldBe === "canStart" ? "text-sky-600 dark:text-sky-400" : s.wouldBe === "likelyNa" ? "muted" : "text-rose-600 dark:text-rose-400"}>{s.wouldBe ? readinessLabels[s.wouldBe] : "—"}</b>
          </span>
          <span className="ml-auto flex gap-1">
            <button className="btn btn-primary btn-sm" onClick={() => void confirmSteps([s])}>
              Confirm
            </button>
            <button className="btn btn-soft btn-sm" onClick={() => openEditor({ table: "planItems", id: s.step.id })}>
              Edit
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void noInput()}>
              No input
            </button>
          </span>
        </div>
      </div>
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

const OUTCOME_TONE: Record<string, Tone> = { ready: "green", noInput: "green", canStart: "blue", blocked: "red", likelyNa: "slate" };
const INPUT_MARK: Record<StepInput["state"], [string, string]> = {
  received: ["✓", "text-emerald-600 dark:text-emerald-400"],
  partial: ["◐", "text-sky-600 dark:text-sky-400"],
  pending: ["○", "text-amber-600 dark:text-amber-400"],
  na: ["–", "muted"],
  not_requested: ["▲", "text-rose-600 dark:text-rose-400"],
};
const INPUT_WORD: Record<StepInput["state"], string> = { received: "received", partial: "partly in", pending: "pending", na: "N/A", not_requested: "not on the RFI" };

/** A confirmed step with every input: what's in and what's missing, side by side (2.2). */
function StepRow({ s }: { s: StepReadiness }) {
  const blockerFor = (i: StepInput) => s.blockers.find((b) => (b.rfiId ? b.rfiId === i.rfiId : b.input === i.input));
  const markNa = () => act("Step marked N/A", (ctx) => update(ctx, "planItems", s.step.id, { applicable: false, notes: [s.step.notes, "N/A: every input is N/A on the RFI"].filter(Boolean).join("\n") }));
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className="mt-0.5 shrink-0">
        <Pill tone={OUTCOME_TONE[s.state] ?? "slate"}>{readinessLabels[s.state]}</Pill>
      </span>
      <div className="min-w-0 flex-1">
        <StepText step={s.step} />
        {s.none ? (
          <p className="mt-1 text-[11px] muted">No client input needed</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {s.inputs.map((i, k) => {
              const b = blockerFor(i);
              const [mark, cls] = INPUT_MARK[i.state];
              return (
                <li key={k} className="flex items-start gap-1.5 text-xs">
                  <span className={`w-3 shrink-0 text-center ${cls}`} title={INPUT_WORD[i.state]}>
                    {mark}
                  </span>
                  <span className={`min-w-0 ${i.state === "na" ? "muted line-through" : ""}`}>
                    {i.rfiNumber && <span className="font-mono muted">RFI {i.rfiNumber} </span>}
                    {i.state === "not_requested" ? <>Not on the RFI: {i.input}</> : short(i.input.split("\n")[0], 90)}
                    {i.books && <span className="ml-1 rounded bg-[var(--surface-2)] px-1 text-[10px] font-semibold">books</span>}
                    <span className="muted">
                      {" "}
                      · {INPUT_WORD[i.state]}
                      {b?.daysWaiting !== undefined && ` · ${b.daysWaiting}d`}
                      {b?.from && ` · ${b.from}`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {s.state === "likelyNa" && (
          <button className="mt-1 text-xs font-medium text-[var(--accent)]" onClick={() => void markNa()}>
            Mark step N/A
          </button>
        )}
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

const AI_WARN_KEY = "falcon.linkAiWarning";

/** Shown before Link with AI: it can fail or get links wrong, so only use it with a capable model on a paid plan. */
function AiWarning({ which, steps, model, onCancel, onGo }: { which: LinkScope | null; steps: number; model: string; onCancel: () => void; onGo: (which: LinkScope) => void }) {
  const [dontAsk, setDontAsk] = useState(false);
  const go = () => {
    if (dontAsk && which === "unlinked")
      try {
        localStorage.setItem(AI_WARN_KEY, "off");
      } catch {
        /* storage blocked: it will just ask again */
      }
    if (which) onGo(which);
  };
  return (
    <Sheet
      open={!!which}
      onClose={onCancel}
      title="Before you use Link with AI"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={go}>
            Link {steps} step{steps === 1 ? "" : "s"} anyway
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <b>Link with AI can fail, and it can get links wrong.</b> Only use it if you have a capable Gemini model (a current Flash or Pro) on a paid plan or with API billing.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b>It can fail:</b> on free tiers or busy times Google often answers “high demand” or hits a rate limit. The app retries a couple of times on your model, then stops. It never switches to a different model.
          </li>
          <li>
            <b>It can be wrong:</b> lite, older or free models link steps to the wrong RFI items more often. A wrong link can show a step as <b>Ready</b> when its input hasn't actually come in.
          </li>
          <li>
            <b>Without a good model or subscription:</b> link steps by hand instead (tap a step → Inputs needed), or mark them “No input needed”.
          </li>
          <li>
            <b>If you go ahead:</b> check the steps it links (tap a step to see them). One Undo reverses the whole run, and steps you set by hand are never touched.
          </li>
        </ul>
        <p className="muted">
          Model: <b>{model}</b> (change it in Settings) · sends {steps} step{steps === 1 ? "" : "s"} and this engagement's RFI list to Google.
          {which === "all" && " Re-checking every step uses noticeably more of your Gemini quota than linking only the unlinked ones."}
        </p>
        {which === "unlinked" && (
          <label className="flex items-center gap-2 muted">
            <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
            Don't show this again on this device
          </label>
        )}
      </div>
    </Sheet>
  );
}

const short = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
