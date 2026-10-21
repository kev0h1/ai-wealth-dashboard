"use client";

import type { ReactNode } from "react";
import { Wallet } from "lucide-react";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import { useBalancesHidden } from "@/lib/balancesHidden";
import { tidyAccountName } from "@/lib/accountName";
import type { Account } from "@/lib/api";

const money = (amount: number) => `${amount < 0 ? "−" : ""}£${Math.abs(amount).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;

function AccountIdentity({ account }: { account: Account }) {
  const brand = accountBrand(account);
  return <span className="flex min-w-0 items-center gap-3">
    <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText="" brandBg={brand.background} size={32} />
    <span className="min-w-0"><strong className="block break-words font-semibold text-slate-900 dark:text-slate-100">{tidyAccountName(account.name)}</strong><span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-300">{account.provider}</span></span>
  </span>;
}

/** The approved G291 record layout. Read-only facts, not an editor disguised
 * as a view. Its host owns actions, navigation and the single physical sheet. */
export function PlanRecordView({ kind, contribution, cadence, frequency, target, progress, sourceAccount, destinationAccounts = [], trackingLabel, paused = false, periodNote, children, sourceUnavailable = false, destinationUnavailable = false }: {
  kind: "goal" | "set-aside";
  contribution: number;
  cadence: string;
  frequency?: string;
  target?: { amount: number; month: string };
  progress?: number;
  sourceAccount?: Account;
  destinationAccounts?: Account[];
  trackingLabel: string;
  paused?: boolean;
  periodNote?: string;
  children?: ReactNode;
  sourceUnavailable?: boolean;
  destinationUnavailable?: boolean;
}) {
  const hidden = useBalancesHidden();
  const percent = target && target.amount > 0 ? Math.min(100, Math.max(0, (progress ?? 0) / target.amount * 100)) : 0;
  return <div data-plan-record className="min-w-0 space-y-5">
    {paused && <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Paused</p>}
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 max-[359px]:grid-cols-1">
      <section aria-label="Contribution" className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Contribution</p><p className="mt-1 text-[30px] font-bold tracking-tight text-slate-900 dark:text-slate-100"><MoneyText text={money(contribution)} /></p><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{paused ? "paused in Sorted" : cadence}</p></section>
      <div className="max-w-36 justify-self-end text-right"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{target ? "Target" : "How often"}</p>{target ? <><p className="mt-2 text-[19px] font-bold text-slate-900 dark:text-slate-100"><MoneyText text={money(target.amount)} /></p><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{target.month}</p></> : <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{frequency ?? cadence}</p>}</div>
    </div>
    {target && <section aria-label="Goal progress" className="space-y-2"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300"><span>Set aside</span><MoneyText text={`${money(progress ?? 0)} of ${money(target.amount)}`} /></div><div role="progressbar" aria-label="Goal progress" aria-valuemin={0} aria-valuemax={hidden ? 100 : target.amount} aria-valuenow={hidden ? undefined : Math.min(progress ?? 0, target.amount)} aria-valuetext={hidden ? "Amount hidden" : `${money(progress ?? 0)} of ${money(target.amount)}`} className="h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className="block h-full rounded-full bg-indigo-600" style={{ width: `${hidden ? 0 : percent}%` }} /></div>{periodNote && <p className="text-xs leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={periodNote} /></p>}</section>}
    <dl className="divide-y divide-slate-200 border-y border-slate-200 text-sm dark:divide-slate-700 dark:border-slate-700">
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 py-3"><dt className="text-slate-600 dark:text-slate-300">Pay from</dt><dd className="min-w-0">{sourceAccount ? <AccountIdentity account={sourceAccount} /> : sourceUnavailable ? "Account details unavailable" : "Paying account not linked"}</dd></div>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 py-3"><dt className="text-slate-600 dark:text-slate-300">{kind === "goal" ? "Save in" : "Money"}</dt><dd className="min-w-0 space-y-3">{destinationAccounts.map(account => <AccountIdentity key={account.id} account={account} />)}{destinationUnavailable ? <span>Account details unavailable</span> : !destinationAccounts.length && <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100"><Wallet size={18} aria-hidden="true" />{kind === "goal" ? "No savings account linked" : "Stays here"}</span>}</dd></div>
    </dl>
    <section className="space-y-2" aria-label="Plan tracking"><div className="flex min-w-0 items-baseline justify-between gap-3"><h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Tracking</h3><strong className="min-w-0 break-words text-right text-sm text-slate-900 dark:text-slate-100">{trackingLabel}</strong></div>{children}</section>
    <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">This is a plan. You move the money in your bank. Any standing order will keep running.</p>
    {kind === "set-aside" && <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">Check Upcoming to see if it fits before payday.</p>}
  </div>;
}
