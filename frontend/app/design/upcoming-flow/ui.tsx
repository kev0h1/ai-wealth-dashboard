"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, CircleHelp, CircleMinus, Clock3 } from "lucide-react";
import { BankIcon, BANK_META, bankKey } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import { useBalancesHidden } from "@/lib/balancesHidden";
import UpcomingCategoryIcon from "@/components/upcoming/UpcomingCategoryIcon";
import { displayAccountName } from "@/lib/accountName";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { getCategoryColour } from "@/lib/categories";
import type { PreviewAccount, PreviewMove, PreviewPayment, Scenario } from "./types";

export const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 scroll-mb-28";
export const quietClass = "text-slate-600 dark:text-slate-300";
export const surfaceClass = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none";

export function bankLabel(account: PreviewAccount): string {
  return BANK_META[bankKey({ provider: account.bank })]?.label ?? displayAccountName(account.bank);
}
export const accountLabel = (account: PreviewAccount): string => displayAccountName(account.name);
export function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)).replace(",", "");
}
export function moneyText(pence: number, signed = false): string {
  const value = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(pence / 100).replace("-", "−");
  return signed && pence > 0 ? `+${value}` : value;
}
export function Money({ value, className = "", signed = false }: { value: number | null; className?: string; signed?: boolean }) {
  if (value === null) return <span className={`text-sm font-medium ${quietClass} ${className}`}>Unavailable</span>;
  return <span className={`font-mono tabular-nums ${className}`}><MoneyText text={moneyText(value, signed)} /></span>;
}
export function MoneyCopy({ text, className }: { text: string; className?: string }) {
  return <MoneyText text={text} className={className} />;
}
export function AccountIdentity({ account, compact = false }: { account: PreviewAccount; compact?: boolean }) {
  return <span className="flex min-w-0 items-center gap-3"><span className="shrink-0" aria-hidden="true"><BankIcon identity={{ provider: account.bank }} size={compact ? 28 : 32} altText="" /></span><span className="min-w-0"><strong className={`block text-pretty font-bold leading-5 ${compact ? "text-sm" : "text-base"}`}>{bankLabel(account)}</strong><span className={`mt-0.5 block text-pretty text-xs leading-5 ${quietClass}`}>{accountLabel(account)}</span></span></span>;
}
export function AccountStatus({ account }: { account: PreviewAccount }) {
  const tones = {
    short: "text-rose-700 dark:text-rose-300",
    move: "text-amber-800 dark:text-amber-200",
    funding: "text-indigo-700 dark:text-indigo-300",
    covered: "text-slate-600 dark:text-slate-300",
    checking: "text-slate-600 dark:text-slate-300",
    plans: "text-slate-600 dark:text-slate-300",
  };
  const Icon = account.status === "short" ? AlertTriangle : account.status === "covered" ? Check : account.status === "checking" ? Clock3 : account.status === "funding" ? ArrowRight : account.status === "plans" ? CircleMinus : CircleHelp;
  return <span data-account-status={account.status} className={`inline-flex items-center gap-1.5 text-xs font-semibold leading-5 ${tones[account.status]}`}><Icon size={14} className="shrink-0" aria-hidden="true" /><span>{account.statusLabel}</span></span>;
}
export function AccountAmount({ account }: { account: PreviewAccount }) {
  if (account.purpose === "card") return <span className={`block text-xs leading-5 ${quietClass}`}>Cash has not<br />left yet</span>;
  if (account.status === "checking") return <span aria-busy="true" className="block"><span aria-hidden="true" className="ml-auto block h-6 w-20 rounded-md bg-slate-100 dark:bg-slate-700" /><span className={`mt-1 block text-xs ${quietClass}`}>Figure pending</span></span>;
  const value = account.availabilityPence ?? (account.purpose === "source" ? account.cashNowPence : account.afterPaymentsPence);
  const label = account.availabilityLabel ?? (account.purpose === "source" ? "Bank balance" : "After payments");
  return <span className="block"><Money value={value} className="text-[19px] font-bold leading-7" /><span className={`mt-0.5 block max-w-[11rem] text-xs font-normal leading-5 ${quietClass}`}>{label}</span></span>;
}

function Disclosure({ label, children, name, className = "" }: { label: ReactNode; children: ReactNode; name: string; className?: string }) {
  return <details className={`group ${className}`}><summary data-balanced-row={name} className={`flex min-h-12 cursor-pointer list-none items-center border-t border-slate-200 px-4 py-3 text-sm font-semibold hover:bg-slate-50 active:opacity-70 dark:border-slate-700 dark:hover:bg-slate-700 ${focusClass} [&::-webkit-details-marker]:hidden`}><span data-row-content className="flex w-full items-center justify-between gap-3"><span>{label}</span><ChevronDown size={16} aria-hidden="true" className="shrink-0 group-open:rotate-180" /></span></summary><div className={`border-t border-slate-100 p-4 text-sm leading-6 dark:border-slate-700 ${quietClass}`}>{children}</div></details>;
}

export function AccountWorking({ account, scenario, label = "Account working" }: { account: PreviewAccount; scenario: Scenario; label?: ReactNode }) {
  const payments = scenario.payments.filter(payment => payment.accountId === account.id && payment.kind !== "card-charge" && payment.kind !== "settling");
  return <div data-working-account={account.id} id={`working-${account.id}`} className="scroll-mt-4"><Disclosure name={`working-${account.id}`} label={label}>
    {account.status === "checking" ? <p>This account’s figures are still being checked. Its result is not yet known.</p> : <>
      <dl className="space-y-3">
        {account.availabilityPence !== null && <div className="flex justify-between gap-4"><dt>{account.availabilityLabel}</dt><dd className="shrink-0"><Money value={account.availabilityPence} className="font-semibold" /></dd></div>}
        <div className="flex justify-between gap-4"><dt>Bank balance to start</dt><dd className="shrink-0"><Money value={account.cashNowPence} /></dd></div>
        <div className="flex justify-between gap-4"><dt>After expected payments</dt><dd className="shrink-0"><Money value={account.afterPaymentsPence} /></dd></div>
        <div className="flex justify-between gap-4"><dt>Lowest payment balance</dt><dd className="shrink-0"><Money value={account.paymentLowPence} /></dd></div>
        {!!account.earmarkedPence && <div className="flex justify-between gap-4"><dt>Reserved for suggested moves</dt><dd className="shrink-0"><Money value={account.earmarkedPence} /></dd></div>}
        {!!account.planGapPence && <div className="flex justify-between gap-4"><dt>Still to cover for plans</dt><dd className="shrink-0"><Money value={account.planGapPence} /></dd></div>}
      </dl>
      <p className="mt-4 text-xs leading-5">The payment balances below show this account before any suggested move. Availability is a separate account reading. A suggestion is not money received.</p>
      {account.requiresMove && <p className="mt-2 text-xs leading-5">The available figure already allows for the suggested incoming move. It depends on you making it.</p>}
      {!!account.earmarkedPence && <p className="mt-2 text-xs leading-5">The available figure already leaves out the money reserved for these suggestions. Do not deduct it again.</p>}
      {payments.length > 0 && <dl className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">{payments.map(payment => <div key={payment.id} className="flex items-start justify-between gap-4"><dt className="min-w-0 text-pretty">{payment.name}<span className="block text-xs">{dateLabel(payment.date)}{payment.credited === false ? " · expected, not counted" : ""}</span></dt><dd className="shrink-0"><Money value={payment.afterPence} /></dd></div>)}</dl>}
    </>}
    <p className="mt-4 text-xs leading-5">Payments can take a day or two to appear, so a very recent one may not be counted yet.</p>
  </Disclosure></div>;
}

export function MoveRoute({ move, scenario, showProof = true }: { move: PreviewMove; scenario: Scenario; showProof?: boolean }) {
  const from = scenario.accounts.find(account => account.id === move.fromId);
  const to = scenario.accounts.find(account => account.id === move.toId);
  if (!from || !to) return null;
  return <div data-suggested-move={move.id} data-balanced-row={`move-${move.id}`}>
    <div data-row-content>
      <div className="mb-3 flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Suggested move</p><p className={`mt-1 text-xs ${quietClass}`}>{move.byDate ? `By ${dateLabel(move.byDate)}` : "Date not set"}</p></div><Money value={move.amountPence} className="shrink-0 text-[19px] font-bold" /></div>
      <div className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] items-center gap-3"><p className="text-sm font-semibold text-pretty"><span className={`block text-xs font-normal ${quietClass}`}>From</span>{bankLabel(from)}<span className={`block text-xs font-normal ${quietClass}`}>{accountLabel(from)}{move.savings ? " · savings" : ""}</span></p><ArrowRight size={16} aria-hidden="true" className={quietClass} /><p className="text-sm font-semibold text-pretty"><span className={`block text-xs font-normal ${quietClass}`}>To</span>{bankLabel(to)}<span className={`block text-xs font-normal ${quietClass}`}>{accountLabel(to)}</span></p></div>
      {move.remainingGapPence > 0 ? <p className={`mt-3 text-xs leading-5 ${quietClass}`}><MoneyCopy text={`${moneyText(move.remainingGapPence)} is still uncovered after this suggestion.`} /></p> : <p className={`mt-3 text-xs leading-5 ${quietClass}`}>Would cover the payments shown for this account.</p>}
      {showProof && <details className="group mt-3 border-t border-slate-200 dark:border-slate-700"><summary data-balanced-row={`source-proof-${move.id}`} className={`flex min-h-11 cursor-pointer list-none items-center py-3 text-xs font-semibold hover:text-indigo-700 dark:hover:text-indigo-300 ${focusClass} [&::-webkit-details-marker]:hidden`}><span data-row-content className="flex w-full items-center justify-between gap-3"><span>Why this account can fund it</span><ChevronDown size={15} aria-hidden="true" className="group-open:rotate-180" /></span></summary><p className={`pb-3 text-xs leading-5 ${quietClass}`}><MoneyCopy text={move.sourceProof} /></p></details>}
    </div>
  </div>;
}

export function PaymentRow({ payment, scenario, showAccount = true }: { payment: PreviewPayment; scenario: Scenario; showAccount?: boolean }) {
  const account = scenario.accounts.find(candidate => candidate.id === payment.accountId);
  const Icon = getCategoryIcon(payment.category, {});
  const isCash = payment.kind === "payment" || payment.kind === "transfer";
  const gapStarts = isCash && payment.firstGapPence !== undefined;
  const conditional = account?.status === "move";
  const qualifier = payment.kind === "card-charge" ? "Card charge · not a cash payment" : payment.kind === "settling" ? "Settling · already included" : payment.credited === false ? "Expected, not counted" : payment.kind === "transfer" ? "Own-account payment" : "";
  return <div data-payment={payment.id} data-payment-account={payment.accountId} className="py-3" data-balanced-row={`payment-${payment.id}`}>
    <div data-row-content><div className="flex items-center gap-3"><UpcomingCategoryIcon Icon={Icon} colour={getCategoryColour(payment.category, {})} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold leading-5 text-pretty">{payment.name}</p>{showAccount && account && <p className={`mt-0.5 text-xs leading-5 text-pretty ${quietClass}`}>{bankLabel(account)} · {accountLabel(account)}</p>}{qualifier && <p className={`mt-0.5 text-xs leading-5 ${quietClass}`}>{qualifier}</p>}</div><Money value={payment.amountPence} signed className="shrink-0 text-sm font-semibold" /></div>
      {gapStarts && <div data-gap-start={payment.accountId} className="mt-2 flex items-start gap-2 text-xs leading-5"><AlertTriangle size={14} aria-hidden="true" className={`mt-0.5 shrink-0 ${conditional ? "text-amber-700 dark:text-amber-200" : "text-rose-700 dark:text-rose-300"}`} /><p>{conditional ? "The suggested move needs to arrive before this payment." : <><strong>Gap starts here.</strong> <MoneyCopy text={`${moneyText(-payment.firstGapPence!)} after this payment${account?.requiresMove ? ", before the suggested move" : ""}.`} /></>}</p></div>}
    </div>
  </div>;
}

export function PlansArea({ scenario }: { scenario: Scenario }) {
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const hidden = useBalancesHidden();
  const unassigned = scenario.plans.filter(plan => !plan.sourceId);
  const assigned = scenario.plans.filter(plan => !!plan.sourceId);
  const eligible = scenario.accounts.filter(account => account.canPayPlan && account.status !== "checking");
  return <section id="upcoming-plans" className="scroll-mt-5" aria-labelledby="plans-title"><div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h2 id="plans-title" className="text-base font-bold">Plans and set-asides</h2><p className={`text-xs ${quietClass}`}>{unassigned.length ? `${unassigned.length} needs a paying account` : "This pay period"}</p></div>
    {scenario.plans.length === 0 ? <p className={`text-sm leading-6 ${quietClass}`}>No plans are due this pay period.</p> : <div className={`${surfaceClass} overflow-hidden`}>
      {assigned.map(plan => { const account = scenario.accounts.find(candidate => candidate.id === plan.sourceId); return <div key={plan.id} className="border-b border-slate-200 p-4 last:border-b-0 dark:border-slate-700" data-balanced-row={`plan-${plan.id}`}><div data-row-content className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold">{plan.name}</p><p className={`mt-1 text-xs leading-5 ${quietClass}`}>{account ? `Paid from ${bankLabel(account)} · ${accountLabel(account)}` : "Paying account needs checking"}{plan.uncertain ? " · amount needs checking" : ""}</p></div><Money value={plan.amountPence} className="shrink-0 text-[19px] font-bold" /></div></div>; })}
      {unassigned.map(plan => <div key={plan.id} className="border-t border-slate-200 first:border-t-0 dark:border-slate-700"><div className="p-4" data-balanced-row={`plan-${plan.id}`}><div data-row-content className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-sm font-semibold text-pretty">{plan.name}</p><p className={`mt-1 text-xs leading-5 ${quietClass}`}>Not yet assigned to an account</p></div><div className="shrink-0 text-right"><Money value={plan.amountPence} className="text-[19px] font-bold" /><p className={`mt-0.5 text-xs ${quietClass}`}>this period</p></div></div></div>
        <Disclosure name={`plan-payer-${plan.id}`} label="Choose paying account"><fieldset><legend className="mb-2 text-sm font-semibold">Which account pays this goal?</legend><div className="space-y-2">{eligible.map(account => <label key={account.id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-500 dark:border-slate-600 dark:hover:bg-slate-700`}><input name={`payer-${plan.id}`} type="radio" value={account.id} checked={chosen[plan.id] === account.id} onChange={() => setChosen(current => ({ ...current, [plan.id]: account.id }))} className="size-4 accent-indigo-600" /><span className="min-w-0 text-pretty">{bankLabel(account)} · {accountLabel(account)}</span></label>)}</div></fieldset><p role="status" className="mt-3 text-xs leading-5">{chosen[plan.id] ? "Selected for this preview. Account figures have not been recalculated." : "This goal needs a source before it can be attributed to an account."}</p></Disclosure>
      </div>)}
    </div>}
    <p className={`mt-3 text-xs leading-5 ${quietClass}`}>{hidden ? "Amounts are hidden. " : ""}{unassigned.length > 0 ? "The goal is not included in any account reading until you choose where it is paid from." : "Plans are shown against the account they are paid from."}</p>
  </section>;
}
