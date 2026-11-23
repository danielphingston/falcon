/**
 * AI help for the Readiness page: asks Gemini which RFI items each open work
 * plan step needs (and what isn't on the RFI), and saves the links on the
 * steps in one undoable batch. Links the user set by hand are left alone.
 */
import { geminiJson, linkPrompt, loadSnapshot, parseLinkReply, update, type AiLink } from "@falcon/core";
import { getSettings, store } from "../db";
import { act } from "./act";
import { chatAuth, friendlyError } from "./chat";

const CHUNK = 60;

/** Returns an error sentence, or the number of steps linked. */
export async function linkWithAi(engagementId: string): Promise<string | number> {
  const auth = await chatAuth();
  if (typeof auth === "string") return auth;
  const snap = await loadSnapshot(store);
  const e = snap.engagements.find((x) => x.id === engagementId);
  if (!e) return "Engagement not found.";
  const rfi = snap.infoRequests.filter((r) => r.engagementId === engagementId && !r.deleted);
  if (!rfi.length) return "Import the engagement's RFI first, so there's something to link to.";
  const steps = snap.planItems
    .filter((i) => i.engagementId === engagementId && !i.deleted && i.applicable && i.status !== "closed" && i.inputs?.source !== "manual")
    .sort((a, b) => a.order - b.order);
  if (!steps.length) return "Every open step already has inputs you set by hand.";
  const settings = await getSettings();
  const links: AiLink[] = [];
  try {
    for (let i = 0; i < steps.length; i += CHUNK) {
      const part = steps.slice(i, i + CHUNK);
      const reply = await geminiJson(auth, settings.geminiModel, linkPrompt({ engagement: e.name, kind: e.type, steps: part, rfi }));
      links.push(...parseLinkReply(reply, part, rfi));
    }
  } catch (err) {
    return friendlyError(err);
  }
  if (!links.length) return "The AI didn't return any links. Try again.";
  await act(`AI linked ${links.length} step${links.length === 1 ? "" : "s"} to the RFI`, async (ctx) => {
    const out = [];
    for (const l of links)
      out.push(await update(ctx, "planItems", l.stepId, { inputs: { rfiIds: l.rfiIds, extra: l.extra.map((name) => ({ name, received: false })), none: l.none || undefined, source: "ai" } }));
    return out;
  });
  return links.length;
}
