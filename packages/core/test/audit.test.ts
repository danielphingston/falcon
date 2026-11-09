import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  addFollowUps,
  classifyLedger,
  defaultPeriods,
  detectLayout,
  engagementKindFor,
  generateProgramme,
  loadSnapshot,
  mapLines,
  parseAmount,
  parseTrialBalance,
  programmeView,
  progressOf,
  suggestionsFor,
  create,
  type Ctx,
  type Procedure,
  type TrialBalance,
} from "../src";

// A detailed Tally-style TB for a D2C brand: title rows, a two-row header,
// primary groups as header rows, a user sub-group with a subtotal row, Dr/Cr
// in separate columns, and the previous year alongside.
const g = (rows: (string | number)[][]) => rows.map((r) => r.map(String));
const tally = g([
  ["Acme D2C Pvt Ltd"],
  ["Trial Balance", "", "", "", ""],
  ["", "FY 2024-25", "", "FY 2023-24", ""],
  ["Particulars", "Debit", "Credit", "Debit", "Credit"],
  ["Capital Account", "", "1,00,00,000", "", "1,00,00,000"],
  ["Share Capital", "", "1,00,00,000", "", "1,00,00,000"],
  ["Sundry Debtors", "1,00,00,000", "", "75,00,000", ""],
  ["Marketplace Debtors", "80,00,000", "", "60,00,000", ""],
  ["Amazon Seller Services", "50,00,000", "", "40,00,000", ""],
  ["Flipkart Internet", "30,00,000", "", "20,00,000", ""],
  ["Retail Debtor A", "20,00,000", "", "15,00,000", ""],
  ["Bank Accounts", "40,00,000", "", "50,00,000", ""],
  ["HDFC Bank", "40,00,000", "", "50,00,000", ""],
  ["Sundry Creditors", "", "30,00,000", "", "25,00,000"],
  ["Packaging Supplier", "", "30,00,000", "", "25,00,000"],
  ["Duties & Taxes", "", "5,00,000", "", "4,00,000"],
  ["GST Payable", "", "5,00,000", "", "4,00,000"],
  ["Sales Accounts", "", "11,00,00,000", "", "10,00,00,000"],
  ["E-commerce Sales", "", "11,00,00,000", "", "10,00,00,000"],
  ["Purchase Accounts", "6,00,00,000", "", "5,50,00,000", ""],
  ["Purchases", "6,00,00,000", "", "5,50,00,000", ""],
  ["Indirect Expenses", "4,95,00,000", "", "4,54,00,000", ""],
  ["Salaries", "1,50,00,000", "", "1,40,00,000", ""],
  ["Depreciation", "5,00,000", "", "4,00,000", ""],
  ["Advertisement - Meta", "3,40,00,000", "", "3,10,00,000", ""],
  ["Grand Total", "", "", "", ""],
]);

describe("TB reading", () => {
  it("parses Indian amounts and Dr/Cr suffixes", () => {
    expect(parseAmount("1,23,456.50 Dr")).toBe(123456.5);
    expect(parseAmount("500 Cr")).toBe(-500);
    expect(parseAmount("(2,000)")).toBe(-2000);
    expect(parseAmount("₹ 1,000")).toBe(1000);
    expect(parseAmount("-")).toBeUndefined();
    expect(parseAmount("abc")).toBeUndefined();
  });

  it("finds the two-row header and both periods", () => {
    const layout = detectLayout(tally);
    expect(layout.headerRow).toBe(3);
    expect(layout.periods.map((p) => p.label)).toEqual(["FY 2024-25", "FY 2023-24"]);
    expect(layout.periods[0]).toMatchObject({ debit: 1, credit: 2 });
  });

  it("reads ledgers, skips group headers and sub-group subtotals, and balances", () => {
    const tb = parseTrialBalance(tally);
    expect(tb.lines.map((l) => l.ledger)).toEqual([
      "Share Capital",
      "Amazon Seller Services",
      "Flipkart Internet",
      "Retail Debtor A",
      "HDFC Bank",
      "Packaging Supplier",
      "GST Payable",
      "E-commerce Sales",
      "Purchases",
      "Salaries",
      "Depreciation",
      "Advertisement - Meta",
    ]);
    expect(tb.lines[1].groups).toEqual(["Sundry Debtors", "Marketplace Debtors"]);
    expect(tb.lines[1].balances).toEqual([5000000, 4000000]);
    expect(tb.lines[0].balances).toEqual([-10000000, -10000000]);
    expect(tb.difference).toEqual([0, 0]);
    expect(tb.warnings).toEqual([]);
  });

  it("supports a flat TB with a group column and a single net column", () => {
    const flat = g([
      ["Ledger", "Group", "Closing Balance"],
      ["ICICI Bank", "Bank Accounts", "10,000 Dr"],
      ["Sales", "Sales Accounts", "10,000 Cr"],
    ]);
    const tb = parseTrialBalance(flat);
    expect(tb.lines).toEqual([
      { ledger: "ICICI Bank", groups: ["Bank Accounts"], balances: [10000] },
      { ledger: "Sales", groups: ["Sales Accounts"], balances: [-10000] },
    ]);
  });
});

describe("mapping", () => {
  it.each([
    ["Amazon Seller Services", ["Sundry Debtors"], "receivables"],
    ["HDFC OD", ["Bank OD A/c"], "borrowings"],
    ["Depreciation", ["Indirect Expenses"], "depreciation"],
    ["Salaries", ["Indirect Expenses"], "employee_costs"],
    ["Interest on Term Loan", ["Indirect Expenses"], "finance_costs"],
    ["Provision for Income Tax", ["Provisions"], "tax"],
    ["Provision for Gratuity", ["Provisions"], "provisions"],
    ["Computer Software", ["Fixed Assets"], "intangibles_cwip"],
    ["GST Payable", ["Duties & Taxes"], "statutory_dues"],
    ["Rent", ["Indirect Expenses"], "other_expenses"],
    ["Suspense", ["Suspense A/c"], "unmapped"],
    ["Flipkart Receivable", [], "receivables"],
    ["Kotak Mahindra Bank", [], "cash_bank"],
    ["Something odd", [], "unmapped"],
  ])("%s → %s", (ledger, groups, area) => expect(classifyLedger(ledger, groups).area).toBe(area));

  it("infers the engagement kind from its type", () => {
    expect(engagementKindFor("Due Diligence")).toBe("fdd");
    expect(engagementKindFor("Internal Audit")).toBe("ia");
    expect(engagementKindFor("Stat Audit")).toBe("audit");
  });
});

const lib: Procedure[] = [
  { id: "receivables.ledger", area: "receivables", text: "Scrutinise the AR ledger", why: "w", assertions: ["existence"], kinds: ["audit"], core: true, followUps: [{ text: "Extend sample", why: "y" }] },
  { id: "receivables.marketplace", area: "receivables", text: "Reconcile to marketplace settlement reports", why: "w", assertions: ["existence"], kinds: ["audit"], industries: ["d2c"], followUps: [] },
  { id: "receivables.fdd-nwc", area: "receivables", text: "NWC: DSO trend", why: "w", assertions: ["valuation"], kinds: ["fdd"], followUps: [] },
  { id: "cash_bank.brs", area: "cash_bank", text: "Bank reconciliations", why: "w", assertions: ["existence"], kinds: ["audit"], core: true, followUps: [] },
  { id: "cash_bank.confirm", area: "cash_bank", text: "Bank confirmations", why: "w", assertions: ["existence"], kinds: ["audit"], followUps: [] },
  { id: "general.planning", area: "general", text: "Plan the audit", why: "w", assertions: ["presentation"], kinds: ["audit", "fdd"], core: true, followUps: [] },
];

describe("programme", () => {
  const makeTb = (over: Partial<TrialBalance> = {}): TrialBalance => {
    const parsed = parseTrialBalance(tally);
    return {
      id: "tb1",
      engagementId: "e1",
      fileName: "tb.xlsx",
      importedAt: "2026-11-10T00:00:00Z",
      periods: parsed.layout.periods.map((p) => ({ label: p.label, isOpening: p.isOpening })),
      ...defaultPeriods(parsed.layout.periods),
      lines: mapLines(parsed),
      kind: "audit",
      industry: "d2c",
      createdAt: "",
      updatedAt: "",
      deleted: false,
      updatedBy: "app",
      ...over,
    } as TrialBalance;
  };

  it("computes materiality and the AR-vs-revenue trend from the user's example", () => {
    const view = programmeView(makeTb());
    expect(view.materiality).toMatchObject({ basis: "1% of revenue", overall: 1100000, performance: 830000 });
    const ar = view.insights.find((i) => i.id === "ar-vs-revenue")!;
    // Revenue +10% → expect receivables +8% to +12%; actual +33.3%.
    expect(ar.status).toBe("flag");
    expect(ar.detail).toContain("+8.0% to +12.0%");
    expect(ar.detail).toContain("+33.3%");
    expect(ar.followUps.length).toBeGreaterThan(2);
    expect(view.plans.find((p) => p.area === "receivables")).toMatchObject({ current: 10000000, prior: 7500000, scope: "full" });
  });

  it("generates procedures for kind and industry, scoped by materiality, without duplicates", async () => {
    const store = new MemoryStore();
    const ctx: Ctx = { store, by: "app" };
    // Bank is 40L now and 50L last year: below a 55L performance materiality, so core steps only.
    const tb = makeTb({ performance: 5500000, materiality: 7000000 });
    await generateProgramme(ctx, lib, tb, []);
    let items = (await loadSnapshot(store)).programItems;
    expect(items.map((i) => i.procedureId).sort()).toEqual(["cash_bank.brs", "general.planning", "receivables.ledger", "receivables.marketplace"]);
    // Re-running adds nothing new.
    await generateProgramme(ctx, lib, tb, items);
    items = (await loadSnapshot(store)).programItems;
    expect(items).toHaveLength(4);
    // FDD kind gets the FDD procedure instead.
    const fdd = new MemoryStore();
    await generateProgramme({ store: fdd, by: "app" }, lib, makeTb({ kind: "fdd" }), []);
    expect((await loadSnapshot(fdd)).programItems.map((i) => i.procedureId).sort()).toEqual(["general.planning", "receivables.fdd-nwc"]);
  });

  it("suggests follow-ups for a flagged step and tracks progress", async () => {
    const store = new MemoryStore();
    const ctx: Ctx = { store, by: "app" };
    await generateProgramme(ctx, lib, makeTb(), []);
    const items = (await loadSnapshot(store)).programItems;
    const ledger = items.find((i) => i.procedureId === "receivables.ledger")!;
    const s = suggestionsFor(lib, ledger, items);
    expect(s).toEqual([{ text: "Extend sample", why: "y" }]);
    await addFollowUps(ctx, ledger, s);
    const after = (await loadSnapshot(store)).programItems;
    expect(after.find((i) => i.parentId === ledger.id)).toMatchObject({ source: "followup", area: "receivables" });
    expect(suggestionsFor(lib, ledger, after)).toEqual([]); // already added
    await create(ctx, "programItems", { engagementId: "e1", area: "general", text: "x", status: "done" });
    const p = progressOf((await loadSnapshot(store)).programItems);
    expect(p.done).toBe(1);
    expect(p.byArea.get("general")).toMatchObject({ done: 1 });
  });
});

describe("work programme AI tools", () => {
  it("reads the programme and adds and reviews steps", async () => {
    const { runTool, MemoryStore: MS, create: mk } = await import("../src");
    const store = new MS();
    const ctx = { store, by: "chat" as const };
    const e = await mk({ store, by: "app" }, "engagements", { name: "Project Falcon" });
    const parsed = parseTrialBalance(tally);
    await mk({ store, by: "app" }, "trialBalances", {
      engagementId: e.record.id,
      importedAt: "2026-11-10T00:00:00Z",
      periods: parsed.layout.periods.map((p) => ({ label: p.label, isOpening: p.isOpening })),
      currentIdx: 0,
      priorIdx: 1,
      lines: mapLines(parsed),
      kind: "audit",
      industry: "d2c",
    });
    const read = await runTool(ctx, "get_work_programme", { engagement: "falcon", area: "receivables" });
    expect(read.ok).toBe(true);
    expect(read.result).toMatchObject({ kind: "audit", industry: "d2c", areas: [{ area: "receivables", current: 10000000, prior: 7500000 }] });
    expect((read.result as { trendFlags: unknown[] }).trendFlags).toHaveLength(1);

    const add = await runTool(ctx, "add_program_items", { engagement: "falcon", area: "receivables", items: [{ text: "Check Amazon reserve balances withheld at year end", why: "Withheld reserves may not be recoverable" }] });
    const id = (add.result as { ids: string[] }).ids[0];
    expect(await store.get("programItems", id)).toMatchObject({ source: "ai", area: "receivables" });
    await runTool(ctx, "update_program_item", { id, status: "done", review: "flagged", reviewNote: "2 reserves unexplained" });
    expect(await store.get("programItems", id)).toMatchObject({ status: "done", review: "flagged", reviewNote: "2 reserves unexplained" });
  });
});
