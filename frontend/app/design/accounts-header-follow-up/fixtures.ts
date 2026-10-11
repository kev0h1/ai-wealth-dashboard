// G250 fixtures. Six and twenty are invented accounts. Round 2's default is the
// 18-account shape of Kevin's live page (Kevin authorises his real payload in
// previews, 2026-10-10): the figures he gave are real (Net worth 1,365; Barclays
// 5,954; Monzo 217; NatWest 93; Current total 6,582) and the other twelve
// balances are invented to reconcile to them. Pinned: those three.

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

// 18 accounts: Current 6 (sum 6,582), Savings 3, Cards 6, Investments 3; net 1,365.
const LIVE18: Account[] = [
  acc("l1", "Barclays", "Premier Current Account", "Current", 5954),
  acc("l2", "Monzo", "Personal", "Current", 217),
  acc("l3", "NatWest", "Select Current", "Current", 93),
  acc("l4", "Starling", "Bills Account", "Current", 204),
  acc("l5", "Chase", "Everyday", "Current", 78),
  acc("l6", "Halifax", "Reward Current", "Current", 36),
  acc("l7", "Marcus", "Easy Access Saver", "Savings", 2100),
  acc("l8", "Monzo", "Holiday Pot", "Savings", 640),
  acc("l9", "Chase", "Round-ups", "Savings", 410),
  acc("l10", "American Express", "Gold Card", "Credit", -5900),
  acc("l11", "Barclaycard", "Platinum", "Credit", -4200),
  acc("l12", "Vanquis", "Classic", "Credit", -2800),
  acc("l13", "Capital One", "Classic", "Credit", -2517),
  acc("l14", "NatWest", "Reward Credit Card", "Credit", -1900),
  acc("l15", "MBNA", "Platinum", "Credit", -1300),
  acc("l16", "Vanguard", "Stocks and Shares ISA", "Investment", 6300, "isa"),
  acc("l17", "Trading 212", "Stocks ISA", "Investment", 2800, "isa"),
  acc("l18", "Nutmeg", "General Investment", "Investment", 1150, "invest"),
];
const LIVE18_PINNED = ["l1", "l2", "l3"];

export function estateFor(count: 6 | 18 | 20): Estate {
  if (count === 18) return buildEstate(LIVE18, [], LIVE18_PINNED);
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
