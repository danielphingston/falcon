import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiJsonResilient, type GeminiAuth } from "../src";

const auth: GeminiAuth = { accessToken: async () => "t" };
const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const busy = () => new Response(JSON.stringify({ error: { status: "UNAVAILABLE", message: "This model is currently experiencing high demand." } }), { status: 503 });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Gemini when it's busy", () => {
  it("retries a busy model and succeeds", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let n = 0;
    vi.stubGlobal("fetch", async (url: string) => (calls.push(url), n++ < 2 ? busy() : ok("{}")));
    const p = geminiJsonResilient(auth, "gemini-x-flash", "hi");
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ text: "{}", model: "gemini-x-flash" });
    expect(calls).toHaveLength(3);
  });

  it("moves to a lighter model when the chosen one stays busy", async () => {
    vi.useFakeTimers();
    const used: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/models?")) return new Response(JSON.stringify({ models: [{ name: "models/gemini-x-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-x-flash-lite", supportedGenerationMethods: ["generateContent"] }] }));
      const model = /models\/([^:]+):/.exec(url)![1];
      used.push(model);
      return model === "gemini-x-flash" ? busy() : ok('{"links":[]}');
    });
    const p = geminiJsonResilient(auth, "gemini-x-flash", "hi");
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ text: '{"links":[]}', model: "gemini-x-flash-lite" });
    expect(used).toEqual(["gemini-x-flash", "gemini-x-flash", "gemini-x-flash", "gemini-x-flash-lite"]);
  });

  it("doesn't retry real errors", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => (n++, new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "no" } }), { status: 403 })));
    await expect(geminiJsonResilient(auth, "m", "hi")).rejects.toMatchObject({ status: 403 });
    expect(n).toBe(1);
  });
});
