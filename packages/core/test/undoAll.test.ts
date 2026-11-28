// Every tool that changes data must be fully reversible with undo_last, for
// whoever made the change (in-app chat, MCP connector). Invented data only.
import { describe, expect, it } from "vitest";
import { AREA_IDS, MemoryStore, create, runTool, tableNames, toolJsonSchemas, type Ctx, type Store } from "../src";

const NOW = new Date("2026-11-23T10:00:00Z");

/** Everything that's live, without timestamps (undo restores the old values but stamps a new updatedAt). */
async function state(store: Store) {
  const out: Record<string, unknown[]> = {};
  for (const t of tableNames) {
    out[t] = (await store.list(t))
      .filter((r) => !r.deleted)
      .map((r) => {
        const { updatedAt, updatedBy, ...rest } = r as unknown as Record<string, unknown>;
        void updatedAt;
        void updatedBy;
        return rest;
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return JSON.stringify(out);
}

async function seed() {
  const store = new MemoryStore({ myName: "Test User" });
  const app: Ctx = { store, by: "app", now: () => NOW };
  const eng = (await create(app, "engagements", { name: "Project Falcon", client: "Widget Co" })).record;
  const person = (await create(app, "people", { name: "Ravi Kumar", role: "client" })).record;
  const task = (await create(app, "tasks", { title: "Draft QoE", engagementId: eng.id })).record;
  const wp = (await create(app, "workpapers", { engagementId: eng.id, ref: "B.2", title: "NWC trend", myRole: "reviewer" })).record;
  const point = (await create(app, "reviewPoints", { engagementId: eng.id, workpaperId: wp.id, text: "Tie to TB" })).record;
  const rfi = (await create(app, "infoRequests", { engagementId: eng.id, number: "1.1", description: "Trial balance", requestedOn: "2026-11-01", requestedFromId: person.id })).record;
  const fu = (await create(app, "followUps", { about: "Call about TB", personId: person.id })).record;
  const prog = (await create(app, "programItems", { engagementId: eng.id, area: AREA_IDS[0], text: "Agree to ledger" })).record;
  const step = (await create(app, "planItems", { engagementId: eng.id, number: "1.1", area: "General", text: "MIS vs BoA", assignee: "Ravi" })).record;
  return { store, ids: { eng: eng.id, task: task.id, wp: wp.id, point: point.id, rfi: rfi.id, fu: fu.id, prog: prog.id, step: step.id } };
}

type Ids = Awaited<ReturnType<typeof seed>>["ids"];

/** One realistic call per tool that writes. */
const calls: Record<string, (ids: Ids) => unknown> = {
  create_engagement: () => ({ name: "Project Heron", type: "Stat Audit", lead: "me", team: ["Asha"], workstreams: ["Revenue"] }),
  update_engagement: () => ({ engagement: "falcon", status: "on_hold", addToTeam: ["Mira"], notes: "Paused" }),
  add_person: () => ({ name: "Mira Shah", role: "team" }),
  create_task: () => ({ title: "Call client", engagement: "falcon", due: "2026-11-25", assignee: "Dev" }),
  update_task: (i) => ({ id: i.task, status: "done", title: "Draft QoE bridge" }),
  create_workpaper: () => ({ engagement: "falcon", steps: ["1.1"], ref: "C.1", title: "Net debt", preparer: "me", reviewer: "Asha", notes: "Draft", openItems: [{ text: "TB pending", rfi: "1.1" }] }),
  update_workpaper: () => ({ workpaper: "B.2", engagement: "falcon", notes: "Books side done", addOpenItems: [{ text: "Statements pending", rfi: "1.1" }], steps: ["1.1"], due: "2026-11-30" }),
  update_workpaper_status: () => ({ workpaper: "B.2", engagement: "falcon", status: "in_review" }),
  add_review_points: () => ({ workpaper: "B.2", engagement: "falcon", points: ["Check cut-off", "Agree to FS"], assignedTo: "Dev" }),
  update_review_point: (i) => ({ id: i.point, status: "cleared" }),
  add_irl_items: () => ({ engagement: "falcon", requestedFrom: "Priya", items: [{ number: "2.1", description: "FAR" }] }),
  update_irl_item: (i) => ({ id: i.rfi, status: "received" }),
  log_chase: (i) => ({ ids: [i.rfi, i.fu] }),
  reset_chase_dates: () => ({ engagement: "falcon" }),
  create_followup: () => ({ about: "Send draft", person: "Ravi", engagement: "falcon" }),
  close_followup: (i) => ({ id: i.fu }),
  create_alert: (i) => ({ title: "Check TB", at: "2026-11-24T09:00:00Z", itemId: i.task }),
  log_time: () => ({ minutes: 45, engagement: "falcon", note: "Review" }),
  add_program_items: () => ({ engagement: "falcon", area: AREA_IDS[0], items: [{ text: "Extra check", why: "Flagged" }] }),
  update_program_item: (i) => ({ id: i.prog, status: "done", review: "ok", assignee: "Asha" }),
  set_step_inputs: () => ({ engagement: "falcon", steps: [{ step: "1.1", rfi: ["1.1"], notOnRfi: ["GSTR-2B"] }] }),
  add_point_challenges: (i) => ({ pointId: i.point, questions: [{ question: "Have you agreed the TB to the FS?", why: "Completeness" }] }),
  update_plan_step: (i) => ({ id: i.step, status: "wip", assignee: "Mira", notes: "Done" }),
  delete_item: (i) => ({ id: i.task, confirmed: true }),
};

describe("undo for every tool that changes data", () => {
  const writeTools = toolJsonSchemas()
    .filter((t) => t.kind !== "read" && t.name !== "undo_last")
    .map((t) => t.name);

  it("has a test call for every write tool", () => {
    expect(writeTools.filter((n) => !calls[n])).toEqual([]);
  });

  for (const name of Object.keys(calls))
    it(`${name}: undo_last puts everything back`, async () => {
      const { store, ids } = await seed();
      const ctx: Ctx = { store, by: "connector", now: () => NOW };
      const before = await state(store);
      const r = await runTool(ctx, name, calls[name](ids));
      expect(r.error).toBeUndefined();
      expect(await state(store)).not.toBe(before);
      const u = await runTool(ctx, "undo_last", {});
      expect(u.ok).toBe(true);
      expect(await state(store)).toBe(before);
    });

  it("an AI's undo never reverses the user's own changes", async () => {
    const { store, ids } = await seed();
    const ai: Ctx = { store, by: "connector", now: () => NOW };
    await runTool(ai, "update_task", { id: ids.task, title: "By the AI" });
    await runTool({ store, by: "app", now: () => NOW }, "update_task", { id: ids.task, notes: "By the user" });
    await runTool(ai, "undo_last", {});
    expect(await store.get("tasks", ids.task)).toMatchObject({ title: "Draft QoE", notes: "By the user" });
  });

  it("set_step_inputs leaves steps set by hand alone", async () => {
    const { store, ids } = await seed();
    const app: Ctx = { store, by: "app", now: () => NOW };
    const { update } = await import("../src");
    await update(app, "planItems", ids.step, { inputs: { rfiIds: [], extra: [], none: true, source: "manual" } });
    const r = await runTool({ store, by: "connector", now: () => NOW }, "set_step_inputs", { engagement: "falcon", steps: [{ step: "1.1", rfi: ["1.1"] }] });
    expect(r.result).toMatchObject({ saved: 0, skipped: [{ step: "1.1" }] });
    expect((await store.get("planItems", ids.step))?.inputs).toMatchObject({ none: true, source: "manual" });
  });
});
