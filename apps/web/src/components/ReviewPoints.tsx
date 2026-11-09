import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { create, labels, update, type ReviewPoint, type WorkPaper } from "@falcon/core";
import { act } from "../lib/act";
import { useSnapshot } from "../lib/hooks";
import { challengeWithAi, offlineChallenges, wpContext } from "../lib/review";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";
import { Checkbox, Pill, statusTone } from "./ui";

type Challenge = NonNullable<ReviewPoint["challenges"]>[number];

/**
 * Review points on a work paper. Each new point is challenged straight away:
 * related checks from the procedure library at once, then (when the AI is set
 * up) specific "have you also checked…?" questions from Gemini.
 */
export function ReviewPointsPanel({ wp }: { wp: WorkPaper }) {
  const snap = useSnapshot();
  const points = useMemo(
    () => (snap?.reviewPoints ?? []).filter((p) => p.workpaperId === wp.id && !p.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [snap, wp.id],
  );
  const c = useMemo(() => (snap ? wpContext(snap, wp) : null), [snap, wp]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const open = points.filter((p) => p.status !== "cleared").length;

  // Live hint while typing: what the library says to check alongside this point.
  const [typed, setTyped] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTyped(draft), 450);
    return () => clearTimeout(t);
  }, [draft]);
  const hints = useMemo(() => (c && typed.trim().length > 12 ? offlineChallenges(typed.split("\n").pop() ?? typed, c) : []), [typed, c]);

  const challenge = async (id: string, quiet: boolean) => {
    setBusy((b) => new Set(b).add(id));
    const err = await challengeWithAi(id, quiet);
    setBusy((b) => {
      const n = new Set(b);
      n.delete(id);
      return n;
    });
    if (err) toast({ message: err, tone: "error" });
  };

  const add = async () => {
    if (!c) return;
    const lines = draft.split("\n").map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
    if (!lines.length) return;
    const res = await act(lines.length > 1 ? `${lines.length} review points added` : "Review point added", async (ctx) => {
      const out = [];
      for (const text of lines) {
        const challenges = offlineChallenges(text, c);
        out.push(await create(ctx, "reviewPoints", { workpaperId: wp.id, engagementId: wp.engagementId, text, ...(challenges.length ? { challenges } : {}) }));
      }
      if (wp.status !== "points_raised" && wp.myRole === "reviewer") await update(ctx, "workpapers", wp.id, { status: "points_raised" });
      return out;
    });
    if (!res) return;
    setDraft("");
    setTyped("");
    for (const r of res) void challenge(r.record.id, true);
  };

  const raise = (p: ReviewPoint, i: number) =>
    act("Raised as a review point", async (ctx) => {
      const q = p.challenges![i];
      const r = await create(ctx, "reviewPoints", { workpaperId: wp.id, engagementId: wp.engagementId, text: q.question + (q.why ? ` (${q.why})` : "") });
      await update(ctx, "reviewPoints", p.id, { challenges: p.challenges!.map((x, j) => (j === i ? { ...x, status: "added" as const } : x)) });
      return r;
    });

  const toProgramme = (p: ReviewPoint, i: number) =>
    act("Added to the work programme", async (ctx) => {
      const q = p.challenges![i];
      const area = c?.areas[0] ?? "general";
      const r = await create(ctx, "programItems", {
        engagementId: wp.engagementId,
        area,
        text: asStep(q.question),
        why: q.why,
        source: q.source === "ai" ? "ai" : "followup",
        workpaperId: wp.id,
        order: 9500,
      });
      await update(ctx, "reviewPoints", p.id, { challenges: p.challenges!.map((x, j) => (j === i ? { ...x, status: "added" as const } : x)) });
      return r;
    });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Review points</h3>
        <span className="text-xs muted">
          {open} open · {points.length - open} cleared
        </span>
      </div>
      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {points.map((p) => (
            <motion.div
              key={p.id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-xl border border-[var(--border)] px-3 py-2"
            >
              <div className="flex items-start gap-3">
                <div className="pt-0.5">
                  <Checkbox
                    checked={p.status === "cleared"}
                    label="Clear review point"
                    onChange={(on) =>
                      act(on ? "Point cleared" : "Point reopened", (ctx) =>
                        update(ctx, "reviewPoints", p.id, { status: on ? "cleared" : "open", clearedAt: on ? new Date().toISOString() : null }),
                      )
                    }
                  />
                </div>
                <p className={`flex-1 text-sm ${p.status === "cleared" ? "line-through muted" : ""}`}>{p.text}</p>
                <button
                  className="shrink-0"
                  title="Cycle status"
                  onClick={() =>
                    act(null, (ctx) => update(ctx, "reviewPoints", p.id, { status: p.status === "open" ? "addressed" : p.status === "addressed" ? "cleared" : "open" }))
                  }
                >
                  <Pill tone={statusTone[p.status]}>{labels.reviewPointStatus[p.status]}</Pill>
                </button>
              </div>
              {p.status !== "cleared" && (
                <Challenges
                  point={p}
                  busy={busy.has(p.id)}
                  onChallenge={() => void challenge(p.id, false)}
                  onRaise={(i) => void raise(p, i)}
                  onProgramme={(i) => void toProgramme(p, i)}
                  onDismiss={(i) => void act(null, (ctx) => update(ctx, "reviewPoints", p.id, { challenges: p.challenges!.map((q, j) => (j === i ? { ...q, status: "dismissed" as const } : q)) }))}
                />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <textarea
        className="input"
        rows={2}
        placeholder="Add review points, one per line (pasting a list works)"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void add();
        }}
      />
      <AnimatePresence>
        {hints.length > 0 && draft.trim() && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-xs">
              <p className="mb-1 font-semibold">While you're at it, have you also checked…</p>
              <ul className="space-y-1">
                {hints.map((h) => (
                  <li key={h.question}>
                    <span className="font-medium">{h.question}</span> <span className="muted">· {h.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button className="btn btn-soft btn-sm" onClick={add} disabled={!draft.trim()}>
        <Icon name="plus" size={14} /> Add points
      </button>
    </div>
  );
}

function Challenges({
  point,
  busy,
  onChallenge,
  onRaise,
  onProgramme,
  onDismiss,
}: {
  point: ReviewPoint;
  busy: boolean;
  onChallenge: () => void;
  onRaise: (i: number) => void;
  onProgramme: (i: number) => void;
  onDismiss: (i: number) => void;
}) {
  const [show, setShow] = useState(true);
  const all = (point.challenges ?? []).map((q, i) => ({ q, i }));
  const openOnes = all.filter(({ q }) => q.status === "open");
  const hasAi = all.some(({ q }) => q.source === "ai");
  return (
    <div className="mt-1.5 pl-8">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {openOnes.length > 0 && (
          <button className="font-semibold text-[var(--accent)]" onClick={() => setShow((s) => !s)}>
            {show ? "▾" : "▸"} Have you also checked… ({openOnes.length})
          </button>
        )}
        <button className="inline-flex items-center gap-1 muted hover:text-[var(--accent)]" onClick={onChallenge} disabled={busy}>
          <Icon name="sparkles" size={12} />
          {busy ? (
            <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.2 }}>
              AI is challenging this point…
            </motion.span>
          ) : hasAi ? (
            "Challenge again"
          ) : (
            "Challenge with AI"
          )}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {show && openOnes.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-1.5 space-y-1.5">
              <AnimatePresence initial={false}>
                {openOnes.map(({ q, i }) => (
                  <motion.div
                    key={q.question}
                    layout
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="rounded-lg border-l-2 border-[var(--accent)] bg-[var(--surface-2)] px-2.5 py-2 text-xs"
                  >
                    <p className="font-medium">
                      {q.source === "ai" && <span className="mr-1 text-[10px] font-semibold uppercase text-[var(--accent)]">AI</span>}
                      {q.question}
                    </p>
                    {q.why && <p className="muted">{q.why}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <button className="btn btn-soft btn-sm" onClick={() => onRaise(i)}>
                        Add as review point
                      </button>
                      <button className="btn btn-soft btn-sm" onClick={() => onProgramme(i)}>
                        <Icon name="plus" size={12} /> Add to programme
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => onDismiss(i)}>
                        Dismiss
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** "Have you also checked X?" → "Check X" for the programme. */
function asStep(question: string) {
  const m = question.match(/^have you (?:also )?(checked|considered|obtained|verified|reviewed|tested|compared|reconciled|confirmed)\s+(.*?)\??$/i);
  if (!m) return question.replace(/\?$/, "");
  const verb = { checked: "Check", considered: "Consider", obtained: "Obtain", verified: "Verify", reviewed: "Review", tested: "Test", compared: "Compare", reconciled: "Reconcile", confirmed: "Confirm" }[m[1].toLowerCase()];
  return `${verb} ${m[2]}`;
}
