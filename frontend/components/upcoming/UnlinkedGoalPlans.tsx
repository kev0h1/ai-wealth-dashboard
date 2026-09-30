"use client";

import { useId } from "react";
import { ChevronRight } from "lucide-react";
import { hasPlanSource, remaining, type Plan } from "@/lib/upcomingPlans";
import { detailFocus, detailInk, detailMuted, money, PlanIcon } from "./detailPrimitives";

/** Unknown goal payers have no account row to open. Keep their linking action
 * outside By account; allocations already have their own set-aside list. */
export default function UnlinkedGoalPlans({ plans, onPlan }: { plans: Plan[]; onPlan(id: string): void }) {
  const id = useId();
  const goals = plans.filter((plan) => plan.kind === "goal" && plan.active && !hasPlanSource(plan) && (plan.amountUnavailable || remaining(plan) > 0));
  if (!goals.length) return null;
  return <section aria-labelledby={id} className="space-y-2">
    <h2 id={id} className="text-sm font-semibold text-slate-800 dark:text-slate-100">Goals needing a paying account</h2>
    <ul className="divide-y divide-slate-200 dark:divide-slate-700">{goals.map((plan) => <li key={plan.id}>
      <button type="button" data-flow-focus={"unlinked-goal-" + plan.id} onClick={() => onPlan(plan.id)} className={"grid min-h-16 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_0.75rem] items-center gap-3 rounded-lg py-3 text-left hover:bg-slate-100 active:opacity-70 dark:hover:bg-slate-800 " + detailFocus}>
        <PlanIcon kind="goal" />
        <span className="min-w-0"><span className="block break-words text-sm font-semibold text-slate-950 dark:text-slate-50">{plan.name}</span><span className={"mt-0.5 block text-xs " + detailMuted}>Choose paying account</span></span>
        <span className="text-right"><span className={"block text-sm font-semibold " + detailInk}>{plan.amountUnavailable ? "Unavailable" : money(remaining(plan))}</span><span className={"block text-xs " + detailMuted}>this period</span></span>
        <ChevronRight size={14} className={detailMuted} aria-hidden="true" />
      </button>
    </li>)}</ul>
  </section>;
}
