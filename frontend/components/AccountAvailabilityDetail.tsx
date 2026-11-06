"use client";

import { ChevronDown, CircleAlert } from "lucide-react";
import type { AccountEligibility } from "@/lib/api";
import { formatAvailabilityAmount, type AccountAvailabilityReading } from "@/lib/accountAvailability";
import MoneyText from "@/components/MoneyText";
import { coverSplitSentence } from "@/lib/coverNarrative";

/** G406: the available estimate opens its existing server-position evidence. */
export default function AccountAvailabilityDetail({ reading, position, hidden, layout = "default" }: {
  reading?: AccountAvailabilityReading;
  position?: AccountEligibility;
  hidden: boolean;
  layout?: "default" | "calm";
}) {
  if (!reading) return null;
  const amount = (value: number, exact = false) => hidden ? `${value < 0 ? "−" : ""}£••••` : exact ? `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatAvailabilityAmount(value);
  if (reading.kind !== "ready") return <p data-account-availability-working className={`${layout === "calm" ? "flex min-h-11 items-center" : "mt-3"} text-[13px] text-slate-600 dark:text-slate-300`}>{layout === "calm" ? (reading.kind === "checking" ? "Checking availability…" : "Availability unavailable") : (reading.kind === "checking" ? "Checking what is available…" : "The available estimate could not be checked. Refresh to try again.")}</p>;
  // These are stored projections, not a new forecast or a subtraction from
  // today's balance. Prefer the recorded low point; fall back to the closing
  // projection only when the server has not supplied the low point.
  const candidates = reading.warning === "payments"
    ? [position?.low_point, position?.after_payments]
    : reading.warning === "plans" ? [position?.low_point_and_plans, position?.after_payments_and_plans] : [];
  const short = candidates.find((value): value is number => typeof value === "number" && Number.isFinite(value) && value < 0);
  const evidence: [string, number | null | undefined][] = [
    ["After scheduled payments", position?.after_payments],
    ["Plans held back", position?.plans_reserved],
    ["After payments and plans", position?.after_payments_and_plans],
    ["Lowest after payments", position?.low_point],
    ["Lowest after plans", position?.low_point_and_plans],
    // G410: set aside here for a suggested move out of this account (already inside Available to spend). Negative, as a deduction.
    ...(position?.earmarks_out ?? []).map((e): [string, number] => [`Set aside for the move to ${e.to_name}`, -e.amount]),
  ];
  const covered = reading.coveredByMove;
  const availableLabel = reading.requiresMove ? "Available after suggested move" : "Available to spend";
  const allocationNote = (position?.allocation_unassigned ?? 0) > 0
    ? "Some forecast money cannot yet be safely allocated to an account."
    : "Adding the account amounts gives that total.";
  const coveredNote = covered?.split ? `${coverSplitSentence(covered.split, covered.shortAfterCover)} Nothing has been moved.` : covered ? (covered.shortAfterCover > 0
    ? `A suggested move from ${covered.fromLabel} would cover part of this${covered.coversPlans ? ", including the linked plans" : ""}. Nothing has been moved.`
    : `A suggested move from ${covered.fromLabel} would cover this${covered.coversPlans ? ", including the linked plans" : ""}. Nothing has been moved.`) : null;
  if (layout === "calm") return <div data-account-availability-working className="text-[13px] leading-5 text-slate-600 dark:text-slate-300">
    <details className="group">
      <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_16px] touch-manipulation items-start gap-3 rounded-lg py-2 text-slate-800 [@media(hover:hover)]:hover:text-slate-950 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100 dark:[@media(hover:hover)]:hover:text-white [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="flex items-baseline justify-between gap-3"><span>{availableLabel}</span><MoneyText text={amount(reading.value)} className="shrink-0 font-semibold" /></span>
          {reading.warning && <span className="mt-1 flex items-center gap-2 text-slate-800 dark:text-slate-100"><span>{short !== undefined ? <><MoneyText text={amount(Math.abs(short))} /> short {reading.warning === "payments" ? "for payments" : "after plans"}</> : <>Short {reading.warning === "payments" ? "for payments" : "after plans"}</>}</span><CircleAlert size={14} aria-hidden="true" className={`shrink-0 ${reading.warning === "payments" && !(covered && covered.shortAfterCover <= 0) ? "text-rose-700 dark:text-rose-300" : "text-amber-800 dark:text-amber-200"}`} /></span>}
        </span>
        <ChevronDown size={16} aria-hidden="true" className="mt-0.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none group-open:rotate-180" />
      </summary>
      <div className="pb-2 pt-3">
        {reading.warning && <p className="mb-3">{reading.warning === "payments" ? "Scheduled payments" : "Plans"} take the forecast below zero. Your bank balance is separate.{coveredNote ? ` ${coveredNote}` : ""}</p>}
        <dl className="space-y-2">{evidence.map(([label, value]) => typeof value === "number" && Number.isFinite(value) ? <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="shrink-0"><MoneyText text={amount(value, true)} /></dd></div> : null)}<div className="flex justify-between gap-4 border-t border-slate-200 pt-2 font-semibold dark:border-slate-700"><dt>{availableLabel}</dt><dd className="shrink-0"><MoneyText text={amount(reading.value, true)} /></dd></div></dl>
        <p className="mt-3 text-xs">Available is an allocation of your shared Left to spend for this pay period. {allocationNote}{reading.requiresMove ? " This amount is available only after the suggested move." : ""}{position?.estimated ? " Some plan sources are estimated." : ""}</p>
      </div>
    </details>
  </div>;
  return <div data-account-availability-working className="mt-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none touch-manipulation items-center justify-between gap-3 rounded-lg py-2 font-medium text-slate-800 [@media(hover:hover)]:hover:text-slate-950 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100 dark:[@media(hover:hover)]:hover:text-white [-webkit-tap-highlight-color:transparent] [&::-webkit-details-marker]:hidden"><span className="min-w-0"><span>{availableLabel} <MoneyText text={amount(reading.value)} /></span>{short !== undefined && <span> · Projected shortfall <MoneyText text={amount(Math.abs(short))} /> {reading.warning === "payments" ? "after payments" : "after plans"}</span>}</span><ChevronDown size={16} aria-hidden="true" className="shrink-0 transition-transform duration-150 motion-reduce:transition-none group-open:rotate-180" /></summary>
      <dl className="space-y-2 pb-3 pt-2">{evidence.map(([label, value]) => typeof value === "number" && Number.isFinite(value) ? <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="shrink-0"><MoneyText text={amount(value, true)} /></dd></div> : null)}<div className="flex justify-between gap-4 border-t border-slate-200 pt-2 font-semibold dark:border-slate-700"><dt>{availableLabel}</dt><dd className="shrink-0"><MoneyText text={amount(reading.value, true)} /></dd></div></dl>
      <p className="pb-3 text-xs">Available is an allocation of your shared Left to spend for this pay period. {allocationNote}{reading.requiresMove ? " This amount is available only after the suggested move." : ""}{position?.estimated ? " Some plan sources are estimated." : ""}</p>
    </details>
    {short !== undefined && <p className="mt-2">{reading.warning === "payments" ? "Payments due" : "Payments and plans"} may take this account below zero.{coveredNote ? ` ${coveredNote}` : ""}{reading.value === 0 && <> Available stays at <MoneyText text={amount(0)} />.</>}</p>}
  </div>;
}
