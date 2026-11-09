/** Evidence for the exact income events behind the server's two totals.
 * This describes provenance only; it never recomputes a cash forecast. */
export type IncomeEvidenceItem = {
  key: string;
  payer: string;
  amount: number;
  expected_date: string;
  account_id: string | null;
  account_name: string | null;
  account_bank: string | null;
  cadence: string | null;
  last_received: string | null;
  occurrences: number | null;
  confirmed: boolean;
  basis: string;
  transactions_href: string | null;
  transactions_scope: "sources" | "income_period" | "none";
};

export type IncomeEvidenceGroup = {
  total: number;
  status: "complete" | "unavailable";
  items: IncomeEvidenceItem[];
  transactions_href: string | null;
  transactions_scope: "sources" | "income_period" | "none";
};

export type IncomeForecastEvidence = {
  as_of: string;
  before_payday: IncomeEvidenceGroup;
  expected_pay: IncomeEvidenceGroup;
};

export const INCOME_EVIDENCE_HELP = "These are payments we expect to arrive before payday based on your history. If any are not really income, change their category.";

const SCOPES = new Set(["sources", "income_period", "none"]);
const date = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 500;
const nullableText = (value: unknown): value is string | null => value === null || (typeof value === "string" && value.length <= 500);
const scope = (value: unknown): value is IncomeEvidenceItem["transactions_scope"] => typeof value === "string" && SCOPES.has(value);
const pennies = (value: number) => Math.round(value * 100);
const safeHref = (href: unknown, transactionScope: IncomeEvidenceItem["transactions_scope"]) => transactionScope === "none" ? href === null : isSafeIncomeTransactionsHref(href, transactionScope);

/** Fail closed on stale or malformed provenance. A group may only explain a
 * supplied forecast scalar, never repair or reinterpret it on the client. */
export function isReconciledIncomeEvidence(group: unknown, scalar: unknown): group is IncomeEvidenceGroup {
  if (!group || typeof group !== "object" || typeof scalar !== "number" || !Number.isFinite(scalar) || scalar < 0) return false;
  const candidate = group as Partial<IncomeEvidenceGroup>;
  if (candidate.status !== "complete" || typeof candidate.total !== "number" || !Number.isFinite(candidate.total) || candidate.total < 0 || !Array.isArray(candidate.items) || !scope(candidate.transactions_scope) || !safeHref(candidate.transactions_href, candidate.transactions_scope)) return false;
  const valid = candidate.items.every(item => {
    if (!item || typeof item !== "object") return false;
    const row = item as Partial<IncomeEvidenceItem>;
    return text(row.key) && text(row.payer) && date(row.expected_date) && typeof row.amount === "number" && Number.isFinite(row.amount) && row.amount >= 0
      && nullableText(row.account_id) && nullableText(row.account_name) && nullableText(row.account_bank) && nullableText(row.cadence)
      && (row.last_received === null || date(row.last_received)) && (row.occurrences === null || (typeof row.occurrences === "number" && Number.isInteger(row.occurrences) && row.occurrences >= 0))
      && typeof row.confirmed === "boolean" && text(row.basis) && scope(row.transactions_scope) && safeHref(row.transactions_href, row.transactions_scope);
  });
  return valid && pennies(candidate.total) === pennies(scalar) && pennies(candidate.items.reduce((sum, item) => sum + item.amount, 0)) === pennies(candidate.total);
}

/** Transaction evidence can only leave the sheet for a local, bounded query.
 * The client deliberately rejects any stale external/over-broad URL. */
export function isSafeIncomeTransactionsHref(href: unknown, transactionScope: IncomeEvidenceItem["transactions_scope"]): href is string {
  if (typeof href !== "string" || href.length > 6000 || !href.startsWith("/transactions?")) return false;
  const url = new URL(href, "https://sorted.local");
  if (url.origin !== "https://sorted.local" || url.pathname !== "/transactions" || url.hash || url.search.length + url.pathname.length > 6000) return false;
  const query = url.searchParams;
  if (query.getAll("txn_type").length !== 1 || query.get("txn_type") !== "credit") return false;
  if (transactionScope === "sources") {
    const ids = query.getAll("transaction_id");
    return ids.length > 0 && ids.length <= 100 && ids.every(id => id.trim().length > 0 && Array.from(id).length <= 200 && !Array.from(id).some(char => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)))
      && query.getAll("label").length <= 1 && [...query.keys()].every(key => key === "transaction_id" || key === "txn_type" || key === "label");
  }
  if (transactionScope === "income_period") {
    return query.getAll("category").length === 1 && query.get("category") === "Income" && query.getAll("from").length === 1 && query.getAll("to").length === 1
      && date(query.get("from")) && date(query.get("to")) && query.get("from")! <= query.get("to")!
      && [...query.keys()].every(key => key === "category" || key === "txn_type" || key === "from" || key === "to");
  }
  return false;
}
