"use client";

// G117: extracted from AccountsPage.tsx's inline account-kind-group JSX
// (the collapsible, sticky-header bounded card each Estate group renders
// as on the Accounts list) so the accounts-canvas-before-cards design
// preview can import and render the real markup instead of a hand-retyped
// copy that nothing stops from drifting the next time either file changes
// alone. Character-for-character identical to the production markup at
// the time of extraction — see the long "Collapsible groups (G113 ...)"
// comment this replaced in AccountsPage.tsx for why the section carries
// no overflow-hidden (so `position: sticky` on the header keeps working)
// while the rows wrapper below handles its own rounded corners and
// height/opacity collapse animation.

import { ChevronDown } from "lucide-react";
import AccountLedgerRow, { type AccountLedgerRowProps } from "./AccountLedgerRow";
import type { EstateGroup, EstateRow } from "@/lib/accountsEstate";

export type AccountLedgerRowExtras = Partial<
  Pick<AccountLedgerRowProps, "termsPill" | "onTermsClick" | "onAddRates">
>;

export interface AccountGroupSectionProps {
  group: EstateGroup;
  collapsed: boolean;
  onToggle: () => void;
  /** Balances masked (AccountsPage's hideNetWorth / a preview's hidden state). */
  hideBalance: boolean;
  onSelect: (row: EstateRow) => void;
  /** Per-row credit-terms pill props (AccountsPage's estateTermsProps, or a
   *  preview fixture's equivalent). Omit for rows with no terms affordance. */
  rowExtras?: (row: EstateRow) => AccountLedgerRowExtras;
}

export default function AccountGroupSection({
  group,
  collapsed,
  onToggle,
  hideBalance,
  onSelect,
  rowExtras,
}: AccountGroupSectionProps) {
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none"
      aria-label={`${group.label} accounts`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className={`sticky top-0 z-10 flex min-h-16 w-full items-center justify-between gap-3 bg-white px-4 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:bg-slate-800 dark:hover:bg-slate-700/60 dark:active:bg-slate-700 ${collapsed ? "rounded-2xl" : "rounded-t-2xl"}`}
      >
        <span>
          <span role="heading" aria-level={2} className="block text-[15px] font-bold text-slate-900 dark:text-slate-100">{group.label}</span>
          <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">{group.count} {group.count === 1 ? "account" : "accounts"}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="money text-[14px] font-semibold text-slate-800 dark:text-slate-200">
            {hideBalance
              ? "£••••"
              : `${group.subtotal < 0 ? "-" : ""}£${Math.abs(Math.round(group.subtotal)).toLocaleString("en-GB")}`}
          </span>
          <ChevronDown
            size={16}
            className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 motion-reduce:transition-none ${collapsed ? "" : "rotate-180"}`}
            aria-hidden="true"
          />
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0 ${
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div
          className={`overflow-hidden rounded-b-2xl transition-opacity duration-200 motion-reduce:transition-none motion-reduce:duration-0 ${
            collapsed ? "opacity-0" : "opacity-100"
          }`}
        >
          <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700 dark:border-slate-700">
            {group.rows.map((row) => (
              <AccountLedgerRow key={row.id} row={row} onClick={onSelect} {...(rowExtras ? rowExtras(row) : {})} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
