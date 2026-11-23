/**
 * AI help for the Readiness page: asks Gemini which RFI items work plan steps
 * need (and what isn't on the RFI), and saves the links in one undoable batch.
 *
 * Mindful of tokens and Gemini's busy spells: by default only the steps the
 * offline matcher couldn't link are sent, in small batches of short text;
 * busy answers are retried and then tried on a lighter model; if a batch
 * still fails, what finished is kept.
 */
import { engagementReadiness, geminiJsonResilient, linkPrompt, loadSnapshot, parseLinkReply, todayISO, update, type AiLink } from "@falcon/core";
import { getSettings, store } from "../db";
import { act } from "./act";
import { chatAuth, friendlyError } from "./chat";

const BATCH = 20;

export type LinkScope = "unlinked" | "all";

export interface LinkResult {
  linked: number;
  /** Steps not linked because a batch failed. */
  left: number;
  /** Set when something went wrong (the linked steps are still saved). */
  error?: string;
  /** The model that answered, when it wasn't the one in Settings. */
  fallback?: string;
}

/** Steps Link with AI would send for this engagement. */
export async function linkCandidates(engagementId: string, scope: LinkScope) {
  const snap = await loadSnapshot(store);
  const e = snap.engagements.find((x) => x.id === engagementId);
  if (!e) return [];
  const r = engagementReadiness(e, snap.planItems, snap.infoRequests, todayISO());
  const pick = scope === "unlinked" ? r.unlinked : r.steps.filter((s) => s.source !== "manual");
  return pick.map((s) => s.step);
}

export async function linkWithAi(engagementId: string, scope: LinkScope, onProgress?: (done: number, total: number) => void): Promise<LinkResult | string> {
  const auth = await chatAuth();
  if (typeof auth === "string") return auth;
  const snap = await loadSnapshot(store);
  const e = snap.engagements.find((x) => x.id === engagementId);
  if (!e) return "Engagement not found.";
  const rfi = snap.infoRequests.filter((r) => r.engagementId === engagementId && !r.deleted);
  if (!rfi.length) return "Import the engagement's RFI first, so there's something to link to.";
  const steps = await linkCandidates(engagementId, scope);
  if (!steps.length) return scope === "unlinked" ? "Every open step is already linked. Use Re-check all to have the AI look at them again." : "Every open step has inputs you set by hand.";
  const settings = await getSettings();
  const links: AiLink[] = [];
  let error: string | undefined;
  let fallback: string | undefined;
  let done = 0;
  onProgress?.(0, steps.length);
  for (let i = 0; i < steps.length; i += BATCH) {
    const part = steps.slice(i, i + BATCH);
    try {
      const { text, model } = await geminiJsonResilient(auth, settings.geminiModel, linkPrompt({ engagement: e.name, kind: e.type, steps: part, rfi }));
      if (model !== settings.geminiModel) fallback = model;
      links.push(...parseLinkReply(text, part, rfi));
    } catch (err) {
      error = friendlyError(err);
      break;
    }
    done += part.length;
    onProgress?.(done, steps.length);
  }
  if (links.length)
    await act(`AI linked ${links.length} step${links.length === 1 ? "" : "s"} to the RFI`, async (ctx) => {
      const out = [];
      for (const l of links)
        out.push(await update(ctx, "planItems", l.stepId, { inputs: { rfiIds: l.rfiIds, extra: l.extra.map((name) => ({ name, received: false })), none: l.none || undefined, source: "ai" } }));
      return out;
    });
  else if (!error) error = "The AI didn't return any links. Try again.";
  return { linked: links.length, left: steps.length - done, error, fallback };
}
