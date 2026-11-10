/** Fictional G453 evidence. Nothing in this module calls a live service. */
export type Scope = "one" | "history" | "history-future";
export type Resolution = "account" | "card" | "savings" | "investment" | "goal" | "offline" | "spending";
export type Scenario = "start" | "savings" | "protected" | "empty" | "count-error" | "save-error" | "refresh-error" | "hidden" | "long" | "older";

export interface Payment {
  id: string;
  user: string;
  payeeKey: string;
  payee: string;
  date: string;
  direction: "debit" | "credit";
  currency: string;
  amount: number;
  customCategory: string | null;
  pending?: boolean;
}

export interface ScopeOption {
  value: Scope;
  label: string;
  description: string;
  count: number | null;
  disabled: boolean;
}

export interface ScopePanelProps {
  options: ScopeOption[];
  scope: Scope;
  onChange: (scope: Scope) => void;
  category: string;
  protectedCount: number;
  disabled?: boolean;
}

export const RESOLUTIONS: { value: Resolution; label: string; category: string; detail: string }[] = [
  { value: "account", label: "Another of my accounts", category: "Transfer", detail: "Money moved between your own accounts." },
  { value: "card", label: "Paying off a card", category: "Debt", detail: "A card repayment, rather than a new purchase." },
  { value: "savings", label: "Savings", category: "Savings", detail: "Money you put aside for later." },
  { value: "investment", label: "Investments", category: "Investment", detail: "Money sent to an investment." },
  { value: "goal", label: "A goal", category: "Savings", detail: "Money put towards one of your goals." },
  { value: "offline", label: "An account Sorted cannot see", category: "Transfer", detail: "Money moved to an account you have not connected." },
  { value: "spending", label: "Spending", category: "Groceries", detail: "Choose a category for this payment." },
];

export function fixturePayments(scenario: Scenario): Payment[] {
  const payee = scenario === "long" ? "Saving Challenge (2026), a very long payment reference from your everyday current account" : "Saving Challenge (2026)";
  const anchorDay = scenario === "older" ? 8 : 10;
  const base: Payment = { id: "current", user: "preview-owner", payeeKey: "saving-challenge", payee, date: `2026-11-${anchorDay === 8 ? "08" : "10"}`, direction: "debit", currency: "GBP", amount: scenario === "older" ? 11.84 : 11.92, customCategory: null };
  const earlier = Array.from({ length: scenario === "empty" ? 0 : 23 }, (_, index) => ({ ...base, id: `earlier-${index}`, date: new Date(Date.UTC(2026, 10, anchorDay - 1 - index)).toISOString().slice(0, 10), amount: Number((base.amount - (index + 1) * .04).toFixed(2)), customCategory: scenario === "protected" ? "Savings" : null }));
  const protectedRows = Array.from({ length: 3 }, (_, index) => ({ ...base, id: `protected-${index}`, date: `2026-09-${String(10 + index).padStart(2, "0")}`, customCategory: ["Savings", "Other", "Investment"][index] }));
  const unrelated = [
    { ...base, id: "other-user", user: "another-preview-owner" },
    { ...base, id: "other-payee", payeeKey: "different-payee", payee: "Another shop" },
    { ...base, id: "incoming", direction: "credit" as const },
    { ...base, id: "other-currency", currency: "USD" },
    { ...base, id: "pending", pending: true },
  ];
  const later = scenario === "older" ? [{ ...base, id: "later-1", date: "2026-11-09", amount: 11.88 }, { ...base, id: "later-2", date: "2026-11-10", amount: 11.92 }] : [];
  return [base, ...earlier, ...protectedRows, ...unrelated, ...later];
}

function matches(row: Payment, anchor: Payment): boolean {
  return !row.pending && row.user === anchor.user && row.payeeKey === anchor.payeeKey && row.direction === anchor.direction && row.currency === anchor.currency;
}

export function scopePayments(rows: Payment[], scope: Scope): Payment[] {
  const anchor = rows.find(row => row.id === "current")!;
  return rows.filter(row => matches(row, anchor) && row.customCategory === null && (scope === "one" ? row.id === anchor.id : scope === "history" ? row.date <= anchor.date : true));
}

export function protectedPayments(rows: Payment[]): Payment[] {
  const anchor = rows.find(row => row.id === "current")!;
  return rows.filter(row => matches(row, anchor) && row.customCategory !== null);
}

export function scopeOptions(rows: Payment[], countsReady: boolean): ScopeOption[] {
  const history = scopePayments(rows, "history").length;
  const all = scopePayments(rows, "history-future").length;
  const earlier = Math.max(0, history - scopePayments(rows, "one").length);
  return [
    { value: "one", label: "This payment only", description: "No other payments or future rule change.", count: scopePayments(rows, "one").length, disabled: false },
    { value: "history", label: "This and earlier payments like it", description: countsReady ? `${earlier} earlier ${earlier === 1 ? "payment" : "payments"} to this payee. No future rule.` : "Check earlier payments before choosing this.", count: countsReady ? history : null, disabled: !countsReady || earlier === 0 },
    { value: "history-future", label: "Earlier and future payments", description: countsReady ? `${all} matching ${all === 1 ? "payment" : "payments"} now, plus a rule for new ones.` : "Check matching payments before choosing this.", count: countsReady ? all : null, disabled: !countsReady },
  ];
}

export function applyScope(rows: Payment[], scope: Scope, category: string): { rows: Payment[]; changed: number } {
  const ids = new Set(scopePayments(rows, scope).map(row => row.id));
  return { rows: rows.map(row => ids.has(row.id) ? { ...row, customCategory: category } : row), changed: ids.size };
}
