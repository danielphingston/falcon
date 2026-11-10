/**
 * Numbers behind the work programme: area totals per period, a suggested
 * materiality, and trend checks such as "revenue grew 10%, so receivables
 * should grow about 8–12%", each with follow-ups when they flag.
 */
import { AREAS, type AreaId, type FollowUp } from "./types";

export interface TbLineLike {
  area: AreaId;
  balances: number[];
  excluded?: boolean;
}

export interface PeriodInfo {
  label: string;
  isOpening: boolean;
}

/** Net totals per area and period (debit positive). */
export function areaTotals(lines: TbLineLike[], periods: number): Map<AreaId, number[]> {
  const m = new Map<AreaId, number[]>();
  for (const l of lines) {
    if (l.excluded) continue;
    const t = m.get(l.area) ?? Array(periods).fill(0);
    l.balances.forEach((b, i) => (t[i] += b));
    m.set(l.area, t);
  }
  return m;
}

/** Natural-sign amount: assets/expenses as debit-positive, liabilities/equity/income as credit-positive. */
export function natural(area: AreaId, net: number): number {
  const side = AREAS[area].side;
  return side === "liability" || side === "equity" || side === "income" ? -net : net;
}

export interface Materiality {
  basis: string;
  base: number;
  overall: number;
  /** 75% of overall: areas below this get only core procedures. */
  performance: number;
}

const round2sf = (x: number) => {
  if (x <= 0) return 0;
  const p = 10 ** (Math.floor(Math.log10(x)) - 1);
  return Math.round(x / p) * p;
};

/** Suggests materiality: 1% of revenue, else 2% of total assets. */
export function suggestMateriality(totals: Map<AreaId, number[]>, current: number): Materiality {
  const v = (a: AreaId) => natural(a, totals.get(a)?.[current] ?? 0);
  const revenue = v("revenue");
  const assets = (Object.keys(AREAS) as AreaId[]).filter((a) => AREAS[a].side === "asset").reduce((s, a) => s + Math.max(0, v(a)), 0);
  const [basis, base, pct] = revenue > 0 ? ["1% of revenue", revenue, 0.01] : ["2% of total assets", assets, 0.02];
  const overall = round2sf(base * pct);
  return { basis: basis as string, base: base as number, overall, performance: round2sf(overall * 0.75) };
}

export interface Insight {
  id: string;
  area: AreaId;
  title: string;
  detail: string;
  status: "ok" | "flag";
  /** Extra checks when flagged. */
  followUps: FollowUp[];
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const growth = (cur: number, prev: number) => (prev === 0 ? undefined : (cur - prev) / Math.abs(prev));
const inr = (x: number) => Math.round(x).toLocaleString("en-IN");

/**
 * Trend checks between the current period and a comparative. P&L checks need a
 * real comparative period; balance-sheet-only checks also work against an
 * opening-balance column.
 */
export function trendInsights(totals: Map<AreaId, number[]>, current: number, prior: number | undefined, periods: PeriodInfo[]): Insight[] {
  const out: Insight[] = [];
  const v = (a: AreaId, i: number) => natural(a, totals.get(a)?.[i] ?? 0);
  const plComparable = prior !== undefined && !periods[prior]?.isOpening;
  const days = (bal: number, flow: number) => (flow > 0 ? (bal / flow) * 365 : undefined);
  /** Expected band around a driver's growth: ±max(2 points, 20% of the growth). */
  const band = (g: number) => {
    const w = Math.max(0.02, Math.abs(g) * 0.2);
    return [g - w, g + w] as const;
  };

  const linked = (
    id: string,
    area: AreaId,
    driver: AreaId,
    driverName: string,
    balName: string,
    daysName: string,
    flagUps: FollowUp[],
  ) => {
    if (!plComparable) return;
    const b0 = v(area, current);
    const b1 = v(area, prior!);
    const d0 = v(driver, current);
    const d1 = v(driver, prior!);
    const gB = growth(b0, b1);
    const gD = growth(d0, d1);
    if (gB === undefined || gD === undefined || b0 === 0) return;
    const [lo, hi] = band(gD);
    const inBand = gB >= lo && gB <= hi;
    const n0 = days(b0, d0);
    const n1 = days(b1, d1);
    const daysText = n0 !== undefined && n1 !== undefined ? ` ${daysName} moved from ${n1.toFixed(0)} to ${n0.toFixed(0)} days.` : "";
    out.push({
      id,
      area,
      title: inBand ? `${balName} moved in line with ${driverName}` : `${balName} ${gB > hi ? "grew faster" : "grew slower"} than ${driverName}`,
      detail: `${driverName} ${pct(gD)}, so ${balName.toLowerCase()} would be expected at ${pct(lo)} to ${pct(hi)}; actual ${pct(gB)} (${inr(b1)} → ${inr(b0)}).${daysText}`,
      status: inBand ? "ok" : "flag",
      followUps: inBand ? [] : flagUps,
    });
  };

  linked("ar-vs-revenue", "receivables", "revenue", "Revenue", "Receivables", "DSO", [
    { text: "Break the receivables movement down by top 10–20 customers / channels and compare each with that customer's sales growth.", why: "Shows whether the gap comes from a few parties (collection problems, disputes, related parties) or is broad-based." },
    { text: "Test sales booked in the last two weeks of the year and credit notes / returns raised after year-end.", why: "Receivables outpacing sales is a classic sign of year-end channel stuffing or cut-off errors." },
    { text: "Review ageing above 90/180 days and subsequent receipts; reassess the ECL / doubtful debts provision.", why: "Slower collection raises recoverability risk that the provision may not reflect." },
    { text: "For marketplace sales, reconcile receivables to settlement reports and check for unsettled or withheld amounts.", why: "Marketplace reserves, chargebacks and return deductions often sit unrecognised in receivables." },
  ]);
  linked("ap-vs-purchases", "payables", "cogs_purchases", "Purchases / COGS", "Payables", "DPO", [
    { text: "Analyse payables by top vendors and check overdue amounts, MSME vendors beyond 45 days and disputed balances.", why: "Stretched creditors can indicate liquidity stress and Sec 43B(h) / MSMED interest exposure." },
    { text: "Search for unrecorded liabilities: post year-end payments and invoices received after the year-end.", why: "Payables growing slower than purchases may mean liabilities are missing (completeness)." },
    { text: "Obtain balance confirmations for large and unusual vendor balances.", why: "Independent evidence of the year-end obligation." },
  ]);
  linked("inv-vs-cogs", "inventory", "cogs_purchases", "COGS", "Inventory", "Inventory days", [
    { text: "Analyse inventory ageing and identify slow-moving, non-moving and expired / obsolete items.", why: "Inventory building up faster than sales points to obsolescence and NRV write-down risk." },
    { text: "Compare cost with net realisable value using post year-end selling prices for a sample.", why: "Inventory must be at the lower of cost and NRV (Ind AS 2 / AS 2)." },
    { text: "Check physical verification results and book-to-physical differences, including stock at third-party warehouses.", why: "Confirms the inventory actually exists in the quantities recorded." },
  ]);

  if (plComparable) {
    // Gross margin
    const rev0 = v("revenue", current);
    const rev1 = v("revenue", prior!);
    const c0 = v("cogs_purchases", current);
    const c1 = v("cogs_purchases", prior!);
    if (rev0 > 0 && rev1 > 0 && (c0 || c1)) {
      const m0 = (rev0 - c0) / rev0;
      const m1 = (rev1 - c1) / rev1;
      const moved = Math.abs(m0 - m1) > 0.03;
      out.push({
        id: "gross-margin",
        area: "revenue",
        title: moved ? `Gross margin moved ${((m0 - m1) * 100).toFixed(1)} points` : "Gross margin is stable",
        detail: `Gross margin (revenue less purchases/COGS) ${(m1 * 100).toFixed(1)}% → ${(m0 * 100).toFixed(1)}%.`,
        status: moved ? "flag" : "ok",
        followUps: moved
          ? [
              { text: "Build a margin bridge by product / channel: price, mix, input cost and discount effects.", why: "Explains whether the change is commercial or an accounting issue." },
              { text: "Check closing stock valuation and cut-off of purchases around year-end.", why: "Margin swings are often caused by inventory or purchase cut-off errors." },
              { text: "Review discounts, returns and marketplace fees: netted against revenue or shown as expenses consistently?", why: "Classification changes alter gross margin without any change in economics." },
            ]
          : [],
      });
    }
    // Costs vs revenue
    for (const [area, name] of [
      ["employee_costs", "Employee costs"],
      ["other_expenses", "Other expenses"],
    ] as const) {
      const g = growth(v(area, current), v(area, prior!));
      const gr = growth(rev0, rev1);
      if (g === undefined || gr === undefined || !v(area, current)) continue;
      const off = Math.abs(g - gr) > 0.15;
      out.push({
        id: `${area}-vs-revenue`,
        area,
        title: off ? `${name} ${pct(g)} vs revenue ${pct(gr)}` : `${name} moved broadly with revenue`,
        detail: `${name} ${inr(v(area, prior!))} → ${inr(v(area, current))} (${pct(g)}); revenue ${pct(gr)}.`,
        status: off ? "flag" : "ok",
        followUps: off
          ? area === "employee_costs"
            ? [
                { text: "Reconcile payroll cost to headcount and average salary, month by month.", why: "Separates genuine hiring or increments from errors, ghost employees or misclassification." },
                { text: "Check one-off items: bonuses, ESOP charges, severance, director remuneration changes.", why: "One-offs distort the run-rate (key for QoE) and may need disclosure." },
              ]
            : [
                { text: "Analyse other expenses by ledger and investigate the largest movements with invoices and contracts.", why: "Large unexplained movements can hide misclassification, related-party payments or one-offs." },
                { text: "Check expenses booked in the following year that relate to this year (and vice versa).", why: "Cut-off errors in expenses directly affect profit." },
              ]
          : [],
      });
    }
  }

  // Implied interest rate (balance-sheet average vs finance cost).
  if (plComparable) {
    const fc = v("finance_costs", current);
    const avg = (v("borrowings", current) + v("borrowings", prior!)) / 2;
    if (fc > 0 && avg > 0) {
      const rate = fc / avg;
      const odd = rate < 0.05 || rate > 0.2;
      out.push({
        id: "interest-rate",
        area: "finance_costs",
        title: odd ? `Implied interest rate of ${(rate * 100).toFixed(1)}% looks unusual` : `Implied interest rate ${(rate * 100).toFixed(1)}%`,
        detail: `Finance costs ${inr(fc)} on average borrowings ${inr(avg)}.`,
        status: odd ? "flag" : "ok",
        followUps: odd
          ? [
              { text: "Recompute interest loan by loan from sanction letters and bank statements.", why: "An implied rate far from contracted rates suggests missing loans, missing interest or misclassified charges." },
              { text: "Check for interest capitalised under Ind AS 23 / AS 16 and for unrecorded interest on delayed statutory dues or MSME payables.", why: "Capitalisation or omitted interest changes both profit and borrowings." },
            ]
          : [],
      });
    }
  }

  // Balances that still need mapping.
  const unmapped = v("unmapped", current);
  if (Math.abs(unmapped) >= 1)
    out.push({
      id: "unmapped",
      area: "unmapped",
      title: "Some ledgers are unmapped or in suspense",
      detail: `Net ${inr(Math.abs(unmapped))} ${unmapped >= 0 ? "Dr" : "Cr"} is not assigned to an area.`,
      status: "flag",
      followUps: [
        { text: "Map each remaining ledger to the correct area, and obtain explanations for suspense balances.", why: "Unmapped balances escape the work programme entirely." },
        { text: "Check whether suspense balances have been cleared after year-end and what they related to.", why: "Suspense balances can hide unreconciled differences or errors." },
      ],
    });

  return out;
}
