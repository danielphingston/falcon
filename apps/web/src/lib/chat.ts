/**
 * In-app chat with Gemini, authenticated with the user's Google sign-in or an
 * API key. A key stays on this device (IndexedDB, never in backups or Drive
 * sync). Calls go straight from the browser to Google.
 */
import { useSyncExternalStore } from "react";
import {
  GEMINI_OAUTH_SCOPE,
  assistantInstructions,
  celebrationFor,
  compactHistory,
  geminiRestStream,
  geminiTurn,
  loadSnapshot,
  todayISO,
  undoBatch,
  type GContent,
  type GPart,
  type GeminiAuth,
  type ToolCallResult,
} from "@fdd/core";
import { db, getSettings, store } from "../db";
import { celebrate } from "./confetti";
import { NeedsAuthError, getAccessToken, hasScope, readAuth } from "./google";
import { scheduleSync } from "./sync";

export interface Attachment {
  name: string;
  mimeType: string;
  data: string; // base64 (empty for text attachments)
  /** Object URL for image previews (not persisted). */
  preview?: string;
  /** Spreadsheets are converted to text on the device and sent as text. */
  text?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  text: string;
  attachments?: { name: string; mimeType: string }[];
  tool?: { name: string; args: Record<string, unknown>; running: boolean; ok?: boolean; error?: string; result?: unknown; batchId?: string; undone?: boolean };
  streaming?: boolean;
}

interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  loaded: boolean;
}

let state: ChatState = { messages: [], busy: false, loaded: false };
let history: GContent[] = [];
let controller: AbortController | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<ChatState>) => {
  state = { ...state, ...patch };
  emit();
};
const patchMessage = (id: string, fn: (m: ChatMessage) => ChatMessage) =>
  set({ messages: state.messages.map((m) => (m.id === id ? fn(m) : m)) });
let seq = 0;
const newId = () => `m${Date.now()}-${seq++}`;

export function useChat(): ChatState {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  if (!state.loaded) void load();
  return s;
}

let loading = false;
async function load() {
  if (loading || state.loaded) return;
  loading = true;
  const saved = (await db.meta.get("chat"))?.value as { messages: ChatMessage[]; history: GContent[] } | undefined;
  history = saved?.history ?? [];
  set({ messages: (saved?.messages ?? []).map((m) => ({ ...m, streaming: false, tool: m.tool && { ...m.tool, running: false } })), loaded: true });
}

async function persist() {
  history = compactHistory(history);
  await db.meta.put({ key: "chat", value: { messages: state.messages.slice(-200), history } });
}

// ---------- credentials & model ----------

export const getGeminiKey = async () => ((await db.meta.get("geminiKey"))?.value as string | undefined) ?? "";
export const setGeminiKey = async (key: string) => (key ? db.meta.put({ key: "geminiKey", value: key.trim() }) : db.meta.delete("geminiKey"));

/** The credential the chat will use, or a sentence explaining what's missing. */
export async function chatAuth(): Promise<GeminiAuth | string> {
  const settings = await getSettings();
  if (settings.geminiAuth === "key") {
    const apiKey = await getGeminiKey();
    return apiKey ? { apiKey } : "Add your Gemini API key in Settings → AI assistant to start chatting.";
  }
  const auth = await readAuth();
  if (!auth) return "Sign in with Google in Settings → Google sync to use the assistant.";
  if (!hasScope(auth, GEMINI_OAUTH_SCOPE)) return "Your Google sign-in doesn't include Gemini access yet. Reconnect Google in Settings and allow it.";
  return { accessToken: getAccessToken };
}

export function friendlyError(e: unknown): string {
  const status = (e as { status?: number }).status;
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof NeedsAuthError || status === 401) return "Your Google session expired. Tap Reconnect (Settings or the sync chip), then try again.";
  if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg)) return "Google sign-in lacks Gemini access. Reconnect Google in Settings, or switch the assistant to an API key.";
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(msg)) return "The Generative Language API isn't enabled in your Google Cloud project. Enable it (see README → AI assistant), or use an API key.";
  if (/API key not valid|API_KEY_INVALID/i.test(msg)) return "That Gemini API key isn't valid. Check it in Settings.";
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return "Gemini's rate limit or quota was reached. Wait a minute, or check billing in Google AI Studio.";
  if (status === 403 || /PERMISSION_DENIED|referer|referrer/i.test(msg)) return "Gemini refused the request. If you restricted the key to certain websites, add this site's address.";
  if (status === 404 || /not found/i.test(msg)) return "That Gemini model isn't available to this key. Pick another model in Settings.";
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "Couldn't reach Gemini. Check your internet connection.";
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

// ---------- sending ----------

export async function sendMessage(text: string, attachments: Attachment[] = []) {
  if (state.busy || (!text.trim() && !attachments.length)) return;
  const auth = await chatAuth();
  if (typeof auth === "string") {
    set({ messages: [...state.messages, { id: newId(), role: "error", text: auth }] });
    return;
  }
  const settings = await getSettings();
  const userMsg: ChatMessage = { id: newId(), role: "user", text: text.trim(), attachments: attachments.map((a) => ({ name: a.name, mimeType: a.mimeType })) };
  set({ messages: [...state.messages, userMsg], busy: true });
  controller = new AbortController();

  const userParts: GPart[] = [
    ...attachments.map((a) => (a.text ? { text: a.text } : { inlineData: { mimeType: a.mimeType, data: a.data } })),
    ...(text.trim() ? [{ text: text.trim() }] : [{ text: "(see attachment)" }]),
  ];
  let current: string | null = null; // assistant message receiving text

  try {
    const stream = geminiRestStream(auth, settings.geminiModel);
    const today = todayISO();
    history = await geminiTurn({
      history,
      user: userParts,
      stream,
      ctx: { store, by: "chat" },
      systemInstruction: assistantInstructions(await loadSnapshot(store), settings, today),
      signal: controller.signal,
      events: {
        onText(delta) {
          if (!current) {
            current = newId();
            set({ messages: [...state.messages, { id: current, role: "assistant", text: delta, streaming: true }] });
          } else patchMessage(current, (m) => ({ ...m, text: m.text + delta }));
        },
        onToolStart(call) {
          if (current) patchMessage(current, (m) => ({ ...m, streaming: false }));
          current = null;
          set({ messages: [...state.messages, { id: `t-${call.id}-${newId()}`, role: "tool", text: "", tool: { name: call.name, args: call.args, running: true } }] });
        },
        onToolEnd(call, result) {
          const msg = [...state.messages].reverse().find((m) => m.role === "tool" && m.tool?.running && m.tool.name === call.name);
          if (msg) patchMessage(msg.id, (m) => ({ ...m, tool: { ...m.tool!, running: false, ok: result.ok, error: result.error, result: result.result, batchId: result.batchId } }));
          if (result.ok) void afterToolChange(result);
        },
      },
    });
  } catch (e) {
    if (!controller.signal.aborted) set({ messages: [...state.messages, { id: newId(), role: "error", text: friendlyError(e) }] });
  } finally {
    if (current) patchMessage(current, (m) => ({ ...m, streaming: false }));
    set({ busy: false, messages: state.messages.map((m) => (m.tool?.running ? { ...m, tool: { ...m.tool, running: false } } : m)) });
    controller = null;
    await persist();
  }
}

async function afterToolChange(result: ToolCallResult) {
  const changes = (await store.listChanges()).filter((c) => c.batchId === result.batchId);
  if (!changes.length) return;
  scheduleSync();
  const order = { small: 1, medium: 2, irl_complete: 3, engagement_closed: 4 } as const;
  let best: keyof typeof order | null = null;
  for (const c of changes) {
    const k = await celebrationFor(store, c.table, c.before, c.after);
    if (k && (!best || order[k] > order[best])) best = k;
  }
  if (best) void celebrate(best);
}

export function stopChat() {
  controller?.abort();
}

export async function undoToolCall(messageId: string) {
  const m = state.messages.find((x) => x.id === messageId);
  if (!m?.tool?.batchId) return;
  await undoBatch(store, m.tool.batchId);
  scheduleSync();
  patchMessage(messageId, (x) => ({ ...x, tool: { ...x.tool!, undone: true } }));
  // Tell the model next turn, so it doesn't assume the change still exists.
  history.push({ role: "user", parts: [{ text: `(The user pressed Undo on your ${m.tool.name} call; that change was reverted.)` }] });
  history.push({ role: "model", parts: [{ text: "Noted, that change was undone." }] });
  await persist();
}

export async function clearChat() {
  stopChat();
  history = [];
  set({ messages: [] });
  await db.meta.delete("chat");
}

/** Reads a File as base64 for Gemini inline data. */
export function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      resolve({
        name: file.name || "pasted image",
        mimeType: file.type || "application/octet-stream",
        data: url.slice(url.indexOf(",") + 1),
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
