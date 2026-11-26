import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { EmptyState, Pill, type Tone } from "../components/ui";
import { db, type BridgeLogEntry } from "../db";
import {
  BRIDGE_RETENTION_DAYS,
  DEFAULT_PORT,
  appName,
  clearBridgeLog,
  newPairingCode,
  purgeOldLog,
  saveBridgeConfig,
  undoBridgeCall,
  useBridge,
} from "../lib/bridge";
import { toast } from "../lib/toast";
import { useSnapshot } from "../lib/hooks";
import { TLink } from "../components/TLink";

const RELEASES = "https://github.com/danielphingston/falcon/releases/latest/download";

const statusText: Record<string, [Tone, string]> = {
  off: ["slate", "Off"],
  connecting: ["amber", "Waiting for the bridge"],
  connected: ["green", "Connected"],
  error: ["red", "Error"],
};

/**
 * AI connections: lets Claude (or another MCP app) use Falcon through the
 * local bridge, and shows what each session did, with Undo.
 */
export function ConnectionsPage() {
  const bridge = useBridge();
  const config = bridge.config;
  const [port, setPort] = useState("");
  useEffect(() => void purgeOldLog(), []);
  useEffect(() => setPort(String(config?.port ?? DEFAULT_PORT)), [config?.port]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ message: `${what} copied`, tone: "success" });
    } catch {
      toast({ message: "Couldn't access the clipboard", tone: "error" });
    }
  };

  if (!config) return null;
  const [tone, label] = statusText[bridge.status];
  const envPort = config.port !== DEFAULT_PORT ? `, "FALCON_PORT": "${config.port}"` : "";
  const desktopJson = `{
  "mcpServers": {
    "falcon": {
      "command": "node",
      "args": ["C:/path/to/falcon-bridge.mjs"],
      "env": { "FALCON_PAIRING_CODE": "${config.code}"${envPort} }
    }
  }
}`;
  const claudeCode = `claude mcp add falcon -e FALCON_PAIRING_CODE=${config.code}${config.port !== DEFAULT_PORT ? ` -e FALCON_PORT=${config.port}` : ""} -- node /path/to/falcon-bridge.mjs`;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">AI connections</h1>
        <p className="text-sm muted">Use Falcon from Claude (or another MCP app) on this computer. It can do everything Falcon's assistant can, and every change shows below with Undo.</p>
      </header>

      <div className="card space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Bridge</span>
            <Pill tone={tone}>{label}</Pill>
            {bridge.version && <span className="text-xs muted">v{bridge.version}</span>}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={config.enabled} onChange={(e) => void saveBridgeConfig({ enabled: e.target.checked })} />
            Allow AI connections on this device
          </label>
        </div>
        {config.enabled && bridge.status !== "connected" && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Waiting for the bridge: start your AI app with the Falcon extension installed (steps below). Keep this tab open while the AI uses Falcon. If the browser asks to allow access to apps on this device, choose Allow.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <p className="text-xs muted">Pairing code (enter it in the AI app's Falcon settings)</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 font-mono text-base tracking-wider">{config.code}</code>
              <button className="btn btn-soft btn-sm" onClick={() => void copy(config.code, "Pairing code")}>
                <Icon name="copy" size={14} /> Copy
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (confirm("Make a new pairing code? AI apps using the old one stop working until you enter the new code there.")) void saveBridgeConfig({ code: newPairingCode() });
                }}
              >
                New code
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs muted">Port</p>
            <input
              className="input mt-1 w-28"
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
              onBlur={() => {
                const n = Number(port);
                if (n >= 1024 && n <= 65535 && n !== config.port) void saveBridgeConfig({ port: n });
                else setPort(String(config.port));
              }}
              aria-label="Port"
            />
          </div>
        </div>
        <p className="text-xs muted">The code and the log below stay on this device. They aren't synced or included in backups.</p>
      </div>

      <details className="card p-4" open={!config.enabled}>
        <summary className="cursor-pointer font-semibold">Set it up</summary>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm">
          <li>
            <b>Claude Desktop</b> (easiest): download{" "}
            <a className="text-[var(--accent)] underline" href={`${RELEASES}/falcon-bridge.mcpb`}>
              falcon-bridge.mcpb
            </a>{" "}
            and open it (or Claude → Settings → Extensions → Install extension). When asked, paste the pairing code above. Claude runs it with its own Node, so there's nothing else to install.
          </li>
          <li>
            <b>Claude Code, Cursor and other MCP apps</b>: needs Node 18+. Download{" "}
            <a className="text-[var(--accent)] underline" href={`${RELEASES}/falcon-bridge.mjs`}>
              falcon-bridge.mjs
            </a>
            , then add it as an MCP server with your pairing code.
            <div className="mt-2 space-y-2">
              <Snippet label="Claude Code" text={claudeCode} onCopy={() => void copy(claudeCode, "Command")} />
              <Snippet label="MCP config (JSON)" text={desktopJson} onCopy={() => void copy(desktopJson, "Config")} />
            </div>
          </li>
          <li>
            Tick <b>Allow AI connections</b> above and keep Falcon open in this browser. The status turns <b>Connected</b> once the AI app starts the bridge.
          </li>
          <li>
            Ask away, e.g. “What's blocked on Project Falcon and why?” or “Add these RFI items from the screenshot”. Each change appears below with Undo, and the AI's own undo only reverses its own changes.
          </li>
        </ol>
        <p className="mt-3 text-xs muted">
          The bridge only listens on this computer (127.0.0.1), only accepts this app with the pairing code, and stores nothing. What the AI reads is sent to the AI service as part of your chat, as with the in-app assistant. Firm checklists are never shared.
        </p>
      </details>

      <SessionLog />
    </div>
  );
}

/** Where a proposed change stands: waiting in the Inbox, accepted, rejected… */
function ProposalStatus({ id }: { id: string }) {
  const p = useSnapshot()?.proposals.find((x) => x.id === id);
  const status = p?.status ?? "pending";
  const tone: Tone = status === "accepted" ? "green" : status === "pending" ? "amber" : status === "rejected" ? "slate" : "red";
  return (
    <TLink to="/inbox" title="Open the Inbox">
      <Pill tone={tone}>{status === "pending" ? "Waiting in Inbox" : status.charAt(0).toUpperCase() + status.slice(1)}</Pill>
    </TLink>
  );
}

function Snippet({ label, text, onCopy }: { label: string; text: string; onCopy: () => void }) {
  return (
    <div className="rounded-xl border border-[var(--border)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5 text-xs">
        <span className="muted">{label}</span>
        <button className="text-[var(--accent)]" onClick={onCopy}>
          Copy
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre px-3 py-2 font-mono text-xs">{text}</pre>
    </div>
  );
}

interface Session {
  id: string;
  client: string;
  start: string;
  end?: string;
  calls: BridgeLogEntry[];
}

/** Sessions, newest first: each with the AI app, when it ran, and what it did. */
function SessionLog() {
  const entries = useLiveQuery(() => db.bridgeLog.orderBy("at").toArray(), []);
  const batchIds = useMemo(() => (entries ?? []).map((e) => e.batchId).filter((x): x is string => !!x), [entries]);
  const undone = useLiveQuery(async () => {
    if (!batchIds.length) return new Set<string>();
    const ch = await db.changes.where("batchId").anyOf(batchIds).toArray();
    const open = new Set(ch.filter((c) => !c.undone).map((c) => c.batchId));
    return new Set(batchIds.filter((b) => !open.has(b)));
  }, [batchIds]);
  const [showReads, setShowReads] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const sessions = useMemo(() => {
    const map = new Map<string, Session>();
    for (const e of entries ?? []) {
      const s = map.get(e.sessionId) ?? { id: e.sessionId, client: e.client, start: e.at, calls: [] };
      if (e.kind === "end") s.end = e.at;
      if (e.kind === "call") s.calls.push(e);
      map.set(e.sessionId, s);
    }
    return [...map.values()].sort((a, b) => b.start.localeCompare(a.start));
  }, [entries]);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold">Sessions</h2>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 muted">
            <input type="checkbox" checked={showReads} onChange={(e) => setShowReads(e.target.checked)} /> Show reads
          </label>
          {sessions.length > 0 && (
            <button className="text-[var(--accent)]" onClick={() => confirm("Clear the session log on this device? This doesn't undo anything.") && void clearBridgeLog()}>
              Clear log
            </button>
          )}
        </div>
      </div>
      <p className="px-1 text-xs muted">Kept on this device for {BRIDGE_RETENTION_DAYS} days. Not synced or backed up. Only what was done is kept, not the chat.</p>
      {!sessions.length ? (
        <EmptyState icon="sparkles" title="No sessions yet" hint="When an AI app uses Falcon through the bridge, each session and every change it made shows here." />
      ) : (
        sessions.map((s) => {
          const changes = s.calls.filter((c) => c.changed);
          const failed = s.calls.filter((c) => !c.ok).length;
          const isUndo = (c: BridgeLogEntry) => c.tool === "undo_last" && c.ok;
          const reads = s.calls.filter((c) => c.ok && !c.changed && !c.proposalId && !isUndo(c)).length;
          const proposed = s.calls.filter((c) => c.proposalId).length;
          const shown = s.calls.filter((c) => showReads || c.changed || c.proposalId || !c.ok || isUndo(c));
          const open = openId === s.id || (openId === null && s === sessions[0]);
          return (
            <div key={s.id} className="card">
              <button className="flex w-full items-start justify-between gap-3 p-3 text-left" onClick={() => setOpenId(open ? "" : s.id)}>
                <div>
                  <p className="font-semibold">
                    {appName(s.client)} <span className="text-xs font-normal muted">{s.client}</span>
                  </p>
                  <p className="text-xs muted">
                    {fmt(s.start)}
                    {s.end ? ` – ${fmtTime(s.end)}` : " · active"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  <Pill tone={changes.length ? "indigo" : "slate"}>
                    {changes.length} change{changes.length === 1 ? "" : "s"}
                  </Pill>
                  {proposed > 0 && <Pill tone="amber">{proposed} proposed</Pill>}
                  <Pill>{reads} read{reads === 1 ? "" : "s"}</Pill>
                  {failed > 0 && <Pill tone="red">{failed} failed</Pill>}
                </div>
              </button>
              {open && (
                <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                  {shown.length === 0 && <li className="px-3 py-2 text-xs muted">{s.calls.length ? "Only reads in this session. Tick Show reads to see them." : "Nothing done yet."}</li>}
                  {shown.map((c) => {
                    const isUndone = !!c.batchId && !!undone?.has(c.batchId);
                    return (
                      <li key={c.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                        <span className="w-12 shrink-0 font-mono text-xs muted">{fmtTime(c.at)}</span>
                        <div className="min-w-0 flex-1">
                          <p className={isUndone ? "line-through muted" : ""}>{c.summary ?? c.tool}</p>
                          {c.error && <p className="text-xs text-rose-600 dark:text-rose-400">{c.error}</p>}
                          <details className="text-xs muted">
                            <summary className="cursor-pointer">Details</summary>
                            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono">{c.tool}
{JSON.stringify(c.args ?? {}, null, 1)}</pre>
                          </details>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {!c.ok ? (
                            <Pill tone="red">Failed</Pill>
                          ) : c.proposalId ? (
                            <ProposalStatus id={c.proposalId} />
                          ) : isUndo(c) ? (
                            <Pill tone="amber">Undo</Pill>
                          ) : c.changed ? (
                            isUndone ? (
                              <Pill>Undone</Pill>
                            ) : (
                              <>
                                <Pill tone="indigo">
                                  {c.changed} change{c.changed === 1 ? "" : "s"}
                                </Pill>
                                <button className="btn btn-ghost btn-sm" onClick={() => void undoBridgeCall(c.batchId!)}>
                                  <Icon name="undo" size={14} /> Undo
                                </button>
                              </>
                            )
                          ) : (
                            <Pill>Read</Pill>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
