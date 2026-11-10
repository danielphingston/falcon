import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  answerCue,
  challengePrompt,
  inferAreas,
  parseChallengeReply,
  procedureLibrary,
  relatedChecks,
  reviewCues,
  type Ctx,
} from "../src";

describe("review assist", () => {
  it("infers areas from a work paper title", () => {
    expect(inferAreas("C.4 Trade receivables")).toEqual(["receivables"]);
    expect(inferAreas("NWC analysis")).toEqual(["receivables", "inventory", "payables"]);
    expect(inferAreas("Net debt and debt-like items")).toContain("borrowings");
    expect(inferAreas("Random memo")).toEqual([]);
  });

  it("asks library cues, then keeps their order once answered", async () => {
    const store = new MemoryStore();
    const ctx: Ctx = { store, by: "app" };
    const base = { library: procedureLibrary, areas: ["receivables" as const], kind: "audit" as const, industry: "generic" as const, workpaperId: "wp1" };
    const before = reviewCues({ ...base, items: [] });
    expect(before.length).toBeGreaterThan(4);
    expect(before[0].core).toBe(true);
    expect(before.every((c) => !c.itemId)).toBe(true);

    const id = await answerCue(ctx, before[1], { engagementId: "e1", workpaperId: "wp1", library: procedureLibrary }, "flagged", "3 debtors > 180 days");
    const items = await store.list("programItems");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, review: "flagged", reviewNote: "3 debtors > 180 days", workpaperId: "wp1", status: "in_progress" });

    const after = reviewCues({ ...base, items });
    expect(after.map((c) => c.text)).toEqual(before.map((c) => c.text));
    expect(after[1]).toMatchObject({ itemId: id, review: "flagged" });

    await answerCue(ctx, after[1], { engagementId: "e1", workpaperId: "wp1", library: procedureLibrary }, "ok");
    expect((await store.get("programItems", id))?.review).toBe("ok");
  });

  it("uses only programme steps when a programme exists", () => {
    const item = { id: "i1", engagementId: "e1", area: "receivables", text: "Custom step", assertions: [], source: "manual", core: false, status: "todo", review: "none", order: 1, createdAt: "", updatedAt: "" } as never;
    const cues = reviewCues({ library: procedureLibrary, areas: ["receivables"], kind: "audit", industry: "generic", items: [item], fromProgramme: true });
    expect(cues.map((c) => c.text)).toEqual(["Custom step"]);
  });

  it("finds related checks for a review point offline", () => {
    const qs = relatedChecks("Ageing not tied to the TB; old debtors not provided for", procedureLibrary, ["receivables"], "audit");
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.length).toBeLessThanOrEqual(4);
    expect(qs.every((q) => q.question && q.why)).toBe(true);
    expect(relatedChecks("ok", procedureLibrary, ["receivables"], "audit")).toEqual([]);
  });

  it("builds the AI prompt and reads its JSON reply", () => {
    const p = challengePrompt({ engagement: "Falcon", kind: "fdd", industry: "d2c", workpaper: "C.4 Trade receivables", areas: ["receivables"], point: "Provide ageing", otherPoints: [], facts: ["Receivables +33% vs revenue +10%"], done: [] });
    expect(p).toContain("financial due diligence");
    expect(p).toContain("Receivables +33%");
    const text = '```json\n{"questions":[{"question":"Have you also checked credit notes after year end?","why":"Cut-off."},{"why":"no question"}]}\n```';
    expect(parseChallengeReply(text)).toEqual([{ question: "Have you also checked credit notes after year end?", why: "Cut-off." }]);
    expect(parseChallengeReply("not json")).toEqual([]);
  });
});
