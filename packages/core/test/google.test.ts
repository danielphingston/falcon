import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryStore,
  create,
  defaultSettings,
  desiredEvents,
  driveAppDataFile,
  loadSnapshot,
  planCalendar,
  remove,
  syncWithRemote,
  tableNames,
  update,
  type Ctx,
  type EntityMap,
  type LocalSide,
  type RemoteFile,
  type Settings,
  type TableName,
} from "../src";

// ---------- fakes ----------

function fakeRemote() {
  let content: unknown = null;
  let version = 0;
  const remote: RemoteFile & { writes: number; bumpExternally?: () => void } = {
    writes: 0,
    async read() {
      return { content: content === null ? null : JSON.parse(JSON.stringify(content)), version: content === null ? null : String(version) };
    },
    async version() {
      return content === null ? null : String(version);
    },
    async write(c) {
      content = JSON.parse(JSON.stringify(c));
      version++;
      remote.writes++;
      return { version: String(version) };
    },
  };
  return remote;
}

function device(name: string, start: string) {
  let clock = Date.parse(start);
  const store = new MemoryStore();
  let settingsUpdatedAt = "";
  const ctx: Ctx = { store, by: "app", now: () => new Date((clock += 1000)) };
  const local: LocalSide = {
    async snapshot() {
      const tables = Object.fromEntries(await Promise.all(tableNames.map(async (t) => [t, await store.list(t)]))) as never;
      return { tables, settings: store.settings, settingsUpdatedAt };
    },
    async put<T extends TableName>(t: T, records: EntityMap[T][]) {
      for (const r of records) await store.put(t, r);
    },
    async putSettings(patch: Partial<Settings>, at: string) {
      store.settings = { ...store.settings, ...patch };
      settingsUpdatedAt = at;
    },
  };
  return {
    name,
    store,
    ctx,
    local,
    setSettings(p: Partial<Settings>, at: string) {
      store.settings = { ...store.settings, ...p };
      settingsUpdatedAt = at;
    },
  };
}

// ---------- sync ----------

describe("Drive sync", () => {
  it("moves records between two devices, including deletes", async () => {
    const remote = fakeRemote();
    const laptop = device("laptop", "2026-10-16T09:00:00Z");
    const phone = device("phone", "2026-10-16T10:00:00Z");

    const eng = await create(laptop.ctx, "engagements", { name: "Falcon" });
    const task = await create(laptop.ctx, "tasks", { title: "Draft QoE", engagementId: eng.record.id });
    expect(await syncWithRemote(laptop.local, remote)).toMatchObject({ pulled: 0, pushed: true });

    expect(await syncWithRemote(phone.local, remote)).toMatchObject({ pulled: 2, pushed: false });
    expect((await phone.store.get("tasks", task.record.id))!.title).toBe("Draft QoE");

    // Phone edits (later clock), laptop deletes something else.
    await update(phone.ctx, "tasks", task.record.id, { title: "Draft QoE bridge" });
    const extra = await create(laptop.ctx, "tasks", { title: "Temp" });
    await remove(laptop.ctx, "tasks", extra.record.id);

    await syncWithRemote(phone.local, remote);
    const r = await syncWithRemote(laptop.local, remote);
    expect(r.pulled).toBe(1);
    expect((await laptop.store.get("tasks", task.record.id))!.title).toBe("Draft QoE bridge");

    await syncWithRemote(phone.local, remote);
    expect((await phone.store.get("tasks", extra.record.id))!.deleted).toBe(true);
    // Nothing new: no upload.
    const writes = remote.writes;
    expect((await syncWithRemote(phone.local, remote)).pushed).toBe(false);
    expect(remote.writes).toBe(writes);
  });

  it("syncs shared settings by recency, keeping device-only ones", async () => {
    const remote = fakeRemote();
    const a = device("a", "2026-10-16T09:00:00Z");
    const b = device("b", "2026-10-16T09:00:00Z");
    a.setSettings({ chaseDays: { client: 3, manager: 2, team: 1, other: 2 }, theme: "dark", googleClientId: "abc" }, "2026-10-16T09:00:00Z");
    await syncWithRemote(a.local, remote);
    await syncWithRemote(b.local, remote);
    expect(b.store.settings.chaseDays.client).toBe(3);
    expect(b.store.settings.theme).toBe("system");
    const stored = (await remote.read()).content as { settings: Settings };
    expect(stored.settings.googleClientId).toBe("");
  });

  it("re-merges when another device writes mid-sync", async () => {
    const remote = fakeRemote();
    const a = device("a", "2026-10-16T09:00:00Z");
    await create(a.ctx, "tasks", { title: "one" });
    await syncWithRemote(a.local, remote);

    const b = device("b", "2026-10-16T11:00:00Z");
    await create(b.ctx, "tasks", { title: "two" });
    const origVersion = remote.version.bind(remote);
    let interfered = false;
    remote.version = async () => {
      if (!interfered) {
        interfered = true;
        await create(a.ctx, "tasks", { title: "three" });
        await syncWithRemote(a.local, remote);
      }
      return origVersion();
    };
    await syncWithRemote(b.local, remote);
    const titles = ((await remote.read()).content as { tables: { tasks: { title: string }[] } }).tables.tasks.map((t) => t.title).sort();
    expect(titles).toEqual(["one", "three", "two"]);
  });
});

// ---------- Drive REST shapes ----------

describe("Drive appData client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates the file in appDataFolder, then patches it", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let exists = false;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/drive/v3/files?spaces=appDataFolder"))
        return new Response(JSON.stringify({ files: exists ? [{ id: "f1", version: "7" }] : [] }));
      if (url.includes("uploadType=multipart")) {
        exists = true;
        return new Response(JSON.stringify({ id: "f1", version: "6" }));
      }
      if (url.includes("uploadType=media")) return new Response(JSON.stringify({ id: "f1", version: "8" }));
      if (url.includes("alt=media")) return new Response(JSON.stringify({ hello: 1 }));
      return new Response("nope", { status: 404 });
    });
    const file = driveAppDataFile(async () => "tok");
    expect(await file.read()).toEqual({ content: null, version: null });
    expect(await file.write({ a: 1 })).toEqual({ version: "6" });
    const create = calls.find((c) => c.url.includes("multipart"))!;
    expect(create.init!.method).toBe("POST");
    expect(String(create.init!.body)).toContain('"parents":["appDataFolder"]');
    expect((create.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(await file.read()).toEqual({ content: { hello: 1 }, version: "7" });
    expect(await file.write({ a: 2 })).toEqual({ version: "8" });
    expect(calls.at(-1)!.init!.method).toBe("PATCH");
  });

  it("surfaces auth errors", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "Invalid Credentials" } }), { status: 401 }));
    const err = await driveAppDataFile(async () => "bad").read().catch((e) => e);
    expect(err.needsAuth).toBe(true);
    expect(err.message).toContain("Invalid Credentials");
  });
});

// ---------- Calendar ----------

describe("calendar planning", () => {
  const settings = { ...defaultSettings(), calendarDueDates: true };

  it("builds events for alerts, key dates and due dates", async () => {
    const store = new MemoryStore();
    const ctx: Ctx = { store, by: "app", now: () => new Date("2026-10-16T09:00:00Z") };
    const e = await create(ctx, "engagements", { name: "Falcon", draftReport: "2026-10-28" });
    await create(ctx, "engagements", { name: "Old", status: "closed", finalReport: "2026-10-20" });
    await create(ctx, "tasks", { title: "Draft", due: "2026-10-20", engagementId: e.record.id });
    await create(ctx, "tasks", { title: "Done", due: "2026-10-20", status: "done" });
    await create(ctx, "alerts", { title: "Chase TB", fireAt: "2026-10-17T10:30:00.000Z" });
    const ev = desiredEvents(await loadSnapshot(store), settings, "2026-10-16");
    expect(ev.map((x) => x.summary).sort()).toEqual(["✅ Draft", "📑 Falcon: Draft report", "🔔 Chase TB"].sort());
    const draft = ev.find((x) => x.key.endsWith(":draftReport"))!;
    expect(draft).toMatchObject({ allDay: true, start: "2026-10-28", end: "2026-10-29", reminderMinutes: 900 });
    expect(ev.find((x) => x.key.startsWith("alert:"))).toMatchObject({ allDay: false, reminderMinutes: 0 });
    expect(desiredEvents(await loadSnapshot(store), { ...settings, calendarDueDates: false, calendarAlerts: false }, "2026-10-16")).toHaveLength(1);
  });

  it("diffs desired against existing", () => {
    const d = (key: string, summary: string) => ({ key, summary, allDay: true, start: "2026-10-20", end: "2026-10-21" });
    const plan = planCalendar(
      [d("a", "A"), d("b", "B changed"), d("c", "C")],
      [
        { ...d("b", "B"), id: "gb" },
        { ...d("c", "C"), id: "gc" },
        { ...d("c", "C"), id: "gc-dupe" },
        { ...d("gone", "Old"), id: "gx" },
      ],
    );
    expect(plan.insert.map((x) => x.key)).toEqual(["a"]);
    expect(plan.update).toEqual([{ id: "gb", event: d("b", "B changed") }]);
    expect(plan.remove.sort()).toEqual(["gc-dupe", "gx"]);
  });

  it("treats equal instants in different formats as unchanged", () => {
    const want = { key: "k", summary: "S", allDay: false, start: "2026-10-17T10:30:00.000Z", end: "2026-10-17T10:45:00.000Z", reminderMinutes: 0 };
    const have = { ...want, id: "g", start: "2026-10-17T16:00:00+05:30", end: "2026-10-17T16:15:00+05:30" };
    expect(planCalendar([want], [have])).toEqual({ insert: [], update: [], remove: [] });
  });
});
