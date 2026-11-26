// People as records: names in sheets resolve to people. Invented names only.
import { describe, expect, it } from "vitest";
import { ME, MemoryStore, cellHas, cellIds, cellUnassigned, create, matchOne, peopleIndex, runTool, splitNames, unmatchedNames, type Ctx, type Person } from "../src";

const p = (id: string, name: string, role: Person["role"] = "team", aliases?: string[]) =>
  ({ id, name, role, aliases, createdAt: "", updatedAt: "", deleted: false, updatedBy: "app" }) as Person;

const people = [
  p("ravi", "Ravi Kumar"),
  p("asha", "Asha Rao"),
  p("dev", "Dev Menon", "team", ["DevM"]),
  p("arjun", "Arjun KiranKumar"),
  p("mira", "Mira Shah", "client"),
  p("mira2", "Mira Shah Iyer", "team"),
];
const ix = peopleIndex(people, { myName: "Test User Kumar", myAliases: ["TUK-sir"] });

describe("people as records", () => {
  it("splits joint owners", () => {
    expect(splitNames("Ravi/Asha Rao")).toEqual(["Ravi", "Asha Rao"]);
    expect(splitNames("Ravi & Asha, Dev and Arjun")).toEqual(["Ravi", "Asha", "Dev", "Arjun"]);
    expect(splitNames(" ")).toEqual([]);
  });

  it("resolves names, initials, spelling variants and aliases", () => {
    expect(cellIds("Ravi/Asha Rao", ix)).toEqual(["ravi", "asha"]);
    expect(matchOne("AshaRao", ix)).toMatchObject({ kind: "person", person: { id: "asha" } }); // no space
    expect(matchOne("Kiran", ix)).toMatchObject({ kind: "person", person: { id: "arjun" } }); // part of a longer name
    expect(matchOne("DevM", ix)).toMatchObject({ kind: "person", person: { id: "dev" } }); // alias
    expect(matchOne("AR", ix)).toMatchObject({ kind: "person", person: { id: "asha" } }); // initials
  });

  it("the user's initials, name, 'me' and aliases all resolve to me", () => {
    for (const n of ["TUK", "TU", "Test", "me", "TUK-sir"]) expect(matchOne(n, ix).kind, n).toBe("me");
    expect(cellHas("TU/Ravi", ME, ix)).toBe(true);
  });

  it("'Team' is a group, not a person", () => {
    expect(matchOne("Team", ix).kind).toBe("group");
    expect(cellUnassigned("Team", ix)).toBe(true);
    expect(cellUnassigned("", ix)).toBe(true);
    expect(cellUnassigned("Ravi", ix)).toBe(false);
  });

  it("client contacts are never matched to team members, and the other way round", () => {
    // Plan cells (team context): "Mira" is the team member, never the client contact.
    expect(matchOne("Mira", ix)).toMatchObject({ kind: "person", person: { id: "mira2" } });
    // RFI owners (client context): only clients.
    expect(matchOne("Mira", ix, { clients: true })).toMatchObject({ kind: "person", person: { id: "mira" } });
    expect(matchOne("Ravi", ix, { clients: true }).kind).toBe("unknown");
  });

  it("asks once about names it can't place, most-used first", () => {
    const amb = peopleIndex([...people, p("ravi2", "Ravi Shankar")], { myName: "Me" });
    expect(matchOne("Ravi", amb)).toMatchObject({ kind: "ambiguous" });
    const list = unmatchedNames(["Nobody", "Ravi/Nobody", "Asha", "Ravi"], amb);
    expect(list.map((n) => [n.raw, n.count, n.kind])).toEqual([
      ["Nobody", 2, "unknown"],
      ["Ravi", 2, "ambiguous"],
    ]);
  });

  it("workload lists every step the user reviews, written as initials", async () => {
    const store = new MemoryStore({ myName: "Test User Kumar" });
    const app: Ctx = { store, by: "app" };
    const eng = (await create(app, "engagements", { name: "Project Falcon" })).record;
    const step = (n: string, reviewer: string, extra = {}) => create(app, "planItems", { engagementId: eng.id, number: n, area: "AR", text: `Step ${n}`, assignee: "Ravi", reviewer, ...extra });
    await step("1.1", "TUK");
    await step("1.2", "TUK", { status: "closed", reviewStatus: "wip" });
    await step("1.3", "TUK", { reviewStatus: "closed" });
    await step("1.4", "Asha");
    const r = (await runTool(app, "get_workload", { person: "me", engagement: "falcon" })).result as { summary: Record<string, number>; stepsTheyReview: { number: string }[] };
    expect(r.summary.workPlanStepsTheyReview).toBe(2);
    expect(r.stepsTheyReview.map((s) => s.number)).toEqual(["1.1", "1.2"]);
  });
});
