/**
 * People as records: turns the names typed in a plan or sheet ("JK",
 * "Shahid/Sai Teja", "Team", "Dawn") into people, using each person's
 * aliases. Resolved when read, so mapping a name once (an alias) applies
 * everywhere at once, with nothing to migrate.
 */
import type { Person, Settings } from "./schema";
import { nameKey } from "./teamImport";
import { isMe } from "./workplan";

/** Stands for the app's user in resolved owner lists. */
export const ME = "me";

/** Names that mean a group, not one person. */
export const DEFAULT_GROUPS = ["Team", "All", "Everyone", "TBD", "NA", "N/A", "-", "Client"];

export interface PeopleIndex {
  people: Person[];
  myName: string;
  myAliases: string[];
  groups: Set<string>;
}

export function peopleIndex(people: Person[], settings: Pick<Settings, "myName"> & Partial<Pick<Settings, "myAliases" | "groupNames">>): PeopleIndex {
  return {
    people: people.filter((p) => !p.deleted),
    myName: settings.myName,
    myAliases: settings.myAliases ?? [],
    groups: new Set([...DEFAULT_GROUPS, ...(settings.groupNames ?? [])].map(nameKey)),
  };
}

export type NameMatch =
  | { raw: string; kind: "me" }
  | { raw: string; kind: "person"; person: Person }
  | { raw: string; kind: "group" }
  | { raw: string; kind: "unknown" }
  | { raw: string; kind: "ambiguous"; candidates: Person[] };

/** "Shahid/Sai Teja", "Nikhil & Shahid", "A, B and C" → separate names. */
export function splitNames(cell: string | undefined): string[] {
  if (!cell) return [];
  return cell
    .split(/\s*(?:[/,&+;\n]|\band\b)\s*/i)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const tokens = (name: string) => name.split(/\s+/).map(nameKey).filter(Boolean);

/**
 * One name → me, a person, a group, or unknown / ambiguous (ask the user).
 * Client contacts are only matched when `clients` is set, and team members
 * then never are, so "Sagar" at the client is never a team member.
 */
export function matchOne(raw: string, ix: PeopleIndex, opts: { clients?: boolean } = {}): NameMatch {
  const k = nameKey(raw);
  if (!k) return { raw, kind: "unknown" };
  if (ix.groups.has(k)) return { raw, kind: "group" };
  if (!opts.clients) {
    if (k === "me" || k === "myself" || ix.myAliases.some((a) => nameKey(a) === k)) return { raw, kind: "me" };
    if (ix.myName && ix.myName !== "Me" && (nameKey(ix.myName) === k || isMe(raw, ix.myName))) return { raw, kind: "me" };
  }
  const pool = ix.people.filter((p) => (opts.clients ? p.role === "client" : p.role !== "client"));
  const pick = (hits: Person[]): NameMatch | undefined => (hits.length === 1 ? { raw, kind: "person", person: hits[0] } : hits.length > 1 ? { raw, kind: "ambiguous", candidates: hits } : undefined);
  return (
    pick(pool.filter((p) => (p.aliases ?? []).some((a) => nameKey(a) === k))) ??
    pick(pool.filter((p) => nameKey(p.name) === k)) ??
    // "Dawn" → "Dawn Mathew"; "Majeed" → "KhayamKhani MajeedKhan"; "SaiTeja" → "Sai Teja".
    pick(pool.filter((p) => tokens(p.name).some((t) => t === k || (k.length >= 4 && t.startsWith(k))))) ??
    // Initials: "DM" → "Dawn Mathew".
    pick(k.length >= 2 && k.length <= 4 ? pool.filter((p) => tokens(p.name).map((t) => t[0]).join("") === k) : []) ?? { raw, kind: "unknown" }
  );
}

/** Every name in a cell, resolved. */
export function resolveCell(cell: string | undefined, ix: PeopleIndex, opts: { clients?: boolean } = {}): NameMatch[] {
  return splitNames(cell).map((n) => matchOne(n, ix, opts));
}

/** Ids of the people (or ME) a cell names; groups and unknown names are left out. */
export function cellIds(cell: string | undefined, ix: PeopleIndex): string[] {
  return [...new Set(resolveCell(cell, ix).flatMap((m) => (m.kind === "me" ? [ME] : m.kind === "person" ? [m.person.id] : [])))];
}

/** True when a cell names this person (or ME), by name, initials or alias. */
export function cellHas(cell: string | undefined, id: string, ix: PeopleIndex): boolean {
  return cellIds(cell, ix).includes(id);
}

/** True when a cell names nobody in particular ("Team", blank). */
export function cellUnassigned(cell: string | undefined, ix: PeopleIndex): boolean {
  const all = resolveCell(cell, ix);
  return !all.length || all.every((m) => m.kind === "group");
}

/** Names in these cells that couldn't be matched, most-used first: for asking the user once. */
export function unmatchedNames(cells: (string | undefined)[], ix: PeopleIndex): { raw: string; count: number; kind: "unknown" | "ambiguous"; candidates: Person[] }[] {
  const out = new Map<string, { raw: string; count: number; kind: "unknown" | "ambiguous"; candidates: Person[] }>();
  for (const cell of cells)
    for (const m of resolveCell(cell, ix)) {
      if (m.kind !== "unknown" && m.kind !== "ambiguous") continue;
      const k = nameKey(m.raw);
      const prev = out.get(k);
      if (prev) prev.count++;
      else out.set(k, { raw: m.raw, count: 1, kind: m.kind, candidates: m.kind === "ambiguous" ? m.candidates : [] });
    }
  return [...out.values()].sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));
}
