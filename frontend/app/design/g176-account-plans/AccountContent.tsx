"use client";

import { ArrowDownLeft, ArrowLeftRight, Check, ChevronDown, ChevronRight, CreditCard, ReceiptText, Target, Wallet } from "lucide-react";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import { accountPlan, dateLabel, money, remaining, type Plan, type Variant } from "./fixtures";

export const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
export const primaryButton = `flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 ${focus}`;
export const secondaryButton = `flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800 ${focus}`;
const ink = "font-mono tabular-nums text-slate-950 dark:text-slate-50";
const muted = "text-slate-600 dark:text-slate-400";

export function PlanIcon({ kind }: { kind: Plan["kind"] }) {
  const Icon = kind === "goal" ? Target : Wallet;
  return <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300"><Icon size={18} aria-hidden="true" /></span>;
}

export function LedgerLine({ label, pence, total = false }: { label: string; pence: number | null; total?: boolean }) {
  return <div className={`flex items-baseline justify-between gap-4 py-2 ${total ? "border-t border-slate-200 font-semibold dark:border-slate-700" : ""}`}>
    <dt className={total ? "text-slate-900 dark:text-slate-100" : muted}>{label}</dt>
    <dd className={`shrink-0 text-right ${ink}`}>{pence === null ? "Unavailable" : money(pence)}</dd>
  </div>;
}

function PlanRow({ plan, onOpen }: { plan: Plan; onOpen: (id: string) => void }) {
  const unassigned = !plan.sourceId || plan.evidence === "unknown";
  return <li>
    <button type="button" data-flow-focus={`plan-${plan.id}`} onClick={() => onOpen(plan.id)} className={`grid min-h-16 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_0.75rem] items-center gap-3 rounded-lg py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 ${focus}`}>
      <PlanIcon kind={plan.kind} />
      <span className="min-w-0"><span className="block break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{plan.name}</span><span className={`mt-0.5 block text-xs leading-5 ${muted}`}>{unassigned ? "Choose paying account" : plan.kind === "goal" ? "Goal · this period" : `${money(plan.filledPence)} of ${money(plan.periodPence)} set aside`}</span></span>
      <span className="text-right"><span className={`block text-sm font-semibold ${ink}`}>{money(unassigned ? remaining(plan) : -remaining(plan))}</span><span className={`block text-xs ${muted}`}>{unassigned ? "unassigned" : "to set aside"}</span></span>
      <ChevronRight size={14} className={muted} aria-hidden="true" />
    </button>
  </li>;
}

function PaymentActivity({ account }: { account: UpcomingAccountSummary }) {
  return <section aria-labelledby="cash-activity-heading">
    <div className="flex items-baseline justify-between gap-4"><h3 id="cash-activity-heading" className="text-sm font-semibold">Payments &amp; income</h3><span className={`text-xs ${muted}`}>{account.events.length} expected</span></div>
    <ul className="mt-1 divide-y divide-slate-200 dark:divide-slate-700">
      {account.events.map((event) => {
        const incoming = event.kind === "income" || event.kind === "inflow";
        const Icon = incoming ? ArrowDownLeft : event.kind === "movement" ? ArrowLeftRight : ReceiptText;
        return <li key={event.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 py-3">
          <span className={`flex size-9 items-center justify-center rounded-xl ${incoming ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300"}`}><Icon size={18} aria-hidden="true" /></span>
          <span className="min-w-0"><span className="block break-words text-sm font-medium">{event.name}</span><span className={`mt-0.5 block text-xs ${muted}`}>{dateLabel(event.date)}</span></span>
          <span className={`shrink-0 text-sm ${ink}`}>{money(Math.round(event.amount * 100), incoming)}</span>
        </li>;
      })}
    </ul>
  </section>;
}

function Calculation({ account, plans }: { account: UpcomingAccountSummary; plans: Plan[] }) {
  const result = accountPlan(account, plans);
  return <dl className="text-sm">
    <LedgerLine label="Cash now" pence={account.opening === null ? null : Math.round(account.opening * 100)} />
    {account.income > 0 && <LedgerLine label="Expected income" pence={Math.round(account.income * 100)} />}
    {account.transfersIn > 0 && <LedgerLine label="Transfers in" pence={Math.round(account.transfersIn * 100)} />}
    <LedgerLine label="Payments to come" pence={-Math.round(account.outgoing * 100)} />
    <LedgerLine label="After payments" pence={result.afterPayments} total />
    {result.allocationPence > 0 && <LedgerLine label="Allocations still to set aside" pence={-result.allocationPence} />}
    {result.goalPence > 0 && <LedgerLine label="Goal contributions this period" pence={-result.goalPence} />}
    {result.reservedPence > 0 && <LedgerLine label="After payments and plans" pence={result.afterPlans} total />}
  </dl>;
}

function Verdict({ account, plans }: { account: UpcomingAccountSummary; plans: Plan[] }) {
  const result = accountPlan(account, plans);
  if (account.status === "unknown") return <div className="space-y-2"><h3 className="text-base font-semibold">Balance needs checking</h3><p className={`text-sm leading-6 ${muted}`}>We can show your plans, but not whether this account can fund them until its balance is available.</p></div>;
  if (account.status === "short") return <div className="space-y-2"><p className="flex items-center gap-2 text-sm font-semibold"><span className="size-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden="true" />{money(Math.round(account.shortfall! * 100))} needed for payments</p><p className={`text-xs leading-5 ${muted}`}>First shortfall {dateLabel(account.firstShortDate!)}. Goals and allocations are separate from this bill gap.</p></div>;
  if (result.unassigned.length > 0) return <div className="space-y-2"><p className="flex items-center gap-2 text-sm font-semibold"><span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />Paying accounts need linking</p><p className={`text-xs leading-5 ${muted}`}>Unassigned plans are not deducted from this account. The receiving pot alone cannot tell us where the money will leave.</p></div>;
  if ((result.planGap ?? 0) > 0) return <div className="space-y-2"><p className="flex items-center gap-2 text-sm font-semibold"><span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />{money(result.planGap!)} more needed for plans</p><p className={`text-xs leading-5 ${muted}`}>Payments are covered. You can adjust your set-asides or add money before completing them.</p></div>;
  return <p className="flex items-center gap-2 text-sm font-medium"><Check size={16} className={muted} aria-hidden="true" />{result.assigned.length ? "Payments and linked plans fit" : "Payments are covered"}</p>;
}

export default function AccountContent({ account, plans, variant, onPlan }: { account: UpcomingAccountSummary; plans: Plan[]; variant: Variant; onPlan: (id: string) => void }) {
  const result = accountPlan(account, plans);
  const title = result.reservedPence > 0 ? "After payments and plans" : "After payments";
  const figure = result.reservedPence > 0 ? result.afterPlans : result.afterPayments;
  const compactFigure = (pence: number | null) => pence !== null && money(pence).length > 8 ? "text-base sm:text-xl" : "text-2xl";
  const linked = result.assigned.length === 0 && result.unassigned.length > 0 ? null : <section aria-labelledby="account-plans-heading">
    <div className="flex items-baseline justify-between gap-3"><h3 id="account-plans-heading" className="text-sm font-semibold">Still to set aside</h3>{result.assigned.length > 0 && <span className={`text-xs ${muted}`}>This account</span>}</div>
    {result.assigned.length > 0 ? <ul className="mt-1 divide-y divide-slate-200 dark:divide-slate-700">{result.assigned.map((plan) => <PlanRow key={plan.id} plan={plan} onOpen={onPlan} />)}</ul> : <p className={`py-3 text-sm ${muted}`}>{result.unassigned.length ? "No paying account confirmed for these plans yet." : "No goals or allocations linked to this account for this period."}</p>}
  </section>;

  return <div className="space-y-6 text-slate-950 dark:text-slate-50">
    {variant === "a" ? <section className="space-y-3" aria-label="Account plan result">
      <div><p className={`text-xs font-medium ${muted}`}>{title}</p><p data-account-plan-figure className={`mt-1 text-4xl font-bold leading-tight tracking-tight ${ink}`}>{figure === null ? "Unavailable" : money(figure)}</p>{result.reservedPence > 0 && <p className={`mt-1 text-xs ${muted}`}>If you complete the linked plans below</p>}</div>
      <Verdict account={account} plans={plans} />
    </section> : <section className="space-y-4" aria-label="Account plan result">
      <div className={`grid gap-4 ${result.reservedPence > 0 ? "grid-cols-2 divide-x divide-slate-200 dark:divide-slate-700" : "grid-cols-1"}`}>
        <div><p className={`text-xs ${muted}`}>After payments</p><p data-account-plan-figure={result.reservedPence === 0 ? true : undefined} className={`mt-1 font-semibold tracking-tight ${compactFigure(result.afterPayments)} ${ink}`}>{result.afterPayments === null ? "Unknown" : money(result.afterPayments)}</p></div>
        {result.reservedPence > 0 && <div className="pl-4"><p className={`text-xs ${muted}`}>After linked plans</p><p data-account-plan-figure className={`mt-1 font-bold tracking-tight ${compactFigure(result.afterPlans)} ${ink}`}>{result.afterPlans === null ? "Unknown" : money(result.afterPlans)}</p></div>}
      </div>
      <Verdict account={account} plans={plans} />
    </section>}

    {variant === "a" ? <>
      <details className="group border-y border-slate-200 dark:border-slate-700">
        <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg text-sm font-medium [&::-webkit-details-marker]:hidden ${focus}`}>How this adds up<ChevronDown size={16} className="group-open:rotate-180" aria-hidden="true" /></summary>
        <div className="pb-3"><Calculation account={account} plans={plans} /></div>
      </details>
      {linked}
    </> : <section aria-labelledby="account-working-heading"><h3 id="account-working-heading" className="mb-2 text-sm font-semibold">Account calculation</h3><Calculation account={account} plans={plans} /><div className="mt-5">{linked}</div></section>}

    {result.unassigned.length > 0 && <section aria-labelledby="unassigned-heading" className="border-t border-slate-200 pt-4 dark:border-slate-700"><h3 id="unassigned-heading" className="text-sm font-semibold">Not assigned to an account</h3><ul className="mt-1 divide-y divide-slate-200 dark:divide-slate-700">{result.unassigned.map((plan) => <PlanRow key={plan.id} plan={plan} onOpen={onPlan} />)}</ul></section>}
    <PaymentActivity account={account} />
    <p className={`text-xs leading-5 ${muted}`}>Only the amount still to set aside is included. Goal contributions are plans, not scheduled bank payments. This account view does not change the payday forecast.</p>
  </div>;
}

export function PlanContent({ plan, accountName }: { plan: Plan; accountName: string | null }) {
  const rest = remaining(plan);
  return <div className="space-y-6 text-slate-950 dark:text-slate-50">
    <div><p className={`text-xs ${muted}`}>{plan.kind === "goal" ? "This period’s contribution" : "Still to set aside"}</p><p className={`mt-1 text-4xl font-bold tracking-tight ${ink}`}>{money(rest)}</p></div>
    <section aria-labelledby="plan-working-heading"><h3 id="plan-working-heading" className="mb-2 text-sm font-semibold">{plan.kind === "goal" ? "This period only" : "Allocation calculation"}</h3>
      <dl className="text-sm"><LedgerLine label={plan.kind === "goal" ? "Planned contribution" : "Amount this period"} pence={plan.periodPence} /><LedgerLine label="Already set aside" pence={-plan.filledPence} /><LedgerLine label="Still to set aside" pence={rest} total /></dl>
      {plan.kind === "allocation" && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-label="Allocation set aside" aria-valuemin={0} aria-valuemax={plan.periodPence / 100} aria-valuenow={Math.min(plan.filledPence, plan.periodPence) / 100}><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, plan.filledPence / Math.max(1, plan.periodPence) * 100)}%` }} /></div>}
    </section>
    <section aria-labelledby="plan-routing-heading" className="border-t border-slate-200 pt-4 dark:border-slate-700"><h3 id="plan-routing-heading" className="mb-3 text-sm font-semibold">Where the money moves</h3>
      <dl className="space-y-4 text-sm"><div><dt className={`text-xs ${muted}`}>Pay from</dt><dd className="mt-1 font-semibold">{accountName ?? "Not linked yet"}</dd>{plan.evidence === "recent-transfers" && <dd className={`mt-1 text-xs leading-5 ${muted}`}>Suggested from recent transfers. Check this if you now pay from somewhere else.</dd>}{!accountName && <dd className={`mt-1 text-xs leading-5 ${muted}`}>Choose a paying account to include this amount in its calculation.</dd>}</div><div><dt className={`text-xs ${muted}`}>Set aside in</dt><dd className="mt-1 font-semibold">{plan.destination}</dd></div></dl>
    </section>
    <p className={`text-xs leading-5 ${muted}`}>{plan.kind === "allocation" ? "Money already set aside has left your balance. It is not deducted again." : "This is the contribution for this period, not your whole goal target or a bank instruction."}</p>
  </div>;
}

export function CardPaymentIcon() {
  return <span className="flex size-9 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300"><CreditCard size={18} aria-hidden="true" /></span>;
}
