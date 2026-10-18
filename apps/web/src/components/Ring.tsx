import { motion } from "motion/react";
import type { Ring } from "@fdd/core";

const ARCS = [
  { key: "due", color: "#f43f5e", track: "rgba(244,63,94,.15)", label: "Due items" },
  { key: "chases", color: "#6366f1", track: "rgba(99,102,241,.15)", label: "Chases" },
  { key: "focus", color: "#10b981", track: "rgba(16,185,129,.15)", label: "Focus" },
] as const;

/** Three concentric progress arcs: due items done, chases sent, focus sessions. */
export function DailyRing({ ring, size = 120 }: { ring: Ring; size?: number }) {
  const stroke = size * 0.1;
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="-rotate-90"
      animate={ring.closed ? { scale: [1, 1.08, 1] } : {}}
      transition={{ duration: 0.6 }}
      aria-label={`Daily ring: ${ARCS.map((a) => `${a.label} ${ring[a.key].done}/${ring[a.key].total}`).join(", ")}`}
    >
      {ARCS.map((a, i) => {
        const r = size / 2 - stroke / 2 - i * (stroke + 2);
        const c = 2 * Math.PI * r;
        return (
          <g key={a.key}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={a.track} strokeWidth={stroke} />
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              initial={{ strokeDashoffset: c }}
              animate={{ strokeDashoffset: c * (1 - ring[a.key].ratio) }}
              transition={{ type: "spring", stiffness: 60, damping: 16, delay: i * 0.1 }}
            />
          </g>
        );
      })}
    </motion.svg>
  );
}

export function RingLegend({ ring, focusTarget }: { ring: Ring; focusTarget: number }) {
  const rows = [
    { ...ARCS[0], text: ring.due.total ? `${ring.due.done}/${ring.due.total} done` : "Nothing due" },
    { ...ARCS[1], text: ring.chases.total ? `${ring.chases.done}/${ring.chases.total} chased` : "No chases due" },
    { ...ARCS[2], text: focusTarget ? `${ring.focus.done}/${focusTarget} sessions` : "Off" },
  ];
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ background: r.color }} />
          <span className="font-medium">{r.label}</span>
          <span className="muted">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
