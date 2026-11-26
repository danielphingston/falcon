// Invented RFI fixtures only.
import { describe, expect, it } from "vitest";
import { MemoryStore, applyRfi, create, parseRfi, planRfi, rankStatusColumn, rfiDate, rfiNumber, rfiStatus, type Ctx } from "../src";

const rfi = (rows: string[][]) => [
  { name: "Notes", rows: [["hello"]] },
  {
    name: "RFI",
    rows: [
      ["", "Shared"],
      ["Widget Co", "Received"],
      ["Request for Information", "Pending"],
      ["Sl No", "Particulars", "Date of request", "Status", "Annexure", "Remarks", "Date Received", "Person Responsible", "EDR", "Auditee Comment", "Remarks"],
      ...rows,
    ],
  },
];

describe("RFI import", () => {
  it("reads dates and statuses", () => {
    expect(rfiDate("46112")).toBe("2026-03-31");
    expect(rfiDate("31/03/2026")).toBe("2026-03-31");
    expect(rfiDate("5-Apr-26")).toBe("2026-04-05");
    expect(rfiDate("2026-04-05T00:00")).toBe("2026-04-05");
    expect(rfiDate("soon")).toBeUndefined();
    expect(rfiStatus("Received")).toEqual({ status: "received" });
    expect(rfiStatus("Shared")).toEqual({ status: "pending" });
    expect(rfiStatus("Not Applicable")).toEqual({ status: "na" });
    expect(rfiStatus("Not Available")).toEqual({ status: "na", notAvailable: true });
    expect(rfiStatus("")).toEqual({});
  });

  it("parses sections, renumbers requests and keeps sub-points", () => {
    const p = parseRfi(
      rfi([
        ["1", "General"],
        ["1.1000000000000001", "Gadget register", "46100", "Received", "1", "", "46110", "Asha", "", "Sent by mail"],
        ["1.2000000000000002", "Gadget policy"],
        ["1.3000000000000003", ""],
        ["1.4000000000000004", "Loans from banks:"],
        ["", "- Sanction letter"],
        ["", "- Repayment schedule"],
        ["1.1000000000000001", "Tenth request (sheet shows 1.1)"],
        ["2", "Widgets"],
        ["2.1", "Widget ageing", "", "Not Available", "", "Ask again in May", "", "", "46150", "Not maintained", "Will prepare"],
      ]),
    )!;
    expect(p.sheet).toBe("RFI");
    expect(p.sections).toEqual(["General", "Widgets"]);
    // The sheet's own numbers are kept (a blank 1.3 is skipped; "1.1" after 1.4 is 1.10).
    expect(p.items.map((i) => i.number)).toEqual(["1.1", "1.2", "1.4", "1.10", "2.1"]);
    expect(p.items[0]).toMatchObject({ section: "General", status: "received", requestedOn: "2026-03-19", receivedOn: "2026-03-29", annexure: "1", responsible: "Asha", clientComment: "Sent by mail" });
    expect(p.items[2].description).toBe("Loans from banks:\n- Sanction letter\n- Repayment schedule");
    expect(p.items[4]).toMatchObject({ status: "na", notAvailable: true, due: "2026-05-08", remarks: "Ask again in May", clientComment: "Not maintained · Will prepare" });
  });

  it("imports once, then updates on re-import without duplicating", async () => {
    const store = new MemoryStore();
    const ctx: Ctx = { store, by: "app" };
    const first = parseRfi(rfi([["1", "General"], ["1.1", "Gadget register"], ["1.2", "Gadget policy", "", "Pending"]]))!;
    const plan1 = planRfi(first, []);
    expect(plan1.create).toHaveLength(2);
    await applyRfi(ctx, plan1, { engagementId: "e1", today: "2026-04-01", resolvePerson: () => undefined });
    let items = await store.list("infoRequests");
    expect(items.map((i) => [i.number, i.section, i.status, i.requestedOn])).toEqual([
      ["1.1", "General", "pending", "2026-04-01"],
      ["1.2", "General", "pending", "2026-04-01"],
    ]);

    const second = parseRfi(rfi([["1", "General"], ["1.1", "Gadget register", "", "Received", "", "", "46120"], ["1.2", "Gadget policy", "", "Pending"], ["1.3", "Board minutes"]]))!;
    const plan2 = planRfi(second, items);
    expect(plan2.create.map((i) => i.description)).toEqual(["Board minutes"]);
    expect(plan2.update.map((u) => u.changes)).toEqual([["status → received"]]);
    expect(plan2.unchanged).toBe(1);
    await applyRfi(ctx, plan2, { engagementId: "e1", today: "2026-04-10" });
    items = await store.list("infoRequests");
    expect(items).toHaveLength(3);
    expect(items.find((i) => i.number === "1.1")).toMatchObject({ status: "received", receivedAt: "2026-04-08T12:00:00.000Z" });
  });

  it("reads an Area / File No layout: sections, sub-headings, notes, every column", () => {
    const p = parseRfi([
      {
        name: "RFI",
        rows: [
          ["", "", "", "", "", "", "", "Received"],
          ["", "Gizmo Widgets Private Limited", "", "", "", "", "", "To be Received"],
          ["", "Statutory Audit", "", "", "", "", "", "Partially Received"],
          ["", "Request for Information"],
          ["", "Sl. No", "Area", "File No", "Particulars", "Annexure", "Date of Request", "Status", "Date of Input", "Remarks - Gizmo", "Parties", "Remarks - Firm", "Remarks - Firm 01.10.26"],
          ["", "1", "General", "1.1000000000000001", "Trial balance", "", "46178", "Received", "46238", "Shared", "Asha", "OK"],
          ["", "", "", "1.2", "Org chart", "", "46178", "To be Received", "", "", "", "", "Still awaited"],
          ["", "2", "Registers", "", "Registers as maintained by the company under the Companies Act, 2013 (all of them)"],
          ["", "", "", "2.1", "Register of members", "", "46178", "Not Available"],
          ["", "3", "Statutory Dues", "", "TDS"],
          ["", "", "", "3.1", "TDS returns", "", "46178", "Partially Received"],
          ["", "", "", "", "Employee Dues"],
          ["", "", "", "", "ESIC"],
          ["", "", "", "3.2", "ESIC challans", "", "46178", "Received"],
          ["", "", "", "", "PF"],
          ["", "", "", "3.3", "PF challans", "", "46178", "Received"],
          ["", "", "", "3.4", "LWF", "", "46178", "Received"],
          ["", "", "", "3.5", "PT", "", "46178", "Received"],
          ["", "", "", "3.6", "Advance tax", "", "46178", "Received"],
          ["", "", "", "3.7", "Form 26AS", "", "46178", "Received"],
          ["", "", "", "3.8", "AIS", "", "46178", "Received"],
          ["", "", "", "3.9", "TIS", "", "46178", "Received"],
          ["", "", "", "3.1", "Tax audit report", "", "46178", "Received"],
          [],
          ["", "Please Note:"],
          ["", "*This is not an exhaustive list."],
        ],
      },
      { name: "A1", rows: [["Sl No", "Particulars", "Status"], ["1", "Annexure row", "Pending"]] },
      { name: "A", rows: [["anything"]] },
    ])!;
    expect(p.sheet).toBe("RFI");
    expect(p.sections).toEqual(["General", "Registers", "Statutory Dues"]);
    expect(p.items.map((i) => `${i.number} ${i.subsection ?? ""}`.trim())).toEqual([
      "1.1",
      "1.2",
      "2.1",
      "3.1 TDS",
      "3.2 Employee Dues › ESIC",
      "3.3 Employee Dues › PF",
      "3.4 Employee Dues › PF",
      "3.5 Employee Dues › PF",
      "3.6 Employee Dues › PF",
      "3.7 Employee Dues › PF",
      "3.8 Employee Dues › PF",
      "3.9 Employee Dues › PF",
      "3.10 Employee Dues › PF",
    ]);
    expect(p.items[0]).toMatchObject({
      description: "Trial balance",
      status: "received",
      requestedOn: "2026-06-05",
      receivedOn: "2026-08-04",
      responsible: "Asha",
      clientComment: "Shared",
      fields: [{ label: "Remarks - Firm", value: "OK" }],
    });
    expect(p.items[1]).toMatchObject({ status: "pending", fields: [{ label: "Remarks - Firm 01.10.26", value: "Still awaited" }] });
    expect(p.items[2]).toMatchObject({ status: "na", notAvailable: true });
    expect(p.info.title).toEqual(["Gizmo Widgets Private Limited", "Statutory Audit", "Request for Information"]);
    expect(p.info.sectionNotes).toEqual({ Registers: "Registers as maintained by the company under the Companies Act, 2013 (all of them)" });
    expect(p.info.notes).toEqual(["Please Note:", "*This is not an exhaustive list."]);
    expect(p.info.columns).toContain("Remarks - Firm 01.10.26");
    expect(p.warnings).toContain("Annexure sheets not imported: A1, A");
  });

  it("reads a Checklist / POC layout with links, criticality and a Notes sheet", () => {
    const p = parseRfi([
      { name: "Notes", rows: [["", "Gadget Labs Private Limited"], ["", "Notes"], ["", "1", "Please provide the documents below"], ["", "", "a.", "in a structured form;"]] },
      {
        name: "IRL",
        rows: [
          ["", "Gadget Labs Private Limited", "", "", "", "", "", "", "", "", "", "High"],
          ["", "Information Requisition List", "", "", "", "", "Last Updated:", "46336", "Received"],
          ["", "Sl.No", "File No.", "Area", "Checklist", "Criticality", "Annexure", "Date of request", "Status of Input", "POC", "Gadget Status", "Folder link", "Remarks [Gadget]", "Remarks [Firm]"],
          ["", "1", "1.1000000000000001", "General", "Trial balance", "High", "", "46332", "Received", "Ravi", "Shared", "1.1", "", "Got it"],
          ["", "", "1.2000000000000002", "", "Sales farming:"],
          ["", "", "1.3000000000000003", "", "Lead data", "Medium", "A1", "46332", "To be Received", "Ravi"],
          ["", "2", "", "Finance", "Bank:"],
          ["", "", "2.0999999999999996", "", "Bank statements", "High", "", "46332", "Partially Received", "Mira", "Shared", "", "Sep missing"],
        ],
        links: { "3,11": "https://example.com/folder/1-1" },
      },
      { name: "A1", rows: [["Sl No", "Checklist", "Status"]] },
    ])!;
    expect(p.items.map((i) => [i.number, i.section, i.subsection ?? ""])).toEqual([
      ["1.1", "General", ""],
      ["1.3", "General", "Sales farming"],
      ["2.1", "Finance", "Bank"],
    ]);
    expect(p.items[0]).toMatchObject({
      responsible: "Ravi",
      clientComment: "Gadget Status: Shared",
      fields: [
        { label: "Criticality", value: "High" },
        { label: "Folder link", value: "1.1", link: "https://example.com/folder/1-1" },
        { label: "Remarks [Firm]", value: "Got it" },
      ],
    });
    expect(p.items[1]).toMatchObject({ status: "pending", annexure: "A1" });
    expect(p.items[2].clientComment).toBe("Gadget Status: Shared · Remarks [Gadget]: Sep missing");
    expect(p.info.title).toEqual(["Gadget Labs Private Limited", "Information Requisition List · Last Updated: 2026-11-10"]);
    expect(p.info.notes).toEqual(["1 Please provide the documents below", "a. in a structured form;"]);
  });

  it("recovers the sheet's request numbers from Excel decimals", () => {
    expect(rfiNumber("1.1000000000000001", null)).toEqual({ major: 1, minor: 1 });
    expect(rfiNumber("2.1", { major: 2, minor: 9 })).toEqual({ major: 2, minor: 10 });
    expect(rfiNumber("2.1199999999999997", { major: 2, minor: 10 })).toEqual({ major: 2, minor: 12 });
    expect(rfiNumber("4.0999999999999996", null)).toEqual({ major: 4, minor: 1 });
    expect(rfiNumber("General", null)).toBeNull();
  });

  it("returns null when there's no request table", () => {
    expect(parseRfi([{ name: "Sheet1", rows: [["a", "b"]] }])).toBeNull();
  });
});

describe("RFI status column and numbers (build brief 1.1)", () => {
  const sheet = (rows: string[][]) => [{ name: "Finance", rows }];
  const head = ["Sl. No.", "Particulars", "Status Widgetco", "V&S Status", "Remarks"];
  const rows = [
    ["Widget Co Pvt Ltd"],
    head,
    ["5", "Bank"],
    ["5.9", "Bank statements", "Shared", "Received", ""],
    ["5.10", "Bank confirmations", "Shared", "Partially Received", ""],
    ["5.11", "FD statements", "", "Not Applicable ", ""],
    ["5.12", "Odd one", "", "Awaiting CFO", ""],
    ["5.13", "Blank status", "", "", ""],
  ];

  it("uses the firm's status column, not the client's", () => {
    expect(rankStatusColumn("V&S Status")).toBeGreaterThan(rankStatusColumn("Status"));
    expect(rankStatusColumn("Status Widgetco", "widgetco")).toBeLessThan(0);
    expect(rankStatusColumn("Current Status")).toBeLessThan(0);
    const p = parseRfi(sheet(rows))!;
    expect(p.info.statusColumns).toEqual([{ sheet: "Finance", options: ["Status Widgetco", "V&S Status"], chosen: "V&S Status" }]);
    expect(p.items.map((i) => [i.number, i.status ?? "-"])).toEqual([
      ["5.9", "received"],
      ["5.10", "partial"],
      ["5.11", "na"],
      ["5.12", "-"],
      ["5.13", "-"],
    ]);
    // The client's column is kept as information.
    expect(p.items[0].clientComment ?? p.items[0].fields?.map((f) => f.value).join()).toContain("Shared");
  });

  it("lists words it doesn't recognise instead of guessing, and follows the user's map", () => {
    const p = parseRfi(sheet(rows))!;
    expect(p.info.statusValues.find((v) => v.value === "Awaiting CFO")).toMatchObject({ status: undefined, count: 1 });
    expect(p.warnings.join()).toMatch(/not recognised.*Awaiting CFO/);
    const mapped = parseRfi(sheet(rows), { statusMap: { "awaiting cfo": "pending", received: "ignore" } })!;
    expect(mapped.items.find((i) => i.number === "5.12")?.status).toBe("pending");
    expect(mapped.items.find((i) => i.number === "5.9")?.status).toBeUndefined(); // "ignore" leaves it unchanged
  });

  it("can be told which column to use, or none", () => {
    expect(parseRfi(sheet(rows), { statusColumns: { Finance: "Status Widgetco" } })!.items[0].status).toBe("pending"); // "Shared" = pending
    expect(parseRfi(sheet(rows), { statusColumns: { Finance: "" } })!.items.every((i) => !i.status)).toBe(true);
  });

  it("keeps 5.10 as written and never gives two items one number", () => {
    expect(rfiNumber("5.10", { major: 5, minor: 9 })).toEqual({ major: 5, minor: 10 });
    expect(rfiNumber("12.20", null)).toEqual({ major: 12, minor: 20 });
    // Two rows both written "1.10" (a copy-paste slip): the second takes the next free number.
    const clash = parseRfi(sheet([head, ["1", "General"], ["1.10", "TB", "", "Received"], ["1.10", "GL", "", "Received"]]))!;
    expect(clash.items.map((i) => i.number)).toEqual(["1.10", "1.11"]);
    expect(clash.warnings.join()).toMatch(/renumbered to 1\.11/);
  });

  it("a blank status in a new version never changes an item", async () => {
    const store = new MemoryStore();
    const ctx: Ctx = { store, by: "app" };
    const eng = (await create(ctx, "engagements", { name: "W" })).record.id;
    const first = parseRfi(sheet(rows))!;
    await applyRfi(ctx, planRfi(first, []), { engagementId: eng, today: "2026-11-26", parsed: first });
    const blanked = rows.map((r, i) => (i >= 3 ? [r[0], r[1], r[2], "", r[4]] : r));
    const plan = planRfi(parseRfi(sheet(blanked))!, await store.list("infoRequests"));
    expect(plan.update).toHaveLength(0);
  });
});
