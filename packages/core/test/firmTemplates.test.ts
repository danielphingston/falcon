// Fixtures here are invented: never put the firm's real template text in this repo.
import { describe, expect, it } from "vitest";
import { firmCues, learnedFor, matchTemplates, parseFirmWorkbook, splitTests, templateNameFromFile, type FirmTemplate, type LearnedCheck } from "../src";

const sheet = (name: string, rows: string[][]) => ({ name, rows });

describe("firm templates", () => {
  it("names templates from file names", () => {
    expect(templateNameFromFile("Client Name - FY 2025-26 - Widget Payables.xlsx")).toBe("Widget Payables");
    expect(templateNameFromFile("Copy of Client Name - FY 2025-26 - Gizmo Leases-2.xlsx")).toBe("Gizmo Leases");
    expect(templateNameFromFile("CLIENT -FY 2025-26 - Sundry Accruals.xlsx")).toBe("Sundry Accruals");
    expect(templateNameFromFile("Client Name - Brand Assets - FY 2025-26.xlsx")).toBe("Brand Assets");
    expect(templateNameFromFile("Client Name - FY 2025-26 - Spare Parts - Copy.xlsx")).toBe("Spare Parts");
    expect(templateNameFromFile("1. Client Name - FY 2025-26 - Requests.xlsx")).toBe("Requests");
  });

  it("splits numbered tests without breaking dates or sections", () => {
    expect(splitTests("1.Match the ledger 2.Look at old items 3.Check approvals")).toEqual(["Match the ledger", "Look at old items", "Check approvals"]);
    expect(splitTests("Balance as on 1.04.2025 per Section 186")).toEqual(["Balance as on 1.04.2025 per Section 186"]);
    expect(splitTests("Valuation:\n(a) Cost method\n(b) Market method")).toEqual(["Valuation:", "Cost method", "Market method"]);
    expect(splitTests("Completed/ Pending")).toEqual([]);
  });

  it("reads a checklist sheet: inputs, checks with tests, groups, risks; skips assertions", () => {
    const t = parseFirmWorkbook("Client Name - FY 2025-26 - Widget Receivables.xlsx", [
      sheet("Index", [["Sl No", "Particulars", "Reference"], ["1", "Checklist", "Checklist"], ["2", "Ageing", "Ageing"], ["3", "Charts", "Charts"]]),
      sheet("Checklist ", [
        ["Widget Receivables - Checklist"],
        ["Sl. No.", "Assertion", "Check"],
        ["1", "Existence", "The widgets exist"],
        ["Sl No", "Checklist", "Details", "Status", "Remarks"],
        ["1", "Inputs Required", "Widget ledger", "", ""],
        ["", "", "Widget ageing", "", ""],
        ["A", "Counting", "", "", ""],
        ["1", "Widget ageing review", "1.Find old widgets 2.Ask why they are old", "Completed/ Pending", ""],
        ["2", "Confirmation", "Send widget confirmations", "", ""],
        ["", "", "Reconcile replies", "", ""],
        ["3", "Risk Assessment", "Dummy widgets", "", ""],
        ["", "", "Cut off", "", ""],
        ["Assertions covered"],
        ["Existence", "Count them", "Confirm them"],
      ]),
    ])!;
    expect(t.name).toBe("Widget Receivables");
    expect(t.areas).toEqual(["receivables"]);
    expect(t.items.map((i) => [i.kind, i.title])).toEqual([
      ["inputs", "Inputs Required"],
      ["check", "Widget ageing review"],
      ["check", "Confirmation"],
      ["risks", "Risk Assessment"],
      ["sections", "Sections of the work paper completed"],
    ]);
    expect(t.items[0].tests).toEqual(["Widget ledger", "Widget ageing"]);
    expect(t.items[1]).toMatchObject({ group: "Counting", tests: ["Find old widgets", "Ask why they are old"] });
    expect(t.items[2].tests).toEqual(["Send widget confirmations", "Reconcile replies"]);
    expect(t.items[4].tests).toEqual(["Checklist", "Ageing"]);
    expect(new Set(t.items.map((i) => i.key)).size).toBe(t.items.length);
  });

  it("reads a procedures sheet without serial numbers, with headings", () => {
    const t = parseFirmWorkbook("Client Name - FY 2025-26 - Gadget Stock.xlsx", [
      sheet("Procedure & Scope", [
        ["Procedures to be performed", "Annexure", "Performed", "Remarks (If any)"],
        ["1. Understand gadget controls", "", "", ""],
        ["2. Compare gadget counts (a) by type (b) by site", "Ratio", "", ""],
        ["Gadgets in transit - review", "", "", ""],
        ["1. Transit papers", "", "", ""],
        ["2. Carrier confirmations", "", "", ""],
        ["Applicable Standards", "Link", ""],
        ["SA 999", "x", ""],
      ]),
    ])!;
    expect(t.items.map((i) => i.title)).toEqual(["Understand gadget controls", "Compare gadget counts", "Gadgets in transit - review"]);
    expect(t.items[1].tests).toEqual(["by type", "by site"]);
    expect(t.items[2].tests).toEqual(["Transit papers", "Carrier confirmations"]);
  });

  it("splits a generic 'procedures to be performed' row into one question per procedure", () => {
    const t = parseFirmWorkbook("Client Name - FY 2025-26 - Doohickey Payables.xlsx", [
      sheet("Checklist", [
        ["Sl.No.", "Checklist", "Details", "Annexure", "Status"],
        ["1", "Procedures to be performed", "1. Age the doohickeys", "Risk grid", ""],
        ["", "", "2. Look at later payments", "", ""],
        ["", "", "3. Reconcile confirmations", "", ""],
      ]),
    ])!;
    expect(t.items.map((i) => [i.title, i.tests.length])).toEqual([
      ["Age the doohickeys", 0],
      ["Look at later payments", 0],
      ["Reconcile confirmations", 0],
    ]);
  });

  it("turns an index-only workbook into one question per section, with the reason", () => {
    const t = parseFirmWorkbook("Client Name - FY 2025-26 - Levy Reconciliation.xlsx", [
      sheet("Index", [["Sl. No", "Particulars", "Workings sheet", "Remarks"], ["1", "Levy returns vs books", "R1", "All entries are in the books"], ["2", "Levy paid vs ledger", "R2", ""]]),
    ])!;
    expect(t.items.map((i) => [i.title, i.why])).toEqual([
      ["Levy returns vs books", "All entries are in the books"],
      ["Levy paid vs ledger", undefined],
    ]);
    expect(parseFirmWorkbook("Notes.xlsx", [sheet("Sheet1", [["hello"]])])).toBeNull();
  });

  it("matches work papers to templates", () => {
    const tpls = [
      { id: "ar", name: "Accounts Receivable", areas: ["receivables" as const] },
      { id: "gst", name: "GST Reconciliation", areas: ["statutory_dues" as const] },
      { id: "pf", name: "PF Reconciliation", areas: ["statutory_dues" as const] },
    ];
    expect(matchTemplates({ title: "C.4 Trade receivables" }, tpls)[0].id).toBe("ar");
    expect(matchTemplates({ title: "GST reconciliation" }, tpls)[0].id).toBe("gst");
    expect(matchTemplates({ title: "PF dues" }, tpls)[0].id).toBe("pf");
    expect(matchTemplates({ title: "Board minutes" }, tpls)).toEqual([]);
  });

  it("orders questions: template basics, then learned checks (new until answered)", () => {
    const tpl: FirmTemplate = {
      id: "t1",
      name: "Widgets",
      sourceFile: "w.xlsx",
      areas: [],
      importedAt: "2026-11-01T00:00:00Z",
      items: [{ key: "count", title: "Count widgets", kind: "check", tests: ["Floor to sheet", "Sheet to floor"] }],
    };
    const learned: LearnedCheck[] = [
      { id: "l1", text: "Check widget insurance", templateId: "t1", createdAt: "2026-11-02T00:00:00Z" },
      { id: "l2", text: "Only on WP 7", workpaperId: "wp7", createdAt: "2026-11-03T00:00:00Z" },
      { id: "l3", text: "Other template", templateId: "t2", createdAt: "2026-11-03T00:00:00Z" },
      { id: "l4", text: "Area-wide", area: "inventory", createdAt: "2026-11-04T00:00:00Z" },
    ];
    const mine = learnedFor(learned, { id: "wp1", area: "inventory" }, "t1");
    expect(mine.map((l) => l.id)).toEqual(["l1", "l4"]);
    const answers = [{ id: "wp1|count", workpaperId: "wp1", key: "count", answer: "ok" as const, tests: [true, false], at: "" }];
    const cues = firmCues(tpl, mine, answers, "wp1");
    expect(cues.map((c) => [c.phase, c.title, c.answer, c.isNew ?? false])).toEqual([
      ["template", "Count widgets", "ok", false],
      ["learned", "Check widget insurance", "none", true],
      ["learned", "Area-wide", "none", true],
    ]);
    expect(cues[0].testsDone).toEqual([true, false]);
    const later = firmCues(tpl, mine, [...answers, { id: "wp1|learned:l1", workpaperId: "wp1", key: "learned:l1", answer: "ok" as const, at: "" }], "wp1");
    expect(later[1].isNew).toBe(false);
  });
});
