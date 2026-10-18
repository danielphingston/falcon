/**
 * Gemini adapter for the shared tools. It's written against Gemini's wire
 * shapes but not the SDK, so the chat loop can be unit-tested with a fake
 * stream; the web app plugs in @google/genai.
 */
import type { Ctx } from "../actions";
import { runTool, toolJsonSchemas, type ToolCallResult } from "../tools";

export interface GPart {
  text?: string;
  /** Reasoning summary parts; not shown as answer text. */
  thought?: boolean;
  /** Must be sent back unchanged with the part it came on (Gemini 3+). */
  thoughtSignature?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
  inlineData?: { mimeType: string; data: string };
}
export interface GContent {
  role: "user" | "model";
  parts: GPart[];
}

export interface GeminiRequest {
  contents: GContent[];
  systemInstruction: string;
  functionDeclarations: GeminiFunctionDeclaration[];
  signal?: AbortSignal;
}
/** Yields response chunks; each chunk has the parts generated since the last one. */
export type GeminiStream = (req: GeminiRequest) => AsyncIterable<{ parts: GPart[] }>;

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

/** The shared tools as Gemini function declarations. */
export function geminiFunctionDeclarations(): GeminiFunctionDeclaration[] {
  return toolJsonSchemas().map((t) => {
    const { $schema, ...schema } = t.parameters as Record<string, unknown>;
    void $schema;
    return { name: t.name, description: t.description, parametersJsonSchema: schema };
  });
}

export interface ToolEvent {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface TurnEvents {
  onText?(delta: string): void;
  onToolStart?(call: ToolEvent): void;
  onToolEnd?(call: ToolEvent, result: ToolCallResult): void;
}

export class TurnLimitError extends Error {}

/**
 * Runs one user turn: streams the model, executes any tool calls against the
 * store, feeds results back, and repeats until the model answers in text.
 * Returns the full updated history (to send next time).
 */
export async function geminiTurn(opts: {
  history: GContent[];
  user: GPart[];
  stream: GeminiStream;
  ctx: Omit<Ctx, "batchId">;
  systemInstruction: string;
  events?: TurnEvents;
  signal?: AbortSignal;
  maxSteps?: number;
}): Promise<GContent[]> {
  const contents: GContent[] = [...opts.history, { role: "user", parts: opts.user }];
  const functionDeclarations = geminiFunctionDeclarations();
  let callSeq = 0;

  for (let step = 0; step < (opts.maxSteps ?? 8); step++) {
    const parts: GPart[] = [];
    for await (const chunk of opts.stream({ contents, systemInstruction: opts.systemInstruction, functionDeclarations, signal: opts.signal })) {
      for (const p of chunk.parts ?? []) {
        parts.push(p);
        if (p.text && !p.thought) opts.events?.onText?.(p.text);
      }
    }
    contents.push({ role: "model", parts: parts.length ? parts : [{ text: "" }] });

    const calls = parts.filter((p) => p.functionCall?.name).map((p) => p.functionCall!);
    if (!calls.length) return contents;

    const responses: GPart[] = [];
    for (const c of calls) {
      const ev: ToolEvent = { id: c.id ?? `call-${++callSeq}`, name: c.name!, args: c.args ?? {} };
      opts.events?.onToolStart?.(ev);
      const result = await runTool(opts.ctx, ev.name, ev.args);
      opts.events?.onToolEnd?.(ev, result);
      responses.push({
        functionResponse: {
          ...(c.id ? { id: c.id } : {}),
          name: ev.name,
          response: result.ok ? { result: result.result as Record<string, unknown> } : { error: result.error },
        },
      });
      if (opts.signal?.aborted) break;
    }
    contents.push({ role: "user", parts: responses });
    if (opts.signal?.aborted) return contents;
  }
  throw new TurnLimitError("Stopped after too many steps. Try a simpler request.");
}

/** Drops bulky attachment data from older turns before saving history. */
export function compactHistory(history: GContent[], keepLast = 40): GContent[] {
  let h = history.slice(-keepLast);
  // A history must start with a plain user message, not a tool response.
  while (h.length && (h[0].role !== "user" || h[0].parts.some((p) => p.functionResponse))) h = h.slice(1);
  return h.map((c, i) =>
    i >= h.length - 2 ? c : { ...c, parts: c.parts.map((p) => (p.inlineData ? { text: `[attachment: ${p.inlineData.mimeType}]` } : p)) },
  );
}
