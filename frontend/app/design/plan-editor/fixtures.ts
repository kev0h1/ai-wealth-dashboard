import type { Account } from "@/lib/api";

/** Design-only data. It deliberately models a small transfer record, rather
 * than the production matcher: goal plans match an outgoing source debit,
 * while today's set-asides match incoming credits at their receiving account. */
export type EditorKind = "goal" | "set-aside";

export type PlanEditorTransaction = {
  id: string;
  sourceId: string;
  destinationId: string | null;
  amount: number;
  bookedDate: string;
  description: string;
  displayName: string;
  kind: "transfer" | "purchase" | "income" | "adjustment";
  recurring: boolean;
};

export type RankedTransfer = {
  id: string;
  displayName: string;
  description: string;
  amount: number;
  sourceId: string;
  destinationId: string;
  occurrences: number;
  lastDate: string;
  reason: string;
};

const bank = (id: string, name: string, provider: string, balance: number, subtype = "CURRENT_ACCOUNT", extra: Partial<Account> = {}): Account => ({
  id, name, provider, provider_id: provider.toLowerCase().replace(/\s+/g, "-"), balance,
  type: subtype === "CREDIT_CARD" ? "CREDIT_CARD" : "BANK", subtype, currency: "GBP", status: "active", ...extra,
});

export const BANK_ACCOUNTS: Account[] = [
  bank("barclays-premier", "Premier Current", "Barclays", 2640),
  bank("monzo-current", "Personal current account", "Monzo", 1180),
  bank("natwest-current", "Everyday account", "NatWest", 690),
  bank("hsbc-current", "Current account", "HSBC", 940),
  bank("amex-card", "Platinum Cashback", "American Express", -420, "CREDIT_CARD"),
  // API name: false means excluded from Safe to Spend and therefore ineligible as a plan source.
  bank("starling-excluded", "Bills account", "Starling", 310, "CURRENT_ACCOUNT", { include_in_safe_to_spend: false }),
];

export const POTS: Account[] = [
  bank("barclays-japan", "Personal GBP", "Barclays", 1000, "SAVINGS_ACCOUNT"),
  bank("monzo-holiday", "Holiday", "Monzo", 460, "SAVINGS_POT"),
  bank("monzo-rainy", "Rainy day", "Monzo", 720, "SAVINGS_POT"),
  bank("barclays-tax", "Tax reserve", "Barclays", 380, "SAVINGS_ACCOUNT"),
  bank("offline-saver", "Family saver", "Offline savings", 250, "SAVINGS", { manual: true }),
].map((account) => ({ ...account, include_in_safe_to_spend: false }));

export const ALL_ACCOUNTS: Account[] = [...BANK_ACCOUNTS, ...POTS];

export const TRANSACTIONS: PlanEditorTransaction[] = [
  { id: "tx-01", sourceId: "barclays-premier", destinationId: "barclays-japan", amount: 80, bookedDate: "2026-08-01", description: "ALEX TAYLOR JAPAN", displayName: "Japan transfer", kind: "transfer", recurring: true },
  { id: "tx-02", sourceId: "barclays-premier", destinationId: "barclays-japan", amount: 80, bookedDate: "2026-09-01", description: "ALEX TAYLOR JAPAN", displayName: "Japan transfer", kind: "transfer", recurring: true },
  { id: "tx-03", sourceId: "barclays-premier", destinationId: "barclays-japan", amount: 80, bookedDate: "2026-10-01", description: "ALEX TAYLOR JAPAN", displayName: "Japan transfer", kind: "transfer", recurring: true },
  { id: "tx-04", sourceId: "barclays-premier", destinationId: "monzo-holiday", amount: 50, bookedDate: "2026-09-03", description: "ALEX TAYLOR HOLIDAY", displayName: "Holiday transfer", kind: "transfer", recurring: true },
  { id: "tx-05", sourceId: "barclays-premier", destinationId: "monzo-rainy", amount: 120, bookedDate: "2026-09-05", description: "ALEX TAYLOR RAINY DAY", displayName: "Rainy day transfer", kind: "transfer", recurring: true },
  { id: "tx-06", sourceId: "barclays-premier", destinationId: "barclays-tax", amount: 200, bookedDate: "2026-09-08", description: "ALEX TAYLOR TAX", displayName: "Tax reserve transfer", kind: "transfer", recurring: true },
  { id: "tx-07", sourceId: "barclays-premier", destinationId: "monzo-current", amount: 30, bookedDate: "2026-09-12", description: "ALEX TAYLOR MONZO", displayName: "Monzo transfer", kind: "transfer", recurring: false },
  { id: "tx-08", sourceId: "barclays-premier", destinationId: "offline-saver", amount: 75, bookedDate: "2026-09-16", description: "ALEX TAYLOR FAMILY SAVER", displayName: "Family saver transfer", kind: "transfer", recurring: false },
  { id: "tx-09", sourceId: "barclays-premier", destinationId: "natwest-current", amount: 40, bookedDate: "2026-09-20", description: "ALEX TAYLOR NATWEST", displayName: "NatWest transfer", kind: "transfer", recurring: false },
  { id: "tx-10", sourceId: "barclays-premier", destinationId: null, amount: 8.49, bookedDate: "2026-09-02", description: "COSTA COFFEE", displayName: "Costa Coffee", kind: "purchase", recurring: false },
  { id: "tx-11", sourceId: "barclays-premier", destinationId: null, amount: 12.39, bookedDate: "2026-09-04", description: "MCDONALD'S", displayName: "McDonald's", kind: "purchase", recurring: false },
  { id: "tx-12", sourceId: "barclays-premier", destinationId: null, amount: 18, bookedDate: "2026-09-07", description: "ANTHROPIC", displayName: "Anthropic", kind: "purchase", recurring: true },
  { id: "tx-13", sourceId: "barclays-premier", destinationId: null, amount: 42.7, bookedDate: "2026-09-09", description: "TESCO STORES", displayName: "Tesco", kind: "purchase", recurring: false },
  { id: "tx-14", sourceId: "barclays-premier", destinationId: null, amount: 6.2, bookedDate: "2026-09-11", description: "TRANSPORT FOR LONDON", displayName: "Transport for London", kind: "purchase", recurring: false },
  { id: "tx-15", sourceId: "barclays-premier", destinationId: null, amount: 10.99, bookedDate: "2026-09-14", description: "NETFLIX.COM", displayName: "Netflix", kind: "purchase", recurring: true },
  { id: "tx-16", sourceId: "barclays-premier", destinationId: null, amount: 64.5, bookedDate: "2026-09-18", description: "WAITROSE", displayName: "Waitrose", kind: "purchase", recurring: false },
  { id: "tx-17", sourceId: "barclays-premier", destinationId: null, amount: 25, bookedDate: "2026-09-21", description: "OCTOPUS ENERGY", displayName: "Octopus Energy", kind: "purchase", recurring: true },
  { id: "tx-18", sourceId: "barclays-premier", destinationId: null, amount: 16.8, bookedDate: "2026-09-23", description: "DELIVEROO", displayName: "Deliveroo", kind: "purchase", recurring: false },
  { id: "tx-19", sourceId: "barclays-premier", destinationId: null, amount: 55, bookedDate: "2026-09-25", description: "VODAFONE", displayName: "Vodafone", kind: "purchase", recurring: true },
  { id: "tx-20", sourceId: "barclays-premier", destinationId: null, amount: 14.25, bookedDate: "2026-09-27", description: "PRET A MANGER", displayName: "Pret A Manger", kind: "purchase", recurring: false },
  { id: "tx-21", sourceId: "monzo-current", destinationId: "monzo-holiday", amount: 60, bookedDate: "2026-09-01", description: "MONZO POT HOLIDAY", displayName: "Holiday transfer", kind: "transfer", recurring: true },
  { id: "tx-22", sourceId: "monzo-current", destinationId: "monzo-rainy", amount: 25, bookedDate: "2026-09-04", description: "MONZO POT RAINY", displayName: "Rainy day transfer", kind: "transfer", recurring: true },
  { id: "tx-23", sourceId: "monzo-current", destinationId: null, amount: 4.5, bookedDate: "2026-09-06", description: "COSTA COFFEE", displayName: "Costa Coffee", kind: "purchase", recurring: false },
  { id: "tx-24", sourceId: "monzo-current", destinationId: null, amount: 15.5, bookedDate: "2026-09-08", description: "MCDONALD'S", displayName: "McDonald's", kind: "purchase", recurring: false },
  { id: "tx-25", sourceId: "monzo-current", destinationId: null, amount: 72, bookedDate: "2026-09-10", description: "SAINSBURY'S", displayName: "Sainsbury's", kind: "purchase", recurring: false },
  { id: "tx-26", sourceId: "natwest-current", destinationId: "barclays-japan", amount: 80, bookedDate: "2026-09-02", description: "NATWEST TO JAPAN", displayName: "Japan transfer", kind: "transfer", recurring: false },
  { id: "tx-27", sourceId: "natwest-current", destinationId: null, amount: 31.2, bookedDate: "2026-09-05", description: "AMAZON", displayName: "Amazon", kind: "purchase", recurring: false },
  { id: "tx-28", sourceId: "hsbc-current", destinationId: "barclays-tax", amount: 150, bookedDate: "2026-09-03", description: "HSBC TAX RESERVE", displayName: "Tax reserve transfer", kind: "transfer", recurring: true },
  { id: "tx-29", sourceId: "hsbc-current", destinationId: null, amount: 9.75, bookedDate: "2026-09-09", description: "GREGGS", displayName: "Greggs", kind: "purchase", recurring: false },
  { id: "tx-30", sourceId: "starling-excluded", destinationId: "barclays-japan", amount: 80, bookedDate: "2026-09-01", description: "STARLING JAPAN", displayName: "Japan transfer", kind: "transfer", recurring: true },
  { id: "tx-31", sourceId: "starling-excluded", destinationId: null, amount: 44, bookedDate: "2026-09-07", description: "COUNCIL TAX", displayName: "Council tax", kind: "purchase", recurring: true },
  { id: "tx-32", sourceId: "amex-card", destinationId: null, amount: 89, bookedDate: "2026-09-02", description: "TRAINLINE", displayName: "Trainline", kind: "purchase", recurring: false },
  { id: "tx-33", sourceId: "amex-card", destinationId: null, amount: 22, bookedDate: "2026-09-12", description: "UBER", displayName: "Uber", kind: "purchase", recurring: false },
  { id: "tx-34", sourceId: "barclays-japan", destinationId: null, amount: 4.2, bookedDate: "2026-09-17", description: "BANK INTEREST", displayName: "Bank interest", kind: "income", recurring: false },
  { id: "tx-35", sourceId: "monzo-holiday", destinationId: null, amount: 2.1, bookedDate: "2026-09-17", description: "BANK INTEREST", displayName: "Bank interest", kind: "income", recurring: false },
  { id: "tx-36", sourceId: "monzo-rainy", destinationId: null, amount: 3.4, bookedDate: "2026-09-17", description: "BANK INTEREST", displayName: "Bank interest", kind: "income", recurring: false },
  { id: "tx-37", sourceId: "barclays-tax", destinationId: null, amount: 1.8, bookedDate: "2026-09-17", description: "BANK INTEREST", displayName: "Bank interest", kind: "income", recurring: false },
  { id: "tx-38", sourceId: "offline-saver", destinationId: null, amount: 0.5, bookedDate: "2026-09-17", description: "MANUAL BALANCE UPDATE", displayName: "Manual balance update", kind: "adjustment", recurring: false },
  { id: "tx-39", sourceId: "barclays-premier", destinationId: "hsbc-current", amount: 90, bookedDate: "2026-08-20", description: "ALEX TAYLOR HSBC", displayName: "HSBC transfer", kind: "transfer", recurring: false },
  { id: "tx-40", sourceId: "barclays-premier", destinationId: "barclays-japan", amount: 20, bookedDate: "2026-09-29", description: "ALEX TAYLOR JAPAN EXTRA", displayName: "Japan top-up", kind: "transfer", recurring: false },
];

type TransferGroup = RankedTransfer;

function transferGroups(sourceId: string, destinationIds?: string[]): TransferGroup[] {
  const allowedDestinations = destinationIds ? new Set(destinationIds) : null;
  const bySeries = new Map<string, PlanEditorTransaction[]>();
  for (const transaction of TRANSACTIONS) {
    if (transaction.kind !== "transfer" || transaction.sourceId !== sourceId || !transaction.destinationId) continue;
    if (allowedDestinations && !allowedDestinations.has(transaction.destinationId)) continue;
    const key = `${transaction.sourceId}:${transaction.destinationId}:${transaction.displayName}`;
    bySeries.set(key, [...(bySeries.get(key) ?? []), transaction]);
  }
  return [...bySeries.entries()].map(([id, records]) => {
    const latest = [...records].sort((a, b) => b.bookedDate.localeCompare(a.bookedDate))[0];
    return { id, displayName: latest.displayName, description: latest.description, amount: latest.amount, sourceId: latest.sourceId, destinationId: latest.destinationId!, occurrences: records.length, lastDate: latest.bookedDate, reason: "Known transfer between your accounts" };
  });
}

/** Transfer-only fallback list for an explicit "choose another payment" path. */
export function allSourceTransfers(sourceId: string): RankedTransfer[] {
  return transferGroups(sourceId).sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

/**
 * Preview-only ranking: retains only transfers to selected sinks close to the
 * intended amount (within 15%). An explicit other-payment path uses
 * `allSourceTransfers`; this picker never presents a weak match as credible.
 * This is not production matching or fulfilment logic.
 */
export function rankedTransfers(sourceId: string, destinationIds: string[], amount: number): RankedTransfer[] {
  const candidates = transferGroups(sourceId, destinationIds);
  const distance = (candidate: RankedTransfer) => Math.abs(candidate.amount - amount) / Math.max(amount, 0.01);
  const withinTolerance = candidates.filter((candidate) => distance(candidate) <= 0.15);
  const ranked = withinTolerance
    .sort((a, b) => distance(a) - distance(b) || b.occurrences - a.occurrences || b.lastDate.localeCompare(a.lastDate));
  return ranked;
}

export const GOAL_FIXTURE = {
  kind: "goal" as const, name: "Japan", target: 1800, saved: 1000, targetDate: "2027-08-01", periodsLeft: 10, perPeriod: 80,
};

export const SET_ASIDE_FIXTURE = { kind: "set-aside" as const, name: "Annual costs", amount: 80 };

const FIXTURE_TODAY = "2026-10-14";

/** A fixed-clock, preview-only estimate mirroring the UI's £5 round-up. */
export function amountForGoal(target: number, targetDate: string, saved = 1000): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);
  if (!match || !Number.isFinite(target) || !Number.isFinite(saved)) return 0;
  const [, yearText, monthText, dayText] = match;
  const targetUtc = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  if (
    targetUtc.getUTCFullYear() !== Number(yearText)
    || targetUtc.getUTCMonth() !== Number(monthText) - 1
    || targetUtc.getUTCDate() !== Number(dayText)
    || targetDate <= FIXTURE_TODAY
  ) return 0;
  const firstPeriod = new Date(Date.UTC(2026, 10, 1));
  let periods = 0;
  for (let period = firstPeriod; period <= targetUtc; period = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1))) periods += 1;
  return periods > 0 ? Math.ceil(Math.max(0, target - saved) / periods / 5) * 5 : 0;
}
