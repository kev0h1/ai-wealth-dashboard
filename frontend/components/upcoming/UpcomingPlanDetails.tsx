"use client";

import { useId } from "react";
import { remaining, type Plan } from "@/lib/upcomingPlans";
import { DetailLedgerLine, detailInk, detailMuted, money } from "./detailPrimitives";

export interface UpcomingPlanDetailsProps { plan: Plan; accountName?: string | null; }

export default function UpcomingPlanDetails({ plan, accountName = null }: UpcomingPlanDetailsProps) {
  const id = useId();
  const remainingPence = remaining(plan);
  const progress = Math.min(100, plan.filledPence / Math.max(1, plan.periodPence) * 100);
  return <div className="space-y-6 text-slate-950 dark:text-slate-50">
    <div>
      <p className={"text-xs " + detailMuted}>{!plan.active ? "Reserved this period" : plan.kind === "goal" ? "This period’s contribution" : "Still to set aside"}</p>
      <p className={"mt-1 text-4xl font-bold tracking-tight " + detailInk}>{plan.amountUnavailable ? "Unavailable" : money(remainingPence)}</p>
    </div>
    <section aria-labelledby={id + "-working"}>
      <h3 id={id + "-working"} className="mb-2 text-sm font-semibold">{plan.kind === "goal" ? "This period only" : "Allocation calculation"}</h3>
      <dl className="text-sm">
        <DetailLedgerLine label={plan.kind === "goal" ? "Planned contribution" : "Amount this period"} pence={plan.amountUnavailable ? null : plan.periodPence} />
        {plan.kind === "allocation" && <>
          <DetailLedgerLine label={plan.filledPence > plan.periodPence ? "Set aside towards this target" : "Already set aside"} pence={plan.amountUnavailable ? null : plan.active ? -Math.min(plan.filledPence, plan.periodPence) : plan.filledPence} />
          {plan.active && <DetailLedgerLine label="Still to set aside" pence={plan.amountUnavailable ? null : remainingPence} total />}
        </>}
      </dl>
      {!plan.active && <p className={"mt-3 text-xs leading-5 " + detailMuted}>Not reserved in this period. Paused, future or finished allocations do not reduce the account result.</p>}
      {plan.filledPence > plan.periodPence && <p className={"mt-3 text-xs leading-5 " + detailMuted}>{money(plan.filledPence - plan.periodPence)} above the target is already set aside. Nothing more is reserved.</p>}
      {plan.kind === "allocation" && !plan.amountUnavailable && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-label="Allocation set aside" aria-valuemin={0} aria-valuemax={plan.periodPence / 100} aria-valuenow={Math.min(plan.filledPence, plan.periodPence) / 100}>
        <div className="h-full rounded-full bg-indigo-500" style={{ width: progress + "%" }} />
      </div>}
    </section>
    <section aria-labelledby={id + "-routing"} className="border-t border-slate-200 pt-4 dark:border-slate-700">
      <h3 id={id + "-routing"} className="mb-3 text-sm font-semibold">Where the money moves</h3>
      <dl className="space-y-4 text-sm">
        <div>
          <dt className={"text-xs " + detailMuted}>Pay from</dt>
          <dd className="mt-1 font-semibold">{accountName ?? "Not linked yet"}</dd>
          {plan.evidence === "recent-transfers" && <dd className={"mt-1 text-xs leading-5 " + detailMuted}>Suggested from recent transfers. Check this if you now pay from somewhere else.</dd>}
          {!accountName && <dd className={"mt-1 text-xs leading-5 " + detailMuted}>Choose a paying account to include this amount in its calculation.</dd>}
        </div>
        <div><dt className={"text-xs " + detailMuted}>Set aside in</dt><dd className="mt-1 font-semibold">{plan.destination}</dd></div>
      </dl>
    </section>
    {plan.overlapUncertain && <p className="border-l-2 border-amber-500 pl-3 text-sm leading-6">
      {plan.overlapReason === "shared-plan" ? "Another plan uses this receiving pot. We cannot yet confirm whether they set aside the same money." : "A scheduled move may already fund this plan. We cannot yet confirm whether they are the same transfer."} The combined account result is left unavailable so this amount is not counted twice.
    </p>}
    <p className={"text-xs leading-5 " + detailMuted}>{plan.kind === "allocation" ? "Money already set aside has left your balance. It is not deducted again." : "This is the contribution for this period, not your whole goal target or a bank instruction."}</p>
  </div>;
}
