/**
 * Maps trial-balance ledgers to areas. Tally's primary groups ("Sundry
 * Debtors", "Duties & Taxes", …) make most of this exact; ledger-name keywords
 * refine it (depreciation inside Indirect Expenses, income tax inside
 * Provisions, …) and cover TBs that have no group column.
 */
import type { AreaId } from "./types";

const n = (s: string | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Tally primary groups (and common equivalents) → area. Keys are normalised. */
const GROUPS: [RegExp, AreaId][] = [
  [/^(sundry debtors|trade receivables?|debtors|accounts receivables?|receivables)$/, "receivables"],
  [/^(sundry creditors|trade payables?|creditors|accounts payables?|payables)$/, "payables"],
  [/^(bank od a c|bank od|bank overdraft|bank od accounts|cash credit|cc accounts?)$/, "borrowings"],
  [/^(bank accounts?|banks?|balances with banks?)$/, "cash_bank"],
  [/^(cash in hand|cash)$/, "cash_bank"],
  [/^(stock in hand|closing stock|inventor(y|ies)|stock)$/, "inventory"],
  [/^(fixed assets|property plant and equipment|tangible assets)$/, "ppe"],
  [/^(intangible assets|capital work in progress|cwip)$/, "intangibles_cwip"],
  [/^(investments?|non current investments|current investments)$/, "investments"],
  [/^(loans and advances asset|loans and advances|deposits asset|deposits|security deposits)$/, "loans_advances"],
  [/^(current assets|other current assets|misc expenses asset|miscellaneous expenses asset)$/, "other_current_assets"],
  [/^(duties and taxes|statutory dues|statutory liabilities)$/, "statutory_dues"],
  [/^(provisions?|short term provisions|long term provisions)$/, "provisions"],
  [/^(current liabilities|other current liabilities|other liabilities)$/, "other_liabilities"],
  [/^(secured loans|unsecured loans|loans liability|loans|borrowings|long term borrowings|short term borrowings|term loans)$/, "borrowings"],
  [/^(capital account|share capital|capital|reserves and surplus|retained earnings|profit and loss a c|profit and loss account|profit and loss|other equity)$/, "equity_reserves"],
  [/^(sales accounts?|sales|revenue|revenue from operations|direct incomes?|income from operations)$/, "revenue"],
  [/^(indirect incomes?|other incomes?)$/, "other_income"],
  [/^(purchase accounts?|purchases?|direct expenses|cost of goods sold|cost of materials consumed|manufacturing expenses)$/, "cogs_purchases"],
  [/^(indirect expenses|administrative expenses|selling expenses|other expenses|selling and distribution expenses)$/, "other_expenses"],
  [/^(employee benefits? expenses?|salaries and wages|employee costs?)$/, "employee_costs"],
  [/^(finance costs?)$/, "finance_costs"],
  [/^(depreciation and amortisation|depreciation)$/, "depreciation"],
  [/^(suspense a c|suspense account|suspense|branch divisions)$/, "unmapped"],
];

/** Names that are Tally (or Schedule III) groups, used to read group headers out of a TB without a group column. */
export function isKnownGroup(name: string): boolean {
  const k = n(name);
  return GROUPS.some(([re]) => re.test(k));
}

export function areaForGroup(group: string | undefined): AreaId | undefined {
  const k = n(group);
  return k ? GROUPS.find(([re]) => re.test(k))?.[1] : undefined;
}

const has = (s: string, ...words: string[]) => words.some((w) => new RegExp(`(^| )${w}`).test(s));

/** Ledger keywords that win over the group (or decide when there is no group). */
function areaForLedger(ledger: string, groupArea: AreaId | undefined): AreaId | undefined {
  const l = n(ledger);
  const pl = !groupArea || ["other_expenses", "cogs_purchases", "employee_costs", "finance_costs", "depreciation", "tax", "unmapped"].includes(groupArea);

  // Tax sits in Provisions / Current Assets / Indirect Expenses in Tally.
  if (has(l, "income tax", "provision for tax", "provision for income tax", "advance tax", "tds receivable", "tcs receivable", "mat credit", "deferred tax", "current tax")) return "tax";
  if (pl && has(l, "depreciation", "amortisation", "amortization")) return "depreciation";
  if (groupArea === "ppe" && has(l, "software", "goodwill", "trademark", "trade mark", "patent", "copyright", "licen", "capital work", "cwip")) return "intangibles_cwip";
  if (pl && has(l, "salary", "salaries", "wages", "bonus", "staff welfare", "gratuity", "leave encashment", "esop", "director remuneration", "employer contribution", "contribution to pf", "contribution to esi", "incentive")) return "employee_costs";
  if (pl && has(l, "interest on", "interest paid", "interest expense", "bank interest", "loan processing", "finance charges")) return "finance_costs";

  if (groupArea) return undefined;

  // No group column: classify by ledger name alone.
  if (has(l, "debtor", "receivable", "amazon receivable", "flipkart receivable")) return "receivables";
  if (has(l, "creditor", "trade payable", "accounts payable")) return "payables";
  if (has(l, "gst", "igst", "cgst", "sgst", "tds payable", "tcs payable", "tds on", "provident fund", "pf payable", "esi", "professional tax")) return "statutory_dues";
  if (has(l, "od a c", "overdraft", "cash credit", "term loan", "loan from", "borrowing", "secured loan", "unsecured loan", "vehicle loan")) return "borrowings";
  if (has(l, "bank", "hdfc", "icici", "sbi", "axis", "kotak", "yes bank", "idfc", "indusind", "fixed deposit")) return "cash_bank";
  if (has(l, "cash")) return "cash_bank";
  if (has(l, "stock", "inventory", "raw material", "finished goods", "work in progress")) return "inventory";
  if (has(l, "share capital", "capital account", "reserve", "retained earnings", "securities premium", "profit and loss")) return "equity_reserves";
  if (has(l, "sales", "revenue", "income from operations", "service income", "export sales")) return "revenue";
  if (has(l, "interest income", "interest received", "dividend", "rent received", "other income", "discount received", "forex gain", "profit on sale")) return "other_income";
  if (has(l, "purchase", "freight inward", "carriage inward", "consumption", "packing material", "job work")) return "cogs_purchases";
  if (has(l, "provision")) return "provisions";
  if (has(l, "deposit", "advance to", "loan to", "prepaid")) return "loans_advances";
  if (has(l, "investment", "mutual fund", "shares of")) return "investments";
  if (has(l, "furniture", "computer", "plant and machinery", "machinery", "vehicle", "building", "office equipment", "land")) return "ppe";
  if (has(l, "expense", "expenses", "rent", "advertis", "marketing", "commission", "fees", "charges", "travel", "repairs", "insurance", "electricity", "telephone", "printing", "legal", "audit fee")) return "other_expenses";
  if (has(l, "suspense")) return "unmapped";
  return undefined;
}

export interface Classified {
  area: AreaId;
  /** How sure the mapping is: a known group or strong keyword is "high". */
  confidence: "high" | "low";
}

/**
 * Classifies one ledger. `groups` is the group path from the TB, outermost
 * first (e.g. ["Current Assets", "Sundry Debtors"]); the innermost known
 * group wins.
 */
export function classifyLedger(ledger: string, groups: string[] = []): Classified {
  const groupArea = [...groups].reverse().map(areaForGroup).find((a) => a !== undefined);
  const byLedger = areaForLedger(ledger, groupArea);
  if (byLedger) return { area: byLedger, confidence: "high" };
  if (groupArea) return { area: groupArea, confidence: groupArea === "unmapped" ? "low" : "high" };
  return { area: "unmapped", confidence: "low" };
}
