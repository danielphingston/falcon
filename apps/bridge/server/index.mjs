#!/usr/bin/env node
/**
 * Falcon MCP bridge.
 *
 * Lets an MCP client (Claude Desktop, Claude Code, Cursor…) use the same
 * tools as Falcon's in-app assistant. It holds no data and no tool logic of
 * its own: it only relays.
 *
 *   MCP client ⇄ stdio ⇄ this bridge ⇄ 127.0.0.1:<port> ⇄ the open Falcon tab
 *
 * The Falcon tab connects out to the bridge (Server-Sent Events for calls,
 * POST for results), runs each tool against its own data, and returns the
 * result. So Falcon must be open in a browser on the same computer.
 *
 * Security: the bridge listens on 127.0.0.1 only, accepts the Falcon app only
 * from known web origins, and every request must carry the pairing code that
 * Falcon generated. Requests from other web pages are refused.
 *
 * When several MCP clients run at once, the first bridge owns the port (the
 * "hub"); later ones relay their calls through it.
 *
 * No dependencies: Node's standard library only (Node 18+).
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const VERSION = "0.1.1";
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const PORT = Number(process.env.FALCON_PORT || arg("--port") || 47820);
const CODE = normCode(process.env.FALCON_PAIRING_CODE || arg("--code") || "");
const ORIGINS = new Set([
  "https://danielphingston.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
  ...(process.env.FALCON_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
]);
const DIR = process.env.FALCON_BRIDGE_DIR || path.join(os.homedir(), ".falcon-bridge");
const CALL_TIMEOUT = Number(process.env.FALCON_CALL_TIMEOUT_MS || 120_000);
const LIST_TIMEOUT = 8_000;
const POLL_MS = Number(process.env.FALCON_POLL_MS || 10_000);

const log = (...a) => process.stderr.write(`[falcon-bridge] ${a.join(" ")}\n`);

function normCode(s) {
  return String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function codeOk(given) {
  const a = Buffer.from(normCode(given ?? ""));
  const b = Buffer.from(CODE);
  return CODE.length >= 12 && a.length === b.length && timingSafeEqual(a, b);
}

// ---------- Tool lists for before Falcon is open ----------
//
// MCP apps ask for the tool list once, when they start, and don't all reload
// it later. So the bridge must offer the full list even if Falcon isn't open
// yet. In order: Falcon's live list, the last list Falcon sent (cache), and
// the list this release was built with (bundled).

/** Filled in by scripts/pack.mjs with Falcon's tool list; null in the source tree. */
const BUNDLED_TOOLS = null;

function bundledTools() {
  if (BUNDLED_TOOLS) return BUNDLED_TOOLS;
  try {
    return JSON.parse(fs.readFileSync(new URL("./tools.snapshot.json", import.meta.url), "utf8")).tools;
  } catch {
    return [];
  }
}

const cacheFile = path.join(DIR, "tools.json");
function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {
    return undefined;
  }
}
function writeCache(data) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(data));
  } catch (e) {
    log("couldn't save the tool list:", e.message);
  }
}

// ---------- Hub: owns the port, holds the Falcon tab's connection ----------

const apps = []; // open SSE responses from Falcon tabs, newest last
const pending = new Map(); // id -> { resolve, timer }
let isHub = false;
let onAppConnected = () => {};

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
}
function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/** Sends a message to the newest Falcon tab; resolves with its reply (or nothing, for one-way messages). */
function toApp(msg, timeout = CALL_TIMEOUT) {
  const conn = apps[apps.length - 1];
  if (!conn) return Promise.reject(Object.assign(new Error("not connected"), { code: "NOT_CONNECTED" }));
  if (!msg.id) {
    conn.write(`data: ${JSON.stringify(msg)}\n\n`);
    return Promise.resolve(undefined);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(msg.id);
      reject(Object.assign(new Error("Falcon didn't answer in time"), { code: "TIMEOUT" }));
    }, timeout);
    pending.set(msg.id, { resolve, timer });
    conn.write(`data: ${JSON.stringify(msg)}\n\n`);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const origin = req.headers.origin;
  cors(req, res);
  try {
    if (req.method === "OPTIONS") {
      if (!origin || !ORIGINS.has(origin)) return send(res, 403, { error: "origin not allowed" });
      res.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "600" });
      return res.end();
    }

    // The Falcon tab, from the browser: allowed origin + pairing code.
    if (url.pathname === "/app/events" || url.pathname === "/app/result") {
      if (!origin || !ORIGINS.has(origin)) return send(res, 403, { error: "This page isn't allowed to use the Falcon bridge." });
      if (!codeOk(url.searchParams.get("code"))) return send(res, 401, { error: "Wrong pairing code." });
      if (url.pathname === "/app/events" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.write(`data: ${JSON.stringify({ type: "hello", version: VERSION })}\n\n`);
        apps.push(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.on("close", () => {
          clearInterval(ping);
          const i = apps.indexOf(res);
          if (i >= 0) apps.splice(i, 1);
          log("Falcon disconnected");
        });
        log("Falcon connected");
        onAppConnected();
        return;
      }
      if (url.pathname === "/app/result" && req.method === "POST") {
        const body = await readBody(req);
        const p = pending.get(body.id);
        if (p) {
          clearTimeout(p.timer);
          pending.delete(body.id);
          p.resolve(body);
        }
        return send(res, 200, { ok: true });
      }
    }

    // Other bridge processes on this computer (never a web page).
    if (url.pathname === "/relay" && req.method === "POST") {
      if (origin) return send(res, 403, { error: "not for browsers" });
      if (!codeOk(req.headers["x-falcon-code"])) return send(res, 401, { error: "Wrong pairing code." });
      const body = await readBody(req);
      try {
        const out = await toApp({ ...body, id: body.type === "session" ? undefined : randomUUID() }, body.type === "list" ? LIST_TIMEOUT : CALL_TIMEOUT);
        return send(res, 200, { ok: true, reply: out ?? null });
      } catch (e) {
        return send(res, 200, { ok: false, code: e.code, error: e.message });
      }
    }
    if (url.pathname === "/status" && req.method === "GET") {
      if (origin) return send(res, 403, { error: "not for browsers" });
      if (!codeOk(req.headers["x-falcon-code"])) return send(res, 401, { error: "Wrong pairing code." });
      return send(res, 200, { bridge: "falcon", version: VERSION, appConnected: apps.length > 0 });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

function listen() {
  return new Promise((resolve) => {
    const onError = (e) => {
      server.off("listening", onOk);
      resolve(e.code === "EADDRINUSE" ? false : (log(`can't listen on 127.0.0.1:${PORT}:`, e.message), false));
    };
    const onOk = () => {
      server.off("error", onError);
      isHub = true;
      log(`listening on 127.0.0.1:${PORT}`);
      resolve(true);
    };
    server.once("error", onError);
    server.once("listening", onOk);
    server.listen(PORT, "127.0.0.1");
  });
}

/** Relay through the hub (another bridge process owns the port). */
function viaHub(path_, body, timeout) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const r = http.request(
      { host: "127.0.0.1", port: PORT, path: path_, method: "POST", timeout, headers: { "Content-Type": "application/json", "Content-Length": data.length, "X-Falcon-Code": CODE } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            const out = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (res.statusCode !== 200) return reject(new Error(out.error || `bridge answered ${res.statusCode}`));
            if (!out.ok) return reject(Object.assign(new Error(out.error), { code: out.code }));
            resolve(out.reply ?? undefined);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    r.on("timeout", () => r.destroy(Object.assign(new Error("Falcon didn't answer in time"), { code: "TIMEOUT" })));
    r.on("error", reject);
    r.end(data);
  });
}

/** Sends to Falcon, directly when this process is the hub, otherwise through the hub. */
async function ask(msg, timeout) {
  if (isHub) return toApp({ ...msg, id: msg.type === "session" ? undefined : randomUUID() }, timeout);
  try {
    return await viaHub("/relay", msg, timeout + 2000);
  } catch (e) {
    // The hub went away: take over the port and try once more.
    if (e.code === "ECONNREFUSED" && (await listen())) return toApp({ ...msg, id: msg.type === "session" ? undefined : randomUUID() }, timeout);
    throw e;
  }
}

// ---------- MCP over stdio ----------

const session = { id: randomUUID(), client: "MCP client", startedAt: new Date().toISOString() };
let initialized = false;

const DEFAULT_INSTRUCTIONS =
  "Falcon is a work tracker for a Chartered Accountant (audit, due diligence, internal audit): engagements, work papers and review points, the client RFI, work plans, follow-ups and time. " +
  "Use its tools to read and change data. Never invent ids: use ids from tool results. Every change can be reversed with undo_last, and the user sees each change in Falcon (Settings → AI connections). " +
  "If a tool says Falcon isn't connected, ask the user to open Falcon in their browser and turn on AI connections.";

const STATUS_TOOL = {
  name: "falcon_status",
  description: "Check whether the Falcon app is open and connected to this bridge. Use when other Falcon tools fail with 'not connected'.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
};

function out(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
const reply = (id, result) => out({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => out({ jsonrpc: "2.0", id, error: { code, message } });

const notConnected = () =>
  CODE
    ? "Falcon isn't connected. Open Falcon in your browser on this computer and turn on Settings → AI connections (same pairing code as this bridge)."
    : "The bridge has no pairing code. Copy the code from Falcon (Settings → AI connections) into the bridge's settings in your AI app, then restart it.";

/** How many tools this client was last given (to spot a session stuck with only the status tool). */
let toolsGiven = 0;

async function listTools() {
  try {
    const r = await ask({ type: "list" }, LIST_TIMEOUT);
    if (r?.ok && Array.isArray(r.result?.tools)) {
      writeCache({ tools: r.result.tools, instructions: r.result.instructions, savedAt: new Date().toISOString() });
      return r.result.tools;
    }
  } catch (e) {
    if (e.code !== "NOT_CONNECTED") log("tools/list:", e.message);
  }
  const cached = readCache()?.tools;
  return Array.isArray(cached) && cached.length ? cached : bundledTools();
}

/** Whether Falcon is connected, asked of the hub when this process isn't it. */
async function appConnected() {
  if (isHub) return apps.length > 0;
  try {
    const r = await new Promise((resolve, reject) =>
      http
        .get({ host: "127.0.0.1", port: PORT, path: "/status", headers: { "X-Falcon-Code": CODE }, timeout: 3000 }, (res) => {
          const c = [];
          res.on("data", (d) => c.push(d));
          res.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(c).toString() || "{}"));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on("error", reject)
        .on("timeout", function () {
          this.destroy(new Error("timeout"));
        }),
    );
    return !!r.appConnected;
  } catch {
    return false;
  }
}

async function callTool(name, args) {
  if (name === "falcon_status") {
    const connected = await appConnected();
    const text = !connected
      ? notConnected()
      : toolsGiven <= 1
        ? "Falcon is open and connected, but this session started before Falcon's tools were available, so you only have this status tool. Ask the user to start a new chat (or restart the AI app) to load Falcon's tools."
        : "Falcon is open and connected.";
    return { content: [{ type: "text", text }] };
  }
  try {
    const r = await ask({ type: "call", name, args: args ?? {}, session }, CALL_TIMEOUT);
    if (!r) throw new Error("No answer from Falcon.");
    if (!r.ok) return { content: [{ type: "text", text: r.error || "The tool failed." }], isError: true };
    return { content: [{ type: "text", text: typeof r.result === "string" ? r.result : JSON.stringify(r.result ?? null, null, 1) }] };
  } catch (e) {
    return { content: [{ type: "text", text: e.code === "NOT_CONNECTED" || e.code === "ECONNREFUSED" ? notConnected() : e.message }], isError: true };
  }
}

async function handle(msg) {
  const { id, method, params } = msg ?? {};
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case "initialize": {
      const c = params?.clientInfo;
      if (c?.name) session.client = c.version ? `${c.name} ${c.version}` : c.name;
      const asked = params?.protocolVersion;
      reply(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "falcon-bridge", title: "Falcon", version: VERSION },
        instructions: readCache()?.instructions || DEFAULT_INSTRUCTIONS,
      });
      return;
    }
    case "notifications/initialized":
      initialized = true;
      ask({ type: "session", event: "start", session }, 3000).catch(() => {});
      return;
    case "ping":
      return isRequest && reply(id, {});
    case "tools/list": {
      const tools = [...(await listTools()), STATUS_TOOL];
      toolsGiven = tools.length;
      return reply(id, { tools });
    }
    case "tools/call":
      return reply(id, await callTool(params?.name, params?.arguments));
    default:
      if (isRequest) fail(id, -32601, `Method not found: ${method}`);
  }
}

async function main() {
  if (argv.includes("--version")) {
    process.stdout.write(`falcon-bridge ${VERSION}\n`);
    return;
  }
  if (!CODE) log("no pairing code set (FALCON_PAIRING_CODE or --code): tools will report that Falcon isn't connected");
  if (!(await listen())) log(`another bridge owns port ${PORT}; relaying through it`);

  // When Falcon connects, refresh the saved tool list and tell the client its tools changed.
  onAppConnected = async () => {
    await new Promise((r) => setTimeout(r, 300));
    await listTools();
    if (initialized) out({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  };

  // A second AI app relays through the first bridge, so it doesn't see Falcon connect:
  // check the hub now and then, and tell its client when Falcon comes online.
  let wasConnected = await appConnected();
  const poll = setInterval(async () => {
    if (isHub) return;
    const now = await appConnected();
    if (now && !wasConnected) await onAppConnected();
    wasConnected = now;
  }, POLL_MS);
  poll.unref();

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const inflight = new Set();
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return out({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    for (const m of Array.isArray(msg) ? msg : [msg]) {
      const p = handle(m).catch((e) => m?.id != null && fail(m.id, -32603, e.message));
      inflight.add(p);
      p.finally(() => inflight.delete(p));
    }
  });
  rl.on("close", async () => {
    await Promise.allSettled([...inflight]);
    await ask({ type: "session", event: "end", session }, 2000).catch(() => {});
    setTimeout(() => process.exit(0), 100);
  });
}

main();
