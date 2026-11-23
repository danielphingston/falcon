// Invented plan and RFI (never real client data).
import { describe, expect, it } from "vitest";
import {
  blockerRows,
  blockersPlainText,
  confirmedInputs,
  engagementReadiness,
  guessInputs,
  inputTokens,
  linkPrompt,
  parseLinkReply,
  type Engagement,
  type InfoRequest,
  type PlanItem,
} from "../src";

const base = { createdAt: "", updatedAt: "", engagementId: "e" };
const eng = { id: "e", name: "Widget Co", ...base } as unknown as Engagement;
const rfi = (id: string, number: string, description: string, status: InfoRequest["status"], section = "General") =>
  ({ ...base, id, number, description, status, section, requestedOn: "2026-11-01", chaseLog: [], responsible: "Ravi" }) as InfoRequest;
const step = (id: string, number: string, area: string, text: string, extra: Partial<PlanItem> = {}) =>
  ({ ...base, id, number, area, text, status: "open", applicable: true, order: Number(number), ...extra }) as PlanItem;

const items = [
  rfi("r1", "1.1", "Detailed TB and GL dump as at cut-off", "received"),
  rfi("r2", "1.2", "Fixed assets register with depreciation workings", "pending", "Fixed Assets"),
  rfi("r3", "1.3", "Bank Reconciliation Statement", "received", "Bank"),
  rfi("r4", "1.4", "Purchase register for the period", "partial", "Expenses"),
  rfi("r5", "1.5", "Reconciliation of Form 26AS with books", "pending"),
];
const plan = [
  step("s1", "1", "Fixed Assets", "FAR vs BoA, vouch additions"),
  step("s2", "2", "Bank", "Verify BRS workings"),
  step("s3", "3", "Expenses", "Check GSTR 2B with expenses as per purchase register"),
  step("s4", "4", "General", "Understand the HR process"),
  step("s5", "5", "Report", "Draft report", { inputs: { rfiIds: [], extra: [], none: true, source: "manual" } }),
  step("s6", "6", "Taxes", "TDS check", { status: "closed" }),
];

describe("readiness", () => {
  it("folds audit vocabulary together", () => {
    expect(inputTokens("FAR vs BoA")).toEqual(expect.arrayContaining(["far", "boa"]));
    expect(inputTokens("Fixed assets register")).toContain("far");
    expect(inputTokens("GSTR-2B")).toContain("gstr2b");
    expect(inputTokens("Form 26 AS")).toContain("f26as");
  });

  it("guesses the RFI items a step needs, and spots inputs not on the RFI", () => {
    expect(guessInputs(plan[0], items).rfiIds).toEqual(["r2", "r1"]);
    expect(guessInputs(plan[1], items).rfiIds).toEqual(["r3"]);
    const gst = guessInputs(plan[2], items);
    expect(gst.rfiIds).toEqual(["r4"]);
    expect(gst.missing).toEqual(["GSTR-2B"]);
    expect(guessInputs(plan[3], items)).toEqual({ rfiIds: [], missing: [] });
  });

  it("treats the matcher's links as suggestions: nothing counts until confirmed", () => {
    const r = engagementReadiness(eng, plan, items, "2026-11-23");
    // s5 was set by hand ("no client input"): confirmed, so it counts.
    expect(r.ready.map((s) => s.step.id)).toEqual(["s5"]);
    expect(r.blocked).toEqual([]);
    expect(r.byInput).toEqual([]);
    expect(r.suggested.map((s) => [s.step.id, s.source, s.wouldBe])).toEqual([
      ["s1", "auto", "blocked"],
      ["s2", "auto", "ready"],
      ["s3", "auto", "blocked"],
    ]);
    expect(r.unlinked.map((s) => s.step.id)).toEqual(["s4"]);
    expect(blockerRows([r])).toEqual([]);
  });

  it("sorts confirmed steps into ready and blocked, with reasons", () => {
    const first = engagementReadiness(eng, plan, items, "2026-11-23");
    // Confirm every suggestion as it is.
    const confirmed = plan.map((p) => {
      const s = first.suggested.find((x) => x.step.id === p.id);
      return s ? { ...p, inputs: confirmedInputs(s) } : p;
    });
    expect(confirmed[0].inputs).toMatchObject({ source: "manual", suggestedBy: "matcher" });
    const r = engagementReadiness(eng, confirmed, items, "2026-11-23");
    expect(r.suggested).toEqual([]);
    expect(r.ready.map((s) => s.step.id)).toEqual(["s2", "s5"]);
    expect(r.blocked.map((s) => s.step.id)).toEqual(["s1", "s3"]);
    expect(r.unlinked.map((s) => s.step.id)).toEqual(["s4"]);
    const gst = r.blocked[1];
    expect(gst.blockers.map((b) => [b.input, b.state])).toEqual([
      ["Purchase register for the period", "partial"],
      ["GSTR-2B", "not_requested"],
    ]);
    expect(r.blocked[0].blockers[0]).toMatchObject({ rfiNumber: "1.2", daysWaiting: 22, from: "Ravi" });
    expect(r.byInput.map((g) => [g.blocker.input.slice(0, 15), g.steps.length])).toEqual([
      ["Fixed assets re", 1],
      ["Purchase regist", 1],
      ["GSTR-2B", 1],
    ]);
    expect(blockerRows([r])).toHaveLength(3);
    const text = blockersPlainText([r]);
    expect(text).toContain("Widget Co: 2 steps can be executed now, 2 blocked.");
    expect(text).toContain("GSTR-2B: not on the RFI (not requested yet)");
    expect(text).toContain("RFI 1.2 Fixed assets register with depreciation workings: not received, 22d since requested (with Ravi)");
  });

  it("an AI suggestion replaces the matcher's, but still needs confirming", () => {
    // s2's matcher suggestion is RFI 1.3 (BRS); the AI suggests RFI 1.1 plus an input not on the RFI.
    const ai = [{ ...plan[1], inputs: { rfiIds: ["r1"], extra: [{ name: "Bank statements", received: false }], source: "ai" as const } }];
    const r = engagementReadiness(eng, ai, items, "2026-11-23");
    expect(r.ready).toEqual([]);
    expect(r.blocked).toEqual([]);
    expect(r.suggested[0]).toMatchObject({ source: "ai", wouldBe: "blocked", received: [{ rfiNumber: "1.1" }], blockers: [{ input: "Bank statements", state: "not_requested" }] });
    expect(confirmedInputs(r.suggested[0])).toEqual({ rfiIds: ["r1"], extra: [{ name: "Bank statements", received: false }], none: undefined, source: "manual", suggestedBy: "ai" });
    // Confirmed: now it counts.
    const after = engagementReadiness(eng, [{ ...ai[0], inputs: confirmedInputs(r.suggested[0]) }], items, "2026-11-23");
    expect(after.blocked.map((s) => s.step.id)).toEqual(["s2"]);
  });

  it("the exports say how many steps aren't confirmed yet", () => {
    const withOneConfirmed = plan.map((p) => (p.id === "s1" ? { ...p, inputs: { rfiIds: ["r2"], extra: [], source: "manual" as const } } : p));
    const r = engagementReadiness(eng, withOneConfirmed, items, "2026-11-23");
    expect(blockersPlainText([r])).toContain("Widget Co: 1 steps can be executed now, 1 blocked (2 more steps not confirmed yet, not included).");
  });

  it("reads the AI's links", () => {
    expect(linkPrompt({ engagement: "Widget Co", steps: plan.slice(0, 2), rfi: items })).toContain("S2 [Bank] Verify BRS workings");
    const reply = '```json\n{"links":[{"step":"S1","rfi":["1.2","#1.1","9.9"],"missing":[]},{"step":"S2","rfi":[],"missing":[],"none":true},{"step":"S7","rfi":["1.1"]}]}\n```';
    expect(parseLinkReply(reply, plan.slice(0, 2), items)).toEqual([
      { stepId: "s1", rfiIds: ["r2", "r1"], extra: [], none: false },
      { stepId: "s2", rfiIds: [], extra: [], none: true },
    ]);
    expect(parseLinkReply("not json", plan, items)).toEqual([]);
  });
});
