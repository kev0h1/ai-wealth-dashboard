"use client";

import { ChevronDown } from "lucide-react";
import type { AccountEligibility } from "@/lib/api";
import { formatAvailabilityAmount, type AccountAvailabilityReading } from "@/lib/accountAvailability";
import MoneyText from "@/components/MoneyText";

/** G391 A: use the existing server position, with its evidence one tap away. */
export default function AccountAvailabilityDetail({ reading, position, hidden }: {
  reading?: AccountAvailabilityReading;
  position?: AccountEligibility;
  hidden: boolean;
}) {
  if (!reading) return null;
  const amount = (value: number, exact = false) => hidden ? `${value < 0 ? "−" : ""}£••••` : exact ? `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatAvailabilityAmount(value);
  if (reading.kind !== "ready") return <p data-account-availability-working className="mt-3 text-[13px] text-slate-600 dark:text-slate-300">{reading.kind === "checking" ? "Checking what is available…" : "The available estimate could not be checked. Refresh to try again."}</p>;
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
  ];
  return <div data-account-availability-working className="mt-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
    <p className="font-medium"><span>Available to spend <MoneyText text={amount(reading.value)} /></span>{short !== undefined && <span> · Projected shortfall <MoneyText text={amount(Math.abs(short))} /> {reading.warning === "payments" ? "after payments" : "after plans"}</span>}</p>
    {short !== undefined && <p className="mt-2">{reading.warning === "payments" ? "Payments due" : "Payments and plans"} may take this account below zero.{reading.value === 0 && <> Available stays at <MoneyText text={amount(0)} />.</>}</p>}
    <details className="group mt-3 border-y border-slate-200 dark:border-slate-700">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-2 font-semibold text-slate-800 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100 [&::-webkit-details-marker]:hidden">Working<ChevronDown size={16} aria-hidden="true" className="group-open:rotate-180" /></summary>
      <dl className="space-y-2 pb-3">{evidence.map(([label, value]) => typeof value === "number" && Number.isFinite(value) ? <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="shrink-0"><MoneyText text={amount(value, true)} /></dd></div> : null)}<div className="flex justify-between gap-4 border-t border-slate-200 pt-2 font-semibold dark:border-slate-700"><dt>Available to spend</dt><dd className="shrink-0"><MoneyText text={amount(reading.value, true)} /></dd></div></dl>
      <p className="pb-3 text-xs">Available is an estimate for this pay period. It protects earlier low points and any move held back, and cannot exceed your shared Left to spend. These are separate account limits, not amounts to add together.{position?.estimated ? " Some plan sources are estimated." : ""}</p>
    </details>
  </div>;
}
