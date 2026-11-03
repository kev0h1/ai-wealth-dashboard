// G412 design-only records. No customer data, API, bank action or engine changes.
export type AccountId = "corporate" | "ba" | "natwest" | "current" | "savings" | "offline";
export type PaymentMethod = "full" | "minimum" | "fixed" | "manual";
export type PaymentSettings = {
  closeDay: number | null;
  dueMode: "day" | "offset";
  dueDay: number | null;
  dueOffset: number | null;
  method: PaymentMethod;
  source: string;
  fixedAmount: string;
};
export type AccountFixture = {
  id: AccountId;
  bank: string;
  name: string;
  kind: "card" | "current" | "savings" | "offline";
  subtitle: string;
  balance: number;
  settings: PaymentSettings;
  apr: string;
  deals: { name: string; detail: string; amount?: number }[];
  unusedOffer?: string;
  statement?: { amount: number; start: string; close: string; due: string; dueBeforePayday: boolean; nextSpending: number; nextDue: string };
  connectedUntil?: string;
  updated?: string;
  counted?: boolean;
  lockedReason?: string;
};

export const PAYMENT_METHODS: { value: PaymentMethod; label: string; detail: string }[] = [
  { value: "full", label: "In full by Direct Debit", detail: "The full statement bill leaves the paying account." },
  { value: "minimum", label: "Minimum payment", detail: "The minimum shown on your card statement, not the whole balance." },
  { value: "fixed", label: "A fixed amount", detail: "Record the amount you have arranged with your card provider." },
  { value: "manual", label: "I pay it manually", detail: "These details do not set up a payment." },
];
export const PAYING_ACCOUNTS = ["Barclays · Everyday account", "NatWest · Bills account", "Paid from elsewhere", "Not set"];
export const FIXTURES: Record<AccountId, AccountFixture> = {
  corporate: {
    id: "corporate", bank: "American Express", name: "Amex Corporate Green", kind: "card", subtitle: "Business charge card", balance: -2357.26,
    settings: { closeDay: 28, dueMode: "day", dueDay: 12, dueOffset: null, method: "full", source: PAYING_ACCOUNTS[0], fixedAmount: "" },
    apr: "Not applicable to this charge card", deals: [],
    statement: { amount: 2280.33, start: "29 Sep", close: "28 Oct", due: "12 Nov", dueBeforePayday: true, nextSpending: 76.93, nextDue: "12 Dec" },
    connectedUntil: "21 November 2026", updated: "2 hours ago",
  },
  ba: {
    id: "ba", bank: "American Express", name: "British Airways Amex", kind: "card", subtitle: "Credit card", balance: -639.72,
    settings: { closeDay: 28, dueMode: "offset", dueDay: null, dueOffset: 15, method: "full", source: PAYING_ACCOUNTS[0], fixedAmount: "" },
    apr: "29.1", deals: [], unusedOffer: "No unused offers recorded",
    statement: { amount: 492.80, start: "29 Sep", close: "28 Oct", due: "12 Nov", dueBeforePayday: true, nextSpending: 146.92, nextDue: "13 Dec" },
    connectedUntil: "21 November 2026", updated: "2 hours ago",
  },
  natwest: {
    id: "natwest", bank: "NatWest", name: "NatWest Mastercard", kind: "card", subtitle: "Credit card", balance: -2400,
    settings: { closeDay: 28, dueMode: "offset", dueDay: null, dueOffset: 33, method: "fixed", source: PAYING_ACCOUNTS[1], fixedAmount: "100" },
    apr: "29.1", deals: [{ name: "0% balance transfer", detail: "Ends 31 May 2027", amount: 1600 }], unusedOffer: "0% balance transfer until 31 August 2027 · 3% fee",
    statement: { amount: 2300, start: "29 Sep", close: "28 Oct", due: "30 Nov", dueBeforePayday: false, nextSpending: 100, nextDue: "31 Dec" },
    connectedUntil: "21 November 2026", updated: "Yesterday at 16:20",
  },
  current: {
    id: "current", bank: "Monzo", name: "Everyday account", kind: "current", subtitle: "Current account", balance: 233.98,
    settings: { closeDay: null, dueMode: "day", dueDay: null, dueOffset: null, method: "manual", source: "Not set", fixedAmount: "" },
    apr: "", deals: [], connectedUntil: "21 November 2026", updated: "2 hours ago", counted: true,
    lockedReason: "Included while this account is short after plans.",
  },
  savings: {
    id: "savings", bank: "Chase", name: "Rainy day saver", kind: "savings", subtitle: "Savings account", balance: 900,
    settings: { closeDay: null, dueMode: "day", dueDay: null, dueOffset: null, method: "manual", source: "Not set", fixedAmount: "" },
    apr: "", deals: [], connectedUntil: "21 November 2026", updated: "2 hours ago", counted: false,
  },
  offline: {
    id: "offline", bank: "Offline", name: "Cash savings", kind: "offline", subtitle: "Offline account", balance: 1250,
    settings: { closeDay: null, dueMode: "day", dueDay: null, dueOffset: null, method: "manual", source: "Not set", fixedAmount: "" },
    apr: "", deals: [],
  },
};
export const ACCOUNT_IDS = Object.keys(FIXTURES) as AccountId[];
export const EXAMPLE_CONTEXT = "Illustrative snapshot: 3 November 2026. Next payday: 27 November. Dates and amounts are examples, not your bank data.";

export function money(value: number, hidden: boolean) {
  const sign = value < 0 ? "−" : "";
  return hidden ? `${sign}£••••` : `${sign}£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function ordinal(day: number) {
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
  return `${day}${suffix}`;
}
export function paymentLabel(settings: PaymentSettings) {
  return PAYMENT_METHODS.find(item => item.value === settings.method)!.label;
}
export function statementDatesPresent(settings: PaymentSettings) {
  return settings.closeDay !== null && (settings.dueMode === "day" ? settings.dueDay !== null : settings.dueOffset !== null);
}
export function dueLabel(settings: PaymentSettings) {
  if (!statementDatesPresent(settings)) return "Not set";
  return settings.dueMode === "day" ? `${ordinal(settings.dueDay!)} of the month` : `${settings.dueOffset} days after closing`;
}
