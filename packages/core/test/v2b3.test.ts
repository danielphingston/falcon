// Build brief v2 B3 (RFI titles), B4 (books tagging), B5 (orphans in the Inbox). Invented data only.
import { describe, expect, it } from "vitest";
import { MemoryStore, acceptProposal, create, defaultChoices, isBooksItem, proposeOrphanCleanups, remove, rfiTitle, type Ctx } from "../src";

describe("RFI titles (B3)", () => {
  it("joins a label line with the next line", () => {
    expect(rfiTitle("Output\nGSTR 1 & GSTR 3B for the DD period\nMonth-wise")).toBe("Output – GSTR 1 & GSTR 3B for the DD period");
    expect(rfiTitle("Input:\nGSTR 2B for the DD period")).toBe("Input – GSTR 2B for the DD period");
    expect(rfiTitle("1. Income Tax Portal\nLogin credentials")).toBe("1. Income Tax Portal – Login credentials");
    expect(rfiTitle("\n  Bank statements for all accounts\nCurrent and savings")).toBe("Bank statements for all accounts");
    expect(rfiTitle("Fixed asset register")).toBe("Fixed asset register");
  });
});

describe("books tagging (B4)", () => {
  it("tags the books themselves, not items that mention them", () => {
    expect(isBooksItem({ description: "Accounting backup for DD period" })).toBe(true);
    expect(isBooksItem({ description: "Tally credentials for the period" })).toBe(true);
    expect(isBooksItem({ description: "Books of accounts for the review period" })).toBe(true);
    expect(isBooksItem({ description: "List and addresses of all working locations & place of maintenance of books of accounts" })).toBe(false);
    expect(isBooksItem({ description: "Accounting policies followed for the books of accounts" })).toBe(false);
    // Manual override wins.
    expect(isBooksItem({ description: "Accounting backup", books: false })).toBe(false);
  });
});

describe("orphan RFI items (B5)", () => {
  it("proposes deleting copies of items already on the right engagement, once per group", async () => {
    const store = new MemoryStore({ myName: "Test User" });
    const ctx: Ctx = { store, by: "app" };
    const home = (await create(ctx, "engagements", { name: "Project Kite" })).record;
    const gone = (await create(ctx, "engagements", { name: "Kite (old import)" })).record;
    await create(ctx, "infoRequests", { engagementId: home.id, number: "2.2", description: "Revenue tracker", requestedOn: "2026-11-06" });
    const copy = (await create(ctx, "infoRequests", { engagementId: gone.id, number: "2.2", description: "Revenue tracker", requestedOn: "2026-11-23" })).record;
    const extra = (await create(ctx, "infoRequests", { engagementId: gone.id, number: "9.9", description: "Board minutes", requestedOn: "2026-11-23", status: "received" })).record;
    await remove(ctx, "engagements", gone.id);
    expect(await proposeOrphanCleanups(ctx)).toBe(1);
    expect(await proposeOrphanCleanups(ctx)).toBe(0);
    const p = (await store.list("proposals"))[0];
    // The copy is deleted; the received item has history, so moving it is the default.
    expect(defaultChoices(p).sort()).toEqual(["delete-copies", "reassign"]);
    await acceptProposal(ctx, p.id);
    expect((await store.get("infoRequests", copy.id))?.deleted).toBe(true);
    expect((await store.get("infoRequests", extra.id))?.engagementId).toBe(home.id);
    // Search would now find "Revenue tracker" only on Project Kite.
    expect((await store.list("infoRequests")).filter((r) => !r.deleted && r.description === "Revenue tracker").map((r) => r.engagementId)).toEqual([home.id]);
  });

  it("move and delete exclude each other", async () => {
    const { closeChoices } = await import("../src");
    const p = { choices: [{ key: "reassign", excludes: ["delete"] }, { key: "delete", excludes: ["reassign"] }] } as never;
    expect(closeChoices(p, ["delete", "reassign"])).toEqual(["delete"]);
  });
});
