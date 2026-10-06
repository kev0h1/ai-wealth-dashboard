"use client";

// The Home "Your estate" block (G221, approved C, 2026-10-06). The rows are
// the AccountLedgerRow rows with the brand-aware tidy name (lib/accountName.ts,
// Home only; the Accounts page keeps its raw names). There is no header link:
// one footer row, "All N accounts" ("See your account" for one), is the block's
// only route to /accounts. Pinned by `scripts/g221-home-cleanup.test.mjs`.

import type { CSSProperties, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { Account, InvestmentAccount } from "@/lib/api";
import AccountLedgerRow from "@/components/AccountLedgerRow";
import { bankToRow, investmentToRow } from "@/lib/accountsEstate";
import { tidyAccountName } from "@/lib/accountName";

export interface HomeEstateSectionProps {
  /** Wrapper classes and style, supplied by the page (rhythm and rise-in). */
  className?: string;
  style?: CSSProperties;
  loading: boolean;
  accountCount: number;
  topPickAccounts: Account[];
  topPickInvestment?: InvestmentAccount;
  /** Every account the user has, bank and investment, for the footer label. */
  totalAccountCount: number;
  pinnedIds: string[];
  onOpenAccount: (id: string) => void;
  onOpenInvestments: () => void;
  onViewAll: () => void;
  /** Rendered when the user has no bank accounts (the FirstAccountCard). */
  emptyState: ReactNode;
}

function tidyRow<T extends { name: string }>(row: T): T {
  return { ...row, name: tidyAccountName(row.name) };
}

export default function HomeEstateSection({
  className,
  style,
  loading,
  accountCount,
  topPickAccounts,
  topPickInvestment,
  totalAccountCount,
  pinnedIds,
  onOpenAccount,
  onOpenInvestments,
  onViewAll,
  emptyState,
}: HomeEstateSectionProps) {
  return (
    <div className={className} style={style}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Your estate</p>
      {loading ? (
        <div className="glass-card rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[60px] px-4 py-2.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-28 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                <div className="h-2.5 w-20 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
              </div>
              <div className="h-3.5 w-14 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : accountCount === 0 ? (
        emptyState
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden">
          {topPickAccounts.map((acc, i) => (
            <div key={acc.id} className={i > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}>
              <AccountLedgerRow
                row={tidyRow(bankToRow(acc, pinnedIds))}
                onClick={() => onOpenAccount(acc.id)}
              />
            </div>
          ))}
          {topPickInvestment && (
            <div key={topPickInvestment.id} className={topPickAccounts.length > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}>
              <AccountLedgerRow
                row={tidyRow(investmentToRow(topPickInvestment, pinnedIds))}
                onClick={onOpenInvestments}
              />
            </div>
          )}
          <button
            data-tutorial-id="tutorial-manage-link"
            data-accounts-route
            onClick={onViewAll}
            className={`w-full min-h-11 flex items-center justify-center gap-1 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 active:bg-slate-50 dark:active:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
              topPickAccounts.length + (topPickInvestment ? 1 : 0) > 0 ? "border-t border-slate-100 dark:border-white/5" : ""
            }`}
          >
            {totalAccountCount === 1 ? "See your account" : `All ${totalAccountCount} accounts`} <ChevronRight size={13} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
