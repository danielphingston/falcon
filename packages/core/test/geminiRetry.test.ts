import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiJson, type GeminiAuth } from "../src";

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
    const p = geminiJson(auth, "gemini-3.8-flash", "hi");
    await vi.runAllTimersAsync();
    expect(await p).toBe("{}");
    expect(calls).toHaveLength(3);
  });

  it("only ever uses the chosen model, then reports busy", async () => {
    vi.useFakeTimers();
    const used: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      used.push(url.includes("/models?") ? "LIST" : /models\/([^:]+):/.exec(url)![1]);
      return busy();
    });
    const p = geminiJson(auth, "gemini-3.8-flash", "hi").catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await p).toMatchObject({ status: 503 });
    // Three tries on the same model; no other model, not even a model list lookup.
    expect(used).toEqual(["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.8-flash"]);
  });

  it("doesn't retry real errors", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => (n++, new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "no" } }), { status: 403 })));
    await expect(geminiJson(auth, "m", "hi")).rejects.toMatchObject({ status: 403 });
    expect(n).toBe(1);
  });
});
