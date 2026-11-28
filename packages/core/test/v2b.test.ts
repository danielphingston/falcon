// Build brief v2 Phase B: chase recalculation and bulk contacts (B1), task carry-forward (B2). Invented data only.
import { describe, expect, it } from "vitest";
import { MemoryStore, assignContact, carryForward, chaseResets, computeToday, create, isCarried, loadSnapshot, runTool, undoBatch, withoutContact, type Ctx } from "../src";

const NOW = new Date("2026-11-28T09:00:00Z"); // Saturday
const setup = () => {
  const store = new MemoryStore({ myName: "Test User" });
  const ctx: Ctx = { store, by: "app", now: () => NOW, batchId: "b1" };
  return { store, ctx };
};

describe("chase recalculation (B1)", () => {
  it("covers open items with or without a contact; request + 1 dates are reset to the cadence", async () => {
    const { store, ctx } = setup();
    const e = (await create(ctx, "engagements", { name: "Project Wren" })).record;
    const c = (await create(ctx, "people", { name: "Client Contact", role: "client" })).record;
    // Imported with next chase = request + 1 day.
    const a = (await create(ctx, "infoRequests", { engagementId: e.id, number: "1.1", description: "Bank statements", requestedOn: "2026-11-23", nextChaseOn: "2026-11-24", requestedFromId: c.id })).record;
    const b = (await create(ctx, "infoRequests", { engagementId: e.id, number: "1.2", description: "Fixed asset register", requestedOn: "2026-11-23", nextChaseOn: "2026-11-24" })).record;
    await create(ctx, "infoRequests", { engagementId: e.id, number: "1.3", description: "TB", requestedOn: "2026-11-23", nextChaseOn: "2026-11-24", status: "received" });
    const resets = chaseResets(await store.list("infoRequests"), { holidays: [] }, e.id);
    expect(resets.map((x) => [x.item.number, x.next])).toEqual([
      ["1.1", "2026-11-30"],
      ["1.2", "2026-11-30"],
    ]);
    // As the AI / start-up does it: one proposal per engagement.
    const r = await runTool({ store, by: "app", propose: true }, "reset_chase_dates", { engagement: e.id });
    expect(r.proposalId).toBeTruthy();
    expect((await store.get("proposals", r.proposalId!))?.engagementId).toBe(e.id);
    expect((await store.get("infoRequests", a.id))?.nextChaseOn).toBe("2026-11-24"); // nothing changed yet
    void b;
  });

  it("assigns one contact to many items in one batch", async () => {
    const { store, ctx } = setup();
    const e = (await create(ctx, "engagements", { name: "Project Wren" })).record;
    const c = (await create(ctx, "people", { name: "Client Contact", role: "client", engagementIds: [e.id] })).record;
    const ids = [];
    for (const n of ["2.1", "2.2", "2.3"]) ids.push((await create(ctx, "infoRequests", { engagementId: e.id, number: n, description: `Item ${n}`, requestedOn: "2026-11-23" })).record.id);
    expect(withoutContact(await store.list("infoRequests"), e.id).length).toBe(3);
    await assignContact({ ...ctx, batchId: "assign" }, ids.slice(0, 2), { personId: c.id });
    await assignContact({ ...ctx, batchId: "assign2" }, ids.slice(2), { responsible: "Accounts team" });
    expect(withoutContact(await store.list("infoRequests"), e.id).length).toBe(0);
    await undoBatch(store, "assign");
    expect(withoutContact(await store.list("infoRequests"), e.id).length).toBe(2);
  });
});

describe("task carry-forward (B2)", () => {
  it("moves open untimed tasks to today, counting days and keeping the first date; meetings stay past", async () => {
    const { store, ctx } = setup();
    const t1 = (await create(ctx, "tasks", { title: "Draft memo", due: "2026-11-25" })).record;
    const t2 = (await create(ctx, "tasks", { title: "Send RFI", due: "2026-11-26" })).record;
    const meet = (await create(ctx, "tasks", { title: "Client call", due: "2026-11-26", dueTime: "15:00" })).record;
    const done = (await create(ctx, "tasks", { title: "Old", due: "2026-11-20", status: "done" })).record;
    await carryForward({ ...ctx, batchId: "carry" }, "2026-11-27");
    // Next morning: carried again, one more day.
    await carryForward({ ...ctx, batchId: "carry2" }, "2026-11-28");
    const a = (await store.get("tasks", t1.id))!;
    expect([a.due, a.carried, a.firstDue]).toEqual(["2026-11-28", 3, "2026-11-25"]);
    expect((await store.get("tasks", t2.id))?.carried).toBe(2);
    expect((await store.get("tasks", meet.id))?.due).toBe("2026-11-26");
    expect((await store.get("tasks", done.id))?.due).toBe("2026-11-20");
    // Shows today as carried, not overdue.
    const v = computeToday(await loadSnapshot(store), "2026-11-28", "2026-11-27");
    expect(v.overdue.some((d) => d.record.id === t1.id)).toBe(false);
    expect(v.dueToday.some((d) => d.record.id === t1.id)).toBe(true);
    expect(isCarried(a, "2026-11-28")).toBe(true);
    // Undo puts the morning's move back.
    await undoBatch(store, "carry2");
    expect((await store.get("tasks", t1.id))?.due).toBe("2026-11-27");
  });

  it("after days without opening the app, carries once, counting every day (edge case 13)", async () => {
    const { store, ctx } = setup();
    const t = (await create(ctx, "tasks", { title: "Draft memo", due: "2026-11-20" })).record;
    await carryForward(ctx, "2026-11-28");
    expect((await store.get("tasks", t.id))?.carried).toBe(8);
  });
});
