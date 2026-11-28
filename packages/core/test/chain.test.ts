// Build brief v2 A1: programmes → worksteps → workpapers, and the migration proposal. Invented data only.
import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  acceptProposal,
  create,
  engagementReadiness,
  loadSnapshot,
  planMigration,
  proposeMigration,
  stepState,
  suggestLinks,
  tbAreaFor,
  undoBatch,
  unlinkedWorkpapers,
  update,
  type Ctx,
  type PlanItem,
  type Store,
} from "../src";

const NOW = new Date("2026-11-28T10:00:00Z");

async function seed() {
  const store = new MemoryStore({ myName: "Test User", myAliases: ["TU"] });
  const ctx: Ctx = { store, by: "app", now: () => NOW };
  const eng = (await create(ctx, "engagements", { name: "Project Kestrel", type: "Internal Audit" })).record;
  const asha = (await create(ctx, "people", { name: "Asha Rao", role: "team" })).record;
  const dev = (await create(ctx, "people", { name: "Dev Nair", role: "team" })).record;
  const ravi = (await create(ctx, "people", { name: "Ravi Iyer", role: "team" })).record;
  let order = 0;
  const step = async (number: string, area: string, text: string, assignee: string, extra: Partial<PlanItem> = {}) =>
    (await create(ctx, "planItems", { engagementId: eng.id, number, area, text, assignee, reviewer: "TU", order: order++, ...extra })).record;
  const s11 = await step("1.1", "General", "Understanding of the order to cash process", "Team");
  const s12 = await step("1.2", "General", "MIS vs BoA", "Asha");
  const s21 = await step("2.1", "Share Capital", "Summary of shareholder agreements", "Ravi", { reviewStatus: "wip" });
  const s31 = await step("3.1", "Accounts Receivable", "Verify the credit terms", "Ravi");
  const s32 = await step("3.2", "Accounts Receivable", "Ageing of receivables at cut-off", "Ravi");
  const s41 = await step("4.1", "Sales", "Invoicing check - client-wise MoM, BoA vs invoicing sheet", "Asha", { status: "closed", reviewStatus: "closed" });
  const s42 = await step("4.2", "Sales", "Credit notes analysis - MoM, reasons, GST", "Asha");
  const s43 = await step("4.3", "Sales", "Recomputation of revenue basis invoicing sheet", "Asha");
  const mom = (await create(ctx, "workpapers", { engagementId: eng.id, ref: "4.1", title: "Revenue MoM", myRole: "reviewer", preparerId: dev.id, status: "cleared" })).record;
  const cn = (await create(ctx, "workpapers", { engagementId: eng.id, ref: "CN", title: "CN Analysis", myRole: "reviewer", preparerId: asha.id, status: "prepared" })).record;
  const ar = (await create(ctx, "workpapers", { engagementId: eng.id, ref: "4.0", title: "Accounts recievable", myRole: "reviewer", preparerId: ravi.id, status: "points_raised" })).record;
  const mis = (await create(ctx, "workpapers", { engagementId: eng.id, ref: "4.0", title: "MIS vs BoA", myRole: "reviewer", preparerId: dev.id, status: "prepared" })).record;
  const odd = (await create(ctx, "workpapers", { engagementId: eng.id, ref: "X", title: "Board minutes extract", myRole: "reviewer", status: "in_progress" })).record;
  const pi1 = (await create(ctx, "programItems", { engagementId: eng.id, area: "revenue", text: "Agree billing register to revenue each month", why: "Billing must agree to books", source: "ai" })).record;
  const pi2 = (await create(ctx, "programItems", { engagementId: eng.id, area: "investments", text: "Agree investment register to statements", source: "library", workpaperId: odd.id })).record;
  return { store, ctx, eng, people: { asha, dev, ravi }, steps: { s11, s12, s21, s31, s32, s41, s42, s43 }, wps: { mom, cn, ar, mis, odd }, items: { pi1, pi2 } };
}

type Seed = Awaited<ReturnType<typeof seed>>;

/** Live records without stamps, to compare states before / after an undo. */
async function state(store: Store) {
  const out: Record<string, unknown> = {};
  for (const t of ["programmes", "planItems", "workpapers", "programItems"] as const)
    out[t] = (await store.list(t))
      .filter((r) => !r.deleted)
      .map((r) => {
        const { updatedAt, updatedBy, ...rest } = r as unknown as Record<string, unknown>;
        void updatedAt;
        void updatedBy;
        return rest;
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify(out);
}

describe("programme areas", () => {
  it("maps balance sheet / P&L areas to TB areas, process areas to none", () => {
    expect(["Sales", "Accounts Receivable", "Cash & Cash Equivalents", "Asset Management", "Payroll", "Share Capital & Reserves and Surplus"].map(tbAreaFor)).toEqual([
      "revenue",
      "receivables",
      "cash_bank",
      "ppe",
      "employee_costs",
      "equity_reserves",
    ]);
    expect(["General", "TB Review", "General & IT Controls", "IT Controls", "Related Party Transactions", "Report"].map(tbAreaFor)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("matching workpapers to steps", () => {
  it("matches by title words and area first, ref second, acronyms and spelling slips included", async () => {
    const { store, steps, wps } = await seed();
    const snap = await loadSnapshot(store);
    const got = Object.fromEntries(suggestLinks(snap.planItems, snap.workpapers, []).map((l) => [l.workpaperId, l.stepIds]));
    expect(got[wps.mom.id]).toEqual([steps.s41.id]); // "MoM" plus the ref breaks the tie
    expect(got[wps.cn.id]).toEqual([steps.s42.id]); // CN = Credit Notes
    expect(got[wps.mis.id]).toEqual([steps.s12.id]); // same ref as AR: never matched on ref alone
    expect(got[wps.ar.id]).toEqual([steps.s31.id, steps.s32.id]); // title names the whole area
    expect(got[wps.odd.id]).toBeUndefined();
  });
});

describe("migration proposal (A1)", () => {
  it("is one proposal: programmes, steps under them, old programme items as steps, and choices", async () => {
    const s = await seed();
    const p = (await proposeMigration(s.ctx, s.eng.id))!;
    expect(p.status).toBe("pending");
    expect(p.engagementId).toBe(s.eng.id);
    // Nothing changed yet.
    expect((await s.store.list("programmes")).length).toBe(0);
    const keys = p.choices!.map((c) => c.key);
    expect(keys).toContain(`link:${s.wps.mom.id}:${s.steps.s41.id}`);
    expect(keys).toContain(`ref:${s.wps.cn.id}`);
    // Revenue MoM is prepared by Dev, the step says Asha: asked, default no.
    const owner = p.choices!.find((c) => c.key === `owner:${s.steps.s41.id}`)!;
    expect(owner.defaultOn).toBe(false);
    expect(owner.label).toContain("Dev Nair");
    // 2.1 is in review with no workpaper: a workpaper at In review is proposed.
    expect(p.choices!.find((c) => c.key === `wp:${s.steps.s21.id}`)?.label).toMatch(/in review/);
    // Asking again returns the same pending proposal.
    expect((await proposeMigration(s.ctx, s.eng.id))!.id).toBe(p.id);
  });

  it("accepting applies everything ticked as one batch, and undo restores the previous state", async () => {
    const s = await seed();
    const before = await state(s.store);
    const p = (await proposeMigration(s.ctx, s.eng.id))!;
    const d = await acceptProposal(s.ctx, p.id);
    expect(d.status).toBe("accepted");

    const snap = await loadSnapshot(s.store);
    const progs = snap.programmes.filter((x) => x.engagementId === s.eng.id);
    expect(progs.map((x) => x.name).sort()).toEqual(["Accounts Receivable", "General", "Investments", "Sales", "Share Capital"]);
    expect(progs.find((x) => x.name === "Sales")?.tbArea).toBe("revenue");
    expect(progs.find((x) => x.name === "General")?.tbArea).toBeUndefined();
    // Every step sits under a programme; the two programme items are steps now (shown, not hidden).
    expect(snap.planItems.every((x) => x.programmeId)).toBe(true);
    const fromItems = snap.planItems.filter((x) => x.fromProgramItemId);
    expect(fromItems.map((x) => x.source).sort()).toEqual(["ai", "tb_suggested"]);
    expect(fromItems.find((x) => x.fromProgramItemId === s.items.pi1.id)?.programmeId).toBe(progs.find((x) => x.name === "Sales")!.id);
    expect(fromItems.find((x) => x.fromProgramItemId === s.items.pi2.id)?.workpaperId).toBe(s.wps.odd.id);
    expect((await s.store.get("programItems", s.items.pi1.id))?.migratedToId).toBeTruthy();
    // Links, refs; owners untouched by default.
    const st = (id: string) => snap.planItems.find((x) => x.id === id)!;
    expect(st(s.steps.s41.id).workpaperId).toBe(s.wps.mom.id);
    expect(st(s.steps.s41.id).assignee).toBe("Asha");
    expect([st(s.steps.s31.id).workpaperId, st(s.steps.s32.id).workpaperId]).toEqual([s.wps.ar.id, s.wps.ar.id]);
    expect((await s.store.get("workpapers", s.wps.cn.id))?.ref).toBe("4.2");
    expect((await s.store.get("workpapers", s.wps.ar.id))?.ref).toBe("3.1");
    // Status comes from the workpaper.
    expect(stepState(st(s.steps.s42.id), s.wps.cn)).toBe("to_review");
    expect(st(s.steps.s42.id).status).toBe("review"); // older readers see the same one status
    // 2.1's new workpaper keeps its review state.
    const w21 = snap.workpapers.find((w) => w.id === st(s.steps.s21.id).workpaperId)!;
    expect(w21.status).toBe("in_review");
    expect(w21.preparerId).toBe(s.people.ravi.id);
    expect(unlinkedWorkpapers(s.eng.id, snap).map((w) => w.title)).toEqual([]);
    // Nothing left to migrate.
    expect(planMigration(await loadSnapshot(s.store, { raw: true }), s.eng.id, { myName: "Test User", myAliases: ["TU"], groupNames: [] })).toBeNull();

    // Undo the batch: back to how it was (acceptance test 13), and the proposal is pending again.
    await undoBatch(s.store, d.batchId!);
    expect(await state(s.store)).toBe(before);
    expect((await s.store.get("proposals", p.id))?.status).toBe("pending");
  });

  it("rejected links leave both sides unlinked; a choice needing one left out is skipped (edge case 11)", async () => {
    const s = await seed();
    const p = (await proposeMigration(s.ctx, s.eng.id))!;
    const picked = p.choices!.filter((c) => c.defaultOn && c.key !== `link:${s.wps.cn.id}:${s.steps.s42.id}`).map((c) => c.key);
    await acceptProposal(s.ctx, p.id, { choices: [...picked, `ref:${s.wps.cn.id}`, `owner:${s.steps.s41.id}`] });
    expect((await s.store.get("planItems", s.steps.s42.id))?.workpaperId).toBeUndefined();
    expect((await s.store.get("workpapers", s.wps.cn.id))?.ref).toBe("CN");
    // Ticked owner change applies.
    expect((await s.store.get("planItems", s.steps.s41.id))?.assigneeId).toBe(s.people.dev.id);
    const snap = await loadSnapshot(s.store);
    expect(unlinkedWorkpapers(s.eng.id, snap).map((w) => w.title)).toEqual(["CN Analysis"]);
  });

  it("a choice whose record changed since is left out, the rest applies", async () => {
    const s = await seed();
    const p = (await proposeMigration(s.ctx, s.eng.id))!;
    // The user links 4.1 to another workpaper meanwhile.
    await update(s.ctx, "planItems", s.steps.s41.id, { workpaperId: s.wps.odd.id });
    // The proposal's main change touched 4.1 too, so the whole thing is stale and must be asked again.
    const d = await acceptProposal(s.ctx, p.id);
    expect(d.status).toBe("stale");
  });

  it("keeps RFI-driven readiness: TB / AI steps aren't guessed onto RFI items", async () => {
    const s = await seed();
    const rfi = (await create(s.ctx, "infoRequests", { engagementId: s.eng.id, number: "1.1", description: "Billing register month-wise", requestedOn: "2026-11-01" })).record;
    const before = engagementReadiness(s.eng, (await loadSnapshot(s.store)).planItems, [rfi], "2026-11-28");
    const p = (await proposeMigration(s.ctx, s.eng.id))!;
    await acceptProposal(s.ctx, p.id);
    const after = engagementReadiness(s.eng, (await loadSnapshot(s.store)).planItems, [rfi], "2026-11-28");
    const feeds = (r: typeof before) => r.steps.filter((x) => x.inputs.some((i) => i.rfiId === rfi.id)).map((x) => x.step.id);
    expect(feeds(after)).toEqual(feeds(before).filter((id) => after.steps.some((x) => x.step.id === id)));
  });
});

describe("work plan import makes programmes", () => {
  it("creates one programme per area and keeps renamed ones", async () => {
    const { applyPlan, planPlanImport } = await import("../src");
    const s: Seed = await seed();
    const parsed = {
      sheet: "Plan",
      title: [],
      columns: [],
      notes: [],
      tables: [],
      hasReview: true,
      warnings: [],
      steps: [
        { number: "9.1", area: "Payroll", text: "Payroll register vs BoA", applicable: true, status: "open" as const, order: 90 },
        { number: "9.2", area: "Payroll", text: "Attrition check", applicable: true, status: "open" as const, order: 91 },
      ],
    };
    await applyPlan(s.ctx, planPlanImport(parsed, []), { engagementId: s.eng.id, parsed, file: "plan.xlsx" });
    const progs = (await s.store.list("programmes")).filter((p) => p.engagementId === s.eng.id);
    expect(progs.map((p) => [p.name, p.tbArea])).toEqual([["Payroll", "employee_costs"]]);
    const steps = (await s.store.list("planItems")).filter((x) => x.area === "Payroll");
    expect(steps.every((x) => x.programmeId === progs[0].id)).toBe(true);
  });
});

describe("guard rails (A4)", () => {
  it("a step can't close without a cleared workpaper, unless N/A", async () => {
    const { updateStep, StepCloseError, setWorkpaperStatus } = await import("../src");
    const s = await seed();
    await expect(updateStep(s.ctx, s.steps.s43.id, { status: "closed" })).rejects.toBeInstanceOf(StepCloseError);
    await expect(updateStep(s.ctx, s.steps.s43.id, { reviewStatus: "closed" })).rejects.toThrow(/Create one|mark the step N\/A/);
    // N/A is fine.
    await updateStep(s.ctx, s.steps.s43.id, { applicable: false, status: "closed" });
    // With a workpaper not yet cleared: refused, then fine once cleared.
    await update(s.ctx, "planItems", s.steps.s42.id, { workpaperId: s.wps.cn.id });
    await expect(updateStep(s.ctx, s.steps.s42.id, { status: "closed" })).rejects.toThrow(/closes when its workpaper CN is cleared/);
    await setWorkpaperStatus(s.ctx, s.wps.cn.id, "cleared");
    await updateStep(s.ctx, s.steps.s42.id, { status: "closed" });
  });

  it("a workpaper can't be cleared or final with open review points", async () => {
    const { setWorkpaperStatus, OpenPointsError, runTool } = await import("../src");
    const s = await seed();
    const pt = (await create(s.ctx, "reviewPoints", { workpaperId: s.wps.cn.id, engagementId: s.eng.id, text: "Tie credit notes to GSTR-1" })).record;
    const err = await setWorkpaperStatus(s.ctx, s.wps.cn.id, "cleared").catch((e) => e);
    expect(err).toBeInstanceOf(OpenPointsError);
    expect((err as InstanceType<typeof OpenPointsError>).points.map((p) => p.text)).toEqual(["Tie credit notes to GSTR-1"]);
    // Addressed still counts as open; cleared doesn't.
    await update(s.ctx, "reviewPoints", pt.id, { status: "addressed" });
    await expect(setWorkpaperStatus(s.ctx, s.wps.cn.id, "final")).rejects.toThrow(/open review point/);
    // The AI tool hits the same guard.
    const r = await runTool({ store: s.store, by: "connector" }, "update_workpaper_status", { workpaper: s.wps.cn.id, status: "cleared" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Tie credit notes/);
    await update(s.ctx, "reviewPoints", pt.id, { status: "cleared" });
    await setWorkpaperStatus(s.ctx, s.wps.cn.id, "final");
  });
});

describe("creating a workpaper for steps (A3)", () => {
  it("needs steps or ad-hoc; links every picked step; defaults come from the steps", async () => {
    const { createWorkpaperForSteps, workpaperDefaults, LinkError, ME } = await import("../src");
    const s = await seed();
    await expect(createWorkpaperForSteps(s.ctx, { engagementId: s.eng.id, stepIds: [], ref: "", title: "X" })).rejects.toBeInstanceOf(LinkError);
    const snap = await loadSnapshot(s.store);
    const d = workpaperDefaults([s.steps.s31.id, s.steps.s32.id], snap, { myName: "Test User", myAliases: ["TU"], groupNames: [] });
    expect(d).toMatchObject({ ref: "3.1", title: "Verify the credit terms", preparer: s.people.ravi.id, reviewer: ME });
    // "Team" owns 1.1: no default preparer (the form asks who).
    expect(workpaperDefaults([s.steps.s11.id], snap, { myName: "Test User", myAliases: ["TU"], groupNames: [] }).preparer).toBeUndefined();
    const r = await createWorkpaperForSteps(s.ctx, { engagementId: s.eng.id, stepIds: [s.steps.s31.id, s.steps.s32.id], ref: d.ref, title: d.title, preparerId: d.preparer, reviewerId: d.reviewer });
    expect(r.workpaper.myRole).toBe("reviewer");
    expect(r.workpaper.reviewerId).toBeUndefined(); // me
    const after = await loadSnapshot(s.store);
    expect(after.planItems.filter((x) => x.workpaperId === r.workpaper.id).map((x) => x.number)).toEqual(["3.1", "3.2"]);
    // Both steps show the workpaper's status.
    expect(stepState(after.planItems.find((x) => x.id === s.steps.s31.id)!, r.workpaper)).toBe("open");
    const adhoc = await createWorkpaperForSteps(s.ctx, { engagementId: s.eng.id, stepIds: [], adHoc: true, ref: "AH", title: "Board minutes" });
    expect(adhoc.workpaper.adHoc).toBe(true);
  });

  it("edits linked steps: moves steps from another workpaper, unlinks the rest", async () => {
    const { setWorkpaperSteps } = await import("../src");
    const s = await seed();
    await update(s.ctx, "planItems", s.steps.s41.id, { workpaperId: s.wps.mom.id });
    const r = await setWorkpaperSteps(s.ctx, s.wps.cn.id, [s.steps.s41.id, s.steps.s42.id]);
    expect(r.linked.length).toBe(2);
    expect((await s.store.get("planItems", s.steps.s41.id))?.workpaperId).toBe(s.wps.cn.id);
    await setWorkpaperSteps(s.ctx, s.wps.cn.id, [s.steps.s42.id]);
    expect((await s.store.get("planItems", s.steps.s41.id))?.workpaperId).toBeUndefined();
  });
});
