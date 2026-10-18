/**
 * Import a team allocation spreadsheet: an "Assignments" sheet (name, type,
 * status, team columns) and optionally a "Members" sheet (names, role).
 * Header rows are found by their labels, so title rows above them and extra
 * columns don't matter. Re-importing updates existing engagements instead of
 * duplicating them.
 */
import { create, newId, update, type Ctx, type Result } from "./actions";
import type { Engagement, Person } from "./schema";
import type { Snapshot } from "./store";

export interface SheetData {
  name: string;
  /** Cell text by row, then column (empty string for blank cells). */
  rows: string[][];
}

export interface AllocationAssignment {
  name: string;
  type?: string;
  status: Engagement["status"];
  /** Raw names from the team columns; the first is treated as the lead. */
  team: string[];
}

export interface AllocationMember {
  name: string;
  designation?: string;
}

export interface Allocation {
  assignments: AllocationAssignment[];
  members: AllocationMember[];
  /** A member marked "Team Lead" (probably the person using the app). */
  suggestedMe?: string;
}

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
/** Comparison key: case, spaces and punctuation don't matter ("Manish B Y" = "Manish BY"). */
export const nameKey = (s: string) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const firstToken = (s: string) => nameKey(clean(s).split(" ")[0] ?? "");

function findHeader(rows: string[][], test: (cells: string[]) => boolean) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cells = rows[r].map((c) => clean(c).toLowerCase());
    if (test(cells)) return { row: r, cells };
  }
  return null;
}

const isAssignmentHeader = (c: string) => /^(assign|engagement|client|project|job)/.test(c);

export function statusFromText(s: string): Engagement["status"] {
  const t = s.toLowerCase();
  if (/pause|hold|stalled|parked/.test(t)) return "on_hold";
  if (/complete|closed|done|finish|signed|issued/.test(t)) return "closed";
  return "active";
}

/** Reads assignments and members from spreadsheet sheets. Throws a readable error if the layout isn't recognised. */
export function parseTeamAllocation(sheets: SheetData[]): Allocation {
  const assignments: AllocationAssignment[] = [];
  const members: AllocationMember[] = [];

  for (const sheet of sheets) {
    // Assignments sheet: a header with an assignment/client column and team columns.
    const ah = findHeader(sheet.rows, (c) => c.some(isAssignmentHeader) && c.some((x) => /team|member|staff/.test(x)));
    if (ah) {
      const col = (re: RegExp) => ah.cells.findIndex((c) => re.test(c));
      const nameCol = ah.cells.findIndex(isAssignmentHeader);
      const typeCol = col(/^(type|nature|service|category)/);
      const statusCol = col(/^status/);
      const teamCols = ah.cells.map((c, i) => (/team|member|staff|lead|in.?charge/.test(c) ? i : -1)).filter((i) => i >= 0);
      for (const row of sheet.rows.slice(ah.row + 1)) {
        const name = clean(row[nameCol]);
        if (!name) continue;
        assignments.push({
          name,
          type: typeCol >= 0 ? clean(row[typeCol]) || undefined : undefined,
          status: statusCol >= 0 ? statusFromText(clean(row[statusCol])) : "active",
          team: teamCols.map((i) => clean(row[i])).filter(Boolean),
        });
      }
      continue;
    }
    // Members sheet: a header with a name column (and usually a type/role column).
    const mh = findHeader(sheet.rows, (c) => c.some((x) => /^(names?|member|employee|staff)$/.test(x)));
    if (mh) {
      const nameCol = mh.cells.findIndex((x) => /^(names?|member|employee|staff)$/.test(x));
      const roleCol = mh.cells.findIndex((x) => /^(type|role|designation|level|position)/.test(x));
      for (const row of sheet.rows.slice(mh.row + 1)) {
        const name = clean(row[nameCol]);
        if (name) members.push({ name, designation: roleCol >= 0 ? clean(row[roleCol]) || undefined : undefined });
      }
    }
  }

  if (!assignments.length)
    throw new Error("Couldn't find an assignments table. Expected a header row with an Assignment (or Client) column and Team columns.");
  const lead = members.find((m) => /lead|manager|partner|director/i.test(m.designation ?? ""));
  return { assignments, members, suggestedMe: lead?.name };
}

/**
 * Resolves a possibly short or differently-spaced name to one of `known`:
 * same key ("Dawn mathew" = "Dawn Mathew"), then a unique first-name match
 * ("Mayank" = "Mayank Dabriwala"), then a unique prefix ("Manish" = "Manish B Y").
 */
export function matchName<T extends { name: string }>(raw: string, known: T[]): T | undefined {
  const k = nameKey(raw);
  if (!k) return undefined;
  const exact = known.filter((x) => nameKey(x.name) === k);
  if (exact.length) return exact[0];
  const ft = firstToken(raw);
  if (ft.length >= 3 && clean(raw).split(" ").length === 1) {
    const byFirst = known.filter((x) => firstToken(x.name) === ft);
    if (byFirst.length === 1) return byFirst[0];
  }
  if (k.length >= 4) {
    const byPrefix = known.filter((x) => nameKey(x.name).startsWith(k) || k.startsWith(nameKey(x.name)));
    if (byPrefix.length === 1) return byPrefix[0];
  }
  return undefined;
}

export interface PlannedPerson {
  key: string;
  name: string;
  designation?: string;
  existingId?: string;
}

export interface PlannedEngagement {
  name: string;
  type?: string;
  status: Engagement["status"];
  /** Person key of the lead; undefined = me. */
  leadKey?: string;
  teamKeys: string[];
  existingId?: string;
  action: "create" | "update" | "unchanged";
  changes: string[];
}

export interface ImportPlan {
  me?: string;
  people: PlannedPerson[];
  engagements: PlannedEngagement[];
  warnings: string[];
}

/**
 * Works out what the import would do against the current data, without
 * changing anything. `me` is the name in the sheet that refers to the user.
 */
export function planTeamImport(alloc: Allocation, snap: Snapshot, me?: string): ImportPlan {
  const warnings: string[] = [];
  // Canonical people: the members sheet first (fuller names), then anyone only in team columns.
  const people: PlannedPerson[] = [];
  const meKey = me ? nameKey(me) : "";
  const isMe = (raw: string) => !!meKey && (nameKey(raw) === meKey || matchName(raw, [{ name: me! }]) !== undefined);

  // Each person is linked to an existing contact as soon as they're added.
  const add = (name: string, designation?: string) => {
    const p: PlannedPerson = { key: newId(), name, designation, existingId: matchName(name, snap.people)?.id };
    people.push(p);
    return p;
  };
  for (const m of alloc.members) {
    if (isMe(m.name) || matchName(m.name, people)) continue;
    add(m.name, m.designation);
  }
  const resolve = (raw: string): string | undefined => {
    if (isMe(raw)) return undefined;
    let p = matchName(raw, people);
    if (!p) {
      p = add(raw);
      if (alloc.members.length && !p.existingId) warnings.push(`"${raw}" is on an assignment but not in the members list. Added as a new team member.`);
    }
    return p.key;
  };

  const engagements: PlannedEngagement[] = [];
  for (const a of alloc.assignments) {
    const [leadRaw, ...rest] = a.team;
    const leadKey = leadRaw ? resolve(leadRaw) : undefined;
    const teamKeys = [...new Set(rest.map(resolve).filter((k): k is string => !!k && k !== leadKey))];
    const existing = matchName(a.name, snap.engagements);
    const plan: PlannedEngagement = { name: a.name, type: a.type, status: a.status, leadKey, teamKeys, existingId: existing?.id, action: "create", changes: [] };
    if (existing) {
      const idOf = (key?: string) => (key ? (people.find((p) => p.key === key)?.existingId ?? `new:${key}`) : undefined);
      const wantTeam = teamKeys.map(idOf).sort().join(",");
      const haveTeam = [...(existing.team ?? [])].sort().join(",");
      if ((a.type ?? "") !== (existing.type ?? "")) plan.changes.push("type");
      if (a.status !== existing.status) plan.changes.push("status");
      if (idOf(leadKey) !== existing.leadId) plan.changes.push("lead");
      if (wantTeam !== haveTeam) plan.changes.push("team");
      plan.action = plan.changes.length ? "update" : "unchanged";
    }
    engagements.push(plan);
  }

  const names = engagements.map((e) => nameKey(e.name));
  for (const [i, n] of names.entries()) if (names.indexOf(n) !== i) warnings.push(`"${engagements[i].name}" appears twice; both rows will be applied in order.`);
  return { me, people, engagements, warnings };
}

/** Applies a plan as one undoable batch. Only people who are actually on an engagement are created. */
export async function applyTeamImport(ctx: Ctx, plan: ImportPlan): Promise<Result<"people" | "engagements">[]> {
  const batch: Ctx = { ...ctx, batchId: ctx.batchId ?? newId() };
  const results: Result<"people" | "engagements">[] = [];
  const idByKey = new Map<string, string>();
  for (const p of plan.people) {
    if (p.existingId) {
      idByKey.set(p.key, p.existingId);
      const existing = await ctx.store.get("people", p.existingId);
      if (p.designation && existing && !existing.designation) results.push(await update(batch, "people", p.existingId, { designation: p.designation }));
      continue;
    }
    const r = await create(batch, "people", { name: p.name, role: "team", designation: p.designation });
    idByKey.set(p.key, r.record.id);
    results.push(r);
  }
  for (const e of plan.engagements) {
    if (e.action === "unchanged") continue;
    const fields = {
      type: e.type,
      status: e.status,
      leadId: e.leadKey ? idByKey.get(e.leadKey) : undefined,
      team: e.teamKeys.map((k) => idByKey.get(k)!).filter(Boolean),
    };
    if (e.existingId) results.push(await update(batch, "engagements", e.existingId, { ...fields, type: fields.type ?? null, leadId: fields.leadId ?? null }));
    else results.push(await create(batch, "engagements", { name: e.name, side: /due diligence|transaction/i.test(e.type ?? "") ? "buy" : "other", ...fields }));
  }
  return results;
}

/** People ids on an engagement (lead + team), tolerant of older records. */
export const engagementPeople = (e: Engagement) => [...(e.leadId ? [e.leadId] : []), ...(e.team ?? [])];

/** Live engagements a person is on, as lead or team member. */
export const engagementsFor = (person: Person, engagements: Engagement[]) =>
  engagements.filter((e) => e.status !== "closed" && engagementPeople(e).includes(person.id));
