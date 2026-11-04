// G419 design round. Entirely fictional, local data; never a payment API.
export type Variant = "a" | "b";
export const CASES = [
  { id: "matched", label: "Matching rule" },
  { id: "new", label: "No details yet" },
  { id: "unmatched", label: "No matches" },
  { id: "broad", label: "Two card references" },
  { id: "history", label: "Short history" },
  { id: "checking", label: "Checking payments" },
  { id: "error", label: "Cannot check" },
  { id: "save-error", label: "Save failed" },
  { id: "charge", label: "Charge card" },
] as const;
export type Case = typeof CASES[number]["id"];
export type MatchMode = "description_equals" | "description_contains";
export type PaymentDraft = {
  closes: number | null;
  dueMode: "day" | "after";
  dueDay: number | null;
  daysAfter: string;
  method: "full" | "minimum" | "fixed" | "manual" | "";
  fixed: string;
  payer: string;
  ruleOn: boolean;
  matchMode: MatchMode;
  text: string;
};
export type Deal = { id: string; kind: "purchases" | "transfers" | "both"; until: string };
export type Offer = { id: string; until: string; fee: string; note: string };
export type RatesDraft = { apr: string; deals: Deal[]; offers: Offer[] };

export const TODAY = "2026-11-04";
export const HISTORY_FROM = "2026-05-04";
export const ACCOUNTS = [
  { id: "barclays", bank: "Barclays", name: "Current account" },
  { id: "natwest", bank: "NatWest", name: "Reward account" },
  { id: "hsbc", bank: "HSBC", name: "Joint bills" },
  { id: "monzo", bank: "Monzo", name: "Current account" },
  { id: "starling", bank: "Starling", name: "Personal account" },
  { id: "lloyds", bank: "Lloyds", name: "Club Lloyds" },
  { id: "revolut", bank: "Revolut", name: "Personal account" },
];
export type SamplePayment = { id: string; payer: string; description: string; date: string; pence: number; reference?: string };
export const PAYMENTS: SamplePayment[] = [
  { id: "amex-oct", payer: "barclays", description: "AMERICAN EXPRESS 41009", date: "2026-10-09", pence: -9980, reference: "41009" },
  { id: "amex-sep", payer: "barclays", description: "AMERICAN EXPRESS 41009", date: "2026-09-09", pence: -8124, reference: "41009" },
  { id: "amex-aug", payer: "barclays", description: "AMERICAN EXPRESS 41009", date: "2026-08-09", pence: -12040, reference: "41009" },
  { id: "amex-jul", payer: "barclays", description: "AMERICAN EXPRESS 41009", date: "2026-07-09", pence: -15819, reference: "41009" },
  { id: "second-oct", payer: "barclays", description: "AMERICAN EXPRESS 97531", date: "2026-10-09", pence: -4526, reference: "97531" },
  { id: "second-sep", payer: "barclays", description: "AMERICAN EXPRESS 97531", date: "2026-09-09", pence: -6850, reference: "97531" },
  { id: "second-aug", payer: "barclays", description: "AMERICAN EXPRESS 97531", date: "2026-08-09", pence: -2600, reference: "97531" },
  { id: "second-jul", payer: "barclays", description: "AMERICAN EXPRESS 97531", date: "2026-07-09", pence: -3100, reference: "97531" },
  { id: "rent", payer: "barclays", description: "RENT STANDING ORDER", date: "2026-11-01", pence: -85000 },
  { id: "phone", payer: "barclays", description: "GIFFGAFF", date: "2026-10-28", pence: -1200 },
  { id: "old", payer: "barclays", description: "AMERICAN EXPRESS 41009", date: "2026-05-03", pence: -6000, reference: "41009" },
  { id: "refund", payer: "barclays", description: "AMERICAN EXPRESS 41009", date: "2026-10-12", pence: 3000, reference: "41009" },
  { id: "natwest-water", payer: "natwest", description: "THAMES WATER", date: "2026-10-22", pence: -3600 },
];
export const METHODS = [
  { id: "full", label: "Paid in full", detail: "By Direct Debit" },
  { id: "minimum", label: "Minimum payment", detail: "From your statement" },
  { id: "fixed", label: "Fixed payment", detail: "The amount you arranged" },
  { id: "manual", label: "I pay manually", detail: "No automatic payment assumed" },
] as const;
export function paymentFor(state: Case): PaymentDraft {
  return {
    closes: state === "new" ? null : 9, dueMode: "day", dueDay: state === "new" ? null : 24,
    daysAfter: "15", method: state === "new" ? "" : "full", fixed: "100.00",
    payer: state === "new" ? "" : "barclays", ruleOn: state !== "new",
    matchMode: "description_contains", text: state === "unmatched" ? "51009" : state === "broad" ? "AMERICAN EXPRESS" : state === "new" ? "" : "41009",
  };
}
export function ratesFor(state: Case): RatesDraft {
  return { apr: state === "new" ? "" : "24.9", deals: state === "new" ? [] : [{ id: "deal-1", kind: "purchases", until: "2027-06" }], offers: state === "new" ? [] : [{ id: "offer-1", until: "2027-02", fee: "3", note: "Balance transfer offer" }] };
}
export function recentDebits(payer: string) {
  return PAYMENTS.filter(p => p.payer === payer && p.pence < 0 && p.date >= HISTORY_FROM && p.date <= TODAY).sort((a, b) => b.date.localeCompare(a.date));
}
// Illustrative preview calculation only. Production needs authoritative API
// evidence and an exact-description rule extension; see the G419 board note.
export function matchingPayments(draft: PaymentDraft) {
  if (!draft.ruleOn || draft.text.trim().length < 3) return [];
  const text = draft.text.trim().toLowerCase();
  return recentDebits(draft.payer).filter(p => draft.matchMode === "description_equals"
    ? p.description.trim().toLowerCase() === text : p.description.toLowerCase().includes(text));
}
export function ordinal(n: number) {
  const tens = n % 100;
  return `${n}${tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}
export function shortDate(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); }
export function money(pence: number) { return `${pence < 0 ? "−" : ""}£${(Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
export function payerName(id: string) { const a = ACCOUNTS.find(a => a.id === id); return a ? `${a.bank} · ${a.name}` : "No account recorded"; }
export function dueLabel(draft: PaymentDraft) { return draft.dueMode === "after" ? `${draft.daysAfter || "Not set"} days after closing` : draft.dueDay ? `${ordinal(draft.dueDay)} each month` : "Not set"; }
