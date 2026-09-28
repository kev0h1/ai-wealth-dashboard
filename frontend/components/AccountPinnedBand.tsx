"use client";

// G117: extracted from AccountsPage.tsx's inline pinned-band JSX (the
// section immediately above the account-kind groups on the Accounts
// estate list) so the accounts-canvas-before-cards design preview can
// import and render the real markup instead of a hand-retyped copy that
// nothing stops from drifting the next time either file changes alone.
// Character-for-character identical to the production markup at the time
// of extraction — see the "Pinned band (G113 ...)" comment this replaced
// in AccountsPage.tsx for the design history (A1, Kevin approved
// 2026-09-16: a pinned account also appears again inside its own
// kind-group, and that duplication is deliberate).

import AccountLedgerRow, { type AccountLedgerRowProps } from "./AccountLedgerRow";
import type { EstateRow } from "@/lib/accountsEstate";

export type AccountLedgerRowExtras = Partial<
  Pick<AccountLedgerRowProps, "termsPill" | "onTermsClick" | "onAddRates">
>;

export interface AccountPinnedBandProps {
  rows: EstateRow[];
  onSelect: (row: EstateRow) => void;
  /** Per-row credit-terms pill props (AccountsPage's estateTermsProps, or a
   *  preview fixture's equivalent). Omit for rows with no terms affordance. */
  rowExtras?: (row: EstateRow) => AccountLedgerRowExtras;
}

export default function AccountPinnedBand({ rows, onSelect, rowExtras }: AccountPinnedBandProps) {
  if (rows.length === 0) return null;
  return (
    <section
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none"
      aria-label="Pinned accounts"
    >
      <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Pinned</p>
      <div className="mt-1 divide-y divide-slate-100 dark:divide-slate-700">
        {rows.map((row) => (
          <AccountLedgerRow key={row.id} row={row} onClick={onSelect} {...(rowExtras ? rowExtras(row) : {})} />
        ))}
      </div>
    </section>
  );
}
