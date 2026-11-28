// Build brief v2 A8: guided review built from the linked worksteps. Invented data only.
import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  addCheckForNextTime,
  answerReviewItem,
  checkSetFor,
  create,
  loadSnapshot,
  matchFirmItems,
  pointOwner,
  saveStepChecks,
  scopedReview,
  stepParts,
  suggestStepChecks,
  type Ctx,
} from "../src";

const NOW = new Date("2026-11-28T09:00:00Z");
const MOM = "Invoicing check - client-wise MoM, recurring and non-recurring, BoA vs invoicing sheet";

async function seed() {
  const store = new MemoryStore({ myName: "Test User" });
  const ctx: Ctx = { store, by: "app", now: () => NOW };
  const e = (await create(ctx, "engagements", { name: "Project Lark" })).record;
  const dev = (await create(ctx, "people", { name: "Dev Nair", role: "team" })).record;
  const rfi = (await create(ctx, "infoRequests", { engagementId: e.id, number: "3.1", description: "Invoicing sheet for all months", requestedOn: "2026-11-01", status: "received" })).record;
  const step = (await create(ctx, "planItems", { engagementId: e.id, number: "7.1", area: "Sales", text: MOM, assignee: "Dev", inputs: { rfiIds: [rfi.id], extra: [], source: "manual" } })).record;
  const wp = (await create(ctx, "workpapers", { engagementId: e.id, ref: "7.1", title: "Revenue MoM", myRole: "reviewer", preparerId: dev.id, status: "prepared" })).record;
  await create(ctx, "planItems", { engagementId: e.id, number: "7.2", area: "Sales", text: "Agreement vs BoA" });
  const { update } = await import("../src");
  await update(ctx, "planItems", step.id, { workpaperId: wp.id });
  return { store, ctx, e, dev, rfi, step, wp };
}

describe("checks from the step itself", () => {
  it("splits the checks a step names", () => {
    expect(stepParts(MOM)).toEqual(["client-wise MoM", "recurring and non-recurring", "BoA vs invoicing sheet"]);
  });
  it("matches firm-library items by keywords, MoM → month on month", () => {
    const items = [
      { key: "a", title: "Month on month analysis", tests: [] },
      { key: "b", title: "Compliance with AS 9", tests: ["Recognition policy"] },
      { key: "c", title: "Check with 26AS" },
    ];
    expect(matchFirmItems(MOM, items).map((x) => x.key)).toEqual(["a"]);
  });
});

describe("scoped review (A8)", () => {
  it("shows basics + the linked step and its checks, not the whole area library", async () => {
    const s = await seed();
    let snap = await loadSnapshot(s.store);
    let r = scopedReview(snap, (await s.store.get("workpapers", s.wp.id))!, { reviewBasics: ["Period covered", "Figures agree to BoA / TB", "Sources referenced", "Casting checked", "Conclusion written"] });
    expect(r.basics.length).toBe(5);
    expect(r.steps.length).toBe(1);
    expect(r.steps[0].needsChecks).toBe(true);
    // Before set-up: the step itself and its input.
    expect(r.steps[0].items.map((i) => i.kind)).toEqual(["step", "input"]);
    // The reviewer keeps the suggested checks once, saved by step text.
    const sug = suggestStepChecks(s.step, snap);
    await saveStepChecks(s.ctx, s.step, sug);
    snap = await loadSnapshot(s.store);
    r = scopedReview(snap, (await s.store.get("workpapers", s.wp.id))!, { reviewBasics: [] });
    expect(r.steps[0].needsChecks).toBe(false);
    expect(r.total).toBe(5 + 1 + 3 + 1); // default basics, step, 3 parts, input
    expect(r.total).toBeLessThan(18);
  });

  it("asks once per step text: a second workpaper (or engagement) with 7.1 gets the same checks", async () => {
    const s = await seed();
    await saveStepChecks(s.ctx, s.step, [{ text: "MoM totals agree to BoA", source: "manual" }]);
    const other = (await create(s.ctx, "engagements", { name: "Project Lark II" })).record;
    const again = (await create(s.ctx, "planItems", { engagementId: other.id, number: "7.1", area: "Sales", text: `${MOM}.` })).record;
    const sets = (await loadSnapshot(s.store)).checkSets;
    expect(checkSetFor(again, sets)?.checks.map((c) => c.text)).toEqual(["MoM totals agree to BoA"]);
  });

  it("⚑ raises one review point owned by the preparer, with the step number", async () => {
    const s = await seed();
    const key = `step:${s.step.id}`;
    const r1 = await answerReviewItem(s.ctx, s.wp.id, key, { answer: "flagged", note: "UK entity missing", itemText: "Invoicing check", stepId: s.step.id });
    expect(r1.point?.text).toBe("7.1 · Invoicing check: UK entity missing");
    expect(r1.point?.planItemId).toBe(s.step.id);
    expect(pointOwner(r1.point!, r1.workpaper)).toBe(s.dev.id);
    expect(r1.workpaper.status).toBe("points_raised");
    expect(r1.workpaper.reviewStartedAt).toBeTruthy();
    // Flagging again doesn't raise a second point.
    await answerReviewItem(s.ctx, s.wp.id, key, { answer: "flagged" });
    expect((await s.store.list("reviewPoints")).length).toBe(1);
  });

  it("a not-done item shows the open item that explains it", async () => {
    const s = await seed();
    const { update } = await import("../src");
    await update(s.ctx, "workpapers", s.wp.id, { openItems: [{ id: "o1", text: "Invoicing sheet for Oct pending", rfiItemId: s.rfi.id, resolved: false }] });
    await answerReviewItem(s.ctx, s.wp.id, `input:${s.step.id}:${s.rfi.id}`, { prep: "not_done" });
    const r = scopedReview(await loadSnapshot(s.store), (await s.store.get("workpapers", s.wp.id))!, { reviewBasics: [] });
    const input = r.steps[0].items.find((i) => i.kind === "input")!;
    expect(input.openItems).toEqual([{ text: "Invoicing sheet for Oct pending", rfiNumber: "3.1" }]);
  });

  it("a check for next time becomes a procedure on the step", async () => {
    const s = await seed();
    await addCheckForNextTime(s.ctx, s.step.id, "Tie Oct invoices to Zoho", "Missed last round", s.wp);
    const step = (await s.store.get("planItems", s.step.id))!;
    expect(step.procedures?.[0]).toMatchObject({ text: "Tie Oct invoices to Zoho", addedFromReview: "7.1", done: false });
    const r = scopedReview(await loadSnapshot(s.store), (await s.store.get("workpapers", s.wp.id))!, { reviewBasics: [] });
    expect(r.steps[0].items.some((i) => i.kind === "procedure")).toBe(true);
  });
});
