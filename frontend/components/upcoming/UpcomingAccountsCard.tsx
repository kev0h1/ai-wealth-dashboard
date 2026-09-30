"use client";

import { useId } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import type { Plan } from "@/lib/upcomingPlans";
import { money, statusFor, type AccountStatus } from "@/lib/upcomingAccountStatus";

export interface UpcomingAccountsCardProps {
  accounts: UpcomingAccountSummary[];
  periodLabel: string;
  onOpen: (account: UpcomingAccountSummary) => void;
  plans?: Plan[];
  plansStatus?: "loading" | "error" | "ready";
  onRetry?: () => void;
}

const focus = "touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500";

function Signal({ signal }: { signal: AccountStatus["signal"] }) {
  const colour = signal === "risk" ? "text-rose-600 dark:text-rose-400" : signal === "unknown" ? "text-slate-500 dark:text-slate-400" : "text-amber-700 dark:text-amber-400";
  const Icon = signal === "risk" ? TriangleAlert : Info;
  return <span data-status-signal={signal ?? "none"} aria-hidden="true" className={`col-start-3 row-start-1 flex h-5 w-4 items-center justify-center ${colour}`}>
    {signal && <Icon size={14} strokeWidth={2} />}
  </span>;
}

/**
 * Account-level evidence for the Upcoming hero. It receives already-derived
 * values only: this component must never alter the pooled runway calculation.
 */
export default function UpcomingAccountsCard({ accounts, periodLabel, onOpen, plans = [], plansStatus = "ready", onRetry }: UpcomingAccountsCardProps) {
  const headingId = useId();
  const readyPlans = plansStatus === "ready" ? plans : [];

  return (
    <section aria-labelledby={headingId} data-account-status-card="b" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="px-4 pb-3 pt-4">
        <h2 id={headingId} className="text-base font-bold text-slate-950 dark:text-slate-50">By account</h2>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{periodLabel}</p>
      </div>
      {accounts.length === 0 ? (
        <p className="border-t border-slate-100 px-4 py-4 text-sm leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">No account payments are expected in this period.</p>
      ) : (
        <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700 dark:border-slate-700">
          {accounts.map((account) => {
            const meta = BANK_META[bankKey({ provider: account.bank })];
            const result = statusFor(account, readyPlans);
            return <button
              key={account.id}
              type="button"
              data-account-row={account.id}
              onClick={() => onOpen(account)}
              aria-label={`Open ${account.bank}, ${account.name}: ${result.amount === null ? result.label : `${money(result.amount)}, ${result.label.toLowerCase()}`}${result.estimated ? ", estimated" : ""}`}
              className={`grid min-h-16 w-full grid-cols-[2rem_minmax(0,1fr)_1rem_minmax(0,8rem)] items-start gap-x-2 px-3 py-3 text-left hover:bg-slate-50 active:opacity-70 min-[360px]:px-4 dark:hover:bg-slate-700/50 ${focus}`}
            >
              <span data-bank-badge className="col-start-1 row-span-3 row-start-1 w-8 pt-0.5"><BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? account.bank.slice(0, 2).toUpperCase()} initialsSize={meta?.initialsSize} altText="" brandBg={meta?.bg} size={32} /></span>
              <span className="col-start-2 row-span-3 row-start-1 min-w-0 pr-1">
                <span className="block break-words text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">{account.bank}</span>
                <span className="mt-0.5 block break-words text-xs leading-4 text-slate-600 dark:text-slate-400">{account.name}</span>
              </span>
              <Signal signal={result.signal} />
              <span data-status-amount className={`col-start-4 row-start-1 whitespace-nowrap text-right text-sm font-bold leading-5 text-slate-900 dark:text-slate-100 ${result.amount === null ? "font-sans" : "font-mono tabular-nums"}`}>{result.amount === null ? "Unavailable" : money(result.amount)}</span>
              <span data-status-caption className="col-span-2 col-start-3 row-start-2 mt-0.5 text-right font-sans text-xs leading-4 text-slate-600 dark:text-slate-300">{result.label}</span>
              {result.estimated && <span data-status-estimate className="col-span-2 col-start-3 row-start-3 text-right font-sans text-xs leading-4 text-slate-600 dark:text-slate-400">Estimated</span>}
            </button>;
          })}
        </div>
      )}
      {plansStatus !== "ready" && <div className="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300" role="status">{plansStatus === "loading" ? "Loading goals and allocations. Figures show payments only." : "Goals and allocations could not be checked. Figures show payments only."}{plansStatus === "error" && onRetry && <button type="button" className={`ml-1 min-h-11 rounded-lg px-2 font-semibold text-indigo-600 hover:bg-indigo-50 active:opacity-70 dark:text-indigo-300 dark:hover:bg-indigo-400/10 ${focus}`} onClick={onRetry}>Try again</button>}</div>}
      {accounts.length > 0 && <p className="px-4 pb-4 pt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">Tap an account for its working.</p>}
    </section>
  );
}
