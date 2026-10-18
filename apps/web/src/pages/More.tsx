import { Icon, type IconName } from "../components/Icon";
import { SyncBadge } from "../components/SyncBadge";
import { TLink } from "../components/TLink";

const links: { to: string; label: string; hint: string; icon: IconName }[] = [
  { to: "/chat", label: "Assistant", hint: "Run your day by chatting with Gemini", icon: "sparkles" },
  { to: "/time", label: "Time & focus", hint: "Focus timer and timesheet", icon: "clock" },
  { to: "/reports", label: "Reports", hint: "Daily and weekly summaries", icon: "flag" },
  { to: "/progress", label: "Progress", hint: "Ring, streaks, level and badges", icon: "flag" },
  { to: "/people", label: "People", hint: "Clients, managers and team", icon: "users" },
  { to: "/settings", label: "Settings", hint: "Working week, backup, look & feel", icon: "settings" },
];

/** Overflow menu for the phone tab bar. */
export function MorePage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">More</h1>
        <SyncBadge />
      </div>
      <div className="card divide-y divide-[var(--border)]">
        {links.map((l) => (
          <TLink key={l.to} to={l.to} className="flex items-center gap-3 px-4 py-3.5">
            <span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-indigo-950 dark:text-indigo-300">
              <Icon name={l.icon} size={18} />
            </span>
            <div className="flex-1">
              <p className="font-medium">{l.label}</p>
              <p className="text-xs muted">{l.hint}</p>
            </div>
            <Icon name="chevron" size={18} className="muted" />
          </TLink>
        ))}
      </div>
    </div>
  );
}
