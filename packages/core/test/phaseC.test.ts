// Build brief Phase C: review point owners (3.3), chase cadence (4.2), Today order (5.1, 5.2). Invented data only.
import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  computeToday,
  create,
  createInfoRequest,
  criticalityOf,
  isCarried,
  loadSnapshot,
  nextChaseDate,
  pointOwner,
  runTool,
  undoBatch,
  update,
  type Ctx,
} from "../src";

const NOW = new Date("2026-11-25T10:00:00Z"); // Wednesday
const setup = () => {
  const store = new MemoryStore({ myName: "Test User" });
  const ctx: Ctx = { store, by: "app", now: () => NOW };
  return { store, ctx };
};
const crit = (value: string) => ({ fields: [{ label: "Criticality", value }] });

describe("chase cadence by criticality (4.2)", () => {
  it("reads criticality, blank and odd spellings as Medium", () => {
    expect(criticalityOf(crit("High"))).toBe("high");
    expect(criticalityOf(crit("Low "))).toBe("low");
    expect(criticalityOf(crit(""))).toBe("medium");
    expect(criticalityOf({})).toBe("medium");
    expect(criticalityOf(crit("Medium"))).toBe("medium");
  });

  it("adds 3 / 5 / 7 working days and skips weekends", () => {
    const s = { holidays: [] };
    // Thursday 26 Nov 2026.
    expect(nextChaseDate({ ...crit("High"), requestedOn: "2026-11-26", chaseLog: [] }, s)).toBe("2026-12-01");
    expect(nextChaseDate({ ...crit("Medium"), requestedOn: "2026-11-26", chaseLog: [] }, s)).toBe("2026-12-03");
    expect(nextChaseDate({ ...crit("Low"), requestedOn: "2026-11-26", chaseLog: [] }, s)).toBe("2026-12-07");
    // From the last chase, not the request date.
    expect(nextChaseDate({ ...crit("High"), requestedOn: "2026-11-02", chaseLog: ["2026-11-20"] }, s)).toBe("2026-11-25");
  });

  it("resets chase dates as one proposal, even with chase logs set to apply directly", async () => {
    const { store, ctx } = setup();
    const e = (await create(ctx, "engagements", { name: "Project Heron" })).record;
    const c = (await create(ctx, "people", { name: "Asha Client", role: "client" })).record;
    const a = (await create(ctx, "infoRequests", { engagementId: e.id, number: "1.1", description: "TB", requestedOn: "2026-11-16", nextChaseOn: "2026-11-17", requestedFromId: c.id, ...crit("Low") })).record;
    const b = (await create(ctx, "infoRequests", { engagementId: e.id, number: "1.2", description: "GL", requestedOn: "2026-11-16", nextChaseOn: "2026-11-17", responsible: "Finance team" })).record;
    const none = (await create(ctx, "infoRequests", { engagementId: e.id, number: "1.3", description: "FAR", requestedOn: "2026-11-16", nextChaseOn: "2026-11-17" })).record;
    const r = await runTool({ store, by: "connector", propose: true, now: () => NOW }, "reset_chase_dates", { engagement: "heron" });
    expect(r.proposalId).toBeTruthy();
    expect((await store.get("infoRequests", a.id))!.nextChaseOn).toBe("2026-11-17");
    const p = (await store.get("proposals", r.proposalId!))!;
    expect(p.changes.map((x) => x.recordId).sort()).toEqual([a.id, b.id].sort());
    expect(p.changes.find((x) => x.recordId === a.id)!.after.nextChaseOn).toBe("2026-11-25");
    expect(p.changes.find((x) => x.recordId === b.id)!.after.nextChaseOn).toBe("2026-11-23");
    void none;
    // Logging a chase still applies directly.
    const chased = await runTool({ store, by: "connector", propose: true, now: () => NOW }, "log_chase", { ids: [a.id] });
    expect(chased.proposalId).toBeUndefined();
    expect((await store.get("infoRequests", a.id))!.chaseLog).toEqual(["2026-11-25"]);
  });

  it("lists items with nobody to chase separately, not as chases", async () => {
    const { store, ctx } = setup();
    const e = (await create(ctx, "engagements", { name: "Project Heron" })).record;
    await create(ctx, "infoRequests", { engagementId: e.id, number: "1", description: "TB", requestedOn: "2026-11-02", nextChaseOn: "2026-11-20", responsible: "CFO" });
    await create(ctx, "infoRequests", { engagementId: e.id, number: "2", description: "GL", requestedOn: "2026-11-02", nextChaseOn: "2026-11-20" });
    await create(ctx, "infoRequests", { engagementId: e.id, number: "3", description: "FAR", requestedOn: "2026-11-02", nextChaseOn: "2026-11-20", status: "received" });
    const v = computeToday(await loadSnapshot(store), "2026-11-25");
    expect(v.chase.map((g) => [g.name, g.items.length])).toEqual([["CFO", 1]]);
    expect(v.assignContact.map((r) => r.number)).toEqual(["2"]);
  });

  it("new items get the cadence date", async () => {
    const { ctx } = setup();
    const e = (await create(ctx, "engagements", { name: "Project Heron" })).record;
    const r = await createInfoRequest(ctx, { engagementId: e.id, description: "Bank statements", requestedOn: "2026-11-26", ...crit("High") });
    expect(r.record.nextChaseOn).toBe("2026-12-01");
  });
});

describe("review point owner, due date, step (3.3)", () => {
  it("owner is the assignee, else the preparer; private points are nobody's", () => {
    expect(pointOwner({}, { preparerId: "p1", myRole: "reviewer" })).toBe("p1");
    expect(pointOwner({ assignedToId: "p2" }, { preparerId: "p1", myRole: "reviewer" })).toBe("p2");
    expect(pointOwner({}, { myRole: "preparer" })).toBe("me");
    expect(pointOwner({}, { myRole: "reviewer" })).toBeUndefined();
    expect(pointOwner({ private: true }, { preparerId: "p1", myRole: "reviewer" })).toBeUndefined();
  });

  it("points show in the preparer's workload, follow reassignment, and undo", async () => {
    const { store, ctx } = setup();
    const e = (await create(ctx, "engagements", { name: "Project Heron" })).record;
    const ravi = (await create(ctx, "people", { name: "Ravi Menon", role: "team" })).record;
    const dev = (await create(ctx, "people", { name: "Dev Shah", role: "team" })).record;
    const wp = (await create(ctx, "workpapers", { engagementId: e.id, ref: "C.1", title: "AR ageing", myRole: "reviewer", preparerId: ravi.id })).record;
    await create(ctx, "planItems", { engagementId: e.id, number: "4.2", area: "Receivables", text: "Ageing" });
    const bridge = { store, by: "connector" as const, now: () => NOW };
    const added = await runTool(bridge, "add_review_points", { workpaper: "C.1", engagement: "heron", points: ["Tie ageing to TB", "Explain >180 days"], due: "2026-11-27", step: "4.2" });
    const [p1] = (added.result as { ids: string[] }).ids;
    await create(ctx, "reviewPoints", { engagementId: e.id, workpaperId: wp.id, text: "Sections completed", private: true });
    const pt = (await store.get("reviewPoints", p1))!;
    expect(pt.assignedToId).toBeUndefined();
    expect(pt.due).toBe("2026-11-27");
    expect(pt.planItemId).toBeTruthy();

    const load = async (who: string) => ((await runTool(bridge, "get_workload", { person: who, engagement: "heron" })).result as { summary: { openReviewPoints: number } }).summary.openReviewPoints;
    expect(await load("Ravi")).toBe(2);

    const moved = await runTool(bridge, "update_review_point", { id: p1, assignedTo: "Dev" });
    expect(await load("Ravi")).toBe(1);
    expect(await load("Dev")).toBe(1);
    expect((await store.get("reviewPoints", p1))!.assignedToId).toBe(dev.id);
    // Naming the preparer puts it back with the preparer.
    const back = await runTool(bridge, "update_review_point", { id: p1, assignedTo: "Ravi" });
    expect((await store.get("reviewPoints", p1))!.assignedToId).toBeUndefined();
    await undoBatch(store, back.batchId!, NOW);
    expect((await store.get("reviewPoints", p1))!.assignedToId).toBe(dev.id);
    void moved;
  });

  it("reassigning a point on a final work paper sends it back to points raised", async () => {
    const { store, ctx } = setup();
    const e = (await create(ctx, "engagements", { name: "Project Heron" })).record;
    const wp = (await create(ctx, "workpapers", { engagementId: e.id, ref: "C.2", title: "AP", status: "final" })).record;
    const pt = (await create(ctx, "reviewPoints", { engagementId: e.id, workpaperId: wp.id, text: "Cut-off", status: "cleared" })).record;
    const r = await runTool({ store, by: "app", now: () => NOW }, "update_review_point", { id: pt.id, status: "open" });
    expect((r.result as { warning?: string }).warning).toMatch(/points raised/);
    expect((await store.get("workpapers", wp.id))!.status).toBe("points_raised");
  });
});

describe("Today order and carry-forward (5.1, 5.2)", () => {
  it("puts points I owe and carried tasks in overdue; past meetings aside", async () => {
    const { store, ctx } = setup();
    const e = (await create(ctx, "engagements", { name: "Project Heron" })).record;
    const wp = (await create(ctx, "workpapers", { engagementId: e.id, ref: "D.1", title: "Revenue", myRole: "preparer" })).record;
    await create(ctx, "reviewPoints", { engagementId: e.id, workpaperId: wp.id, text: "Overdue point", due: "2026-11-24" });
    await create(ctx, "reviewPoints", { engagementId: e.id, workpaperId: wp.id, text: "Undated point" });
    await create(ctx, "reviewPoints", { engagementId: e.id, workpaperId: wp.id, text: "Private note", private: true, due: "2026-11-20" });
    const carried = (await create(ctx, "tasks", { title: "Send AP ageing", due: "2026-11-24" })).record;
    await create(ctx, "tasks", { title: "Meeting with CFO", due: "2026-11-24", dueTime: "16:00" });
    const v = computeToday(await loadSnapshot(store), "2026-11-25");
    expect(v.overdue.map((d) => d.kind).sort()).toEqual(["point", "task"]);
    expect(isCarried(carried, "2026-11-25")).toBe(true);
    expect(v.past.map((t) => t.title)).toEqual(["Meeting with CFO"]);
    expect(v.pointsToClear.map((p) => p.text)).toEqual(["Undated point"]);
  });

  it("lists steps unlocked since yesterday", async () => {
    const { store, ctx } = setup();
    const e = (await create(ctx, "engagements", { name: "Project Heron" })).record;
    const tb = (await create(ctx, "infoRequests", { engagementId: e.id, number: "1.1", description: "Trial balance", requestedOn: "2026-11-02" })).record;
    await create(ctx, "planItems", { engagementId: e.id, number: "2.1", area: "General", text: "TB vs FS", assignee: "Ravi", inputs: { rfiIds: [tb.id], extra: [], source: "manual" } });
    expect(computeToday(await loadSnapshot(store), "2026-11-25", "2026-11-24").unlocked).toEqual([]);
    await update(ctx, "infoRequests", tb.id, { status: "received" });
    const v = computeToday(await loadSnapshot(store), "2026-11-25", "2026-11-24");
    expect(v.unlocked.map((u) => [u.step.number, u.to])).toEqual([["2.1", "ready"]]);
  });
});
