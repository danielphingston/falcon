// Proposals: AI changes wait for the user. Invented data only.
import { describe, expect, it } from "vitest";
import { MemoryStore, acceptAll, acceptProposal, create, rejectProposal, remove, runTool, toolJsonSchemas, undoBatch, update, type Ctx } from "../src";

const NOW = new Date("2026-11-26T10:00:00Z");

async function setup(autoApply?: ("taskDates" | "chaseLogs")[]) {
  const store = new MemoryStore(autoApply ? { autoApply } : {});
  const app: Ctx = { store, by: "app", now: () => NOW };
  const ai: Ctx = { store, by: "connector", now: () => NOW, propose: true };
  const eng = (await create(app, "engagements", { name: "Project Falcon" })).record;
  const task = (await create(app, "tasks", { title: "Draft QoE", engagementId: eng.id, due: "2026-11-27" })).record;
  const rfi = (await create(app, "infoRequests", { engagementId: eng.id, number: "1.1", description: "Trial balance", requestedOn: "2026-11-20" })).record;
  return { store, app, ai, eng, task, rfi };
}
const live = async (store: MemoryStore, table: "tasks" | "proposals") => (await store.list(table)).filter((r) => !r.deleted);

describe("proposals", () => {
  it("an AI's change waits as a proposal; nothing changes until the user accepts", async () => {
    const { store, app, ai } = await setup();
    const r = await runTool(ai, "create_task", { title: "Call client", engagement: "falcon" });
    expect(r.ok).toBe(true);
    expect(r.proposalId).toBeTruthy();
    expect(r.result).toMatchObject({ proposed: true, summary: "Create task “Call client”" });
    expect((await live(store, "tasks")).map((t) => t.title)).toEqual(["Draft QoE"]);
    const [p] = await live(store, "proposals");
    expect(p).toMatchObject({ status: "pending", source: "connector", tool: "create_task" });

    const d = await acceptProposal(app, p.id);
    expect(d.status).toBe("accepted");
    const tasks = await live(store, "tasks");
    expect(tasks.map((t) => t.title).sort()).toEqual(["Call client", "Draft QoE"]);
    expect(tasks.find((t) => t.title === "Call client")?.updatedBy).toBe("connector");

    // Undo reverses the change and puts the proposal back to pending.
    await undoBatch(store, d.batchId!);
    expect((await live(store, "tasks")).map((t) => t.title)).toEqual(["Draft QoE"]);
    expect((await store.get("proposals", p.id))?.status).toBe("pending");
  });

  it("only the user, in the app, can accept or reject", async () => {
    const { store, ai } = await setup();
    const r = await runTool(ai, "update_task", { id: (await live(store, "tasks"))[0].id, title: "x" });
    await expect(acceptProposal(ai, r.proposalId!)).rejects.toThrow(/Only the user/);
    await expect(rejectProposal(ai, r.proposalId!)).rejects.toThrow(/Only the user/);
    expect(toolJsonSchemas().map((t) => t.name).filter((n) => /approve|accept|reject/.test(n))).toEqual([]);
  });

  it("goes stale when the record changed after the proposal, and void when it was deleted", async () => {
    const { store, app, ai, task } = await setup();
    const a = await runTool(ai, "update_task", { id: task.id, title: "By the AI" });
    await update(app, "tasks", task.id, { notes: "edited by the user meanwhile" });
    expect(await acceptProposal(app, a.proposalId!)).toMatchObject({ status: "stale" });
    expect((await store.get("tasks", task.id))?.title).toBe("Draft QoE");

    const b = await runTool(ai, "update_task", { id: task.id, title: "Again" });
    await remove(app, "tasks", task.id);
    expect(await acceptProposal(app, b.proposalId!)).toMatchObject({ status: "void" });
  });

  it("task dates and chase logs apply straight away (when allowed); everything else is proposed", async () => {
    const { store, ai, task, rfi } = await setup();
    const moved = await runTool(ai, "update_task", { id: task.id, due: "2026-11-30" });
    expect(moved.proposalId).toBeUndefined();
    expect((await store.get("tasks", task.id))?.due).toBe("2026-11-30");
    const chased = await runTool(ai, "log_chase", { ids: [rfi.id] });
    expect(chased.proposalId).toBeUndefined();
    expect((await store.get("infoRequests", rfi.id))?.chaseLog).toHaveLength(1);
    // A date change bundled with anything else is proposed.
    const mixed = await runTool(ai, "update_task", { id: task.id, due: "2026-12-01", title: "Renamed" });
    expect(mixed.proposalId).toBeTruthy();

    const strict = await setup([]);
    const r = await runTool(strict.ai, "update_task", { id: strict.task.id, due: "2026-11-30" });
    expect(r.proposalId).toBeTruthy();
  });

  it("a retried call doesn't queue a duplicate", async () => {
    const { store, ai } = await setup();
    const a = await runTool(ai, "create_task", { title: "Same" });
    const b = await runTool(ai, "create_task", { title: "Same" });
    expect(b.proposalId).toBe(a.proposalId);
    expect(await live(store, "proposals")).toHaveLength(1);
  });

  it("accept all applies each on its own and lists failures", async () => {
    const { store, app, ai, task } = await setup();
    const ok = await runTool(ai, "create_task", { title: "Fine" });
    const bad = await runTool(ai, "update_task", { id: task.id, title: "Will go stale" });
    await update(app, "tasks", task.id, { notes: "changed" });
    const res = await acceptAll(app, [bad.proposalId!, ok.proposalId!]);
    expect(res.map((x) => x.decision.status)).toEqual(["stale", "accepted"]);
    expect((await live(store, "tasks")).map((t) => t.title)).toContain("Fine");
  });

  it("reads and the delete preview never create proposals; a confirmed delete does", async () => {
    const { store, ai, task } = await setup();
    await runTool(ai, "get_today", {});
    const preview = await runTool(ai, "delete_item", { id: task.id });
    expect(preview.result).toMatchObject({ needsConfirmation: true });
    expect(await live(store, "proposals")).toHaveLength(0);
    const del = await runTool(ai, "delete_item", { id: task.id, confirmed: true });
    expect(del.proposalId).toBeTruthy();
    expect((await store.get("tasks", task.id))?.deleted).toBe(false);
    const list = await runTool(ai, "list_proposals", {});
    expect(list.result).toMatchObject({ count: 1, proposals: [{ summary: "Delete task “Draft QoE”" }] });
  });

  it("the in-app chat proposes too, and a rejected proposal changes nothing", async () => {
    const { store, app, task } = await setup();
    const chat: Ctx = { store, by: "chat", now: () => NOW, propose: true };
    const r = await runTool(chat, "update_task", { id: task.id, title: "From chat" });
    expect((await store.get("proposals", r.proposalId!))?.source).toBe("chat");
    expect(await rejectProposal(app, r.proposalId!)).toMatchObject({ status: "rejected" });
    expect((await store.get("tasks", task.id))?.title).toBe("Draft QoE");
  });
});
