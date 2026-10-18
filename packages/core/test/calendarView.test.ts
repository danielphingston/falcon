import { describe, expect, it } from "vitest";
import { MemoryStore, calendarItems, create, googleItems, layoutDay, loadSnapshot, type Ctx } from "../src";

describe("calendar view", () => {
  it("collects app items in range, timed and all-day", async () => {
    const store = new MemoryStore();
    const c: Ctx = { store, by: "app" };
    const e = await create(c, "engagements", { name: "Falcon", draftReport: "2026-10-21" });
    await create(c, "engagements", { name: "Old", status: "closed", finalReport: "2026-10-21" });
    await create(c, "tasks", { title: "Call", due: "2026-10-20", dueTime: "15:00", durationMinutes: 45, engagementId: e.record.id });
    await create(c, "tasks", { title: "Untimed", due: "2026-10-20" });
    await create(c, "tasks", { title: "Out of range", due: "2026-11-20" });
    await create(c, "workpapers", { engagementId: e.record.id, ref: "B.2", title: "NWC", due: "2026-10-22" });
    await create(c, "alerts", { title: "Ping", fireAt: new Date("2026-10-19T09:30:00").toISOString() });

    const items = calendarItems(await loadSnapshot(store), "2026-10-19", "2026-10-25");
    expect(items.map((i) => i.title)).toEqual(["Ping", "Untimed", "Call", "Falcon: Draft report", "B.2 NWC"]);
    expect(items.find((i) => i.title === "Call")).toMatchObject({ start: "15:00", minutes: 45, engagement: "Falcon", table: "tasks" });
    expect(items.find((i) => i.title === "Ping")).toMatchObject({ start: "09:30", kind: "alert" });
    expect(items.find((i) => i.title === "Untimed")!.start).toBeUndefined();
  });

  it("turns Google events into items, skipping the app's own and splitting multi-day all-day events", () => {
    const items = googleItems([
      { id: "a", summary: "Board meeting", allDay: false, start: new Date("2026-10-20T11:00:00").toISOString(), end: new Date("2026-10-20T12:30:00").toISOString(), ours: false },
      { id: "b", summary: "Offsite", allDay: true, start: "2026-10-21", end: "2026-10-23", ours: false },
      { id: "c", summary: "📑 ours", allDay: true, start: "2026-10-21", end: "2026-10-22", ours: true },
    ]);
    expect(items.map((i) => `${i.title}@${i.date}${i.start ? ` ${i.start}/${i.minutes}` : ""}`)).toEqual([
      "Board meeting@2026-10-20 11:00/90",
      "Offsite@2026-10-21",
      "Offsite@2026-10-22",
    ]);
  });

  it("lays out overlapping events side by side", () => {
    const placed = layoutDay([
      { start: "09:00", minutes: 60 },
      { start: "09:30", minutes: 60 },
      { start: "10:00", minutes: 30 },
      { start: "13:00", minutes: 30 },
    ]);
    expect(placed.map((p) => `${p.item.start}:${p.col}/${p.cols}`)).toEqual(["09:00:0/2", "09:30:1/2", "10:00:0/2", "13:00:0/1"]);
  });
});
