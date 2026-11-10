import { describe, expect, it } from "vitest";
import { AREA_IDS, ASSERTIONS, procedureLibrary, proceduresFor, type AreaId, type EngagementKind } from "../src";

describe("procedure library", () => {
  it("has unique ids that match their area", () => {
    const ids = procedureLibrary.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of procedureLibrary) expect(p.id.startsWith(`${p.area}.`), p.id).toBe(true);
  });

  it("uses only known areas and assertions, and every step has follow-ups", () => {
    for (const p of procedureLibrary) {
      expect(AREA_IDS, p.id).toContain(p.area);
      for (const a of p.assertions) expect(Object.keys(ASSERTIONS), `${p.id}: ${a}`).toContain(a);
      expect(p.followUps.length, p.id).toBeGreaterThanOrEqual(2);
      expect(p.text.length, p.id).toBeGreaterThan(15);
      expect(p.why.length, p.id).toBeGreaterThan(10);
    }
  });

  it("covers every TB area for every engagement kind, including key steps", () => {
    const areas = AREA_IDS.filter((a) => a !== "unmapped") as AreaId[];
    for (const area of areas)
      for (const kind of ["audit", "fdd", "ia"] as EngagementKind[]) {
        expect(proceduresFor(procedureLibrary, area, kind, "generic", "full").length, `${area}/${kind}`).toBeGreaterThan(0);
        if (kind === "audit") expect(proceduresFor(procedureLibrary, area, kind, "generic", "limited").length, `${area} core`).toBeGreaterThan(0);
      }
  });

  it("tailors receivables for a D2C audit (the marketplace reconciliation)", () => {
    const d2c = proceduresFor(procedureLibrary, "receivables", "audit", "d2c", "full");
    const generic = proceduresFor(procedureLibrary, "receivables", "audit", "generic", "full");
    expect(d2c.length).toBeGreaterThan(generic.length);
    expect(d2c.some((p) => /settlement/i.test(p.text))).toBe(true);
  });
});
