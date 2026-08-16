// Pure estate helpers over a NORMALIZED row shape — the shared foundation
// for the ledger-rows accounts redesign (see app/design/accounts-rows for
// the approved preview this mirrors). Bank `Account` and `InvestmentAccount`
// are different shapes but need to sit in one estate list/net-worth/groups,
// so everything here operates on `EstateRow`, not the raw types.
//
// No React, no page wiring — Wave 1 only builds this foundation.

import type { Account, InvestmentAccount } from "@wealth/shared";
import { accountKind, accountKindLabel, isDormant, needsAttention, type AccountKind } from "./accountKind";

export interface EstateRow {
  id: string;
  name: string;
  provider: string;
  kind: AccountKind;
  balance: number; // credit negative; investments use display/total value
  status: "connected" | "expired" | string;
  pinned: boolean;
  dormant: boolean;
  attention: boolean;
  source: "bank" | "investment";
  raw: Account | InvestmentAccount; // original record, for rendering/handlers
}

export function bankToRow(a: Account, pinnedIds: string[]): EstateRow {
  return {
    id: a.id,
    name: a.name,
    provider: a.provider,
    kind: accountKind(a),
    balance: a.balance,
    status: a.status,
    pinned: pinnedIds.includes(a.id),
    dormant: isDormant(a),
    attention: needsAttention(a),
    source: "bank",
    raw: a,
  };
}

/** InvestmentAccount has no `name` field — `account_type` (e.g. "ISA",
 *  "SIPP") is the closest thing to a display name. Investments are never
 *  dormant/attention: there's no £0-and-unused or expired-connection concept
 *  for statement-uploaded holdings. */
export function investmentToRow(i: InvestmentAccount, pinnedIds: string[] = []): EstateRow {
  return {
    id: i.id,
    name: i.account_type || i.provider,
    provider: i.provider,
    kind: "Investment",
    balance: i.display_value ?? i.total_value,
    status: "connected",
    pinned: pinnedIds.includes(i.id),
    dormant: false,
    attention: false,
    source: "investment",
    raw: i,
  };
}

export interface EstateGroup {
  kind: AccountKind;
  label: string;
  count: number;
  subtotal: number;
  rows: EstateRow[];
}

export interface Estate {
  rows: EstateRow[];
  netWorth: number;
  pinned: EstateRow[];
  groups: EstateGroup[];
  attention: EstateRow[];
  inactive: EstateRow[];
}

/** Live-group order (matches the approved preview's ACCOUNT_GROUPS). Offline
 *  (manual) accounts aren't a live group in this pass. */
const GROUP_ORDER: AccountKind[] = ["Current", "Savings", "Credit", "Investment"];

/** Plural collection labels for group headers — distinct from
 *  accountKindLabel's singular per-row label ("Credit card" vs "Credit
 *  cards"), matching the approved preview's group headings. */
const GROUP_LABELS: Record<AccountKind, string> = {
  Current: "Current",
  Savings: "Savings",
  Credit: "Credit cards",
  Investment: "Investments",
  Offline: "Offline",
};

/** Pinned-first, then balance descending — applied within the pinned band
 *  and within each group, mirroring the approved preview's sort. */
function sortRows(a: EstateRow, b: EstateRow): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.balance - a.balance;
}

export function buildEstate(
  accounts: Account[],
  investments: InvestmentAccount[],
  pinnedIds: string[]
): Estate {
  const rows: EstateRow[] = [
    ...accounts.map((a) => bankToRow(a, pinnedIds)),
    ...investments.map((i) => investmentToRow(i, pinnedIds)),
  ];

  const netWorth = rows.reduce((sum, r) => sum + r.balance, 0);

  // A broken/dormant account pinned to the top would be confusing — it
  // belongs in `attention`/`inactive` instead (mirrors the preview's
  // pinnedAccounts()).
  const pinned = rows
    .filter((r) => r.pinned && !r.attention && !r.dormant)
    .sort(sortRows);

  const groups: EstateGroup[] = GROUP_ORDER.map((kind) => {
    const groupRows = rows
      .filter((r) => r.kind === kind && !r.attention && !r.dormant)
      .sort(sortRows);
    return {
      kind,
      label: GROUP_LABELS[kind],
      count: groupRows.length,
      subtotal: groupRows.reduce((sum, r) => sum + r.balance, 0),
      rows: groupRows,
    };
  }).filter((g) => g.count > 0);

  const attention = rows.filter((r) => r.attention);
  const inactive = rows.filter((r) => r.dormant);

  return { rows, netWorth, pinned, groups, attention, inactive };
}

export type EstateLens = "All" | "Current" | "Savings" | "Credit" | "Investment" | "Owed";

export function filterEstate(
  rows: EstateRow[],
  opts: { query?: string; lens?: EstateLens }
): EstateRow[] {
  let result = rows;

  const q = opts.query?.trim().toLowerCase();
  if (q) {
    result = result.filter(
      (r) => r.name.toLowerCase().includes(q) || r.provider.toLowerCase().includes(q)
    );
  }

  const lens = opts.lens ?? "All";
  if (lens === "Owed") {
    result = result.filter((r) => r.kind === "Credit" && r.balance < 0);
  } else if (lens !== "All") {
    result = result.filter((r) => r.kind === lens);
  }

  return result;
}

// Re-export for convenience so callers only need one import for both the
// classifier and the estate label.
export { accountKindLabel };
