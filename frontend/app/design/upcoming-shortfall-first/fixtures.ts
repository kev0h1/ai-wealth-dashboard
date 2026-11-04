/** G417 design examples only. All arithmetic stays in integer pence. */
export type Event = { id: string; name: string; date: string; pence: number; kind: "payment" | "income" };
export type Plan = { id: string; name: string; pence: number; note: string };
export type Move = { id: string; accountId: string; bank: string; pence: number; by: string | null };
export type Account = { id: string; bank: string; name: string; opening: number | null; events: Event[]; plans: Plan[]; moves: Move[] };
export type Status = "ready" | "loading" | "error";
export const PERIOD = "Payments through Sun 29 Nov";
export const SCENARIOS = [
  { id: "mixed", label: "Gaps and suggested move" },
  { id: "partial", label: "Move leaves a gap" },
  { id: "early", label: "Short before income arrives" },
  { id: "clear", label: "All accounts covered" },
  { id: "pennies", label: "A 49p shortfall" },
  { id: "unknown", label: "Missing balance" },
  { id: "loading", label: "Checking plans" },
  { id: "error", label: "Plans check failed" },
  { id: "empty", label: "No paying accounts" },
] as const;
export type Scenario = typeof SCENARIOS[number]["id"];
const payment = (id: string, name: string, pence: number, date: string): Event => ({ id, name, pence: -pence, date, kind: "payment" });
const base: Account[] = [
  { id: "natwest", bank: "NatWest", name: "Bills account", opening: 4000, events: [payment("energy", "Energy", 12000, "2026-11-06"), payment("council", "Council tax", 17900, "2026-11-09")], plans: [], moves: [{ id: "cover-in", accountId: "barclays", bank: "Barclays", pence: 27000, by: "2026-11-06" }] },
  { id: "barclays", bank: "Barclays", name: "Current account", opening: 113247, events: [payment("broadband", "Broadband", 3599, "2026-11-06"), payment("car", "Car payment", 32400, "2026-11-10"), payment("insurance", "Insurance", 16822, "2026-11-12")], plans: [{ id: "holiday", name: "Summer holiday", pence: 2226, note: "Still to set aside this period" }], moves: [{ id: "cover-out", accountId: "natwest", bank: "NatWest", pence: -27000, by: "2026-11-06" }] },
  { id: "hsbc", bank: "HSBC", name: "Household account", opening: 8000, events: [payment("water", "Water", 12500, "2026-11-07")], plans: [], moves: [] },
  { id: "monzo", bank: "Monzo", name: "Everyday account", opening: 9825, events: [payment("phone", "Phone", 7825, "2026-11-08")], plans: [{ id: "christmas", name: "Christmas", pence: 6649, note: "Still to set aside this period" }], moves: [] },
  { id: "starling", bank: "Starling", name: "Joint account", opening: 5000, events: [payment("internet", "Internet", 1797, "2026-11-14")], plans: [], moves: [] },
  { id: "chase", bank: "Chase", name: "Current account", opening: 21565, events: [payment("membership", "Membership", 10000, "2026-11-16")], plans: [], moves: [] },
];

export function fixtureFor(scenario: Scenario): { accounts: Account[]; status: Status } {
  let accounts = structuredClone(base);
  if (scenario === "empty") accounts = [];
  if (scenario === "clear") accounts = accounts.map(account => ({ ...account, opening: (account.opening ?? 0) + 50000, moves: [] }));
  if (scenario === "partial") accounts = accounts.map(account => ({ ...account, moves: account.moves.map(move => ({ ...move, pence: Math.sign(move.pence) * 15000 })) }));
  if (scenario === "pennies") accounts = [{ ...accounts[0], opening: 29851, moves: [] }, ...accounts.slice(4)];
  if (scenario === "unknown") accounts = [{ ...accounts[0], opening: null, moves: [] }, ...accounts.slice(4)];
  if (scenario === "early") accounts = [{ ...accounts[2], opening: 6100, events: [payment("water", "Water", 12500, "2026-11-07"), { id: "income", name: "Confirmed income", pence: 15400, date: "2026-11-20", kind: "income" }], plans: [], moves: [] }, ...accounts.slice(4)];
  return { accounts, status: scenario === "loading" ? "loading" : scenario === "error" ? "error" : "ready" };
}

export function reading(account: Account, status: Status) {
  const events = [...account.events].sort((a, b) => a.date.localeCompare(b.date));
  let balance = account.opening, low = account.opening, firstShort: string | null = null;
  for (const event of events) {
    if (balance === null) break;
    balance += event.pence;
    low = Math.min(low ?? balance, balance);
    if (balance < 0 && firstShort === null) firstShort = event.date;
  }
  const reserved = status === "ready" ? account.plans.reduce((sum, plan) => sum + plan.pence, 0) : null;
  const afterPlans = balance !== null && reserved !== null ? balance - reserved : null;
  const paymentGap = low === null ? null : Math.max(0, -low);
  const gap = paymentGap === null ? null : Math.max(paymentGap, -(afterPlans ?? balance ?? 0), 0);
  const moves = status === "ready" && balance !== null ? account.moves : [];
  const incoming = moves.reduce((sum, move) => sum + Math.max(0, move.pence), 0);
  const netMove = moves.reduce((sum, move) => sum + move.pence, 0);
  const afterMove = afterPlans === null || !moves.length ? null : afterPlans + netMove;
  const earlierGap = gap !== null && gap > 0 && gap > -(afterPlans ?? balance ?? 0);
  const headline = gap === null ? null : gap > 0 ? -gap : afterPlans ?? balance;
  const signal = gap === null ? "unknown" : (paymentGap ?? 0) > incoming ? "risk" : gap > 0 || moves.length > 0 ? "watch" : null;
  return { events, afterPayments: balance, reserved, afterPlans, paymentGap, gap, headline, firstShort, moves, afterMove, earlierGap, signal };
}
