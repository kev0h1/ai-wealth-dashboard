"use client";

import { useId } from "react";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";

export interface UpcomingAccountsCardProps {
  accounts: UpcomingAccountSummary[];
  periodLabel: string;
  onOpen: (account: UpcomingAccountSummary) => void;
}

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500";

function money(value: number) {
  return `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function accountResult(account: UpcomingAccountSummary) {
  if (account.status === "short" && account.shortfall !== null) return `${money(account.shortfall)} short`;
  if (account.status === "unfunded" && account.shortfall !== null) return `${money(account.shortfall)} unfunded`;
  if (account.status === "covered" && account.closing !== null) return `${money(account.closing)} left`;
  return "Coverage unavailable";
}

function AccountResult({ account }: { account: UpcomingAccountSummary }) {
  const issue = account.status === "short" ? "bg-rose-500" : account.status === "unfunded" ? "bg-amber-500" : null;
  return <span className="flex min-w-0 shrink-0 items-center justify-end gap-1.5 text-right text-xs font-semibold text-slate-700 dark:text-slate-200">
    {issue && <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${issue}`} />}
    <span className={account.status === "unknown" ? "max-w-24 text-pretty text-slate-600 dark:text-slate-300" : "whitespace-nowrap"}>
      {account.status !== "unknown" && <span className="font-mono tabular-nums">{account.status === "covered" ? money(account.closing!) : money(account.shortfall!)}</span>}
      {account.status !== "unknown" ? ` ${account.status === "covered" ? "left" : account.status}` : "Coverage unavailable"}
    </span>
  </span>;
}

/**
 * Account-level evidence for the Upcoming hero. It receives already-derived
 * values only: this component must never alter the pooled runway calculation.
 */
export default function UpcomingAccountsCard({ accounts, periodLabel, onOpen }: UpcomingAccountsCardProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
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
            const result = accountResult(account);
            return <button
              key={account.id}
              type="button"
              onClick={() => onOpen(account)}
              aria-label={`Open ${account.bank}, ${account.name}: ${result}`}
              className={`grid min-h-11 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 active:opacity-70 dark:hover:bg-slate-700/50 ${focus}`}
            >
              <span className="shrink-0"><BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? account.bank.slice(0, 2).toUpperCase()} initialsSize={meta?.initialsSize} altText="" brandBg={meta?.bg} size={32} /></span>
              <span className="min-w-0">
                <span className="block break-words text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">{account.bank}</span>
                <span className="block break-words text-xs leading-4 text-slate-600 dark:text-slate-400">{account.name}</span>
              </span>
              <AccountResult account={account} />
            </button>;
          })}
        </div>
      )}
      {accounts.length > 0 && <p className="px-4 pb-4 pt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">Tap an account for its working.</p>}
    </section>
  );
}
