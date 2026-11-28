// Build brief v2 Phase C: AI connection changes. Invented data only.
import { describe, expect, it } from "vitest";
import { MemoryStore, acceptProposal, create, runTool, type Ctx } from "../src";

const NOW = new Date("2026-11-28T09:00:00Z");
async function seed() {
  const store = new MemoryStore({ myName: "Test User" });
  const app: Ctx = { store, by: "app", now: () => NOW };
  const e = (await create(app, "engagements", { name: "Project Wren" })).record;
  const rfi = (
    await create(app, "infoRequests", {
      engagementId: e.id,
      number: "1.5",
      description: "Accounting backup",
      requestedOn: "2026-11-20",
      fields: [
        { label: "Criticality", value: "High" },
        { label: "Remarks (Firm)", value: "Tally access pending" },
      ],
    })
  ).record;
  const nikhil = (await create(app, "people", { name: "Nikhil Rao", role: "team" })).record;
  const wp = (await create(app, "workpapers", { engagementId: e.id, ref: "4.0", title: "Receivables", myRole: "reviewer", status: "points_raised" })).record;
  const points = [];
  for (const t of ["Ageing to TB", "Credit notes after year end", "Long outstanding reasons"])
    points.push((await create(app, "reviewPoints", { engagementId: e.id, workpaperId: wp.id, text: t })).record);
  return { store, app, e, rfi, nikhil, wp, points };
}

describe("imported fields through the AI (C1)", () => {
  it("clears an imported remark through a proposal", async () => {
    const s = await seed();
    const r = await runTool({ store: s.store, by: "connector", propose: true }, "update_irl_item", { id: s.rfi.id, fields: [{ label: "remarks (firm)", value: "" }] });
    expect(r.proposalId).toBeTruthy();
    expect((await s.store.get("infoRequests", s.rfi.id))?.fields?.length).toBe(2);
    await acceptProposal(s.app, r.proposalId!);
    expect((await s.store.get("infoRequests", s.rfi.id))?.fields).toEqual([{ label: "Criticality", value: "High" }]);
  });

  it("sets a value, refuses an unknown column to clear, and can mark the books", async () => {
    const s = await seed();
    const ok = await runTool({ store: s.store, by: "app" }, "update_irl_item", { id: s.rfi.id, fields: [{ label: "Criticality", value: "Low" }], books: true });
    expect(ok.ok).toBe(true);
    const item = (await s.store.get("infoRequests", s.rfi.id))!;
    expect(item.fields?.[0].value).toBe("Low");
    expect(item.books).toBe(true);
    const bad = await runTool({ store: s.store, by: "app" }, "update_irl_item", { id: s.rfi.id, fields: [{ label: "Owner", value: "" }] });
    expect(bad.error).toMatch(/No imported column "Owner"/);
  });
});

describe("review point owner (C4)", () => {
  it("changes the owner of several points in one call, without re-adding them", async () => {
    const s = await seed();
    const r = await runTool({ store: s.store, by: "connector", propose: true }, "update_review_point", { ids: s.points.map((p) => p.id), assignedTo: "Nikhil" });
    expect(r.ok).toBe(true);
    await acceptProposal(s.app, r.proposalId!);
    for (const p of s.points) expect((await s.store.get("reviewPoints", p.id))?.assignedToId).toBe(s.nikhil.id);
    expect((await s.store.list("reviewPoints")).length).toBe(3);
  });
});

describe("chained proposals (C3)", () => {
  it("creates a task and updates it in one batch, accepted as one proposal", async () => {
    const s = await seed();
    const r = await runTool({ store: s.store, by: "connector", propose: true }, "batch", {
      calls: [
        { tool: "create_task", input: { title: "Chase Tally access", engagement: "wren" }, as: "t" },
        { tool: "update_task", input: { id: "$t", due: "2026-12-01", priority: "high" } },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.proposalId).toBeTruthy();
    expect((await s.store.list("tasks")).length).toBe(0);
    const d = await acceptProposal(s.app, r.proposalId!);
    expect(d.status).toBe("accepted");
    const t = (await s.store.list("tasks"))[0];
    expect([t.title, t.due, t.priority]).toEqual(["Chase Tally access", "2026-12-01", "high"]);
  });

  it("refuses reads and deletes inside a batch", async () => {
    const s = await seed();
    const r = await runTool({ store: s.store, by: "connector", propose: true }, "batch", { calls: [{ tool: "delete_item", input: { id: s.rfi.id, confirmed: true } }] });
    expect(r.error).toMatch(/can't go in a batch/);
  });
});

describe("client contacts per engagement (C5)", () => {
  it("warns when a task on one engagement names another engagement's contact", async () => {
    const s = await seed();
    const other = (await create(s.app, "engagements", { name: "Project Ibis" })).record;
    await create(s.app, "people", { name: "Sagar Kulkarni", role: "client", engagementIds: [other.id] });
    const r = await runTool({ store: s.store, by: "app" }, "create_task", { title: "Call Sagar about the TB", engagement: "wren" });
    expect((r.result as { warning?: string }).warning).toMatch(/Sagar Kulkarni is a client contact on Project Ibis, not Project Wren/);
    const ok = await runTool({ store: s.store, by: "app" }, "create_task", { title: "Call Sagar about the TB", engagement: "ibis" });
    expect((ok.result as { warning?: string }).warning).toBeUndefined();
  });

  it("a new client contact on an RFI belongs to that engagement", async () => {
    const s = await seed();
    await runTool({ store: s.store, by: "app" }, "add_irl_items", { engagement: "wren", requestedFrom: "Priya Menon", items: [{ description: "GST returns" }] });
    const p = (await s.store.list("people")).find((x) => x.name === "Priya Menon")!;
    expect(p.engagementIds).toEqual([s.e.id]);
  });
});

describe("programme tools (C6)", () => {
  it("get_programme lists programmes → steps → workpaper status; add_steps, link_workpaper and update_step work", async () => {
    const s = await seed();
    const add = await runTool({ store: s.store, by: "app" }, "add_steps", {
      engagement: "wren",
      programme: "Sales",
      steps: [{ text: "Revenue to Collections – map monthly revenue collected to bank", owner: "Nikhil", procedures: [{ text: "R2C 1 – walkthrough", why: "Design of controls" }] }],
      workpaper: "4.0",
    });
    expect(add.ok).toBe(true);
    const g = await runTool({ store: s.store, by: "app" }, "get_programme", { engagement: "wren" });
    const progs = (g.result as { programmes: { name: string; steps: { number: string; status: string; workpaper?: { ref: string }; procedures?: unknown[] }[] }[] }).programmes;
    expect(progs.map((p) => p.name)).toEqual(["Sales"]);
    expect(progs[0].steps[0]).toMatchObject({ status: "points_raised", workpaper: { ref: "4.0" } });
    expect(progs[0].steps[0].procedures?.length).toBe(1);
    const stepId = (add.result as { steps: { id: string }[] }).steps[0].id;
    const u = await runTool({ store: s.store, by: "app" }, "update_step", { step: stepId, doneProcedures: ["walkthrough"], applicable: false });
    expect(u.ok).toBe(true);
    const after = (await s.store.get("planItems", stepId))!;
    expect([after.applicable, after.workpaperId, after.procedures?.[0].done]).toEqual([false, undefined, true]);
    const l = await runTool({ store: s.store, by: "app" }, "link_workpaper", { workpaper: "4.0", engagement: "wren", link: [stepId] });
    expect(l.error).toMatch(/N\/A/);
  });
});

describe("guided review for the AI (C7)", () => {
  it("lists reviews in progress, reads every item, and a proposed 'raise point' lands after approval", async () => {
    const s = await seed();
    const step = (await create(s.app, "planItems", { engagementId: s.e.id, number: "4.1", area: "Receivables", text: "Verify the credit terms", assignee: "Nikhil", workpaperId: s.wp.id })).record;
    const start = await runTool({ store: s.store, by: "connector", propose: true }, "update_guided_review", { workpaper: "Receivables", start: true });
    await acceptProposal(s.app, start.proposalId!);
    const list = await runTool({ store: s.store, by: "connector" }, "get_guided_review", {});
    expect((list.result as { reviews: { workpaper: string; progress: string }[] }).reviews.map((r) => r.workpaper)).toEqual(["4.0 Receivables"]);
    const one = await runTool({ store: s.store, by: "connector" }, "get_guided_review", { workpaper: "Receivables" });
    const out = one.result as { basics: { key: string; outcome: string }[]; steps: { items: { key: string; kind: string; outcome: string }[] }[]; library: string };
    expect(out.basics.length).toBe(5);
    expect(out.steps[0].items[0]).toMatchObject({ key: `step:${step.id}`, kind: "step", outcome: "pending" });
    expect(out.library).toMatch(/aren't shown/);
    const raise = await runTool({ store: s.store, by: "connector", propose: true }, "update_guided_review", { workpaper: "Receivables", answers: [{ key: "basic:0", outcome: "ok" }], raisePoints: [{ key: `step:${step.id}` }] });
    expect(raise.proposalId).toBeTruthy();
    const before = (await s.store.list("reviewPoints")).length;
    await acceptProposal(s.app, raise.proposalId!);
    const pts = await s.store.list("reviewPoints");
    expect(pts.length).toBe(before + 1);
    expect(pts.find((p) => p.planItemId === step.id)?.text).toMatch(/^4\.1 · Verify the credit terms/);
    const wp = (await s.store.get("workpapers", s.wp.id))!;
    expect(wp.reviewAnswers?.find((a) => a.key === "basic:0")?.answer).toBe("ok");
  });
});
