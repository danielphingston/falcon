import { addWorkingDays } from "./dates";
import { update, type Ctx } from "./actions";
import type { InfoRequest, Settings } from "./schema";

/**
 * RFI chase cadence (build brief 4.2): the next chase is the request date (or
 * the last chase) plus 3 working days for High, 5 for Medium and 7 for Low
 * criticality. Blank or unknown criticality counts as Medium. Chase dates skip
 * Saturdays, Sundays and holidays, whatever the user's own working days are.
 */
export type Criticality = "high" | "medium" | "low";
export const CHASE_DAYS: Record<Criticality, number> = { high: 3, medium: 5, low: 7 };
const CLIENT_WEEK = [1, 2, 3, 4, 5];

/** The item's criticality, read from the RFI's own "Criticality" / "Priority" column. */
export function criticalityOf(item: Pick<InfoRequest, "fields">): Criticality {
  const f = item.fields?.find((x) => /critical|priority/i.test(x.label));
  const v = (f?.value ?? "").trim().toLowerCase();
  if (/^(h|high|critical|very high|p1|1)\b/.test(v)) return "high";
  if (/^(l|low|p3|3)\b/.test(v)) return "low";
  return "medium";
}

/** Someone at the client to chase: a contact in the app or a name from the RFI. */
export const hasContact = (item: Pick<InfoRequest, "requestedFromId" | "responsible">): boolean =>
  !!item.requestedFromId || !!item.responsible?.trim();

export const chaseOpen = (item: Pick<InfoRequest, "status" | "deleted">): boolean =>
  !item.deleted && (item.status === "pending" || item.status === "partial");

/** Next chase date: `from` (default: last chase, else the request date) plus the criticality's working days. */
export function nextChaseDate(
  item: Pick<InfoRequest, "fields" | "requestedOn" | "chaseLog">,
  settings: Pick<Settings, "holidays">,
  from?: string,
): string {
  const base = from ?? item.chaseLog?.at(-1) ?? item.requestedOn;
  return addWorkingDays(base, CHASE_DAYS[criticalityOf(item)], { workingDays: CLIENT_WEEK, holidays: settings.holidays });
}

/** Open items whose stored chase date differs from the cadence. */
export function chaseResets(items: InfoRequest[], settings: Pick<Settings, "holidays">, engagementId?: string) {
  return items
    .filter((r) => chaseOpen(r) && hasContact(r) && (!engagementId || r.engagementId === engagementId))
    .map((r) => ({ item: r, next: nextChaseDate(r, settings) }))
    .filter((x) => x.item.nextChaseOn !== x.next);
}

/** Sets every open item's chase date to the cadence (one undo batch). */
export async function resetChaseDates(ctx: Ctx, engagementId?: string) {
  const settings = await ctx.store.getSettings();
  const all = await ctx.store.list("infoRequests");
  const out = [];
  for (const { item, next } of chaseResets(all, settings, engagementId)) out.push(await update(ctx, "infoRequests", item.id, { nextChaseOn: next }));
  return out;
}
