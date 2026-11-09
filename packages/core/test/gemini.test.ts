import { describe, expect, it, vi } from "vitest";
import {
  GeminiApiError,
  MemoryStore,
  geminiRestStream,
  assistantInstructions,
  compactHistory,
  create,
  defaultSettings,
  geminiFunctionDeclarations,
  geminiTurn,
  loadSnapshot,
  type GContent,
  type GPart,
  type GeminiRequest,
} from "../src";

/** A scripted model: each call returns the next list of chunks. */
function scripted(steps: GPart[][][]) {
  const requests: GeminiRequest[] = [];
  const stream = async function* (req: GeminiRequest) {
    requests.push(JSON.parse(JSON.stringify({ ...req, signal: undefined })));
    const chunks = steps.shift() ?? [[{ text: "(no more script)" }]];
    for (const parts of chunks) yield { parts };
  };
  return { stream, requests };
}

describe("Gemini adapter", () => {
  it("declares every tool without $schema", () => {
    const decls = geminiFunctionDeclarations();
    expect(decls.map((d) => d.name)).toContain("add_irl_items");
    expect(decls.every((d) => !("$schema" in d.parametersJsonSchema))).toBe(true);
    expect(decls.find((d) => d.name === "create_task")!.parametersJsonSchema).toMatchObject({ type: "object" });
  });

  it("runs tool calls, feeds results back and streams the final text", async () => {
    const store = new MemoryStore();
    await create({ store, by: "app" }, "engagements", { name: "Project Falcon" });
    const { stream, requests } = scripted([
      [
        [{ thought: true, text: "thinking…" }],
        [{ functionCall: { id: "c1", name: "add_irl_items", args: { engagement: "falcon", items: [{ number: "1", description: "TB FY24" }] } }, thoughtSignature: "sig-1" }],
      ],
      [[{ text: "Added " }], [{ text: "1 IRL item." }]],
    ]);
    const text: string[] = [];
    const tools: string[] = [];
    const history = await geminiTurn({
      history: [],
      user: [{ text: "Add TB FY24 to the Falcon IRL" }],
      stream,
      ctx: { store, by: "chat" },
      systemInstruction: "sys",
      events: { onText: (d) => text.push(d), onToolEnd: (c, r) => tools.push(`${c.name}:${r.ok}`) },
    });

    expect(text.join("")).toBe("Added 1 IRL item.");
    expect(tools).toEqual(["add_irl_items:true"]);
    expect((await store.list("infoRequests"))[0]).toMatchObject({ description: "TB FY24", number: "1" });
    // History: user, model(call), user(response), model(text).
    expect(history.map((c) => c.role)).toEqual(["user", "model", "user", "model"]);
    // The thought signature goes back unchanged, and the response carries the call id.
    expect(requests[1].contents[1].parts[1]).toMatchObject({ thoughtSignature: "sig-1" });
    expect(requests[1].contents[2].parts[0].functionResponse).toMatchObject({ id: "c1", name: "add_irl_items", response: { result: { added: 1 } } });
    // Changes are attributed to the chat, so the chat's undo_last finds them.
    expect((await store.listChanges()).every((c) => c.by === "chat" || c.table === "engagements")).toBe(true);
  });

  it("returns tool errors to the model instead of throwing", async () => {
    const store = new MemoryStore();
    const { stream, requests } = scripted([
      [[{ functionCall: { name: "create_task", args: { title: "x", engagement: "nope" } } }]],
      [[{ text: "That engagement doesn't exist." }]],
    ]);
    await geminiTurn({ history: [], user: [{ text: "hi" }], stream, ctx: { store, by: "chat" }, systemInstruction: "" });
    expect(requests[1].contents[2].parts[0].functionResponse!.response).toMatchObject({ error: expect.stringContaining("No engagement matches") });
  });

  it("stops runaway tool loops", async () => {
    const store = new MemoryStore();
    const loop = Array.from({ length: 10 }, () => [[{ functionCall: { name: "get_today", args: {} } }]] as GPart[][]);
    const { stream } = scripted(loop);
    await expect(geminiTurn({ history: [], user: [{ text: "x" }], stream, ctx: { store, by: "chat" }, systemInstruction: "", maxSteps: 3 })).rejects.toThrow(/too many steps/);
  });

  it("compacts history: drops old attachments and never starts on a tool response", () => {
    const img = { inlineData: { mimeType: "image/png", data: "AAAA" } };
    const h: GContent[] = [
      { role: "user", parts: [{ text: "look" }, img] },
      { role: "model", parts: [{ functionCall: { name: "get_today" } }] },
      { role: "user", parts: [{ functionResponse: { name: "get_today", response: {} } }] },
      { role: "model", parts: [{ text: "ok" }] },
      { role: "user", parts: [{ text: "again" }, img] },
      { role: "model", parts: [{ text: "sure" }] },
    ];
    const c = compactHistory(h);
    expect(c[0].parts[1]).toEqual({ text: "[attachment: image/png]" });
    expect(c[4].parts[1]).toEqual(img);
    expect(compactHistory(h, 4)[0].parts[0]).toEqual({ text: "again" });
  });

  it("REST stream parses SSE split across reads and sends the right auth header", async () => {
    const events = [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hel" }] } }] })}\r\n\r\n`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "lo" }, { functionCall: { name: "get_today", args: {} } }] } }] })}\r\n\r\n`,
    ].join("");
    const seen: { url: string; headers: Record<string, string>; body: { systemInstruction: unknown; tools: unknown[] } }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      const bytes = new TextEncoder().encode(events);
      const body = new ReadableStream({
        start(c) {
          // Deliberately split mid-event.
          c.enqueue(bytes.slice(0, 37));
          c.enqueue(bytes.slice(37, 120));
          c.enqueue(bytes.slice(120));
          c.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    const req = { contents: [{ role: "user" as const, parts: [{ text: "hi" }] }], systemInstruction: "sys", functionDeclarations: geminiFunctionDeclarations() };

    const parts: GPart[] = [];
    for await (const c of geminiRestStream({ accessToken: async () => "tok" }, "gemini-3.8-flash")(req)) parts.push(...c.parts);
    expect(parts.map((p) => p.text ?? p.functionCall?.name)).toEqual(["Hel", "lo", "get_today"]);
    expect(seen[0].url).toContain("/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
    expect(seen[0].headers.Authorization).toBe("Bearer tok");
    expect(seen[0].body.systemInstruction).toEqual({ parts: [{ text: "sys" }] });
    expect(seen[0].headers["x-goog-api-key"]).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("REST errors carry the status", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "insufficient scopes" } }), { status: 403 }));
    const err = await (async () => {
      for await (const _ of geminiRestStream({ accessToken: async () => "t" }, "m")({ contents: [], systemInstruction: "", functionDeclarations: [] })) void _;
    })().catch((e) => e);
    expect(err).toBeInstanceOf(GeminiApiError);
    expect(err.status).toBe(403);
    expect(err.message).toContain("insufficient scopes");
    vi.unstubAllGlobals();
  });

  it("builds instructions with today's date and live engagements", async () => {
    const store = new MemoryStore();
    await create({ store, by: "app" }, "engagements", { name: "Project Falcon" });
    const text = assistantInstructions(await loadSnapshot(store), defaultSettings(), "2026-10-16");
    expect(text).toContain("Friday 16 October 2026");
    expect(text).toContain("Project Falcon");
  });
});
