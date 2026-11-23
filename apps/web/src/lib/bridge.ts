/**
 * Falcon's side of the local MCP bridge (apps/bridge).
 *
 * The bridge runs on this computer (started by Claude Desktop or another MCP
 * client). This tab connects out to it on 127.0.0.1, receives tool calls,
 * runs them with the same shared tools as the in-app chat (by: "connector",
 * so the AI's undo_last only reverses its own changes), and posts the result
 * back.
 *
 * Every call is written to a session log on this device only (bridgeLog), kept
 * for 7 days, never synced or backed up. Changes show a toast with Undo.
 *
 * The pairing code and port live in `meta` under "bridge": device-only, not
 * part of settings sync or backups.
 */
import { useSyncExternalStore } from "react";
import { connectorInstructions, loadSnapshot, mcpTools, runTool, todayISO, undoBatch } from "@falcon/core";
import { db, getSettings, store, type BridgeLogEntry } from "../db";
import { scheduleSync } from "./sync";
import { toast } from "./toast";

export const BRIDGE_RETENTION_DAYS = 7;
export const DEFAULT_PORT = 47820;

export interface BridgeConfig {
  enabled: boolean;
  code: string;
  port: number;
}

export type BridgeStatus = "off" | "connecting" | "connected" | "error";

interface State {
  status: BridgeStatus;
  /** Bridge version once connected. */
  version?: string;
  config?: BridgeConfig;
}

let state: State = { status: "off" };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
export const useBridge = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );

// ---------- Config ----------

/** 16 characters from an alphabet without look-alikes, shown as XXXX-XXXX-XXXX-XXXX. */
export function newPairingCode(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const s = [...bytes].map((b) => abc[b % abc.length]).join("");
  return s.match(/.{4}/g)!.join("-");
}

export async function getBridgeConfig(): Promise<BridgeConfig> {
  const row = (await db.meta.get("bridge"))?.value as Partial<BridgeConfig> | undefined;
  if (row?.code) return { enabled: !!row.enabled, code: row.code, port: row.port || DEFAULT_PORT };
  const fresh = { enabled: false, code: newPairingCode(), port: DEFAULT_PORT };
  await db.meta.put({ key: "bridge", value: fresh });
  return fresh;
}

export async function saveBridgeConfig(patch: Partial<BridgeConfig>) {
  const next = { ...(await getBridgeConfig()), ...patch };
  await db.meta.put({ key: "bridge", value: next });
  set({ config: next });
  await startBridge();
  return next;
}

// ---------- Connection ----------

let source: EventSource | undefined;

/** Connects to the bridge when AI connections are on (call on app start and after config changes). */
export async function startBridge() {
  const config = await getBridgeConfig();
  set({ config });
  source?.close();
  source = undefined;
  if (!config.enabled) return set({ status: "off", version: undefined });
  void purgeOldLog();
  set({ status: "connecting" });
  const base = `http://127.0.0.1:${config.port}`;
  const code = encodeURIComponent(config.code);
  const es = new EventSource(`${base}/app/events?code=${code}`);
  source = es;
  es.onmessage = (ev) => {
    let msg: { type: string; id?: string; version?: string; name?: string; args?: unknown; event?: string; session?: { id: string; client: string } };
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "hello") return set({ status: "connected", version: msg.version });
    void handle(msg, (body) =>
      fetch(`${base}/app/result?code=${code}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: msg.id, ...body }) }).then(() => undefined),
    ).catch((e) => console.warn("bridge:", e));
  };
  // EventSource retries by itself while the bridge isn't running.
  es.onerror = () => source === es && set({ status: "connecting", version: undefined });
}

export function stopBridge() {
  source?.close();
  source = undefined;
  set({ status: "off", version: undefined });
}

async function handle(
  msg: { type: string; id?: string; name?: string; args?: unknown; event?: string; session?: { id: string; client: string } },
  reply: (body: { ok: boolean; result?: unknown; error?: string }) => Promise<void>,
) {
  const session = msg.session ?? { id: "unknown", client: "AI app" };
  if (msg.type === "list") {
    const snap = await loadSnapshot(store);
    return reply({ ok: true, result: { tools: mcpTools(), instructions: connectorInstructions(snap, await getSettings(), todayISO()) } });
  }
  if (msg.type === "session") {
    await log({ sessionId: session.id, client: session.client, kind: msg.event === "end" ? "end" : "start" });
    return;
  }
  if (msg.type !== "call" || !msg.name) return;
  const r = await runTool({ store, by: "connector" }, msg.name, msg.args ?? {});
  const changed = r.ok ? await db.changes.where("batchId").equals(r.batchId).count() : 0;
  const summary = describeCall(msg.name, msg.args, r.result);
  await log({
    sessionId: session.id,
    client: session.client,
    kind: "call",
    tool: msg.name,
    args: msg.args,
    ok: r.ok,
    error: r.error,
    batchId: changed ? r.batchId : undefined,
    changed,
    summary,
  });
  await reply(r.ok ? { ok: true, result: r.result } : { ok: false, error: r.error });
  if (changed) {
    scheduleSync();
    toast({
      message: `${appName(session.client)}: ${summary}`,
      action: { label: "Undo", run: () => void undoBridgeCall(r.batchId) },
    });
  }
}

// ---------- Session log (this device only, 7 days) ----------

async function log(e: Omit<BridgeLogEntry, "id" | "at">) {
  await db.bridgeLog.add({ ...e, id: crypto.randomUUID(), at: new Date().toISOString() });
}

export async function purgeOldLog(now = new Date()) {
  const cutoff = new Date(now.getTime() - BRIDGE_RETENTION_DAYS * 86_400_000).toISOString();
  await db.bridgeLog.where("at").below(cutoff).delete();
}

export async function clearBridgeLog() {
  await db.bridgeLog.clear();
}

export async function undoBridgeCall(batchId: string) {
  const n = await undoBatch(store, batchId);
  scheduleSync();
  toast({ message: n ? "Undone" : "Already undone", duration: 1800 });
}

/** "claude-ai 0.1.0" → "Claude"; other clients keep their own name. */
export function appName(client: string): string {
  const c = client.toLowerCase();
  if (c.startsWith("claude-code") || c.startsWith("claude code")) return "Claude Code";
  if (c.startsWith("claude")) return "Claude";
  if (c.startsWith("cursor")) return "Cursor";
  return client.replace(/\s+[\d.]+$/, "") || "AI app";
}

const LABELS: Record<string, string> = {
  get_today: "Read today's briefing",
  search: "Searched",
  get_workload: "Read a workload",
  get_work_plan: "Read the work plan",
  get_readiness: "Read readiness",
  get_work_programme: "Read the work programme",
  get_stats: "Read progress stats",
  weekly_report: "Read the weekly report",
  set_step_inputs: "Linked work plan steps to the RFI",
  add_point_challenges: "Added counter-questions",
  add_irl_items: "Added RFI items",
  update_irl_item: "Updated an RFI item",
  log_chase: "Logged a chase",
  delete_item: "Deleted an item",
  undo_last: "Undid its last change",
};

/** A short line for the log and toasts, e.g. "Created task · Call client". */
export function describeCall(tool: string, args: unknown, result?: unknown): string {
  const base = LABELS[tool] ?? tool.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const a = (args ?? {}) as Record<string, unknown>;
  const bits: string[] = [];
  for (const k of ["title", "name", "about", "description", "query", "engagement", "workpaper", "person", "status", "minutes"]) {
    const v = a[k];
    if (typeof v === "string" && v.trim()) bits.push(v.length > 50 ? `${v.slice(0, 49)}…` : v);
    else if (typeof v === "number") bits.push(`${v}${k === "minutes" ? " min" : ""}`);
    if (bits.length >= 2) break;
  }
  for (const k of ["items", "points", "steps", "questions", "ids"]) if (Array.isArray(a[k])) bits.push(`${(a[k] as unknown[]).length} ${k === "ids" ? "items" : k}`);
  const res = (result ?? {}) as Record<string, unknown>;
  if (typeof res.saved === "number" && tool === "set_step_inputs") bits.push(`${res.saved} saved`);
  return bits.length ? `${base} · ${bits.slice(0, 3).join(" · ")}` : base;
}
