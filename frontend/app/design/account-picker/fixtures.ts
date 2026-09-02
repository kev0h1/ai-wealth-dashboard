// Pure-data fixtures for the account-picker design previews. Mirrors the
// owner's real spread (his phone screenshots, 2026-08-29 feedback): a
// current account or two, a couple of Revolut accounts, seven Monzo pots,
// a couple of Chase pots, and a couple of offline accounts — ~15 rows,
// which is what turned the flat AccountRadioPicker list into "very
// cluttered". No "use client", no JSX — shared by all three variants so
// the comparison is apples-to-apples.

import type { Account } from "@/lib/api";

export interface PickerAccount extends Account {
  /** Days since this account last filled an envelope/allocation, or null if
   *  it has never been used for one. Drives "Suggested" (variant A) and the
   *  recency-weighted shortlist (variant B). */
  lastUsedDaysAgo: number | null;
}

// ── The 15-account spread ("many") ─────────────────────────────────────────

export const MANY_ACCOUNTS: PickerAccount[] = [
  {
    id: "acc-barclays",
    name: "Barclays Current Account",
    type: "Current",
    subtype: "current",
    balance: 1284.52,
    currency: "GBP",
    provider: "Barclays",
    status: "connected",
    lastUsedDaysAgo: 0,
  },
  {
    id: "acc-starling",
    name: "Starling Current Account",
    type: "Current",
    subtype: "current",
    balance: 642.1,
    currency: "GBP",
    provider: "Starling",
    status: "connected",
    lastUsedDaysAgo: 3,
  },
  {
    id: "acc-revolut-main",
    name: "Revolut",
    type: "Current",
    subtype: "current",
    balance: 128.4,
    currency: "GBP",
    provider: "Revolut",
    status: "connected",
    lastUsedDaysAgo: 1,
  },
  {
    id: "acc-revolut-vault",
    name: "Revolut Getaway Vault",
    type: "Savings",
    subtype: "savings",
    balance: 950.0,
    currency: "GBP",
    provider: "Revolut",
    status: "connected",
    lastUsedDaysAgo: 45,
  },
  {
    id: "acc-monzo-emergency",
    name: "Monzo Pot · Emergency Fund",
    type: "Savings",
    subtype: "savings",
    balance: 2100.0,
    currency: "GBP",
    provider: "Monzo",
    status: "connected",
    lastUsedDaysAgo: 2,
  },
  {
    id: "acc-monzo-bills",
    name: "Monzo Pot · Bills",
    type: "Savings",
    subtype: "savings",
    balance: 300.0,
    currency: "GBP",
    provider: "Monzo",
    status: "connected",
    lastUsedDaysAgo: 7,
  },
  {
    id: "acc-monzo-rent",
    name: "Monzo Pot · Rent Buffer",
    type: "Savings",
    subtype: "savings",
    balance: 500.0,
    currency: "GBP",
    provider: "Monzo",
    status: "connected",
    lastUsedDaysAgo: 14,
  },
  {
    id: "acc-monzo-wedding",
    name: "Monzo Pot · Wedding",
    type: "Savings",
    subtype: "savings",
    balance: 1250.0,
    currency: "GBP",
    provider: "Monzo",
    status: "connected",
    lastUsedDaysAgo: 21,
  },
  {
    id: "acc-monzo-holiday",
    name: "Monzo Pot · Holiday",
    type: "Savings",
    subtype: "savings",
    balance: 340.0,
    currency: "GBP",
    provider: "Monzo",
    status: "connected",
    lastUsedDaysAgo: 30,
  },
  {
    id: "acc-monzo-car",
    name: "Monzo Pot · Car MOT",
    type: "Savings",
    subtype: "savings",
    balance: 220.0,
    currency: "GBP",
    provider: "Monzo",
    status: "connected",
    lastUsedDaysAgo: 90,
  },
  {
    id: "acc-monzo-christmas",
    name: "Monzo Pot · Christmas",
    type: "Savings",
    subtype: "savings",
    balance: 180.0,
    currency: "GBP",
    provider: "Monzo",
    status: "connected",
    lastUsedDaysAgo: 60,
  },
  {
    id: "acc-chase-saver",
    name: "Chase Saver Pot",
    type: "Savings",
    subtype: "savings",
    balance: 1800.0,
    currency: "GBP",
    provider: "Chase",
    status: "connected",
    lastUsedDaysAgo: 10,
  },
  {
    id: "acc-chase-getaway",
    name: "Chase Getaway Pot",
    type: "Savings",
    subtype: "savings",
    balance: 260.0,
    currency: "GBP",
    provider: "Chase",
    status: "connected",
    lastUsedDaysAgo: 75,
  },
  {
    id: "acc-offline-cash",
    name: "Cash Wallet",
    type: "Manual",
    subtype: "current",
    balance: 60.0,
    currency: "GBP",
    provider: "Offline",
    status: "manual",
    manual: true,
    lastUsedDaysAgo: null,
  },
  {
    id: "acc-offline-bonds",
    name: "Premium Bonds",
    type: "Manual",
    subtype: "savings",
    balance: 5000.0,
    currency: "GBP",
    provider: "Offline",
    status: "manual",
    manual: true,
    lastUsedDaysAgo: null,
  },
];

// ── The light spread ("few") — a user who hasn't linked much yet ──────────

export const FEW_ACCOUNTS: PickerAccount[] = [
  MANY_ACCOUNTS[0], // Barclays Current Account
  MANY_ACCOUNTS[1], // Starling Current Account
  MANY_ACCOUNTS[4], // Monzo Pot · Emergency Fund
];

// ── Helpers ─────────────────────────────────────────────────────────────

export function isSavingsKind(a: Account): boolean {
  return (a.subtype || "").toLowerCase().includes("saving");
}

/** The single best guess at what the user wants: the most recently used
 *  savings-kind account (an envelope is almost always heading to a pot, not
 *  a current account), falling back to the most recently used account of
 *  any kind if no savings account has recency data. Null if nothing has
 *  ever been used. */
export function suggestedAccountId(accounts: PickerAccount[]): string | null {
  const withRecency = accounts.filter((a) => a.lastUsedDaysAgo != null);
  if (withRecency.length === 0) return null;
  const savingsWithRecency = withRecency.filter(isSavingsKind);
  const pool = savingsWithRecency.length > 0 ? savingsWithRecency : withRecency;
  const sorted = [...pool].sort((a, b) => (a.lastUsedDaysAgo as number) - (b.lastUsedDaysAgo as number));
  return sorted[0].id;
}

/** Top N by recency (savings-kind first, then by recency), for variant B's
 *  shortlist. Excludes accounts with no recency data — a shortlist is a
 *  promise of relevance, not a random sample. */
export function recencyShortlist(accounts: PickerAccount[], n: number): PickerAccount[] {
  const withRecency = accounts.filter((a) => a.lastUsedDaysAgo != null);
  const sorted = [...withRecency].sort((a, b) => {
    const aSavings = isSavingsKind(a) ? 0 : 1;
    const bSavings = isSavingsKind(b) ? 0 : 1;
    if (aSavings !== bSavings) return aSavings - bSavings;
    return (a.lastUsedDaysAgo as number) - (b.lastUsedDaysAgo as number);
  });
  return sorted.slice(0, n);
}

export interface ProviderGroup {
  provider: string;
  accounts: PickerAccount[];
}

/** Group by institution, savings-kind first within each group (matches the
 *  live AccountRadioPicker's own savings-first sort), groups ordered by
 *  size descending so the biggest clutter source (Monzo, in the owner's
 *  case) sorts predictably rather than alphabetically. */
export function groupByProvider(accounts: PickerAccount[]): ProviderGroup[] {
  const byProvider = new Map<string, PickerAccount[]>();
  for (const a of accounts) {
    const list = byProvider.get(a.provider) ?? [];
    list.push(a);
    byProvider.set(a.provider, list);
  }
  const groups: ProviderGroup[] = Array.from(byProvider.entries()).map(([provider, list]) => {
    const sorted = [...list].sort((a, b) => {
      const aSavings = isSavingsKind(a) ? 0 : 1;
      const bSavings = isSavingsKind(b) ? 0 : 1;
      return aSavings - bSavings;
    });
    return { provider, accounts: sorted };
  });
  groups.sort((a, b) => b.accounts.length - a.accounts.length);
  return groups;
}

export function moneyStr(n: number): string {
  return `£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
}

export function recencyLabel(daysAgo: number | null): string {
  if (daysAgo == null) return "Not used yet";
  if (daysAgo === 0) return "Used today";
  if (daysAgo === 1) return "Used yesterday";
  if (daysAgo < 14) return `Used ${daysAgo}d ago`;
  if (daysAgo < 60) return `Used ${Math.round(daysAgo / 7)}w ago`;
  return `Used ${Math.round(daysAgo / 30)}mo ago`;
}
