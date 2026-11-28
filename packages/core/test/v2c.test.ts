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
