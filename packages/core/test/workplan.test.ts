// Invented work plans shaped like the firm's two layouts. Never put real client plans here.
import { describe, expect, it } from "vitest";
import { MemoryStore, applyPlan, create, update, isMe, namedIn, runTool, parsePlan, planPlanImport, planProgress, planReviewQueue, planStatus, type Ctx, type PlanItem } from "../src";

const iaPlan = [
  {
    name: "IA Plan",
    rows: [
      ["", "", "", "", "", "", "", "", "", "Team", "Open"],
      ["", "Widget Co Pvt Ltd", "", "", "", "", "", "", "", "AB", "Closed"],
      ["", "Internal Audit - Round 1", "", "", "", "", "", "", "", "Cara", "WIP"],
      ["", "IA Work Plan"],
      ["", "Sl. No.", "Area", "Particulars", "Person Responsible", "Status - Execution", "Status - Review", "Reviewed by", "Remarks"],
      ["", "1", "General", "Understand the HR process", "Team", "Open", "Open", "AB"],
      ["", "", "", "MIS vs books", "Cara", "Closed", "WIP", "AB", "Done, see WP 1.2"],
      ["", "", "Balance Sheet"],
      ["", "2", "Receivables", "Check credit terms", "Dev", "WIP", "Open", "Cara"],
      ["", "", "", "Ageing as at cut-off", "Dev", "Open", "Open", "Cara"],
      ["", "", "Deliverable"],
      ["", "3", "Report", "", "Team", "Open", "Open", "AB"],
    ],
  },
];

const auditProgramme = [
  { name: "Summary", rows: [["", "Widget Co"], ["", "Sl. No.", "Particulars", "Budgeted Hours"], ["", "1", "Planning", "4"]] },
  {
    name: "Audit Programme",
    rows: [
      ["", "", "", "", "", "", "", "", "", "", "Preparation", "Review", "High", "Open"],
      ["", "Widget Co Pvt Ltd", "", "", "", "", "", "", "", "", "Team", "Manager", "Low", "Closed"],
      ["", "Statutory Audit"],
      ["", "Sl.\nNo.", "Area as per Overall Audit Strategy", "Area", "Audit Procedures", "Risk Matrix", "Applicability", "Person Responsible", "Budget Time (in Hours)", "Actual Time (in Hours)", "Status", "Audit Remarks"],
      ["", "1", "Planning", "Planning\nDocuments", "Planning materiality", "High", "Yes", "Ravi", "3", "1", "Closed"],
      ["", "", "", "", "Going concern", "High", "Yes", "Ravi", "", "", "Review Pending"],
      ["", "", "", "", "", "", "", "", "", "", "Open"],
      ["", "", "", "Balance Sheet", "", "", "", "", "", "", "Open"],
      ["", "2", "Fieldwork", "Statutory Dues", "Review of -", "", "", "", "", "", "Open"],
      ["", "", "", "", "- GST workings", "High", "Yes", "Mira", "2", "", "WIP"],
      ["", "", "", "", "- TDS workings", "High", "Yes", "Mira", "1", "", "Open"],
      ["", "", "", "", "Review of returns filed", "Medium", "Yes", "Mira", "", "", "Open"],
      ["", "3", "Fieldwork", "Intangibles", "Verify amortisation", "", "No", "", "", "", "Open"],
      ["", "4", "Finalisation", "Financial Statements", "", "High", "Yes", "Team", "2", "", "Open"],
      ["", "", "", "", "", "", "", "Articles time", "8"],
    ],
  },
  { name: "Risks and Brief Instructions", rows: [["", "S.No", "Areas", "Account Head"], ["", "1", "Liabilities", "Share Capital"]] },
];

describe("work plans", () => {
  it("maps statuses", () => {
    expect([planStatus("Open"), planStatus("WIP"), planStatus("Review Pending"), planStatus("Closed"), planStatus("")]).toEqual(["open", "wip", "review", "closed", undefined]);
  });

  it("reads an IA plan with execution and review status", () => {
    const p = parsePlan(iaPlan)!;
    expect(p.sheet).toBe("IA Plan");
    expect(p.hasReview).toBe(true);
    expect(p.title).toEqual(["Widget Co Pvt Ltd", "Internal Audit - Round 1", "IA Work Plan"]);
    expect(p.steps.map((s) => [s.number, s.group ?? "", s.area, s.text, s.assignee, s.status, s.reviewStatus, s.reviewer])).toEqual([
      ["1.1", "", "General", "Understand the HR process", "Team", "open", "open", "AB"],
      ["1.2", "", "General", "MIS vs books", "Cara", "closed", "wip", "AB"],
      ["2.1", "Balance Sheet", "Receivables", "Check credit terms", "Dev", "wip", "open", "Cara"],
      ["2.2", "Balance Sheet", "Receivables", "Ageing as at cut-off", "Dev", "open", "open", "Cara"],
      ["3.1", "Deliverable", "Report", "Report", "Team", "open", "open", "AB"],
    ]);
    expect(p.steps[1].fields).toEqual([{ label: "Remarks", value: "Done, see WP 1.2" }]);
  });

  it("reads an audit programme: phases, groups, lead-ins, N/A, hours, other sheets", () => {
    const p = parsePlan(auditProgramme)!;
    expect(p.sheet).toBe("Audit Programme");
    expect(p.hasReview).toBe(false);
    expect(p.columns[0]).toBe("Sl. No.");
    expect(p.steps.map((s) => [s.number, s.phase, s.group ?? "", s.area, s.lead ?? "", s.text, s.status, s.applicable])).toEqual([
      ["1.1", "Planning", "", "Planning Documents", "", "Planning materiality", "closed", true],
      ["1.2", "Planning", "", "Planning Documents", "", "Going concern", "review", true],
      ["2.1", "Fieldwork", "", "Statutory Dues", "Review of", "GST workings", "wip", true],
      ["2.2", "Fieldwork", "", "Statutory Dues", "Review of", "TDS workings", "open", true],
      ["2.3", "Fieldwork", "", "Statutory Dues", "", "Review of returns filed", "open", true],
      ["3.1", "Fieldwork", "", "Intangibles", "", "Verify amortisation", "open", false],
      ["4.1", "Finalisation", "", "Financial Statements", "", "Financial Statements", "open", true],
    ]);
    expect(p.steps[0]).toMatchObject({ risk: "High", assignee: "Ravi", budgetHours: 3, actualHours: 1 });
    expect(p.notes).toEqual(["Articles time 8"]);
    expect(p.tables.map((t) => t.name)).toEqual(["Summary", "Risks and Brief Instructions"]);
    expect(p.tables[0].rows[0]).toEqual(["Widget Co", "", ""]);

    const pr = planProgress(p.steps.map((s, i) => ({ ...s, id: String(i), engagementId: "e", createdAt: "", updatedAt: "" })) as never);
    expect(pr).toMatchObject({ total: 7, applicable: 6, closed: 1, budget: 8, actual: 1 });
    expect(pr.byPerson.map((x) => [x.name, x.steps])).toEqual([
      ["Mira", 3],
      ["Ravi", 2],
      ["Team", 1],
    ]);
  });

  it("imports, then updates on re-import without duplicating", async () => {
    const store = new MemoryStore();
    const ctx: Ctx = { store, by: "app" };
    const eng = (await create(ctx, "engagements", { name: "Widget" })).record;
    const first = parsePlan(iaPlan)!;
    await applyPlan(ctx, planPlanImport(first, []), { engagementId: eng.id, parsed: first, file: "plan.xlsx", resolvePerson: (n) => (n === "Dev" ? "p-dev" : undefined) });
    let items = await store.list("planItems");
    expect(items).toHaveLength(5);
    expect(items.find((i) => i.text === "Check credit terms")).toMatchObject({ assigneeId: "p-dev", status: "wip" });
    expect(items.find((i) => i.text === "MIS vs books")?.closedAt).toBeTruthy();
    expect((await store.get("engagements", eng.id))?.planInfo).toMatchObject({ file: "plan.xlsx", hasReview: true });

    const changed = structuredClone(iaPlan);
    changed[0].rows[8][5] = "Closed";
    const second = parsePlan(changed)!;
    const plan2 = planPlanImport(second, items);
    expect(plan2.create).toHaveLength(0);
    expect(plan2.update.map((u) => [u.step.text, u.changes])).toEqual([["Check credit terms", ["status → closed"]]]);
    expect(plan2.unchanged).toBe(4);
    await applyPlan(ctx, plan2, { engagementId: eng.id, parsed: second, file: "plan v2.xlsx" });
    items = await store.list("planItems");
    expect(items).toHaveLength(5);
    expect(items.find((i) => i.text === "Check credit terms")?.status).toBe("closed");
  });

  it("keeps progress made in the app when the same sheet is imported again", async () => {
    const store = new MemoryStore();
    const ctx: Ctx = { store, by: "app" };
    const eng = (await create(ctx, "engagements", { name: "Widget" })).record;
    const first = parsePlan(iaPlan)!;
    await applyPlan(ctx, planPlanImport(first, []), { engagementId: eng.id, parsed: first, file: "plan.xlsx" });
    const hr = (await store.list("planItems")).find((i) => i.text === "Understand the HR process")!;
    await update(ctx, "planItems", hr.id, { status: "closed", reviewStatus: "wip" });

    // Same sheet again: nothing to do, the app's progress stays.
    const again = planPlanImport(parsePlan(iaPlan)!, await store.list("planItems"));
    expect(again.update).toHaveLength(0);
    expect(again.unchanged).toBe(5);

    // The sheet now says WIP for that step: that change comes through.
    const changed = structuredClone(iaPlan);
    changed[0].rows[5][5] = "WIP";
    const p3 = parsePlan(changed)!;
    const plan3 = planPlanImport(p3, await store.list("planItems"));
    expect(plan3.update.map((u) => u.changes)).toEqual([["status → wip"]]);
    await applyPlan(ctx, plan3, { engagementId: eng.id, parsed: p3, file: "plan v3.xlsx" });
    expect(await store.get("planItems", hr.id)).toMatchObject({ status: "wip", reviewStatus: "wip", sheetStatus: "wip" });
  });

  it("lists steps waiting for my review", () => {
    const p = parsePlan(iaPlan)!;
    const items = p.steps.map((s, i) => ({ ...s, id: String(i), engagementId: "e", createdAt: "", updatedAt: "" })) as never as PlanItem[];
    const eng = [{ id: "e", planInfo: { hasReview: true } }];
    // Executed + review not closed: "MIS vs books" (review WIP, reviewer AB).
    expect(planReviewQueue(items, eng, new Set(["e"]), "Anil Bose").map((i) => i.text)).toEqual(["MIS vs books"]);
    expect(planReviewQueue(items, eng, new Set(["e"]), "Cara")).toHaveLength(0);
    expect(planReviewQueue(items, eng, new Set(), "Anil Bose")).toHaveLength(0);
    // Plans without a review column: only "Review pending" steps.
    items[0].status = "review";
    expect(planReviewQueue(items, [{ id: "e" }], new Set(["e"]), "Me").map((i) => i.text)).toEqual(["Understand the HR process"]);
  });

  it("answers 'how much does Dev have' through the assistant's tools", async () => {
    const store = new MemoryStore();
    const ctx: Ctx = { store, by: "app" };
    const eng = (await create(ctx, "engagements", { name: "Widget Co" })).record;
    const p = parsePlan(iaPlan)!;
    await applyPlan(ctx, planPlanImport(p, []), { engagementId: eng.id, parsed: p, file: "plan.xlsx" });
    // Dev isn't in the People list: the plan's names still count.
    const r = await runTool(ctx, "get_workload", { person: "dev", engagement: "widget" });
    expect(r.ok).toBe(true);
    const out = r.result as { summary: Record<string, unknown>; workPlanSteps: { text: string }[] };
    expect(out.summary).toMatchObject({ workPlanStepsToComplete: 2, workPlanStepsByStatus: { open: 1, wip: 1, review: 0, closed: 0 } });
    expect(out.workPlanSteps.map((s) => s.text)).toEqual(["Check credit terms", "Ageing as at cut-off"]);
    // Cara reviews the receivables steps; one is executed in the edited sheet.
    const plan = await runTool(ctx, "get_work_plan", { engagement: "widget", person: "Dev" });
    const step = (plan.result as { steps: { id: string; text: string }[] }).steps[0];
    // A step closes through its workpaper (brief v2 A4): closing it bare is refused…
    expect((await runTool(ctx, "update_plan_step", { id: step.id, status: "closed" })).ok).toBe(false);
    // …"review pending" (executed, waiting for review) is still a status the plan can set.
    expect((await runTool(ctx, "update_plan_step", { id: step.id, status: "review" })).ok).toBe(true);
    const cara = (await runTool(ctx, "get_workload", { person: "Cara" })).result as { summary: Record<string, number> };
    expect(cara.summary.workPlanStepsWaitingForTheirReview).toBe(1);
    expect(namedIn("Ravi/Dev", "Dev Rao")).toBe(true);
    expect(namedIn("Asha & Mira", "Mira")).toBe(true);
    expect(namedIn("Team", "Mira")).toBe(false);
  });

  it("recognises the user by name or initials", () => {
    expect(isMe("JK", "Jayakrishnan K J")).toBe(true);
    expect(isMe("Jayakrishnan", "Jayakrishnan K J")).toBe(true);
    expect(isMe("Ravi", "Jayakrishnan K J")).toBe(false);
    expect(isMe("JK", "Me")).toBe(false);
  });
});
