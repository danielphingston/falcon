import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import { dismissLevelUp, useLevelUp } from "../lib/game";

export function LevelUpOverlay() {
  const lu = useLevelUp();
  return createPortal(
    <AnimatePresence>
      {lu && (
        <motion.div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={dismissLevelUp}>
          <motion.div
            className="card w-full max-w-sm overflow-hidden text-center"
            initial={{ scale: 0.6, y: 40, rotate: -4 }}
            animate={{ scale: 1, y: 0, rotate: 0 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-br from-brand-500 to-violet-600 px-6 pb-6 pt-8 text-white">
              <motion.div className="text-6xl" initial={{ scale: 0 }} animate={{ scale: [0, 1.3, 1] }} transition={{ delay: 0.2, duration: 0.6 }}>
                🏆
              </motion.div>
              <p className="mt-3 text-sm font-semibold uppercase tracking-widest opacity-80">Level up</p>
              <motion.p className="text-3xl font-bold" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
                {lu.name}
              </motion.p>
            </div>
            <div className="space-y-4 p-6">
              <p className="text-sm muted">{lu.points.toLocaleString()} points earned by clearing work, chasing and deep focus.</p>
              <button className="btn btn-primary w-full" onClick={dismissLevelUp}>
                Nice!
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
