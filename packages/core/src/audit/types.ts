/**
 * Shared vocabulary for the work-programme feature: account areas, audit
 * assertions, engagement kinds, industries, and the procedure library format.
 */

/** Where a trial-balance ledger belongs. Order is the order areas are shown in. */
export const AREAS = {
  // Balance sheet: assets (normal balance Dr)
  cash_bank: { label: "Cash & bank", side: "asset" },
  receivables: { label: "Trade receivables", side: "asset" },
  inventory: { label: "Inventory", side: "asset" },
  loans_advances: { label: "Loans, advances & deposits", side: "asset" },
  other_current_assets: { label: "Other current assets", side: "asset" },
  investments: { label: "Investments", side: "asset" },
  ppe: { label: "Property, plant & equipment", side: "asset" },
  intangibles_cwip: { label: "Intangibles & CWIP", side: "asset" },
  // Balance sheet: liabilities & equity (normal balance Cr)
  payables: { label: "Trade payables", side: "liability" },
  borrowings: { label: "Borrowings", side: "liability" },
  statutory_dues: { label: "Statutory dues (GST, TDS, PF…)", side: "liability" },
  provisions: { label: "Provisions", side: "liability" },
  other_liabilities: { label: "Other liabilities", side: "liability" },
  equity_reserves: { label: "Equity & reserves", side: "equity" },
  // Profit & loss
  revenue: { label: "Revenue from operations", side: "income" },
  other_income: { label: "Other income", side: "income" },
  cogs_purchases: { label: "Purchases & cost of goods sold", side: "expense" },
  employee_costs: { label: "Employee costs", side: "expense" },
  other_expenses: { label: "Other expenses", side: "expense" },
  depreciation: { label: "Depreciation & amortisation", side: "expense" },
  finance_costs: { label: "Finance costs", side: "expense" },
  tax: { label: "Income tax (current & deferred)", side: "expense" },
  // Not from the TB: always part of the programme
  general: { label: "General: planning, controls & completion", side: "none" },
  // Ledgers that need a decision
  unmapped: { label: "Unmapped / suspense", side: "none" },
} as const;

export type AreaId = keyof typeof AREAS;
export const AREA_IDS = Object.keys(AREAS) as AreaId[];

/** Financial statement assertions. */
export const ASSERTIONS = {
  existence: "Existence / occurrence",
  completeness: "Completeness",
  accuracy: "Accuracy",
  valuation: "Valuation & allocation",
  cutoff: "Cut-off",
  rights: "Rights & obligations",
  classification: "Classification",
  presentation: "Presentation & disclosure",
} as const;
export type Assertion = keyof typeof ASSERTIONS;

/** Engagement kinds the library is written for. */
export const ENGAGEMENT_KINDS = {
  audit: "Statutory audit",
  fdd: "Financial due diligence",
  ia: "Internal audit",
} as const;
export type EngagementKind = keyof typeof ENGAGEMENT_KINDS;

export const INDUSTRIES = {
  generic: "General",
  d2c: "D2C / e-commerce",
  manufacturing: "Manufacturing",
  services: "IT / services / SaaS",
  trading: "Trading / distribution",
} as const;
export type Industry = keyof typeof INDUSTRIES;

/** A suggested extra check, shown when a reviewer flags a procedure. */
export interface FollowUp {
  /** Imperative, specific: what to check next. */
  text: string;
  /** Why it matters: the risk it addresses, in one sentence. */
  why: string;
}

/** One procedure in the library. */
export interface Procedure {
  /** Stable, unique id, "<area>.<slug>", e.g. "receivables.marketplace-settlements". */
  id: string;
  area: AreaId;
  /** Imperative and specific, as a work-programme line. */
  text: string;
  /** One sentence: the risk or purpose. */
  why: string;
  assertions: Assertion[];
  /** Engagement kinds this applies to. */
  kinds: EngagementKind[];
  /** Only for these industries; omit for all industries. */
  industries?: Exclude<Industry, "generic">[];
  /** Keep even when the area is below performance materiality (key/analytical steps). */
  core?: boolean;
  /** Shown to the reviewer when this procedure is flagged: what more to check and why. */
  followUps: FollowUp[];
}

/** Exported from the package under this name (the app already has a FollowUp record type). */
export type ProcedureFollowUp = FollowUp;
