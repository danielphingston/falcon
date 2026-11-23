/**
 * AI help for the Readiness page: asks Gemini which RFI items work plan steps
 * need (and what isn't on the RFI), and saves the links in one undoable batch.
 *
 * Mindful of tokens and Gemini's busy spells: by default only the steps the
 * offline matcher couldn't link are sent, in small batches of short text;
 * busy answers are retried on the chosen model (never a different one); if a batch
 * still fails, what finished is kept.
 */
import { engagementReadiness, geminiJson, linkPrompt, loadSnapshot, parseLinkReply, todayISO, type AiLink } from "@falcon/core";
import { getSettings, store } from "../db";
import { actTool } from "./act";
import { chatAuth, friendlyError } from "./chat";

const BATCH = 20;

export type LinkScope = "unlinked" | "all";

export interface LinkResult {
  linked: number;
  /** Steps not linked because a batch failed. */
  left: number;
  /** Set when something went wrong (the linked steps are still saved). */
  error?: string;
}

/** Steps Link with AI would send for this engagement. */
export async function linkCandidates(engagementId: string, scope: LinkScope) {
  const snap = await loadSnapshot(store);
  const e = snap.engagements.find((x) => x.id === engagementId);
  if (!e) return [];
  const r = engagementReadiness(e, snap.planItems, snap.infoRequests, todayISO());
  // Steps you set by hand are never sent, even if you cleared all their links.
  const pick = (scope === "unlinked" ? r.unlinked : r.steps).filter((s) => s.source !== "manual");
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
  let done = 0;
  onProgress?.(0, steps.length);
  for (let i = 0; i < steps.length; i += BATCH) {
    const part = steps.slice(i, i + BATCH);
    try {
      const text = await geminiJson(auth, settings.geminiModel, linkPrompt({ engagement: e.name, kind: e.type, steps: part, rfi }));
      links.push(...parseLinkReply(text, part, rfi));
    } catch (err) {
      error = friendlyError(err);
      break;
    }
    done += part.length;
    onProgress?.(done, steps.length);
  }
  let linked = 0;
  if (links.length) {
    // Saved through the shared tool (same rules as the chat and MCP: hand-set steps are never touched), as one undo.
    const res = (await actTool(
      (r) => {
        const n = (r as { saved: number }).saved;
        return `AI linked ${n} step${n === 1 ? "" : "s"} to the RFI`;
      },
      "set_step_inputs",
      { engagement: engagementId, steps: links.map((l) => ({ step: l.stepId, rfi: l.rfiIds, notOnRfi: l.extra, none: l.none })) },
    )) as { saved: number } | undefined;
    linked = res?.saved ?? 0;
  } else if (!error) error = "The AI didn't return any links. Try again.";
  return { linked, left: steps.length - done, error };
}
