// Invented RFI fixtures only.
import { describe, expect, it } from "vitest";
import { MemoryStore, applyRfi, parseRfi, planRfi, rfiDate, rfiStatus, type Ctx } from "../src";

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
    expect(p.items.map((i) => i.number)).toEqual(["1.1", "1.2", "1.3", "1.4", "2.1"]);
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

  it("returns null when there's no request table", () => {
    expect(parseRfi([{ name: "Sheet1", rows: [["a", "b"]] }])).toBeNull();
  });
});
