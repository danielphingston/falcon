// The MCP bridge ships a copy of Falcon's tool list so an AI app that starts
// before Falcon is open still sees every tool. This keeps that copy in step
// with the real tools: after changing a tool, run `npm run bridge:tools`.
import { expect, it } from "vitest";
import { mcpTools } from "../src";

it("the bridge's built-in tool list matches Falcon's tools", async () => {
  await expect(`${JSON.stringify({ tools: mcpTools() }, null, 1)}\n`).toMatchFileSnapshot("../../../apps/bridge/server/tools.snapshot.json");
});
