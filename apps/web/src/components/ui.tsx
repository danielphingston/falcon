import { AnimatePresence, motion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "../lib/hooks";
import { dismiss, useToasts } from "../lib/toast";
import { Icon, type IconName } from "./Icon";

const spring = { type: "spring", stiffness: 420, damping: 36 } as const;

// ---------- Sheet: bottom sheet on phones, side panel on laptops ----------

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const wide = useMediaQuery("(min-width: 768px)");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50" initial="hidden" animate="shown" exit="hidden">
          <motion.div
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"
            variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal
            className={
              wide
                ? "absolute right-0 top-0 flex h-full w-[460px] max-w-full flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl"
                : "absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-3xl border-t border-[var(--border)] bg-[var(--surface)] shadow-2xl safe-bottom"
            }
            variants={wide ? { hidden: { x: "100%" }, shown: { x: 0 } } : { hidden: { y: "100%" }, shown: { y: 0 } }}
            transition={spring}
            drag={wide ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
          >
            {!wide && <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-[var(--border)]" />}
            <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-4">
              <h2 className="text-lg font-semibold">{title}</h2>
              <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
            {footer && <div className="flex shrink-0 gap-2 border-t border-[var(--border)] px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------- Animated checkbox ----------

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label ?? (checked ? "Mark not done" : "Mark done")}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      whileTap={{ scale: 0.8 }}
      className={`grid size-[22px] shrink-0 place-items-center rounded-full border-2 transition-colors ${
        checked ? "border-emerald-500 bg-emerald-500" : "border-slate-300 hover:border-brand-500 dark:border-slate-600"
      }`}
    >
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="white" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
        <motion.path d="M5 12.5 10 17 19 7" initial={false} animate={{ pathLength: checked ? 1 : 0 }} transition={{ duration: 0.25 }} />
      </svg>
    </motion.button>
  );
}

// ---------- Status pill ----------

const tones = {
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  indigo: "bg-brand-100 text-brand-700 dark:bg-indigo-950 dark:text-indigo-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
} as const;
export type Tone = keyof typeof tones;

export function Pill({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export const statusTone: Record<string, Tone> = {
  todo: "slate",
  in_progress: "blue",
  done: "green",
  not_started: "slate",
  prepared: "indigo",
  in_review: "blue",
  points_raised: "amber",
  cleared: "green",
  final: "green",
  open: "amber",
  addressed: "blue",
  pending: "amber",
  partial: "blue",
  received: "green",
  na: "slate",
  waiting: "amber",
  active: "green",
  on_hold: "amber",
  closed: "slate",
};

// ---------- Layout bits ----------

export function Section({
  title,
  count,
  action,
  children,
  icon,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  icon?: IconName;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide muted">
          {icon && <Icon name={icon} size={16} />}
          {title}
          {count !== undefined && count > 0 && (
            <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-xs normal-case">{count}</span>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ icon = "sparkles", title, hint, action }: { icon?: IconName; title: string; hint?: string; action?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="card flex flex-col items-center gap-2 px-6 py-10 text-center"
    >
      <div className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-indigo-950 dark:text-indigo-300">
        <Icon name={icon} size={24} />
      </div>
      <p className="font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-sm muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </motion.div>
  );
}

/** Animated list wrapper: items fade/slide in and collapse out. */
export function AnimatedList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`card divide-y divide-[var(--border)] overflow-hidden ${className}`}>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </div>
  );
}

export function ListItem({ id, children, onClick }: { id: string; children: ReactNode; onClick?: () => void }) {
  return (
    <motion.div
      key={id}
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      className={onClick ? "cursor-pointer transition-colors hover:bg-[var(--surface-2)]" : ""}
    >
      <div className="flex items-center gap-3 px-4 py-3">{children}</div>
    </motion.div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  id,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  id: string;
}) {
  return (
    <div className="inline-flex rounded-xl bg-[var(--surface-2)] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="relative rounded-lg px-3 py-1 text-sm font-medium"
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-lg bg-[var(--surface)] shadow-sm" transition={spring} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- Toasts ----------

export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={spring}
            className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-2.5 text-sm shadow-lg ${
              t.tone === "error"
                ? "bg-rose-600 text-white"
                : t.tone === "success"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
            }`}
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                className="font-semibold text-brand-200 underline-offset-2 hover:underline dark:text-brand-700"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
