import { useRef, useState, type ReactNode } from "react";
import { BACKUP_VERSION, mergeRecords, parseBackup, tableNames, type Backup, type Settings } from "@fdd/core";
import { Icon } from "../components/Icon";
import { TLink } from "../components/TLink";
import { Segmented } from "../components/ui";
import { db, getSettings, saveSettings } from "../db";
import { act } from "../lib/act";
import { useSettings } from "../lib/hooks";
import { loadSampleData } from "../lib/sample";
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
      toast({ message: `Imported. ${changed} record${changed === 1 ? "" : "s"} added or updated`, tone: "success" });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Import failed", tone: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Settings</h1>
        <p className="text-sm muted">Everything is stored on this device. Google sync and AI chat come in later phases.</p>
      </header>

      <TLink to="/people" className="card flex items-center gap-3 p-4 md:hidden">
        <Icon name="users" />
        <span className="flex-1 font-medium">People</span>
        <Icon name="chevron" size={18} className="muted" />
      </TLink>

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
      <p className="pb-4 text-center text-xs muted">FDD Tracker · Phase 1 · data stays on this device</p>
    </div>
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
      <div className="min-w-0">
        <p className="text-[15px] font-medium">{label}</p>
        {hint && <p className="text-xs muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-7 w-12 rounded-full transition-colors ${on ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-700"}`}>
      <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}
