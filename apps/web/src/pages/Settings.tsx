import { useRef, useState, type ReactNode } from "react";
import { BACKUP_VERSION, mergeRecords, parseBackup, tableNames, type Backup, type Settings } from "@fdd/core";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/ui";
import { db, getSettings, saveSettings } from "../db";
import { act } from "../lib/act";
import { useSettings } from "../lib/hooks";
import { loadSampleData } from "../lib/sample";
import { useLiveQuery } from "dexie-react-hooks";
import { SyncBadge } from "../components/SyncBadge";
import { connectGoogle, disconnectGoogle, hasScope, readAuth } from "../lib/google";
import { markSignedOut, scheduleSync, syncNow, useSyncStatus } from "../lib/sync";
import { toast } from "../lib/toast";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function SettingsPage() {
  const s = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [perm, setPerm] = useState(() => ("Notification" in window ? Notification.permission : "unsupported"));
  const set = (patch: Partial<Settings>) => void saveSettings(patch);

  const exportJson = async () => {
    const tables = Object.fromEntries(await Promise.all(tableNames.map(async (t) => [t, await db.table(t).toArray()]))) as Backup["tables"];
    const backup: Backup = { app: "fdd-tracker", version: BACKUP_VERSION, exportedAt: new Date().toISOString(), settings: await getSettings(), tables };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fdd-tracker-backup-${backup.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      const backup = parseBackup(JSON.parse(await file.text()));
      let changed = 0;
      await db.transaction("rw", tableNames.map((t) => db.table(t)), async () => {
        for (const t of tableNames) {
          const local = await db.table(t).toArray();
          const res = mergeRecords(local as never[], backup.tables[t] as never[]);
          if (res.changed.length) await db.table(t).bulkPut(res.changed);
          changed += res.changed.length;
        }
      });
      if (backup.settings) await saveSettings(backup.settings);
      scheduleSync(500);
      toast({ message: `Imported. ${changed} record${changed === 1 ? "" : "s"} added or updated`, tone: "success" });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Import failed", tone: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Settings</h1>
        <p className="text-sm muted">Data lives on this device, and syncs through your own Google Drive once you connect.</p>
      </header>

      <GoogleGroup s={s} />

      <Group title="You">
        <Row label="Your name" hint="Used in greetings and chase emails">
          <input className="input max-w-56" defaultValue={s.myName === "Me" ? "" : s.myName} placeholder="Your name" onBlur={(e) => set({ myName: e.target.value.trim() || "Me" })} />
        </Row>
      </Group>

      <Group title="Working week">
        <Row label="Working days" hint="Chase dates skip non-working days">
          <div className="flex gap-1">
            {DAYS.map((d, i) => {
              const on = s.workingDays.includes(i);
              return (
                <button
                  key={i}
                  className={`size-9 rounded-full text-sm font-semibold transition-colors ${on ? "bg-brand-600 text-white" : "bg-[var(--surface-2)] muted"}`}
                  onClick={() => set({ workingDays: on ? s.workingDays.filter((x) => x !== i) : [...s.workingDays, i].sort() })}
                  aria-pressed={on}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </Row>
        <Row label="Holidays" hint="Comma-separated, YYYY-MM-DD">
          <input
            className="input max-w-72"
            defaultValue={s.holidays.join(", ")}
            placeholder="2026-11-09, 2026-12-25"
            onBlur={(e) => {
              const list = e.target.value.split(/[,\s]+/).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
              set({ holidays: list });
            }}
          />
        </Row>
        {(["client", "manager", "team"] as const).map((k) => (
          <Row key={k} label={`Chase ${k === "client" ? "clients" : k === "manager" ? "managers" : "team"} every`}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={30}
                className="input w-20"
                defaultValue={s.chaseDays[k]}
                onBlur={(e) => set({ chaseDays: { ...s.chaseDays, [k]: Math.max(1, Number(e.target.value) || 1) } })}
              />
              <span className="text-sm muted">working days</span>
            </div>
          </Row>
        ))}
      </Group>

      <Group title="Look & feel">
        <Row label="Theme">
          <Segmented id="theme" value={s.theme} onChange={(theme) => set({ theme })} options={[{ value: "system", label: "Auto" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </Row>
        <Row label="Animations" hint="Page transitions and motion">
          <Switch on={s.motion} onChange={(motion) => set({ motion })} />
        </Row>
        <Row label="Confetti" hint="Celebrate finished work">
          <Switch on={s.confetti} onChange={(confetti) => set({ confetti })} />
        </Row>
      </Group>

      <Group title="Time & progress">
        <Row label="Gamification" hint="Daily ring, streaks, levels and badges">
          <Switch on={s.gamification} onChange={(gamification) => set({ gamification })} />
        </Row>
        <Row label="Focus sessions per day" hint="Target for the green ring">
          <input type="number" min={0} max={12} className="input w-20" defaultValue={s.focusTarget} onBlur={(e) => set({ focusTarget: Math.min(12, Math.max(0, Number(e.target.value) || 0)) })} />
        </Row>
        <Row label="Default focus length" hint="Minutes">
          <input type="number" min={5} max={180} className="input w-20" defaultValue={s.focusMinutes} onBlur={(e) => set({ focusMinutes: Math.min(180, Math.max(5, Number(e.target.value) || 25)) })} />
        </Row>
        <Row label="Timesheet rounding">
          <Segmented
            id="increment"
            value={String(s.timeIncrement)}
            onChange={(v) => set({ timeIncrement: Number(v) })}
            options={[
              { value: "0.1", label: "0.1h" },
              { value: "0.25", label: "¼h" },
              { value: "0.5", label: "½h" },
            ]}
          />
        </Row>
      </Group>

      <Group title="Reminders">
        <Row label="Notifications" hint="Reminders pop up while the app is open. Calendar alerts come with Google sync.">
          {perm === "granted" ? (
            <span className="text-sm font-medium text-emerald-600">Allowed</span>
          ) : perm === "unsupported" ? (
            <span className="text-sm muted">Install the app first (iPhone)</span>
          ) : (
            <button className="btn btn-soft btn-sm" onClick={async () => setPerm(await Notification.requestPermission())}>
              <Icon name="bell" size={14} /> Allow
            </button>
          )}
        </Row>
      </Group>

      <Group title="Data">
        <Row label="Back up" hint="Download everything as a JSON file">
          <button className="btn btn-soft btn-sm" onClick={exportJson}>
            <Icon name="download" size={14} /> Export
          </button>
        </Row>
        <Row label="Restore / merge" hint="Newer records win; nothing is lost">
          <button className="btn btn-soft btn-sm" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={14} /> Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = "";
            }}
          />
        </Row>
        <Row label="Sample data" hint="A demo engagement to explore. Undo removes it">
          <button className="btn btn-soft btn-sm" onClick={() => act("Sample data loaded", (ctx) => loadSampleData(ctx))}>
            <Icon name="sparkles" size={14} /> Load
          </button>
        </Row>
        <Row label="Erase everything" hint="Deletes all data on this device">
          <button
            className="btn btn-soft btn-sm text-rose-600"
            onClick={async () => {
              if (!window.confirm("Erase all FDD Tracker data on this device? Export a backup first if you might need it.")) return;
              await db.delete();
              location.reload();
            }}
          >
            <Icon name="trash" size={14} /> Erase
          </button>
        </Row>
      </Group>
      <p className="pb-4 text-center text-xs muted">FDD Tracker · Phase 3</p>
    </div>
  );
}

function GoogleGroup({ s }: { s: Settings }) {
  const auth = useLiveQuery(readAuth, []);
  const status = useSyncStatus();
  const [clientId, setClientId] = useState(s.googleClientId);
  const [busy, setBusy] = useState(false);
  const builtIn = !!import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const set = (patch: Partial<Settings>) => void saveSettings(patch).then(() => scheduleSync(500));

  const connect = async () => {
    setBusy(true);
    try {
      if (!builtIn && clientId.trim() !== s.googleClientId) await saveSettings({ googleClientId: clientId.trim() });
      const a = await connectGoogle();
      const missing = [
        !hasScope(a, "https://www.googleapis.com/auth/drive.appdata") && "Drive sync",
        !hasScope(a, "https://www.googleapis.com/auth/calendar.events") && "Calendar",
      ].filter(Boolean);
      toast({
        message: missing.length ? `Connected, but without ${missing.join(" and ")}. Tick those boxes when connecting to use them.` : `Connected as ${a.email ?? "your Google account"}`,
        tone: missing.length ? "default" : "success",
        duration: 7000,
      });
      await syncNow();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't connect", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="Google sync & Calendar">
      {!auth ? (
        <>
          <div className="space-y-2 px-4 py-3">
            <p className="text-[15px] font-medium">Sync across devices with Google</p>
            <p className="text-xs muted">
              Your data is saved to a hidden app folder in <b>your own</b> Google Drive (you won't see it in Drive), and deadlines, reminders and focus blocks go to your Google Calendar. Nothing passes through any other server.
            </p>
          </div>
          {!builtIn && (
            <Row label="OAuth client ID" hint="From Google Cloud. See README → Google setup">
              <input className="input max-w-72 font-mono text-xs" placeholder="1234-abc.apps.googleusercontent.com" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </Row>
          )}
          <div className="px-4 py-3">
            <button className="btn btn-primary w-full sm:w-auto" onClick={connect} disabled={busy || (!builtIn && !clientId.trim())}>
              <Icon name="cloud" size={16} /> {busy ? "Connecting…" : "Connect Google account"}
            </button>
          </div>
        </>
      ) : (
        <>
          <Row label={auth.email ?? "Google account"} hint={status.state === "needs-auth" ? "Session expired. Reconnect to keep syncing" : "Connected"}>
            <div className="flex flex-wrap items-center gap-2">
              <SyncBadge />
              {status.state === "needs-auth" ? (
                <button className="btn btn-primary btn-sm" onClick={connect} disabled={busy}>
                  Reconnect
                </button>
              ) : (
                <button className="btn btn-soft btn-sm" onClick={() => void syncNow()} disabled={status.state === "syncing"}>
                  <Icon name="refresh" size={14} /> Sync now
                </button>
              )}
            </div>
          </Row>
          {status.state === "error" && status.message && <p className="px-4 py-2 text-xs text-rose-600">{status.message}</p>}
          <Row label="Reminders → Calendar" hint="Each reminder becomes an event with a popup, so it fires on every device">
            <Switch on={s.calendarAlerts} onChange={(calendarAlerts) => set({ calendarAlerts })} />
          </Row>
          <Row label="Key dates → Calendar" hint="Kick-off, data room, draft & final report (all-day, reminder the day before)">
            <Switch on={s.calendarKeyDates} onChange={(calendarKeyDates) => set({ calendarKeyDates })} />
          </Row>
          <Row label="Due dates → Calendar" hint="Tasks, work papers and follow-ups with a due date">
            <Switch on={s.calendarDueDates} onChange={(calendarDueDates) => set({ calendarDueDates })} />
          </Row>
          <Row label="Disconnect" hint="Stops syncing on this device. Data here and in Drive stays">
            <button
              className="btn btn-soft btn-sm"
              onClick={async () => {
                await disconnectGoogle();
                markSignedOut();
                toast({ message: "Google disconnected" });
              }}
            >
              Disconnect
            </button>
          </Row>
        </>
      )}
    </Group>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-sm font-semibold uppercase tracking-wide muted">{title}</h2>
      <div className="card divide-y divide-[var(--border)]">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-[15px] font-medium">{label}</p>
        {hint && <p className="text-xs muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-700"}`}>
      <span className={`absolute left-0.5 top-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}
