/**
 * Minimal Gemini REST client (no SDK). Authenticates with a Google OAuth
 * access token from the user's sign-in (scope GEMINI_OAUTH_SCOPE; usage is
 * billed to the OAuth client's Cloud project).
 */
import type { GPart, GeminiStream } from "./gemini";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_OAUTH_SCOPE = "https://www.googleapis.com/auth/generative-language.retriever";

export type GeminiAuth = { accessToken: () => Promise<string> };

export class GeminiApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function headers(auth: GeminiAuth): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await auth.accessToken()}` };
}

async function check(res: Response) {
  if (res.ok) return;
  let msg = res.statusText;
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } };
    msg = [body.error?.status, body.error?.message].filter(Boolean).join(": ") || msg;
  } catch {
    /* not JSON */
  }
  throw new GeminiApiError(res.status, msg);
}

/** Streams generateContent over server-sent events. */
export function geminiRestStream(auth: GeminiAuth, model: string): GeminiStream {
  return async function* (req) {
    const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      signal: req.signal,
      headers: { "Content-Type": "application/json", ...(await headers(auth)) },
      body: JSON.stringify({
        contents: req.contents,
        systemInstruction: { parts: [{ text: req.systemInstruction }] },
        tools: [{ functionDeclarations: req.functionDeclarations }],
      }),
    });
    await check(res);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line; each has "data: {json}".
      let cut: number;
      while ((cut = buf.search(/\r?\n\r?\n/)) >= 0) {
        const event = buf.slice(0, cut);
        buf = buf.slice(cut).replace(/^\r?\n\r?\n/, "");
        const data = event
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const chunk = JSON.parse(data) as { candidates?: { content?: { parts?: GPart[] } }[]; error?: { message?: string; code?: number } };
        if (chunk.error) throw new GeminiApiError(chunk.error.code ?? 500, chunk.error.message ?? "Gemini error");
        yield { parts: chunk.candidates?.[0]?.content?.parts ?? [] };
      }
      if (done) break;
    }
  };
}

/** Gemini models this credential can use for chat (no tokens spent). */
export async function listGeminiModels(auth: GeminiAuth): Promise<string[]> {
  const out: string[] = [];
  let pageToken = "";
  do {
    const res = await fetch(`${BASE}/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`, { headers: await headers(auth) });
    await check(res);
    const body = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string };
    for (const m of body.models ?? [])
      if (m.name.startsWith("models/gemini") && m.supportedGenerationMethods?.includes("generateContent")) out.push(m.name.slice(7));
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return out;
}
