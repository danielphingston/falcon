import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  applyTeamImport,
  create,
  engagementsFor,
  loadSnapshot,
  matchName,
  parseTeamAllocation,
  planTeamImport,
  undoBatch,
  type Ctx,
  type SheetData,
} from "../src";

// Synthetic workbook with the same layout quirks as a real team allocation file:
// title rows above the header, a typo'd header, repeated "Team" columns,
// trailing spaces and inconsistent spellings of the same person.
const grid = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => String(c)));
const sheets: SheetData[] = [
  {
    name: "Assignments",
    rows: grid([
      [],
      ["", "Dept"],
      ["", "Priya's Team"],
      [],
      ["", "Assignments"],
      [],
      ["", "Sl No.", "Assignemnt", "Type", "Status", "Team", "Team", "Team", "Team"],
      ["", 1, "Acme Foods", "Stat Audit", "Ongoing", "PK", "Ravi Kumar ", "Leena  Das", "Arun B Y"],
      ["", 2, "BETA", "Due Diligence", "Ongoing", "PK", "Arun BY", "leena das"],
      ["", 3, "Gamma Pvt Ltd", "Transaction Support", "Paused", "Ravi Kumar", "Meena", "Arun"],
      ["", 4, "Delta Ltd", "Internal Audit", "Completed", "PK", "Newbie Person"],
      ["", 5, ""],
    ]),
  },
  {
    name: "Members",
    rows: grid([
      [],
      ["", "Team Members"],
      [],
      ["", "Names", "Type", "No.", "Ongoing Assignments"],
      ["", "PK", "Team Lead", 3, "Acme Foods"],
      ["", "Ravi Kumar", "Article", 2, "Acme Foods"],
      ["", "Leena Das", "Article", 2],
      ["", "Arun B Y", "Article", 2],
      ["", "Meena Iyer", "Article", 1],
    ]),
  },
];

const setup = () => {
  const store = new MemoryStore();
  const ctx: Ctx = { store, by: "app", now: () => new Date("2026-10-18T10:00:00Z") };
  return { store, ctx };
};

describe("team allocation import", () => {
  it("parses assignments and members past title rows and header typos", () => {
    const a = parseTeamAllocation(sheets);
    expect(a.assignments.map((x) => x.name)).toEqual(["Acme Foods", "BETA", "Gamma Pvt Ltd", "Delta Ltd"]);
    expect(a.assignments[0]).toMatchObject({ type: "Stat Audit", status: "active", team: ["PK", "Ravi Kumar", "Leena Das", "Arun B Y"] });
    expect(a.assignments[2].status).toBe("on_hold");
    expect(a.assignments[3].status).toBe("closed");
    expect(a.members).toHaveLength(5);
    expect(a.suggestedMe).toBe("PK");
  });

  it("matches name variants", () => {
    const people = [{ name: "Arun B Y" }, { name: "Meena Iyer" }, { name: "Leena Das" }];
    expect(matchName("Arun BY", people)?.name).toBe("Arun B Y");
    expect(matchName("Arun", people)?.name).toBe("Arun B Y");
    expect(matchName("meena", people)?.name).toBe("Meena Iyer");
    expect(matchName("leena  das ", people)?.name).toBe("Leena Das");
    expect(matchName("Lee", people)).toBeUndefined();
  });

  it("plans: me as lead is excluded, variants merge, unknown names are flagged", async () => {
    const { store } = setup();
    const plan = planTeamImport(parseTeamAllocation(sheets), await loadSnapshot(store), "PK");
    expect(plan.people.map((p) => p.name).sort()).toEqual(["Arun B Y", "Leena Das", "Meena Iyer", "Newbie Person", "Ravi Kumar"]);
    expect(plan.warnings.join(" ")).toContain("Newbie Person");
    const acme = plan.engagements[0];
    expect(acme.leadKey).toBeUndefined(); // PK = me
    expect(acme.teamKeys).toHaveLength(3);
    const gamma = plan.engagements[2];
    expect(plan.people.find((p) => p.key === gamma.leadKey)?.name).toBe("Ravi Kumar");
    expect(gamma.teamKeys.map((k) => plan.people.find((p) => p.key === k)?.name)).toEqual(["Meena Iyer", "Arun B Y"]);
    expect(plan.engagements.every((e) => e.action === "create")).toBe(true);
  });

  it("applies as one undoable batch, and re-import updates instead of duplicating", async () => {
    const { store, ctx } = setup();
    const alloc = parseTeamAllocation(sheets);
    const results = await applyTeamImport(ctx, planTeamImport(alloc, await loadSnapshot(store), "PK"));
    let snap = await loadSnapshot(store);
    expect(snap.engagements).toHaveLength(4);
    expect(snap.people).toHaveLength(5);
    expect(snap.engagements.find((e) => e.name === "BETA")).toMatchObject({ type: "Due Diligence", side: "buy", status: "active" });
    expect(snap.people.find((p) => p.name === "Ravi Kumar")).toMatchObject({ role: "team", designation: "Article" });
    const arun = snap.people.find((p) => p.name === "Arun B Y")!;
    expect(engagementsFor(arun, snap.engagements).map((e) => e.name).sort()).toEqual(["Acme Foods", "BETA", "Gamma Pvt Ltd"]);

    // Same file again: nothing changes.
    const again = planTeamImport(alloc, snap, "PK");
    expect(again.engagements.map((e) => e.action)).toEqual(["unchanged", "unchanged", "unchanged", "unchanged"]);
    expect(again.people.every((p) => p.existingId)).toBe(true);

    // Next month: Gamma resumes and Leena joins it.
    const next = parseTeamAllocation(sheets);
    next.assignments[2] = { ...next.assignments[2], status: "active", team: [...next.assignments[2].team, "Leena Das"] };
    const upd = planTeamImport(next, snap, "PK");
    expect(upd.engagements[2]).toMatchObject({ action: "update", changes: ["status", "team"] });
    await applyTeamImport(ctx, upd);
    snap = await loadSnapshot(store);
    expect(snap.engagements).toHaveLength(4);
    expect(snap.engagements.find((e) => e.name === "Gamma Pvt Ltd")!.status).toBe("active");

    // Undo the first import's batch removes what it created.
    await undoBatch(store, results[0].change.batchId);
    expect((await store.list("people")).filter((p) => !p.deleted)).toHaveLength(0);
  });

  it("matches an existing engagement typed differently", async () => {
    const { store, ctx } = setup();
    await create(ctx, "engagements", { name: "Beta" });
    const plan = planTeamImport(parseTeamAllocation(sheets), await loadSnapshot(store), "PK");
    expect(plan.engagements[1]).toMatchObject({ action: "update" });
  });

  it("AI tools: create/update engagements with team names, variants and me", async () => {
    const { runTool } = await import("../src");
    const store = new MemoryStore({ myName: "PK" });
    const ctx = { store, by: "chat" as const };
    await runTool(ctx, "add_person", { name: "Arun B Y", role: "team" });
    const r = await runTool(ctx, "create_engagement", { name: "Acme Foods", type: "Stat Audit", lead: "PK", team: ["Arun BY", "Leena Das", "PK"] });
    expect(r.ok).toBe(true);
    let people = (await store.list("people")).filter((p) => !p.deleted);
    expect(people.map((p) => p.name).sort()).toEqual(["Arun B Y", "Leena Das"]); // no duplicate Arun, no PK
    const e = (await store.list("engagements"))[0];
    expect(e).toMatchObject({ type: "Stat Audit", leadId: undefined });
    expect(e.team).toHaveLength(2);

    await runTool(ctx, "update_engagement", { engagement: "acme", lead: "Leena", removeFromTeam: ["Arun"], addToTeam: ["Meena"] });
    const after = (await store.list("engagements"))[0];
    people = (await store.list("people")).filter((p) => !p.deleted);
    const id = (n: string) => people.find((p) => p.name === n)!.id;
    expect(after.leadId).toBe(id("Leena Das"));
    expect(after.team).toEqual([id("Meena")]);
  });

  it("a single sheet without members still offers names and guesses the lead", () => {
    const a = parseTeamAllocation([sheets[0]]);
    expect(a.members.map((m) => m.name)).toContain("PK");
    expect(a.members.some((m) => m.name === "Arun BY")).toBe(false); // variants merged
    expect(a.suggestedMe).toBe("PK"); // leads 3 of 4
    expect(a.membersInferred).toBe(true);
  });

  it("explains unrecognised layouts", () => {
    expect(() => parseTeamAllocation([{ name: "x", rows: [["a", "b"], ["1", "2"]] }])).toThrow(/assignments table/);
  });
});
