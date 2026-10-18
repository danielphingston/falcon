import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { useRegisterSW } from "virtual:pwa-register/react";
import { update } from "@fdd/core";
import { db, requestPersistence, store } from "../db";
import { setNavDirection } from "../lib/act";
import { celebrate } from "../lib/confetti";
import { useGameEngine } from "../lib/game";
import { useSettings, useSnapshot, useToday } from "../lib/hooks";
import { completeTimer, mmss, remainingMs, useTimer } from "../lib/timer";
import { toast } from "../lib/toast";
import { EditorHost, openEditor } from "./Editor";
import { LevelUpOverlay } from "./LevelUp";
import { Icon, type IconName } from "./Icon";
import { TLink } from "./TLink";
import { Toaster } from "./ui";

const nav: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "Today", icon: "today" },
  { to: "/engagements", label: "Engagements", icon: "briefcase" },
  { to: "/followups", label: "Follow-ups", icon: "inbox" },
  { to: "/review", label: "Review", icon: "review" },
  { to: "/time", label: "Time & focus", icon: "clock" },
  { to: "/reports", label: "Reports", icon: "flag" },
  { to: "/progress", label: "Progress", icon: "sparkles" },
  { to: "/people", label: "People", icon: "users" },
  { to: "/settings", label: "Settings", icon: "settings" },
];
const moreRoutes = ["/more", "/time", "/reports", "/progress", "/people", "/settings"];

const isActive = (path: string, to: string) => (to === "/" ? path === "/" : path.startsWith(to));

export function Layout() {
  const { pathname } = useLocation();
  const settings = useSettings();
  const snap = useSnapshot();
  const today = useToday();
  useTheme(settings.theme, settings.motion);
  useGameEngine(snap, today, settings);
  useTimerWatcher();
  useAlerts();
  useUpdatePrompt();
  useShortcuts();
  useEffect(() => {
    void requestPersistence();
    // Browser back/forward: slide the other way.
    const onPop = () => setNavDirection("back");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <MotionConfig reducedMotion={settings.motion ? "user" : "always"}>
      <div className="flex min-h-dvh">
        {/* Sidebar (laptop) */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-[var(--border)] bg-[var(--surface)] p-4 md:flex">
          <div className="mb-4 flex items-center gap-2.5 px-2">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-8" />
            <span className="text-lg font-bold tracking-tight">FDD Tracker</span>
          </div>
          {nav.map((n) => {
            const active = isActive(pathname, n.to);
            return (
              <TLink key={n.to} to={n.to} className={`relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${active ? "text-brand-700 dark:text-brand-200" : "muted hover:text-[var(--text)]"}`}>
                {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-brand-50 dark:bg-indigo-950/60" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                <Icon name={n.icon} size={19} className="relative" />
                <span className="relative">{n.label}</span>
              </TLink>
            );
          })}
          <div className="flex-1" />
          <button className="btn btn-primary w-full" onClick={() => openEditor({ table: "tasks" })}>
            <Icon name="plus" size={16} /> New task <kbd className="ml-auto rounded bg-white/20 px-1.5 text-[10px]">N</kbd>
          </button>
        </aside>

        <main className="vt-main min-w-0 flex-1 pb-28 md:pb-10">
          <div className="mx-auto max-w-3xl px-4 pt-[max(env(safe-area-inset-top),1rem)] md:px-8 md:pt-8">
            <Outlet />
          </div>
        </main>

        {/* Bottom tab bar (phone) */}
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-lg safe-bottom md:hidden">
          <div className="grid grid-cols-5">
            {nav.slice(0, 4).map((n) => (
              <TabLink key={n.to} {...n} active={isActive(pathname, n.to)} />
            ))}
            <TabLink to="/more" label="More" icon="more" active={moreRoutes.some((r) => pathname.startsWith(r))} />
          </div>
        </nav>
        <motion.button
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] right-4 z-40 grid size-14 place-items-center rounded-2xl bg-brand-600 text-white shadow-xl shadow-brand-600/30 md:hidden"
          whileTap={{ scale: 0.9 }}
          onClick={() => openEditor({ table: "tasks" })}
          aria-label="New task"
        >
          <Icon name="plus" size={26} />
        </motion.button>
      </div>
      {!pathname.startsWith("/time") && <TimerPill />}
      <EditorHost />
      <LevelUpOverlay />
      <Toaster />
    </MotionConfig>
  );
}

function TabLink({ to, label, icon, active }: { to: string; label: string; icon: IconName; active: boolean }) {
  return (
    <TLink to={to} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-brand-600 dark:text-brand-200" : "muted"}`}>
      {active && <motion.span layoutId="tab-active" className="absolute top-0 h-0.5 w-8 rounded-full bg-brand-600" />}
      <motion.span animate={{ y: active ? -1 : 0, scale: active ? 1.08 : 1 }}>
        <Icon name={icon} size={22} />
      </motion.span>
      {label}
    </TLink>
  );
}

/** Floating countdown shown while a focus session runs; tap to open the Time page. */
function TimerPill() {
  const { timer, now } = useTimer();
  return (
    <AnimatePresence>
      {timer && (
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] left-4 z-40 md:bottom-6 md:left-64"
        >
          <TLink to="/time" className="flex items-center gap-2.5 rounded-full bg-slate-900 py-2 pl-2 pr-4 text-white shadow-xl dark:bg-slate-100 dark:text-slate-900">
            <span className="relative grid size-7 place-items-center rounded-full bg-brand-600 text-white">
              {!timer.pausedAt && <span className="absolute inset-0 animate-ping rounded-full bg-brand-500 opacity-40" />}
              <Icon name="clock" size={15} className="relative" />
            </span>
            <span className="font-semibold tabular-nums">{mmss(remainingMs(timer, now))}</span>
            <span className="max-w-36 truncate text-sm opacity-75">{timer.pausedAt ? "Paused" : timer.label || "Focus"}</span>
          </TLink>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Logs the session when the countdown ends, including one that ended while the app was closed. */
function useTimerWatcher() {
  const { timer, now } = useTimer();
  useEffect(() => {
    if (!timer || timer.pausedAt || remainingMs(timer, now) > 0) return;
    void (async () => {
      const done = await completeTimer();
      if (!done) return;
      void celebrate("small");
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          const reg = await navigator.serviceWorker?.getRegistration();
          const body = `Focus session done: ${timer.durationMin} min${timer.label ? ` on ${timer.label}` : ""}. Take a short break.`;
          if (reg) await reg.showNotification("FDD Tracker", { body, tag: "focus" });
          else new Notification("FDD Tracker", { body, tag: "focus" });
        } catch {
          /* toast already shown */
        }
      }
    })();
  }, [timer, now]);
}

function useTheme(theme: "system" | "light" | "dark", motionOn: boolean) {
  useEffect(() => {
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && m.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b0e17" : "#4f46e5");
    };
    apply();
    m.addEventListener("change", apply);
    return () => m.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.classList.toggle("no-motion", !motionOn);
  }, [motionOn]);
}

/** Fires due reminders while the app is open: a system notification if allowed, plus a toast. */
function useAlerts() {
  useEffect(() => {
    const check = async () => {
      const now = new Date().toISOString();
      const due = (await db.alerts.toArray()).filter((a) => !a.deleted && !a.fired && a.fireAt <= now);
      for (const a of due) {
        await update({ store, by: "app" }, "alerts", a.id, { fired: true });
        toast({ message: `🔔 ${a.title}`, duration: 10000 });
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            const reg = await navigator.serviceWorker?.getRegistration();
            if (reg) await reg.showNotification("FDD Tracker", { body: a.title, icon: `${import.meta.env.BASE_URL}pwa-192x192.png`, tag: a.id });
            else new Notification("FDD Tracker", { body: a.title, tag: a.id });
          } catch {
            /* toast already shown */
          }
        }
      }
    };
    void check();
    const id = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
}

function useUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    if (needRefresh)
      toast({ message: "A new version is ready", action: { label: "Reload", run: () => void updateServiceWorker(true) }, duration: 60000 });
  }, [needRefresh, updateServiceWorker]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "n") {
        e.preventDefault();
        openEditor({ table: "tasks" });
      }
      if (e.key === "/") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[aria-label="Quick add"]')?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
