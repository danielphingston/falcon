// Builds the release files into dist/:
//   falcon-bridge.mcpb  Claude Desktop extension (a zip with manifest.json at the root)
//   falcon-bridge.mjs   the same server as one file, for other MCP clients (`node falcon-bridge.mjs`)
//   SHA256SUMS.txt
// No dependencies. The version in manifest.json, package.json and the server must match.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const read = (p) => fs.readFileSync(path.join(root, p));

const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));
// Build Falcon's tool list into the released server, so it can offer every tool
// before Falcon is open (some AI apps only ask for tools once, at start-up).
const tools = JSON.parse(read("server/tools.snapshot.json")).tools;
const source = read("server/index.mjs").toString();
const marker = "const BUNDLED_TOOLS = null;";
if (!source.includes(marker) || !Array.isArray(tools) || tools.length < 10) {
  console.error("Can't build the tool list into the server (marker or tools.snapshot.json missing). Run `npm run bridge:tools` at the repo root.");
  process.exit(1);
}
const server = Buffer.from(source.replace(marker, `const BUNDLED_TOOLS = ${JSON.stringify(tools)};`));
const serverVersion = /const VERSION = "([^"]+)"/.exec(server.toString())?.[1];
if (manifest.version !== pkg.version || serverVersion !== pkg.version) {
  console.error(`Version mismatch: manifest ${manifest.version}, package ${pkg.version}, server ${serverVersion}`);
  process.exit(1);
}
const tag = process.env.RELEASE_TAG;
if (tag && tag !== `bridge-v${pkg.version}`) {
  console.error(`Tag ${tag} doesn't match version ${pkg.version} (expected bridge-v${pkg.version})`);
  process.exit(1);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const files = [
  ["manifest.json", read("manifest.json")],
  ["server/index.mjs", server],
  ["package.json", Buffer.from(JSON.stringify({ name: "falcon-bridge", version: pkg.version, type: "module", private: true }, null, 2))],
  ["README.md", read("README.md")],
];
fs.writeFileSync(path.join(dist, "falcon-bridge.mcpb"), zip(files));
fs.writeFileSync(path.join(dist, "falcon-bridge.mjs"), server);

const sums = ["falcon-bridge.mcpb", "falcon-bridge.mjs"].map((f) => `${createHash("sha256").update(fs.readFileSync(path.join(dist, f))).digest("hex")}  ${f}`);
fs.writeFileSync(path.join(dist, "SHA256SUMS.txt"), sums.join("\n") + "\n");
console.log(`Built falcon-bridge ${pkg.version}:\n${sums.join("\n")}`);

// ---------- Minimal zip writer (stored, no compression) ----------

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  // Fixed timestamp (2026-01-01 00:00) so builds are reproducible.
  const time = 0;
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, data] of entries) {
    const n = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(0, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26);
    local.push(h, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
