import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  addWorkingDays,
  celebrationFor,
  computeToday,
  create,
  createFollowUp,
  createInfoRequest,
  defaultSettings,
  irlRows,
  loadSnapshot,
  logChase,
  mergeRecords,
  parseBackup,
  parseQuickAdd,
  remove,
  runTool,
  toolJsonSchemas,
  undoLast,
  update,
  type Ctx,
} from "../src";

// Saturday 2026-10-17 is not a working day; Monday is 2026-10-19.
const NOW = new Date("2026-10-16T10:00:00"); // Friday
const setup = () => {
  const store = new MemoryStore();
  const ctx: Ctx = { store, by: "app", now: () => NOW };
  return { store, ctx };
};

describe("working days", () => {
  const s = defaultSettings();
  it("skips weekends", () => {
    expect(addWorkingDays("2026-10-16", 1, s)).toBe("2026-10-19");
    expect(addWorkingDays("2026-10-16", 2, s)).toBe("2026-10-20");
  });
  it("skips holidays and rolls a weekend forward at n = 0", () => {
    expect(addWorkingDays("2026-10-16", 1, { ...s, holidays: ["2026-10-19"] })).toBe("2026-10-20");
    expect(addWorkingDays("2026-10-17", 0, s)).toBe("2026-10-19");
  });
  it("honours a six-day week", () => {
    expect(addWorkingDays("2026-10-16", 1, { ...s, workingDays: [1, 2, 3, 4, 5, 6] })).toBe("2026-10-17");
  });
});

describe("actions and undo", () => {
  it("creates, updates, deletes and undoes", async () => {
    const { store, ctx } = setup();
    const t = await create(ctx, "tasks", { title: "Draft QoE" });
    expect(t.record.status).toBe("todo");
    await update(ctx, "tasks", t.record.id, { title: "Draft QoE bridge", due: "2026-10-20" });
    await remove(ctx, "tasks", t.record.id);
    expect((await store.get("tasks", t.record.id))!.deleted).toBe(true);

    await undoLast(store);
    expect((await store.get("tasks", t.record.id))!.deleted).toBe(false);
    await undoLast(store);
    expect((await store.get("tasks", t.record.id))!.title).toBe("Draft QoE");
    await undoLast(store);
    expect((await store.get("tasks", t.record.id))!.deleted).toBe(true);
  });

  it("clears fields patched with null", async () => {
    const { store, ctx } = setup();
    const t = await create(ctx, "tasks", { title: "x", due: "2026-10-20" });
    await update(ctx, "tasks", t.record.id, { due: null });
    expect((await store.get("tasks", t.record.id))!.due).toBeUndefined();
  });

  it("rejects invalid records", async () => {
    const { ctx } = setup();
    await expect(create(ctx, "tasks", { title: "" })).rejects.toThrow();
  });
});

describe("chasing", () => {
  it("sets first chase date and pushes it on chase", async () => {
    const { ctx } = setup();
    const e = await create(ctx, "engagements", { name: "Project Falcon" });
    const p = await create(ctx, "people", { name: "Rahul", role: "client" });
    const irl = await createInfoRequest(ctx, {
      engagementId: e.record.id,
      description: "Trial balance FY24",
      requestedOn: "2026-10-16",
      requestedFromId: p.record.id,
    });
    expect(irl.record.nextChaseOn).toBe("2026-10-20");
    const chased = await logChase(ctx, "infoRequests", irl.record.id);
    expect(chased.record.chaseLog).toEqual(["2026-10-16"]);
    expect(chased.record.nextChaseOn).toBe("2026-10-20");
  });
});

describe("follow-ups", () => {
  it("takes their type from the person's role", async () => {
    const { ctx } = setup();
    const partner = await create(ctx, "people", { name: "Vikram", role: "partner" });
    const client = await create(ctx, "people", { name: "Rahul", role: "client" });
    expect((await createFollowUp(ctx, { about: "Sign-off", personId: partner.record.id })).record.type).toBe("manager");
    expect((await createFollowUp(ctx, { about: "TB", personId: client.record.id })).record.type).toBe("client");
    expect((await createFollowUp(ctx, { about: "Misc" })).record.type).toBe("other");
  });
});

describe("today view", () => {
  it("groups chases and finds reviews", async () => {
    const { store, ctx } = setup();
    const e = await create(ctx, "engagements", { name: "Falcon" });
    const closed = await create(ctx, "engagements", { name: "Old", status: "closed" });
    const p = await create(ctx, "people", { name: "Rahul", role: "client" });
    await createInfoRequest(ctx, { engagementId: e.record.id, description: "TB", requestedOn: "2026-10-01", requestedFromId: p.record.id });
    await createInfoRequest(ctx, { engagementId: e.record.id, description: "FAR", requestedOn: "2026-10-01", requestedFromId: p.record.id });
    await createInfoRequest(ctx, { engagementId: closed.record.id, description: "Ignore", requestedOn: "2026-10-01" });
    await create(ctx, "tasks", { title: "Overdue", due: "2026-10-10" });
    await create(ctx, "tasks", { title: "Today", due: "2026-10-16" });
    await create(ctx, "workpapers", { engagementId: e.record.id, ref: "B.2", title: "NWC", myRole: "reviewer", status: "prepared" });
    const mine = await create(ctx, "workpapers", { engagementId: e.record.id, ref: "C.1", title: "Net debt", myRole: "preparer" });
    await create(ctx, "reviewPoints", { workpaperId: mine.record.id, engagementId: e.record.id, text: "Tie to TB" });

    const v = computeToday(await loadSnapshot(store), "2026-10-16");
    expect(v.overdue.map((d) => d.record.id)).toHaveLength(1);
    expect(v.dueToday).toHaveLength(1);
    expect(v.chase).toHaveLength(1);
    expect(v.chase[0].person?.name).toBe("Rahul");
    expect(v.chase[0].items).toHaveLength(2);
    expect(v.toReview.map((w) => w.ref)).toEqual(["B.2"]);
    expect(v.pointsToClear).toHaveLength(1);
  });
});

describe("quick add", () => {
  const people = [{ id: "p1", name: "Rahul Mehta", role: "client" }] as never[];
  const engagements = [{ id: "e1", name: "Project Falcon", status: "active" }] as never[];
  const ctx = { today: "2026-10-16", people, engagements, settings: defaultSettings() };

  it("parses a follow-up", () => {
    const d = parseQuickAdd("Chase @Rahul TB FY24 #Falcon !mon", ctx);
    expect(d.kind).toBe("followup");
    expect(d.text).toBe("TB FY24");
    expect(d.person?.id).toBe("p1");
    expect(d.engagement?.id).toBe("e1");
    expect(d.due).toBe("2026-10-19");
  });
  it("parses a task with priority and relative date", () => {
    const d = parseQuickAdd("Draft NWC section !+2 !!", ctx);
    expect(d).toMatchObject({ kind: "task", text: "Draft NWC section", due: "2026-10-20", priority: "high" });
  });
  it("parses IRL and day/month dates", () => {
    const d = parseQuickAdd("irl: Fixed asset register #falcon !25/10", ctx);
    expect(d).toMatchObject({ kind: "irl", text: "Fixed asset register", due: "2026-10-25" });
  });
  it("keeps unknown ! words as text", () => {
    expect(parseQuickAdd("Fix !bug", ctx).text).toBe("Fix !bug");
  });
});

describe("celebrations", () => {
  it("detects IRL complete", async () => {
    const { store, ctx } = setup();
    const e = await create(ctx, "engagements", { name: "Falcon" });
    const a = await createInfoRequest(ctx, { engagementId: e.record.id, description: "A", requestedOn: "2026-10-01" });
    const b = await createInfoRequest(ctx, { engagementId: e.record.id, description: "B", requestedOn: "2026-10-01" });
    const r1 = await update(ctx, "infoRequests", a.record.id, { status: "received" });
    expect(await celebrationFor(store, "infoRequests", r1.before, r1.record)).toBe("small");
    const r2 = await update(ctx, "infoRequests", b.record.id, { status: "na" });
    expect(await celebrationFor(store, "infoRequests", r2.before, r2.record)).toBe("irl_complete");
  });
});

describe("merge and backup", () => {
  it("newer record wins and tombstones survive", () => {
    const base = { createdAt: "2026-10-01T00:00:00Z", deleted: false, updatedBy: "app" as const, title: "t", priority: "normal" as const, status: "todo" as const };
    const local = [{ ...base, id: "a", updatedAt: "2026-10-02T00:00:00Z" }, { ...base, id: "b", updatedAt: "2026-10-05T00:00:00Z" }];
    const remote = [{ ...base, id: "a", updatedAt: "2026-10-03T00:00:00Z", deleted: true }, { ...base, id: "b", updatedAt: "2026-10-04T00:00:00Z", title: "old" }, { ...base, id: "c", updatedAt: "2026-10-01T00:00:00Z" }];
    const { merged, changed } = mergeRecords(local, remote);
    expect(merged.find((r) => r.id === "a")!.deleted).toBe(true);
    expect(merged.find((r) => r.id === "b")!.title).toBe("t");
    expect(changed.map((r) => r.id).sort()).toEqual(["a", "c"]);
  });
  it("rejects foreign files", () => {
    expect(() => parseBackup({ hello: 1 })).toThrow(/Not a valid/);
  });
});

describe("AI tools", () => {
  it("exports JSON schemas", () => {
    const schemas = toolJsonSchemas();
    expect(schemas.length).toBeGreaterThan(10);
    expect(schemas.find((s) => s.name === "add_irl_items")!.parameters).toHaveProperty("properties");
  });

  it("adds IRL items by engagement name, creating the contact, and undoes as one batch", async () => {
    const { store } = setup();
    const ctx = { store, by: "chat" as const, now: () => NOW };
    await runTool(ctx, "create_engagement", { name: "Project Falcon", workstreams: ["QoE", "NWC"] });
    const r = await runTool(ctx, "add_irl_items", {
      engagement: "falcon",
      requestedFrom: "Priya",
      items: [{ number: "1", description: "TB FY24" }, { number: "2", description: "FAR" }],
    });
    expect(r.ok).toBe(true);
    expect((await store.list("infoRequests")).length).toBe(2);
    expect((await store.list("people"))[0]).toMatchObject({ name: "Priya", role: "client" });

    const rows = irlRows(await store.list("infoRequests"), "2026-10-16");
    expect(rows.map((x) => x.number)).toEqual(["1", "2"]);

    await runTool(ctx, "undo_last", {});
    expect((await store.list("infoRequests")).filter((x) => !x.deleted)).toHaveLength(0);
    expect((await store.list("people")).filter((x) => !x.deleted)).toHaveLength(0);
  });

  it("asks before deleting", async () => {
    const { store } = setup();
    const ctx = { store, by: "chat" as const };
    const t = await runTool(ctx, "create_task", { title: "x" });
    const id = (t.result as { created: { id: string } }).created.id;
    const preview = await runTool(ctx, "delete_item", { id });
    expect(preview.result).toMatchObject({ needsConfirmation: true });
    expect((await store.get("tasks", id))!.deleted).toBe(false);
    await runTool(ctx, "delete_item", { id, confirmed: true });
    expect((await store.get("tasks", id))!.deleted).toBe(true);
  });

  it("reports bad input instead of throwing", async () => {
    const { store } = setup();
    const r = await runTool({ store, by: "chat" }, "create_task", { title: 5 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid input/);
  });
});
