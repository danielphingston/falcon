// Orphan clean-up. Invented data only.
import { describe, expect, it } from "vitest";
import { MemoryStore, create, deleteOrphans, findOrphans, loadSnapshot, remove, undoBatch, type Ctx } from "../src";

describe("orphan clean-up", () => {
  it("finds records whose engagement no longer exists, keeps closed and on-hold ones, deletes undoably", async () => {
    const store = new MemoryStore();
    const app: Ctx = { store, by: "app" };
    const live = (await create(app, "engagements", { name: "Live", status: "active" })).record;
    const onHold = (await create(app, "engagements", { name: "Paused", status: "on_hold" })).record;
    const closed = (await create(app, "engagements", { name: "Done", status: "closed" })).record;
    const gone = (await create(app, "engagements", { name: "Old copy" })).record;
    for (const e of [live, onHold, closed, gone]) await create(app, "infoRequests", { engagementId: e.id, number: "1.1", description: `TB for ${e.name}`, requestedOn: "2026-11-01" });
    await create(app, "infoRequests", { engagementId: "never-existed", number: "2.1", description: "Stray item", requestedOn: "2026-11-01" });
    await create(app, "tasks", { title: "Personal task" }); // no engagement: never an orphan
    await remove(app, "engagements", gone.id);

    const all = await store.list("engagements");
    const groups = findOrphans(await loadSnapshot(store), all.filter((e) => e.deleted));
    expect(groups.map((g) => [g.formerName ?? "unknown", g.records.length])).toEqual([
      ["Old copy", 1],
      ["unknown", 1],
    ]);

    const batch: Ctx = { ...app, batchId: "clean" };
    expect(await deleteOrphans(batch, groups)).toBe(2);
    expect(findOrphans(await loadSnapshot(store))).toEqual([]);
    expect((await loadSnapshot(store)).infoRequests).toHaveLength(3);
    await undoBatch(store, "clean");
    expect((await loadSnapshot(store)).infoRequests).toHaveLength(5);
  });
});
