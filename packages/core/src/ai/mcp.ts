/**
 * The shared tools in MCP form, for the local MCP bridge. Same tools, same
 * handlers as the in-app chat: only the wrapping differs.
 */
import type { Settings } from "../schema";
import type { Snapshot } from "../store";
import { toolJsonSchemas } from "../tools";
import { assistantInstructions } from "./prompt";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint?: boolean };
}

export function mcpTools(): McpTool[] {
  return toolJsonSchemas().map((t) => {
    const { $schema, ...schema } = t.parameters as Record<string, unknown>;
    void $schema;
    return {
      name: t.name,
      description: t.description,
      inputSchema: schema,
      annotations: { readOnlyHint: t.kind === "read", destructiveHint: t.kind === "confirm" },
    };
  });
}

/** Server instructions for an AI connected through the bridge (Claude, Cursor…). */
export function connectorInstructions(s: Snapshot, settings: Settings, today: string, now: Date = new Date()): string {
  return `${assistantInstructions(s, settings, today, now)}

You are connected to Falcon through its local MCP bridge, not the in-app chat:
- Falcon is open in the user's browser and runs every tool against its own data. Your changes are proposals that wait in Falcon's Inbox until the user accepts them (only task dates and chase logs apply at once); you can't accept them. Each call shows in Falcon under AI connections.
- Engagement types include Stat Audit, Internal Audit, Due Diligence, Transaction Support and ITR, not only FDD deals.
- Excel files (work plans, RFIs, trial balances) are imported in Falcon itself; ask the user to import them there, then read the result with the tools.
- Firm checklists are private to the device and not available to you.`;
}
