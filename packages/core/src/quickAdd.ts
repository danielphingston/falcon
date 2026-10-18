import { addDays, format, parseISO } from "date-fns";
import { addWorkingDays, toISODate } from "./dates";
import type { Engagement, Person, Settings } from "./schema";

export interface QuickAddDraft {
  kind: "task" | "followup" | "irl";
  text: string;
  due?: string;
  /** HH:mm when a time was given ("at 3pm", "!15:00", "!fri@10:30"). */
  time?: string;
  priority: "normal" | "high";
  personQuery?: string;
  person?: Person;
  engagementQuery?: string;
  engagement?: Engagement;
}

interface Ctx {
  today: string;
  /** Current time, to put a bare "at 3pm" on today or tomorrow. */
  now?: Date;
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

/**
 * Parses a time word: 3pm, 3:30pm, 10am, 15:00, 9.30am. A bare number
 * without am/pm or a colon isn't a time (too ambiguous).
 */
export function parseTimeWord(word: string): string | undefined {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)?$/i.exec(word.trim());
  if (!m || (!m[2] && !m[3])) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return undefined;
  if (ap?.startsWith("p") && h < 12) h += 12;
  if (ap?.startsWith("a") && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
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

  const tokens = input.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "!!" || token.toLowerCase() === "!high") {
      draft.priority = "high";
    } else if (token.startsWith("!") && token.length > 1) {
      // !fri, !3pm, !fri@15:30
      const [datePart, timePart] = token.slice(1).split("@");
      const d = parseDateWord(datePart, ctx);
      const t = timePart ? parseTimeWord(timePart) : d ? undefined : parseTimeWord(datePart);
      if (d) draft.due = d;
      if (t) draft.time = t;
      if (!d && !t) words.push(token);
    } else if (token.toLowerCase() === "at" && tokens[i + 1] && parseTimeWord(tokens[i + 1])) {
      draft.time = parseTimeWord(tokens[++i]);
    } else if (/(am|pm)$/i.test(token) && parseTimeWord(token)) {
      draft.time = parseTimeWord(token);
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

  // A time with no date means the next time it comes round: today, or tomorrow if it's passed.
  if (draft.time && !draft.due) {
    const now = ctx.now ?? new Date();
    const passed = toISODate(now) === ctx.today && `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` >= draft.time;
    draft.due = passed ? toISODate(addDays(parseISO(ctx.today), 1)) : ctx.today;
  }
  draft.text = words.join(" ");
  if (draft.personQuery) draft.person = matchByName(ctx.people, draft.personQuery);
  if (draft.engagementQuery) {
    const live = ctx.engagements.filter((e) => e.status !== "closed");
    draft.engagement = matchByName(live, draft.engagementQuery) ?? matchByName(ctx.engagements, draft.engagementQuery);
  }
  return draft;
}
