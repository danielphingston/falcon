// Drives the bridge the way an MCP client and the Falcon tab do: a real
// bridge process on a spare port, a fake Falcon tab over HTTP.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../server/index.mjs");
const CODE = "TEST-CODE-1234-5678";
const ORIGIN = "http://falcon.test";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** A bridge process speaking MCP over stdio. */
function startBridge(port, dir, extraEnv = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, FALCON_PORT: String(port), FALCON_PAIRING_CODE: CODE, FALCON_ORIGINS: ORIGIN, FALCON_BRIDGE_DIR: dir, FALCON_CALL_TIMEOUT_MS: "4000", ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiting = new Map();
  const notes = [];
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && waiting.has(msg.id)) {
        waiting.get(msg.id)(msg);
        waiting.delete(msg.id);
      } else notes.push(msg);
    }
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  let next = 1;
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = next++;
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}\n${stderr}`)), 10_000);
      waiting.set(id, (m) => (clearTimeout(t), resolve(m)));
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  const ready = new Promise((resolve) => {
    const check = () => (/listening|relaying/.test(stderr) ? resolve() : setTimeout(check, 30));
    check();
  });
  return { child, request, notify, notes, ready, stderr: () => stderr };
}

async function initialize(b, client = "test-client") {
  const r = await b.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: client, version: "1.0" } });
  b.notify("notifications/initialized");
  return r;
}

/** A fake Falcon tab: listens for calls and answers them. */
function startApp(port, { origin = ORIGIN, code = CODE } = {}) {
  const seen = [];
  let req;
  const connected = new Promise((resolve, reject) => {
    req = http.get({ host: "127.0.0.1", port, path: `/app/events?code=${encodeURIComponent(code)}`, headers: { Origin: origin } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(res.statusCode);
      }
      let buf = "";
      res.on("data", async (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block.split("\n").find((l) => l.startsWith("data: "));
          if (!data) continue;
          const msg = JSON.parse(data.slice(6));
          seen.push(msg);
          if (msg.type === "hello") resolve(200);
          if (!msg.id) continue;
          const answer =
            msg.type === "list"
              ? { ok: true, result: { tools: [{ name: "get_today", description: "Today", inputSchema: { type: "object" } }], instructions: "Falcon test instructions" } }
              : msg.name === "boom"
                ? { ok: false, error: "Tool failed on purpose" }
                : { ok: true, result: { echoed: msg.args, client: msg.session?.client } };
          await post(port, `/app/result?code=${encodeURIComponent(code)}`, { id: msg.id, ...answer }, origin);
        }
      });
    });
    req.on("error", reject);
  });
  return { connected, seen, close: () => req.destroy() };
}

function post(port, p, body, origin, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const r = http.request(
      { host: "127.0.0.1", port, path: p, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": data.length, ...(origin ? { Origin: origin } : {}), ...headers } },
      (res) => {
        const c = [];
        res.on("data", (d) => c.push(d));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(c).toString() || "{}") }));
      },
    );
    r.on("error", reject);
    r.end(data);
  });
}

describe("falcon bridge", () => {
  let port, dir, hub;
  before(async () => {
    port = await freePort();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-bridge-"));
    hub = startBridge(port, dir);
    await hub.ready;
  });
  after(() => {
    hub.child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("answers initialize with Falcon's server info", async () => {
    const r = await initialize(hub, "claude-ai");
    assert.equal(r.result.serverInfo.name, "falcon-bridge");
    assert.equal(r.result.protocolVersion, "2025-06-18");
    assert.ok(r.result.capabilities.tools);
  });

  it("says Falcon isn't connected when the app isn't open", async () => {
    const list = await hub.request("tools/list", {});
    assert.deepEqual(list.result.tools.map((t) => t.name), ["falcon_status"]);
    const call = await hub.request("tools/call", { name: "get_today", arguments: {} });
    assert.equal(call.result.isError, true);
    assert.match(call.result.content[0].text, /isn't connected/);
  });

  it("refuses other web pages and wrong codes", async () => {
    assert.equal(await startApp(port, { origin: "https://evil.example" }).connected, 403);
    assert.equal(await startApp(port, { code: "WRONG-CODE-0000-0000" }).connected, 401);
    assert.equal((await post(port, "/relay", { type: "list" }, ORIGIN, { "X-Falcon-Code": CODE })).status, 403, "relay is never for browsers");
    assert.equal((await post(port, "/relay", { type: "list" }, undefined, { "X-Falcon-Code": "nope" })).status, 401);
  });

  it("relays tools/list and tools/call to the Falcon tab, with the session", async () => {
    const app = startApp(port);
    assert.equal(await app.connected, 200);
    await sleep(500);
    assert.ok(hub.notes.some((n) => n.method === "notifications/tools/list_changed"), "tells the client its tools changed");
    const list = await hub.request("tools/list", {});
    assert.deepEqual(list.result.tools.map((t) => t.name), ["get_today", "falcon_status"]);
    const call = await hub.request("tools/call", { name: "get_today", arguments: { x: 1 } });
    assert.equal(call.result.isError, undefined);
    assert.deepEqual(JSON.parse(call.result.content[0].text), { echoed: { x: 1 }, client: "claude-ai 1.0" });
    const failed = await hub.request("tools/call", { name: "boom", arguments: {} });
    assert.equal(failed.result.isError, true);
    assert.equal(failed.result.content[0].text, "Tool failed on purpose");
    app.close();
  });

  it("remembers the tool list for when Falcon isn't open yet", async () => {
    const cached = JSON.parse(fs.readFileSync(path.join(dir, "tools.json"), "utf8"));
    assert.equal(cached.tools[0].name, "get_today");
    await sleep(200);
    const list = await hub.request("tools/list", {});
    assert.deepEqual(list.result.tools.map((t) => t.name), ["get_today", "falcon_status"]);
    const init = await initialize(startBridgeForInit(port + 0, dir));
    assert.equal(init.result.instructions, "Falcon test instructions");
  });

  it("a second MCP client relays through the first bridge", async () => {
    const app = startApp(port);
    await app.connected;
    const second = startBridge(port, dir);
    await second.ready;
    assert.match(second.stderr(), /relaying/);
    await initialize(second, "cursor");
    await sleep(300);
    assert.ok(app.seen.some((m) => m.type === "session" && m.event === "start" && m.session.client === "cursor 1.0"), "Falcon hears that a session started");
    const call = await second.request("tools/call", { name: "get_today", arguments: { y: 2 } });
    assert.deepEqual(JSON.parse(call.result.content[0].text), { echoed: { y: 2 }, client: "cursor 1.0" });
    const status = await second.request("tools/call", { name: "falcon_status", arguments: {} });
    assert.match(status.result.content[0].text, /connected/);
    second.child.stdin.end();
    await sleep(600);
    assert.ok(app.seen.some((m) => m.type === "session" && m.event === "end" && m.session.client === "cursor 1.0"), "and that it ended");
    app.close();
  });

  it("reports unknown methods", async () => {
    const r = await hub.request("resources/list", {});
    assert.equal(r.error.code, -32601);
  });
});

/** A throwaway bridge that only answers initialize (to check cached instructions). */
function startBridgeForInit(port, dir) {
  const b = startBridge(port, dir);
  setTimeout(() => b.child.kill(), 3000);
  return b;
}
