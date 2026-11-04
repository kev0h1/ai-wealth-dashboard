/** Public-safe, invented examples. Pence throughout; no API or saved data. */
export type PreviewEvent = { id: string; name: string; date: string; pence: number; suggested?: boolean };
export type PreviewPlan = { name: string; pence: number };
export type PreviewAccount = {
  id: string; bank: string; name: string; opening: number | null;
  available: number | null; signal: "watch" | "risk" | "unknown" | null;
  reading: "source" | "covered" | "plans" | "risk" | "fine" | "unknown";
  events: PreviewEvent[]; plans: PreviewPlan[];
};
export const PERIOD_LABEL = "Payments through Thu 19 Nov";
export const SCENARIOS = [
  { id: "mixed", label: "Suggested move and plans" },
  { id: "risk", label: "Payment shortfall" },
  { id: "clear", label: "All accounts fine" },
  { id: "unknown", label: "Balance unavailable" },
  { id: "pennies", label: "6p available" },
] as const;
export type ScenarioId = (typeof SCENARIOS)[number]["id"];
const BASE: PreviewAccount[] = [
  { id: "barclays", bank: "Barclays", name: "Current account", opening: 125050, available: 42503, signal: "watch", reading: "source",
    plans: [{ name: "Weekend away", pence: 2226 }], events: [
      { id: "move-out", name: "Move to NatWest", date: "2026-11-05", pence: -27500, suggested: true },
      { id: "broadband", name: "Broadband", date: "2026-11-06", pence: -3599 },
      { id: "council", name: "Council tax", date: "2026-11-09", pence: -16822 },
      { id: "car", name: "Car payment", date: "2026-11-10", pence: -32400 },
    ] },
  { id: "natwest", bank: "NatWest", name: "Bills account", opening: 4000, available: 0, signal: "watch", reading: "covered", plans: [], events: [
    { id: "move-in", name: "Move from Barclays", date: "2026-11-05", pence: 27500, suggested: true },
    { id: "energy", name: "Energy", date: "2026-11-06", pence: -15000 },
    { id: "insurance", name: "Insurance", date: "2026-11-12", pence: -16500 },
  ] },
  { id: "monzo", bank: "Monzo", name: "Personal current account", opening: 15025, available: 0, signal: "watch", reading: "plans",
    plans: [{ name: "Travel", pence: 10025 }, { name: "Emergency fund", pence: 7525 }],
    events: [{ id: "mobile", name: "Mobile phone", date: "2026-11-08", pence: -5000 }] },
  { id: "hsbc", bank: "HSBC", name: "Everyday account", opening: 21565, available: 4040, signal: null, reading: "fine", plans: [],
    events: [{ id: "household", name: "Household payment", date: "2026-11-11", pence: -10000 }] },
  { id: "starling", bank: "Starling", name: "Joint account", opening: 5000, available: 3203, signal: null, reading: "fine", plans: [],
    events: [{ id: "subscription", name: "Subscription", date: "2026-11-13", pence: -1797 }] },
];
export function previewAccounts(scenario: ScenarioId): PreviewAccount[] {
  const accounts = structuredClone(BASE);
  if (scenario === "mixed") return accounts;
  if (scenario === "unknown") return [{ ...accounts[1], opening: null, available: null, signal: "unknown", reading: "unknown", events: accounts[1].events.filter(e => !e.suggested) }, ...accounts.slice(3)];
  if (scenario === "pennies") return [{ id: "monzo", bank: "Monzo", name: "Personal current account", opening: 10006, available: 6, signal: null, reading: "fine", plans: [], events: [{ id: "bill", name: "Monthly payment", date: "2026-11-06", pence: -10000 }] }];
  // Remove both sides together. A suggestion is never a scheduled transfer.
  accounts[0] = { ...accounts[0], available: scenario === "risk" ? 42503 : 70003, signal: null, reading: "fine", events: accounts[0].events.filter(e => !e.suggested) };
  accounts[1] = { ...accounts[1], signal: "risk", reading: "risk", events: accounts[1].events.filter(e => !e.suggested) };
  if (scenario === "risk") return accounts;
  return [accounts[0], { ...accounts[3], available: 11565 }, accounts[4]];
}
export function afterPayments(account: PreviewAccount): number | null {
  return account.opening === null ? null : account.opening + account.events.filter(e => !e.suggested).reduce((sum, e) => sum + e.pence, 0);
}
export function afterPlans(account: PreviewAccount): number | null {
  const payments = afterPayments(account);
  return payments === null ? null : payments - account.plans.reduce((sum, p) => sum + p.pence, 0);
}
export function afterSuggestedMoves(account: PreviewAccount): number | null {
  const plans = afterPlans(account);
  return plans === null ? null : plans + account.events.filter(e => e.suggested).reduce((sum, e) => sum + e.pence, 0);
}
export function formatPence(pence: number, exact = false, plus = false): string {
  const pennies = exact || (Math.abs(pence) > 0 && Math.abs(pence) < 100);
  return `${pence < 0 ? "−" : plus && pence > 0 ? "+" : ""}£${(Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: pennies ? 2 : 0, maximumFractionDigits: pennies ? 2 : 0 })}`;
}
export function dateText(date: string) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
