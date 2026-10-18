import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { Settings } from "./schema";

export const toISODate = (d: Date): string => format(d, "yyyy-MM-dd");
export const todayISO = (now: Date = new Date()): string => toISODate(now);
export const parseDate = (iso: string): Date => parseISO(iso);

export function isWorkingDay(iso: string, s: Pick<Settings, "workingDays" | "holidays">): boolean {
  const day = parseISO(iso).getDay();
  return s.workingDays.includes(day) && !s.holidays.includes(iso);
}

/** Moves forward `n` working days (n >= 0). n = 0 rolls a non-working day forward. */
export function addWorkingDays(
  iso: string,
  n: number,
  s: Pick<Settings, "workingDays" | "holidays">,
): string {
  if (s.workingDays.length === 0) return toISODate(addDays(parseISO(iso), n));
  let d = parseISO(iso);
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (isWorkingDay(toISODate(d), s)) left--;
  }
  while (!isWorkingDay(toISODate(d), s)) d = addDays(d, 1);
  return toISODate(d);
}

/** b - a in calendar days. */
export const daysBetween = (a: string, b: string): number =>
  differenceInCalendarDays(parseISO(b), parseISO(a));

export function relativeDay(iso: string, today: string): string {
  const diff = daysBetween(today, iso);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${-diff}d overdue`;
  if (diff < 7) return format(parseISO(iso), "EEE");
  return format(parseISO(iso), "d MMM");
}
