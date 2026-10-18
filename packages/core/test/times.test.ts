import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  computeToday,
  create,
  defaultSettings,
  desiredEvents,
  loadSnapshot,
  parseQuickAdd,
  parseTimeWord,
  runTool,
  type Ctx,
} from "../src";

describe("time parsing", () => {
  it.each([
    ["3pm", "15:00"],
    ["3:30pm", "15:30"],
    ["10am", "10:00"],
    ["12pm", "12:00"],
    ["12am", "00:00"],
    ["15:00", "15:00"],
    ["9.30am", "09:30"],
    ["9:05", "09:05"],
  ])("%s → %s", (w, t) => expect(parseTimeWord(w)).toBe(t));

  it.each(["3", "25:00", "13pm", "10:75", "fri", "spam"])("rejects %s", (w) => expect(parseTimeWord(w)).toBeUndefined());
});

describe("quick add with times", () => {
  const ctx = { today: "2026-10-16", people: [], engagements: [], settings: defaultSettings(), now: new Date("2026-10-16T11:00:00") };
  it("handles !day@time, !time, 'at time' and bare am/pm", () => {
    expect(parseQuickAdd("Call Rahul !fri@15:30", ctx)).toMatchObject({ text: "Call Rahul", due: "2026-10-16", time: "15:30" });
    expect(parseQuickAdd("Team sync !tom@10am", ctx)).toMatchObject({ due: "2026-10-17", time: "10:00" });
    expect(parseQuickAdd("Call bank at 3pm", ctx)).toMatchObject({ text: "Call bank", due: "2026-10-16", time: "15:00" });
    expect(parseQuickAdd("Standup 9:30am", ctx)).toMatchObject({ text: "Standup", due: "2026-10-17", time: "09:30" }); // already past today
    expect(parseQuickAdd("Review FY24 TB", ctx).time).toBeUndefined();
  });
});

describe("timed tasks on the calendar", () => {
  it("become timed events with a reminder, even with all-day due dates off", async () => {
    const store = new MemoryStore();
    const c: Ctx = { store, by: "app" };
    await create(c, "tasks", { title: "Call Rahul re TB", due: "2026-10-20", dueTime: "15:30", durationMinutes: 45 });
    await create(c, "tasks", { title: "Untimed", due: "2026-10-20" });
    const ev = desiredEvents(await loadSnapshot(store), { calendarAlerts: true, calendarKeyDates: false, calendarDueDates: false }, "2026-10-16");
    expect(ev).toHaveLength(1);
    const start = new Date(ev[0].start);
    expect([start.getHours(), start.getMinutes()]).toEqual([15, 30]); // local time
    expect((Date.parse(ev[0].end) - Date.parse(ev[0].start)) / 60000).toBe(45);
    expect(ev[0]).toMatchObject({ allDay: false, summary: "Call Rahul re TB", reminderMinutes: 10 });
    // With due dates on, the untimed one is all-day and the timed one stays timed.
    const both = desiredEvents(await loadSnapshot(store), { calendarAlerts: true, calendarKeyDates: false, calendarDueDates: true }, "2026-10-16");
    expect(both.map((e) => e.allDay).sort()).toEqual([false, true]);
  });

  it("orders Today's due items by time", async () => {
    const store = new MemoryStore();
    const c: Ctx = { store, by: "app" };
    await create(c, "tasks", { title: "Untimed", due: "2026-10-16" });
    await create(c, "tasks", { title: "Late", due: "2026-10-16", dueTime: "17:00" });
    await create(c, "tasks", { title: "Early", due: "2026-10-16", dueTime: "09:00" });
    const v = computeToday(await loadSnapshot(store), "2026-10-16");
    expect(v.dueToday.map((d) => (d.record as { title: string }).title)).toEqual(["Early", "Late", "Untimed"]);
  });

  it("AI tools set and clear the time", async () => {
    const store = new MemoryStore();
    const ctx = { store, by: "chat" as const };
    const r = await runTool(ctx, "create_task", { title: "Client call", due: "2026-10-20", time: "11:00", durationMinutes: 60 });
    expect(r.ok).toBe(true);
    const id = (r.result as { created: { id: string } }).created.id;
    expect(await store.get("tasks", id)).toMatchObject({ dueTime: "11:00", durationMinutes: 60 });
    expect((await runTool(ctx, "create_task", { title: "x", time: "11:00" })).error).toMatch(/needs a date/);
    expect((await runTool(ctx, "create_task", { title: "x", due: "2026-10-20", time: "3pm" })).ok).toBe(false); // must be HH:mm
    await runTool(ctx, "update_task", { id, time: "" });
    expect((await store.get("tasks", id))!.dueTime).toBeUndefined();
  });
});
