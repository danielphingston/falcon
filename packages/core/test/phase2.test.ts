import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  create,
  createInfoRequest,
  defaultSettings,
  levelFor,
  loadSnapshot,
  logChase,
  newlyEarnedBadges,
  periodReport,
  pointEvents,
  ringFor,
  runTool,
  setTaskDone,
  streakFor,
  timesheet,
  timesheetText,
  update,
  weekStart,
  weeklyRecap,
  type Ctx,
  type DayRecord,
} from "../src";

const NOW = new Date("2026-10-16T10:00:00"); // Friday
const TODAY = "2026-10-16";
const setup = () => {
  const store = new MemoryStore();
  const ctx: Ctx = { store, by: "app", now: () => NOW };
  return { store, ctx };
};

describe("completion stamps", () => {
  it("are set on finish and cleared on reopen", async () => {
    const { store, ctx } = setup();
    const e = await create(ctx, "engagements", { name: "Falcon" });
    const w = await create(ctx, "workpapers", { engagementId: e.record.id, ref: "A.1", title: "QoE" });
    await update(ctx, "workpapers", w.record.id, { status: "final" });
    expect((await store.get("workpapers", w.record.id))!.finalAt).toBe(NOW.toISOString());
    await update(ctx, "workpapers", w.record.id, { status: "in_review" });
    expect((await store.get("workpapers", w.record.id))!.finalAt).toBeUndefined();
    const t = await create(ctx, "tasks", { title: "x" });
    await setTaskDone(ctx, t.record.id, true);
    expect((await store.get("tasks", t.record.id))!.completedAt).toBeDefined();
  });
});

describe("timesheet", () => {
  it("builds an engagement × day grid with rounding", async () => {
    const { store, ctx } = setup();
    const e = await create(ctx, "engagements", { name: "Falcon", timesheetCode: "DA-1" });
    await create(ctx, "timeEntries", { date: "2026-10-12", minutes: 95, engagementId: e.record.id });
    await create(ctx, "timeEntries", { date: "2026-10-12", minutes: 20, engagementId: e.record.id });
    await create(ctx, "timeEntries", { date: "2026-10-14", minutes: 30 });
    await create(ctx, "timeEntries", { date: "2026-10-20", minutes: 60, engagementId: e.record.id }); // next week
    const snap = await loadSnapshot(store);
    const t = timesheet(snap.timeEntries, snap.engagements, weekStart(TODAY), 0.25);
    expect(t.days[0]).toBe("2026-10-12");
    expect(t.rows[0]).toMatchObject({ name: "Falcon", code: "DA-1", total: 2 });
    expect(t.rows[0].hours[0]).toBe(2); // 115 min → 1.92h → 2.0
    expect(t.rows[1]).toMatchObject({ name: "Other / admin", total: 0.5 });
    expect(t.total).toBe(2.5);
    expect(timesheetText(t).split("\n")).toHaveLength(4);
  });
});

describe("points, levels and ring", () => {
  it("counts finished work and chases, not hours", async () => {
    const { store, ctx } = setup();
    const e = await create(ctx, "engagements", { name: "Falcon" });
    const irl = await createInfoRequest(ctx, { engagementId: e.record.id, description: "TB", requestedOn: "2026-10-10" });
    await logChase(ctx, "infoRequests", irl.record.id);
    await update(ctx, "infoRequests", irl.record.id, { status: "received" });
    const t = await create(ctx, "tasks", { title: "x", due: TODAY });
    await setTaskDone(ctx, t.record.id, true);
    await create(ctx, "timeEntries", { date: TODAY, minutes: 25, focus: true, source: "timer" });
    await create(ctx, "timeEntries", { date: TODAY, minutes: 300 });

    const snap = await loadSnapshot(store);
    const total = pointEvents(snap).reduce((a, p) => a + p.points, 0);
    expect(total).toBe(3 + 30 + 5 + 10); // chase + IRL complete + task + focus
    expect(levelFor(total).name).toBe("Article Assistant");
    expect(levelFor(120)).toMatchObject({ name: "Associate", next: "Senior" });

    const ring = ringFor(snap, TODAY, { focusTarget: 1 });
    expect(ring.due).toMatchObject({ done: 1, total: 1 });
    expect(ring.chases.ratio).toBe(1);
    expect(ring.closed).toBe(true);
    expect(ringFor(snap, TODAY, { focusTarget: 3 }).closed).toBe(false);
  });

  it("undo takes points back", async () => {
    const { store, ctx } = setup();
    const t = await create(ctx, "tasks", { title: "x" });
    const r = await setTaskDone(ctx, t.record.id, true);
    expect(pointEvents(await loadSnapshot(store))).toHaveLength(1);
    const { undoBatch } = await import("../src");
    await undoBatch(store, r.change.batchId);
    expect(pointEvents(await loadSnapshot(store))).toHaveLength(0);
  });
});

describe("streaks", () => {
  const s = defaultSettings();
  const day = (date: string, ringClosed = true): DayRecord =>
    ({ id: date, date, ringClosed, overdueChases: 0, createdAt: "", updatedAt: "", deleted: false, updatedBy: "app" }) as DayRecord;
  const good = (d?: DayRecord) => !!d?.ringClosed;

  it("skips weekends and doesn't break on an unfinished today", () => {
    // Thu 8, Fri 9, (weekend), Mon 12, Tue 13; today Wed 14 not yet closed.
    const days = ["2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13"].map((d) => day(d));
    expect(streakFor(days, "2026-10-14", s, good)).toMatchObject({ current: 4, best: 4 });
  });

  it("a freeze covers one missed day per week", () => {
    const days = [day("2026-10-12"), day("2026-10-14"), day("2026-10-15")]; // missed Tue 13
    expect(streakFor(days, "2026-10-15", s, good)).toMatchObject({ current: 3, freezeAvailable: false });
    const twoMissed = [day("2026-10-12"), day("2026-10-15")]; // missed 13 and 14
    expect(streakFor(twoMissed, "2026-10-15", s, good).current).toBe(1);
  });
});

describe("badges and recap", () => {
  it("awards IRL Zero once", async () => {
    const { store, ctx } = setup();
    const e = await create(ctx, "engagements", { name: "Falcon" });
    await createInfoRequest(ctx, { engagementId: e.record.id, description: "TB", requestedOn: TODAY, status: "received" });
    const snap = await loadSnapshot(store);
    const earned = newlyEarnedBadges({ s: snap, days: [], bestStreak: 0 }, []);
    expect(earned).toContain("irl_zero");
    expect(earned).not.toContain("first_close");
    const already = [{ badge: "irl_zero" } as never];
    expect(newlyEarnedBadges({ s: snap, days: [], bestStreak: 0 }, already)).not.toContain("irl_zero");
  });

  it("summarises a week", async () => {
    const { store, ctx } = setup();
    const t = await create(ctx, "tasks", { title: "x" });
    await setTaskDone(ctx, t.record.id, true);
    await create(ctx, "timeEntries", { date: TODAY, minutes: 50, focus: true });
    const snap = await loadSnapshot(store);
    const recap = weeklyRecap(snap, [], weekStart(TODAY), TODAY);
    expect(recap).toMatchObject({ week: "2026-W42", points: 15, itemsCleared: 1, bestDay: { date: TODAY, points: 15 } });
    expect(periodReport(snap, TODAY, TODAY, TODAY).minutes).toBe(50);
  });
});

describe("phase 2 AI tools", () => {
  it("logs time and reports it", async () => {
    const { store } = setup();
    const ctx = { store, by: "chat" as const, now: () => NOW };
    await runTool(ctx, "create_engagement", { name: "Project Falcon", timesheetCode: "DA-1" });
    const r = await runTool(ctx, "log_time", { minutes: 90, engagement: "falcon" });
    expect(r.ok).toBe(true);
    const rep = await runTool(ctx, "weekly_report", {});
    expect(rep.result).toMatchObject({ minutes: 90 });
    expect((rep.result as { timesheet: string }).timesheet).toContain("1.5");
    const stats = await runTool(ctx, "get_stats", {});
    expect(stats.ok).toBe(true);
  });
});
