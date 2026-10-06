// G221 fixtures. Synthetic accounts (shouting bank names on purpose), no live
// data. The hero, brief cards, tip card, transactions and investment are the
// production fixtures other previews already use.
import type { Account, InvestmentAccount, SavingsInsight } from "@/lib/api";
import { LEDGER_INVESTMENT, RECENT_TRANSACTIONS } from "../g134-home-inventory/fixtures";
import { INSIGHT_FIXTURES } from "../insights-live/fixtures";

export type AccountsCase = "1" | "4" | "20" | "fresh";
export const CASES: { id: AccountsCase; label: string }[] = [
  { id: "1", label: "1 account" },
  { id: "4", label: "4 accounts" },
  { id: "20", label: "20 accounts" },
  { id: "fresh", label: "Fresh user" },
];

const base = { type: "bank", subtype: "TRANSACTION", currency: "GBP", status: "connected" } as const;

const NAMES: { name: string; provider: string; provider_id: string; subtype: string; balance: number }[] = [
  { name: "PREMIER CURRENT", provider: "Barclays", provider_id: "barclays_personal", subtype: "TRANSACTION", balance: 1284.5 },
  { name: "EASY ACCESS SAVER", provider: "Nationwide", provider_id: "nationwide", subtype: "SAVINGS", balance: 5200 },
  { name: "EVERYDAY ACCOUNT", provider: "NatWest", provider_id: "natwest", subtype: "TRANSACTION", balance: 312.2 },
  { name: "PLATINUM CASHBACK", provider: "Amex", provider_id: "amex", subtype: "CREDIT_CARD", balance: -731 },
  { name: "JOINT CURRENT", provider: "NatWest", provider_id: "natwest", subtype: "TRANSACTION", balance: 620 },
  { name: "REGULAR SAVER", provider: "Santander", provider_id: "santander", subtype: "SAVINGS", balance: 900 },
  { name: "CLASSIC ACCOUNT", provider: "Lloyds", provider_id: "lloyds", subtype: "TRANSACTION", balance: 88.1 },
  { name: "REWARD CREDIT CARD", provider: "Barclaycard", provider_id: "barclaycard", subtype: "CREDIT_CARD", balance: -212.4 },
  { name: "HOLIDAY POT", provider: "Monzo", provider_id: "monzo", subtype: "SAVINGS", balance: 450 },
  { name: "BILLS ACCOUNT", provider: "Monzo", provider_id: "monzo", subtype: "TRANSACTION", balance: 140 },
  { name: "RAINY DAY SAVER", provider: "Starling", provider_id: "starling", subtype: "SAVINGS", balance: 1500 },
  { name: "BUSINESS CURRENT", provider: "Starling", provider_id: "starling", subtype: "TRANSACTION", balance: 2210 },
  { name: "HSBC ADVANCE", provider: "HSBC", provider_id: "hsbc", subtype: "TRANSACTION", balance: 75 },
  { name: "ONLINE BONUS SAVER", provider: "HSBC", provider_id: "hsbc", subtype: "SAVINGS", balance: 3000 },
  { name: "STUDENT ACCOUNT", provider: "Halifax", provider_id: "halifax", subtype: "TRANSACTION", balance: 12 },
  { name: "PURCHASE CARD", provider: "Capital One", provider_id: "capital_one", subtype: "CREDIT_CARD", balance: -90 },
  { name: "KIDS SAVER", provider: "Nationwide", provider_id: "nationwide", subtype: "SAVINGS", balance: 260 },
  { name: "MORTGAGE OFFSET", provider: "Santander", provider_id: "santander", subtype: "SAVINGS", balance: 4100 },
  { name: "SPARE CURRENT", provider: "Lloyds", provider_id: "lloyds", subtype: "TRANSACTION", balance: 5 },
];

function makeAccounts(n: number): Account[] {
  return NAMES.slice(0, n).map((a, i) => ({ ...base, id: `g221-acc-${i}`, ...a }) as Account);
}

export interface EstateFixture {
  accounts: Account[];
  investment?: InvestmentAccount;
  pinnedIds: string[];
  /** Total accounts the user holds (bank plus investment). */
  total: number;
}

export function estateFor(c: AccountsCase): EstateFixture {
  if (c === "fresh") return { accounts: [], pinnedIds: [], total: 0 };
  if (c === "1") {
    const accounts = makeAccounts(1);
    return { accounts, pinnedIds: [accounts[0].id], total: 1 };
  }
  if (c === "4") {
    const accounts = makeAccounts(3);
    return { accounts, investment: LEDGER_INVESTMENT, pinnedIds: [accounts[1].id, LEDGER_INVESTMENT.id], total: 4 };
  }
  const accounts = makeAccounts(19);
  return { accounts, investment: LEDGER_INVESTMENT, pinnedIds: [accounts[0].id, accounts[1].id, accounts[3].id, LEDGER_INVESTMENT.id], total: 20 };
}

/** The same top-pick rule HomePage uses today: pins first, then the biggest current and savings balances, 3 bank rows plus one investment. */
export function topPicks(accounts: Account[], pinnedIds: string[], investment?: InvestmentAccount) {
  const picks: Account[] = [];
  const seen = new Set<string>();
  const add = (a?: Account) => { if (a && !seen.has(a.id)) { seen.add(a.id); picks.push(a); } };
  pinnedIds.forEach((id) => add(accounts.find((a) => a.id === id)));
  const isSavings = (a: Account) => (a.subtype ?? "").toLowerCase().includes("saving");
  const isCredit = (a: Account) => a.type.toLowerCase().includes("credit") || (a.subtype ?? "").toLowerCase().includes("credit");
  const current = accounts.filter((a) => !isSavings(a) && !isCredit(a)).sort((x, y) => y.balance - x.balance);
  const savings = accounts.filter(isSavings).sort((x, y) => y.balance - x.balance);
  for (const a of [...current, ...savings]) { if (picks.length >= 3) break; add(a); }
  const top = picks.slice(0, 3);
  const hidden = Math.max(0, accounts.length - top.length);
  return { top, investment, hidden };
}

export const TIP: SavingsInsight = INSIGHT_FIXTURES.fresh_weekly;
export { RECENT_TRANSACTIONS };

/** Bills for the /cashflow stand-in, dated from today so the Coming up card reads naturally. */
export function cashflowFixture() {
  const day = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const bill = (name: string, amount: number, n: number) => ({ name, amount, expected_date: day(n), days_away: n, kind: "commitment" as const });
  return {
    weekly_projection: [],
    upcoming_bills: [bill("Council Tax", 142, 2), bill("Sky Mobile", 38, 3), bill("Thames Water", 29.5, 6), bill("Octopus Energy", 102, 9)],
    upcoming_income: [],
    avg_daily_spend: 0,
    available_balance: 0,
    next_payday: null,
    payday_source: null,
    income_suggestion: null,
  };
}
