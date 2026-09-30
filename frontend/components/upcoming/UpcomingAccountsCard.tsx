"use client";

import { useId } from "react";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import { accountPlan, hasChosenPlanSource, remaining, type Plan } from "@/lib/upcomingPlans";

export interface UpcomingAccountsCardProps {
  accounts: UpcomingAccountSummary[];
  periodLabel: string;
  onOpen: (account: UpcomingAccountSummary) => void;
  plans?: Plan[];
  plansStatus?: "loading" | "error" | "ready";
  onPlan?: (id: string) => void;
  onRetry?: () => void;
}

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500";

function money(value: number) {
  return `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function accountResult(account: UpcomingAccountSummary, plans: Plan[]) {
  if (account.status === "short" && account.shortfall !== null) return `${money(account.shortfall)} short`;
  if (account.status === "unfunded" && account.shortfall !== null) return `${money(account.shortfall)} unfunded`;
  const result = accountPlan(account, plans);
  if (result.uncertain) return "Calculation needs checking";
  if (result.assigned.length && result.afterPlans !== null) return result.planGap! > 0 ? `${money(result.planGap! / 100)} for plans` : `${money(result.afterPlans / 100)} after plans`;
  if (account.status === "covered" && account.closing !== null) return `${money(account.closing)} left`;
  return "Coverage unavailable";
}

function AccountResult({ account, plans }: { account: UpcomingAccountSummary; plans: Plan[] }) {
  const result = accountPlan(account, plans);
  const issue = account.status === "short" ? "bg-rose-500" : account.status === "unfunded" || (result.planGap ?? 0) > 0 ? "bg-amber-500" : null;
  return <span className="flex min-w-0 shrink-0 items-center justify-end gap-1.5 text-right text-xs font-semibold text-slate-700 dark:text-slate-200">
    {issue && <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${issue}`} />}
    <span className={account.status === "unknown" || result.uncertain ? "max-w-28 text-pretty text-slate-600 dark:text-slate-300" : "font-mono tabular-nums"}>
      {accountResult(account, plans)}
    </span>
  </span>;
}

/**
 * Account-level evidence for the Upcoming hero. It receives already-derived
 * values only: this component must never alter the pooled runway calculation.
 */
export default function UpcomingAccountsCard({ accounts, periodLabel, onOpen, plans = [], plansStatus = "ready", onPlan, onRetry }: UpcomingAccountsCardProps) {
  const headingId = useId();
  const unassigned = plans.filter((plan) => plan.active && remaining(plan) > 0 && !hasChosenPlanSource(plan));
  const readyPlans = plansStatus === "ready" ? plans : [];

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
            const result = accountResult(account, readyPlans);
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
              <AccountResult account={account} plans={readyPlans} />
            </button>;
          })}
        </div>
      )}
      {plansStatus !== "ready" && <div className="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300" role="status">{plansStatus === "loading" ? "Loading goals and allocations. Figures show payments only." : "Goals and allocations could not be checked. Figures show payments only."}{plansStatus === "error" && onRetry && <button type="button" className={`ml-1 min-h-11 rounded-lg px-2 font-semibold text-indigo-600 dark:text-indigo-300 ${focus}`} onClick={onRetry}>Try again</button>}</div>}
      {plansStatus === "ready" && unassigned.length > 0 && <details className="border-t border-slate-100 px-4 dark:border-slate-700"><summary className={`min-h-11 cursor-pointer py-3 text-xs font-medium text-slate-700 dark:text-slate-200 ${focus}`}>{unassigned.length} {unassigned.length === 1 ? "plan needs a paying account" : "plans need paying accounts"}</summary><div className="pb-3">{unassigned.map((plan) => <button key={plan.id} type="button" onClick={() => onPlan?.(plan.id)} className={`min-h-11 w-full rounded-lg text-left text-sm font-medium ${focus}`}>{plan.name}<span className="block text-xs font-normal text-slate-600 dark:text-slate-400">{plan.evidence === "recent-transfers" && plan.sourceId ? "Suggested · choose paying account" : "Choose paying account"}</span></button>)}</div></details>}
      {accounts.length > 0 && <p className="px-4 pb-4 pt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">Tap an account for its working.</p>}
    </section>
  );
}
