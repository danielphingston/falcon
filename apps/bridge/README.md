# Falcon MCP bridge

Lets Claude (or any app that supports local MCP servers) use Falcon: the same tools as Falcon's in-app assistant, on your live data, with every change logged in Falcon and undoable.

```
Claude ⇄ (MCP over stdio) ⇄ falcon-bridge ⇄ 127.0.0.1:47820 ⇄ Falcon open in your browser
```

The bridge holds no data and no tool logic. Falcon runs each tool itself and sends back the result, so **Falcon must be open in a browser on the same computer**, with **Settings → AI connections → Allow AI connections** ticked.

## Install

### Claude Desktop

1. In Falcon, open **AI connections** and copy the **pairing code**.
2. Download `falcon-bridge.mcpb` from the [latest release](https://github.com/danielphingston/falcon/releases/latest) and open it (or Claude → Settings → Extensions → Install extension).
3. Paste the pairing code when Claude asks. Leave the port at 47820 unless you changed it in Falcon.

Claude Desktop runs the extension with its own bundled Node, so nothing else needs installing, and there's no `.exe` for Windows Smart App Control to block.

### Claude Code, Cursor and other MCP apps

Needs Node 18 or newer. Download `falcon-bridge.mjs` from the latest release, then:

```sh
claude mcp add falcon -e FALCON_PAIRING_CODE=XXXX-XXXX-XXXX-XXXX -- node /path/to/falcon-bridge.mjs
```

or in an MCP config file:

```json
{
  "mcpServers": {
    "falcon": {
      "command": "node",
      "args": ["/path/to/falcon-bridge.mjs"],
      "env": { "FALCON_PAIRING_CODE": "XXXX-XXXX-XXXX-XXXX" }
    }
  }
}
```

The web and phone versions of Claude can't use local MCP servers.

## Settings

| Environment variable | Default | |
|---|---|---|
| `FALCON_PAIRING_CODE` | (required) | From Falcon → AI connections |
| `FALCON_PORT` | `47820` | Must match the port in Falcon |
| `FALCON_ORIGINS` | | Extra web origins allowed to connect (comma-separated), e.g. a self-hosted copy of Falcon |
| `FALCON_BRIDGE_DIR` | `~/.falcon-bridge` | Where the last tool list is cached |

## Security

- Listens on `127.0.0.1` only.
- Accepts the Falcon tab only from Falcon's own web address (`https://danielphingston.github.io`, plus `localhost` for development), and only with the pairing code. Other web pages are refused.
- Other bridge processes on the computer (when two AI apps run at once) relay through the first one, using the pairing code. Browsers can't use that route.
- Stores only the last tool list (`~/.falcon-bridge/tools.json`), no data.
- What the AI reads goes to the AI service as part of your chat, as with Falcon's in-app assistant. Firm checklists are never exposed.

## Develop

```sh
npm test          # starts real bridge processes against a fake Falcon tab
npm run pack      # dist/falcon-bridge.mcpb, dist/falcon-bridge.mjs, dist/SHA256SUMS.txt
```

No dependencies: Node's standard library only.

## Release

Bump the version in `package.json`, `manifest.json` and `server/index.mjs` (the pack step checks they match), merge, then push a tag:

```sh
git tag bridge-v0.1.0 && git push origin bridge-v0.1.0
```

The **MCP bridge** workflow tests on Windows, macOS and Linux, packs, and publishes the GitHub release that Falcon's download links point to.
