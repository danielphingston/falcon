import {
  addWorkingDays,
  create,
  createEngagement,
  createFollowUp,
  createInfoRequest,
  logChase,
  todayISO,
  type Ctx,
} from "@fdd/core";
import { getSettings } from "../db";

/** Fills the app with a realistic buy-side engagement so it can be explored. */
export async function loadSampleData(ctx: Ctx) {
  const s = await getSettings();
  const t = todayISO();
  const ago = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return todayISO(d);
  };
  const ahead = (n: number) => addWorkingDays(t, n, s);

  const rahul = (await create(ctx, "people", { name: "Rahul Mehta", role: "client", org: "Falcon Foods (CFO office)", email: "rahul@example.com" })).record;
  const anita = (await create(ctx, "people", { name: "Anita Rao", role: "manager", org: "Deal Advisory" })).record;
  const vikram = (await create(ctx, "people", { name: "Vikram Shah", role: "partner", org: "Deal Advisory" })).record;
  const sneha = (await create(ctx, "people", { name: "Sneha Iyer", role: "team" })).record;
  const arjun = (await create(ctx, "people", { name: "Arjun Nair", role: "team" })).record;
  const meera = (await create(ctx, "people", { name: "Meera Pillai", role: "client", org: "Heron Logistics" })).record;

  const falcon = (
    await createEngagement(ctx, { name: "Project Falcon", client: "Falcon Foods", side: "buy", kickoff: ago(12), dataRoom: ago(10), draftReport: ahead(6), finalReport: ahead(14), timesheetCode: "DA-24-118" }, ["QoE", "NWC", "Net debt", "Tax"])
  ).record;
  const heron = (await createEngagement(ctx, { name: "Project Heron", client: "Heron Logistics", side: "sell", kickoff: ago(3), draftReport: ahead(15) }, ["QoE", "NWC"])).record;

  const ws = async (engagementId: string, name: string) =>
    (await ctx.store.list("workstreams")).find((w) => w.engagementId === engagementId && w.name === name && !w.deleted)!.id;

  // Work papers: mine to prepare, and the team's for me to review.
  const qoe = await create(ctx, "workpapers", { engagementId: falcon.id, workstreamId: await ws(falcon.id, "QoE"), ref: "A.1", title: "EBITDA bridge & QoE adjustments", myRole: "preparer", reviewerId: anita.id, status: "points_raised", due: ahead(2) });
  await create(ctx, "reviewPoints", { workpaperId: qoe.record.id, engagementId: falcon.id, text: "Tie FY24 revenue to audited financials and explain the ₹1.2cr gap", raisedById: anita.id });
  await create(ctx, "reviewPoints", { workpaperId: qoe.record.id, engagementId: falcon.id, text: "Support the one-off legal costs normalisation with invoices", raisedById: anita.id });
  await create(ctx, "reviewPoints", { workpaperId: qoe.record.id, engagementId: falcon.id, text: "Label the pro forma column clearly", raisedById: anita.id, status: "cleared" });
  const nwc = await create(ctx, "workpapers", { engagementId: falcon.id, workstreamId: await ws(falcon.id, "NWC"), ref: "B.2", title: "Monthly NWC trend & peg", myRole: "reviewer", preparerId: sneha.id, status: "prepared", due: t });
  await create(ctx, "workpapers", { engagementId: falcon.id, workstreamId: await ws(falcon.id, "Net debt"), ref: "C.1", title: "Net debt & debt-like items", myRole: "reviewer", preparerId: arjun.id, status: "in_progress", due: ahead(3) });
  await create(ctx, "workpapers", { engagementId: falcon.id, workstreamId: await ws(falcon.id, "Tax"), ref: "D.1", title: "Tax exposures summary", myRole: "preparer", reviewerId: anita.id, status: "not_started", due: ahead(5) });
  await create(ctx, "workpapers", { engagementId: heron.id, workstreamId: await ws(heron.id, "QoE"), ref: "A.1", title: "Revenue by customer analysis", myRole: "reviewer", preparerId: sneha.id, status: "in_review" });
  void nwc;

  // IRL for Falcon: some received, some chased.
  const irl = [
    ["1", "Trial balances FY22–FY24 and YTD", "received"],
    ["2", "Audited financial statements FY22–FY24", "received"],
    ["3", "Monthly management accounts (last 24 months)", "partial"],
    ["4", "Fixed asset register with additions/disposals", "pending"],
    ["5", "Debtors and creditors ageing as at each month end", "pending"],
    ["6", "Details of related party transactions", "pending"],
    ["7", "Borrowing agreements and repayment schedules", "pending"],
    ["8", "Payroll summary and headcount by department", "received"],
  ] as const;
  for (const [number, description, status] of irl) {
    const r = await createInfoRequest(ctx, { engagementId: falcon.id, number, description, requestedFromId: rahul.id, requestedOn: ago(9), status, nextChaseOn: status === "pending" || status === "partial" ? ago(1) : undefined });
    if (number === "4") await logChase({ ...ctx, now: () => new Date(Date.now() - 4 * 864e5) }, "infoRequests", r.record.id);
  }
  await createInfoRequest(ctx, { engagementId: heron.id, number: "1", description: "Customer-wise revenue FY23–FY24", requestedFromId: meera.id, requestedOn: ago(2) });
  await createInfoRequest(ctx, { engagementId: heron.id, number: "2", description: "Fleet lease agreements", requestedFromId: meera.id, requestedOn: ago(2) });

  // Follow-ups and tasks.
  await createFollowUp(ctx, { about: "Sign-off on QoE adjustments list", personId: anita.id, type: "manager", engagementId: falcon.id, nextNudgeOn: t });
  await createFollowUp(ctx, { about: "Decision on treatment of deferred revenue in net debt", personId: vikram.id, type: "manager", engagementId: falcon.id, due: ahead(2) });
  await createFollowUp(ctx, { about: "Updated NWC peg workings", personId: sneha.id, type: "team", engagementId: falcon.id, nextNudgeOn: ago(1) });
  await create(ctx, "tasks", { title: "Clear review points on A.1 EBITDA bridge", engagementId: falcon.id, due: t, priority: "high" });
  await create(ctx, "tasks", { title: "Draft executive summary for Falcon draft report", engagementId: falcon.id, due: ahead(4) });
  await create(ctx, "tasks", { title: "Send Heron IRL v1 to client", engagementId: heron.id, due: ago(1) });
  await create(ctx, "tasks", { title: "Reconcile debt schedule to TB", engagementId: falcon.id, assigneeId: arjun.id, due: ahead(1) });
  await create(ctx, "tasks", { title: "Book timesheet for last week", due: t });
}
