import { addDays, format, parseISO } from "date-fns";
import { addWorkingDays, toISODate } from "./dates";
import type { Engagement, Person, Settings } from "./schema";

export interface QuickAddDraft {
  kind: "task" | "followup" | "irl";
  text: string;
  due?: string;
  priority: "normal" | "high";
  personQuery?: string;
  person?: Person;
  engagementQuery?: string;
  engagement?: Engagement;
}

interface Ctx {
  today: string;
  people: Person[];
  engagements: Engagement[];
  settings: Pick<Settings, "workingDays" | "holidays">;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Parses a date word: today, tom, fri, +3 (working days), eow, 25/10, 2026-10-25. */
export function parseDateWord(word: string, ctx: Pick<Ctx, "today" | "settings">): string | undefined {
  const w = word.toLowerCase();
  const today = parseISO(ctx.today);
  if (w === "today" || w === "tod") return ctx.today;
  if (w === "tom" || w === "tmr" || w === "tomorrow") return toISODate(addDays(today, 1));
  if (w === "eow") return toISODate(addDays(today, (5 - today.getDay() + 7) % 7));
  const plus = /^\+(\d{1,3})$/.exec(w);
  if (plus) return addWorkingDays(ctx.today, Number(plus[1]), ctx.settings);
  const day = WEEKDAYS.findIndex((d) => w.startsWith(d) && w.length <= 9);
  if (day >= 0) return toISODate(addDays(today, (day - today.getDay() + 7) % 7));
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  const dm = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(w);
  if (dm) {
    const year = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : today.getFullYear();
    const d = new Date(year, Number(dm[2]) - 1, Number(dm[1]));
    if (d.getDate() !== Number(dm[1])) return undefined;
    // A day/month without a year that's already passed means next year.
    if (!dm[3] && toISODate(d) < ctx.today) d.setFullYear(year + 1);
    return format(d, "yyyy-MM-dd");
  }
  return undefined;
}

const norm = (s: string) => s.toLowerCase().replace(/[_\s]+/g, " ").trim();

function matchByName<T extends { name: string }>(items: T[], query: string): T | undefined {
  const q = norm(query);
  return (
    items.find((i) => norm(i.name) === q) ??
    items.find((i) => norm(i.name).split(" ").some((part) => part.startsWith(q))) ??
    items.find((i) => norm(i.name).includes(q))
  );
}

/**
 * Quick-add syntax:
 *   "Chase @Rahul TB FY24 #Falcon !fri"  → follow-up for Rahul on Falcon, due Friday
 *   "irl #Falcon Fixed asset register"   → IRL item
 *   "Draft NWC section #Falcon !+2 !!"   → high-priority task due in 2 working days
 * Use underscores for multi-word names: @Rahul_Mehta, #Project_Falcon.
 */
export function parseQuickAdd(input: string, ctx: Ctx): QuickAddDraft {
  const words: string[] = [];
  const draft: QuickAddDraft = { kind: "task", text: "", priority: "normal" };

  for (const token of input.trim().split(/\s+/).filter(Boolean)) {
    if (token === "!!" || token.toLowerCase() === "!high") {
      draft.priority = "high";
    } else if (token.startsWith("!") && token.length > 1) {
      const d = parseDateWord(token.slice(1), ctx);
      if (d) draft.due = d;
      else words.push(token);
    } else if (token.startsWith("@") && token.length > 1) {
      draft.personQuery = token.slice(1).replace(/_/g, " ");
    } else if (token.startsWith("#") && token.length > 1) {
      draft.engagementQuery = token.slice(1).replace(/_/g, " ");
    } else {
      words.push(token);
    }
  }

  const first = (words[0] ?? "").toLowerCase().replace(/:$/, "");
  if (first === "irl") {
    draft.kind = "irl";
    words.shift();
  } else if (["chase", "nudge", "fu", "follow", "followup", "remind"].includes(first)) {
    draft.kind = "followup";
    words.shift();
    if (first === "follow" && words[0]?.toLowerCase() === "up") words.shift();
    if (words[0]?.toLowerCase() === "on" || words[0]?.toLowerCase() === "for") words.shift();
  }

  draft.text = words.join(" ");
  if (draft.personQuery) draft.person = matchByName(ctx.people, draft.personQuery);
  if (draft.engagementQuery) {
    const live = ctx.engagements.filter((e) => e.status !== "closed");
    draft.engagement = matchByName(live, draft.engagementQuery) ?? matchByName(ctx.engagements, draft.engagementQuery);
  }
  return draft;
}
