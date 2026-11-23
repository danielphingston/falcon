// Invented plan and RFI (never real client data).
import { describe, expect, it } from "vitest";
import {
  blockerRows,
  blockersPlainText,
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

  it("sorts open steps into ready, blocked and not linked, with reasons", () => {
    const r = engagementReadiness(eng, plan, items, "2026-11-23");
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

  it("uses links set by hand or by the AI instead of the guess", () => {
    const set = [{ ...plan[3], inputs: { rfiIds: ["r1"], extra: [{ name: "HR policy", received: true }], source: "ai" as const } }];
    const r = engagementReadiness(eng, set, items, "2026-11-23");
    expect(r.ready[0]).toMatchObject({ source: "ai", received: [{ rfiNumber: "1.1" }, { input: "HR policy" }] });
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
