import { formatDistanceToNowStrict } from "date-fns";
import { motion } from "motion/react";
import { connectGoogle } from "../lib/google";
import { syncNow, useSyncStatus } from "../lib/sync";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";
import { useTNavigate } from "./TLink";

/** Small sync status chip; tapping it syncs, reconnects or opens setup. */
export function SyncBadge({ compact }: { compact?: boolean }) {
  const s = useSyncStatus();
  const navigate = useTNavigate();

  const label =
    s.state === "off"
      ? "Not synced"
      : s.state === "syncing"
        ? "Syncing…"
        : s.state === "needs-auth"
          ? "Reconnect Google"
          : s.state === "error"
            ? "Sync failed"
            : s.lastSync
              ? `Synced ${formatDistanceToNowStrict(s.lastSync, { addSuffix: true })}`
              : "Synced";

  const tone =
    s.state === "needs-auth" || s.state === "error"
      ? "text-amber-600"
      : s.state === "off"
        ? "muted"
        : "text-emerald-600";

  const onClick = async () => {
    if (s.state === "off") return navigate("/settings");
    if (s.state === "needs-auth") {
      try {
        // First await in the handler, so Safari still treats the popup as part of the tap.
        if (!(await connectGoogle())) return; // redirecting to Google
      } catch (e) {
        return void toast({ message: e instanceof Error ? e.message : "Couldn't connect", tone: "error" });
      }
    }
    if (s.state === "error" && s.message) toast({ message: s.message, tone: "error" });
    await syncNow();
  };

  return (
    <button onClick={onClick} title={s.message ?? label} className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)] ${tone}`}>
      <motion.span animate={s.state === "syncing" ? { rotate: 360 } : { rotate: 0 }} transition={s.state === "syncing" ? { repeat: Infinity, duration: 1, ease: "linear" } : { duration: 0 }} className="grid">
        <Icon name={s.state === "off" ? "cloudOff" : s.state === "syncing" ? "refresh" : s.state === "idle" ? "cloud" : "alert"} size={14} />
      </motion.span>
      {!compact && <span>{label}</span>}
    </button>
  );
}
