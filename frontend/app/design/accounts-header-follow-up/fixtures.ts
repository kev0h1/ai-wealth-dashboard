// G250 fixtures. Invented accounts, no live data. Twenty is the long list; the
// first six are the short one.

import type { Account } from "@wealth/shared";
import { buildEstate, type Estate } from "@/lib/accountsEstate";

const acc = (
  id: string,
  provider: string,
  name: string,
  type: string,
  balance: number,
  subtype?: string,
): Account => ({ id, provider, name, type, balance, currency: "GBP", provider_id: `${id}-consent`, status: "connected", ...(subtype ? { subtype } : {}) }) as Account;

const ALL: Account[] = [
  acc("a1", "Barclays", "Premier Current Account", "Current", 111),
  acc("a2", "Monzo", "Personal", "Current", 1284.5),
  acc("a3", "HSBC", "Online Saver", "Savings", 12400),
  acc("a4", "American Express", "Gold Card", "Credit", -1240.18),
  acc("a5", "Vanguard", "Stocks and Shares ISA", "Investment", 21460, "isa"),
  acc("a6", "NatWest", "Rainy Day Pot", "Savings", 4200),
  acc("a7", "Starling", "Bills Account", "Current", 342.17),
  acc("a8", "Santander", "Everyday Current", "Current", 58.9),
  acc("a9", "Nationwide", "FlexDirect", "Current", 920),
  acc("a10", "Halifax", "Reward Current", "Current", 76.4),
  acc("a11", "Lloyds", "Club Lloyds", "Current", 205),
  acc("a12", "Chase", "Saver", "Savings", 3100),
  acc("a13", "Marcus", "Easy Access", "Savings", 5050),
  acc("a14", "Monzo", "Holiday Pot", "Savings", 640),
  acc("a15", "Barclaycard", "Platinum", "Credit", -312.6),
  acc("a16", "Vanquis", "Classic", "Credit", -480),
  acc("a17", "NatWest", "Reward Credit Card", "Credit", -96.2),
  acc("a18", "Trading 212", "Stocks ISA", "Investment", 6200, "isa"),
  acc("a19", "Hargreaves Lansdown", "SIPP", "Investment", 18900, "sipp"),
  acc("a20", "Nutmeg", "General Investment", "Investment", 2450, "invest"),
];

const PINNED = ["a1", "a2"];

export function estateFor(count: 6 | 20): Estate {
  return buildEstate(ALL.slice(0, count), [], PINNED);
}

export interface Breakdown { label: string; value: number }

/** Cash, cards and investments from the same rows, signed. */
export function breakdownFor(estate: Estate): Breakdown[] {
  const sum = (kinds: string[]) => estate.rows.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + r.balance, 0);
  return [
    { label: "Cash", value: sum(["Current", "Savings"]) },
    { label: "Cards", value: sum(["Credit"]) },
    { label: "Investments", value: sum(["Investment"]) },
  ];
}
