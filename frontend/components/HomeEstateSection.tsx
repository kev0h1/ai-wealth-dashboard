"use client";

// The Home "Your estate" block, extracted UNCHANGED from
// app/components/HomePage.tsx (G221) so a /design preview can render the
// production markup through props. Same classes, same structure: the Manage
// header link, the loading skeleton, the empty state slot, the AccountLedgerRow
// rows (bankToRow / investmentToRow, names untouched) and the "+N more accounts"
// footer row. `scripts/g221-home-cleanup.test.mjs` pins the output against the
// pre-extraction markup. Do not restyle here: design changes go through
// frontend/app/design/home-cleanup first.

import type { CSSProperties, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { Account, InvestmentAccount } from "@/lib/api";
import AccountLedgerRow from "@/components/AccountLedgerRow";
import { bankToRow, investmentToRow } from "@/lib/accountsEstate";

export interface HomeEstateSectionProps {
  /** Wrapper classes and style, supplied by the page (rhythm and rise-in). */
  className?: string;
  style?: CSSProperties;
  loading: boolean;
  accountCount: number;
  topPickAccounts: Account[];
  topPickInvestment?: InvestmentAccount;
  investmentCount: number;
  hiddenAccountCount: number;
  pinnedIds: string[];
  onManage: () => void;
  onOpenAccount: (id: string) => void;
  onOpenInvestments: () => void;
  onViewAll: () => void;
  /** Rendered when the user has no bank accounts (the FirstAccountCard). */
  emptyState: ReactNode;
}

export default function HomeEstateSection({
  className,
  style,
  loading,
  accountCount,
  topPickAccounts,
  topPickInvestment,
  investmentCount,
  hiddenAccountCount,
  pinnedIds,
  onManage,
  onOpenAccount,
  onOpenInvestments,
  onViewAll,
  emptyState,
}: HomeEstateSectionProps) {
  return (
    <div className={className} style={style}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Your estate</p>
        <div className="flex items-center gap-2">
          <button
            data-tutorial-id="tutorial-manage-link"
            onClick={onManage}
            className="min-h-[44px] text-xs font-semibold text-indigo-500 dark:text-indigo-400 flex items-center gap-1 hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
          >
            Manage <ChevronRight size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
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
                row={bankToRow(acc, pinnedIds)}
                onClick={() => onOpenAccount(acc.id)}
              />
            </div>
          ))}
          {topPickInvestment && (
            <div key={topPickInvestment.id} className={topPickAccounts.length > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}>
              <AccountLedgerRow
                row={investmentToRow(topPickInvestment, pinnedIds)}
                onClick={onOpenInvestments}
              />
            </div>
          )}
          {hiddenAccountCount > 0 && (
            <button
              onClick={onViewAll}
              className={`w-full min-h-[52px] flex items-center justify-center gap-1 px-4 py-2.5 text-sm font-medium text-slate-400 dark:text-slate-500 active:bg-slate-50 dark:active:bg-white/5 transition-colors ${
                topPickAccounts.length + Math.min(investmentCount, 1) > 0 ? "border-t border-slate-100 dark:border-white/5" : ""
              }`}
            >
              +{hiddenAccountCount} more accounts <ChevronRight size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
