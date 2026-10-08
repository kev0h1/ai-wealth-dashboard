// G236 fixtures. Synthetic accounts, no live data. Two sizes (6 and 20 accounts).
import type { Account, InvestmentAccount } from "@wealth/shared";
import { buildEstate, type Estate } from "@/lib/accountsEstate";

export type AccountsCount = "6" | "20";
export const COUNTS: { id: AccountsCount; label: string }[] = [
  { id: "6", label: "6 accounts" },
  { id: "20", label: "20 accounts" },
];

const bank = (id: string, name: string, provider: string, type: "Current" | "Savings" | "Credit", balance: number, extra: Partial<Account> = {}): Account =>
  ({ id, name, type, balance, currency: "GBP", provider, provider_id: `${id}-consent`, status: "connected", ...extra }) as Account;

const SIX: Account[] = [
  bank("g236-barclays", "Premier Current", "Barclays", "Current", 1284.5),
  bank("g236-natwest", "Everyday Account", "NatWest", "Current", 312.2),
  bank("g236-marcus", "Online Saver", "Marcus", "Savings", 12500),
  bank("g236-amex", "Platinum Cashback", "Amex", "Credit", -731),
  bank("g236-offline", "House repairs fund", "Offline", "Savings", 1850, { manual: true }),
];

const MORE: Account[] = [
  bank("g236-starling", "Rainy Day Pot", "Starling", "Savings", 3400),
  bank("g236-monzo-bills", "Bills Account", "Monzo", "Current", 140),
  bank("g236-monzo-hol", "Holiday Pot", "Monzo", "Savings", 450),
  bank("g236-lloyds", "Classic Account", "Lloyds", "Current", 88.1),
  bank("g236-hsbc", "HSBC Advance", "HSBC", "Current", 75),
  bank("g236-hsbc-sav", "Online Bonus Saver", "HSBC", "Savings", 3000),
  bank("g236-halifax", "Reward Current", "Halifax", "Current", 12),
  bank("g236-barclaycard", "Rewards Card", "Barclaycard", "Credit", -212.4),
  bank("g236-capone", "Purchase Card", "Capital One", "Credit", -90),
  bank("g236-nationwide", "Easy Access Saver", "Nationwide", "Savings", 5200),
  bank("g236-santander", "Regular Saver", "Santander", "Savings", 900),
  bank("g236-tsb", "Joint Current", "TSB", "Current", -18.75),
  bank("g236-offline-cash", "Cash in hand", "Offline", "Current", 220, { manual: true }),
];

const inv = (id: string, type: string, provider: string, value: number): InvestmentAccount =>
  ({ id, provider, account_type: type, account_reference: "•••• 4812", currency: "GBP", total_value: value, statement_date: "2026-09-30", last_refreshed: "2026-10-01T08:30:00Z", updated_at: "2026-10-01T08:30:00Z", added_since: 0, notes_since: 0, display_value: value }) as InvestmentAccount;

const ISA = inv("g236-isa", "ISA", "Vanguard", 14078);
const SIPP = inv("g236-sipp", "SIPP", "Vanguard", 22340);

export function estateFor(c: AccountsCount): Estate {
  if (c === "6") return buildEstate(SIX, [ISA], ["g236-marcus"]);
  return buildEstate([...SIX, ...MORE], [ISA, SIPP], ["g236-barclays", "g236-marcus", "g236-isa"]);
}

export const ADD_CHOICES = ["Add Bank", "Statement", "Investment", "Offline"] as const;
