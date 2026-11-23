/**
 * Work plan readiness: which steps can be executed with the inputs received so
 * far (from the RFI), and which are blocked, and by what.
 *
 * Each step needs some inputs: RFI items, plus inputs that were never put on
 * the RFI ("GSTR-2B"). Those come from, in order: what the user set by hand,
 * what the AI suggested, or an offline match on audit vocabulary (FAR = fixed
 * asset register, BRS = bank reconciliation, BoA = books / TB / GL…).
 */
import type { Engagement, InfoRequest, PlanItem } from "./schema";
import { daysBetween } from "./dates";

// ---------- Vocabulary ----------

/**
 * Audit terms folded into one token each, so "FAR" and "Fixed assets register"
 * meet. `label` marks a document/data the client provides: when a step needs
 * one and no RFI item mentions it, it's reported as missing from the RFI.
 */
const TERMS: { token: string; re: RegExp; label?: string }[] = [
  { token: "gstr2b", re: /gstr[\s-]*2b/g, label: "GSTR-2B" },
  { token: "gstr2a", re: /gstr[\s-]*2a/g, label: "GSTR-2A" },
  { token: "gstr3b", re: /gstr[\s-]*3b/g, label: "GSTR-3B" },
  { token: "gstr1", re: /gstr[\s-]*1\b/g, label: "GSTR-1" },
  { token: "gstr9", re: /gstr[\s-]*9c?\b/g, label: "GSTR-9 / 9C" },
  { token: "f26as", re: /(form\s*)?26\s*as\b/g, label: "Form 26AS" },
  { token: "ais", re: /\bais\b|annual information statement/g, label: "AIS / TIS" },
  { token: "far", re: /\bfar\b|fixed assets? register|assets? register/g, label: "Fixed asset register" },
  { token: "brs", re: /\bbrs\b|bank reconcil\w*/g, label: "Bank reconciliation" },
  { token: "boa", re: /\bboa\b|books? of accounts?|\btb\b|trial balance|gl dump|general ledger|\bgl\b|ledgers?/g, label: "Books of account (TB / GL)" },
  { token: "mis", re: /\bmis\b|management information/g, label: "MIS" },
  { token: "captable", re: /\bcap table\b|capital table/g, label: "Cap table" },
  { token: "sha", re: /\bsha\b|shareholders?'? agreement/g, label: "Shareholders' agreement" },
  { token: "ssa", re: /\bssa\b|share subscription agreement/g, label: "Share subscription agreement" },
  { token: "sharetransfer", re: /\bbenpos\b|\bsh-?4\b|share transfers?/g, label: "BENPOS / share transfers" },
  { token: "mca", re: /\bmca\b|\broc\b|registrar of companies/g, label: "MCA filings" },
  { token: "ccd", re: /\bccds?\b|convertible debentures?/g, label: "CCD agreements" },
  { token: "esop", re: /\besops?\b|stock options?/g, label: "ESOP documents" },
  { token: "fnf", re: /\bfnf\b|full (and|&) final/g, label: "Full & final settlements" },
  { token: "payroll", re: /pay\s*register|payroll|salary register|salaries/g, label: "Payroll register" },
  { token: "challan", re: /challans?/g, label: "Statutory challans" },
  { token: "actuarial", re: /actuarial/g, label: "Actuarial valuation report" },
  { token: "headcount", re: /head\s*count|manpower/g },
  { token: "incentive", re: /variable pay|incentives?/g },
  { token: "reimbursement", re: /reimburse\w*|employee claims?/g },
  { token: "ubr", re: /\bubr\b|unbilled revenue/g, label: "UBR workings" },
  { token: "uer", re: /\buer\b|unearned revenue/g, label: "UER workings" },
  { token: "mrr", re: /\bc?mrr\b/g, label: "CMRR / MRR extract" },
  { token: "nrr", re: /\bnrr\b/g },
  { token: "mutualfund", re: /mutual funds?|\bmfs?\b/g, label: "Mutual fund statements" },
  { token: "fd", re: /fixed\s*\/\s*term deposits?|fixed deposits?|term deposits?|\bfds?\b/g, label: "FD statements" },
  { token: "interest", re: /interest (certificates?|statements?)/g },
  { token: "creditcard", re: /credit cards?|corporate cards?/g, label: "Credit card statements" },
  { token: "bankstatement", re: /bank statements?/g, label: "Bank statements" },
  { token: "confirmation", re: /balance confirmations?|confirmations?/g, label: "Balance confirmations" },
  { token: "intercompany", re: /inter[\s-]?company/g },
  { token: "relatedparty", re: /related part(y|ies)/g, label: "Related party list" },
  { token: "creditnote", re: /credit notes?/g, label: "Credit notes" },
  { token: "physicalverification", re: /physical verification/g, label: "Physical verification report" },
  { token: "impairment", re: /impairment/g },
  { token: "lease", re: /lease\w*|right[\s-]to[\s-]use/g, label: "Lease agreements" },
  { token: "ticket", re: /tickets?/g },
  { token: "presales", re: /sales pipeline|pre[\s-]*sales|\bleads?\b/g },
  { token: "customermaster", re: /customer (level )?master/g, label: "Customer master" },
  { token: "onboarding", re: /onboard\w*/g },
  { token: "invoice", re: /invoic\w*|billings?\b/g },
  { token: "agreement", re: /agreements?|contracts?/g },
  { token: "ageing", re: /ageing|aging/g, label: "Ageing report" },
  { token: "collection", re: /collections?|reali[sz]ations?/g },
  { token: "receivable", re: /\bar\b|accounts? receivables?|receivables?|debtors?/g },
  { token: "payable", re: /\bap\b|accounts? payables?|payables?|creditors?/g },
  { token: "depreciation", re: /depreciation|amorti[sz]ation/g },
  { token: "vapt", re: /vulnerability|penetration|\bvapt\b/g, label: "VAPT report" },
  { token: "bcp", re: /business continuity|\bbcp\b/g, label: "Business continuity plan" },
  { token: "backup", re: /backups?/g },
  { token: "access", re: /passwords?|access controls?/g },
  { token: "financials", re: /audit report|\bsfs\b|financial statements?|financials/g, label: "Financial statements" },
  { token: "boardresolution", re: /board resolutions?/g, label: "Board resolutions" },
  { token: "gst", re: /\bgst\b/g },
  { token: "tds", re: /\btds\b/g },
  { token: "stock", re: /\bstock\b|inventor(y|ies)/g },
];

const STOP = new Set(
  (
    "a an the of and or for with to in on at by as is are be from into per vs v b w r t wrt if any all each its their " +
    "review reviewed reviewing check checks checking verify verifying verification obtain understand understanding document documented " +
    "details detail workings working process processes flow flows period cut off date along basis sample samples supporting supportings " +
    "analysis report reports data list including include etc mom month during till upto latest complete completed other others " +
    "required requirement maintained maintenance maintaining kindly provide provided details w.r.t such same well also"
  ).split(" "),
);

/** Folds audit terms into tokens and drops filler words. */
export function inputTokens(text: string): string[] {
  let s = ` ${text.toLowerCase()} `.replace(/[’']/g, "'");
  const out: string[] = [];
  for (const t of TERMS)
    s = s.replace(t.re, () => {
      out.push(t.token);
      return " ";
    });
  for (const w of s.split(/[^a-z0-9]+/)) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.push(w.replace(/(ies)$/, "y").replace(/(?<=[a-z]{3})s$/, ""));
  }
  return [...new Set(out)];
}

const TERM_TOKENS = new Set(TERMS.map((t) => t.token));
/** Terms too common on an RFI to link a step by themselves. */
const WEAK = new Set(["agreement", "invoice", "gst", "tds", "collection", "receivable", "payable", "impairment", "interest", "boa", "depreciation", "onboarding", "incentive", "headcount", "access", "backup", "stock"]);
const LABEL = new Map(TERMS.filter((t) => t.label).map((t) => [t.token, t.label!]));

// ---------- Matching ----------

export interface InputGuess {
  rfiIds: string[];
  /** Client documents the step mentions that no RFI item asks for. */
  missing: string[];
}

/**
 * Offline guess at the RFI items a step needs: items that share a specific
 * term with it (weighted by how rare the term is on this RFI), with a small
 * nudge for the same area. Also reports client documents the step names that
 * nobody requested.
 */
export function guessInputs(step: Pick<PlanItem, "text" | "area" | "lead">, rfi: Pick<InfoRequest, "id" | "description" | "section" | "subsection">[]): InputGuess {
  const docs = rfi.map((r) => ({ r, toks: new Set(inputTokens(`${r.description} ${r.subsection ?? ""}`)), area: new Set(inputTokens(r.section ?? "")) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.toks) df.set(t, (df.get(t) ?? 0) + 1);
  const n = Math.max(docs.length, 1);
  const idf = (t: string) => Math.log(1 + n / (df.get(t) ?? 0.5));
  const toks = inputTokens(`${step.lead ?? ""} ${step.text}`);
  const areaToks = new Set(inputTokens(step.area));
  const scored = docs
    .map((d) => {
      const shared = toks.filter((t) => d.toks.has(t));
      // A link needs an audit term in common ("FAR", "26AS", "invoice"), or two rare
      // ordinary words ("long outstanding"); one common word ("transaction") isn't enough.
      // Generic terms ("agreement", "invoice", "GST") need a second word in common.
      const specific = shared.filter((t) => TERM_TOKENS.has(t) && !WEAK.has(t)).length;
      const rarePlain = shared.filter((t) => !TERM_TOKENS.has(t) && (df.get(t) ?? 0) <= 2).length;
      // "… vs BoA" always needs the books themselves (the TB / GL item).
      const books = shared.includes("boa") && [...d.toks].every((t) => !TERM_TOKENS.has(t) || t === "boa");
      const multi = shared.length >= 2 && shared.some((t) => TERM_TOKENS.has(t));
      const strong = specific > 0 || books || multi || rarePlain >= 2;
      let score = shared.reduce((a, t) => a + idf(t), 0);
      // The item is about a document the step doesn't mention ("26AS and BoA" for a "BoA" step): weaker.
      score -= 0.4 * [...d.toks].filter((t) => LABEL.has(t) && !toks.includes(t)).reduce((a, t) => a + idf(t), 0);
      if ([...areaToks].some((t) => d.area.has(t) || d.toks.has(t))) score += 0.6;
      return { d, score, strong, books };
    })
    .filter((x) => x.books || (x.strong && x.score >= 1.8))
    .sort((a, b) => b.score - a.score);
  const top = Math.max(0, ...scored.filter((x) => !x.books).map((x) => x.score));
  // Keep the close runners-up (a step often needs a couple of items), plus the books for "… vs BoA".
  const picked = scored.filter((x) => !x.books && x.score >= top * 0.6).slice(0, 4);
  picked.push(...scored.filter((x) => x.books).slice(0, 2));
  return { rfiIds: picked.map((x) => x.d.r.id), missing: missingFrom(toks, docs) };
}

function missingFrom(toks: string[], docs: { toks: Set<string> }[]): string[] {
  const asked = new Set(docs.flatMap((d) => [...d.toks]));
  return toks.filter((t) => LABEL.has(t) && !asked.has(t)).map((t) => LABEL.get(t)!);
}

// ---------- Readiness ----------

export type Readiness = "ready" | "blocked" | "unlinked";

export interface Blocker {
  /** What is missing, e.g. "Fixed asset register". */
  input: string;
  /** RFI number when the input is on the RFI. */
  rfiNumber?: string;
  rfiId?: string;
  /** "pending" | "partial" on the RFI, or "not_requested" when it isn't on the RFI at all. */
  state: "pending" | "partial" | "not_requested";
  requestedOn?: string;
  daysWaiting?: number;
  /** Who at the client is responsible, as written on the RFI. */
  from?: string;
}

export interface StepReadiness {
  step: PlanItem;
  state: Readiness;
  /** Inputs the step needs that have come in. */
  received: { input: string; rfiNumber?: string; rfiId?: string }[];
  blockers: Blocker[];
  /** Where the links came from. */
  source: "manual" | "ai" | "auto" | "none";
}

export interface EngagementReadiness {
  engagement: Engagement;
  steps: StepReadiness[];
  ready: StepReadiness[];
  blocked: StepReadiness[];
  unlinked: StepReadiness[];
  /** Missing inputs with the steps each one holds up, most-blocking first. */
  byInput: { blocker: Blocker; steps: PlanItem[] }[];
}

const DONE = new Set(["received", "na"]);

/**
 * Readiness of every open, applicable step of one engagement's work plan.
 * `people` resolves RFI contacts to names for the "from" column.
 */
export function engagementReadiness(
  engagement: Engagement,
  plan: PlanItem[],
  rfi: InfoRequest[],
  today: string,
  personName: (id: string) => string | undefined = () => undefined,
): EngagementReadiness {
  const items = rfi.filter((r) => !r.deleted && r.engagementId === engagement.id);
  const byId = new Map(items.map((r) => [r.id, r]));
  const steps = plan
    .filter((i) => !i.deleted && i.engagementId === engagement.id && i.applicable && i.status !== "closed")
    .sort((a, b) => a.order - b.order);

  const out: StepReadiness[] = steps.map((step) => {
    const set = step.inputs;
    const guess = set ? undefined : guessInputs(step, items);
    const rfiIds = (set?.rfiIds ?? guess!.rfiIds).filter((id) => byId.has(id));
    const extra = set?.extra ?? guess!.missing.map((name) => ({ name, received: false }));
    const source = set ? set.source : rfiIds.length || extra.length ? "auto" : "none";
    if (set?.none) return { step, state: "ready", received: [], blockers: [], source };
    const received: StepReadiness["received"] = [];
    const blockers: Blocker[] = [];
    for (const id of rfiIds) {
      const r = byId.get(id)!;
      if (DONE.has(r.status)) received.push({ input: r.description, rfiNumber: r.number, rfiId: r.id });
      else
        blockers.push({
          input: r.description,
          rfiNumber: r.number,
          rfiId: r.id,
          state: r.status === "partial" ? "partial" : "pending",
          requestedOn: r.requestedOn,
          daysWaiting: r.requestedOn ? Math.max(0, daysBetween(r.requestedOn, today)) : undefined,
          from: (r.requestedFromId && personName(r.requestedFromId)) || r.responsible,
        });
    }
    for (const x of extra) (x.received ? received.push({ input: x.name }) : blockers.push({ input: x.name, state: "not_requested" }));
    const state: Readiness = blockers.length ? "blocked" : received.length ? "ready" : "unlinked";
    return { step, state, received, blockers, source };
  });

  const map = new Map<string, { blocker: Blocker; steps: PlanItem[] }>();
  for (const s of out)
    for (const b of s.blockers) {
      const k = b.rfiId ?? `x:${b.input.toLowerCase()}`;
      const g = map.get(k) ?? { blocker: b, steps: [] };
      g.steps.push(s.step);
      map.set(k, g);
    }
  return {
    engagement,
    steps: out,
    ready: out.filter((s) => s.state === "ready"),
    blocked: out.filter((s) => s.state === "blocked"),
    unlinked: out.filter((s) => s.state === "unlinked"),
    byInput: [...map.values()].sort((a, b) => b.steps.length - a.steps.length || (b.blocker.daysWaiting ?? 0) - (a.blocker.daysWaiting ?? 0)),
  };
}

/** One line on why a step can't be done yet. */
export function blockerText(b: Blocker): string {
  const what = `${b.rfiNumber ? `RFI ${b.rfiNumber} ` : ""}${b.input}`;
  if (b.state === "not_requested") return `${b.input}: not on the RFI (not requested yet)`;
  const wait = b.daysWaiting !== undefined ? `, ${b.daysWaiting}d since requested` : "";
  return `${what}: ${b.state === "partial" ? "only partly received" : "not received"}${wait}${b.from ? ` (with ${b.from})` : ""}`;
}

// ---------- Export ----------

export const BLOCKER_HEAD = ["Engagement", "Step", "Area", "Work plan step", "Person responsible", "Cannot be done because", "RFI no.", "Status", "Days waiting", "With (client)"];

/** One row per step × missing input, for the manager's sheet. */
export function blockerRows(list: EngagementReadiness[]): string[][] {
  const rows: string[][] = [];
  for (const e of list)
    for (const s of e.blocked)
      for (const b of s.blockers)
        rows.push([
          e.engagement.name,
          s.step.number,
          s.step.area,
          s.step.text.split("\n")[0],
          s.step.assignee ?? "",
          b.input,
          b.rfiNumber ?? "",
          b.state === "not_requested" ? "Not on the RFI" : b.state === "partial" ? "Partly received" : "Pending",
          b.daysWaiting === undefined ? "" : String(b.daysWaiting),
          b.from ?? "",
        ]);
  return rows;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Email-ready table (pastes into Outlook / Gmail as a table). */
export function blockerHtml(list: EngagementReadiness[]): string {
  const td = 'style="border:1px solid #bbb;padding:4px 8px;font-family:Calibri,Arial,sans-serif;font-size:11pt;vertical-align:top"';
  const th = td.replace('style="', 'style="background:#f2f2f2;font-weight:bold;');
  const parts: string[] = [];
  for (const e of list) {
    if (!e.blocked.length) continue;
    parts.push(
      `<p style="font-family:Calibri,Arial,sans-serif;font-size:11pt"><b>${esc(e.engagement.name)}</b>: ${e.ready.length} step${e.ready.length === 1 ? "" : "s"} can be executed now, ${e.blocked.length} blocked.</p>`,
      `<table style="border-collapse:collapse"><tr>${["Step", "Area", "Work plan step", "Person", "Cannot be done because"].map((h) => `<th ${th}>${h}</th>`).join("")}</tr>` +
        e.blocked
          .map(
            (s) =>
              `<tr><td ${td}>${esc(s.step.number)}</td><td ${td}>${esc(s.step.area)}</td><td ${td}>${esc(s.step.text.split("\n")[0])}</td><td ${td}>${esc(s.step.assignee ?? "")}</td><td ${td}>${s.blockers.map((b) => esc(blockerText(b))).join("<br>")}</td></tr>`,
          )
          .join("") +
        `</table>`,
    );
  }
  return parts.join("");
}

/** Plain-text version for email bodies and chat. */
export function blockersPlainText(list: EngagementReadiness[]): string {
  const out: string[] = [];
  for (const e of list) {
    if (!e.blocked.length) continue;
    out.push(`${e.engagement.name}: ${e.ready.length} steps can be executed now, ${e.blocked.length} blocked.`, "");
    for (const s of e.blocked) {
      out.push(`${s.step.number} ${s.step.area}: ${s.step.text.split("\n")[0]}${s.step.assignee ? ` [${s.step.assignee}]` : ""}`);
      for (const b of s.blockers) out.push(`   - ${blockerText(b)}`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}

// ---------- AI linking ----------

/** Prompt asking the AI which RFI items each step needs, and what's missing from the RFI. */
export function linkPrompt(opts: {
  engagement: string;
  kind?: string;
  steps: Pick<PlanItem, "id" | "number" | "area" | "lead" | "text">[];
  rfi: Pick<InfoRequest, "number" | "section" | "subsection" | "description">[];
}): string {
  const steps = opts.steps.map((s, i) => `S${i + 1} [${s.area}] ${s.lead ? `${s.lead}: ` : ""}${s.text.replace(/\s+/g, " ")}`).join("\n");
  const rfi = opts.rfi.map((r) => `${r.number} [${[r.section, r.subsection].filter(Boolean).join(" › ")}] ${r.description.replace(/\s+/g, " ")}`).join("\n");
  return `You are an audit senior in India planning fieldwork for ${opts.engagement}${opts.kind ? ` (${opts.kind})` : ""}.

For each work plan step below, decide which client inputs it needs before the team can execute it:
- "rfi": the numbers of the RFI items (information requested from the client) the step needs. Only items that are actually needed to do the step; usually 1-3. Include the books (TB / GL) when the step compares something to the books (BoA).
- "missing": short names of client documents or data the step clearly needs that are NOT on the RFI (e.g. "GSTR-2B for the period", "Shareholders' agreement"). Leave empty when the RFI covers it. Don't list things the team prepares itself.
- "none": true only when the step needs no client input at all (e.g. drafting the report, internal planning).

Work plan steps:
${steps}

RFI items:
${rfi}

Reply with JSON only: {"links":[{"step":"S1","rfi":["1.1"],"missing":[],"none":false}, ...]} with one entry per step.`;
}

export interface AiLink {
  stepId: string;
  rfiIds: string[];
  extra: string[];
  none: boolean;
}

/** Reads the AI's reply into links, keeping only RFI numbers that exist. */
export function parseLinkReply(
  reply: string,
  steps: Pick<PlanItem, "id">[],
  rfi: Pick<InfoRequest, "id" | "number">[],
): AiLink[] {
  let data: unknown;
  try {
    data = JSON.parse(reply.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return [];
  }
  const list = (Array.isArray(data) ? data : (data as { links?: unknown })?.links) as unknown[];
  if (!Array.isArray(list)) return [];
  const byNumber = new Map(rfi.map((r) => [r.number.trim(), r.id]));
  const out: AiLink[] = [];
  for (const x of list) {
    const o = x as { step?: unknown; rfi?: unknown; missing?: unknown; none?: unknown };
    const idx = Number(String(o.step ?? "").replace(/^S/i, "")) - 1;
    const step = steps[idx];
    if (!step) continue;
    const ids = (Array.isArray(o.rfi) ? o.rfi : []).map((n) => byNumber.get(String(n).replace(/^#/, "").trim())).filter((id): id is string => !!id);
    const extra = (Array.isArray(o.missing) ? o.missing : []).map((m) => String(m).trim()).filter(Boolean).slice(0, 5);
    out.push({ stepId: step.id, rfiIds: [...new Set(ids)], extra, none: o.none === true && !ids.length && !extra.length });
  }
  return out;
}
