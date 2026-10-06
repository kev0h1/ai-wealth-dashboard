// G219 fixtures. Static, no live data. Kevin's figures for the rail
// (Barclays £265, NatWest £27) as in his UAT screenshot of 2026-10-06.

import type { Account } from "@/lib/api";
import type { SpendFromResult } from "@/lib/spendFromAccount";
import type { SyncingInfo } from "@/components/SyncNote";

export type RouteState = "on-track" | "tight" | "card" | "short-cash" | "short-plans" | "syncing";

export const ROUTE_STATES: { id: RouteState; label: string }[] = [
  { id: "on-track", label: "On track" },
  { id: "tight", label: "Tight" },
  { id: "card", label: "Check card bill" },
  { id: "short-cash", label: "Short (cash)" },
  { id: "short-plans", label: "Short (plans only)" },
  { id: "syncing", label: "Syncing" },
];

const base = { type: "bank", subtype: "TRANSACTION", currency: "GBP", status: "AUTHORIZED", cover_source_eligible: true } as const;

const BARCLAYS = { ...base, id: "g219-barclays", name: "Current account", balance: 265, provider: "Barclays", provider_id: "barclays_personal" } satisfies Account;
const NATWEST = { ...base, id: "g219-natwest", name: "Everyday", balance: 27, provider: "NatWest", provider_id: "natwest" } satisfies Account;
const MONZO = { ...base, id: "g219-monzo", name: "Monzo main", balance: 112, provider: "Monzo", provider_id: "monzo" } satisfies Account;
// No bundled logo for this bank, so the card falls back to named rows.
const METRO = { ...base, id: "g219-metro", name: "Household account", balance: 27, provider: "Metro Bank" } satisfies Account;

export const ALL_ACCOUNTS: Account[] = [BARCLAYS, NATWEST, MONZO];
export const ALL_ACCOUNTS_METRO: Account[] = [BARCLAYS, METRO, MONZO];

function result(best: Account, bestHeadroom: number, alt: Account, altHeadroom: number): SpendFromResult {
  return {
    kind: "account",
    best: { accountId: best.id, name: best.name, provider: best.provider, headroom: bestHeadroom, account: best },
    alternative: { accountId: alt.id, name: alt.name, provider: alt.provider, headroom: altHeadroom, account: alt },
  };
}

export const SPEND_FROM_RAIL: SpendFromResult = result(BARCLAYS, 265, NATWEST, 27);
export const SPEND_FROM_NAMED: SpendFromResult = result(BARCLAYS, 265, METRO, 27);

export const SYNCING_INFO: SyncingInfo = { kind: "refresh", bank: "Barclays", asOf: "2026-10-06T09:41:00" };
