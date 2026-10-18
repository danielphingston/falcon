import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { clearChat, useChat } from "../lib/chat";
import { useMediaQuery } from "../lib/hooks";
import { ChatPanel } from "./ChatPanel";
import { Icon } from "./Icon";
import { useTNavigate } from "./TLink";

/**
 * Floating assistant button on every screen. On laptops it slides a chat
 * panel in from the right; on phones it opens the full Assistant page.
 */
export function ChatLauncher() {
  const [open, setOpen] = useState(false);
  const wide = useMediaQuery("(min-width: 768px)");
  const { pathname } = useLocation();
  const navigate = useTNavigate();
  const { busy } = useChat();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      const t = e.target as HTMLElement | null;
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !t?.closest?.("input, textarea, select, [contenteditable]")) {
        e.preventDefault();
        if (wide) setOpen((o) => !o);
        else navigate("/chat");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide, navigate]);

  if (pathname.startsWith("/chat")) return null;

  return (
    <>
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.92 }}
        onClick={() => (wide ? setOpen(true) : navigate("/chat"))}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+9.25rem)] right-5 z-40 grid size-12 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-xl shadow-brand-600/30 md:bottom-6 md:right-6 md:size-14"
        aria-label="Open assistant"
        title="Assistant (C)"
      >
        {busy && <span className="absolute inset-0 animate-ping rounded-full bg-brand-400 opacity-40" />}
        <Icon name="sparkles" size={wide ? 24 : 22} className="relative" />
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {open && wide && (
            <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="absolute inset-0 bg-slate-950/30" onClick={() => setOpen(false)} />
              <motion.aside
                className="absolute bottom-0 right-0 top-0 flex w-[460px] max-w-full flex-col border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", stiffness: 380, damping: 38 }}
              >
                <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                  <p className="flex items-center gap-2 font-semibold">
                    <Icon name="sparkles" size={18} className="text-brand-600" /> Assistant
                  </p>
                  <div className="flex gap-1">
                    <button className="btn btn-ghost btn-sm" onClick={() => void clearChat()}>
                      New chat
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close assistant">
                      <Icon name="x" size={18} />
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 p-4">
                  <ChatPanel compact />
                </div>
              </motion.aside>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
