"use client";

// G236 fold-in of the approved "A, Verdict header" (Kevin 2026-10-10): the
// Accounts page header is the title, then Net worth as the one Display figure
// with an "across N accounts" caption, on the canvas (Canvas Before Cards). No
// eye: balances are hidden by the one global hide-balances preference (Settings
// switch), and while hidden a "Balances hidden · Show" chip sits under the
// figure and turns the same preference off. Add is the floating action in
// components/AccountsAddFab.tsx, not part of the header. State stays in
// AccountsPage; the header is pure props so check:g236-accounts-fold-in can
// render it.

import { EyeOff } from "lucide-react";

export interface AccountsHeaderNetWorth {
  value: number;
  /** Every account counted in the figure: banks, investments and offline. */
  accountCount: number;
}

export interface AccountsHeaderProps {
  /** Null until the KPIs have loaded: no Net worth block. */
  netWorth: AccountsHeaderNetWorth | null;
  /** The figure is masked (global hide-balances preference, or not yet resolved). */
  hidden: boolean;
  /** Show the "Balances hidden · Show" chip (preference resolved and on). */
  showChip: boolean;
  /** Turns the global hide-balances preference off. */
  onShow: () => void;
}

export default function AccountsHeader({ netWorth, hidden, showChip, onShow }: AccountsHeaderProps) {
  const text = netWorth
    ? hidden
      ? "£••••"
      : `${netWorth.value < 0 ? "−" : ""}£${Math.abs(netWorth.value).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
    : "";
  return (
    <header className="mb-4">
      <h1 className="text-[20px] font-bold leading-tight text-slate-950 dark:text-white">Accounts</h1>
      {netWorth && (
        // Net worth is a position, not a risk: it stays hero-white even when
        // negative (Red Is Risk keeps red for genuine risk states).
        <div className="mt-5" data-tutorial-id="tutorial-networth">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Net worth</p>
          <p className="money mt-1 text-[30px] font-bold leading-[1.2] tracking-[-0.025em] text-slate-950 dark:text-white">
            <span aria-hidden="true">{text}</span>
            <span className="sr-only">{hidden ? "Balance hidden" : text}</span>
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            across {netWorth.accountCount} {netWorth.accountCount === 1 ? "account" : "accounts"}
          </p>
          {showChip && (
            <button
              type="button"
              data-hidden-chip
              onClick={onShow}
              className="mt-1 inline-flex min-h-11 items-center rounded-xl active:scale-95 transition-transform motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300">
                <EyeOff size={13} aria-hidden="true" />
                Balances hidden · Show
              </span>
            </button>
          )}
        </div>
      )}
    </header>
  );
}
