import type { Commitment } from "@/lib/api";
import { cardPlanMoney, offerDeadlineLine, projectedMonthLine } from "@/lib/cardRepaymentPlan";
import MoneyText from "@/components/MoneyText";
import { useBalancesHidden } from "@/lib/balancesHidden";

type Props = { plan: Commitment; hideValues: boolean; onOpen: () => void };

function longDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "date unavailable";
}

function paymentDetail(plan: Commitment): { amount: string | null; note: string; line: string } {
  const facts = plan.card_plan;
  if (facts?.status !== "ready") return { amount: null, note: facts?.status === "pending" ? "Preparing figures" : "Figures unavailable", line: facts?.status === "pending" ? "Preparing figures" : "Figures unavailable" };
  if (facts.schedule_state === "paused") return { amount: null, note: "Plan paused", line: "Plan paused" };
  if (facts.schedule_state === "ended") return { amount: null, note: "Schedule ended", line: "Schedule ended" };
  if (facts.display_period_planned == null) return { amount: null, note: "Payment unavailable", line: "Payment unavailable" };
  const amount = cardPlanMoney(facts.display_period_planned);
  if (facts.schedule_state === "not_started") {
    const note = facts.starts_on ? `Each pay period from ${longDate(facts.starts_on)}` : "Each pay period";
    return { amount, note, line: `${amount} ${note.toLowerCase()}` };
  }
  if (facts.amount_varies) return { amount, note: "This pay period, amount varies", line: `${amount} planned this pay period, amount varies` };
  if (facts.final_period_amount) return { amount, note: "Planned this pay period", line: `${amount} planned this pay period` };
  return { amount, note: "Each pay period", line: `${amount} each pay period` };
}

function storedProgress(plan: Commitment, hidden: boolean) {
  const progress = plan.card_plan?.promo?.progress;
  if (hidden || plan.card_plan?.status !== "ready" || (progress?.status !== "ready" && progress?.status !== "not_started") || progress.paid == null || progress.target == null || progress.paid_percent == null) return null;
  return { paid: progress.paid, target: progress.target, paidPercent: progress.paid_percent, state: progress.status, outlook: plan.card_plan.promo?.outlook };
}

function ringTone(outlook: "paused" | "short" | "behind" | "on_track" | undefined, state: "ready" | "not_started"): string {
  if (state !== "ready") return "stroke-slate-500 dark:stroke-slate-400";
  if (outlook === "on_track") return "stroke-emerald-700 dark:stroke-emerald-400";
  if (outlook === "behind" || outlook === "short") return "stroke-amber-700 dark:stroke-amber-400";
  return "stroke-slate-500 dark:stroke-slate-400";
}

/** Approved G492 A: compact one-row plan evidence, opening the existing plan sheet. */
export default function CardPlanRepaymentRow({ plan, hideValues, onOpen }: Props) {
  const balancesHidden = useBalancesHidden();
  const effectiveHidden = hideValues || balancesHidden;
  const facts = plan.card_plan;
  const progress = storedProgress(plan, effectiveHidden);
  const payment = paymentDetail(plan);
  const deadline = offerDeadlineLine(facts);
  const finish = facts?.status === "ready" ? projectedMonthLine(facts) : facts?.status === "pending" ? "Preparing plan figures" : "Plan figures unavailable";
  const startDate = facts?.status === "ready" && facts.schedule_state === "not_started" && facts.starts_on ? longDate(facts.starts_on) : null;
  const provisional = startDate ? `Target and outlook are provisional until the plan starts on ${startDate}.` : null;
  const ids = { name: `card-plan-name-${plan.id}`, progress: `card-plan-progress-${plan.id}`, payment: `card-plan-payment-${plan.id}`, deadline: `card-plan-deadline-${plan.id}`, finish: `card-plan-finish-${plan.id}`, provisional: `card-plan-provisional-${plan.id}` };
  const describedBy = [ids.progress, ids.payment, deadline ? ids.deadline : null, ids.finish, provisional ? ids.provisional : null].filter(Boolean).join(" ");

  return <article data-g492-row className="relative border-t border-slate-200/70 dark:border-white/10">
    <button type="button" onClick={onOpen} aria-labelledby={ids.name} aria-describedby={describedBy} className="absolute inset-0 z-0 min-h-11 w-full touch-manipulation bg-transparent text-left outline-none transition-colors hover:bg-slate-50/80 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 active:bg-slate-50/80 dark:hover:bg-white/[0.035] dark:active:bg-white/[0.035]" />
    <div data-g492-row-content className="pointer-events-none relative z-[1] px-4 py-4">
      <p id={ids.name} className="break-words text-[15px] font-bold leading-[1.35] text-slate-900 dark:text-slate-100">{plan.name}<span className="sr-only">. View plan details</span></p>
      {progress ? <div className="mt-3 grid grid-cols-[46px_minmax(0,1.2fr)_minmax(72px,.8fr)] items-center gap-3">
        <svg data-g492-actual viewBox="0 0 48 48" className="size-[46px] -rotate-90" role="progressbar" aria-label={`Repaid ${cardPlanMoney(progress.paid)} of ${cardPlanMoney(progress.target)}${provisional ? `. ${provisional}` : ""}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.paidPercent}>
          <circle cx="24" cy="24" r="18" pathLength="100" fill="none" strokeWidth="6" className="stroke-slate-200 dark:stroke-slate-700" />
          <circle cx="24" cy="24" r="18" pathLength="100" fill="none" strokeWidth="6" strokeLinecap="butt" strokeDasharray={`${progress.paidPercent} 100`} className={ringTone(progress.outlook, progress.state)} />
        </svg>
        <div id={ids.progress} className="min-w-0"><span className="block text-[11px] font-bold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Repaid</span><MoneyText text={cardPlanMoney(progress.paid)} className="block text-base font-bold leading-[1.35] text-slate-900 dark:text-slate-100" /><span className="block text-xs font-normal leading-5 text-slate-600 dark:text-slate-300">of <MoneyText text={cardPlanMoney(progress.target)} /></span></div>
        <div id={ids.payment} data-g492-payment className="min-w-0"><span className="block text-[11px] font-bold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Payment</span><MoneyText text={payment.amount ?? payment.note} className="block text-[13px] font-semibold leading-[1.45] text-slate-900 dark:text-slate-100" />{payment.amount && <span className="block text-xs leading-5 text-slate-500 dark:text-slate-400">{payment.note}</span>}</div>
      </div> : <div className="mt-2"><span id={ids.progress} className="block text-xs leading-5 text-slate-500 dark:text-slate-400">{effectiveHidden ? "Figures hidden" : facts?.status === "pending" ? "Preparing plan progress" : "Progress unavailable"}</span><span id={ids.payment}><MoneyText text={effectiveHidden ? "Payment hidden" : payment.line} className="mt-1 block text-[13px] font-semibold leading-5 text-slate-900 dark:text-slate-100" /></span></div>}
      {deadline && <p id={ids.deadline} data-g492-deadline className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{deadline}</p>}
      {provisional && <p id={ids.provisional} className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{provisional}</p>}
      <div id={ids.finish} data-g492-finish className="mt-2 flex items-start justify-between gap-3 text-[13px] leading-5"><span className="flex min-w-0 items-start gap-2 text-slate-600 dark:text-slate-300">{facts?.status === "ready" && (facts.promo?.outlook === "short" || facts.promo?.outlook === "behind") ? <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-amber-500" /> : null}<span>{finish}</span></span><span aria-hidden="true" className="shrink-0 text-xs font-bold text-indigo-700 dark:text-indigo-300">Details</span></div>
    </div>
  </article>;
}
