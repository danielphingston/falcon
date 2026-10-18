import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { clearChat, fileToAttachment, sendMessage, stopChat, undoToolCall, useChat, type Attachment, type ChatMessage } from "../lib/chat";
import { useSettings } from "../lib/hooks";
import { useSpeech } from "../lib/speech";
import { toast } from "../lib/toast";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { TLink } from "./TLink";

const TOOL_LABELS: Record<string, [running: string, done: string]> = {
  get_today: ["Checking today", "Checked today"],
  search: ["Searching", "Searched"],
  create_engagement: ["Creating engagement", "Created engagement"],
  update_engagement: ["Updating engagement", "Updated engagement"],
  add_person: ["Adding contact", "Added contact"],
  create_task: ["Adding task", "Added task"],
  update_task: ["Updating task", "Updated task"],
  create_workpaper: ["Adding work paper", "Added work paper"],
  update_workpaper_status: ["Updating work paper", "Updated work paper"],
  add_review_points: ["Adding review points", "Added review points"],
  update_review_point: ["Updating review point", "Updated review point"],
  add_irl_items: ["Adding IRL items", "Added IRL items"],
  update_irl_item: ["Updating IRL item", "Updated IRL item"],
  log_chase: ["Logging chase", "Logged chase"],
  create_followup: ["Adding follow-up", "Added follow-up"],
  close_followup: ["Closing follow-up", "Closed follow-up"],
  create_alert: ["Setting reminder", "Set reminder"],
  log_time: ["Logging time", "Logged time"],
  weekly_report: ["Building report", "Built report"],
  get_stats: ["Checking progress", "Checked progress"],
  delete_item: ["Checking delete", "Delete"],
  undo_last: ["Undoing", "Undid last change"],
};
const READ_ONLY = new Set(["get_today", "search", "weekly_report", "get_stats"]);

const SUGGESTIONS = [
  "Plan my day",
  "What do I need to chase today?",
  "Log 2 hours on Falcon NWC review",
  "Remind me at 4pm to call Rahul about the TB",
  "How did this week go?",
];

/** The full chat: messages, tool activity, composer with voice and attachments. */
export function ChatPanel({ compact }: { compact?: boolean }) {
  const { messages, busy } = useChat();
  const settings = useSettings();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = useRef("");
  const speech = useSpeech((t, final) => {
    setText(`${base.current}${base.current && t ? " " : ""}${t}`);
    if (final) base.current = "";
  });

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const addFiles = async (list: FileList | File[]) => {
    const ok = [...list].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (ok.length < [...list].length) toast({ message: "Only images and PDFs can be attached", tone: "error" });
    const tooBig = ok.find((f) => f.size > 15 * 1024 * 1024);
    if (tooBig) return toast({ message: `${tooBig.name} is over 15 MB`, tone: "error" });
    const atts = await Promise.all(ok.map(fileToAttachment));
    setFiles((f) => [...f, ...atts].slice(0, 6));
  };

  const send = (t = text) => {
    if (busy || (!t.trim() && !files.length)) return;
    void sendMessage(t, files);
    setText("");
    files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    setFiles([]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!compact && (
        <div className="flex items-center justify-between gap-2 pb-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
              <Icon name="sparkles" className="text-brand-600" /> Assistant
            </h1>
            <p className="text-xs muted">
              Gemini · {settings.geminiModel} · {settings.geminiAuth === "google" ? "Google sign-in" : "API key"}
            </p>
          </div>
          {messages.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => void clearChat()}>
              New chat
            </button>
          )}
        </div>
      )}

      <div ref={scroller} className="scrollbar-none min-h-0 flex-1 space-y-3 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-4 pt-8 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-lg shadow-brand-500/30">
              <Icon name="sparkles" size={28} />
            </div>
            <div>
              <p className="text-lg font-semibold">Run your day by chatting</p>
              <p className="mx-auto max-w-sm text-sm muted">Add tasks, log chases, paste a client email or IRL screenshot, ask what's overdue. Every change has Undo.</p>
            </div>
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s, i) => (
                <motion.button
                  key={s}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1 + i * 0.05 }}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm hover:border-brand-400"
                  onClick={() => send(s)}
                >
                  {s}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div key={m.id} layout="position" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 32 }}>
              <Message m={m} last={i === messages.length - 1} busy={busy} onSend={send} />
            </motion.div>
          ))}
        </AnimatePresence>

        {busy && messages.at(-1)?.role === "user" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-1 px-2 py-1">
            {[0, 1, 2].map((d) => (
              <motion.span key={d} className="size-2 rounded-full bg-brand-400" animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: d * 0.15 }} />
            ))}
          </motion.div>
        )}
      </div>

      {/* Composer */}
      <div className="card p-2" onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), void addFiles(e.dataTransfer.files))}>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pb-2">
            {files.map((f, i) => (
              <div key={i} className="relative">
                {f.preview ? (
                  <img src={f.preview} alt={f.name} className="size-14 rounded-lg object-cover" />
                ) : (
                  <div className="grid size-14 place-items-center rounded-lg bg-[var(--surface-2)] text-[10px] font-semibold">PDF</div>
                )}
                <button className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-slate-900 text-white" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <button className="btn btn-ghost btn-sm shrink-0 px-2" onClick={() => fileInput.current?.click()} aria-label="Attach image or PDF">
            <Icon name="plus" size={18} />
          </button>
          <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => (e.target.files && void addFiles(e.target.files), (e.target.value = ""))} />
          <textarea
            ref={input}
            rows={1}
            className="min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] outline-none placeholder:text-[var(--muted)]"
            placeholder={speech.listening ? "Listening…" : "Ask or tell me what to do…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
              if (imgs.length) {
                e.preventDefault();
                void addFiles(imgs);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            aria-label="Message"
          />
          {speech.supported && (
            <button
              className={`btn btn-sm shrink-0 px-2 ${speech.listening ? "bg-rose-500 text-white" : "btn-ghost"}`}
              onClick={() => {
                if (speech.listening) speech.stop();
                else {
                  base.current = text;
                  speech.start();
                }
              }}
              aria-label={speech.listening ? "Stop dictation" : "Dictate"}
            >
              <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
          )}
          {busy ? (
            <button className="btn btn-soft btn-sm shrink-0" onClick={stopChat} aria-label="Stop">
              <span className="size-3 rounded-sm bg-current" />
            </button>
          ) : (
            <motion.button whileTap={{ scale: 0.9 }} className="btn btn-primary btn-sm shrink-0 px-2.5" onClick={() => send()} disabled={!text.trim() && !files.length} aria-label="Send">
              <Icon name="send" size={16} />
            </motion.button>
          )}
        </div>
        {speech.error && <p className="px-2 pt-1 text-xs text-rose-600">{speech.error}</p>}
      </div>
    </div>
  );
}

function Message({ m, last, busy, onSend }: { m: ChatMessage; last: boolean; busy: boolean; onSend: (t: string) => void }) {
  if (m.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-[15px] text-white">
          {m.attachments?.length ? <p className="mb-1 text-xs opacity-80">📎 {m.attachments.map((a) => a.name).join(", ")}</p> : null}
          <p className="whitespace-pre-wrap">{m.text}</p>
        </div>
      </div>
    );

  if (m.role === "error")
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
        {m.text}{" "}
        {/Settings/.test(m.text) && (
          <TLink to="/settings" className="font-semibold underline">
            Open Settings
          </TLink>
        )}
      </div>
    );

  if (m.role === "tool") {
    const t = m.tool!;
    const [running, done] = TOOL_LABELS[t.name] ?? [t.name, t.name];
    const preview = (t.result as { needsConfirmation?: boolean; wouldDelete?: Record<string, unknown> } | undefined)?.needsConfirmation
      ? (t.result as { wouldDelete: Record<string, unknown> }).wouldDelete
      : null;
    if (preview)
      return (
        <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <Icon name="trash" size={15} /> Delete this {String(preview.table).replace(/s$/, "")}?
          </p>
          <p className="mt-1 text-sm">{String(preview.title ?? preview.name ?? preview.description ?? preview.about ?? preview.text ?? preview.id)}</p>
          {last && !busy && (
            <div className="mt-3 flex gap-2">
              <button className="btn btn-sm bg-rose-600 text-white" onClick={() => onSend("Yes, delete it.")}>
                Delete
              </button>
              <button className="btn btn-soft btn-sm" onClick={() => onSend("No, keep it.")}>
                Keep
              </button>
            </div>
          )}
        </motion.div>
      );
    return (
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
            t.running
              ? "bg-brand-50 text-brand-700 dark:bg-indigo-950 dark:text-indigo-200"
              : t.ok === false
                ? "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                : t.undone
                  ? "bg-[var(--surface-2)] muted line-through"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          }`}
          title={t.error ?? JSON.stringify(t.args)}
        >
          {t.running ? (
            <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }} className="grid">
              <Icon name="refresh" size={12} />
            </motion.span>
          ) : (
            <Icon name={t.ok === false ? "alert" : "check"} size={12} />
          )}
          {t.running ? `${running}…` : t.ok === false ? `${running} failed` : done}
        </span>
        {!t.running && t.ok && !t.undone && !READ_ONLY.has(t.name) && t.name !== "undo_last" && (
          <button className="font-semibold text-brand-600 hover:underline" onClick={() => void undoToolCall(m.id)}>
            Undo
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white">
        <Icon name="sparkles" size={14} />
      </div>
      <div className="min-w-0 flex-1 text-[15px]">
        <Markdown text={m.text} />
        {m.streaming && <motion.span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-brand-500" animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.7 }} />}
      </div>
    </div>
  );
}
