"use client";

import { useId } from "react";
import { ArrowDownLeft, ArrowLeftRight, Check, ChevronDown, ChevronRight, ReceiptText } from "lucide-react";
import type { UpcomingAccountEvent, UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import { accountPlan, hasPlanSource, remaining, type Plan } from "@/lib/upcomingPlans";
import { DetailLedgerLine, detailFocus, detailInk, detailMuted, PlanIcon, dateLabel, money } from "./detailPrimitives";

export interface UpcomingAccountDetailsProps { account: UpcomingAccountSummary; periodLabel: string; plans?: Plan[]; plansStatus?: "loading" | "error" | "ready"; onPlan?: (id: string) => void;
  /** Opens the payment detail for an event. Only events in `editableEventIds` (when given) get a button; the rest stay static. */
  onEvent?: (eventId: string) => void; editableEventIds?: ReadonlySet<string>; }

function EventLine({ event, onEvent, align }: { event: UpcomingAccountEvent; onEvent?: (eventId: string) => void; align?: boolean }) {
  const incoming = event.kind === "income" || event.kind === "inflow";
  const Icon = incoming ? ArrowDownLeft : event.kind === "movement" ? ArrowLeftRight : ReceiptText;
  const content = <>
    <span className={"flex size-9 items-center justify-center rounded-xl " + (incoming ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300")}><Icon size={18} aria-hidden="true" /></span>
    <span className="min-w-0"><span className="block break-words text-sm font-medium">{event.name}</span><span className={"mt-0.5 block text-xs " + detailMuted}>{dateLabel(event.date)}</span></span>
    <span className={"shrink-0 text-right text-sm " + detailInk}>{money(Math.round(event.amount * 100), incoming)}</span>
    {onEvent && <ChevronRight size={14} className={detailMuted} aria-hidden="true" />}
  </>;
  return <li>{onEvent
    ? <button type="button" data-flow-focus={"event-" + event.id} aria-label={event.name + ", " + dateLabel(event.date) + ", " + money(Math.round(event.amount * 100), incoming) + ". Open details"} onClick={() => onEvent(event.id)} className={"grid min-h-11 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_0.75rem] items-center gap-3 rounded-lg py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 " + detailFocus}>{content}</button>
    : <div className={"grid items-center gap-3 py-3 " + (align ? "grid-cols-[2.25rem_minmax(0,1fr)_auto_0.75rem]" : "grid-cols-[2.25rem_minmax(0,1fr)_auto]")}>{content}</div>}</li>;
}

function PlanRow({ plan, onPlan }: { plan: Plan; onPlan?: (id: string) => void }) {
  const unassigned = !hasPlanSource(plan);
  const estimated = !unassigned && plan.evidence === "recent-transfers";
  const content = <><PlanIcon kind={plan.kind} /><span className="min-w-0"><span className="block break-words text-sm font-semibold">{plan.name}</span><span className={"mt-0.5 block text-xs leading-5 " + detailMuted}>{unassigned ? "Choose paying account" : plan.kind === "goal" ? "Goal · this period" : money(plan.filledPence) + " of " + money(plan.periodPence) + " set aside"}</span>{estimated && <span className={"block text-xs leading-5 " + detailMuted}>Paying account based on recent transfers</span>}</span><span className="text-right"><span className={"block text-sm font-semibold " + detailInk}>{plan.amountUnavailable ? "Unavailable" : money(unassigned ? remaining(plan) : -remaining(plan))}</span><span className={"block text-xs " + detailMuted}>{unassigned ? "unassigned" : estimated ? "estimated" : "to set aside"}</span></span>{onPlan && <ChevronRight size={14} className={detailMuted} aria-hidden="true" />}</>;
  return <li>{onPlan ? <button type="button" data-flow-focus={"plan-" + plan.id} onClick={() => onPlan(plan.id)} className={"grid min-h-16 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_0.75rem] items-center gap-3 rounded-lg py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 " + detailFocus}>{content}</button> : <div className="grid min-h-16 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 py-3">{content}</div>}</li>;
}

function Verdict({ account, plans, plansStatus }: Required<Pick<UpcomingAccountDetailsProps, "account" | "plans" | "plansStatus">>) {
  const result = accountPlan(account, plans);
  if (account.status === "short") return <div className="space-y-2"><p className="flex items-center gap-2 text-sm font-semibold"><span className="size-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden="true" />{money(Math.round(account.shortfall! * 100))} needed for payments</p><p className={"text-xs leading-5 " + detailMuted}>First shortfall {dateLabel(account.firstShortDate!)}. Goals and allocations are separate from this bill gap.</p></div>;
  if (account.status === "unknown") return <div className="space-y-2"><h3 className="text-base font-semibold">Balance needs checking</h3><p className={"text-sm leading-6 " + detailMuted}>We can show your plans, but not whether this account can fund them until its balance and incoming money can be verified.</p></div>;
  if (plansStatus !== "ready") return <p className={"text-sm leading-6 " + detailMuted}>{plansStatus === "loading" ? "Loading goals and allocations. This figure covers payments only." : "Goals and allocations could not be checked. This figure covers payments only."}</p>;
  if (result.uncertain) return <div className="space-y-2"><h3 className="text-base font-semibold">Calculation needs checking</h3><p className={"text-sm leading-6 " + detailMuted}>{result.assigned.some((plan) => plan.overlapReason === "shared-plan") ? "Plans share a receiving pot. We cannot tell whether they describe the same money, so no combined total is shown." : result.assigned.some((plan) => plan.overlapUncertain) ? "A planned move may also fund one of these plans. No combined total is shown until the overlap is clear." : "A plan amount is unavailable, so no combined total is shown."}</p></div>;
  if (account.status === "unfunded") return <p className={"flex items-start gap-2 text-sm leading-6 " + detailMuted}><span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />A planned move is not fully funded when it leaves. It may stay put, with no fee.</p>;
  if ((result.planGap ?? 0) > 0) return <div className="space-y-2"><p className="flex items-center gap-2 text-sm font-semibold"><span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />{money(result.planGap!)} more needed for plans{result.estimated ? " · estimated" : ""}</p><p className={"text-xs leading-5 " + detailMuted}>Payments are covered. You can adjust your set-asides or add money before completing them.</p></div>;
  if (result.estimated) return <p className={"text-sm leading-6 " + detailMuted}>Payments and set-asides are estimated to fit.</p>;
  if (result.unassigned.length) return <p className={"text-xs leading-5 " + detailMuted}>Other set-asides have no known paying account and are not included in this balance.</p>;
  return <p className="flex items-center gap-2 text-sm font-medium"><Check size={16} className={detailMuted} aria-hidden="true" />{result.assigned.length ? "Payments and linked plans fit" : "Payments are covered"}</p>;
}

export default function UpcomingAccountDetails({ account, periodLabel, plans = [], plansStatus = "ready", onPlan, onEvent, editableEventIds }: UpcomingAccountDetailsProps) {
  const id = useId();
  // G238: while plans are loading or failed the sheet says "payments only", so the server position (which includes plans) is withheld too.
  const result = accountPlan(plansStatus === "ready" ? account : { ...account, position: undefined }, plansStatus === "ready" ? plans : []);
  const hasPlans = result.reservedPence > 0 || result.uncertain;
  const figure = hasPlans ? result.afterPlans : result.afterPayments;
  return <div className="space-y-6 text-slate-950 dark:text-slate-50">
    <section className="space-y-3" aria-label="Account plan result">
      <div><p className={"text-xs font-medium " + detailMuted}>{hasPlans ? "After payments and plans" : "After payments"}{result.estimated && figure !== null ? " · estimated" : ""}</p><p data-account-plan-figure className={"mt-1 break-words text-4xl font-bold leading-tight tracking-tight " + detailInk}>{figure === null ? "Unavailable" : money(figure)}</p>{hasPlans && <p className={"mt-1 text-xs leading-5 " + detailMuted}>{result.estimated ? "Includes set-asides and plans from this account based on recent transfers." : "If you complete the linked plans below"}</p>}</div>
      <Verdict account={account} plans={plans} plansStatus={plansStatus} />
    </section>
    <details className="group border-y border-slate-200 dark:border-slate-700">
      <summary className={"flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg text-sm font-medium [&::-webkit-details-marker]:hidden " + detailFocus}>How this adds up<ChevronDown size={16} className="group-open:rotate-180" aria-hidden="true" /></summary>
      <div className="pb-3"><dl className="text-sm">
        <DetailLedgerLine label="Cash now" pence={account.opening === null ? null : Math.round(account.opening * 100)} />
        {account.income > 0 && <DetailLedgerLine label="Expected income" pence={Math.round(account.income * 100)} positive />}
        {account.transfersIn > 0 && <DetailLedgerLine label="Transfers in" pence={Math.round(account.transfersIn * 100)} positive />}
        <DetailLedgerLine label="Payments to come" pence={-Math.round(account.outgoing * 100)} />
        <DetailLedgerLine label="After payments" pence={result.afterPayments} total />
        {result.allocationPence > 0 && <DetailLedgerLine label={result.estimated ? "Allocations still to set aside · estimated" : "Allocations still to set aside"} pence={-result.allocationPence} />}
        {result.goalPence > 0 && <DetailLedgerLine label="Goal contributions this period" pence={-result.goalPence} />}
        {hasPlans && <DetailLedgerLine label={result.estimated ? "After payments and plans · estimated" : "After payments and plans"} pence={result.afterPlans} total />}
      </dl></div>
    </details>
    {plansStatus === "ready" && (result.assigned.length > 0 || result.unassigned.length === 0) && <section aria-labelledby={id + "-plans"}>
      <div className="flex items-baseline justify-between gap-3"><h3 id={id + "-plans"} className="text-sm font-semibold">Still to set aside</h3>{result.assigned.length > 0 && <span className={"text-xs " + detailMuted}>This account</span>}</div>
      {result.assigned.length ? <ul className="mt-1 divide-y divide-slate-200 dark:divide-slate-700">{result.assigned.map((plan) => <PlanRow key={plan.id} plan={plan} onPlan={onPlan} />)}</ul> : <p className={"py-3 text-sm " + detailMuted}>No goals or allocations linked to this account for this period.</p>}
    </section>}
    {plansStatus === "ready" && result.unassigned.length > 0 && <section aria-labelledby={id + "-unassigned"} className="border-t border-slate-200 pt-4 dark:border-slate-700"><h3 id={id + "-unassigned"} className="text-sm font-semibold">Not assigned to an account</h3><ul className="mt-1 divide-y divide-slate-200 dark:divide-slate-700">{result.unassigned.map((plan) => <PlanRow key={plan.id} plan={plan} onPlan={onPlan} />)}</ul></section>}
    {account.hasUnassignedIncome && <p className={"text-xs leading-5 " + detailMuted}>Income without a confirmed destination is not included in this account’s working.</p>}
    <section aria-labelledby={id + "-events"}><div className="flex items-baseline justify-between gap-4"><h3 id={id + "-events"} className="text-sm font-semibold">Payments &amp; income</h3><span className={"text-xs " + detailMuted}>{account.events.length} expected</span></div>
      {account.events.length ? <ul className="mt-1 divide-y divide-slate-200 dark:divide-slate-700">{account.events.map((event) => <EventLine key={event.id} event={event} align={Boolean(onEvent)} onEvent={onEvent && (!editableEventIds || editableEventIds.has(event.id)) ? onEvent : undefined} />)}</ul> : <p className={"py-3 text-sm " + detailMuted}>No payments or income expected. {periodLabel}.</p>}
    </section>
    <p className={"text-xs leading-5 " + detailMuted}>Goal contributions count in the payday figure above. This account view includes the plans paid from this account.</p>
  </div>;
}
