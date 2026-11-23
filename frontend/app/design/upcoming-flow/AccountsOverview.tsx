"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Scenario } from "./types";
import { AccountAmount, AccountIdentity, AccountStatus, AccountWorking, focusClass, quietClass } from "./ui";

export default function AccountsOverview({ scenario, planWorking }: { scenario: Scenario; planWorking: Record<string, number> }) {
  const [expanded, setExpanded] = useState(false);
  const accounts = scenario.accounts.filter(account => account.purpose !== "card" && (account.purpose === "paying" || scenario.payments.some(payment => payment.accountId === account.id && payment.kind !== "card-charge")));
  const attention = accounts.filter(account => account.status !== "covered" && account.status !== "funding");
  const other = accounts.filter(account => account.status === "covered" || account.status === "funding");
  const accountRow = (account: Scenario["accounts"][number]) => <AccountWorking key={account.id} account={account} scenario={scenario} planPence={planWorking[account.id]} label={<span className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 max-[359px]:grid-cols-1" data-account-overview={account.id}>
    <span className="min-w-0"><AccountIdentity account={account} compact />{account.status !== "covered" && account.status !== "funding" && <span className="ml-10 mt-1.5 block"><AccountStatus account={account} /></span>}</span>
    <span className="max-w-[10.5rem] text-right max-[359px]:ml-10 max-[359px]:max-w-none max-[359px]:text-left"><AccountAmount account={account} /></span>
  </span>} />;
  return <section aria-labelledby="account-overview-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
    <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-4">
      <h2 id="account-overview-title" className="text-base font-bold">By account</h2>
      <p className={`text-xs ${quietClass}`}>Payments through Thu 26 Nov</p>
    </header>
    {attention.map(accountRow)}
    {other.length > 0 && <div className="border-t border-slate-200 dark:border-slate-700">
      <button type="button" aria-expanded={expanded} aria-controls="other-account-readings" onClick={() => setExpanded(value => !value)} className={`flex min-h-13 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50 active:opacity-70 dark:hover:bg-slate-700 ${focusClass}`} data-balanced-row="other-account-fold"><span data-row-content className="flex w-full items-center justify-between gap-3"><span>{other.length} {other.length === 1 ? "account is" : "accounts are"} fine</span><ChevronDown size={16} aria-hidden="true" className={expanded ? "rotate-180" : ""} /></span></button>
      <div id="other-account-readings" hidden={!expanded}>{other.map(accountRow)}</div>
    </div>}
  </section>;
}
