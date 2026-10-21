"use client";

import { useEffect, useId, useState } from "react";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { getCategoryColour } from "@/lib/categories";
import { useCategories } from "@/components/CategoriesContext";
import MoneyText from "@/components/MoneyText";
import { api, type PlanCategoryActivity, type PlanCategoryTracking as Tracking } from "@/lib/api";

export type PlanCategoryTrackingValue = Tracking | null;
const money = (amount: number) => `${amount < 0 ? "−" : ""}£${Math.abs(amount).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
const dateLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Category evidence never fulfils a plan. Route/category changes discard
 * in-flight replies, so evidence from an earlier draft cannot be confirmed. */
export function PlanCategoryTracking({ kind, sourceAccountId, destinationAccountIds, value, onChange, commitmentId, allocationId, effectiveFrom, readOnly = false }: {
  kind: "goal" | "set-aside";
  sourceAccountId: string;
  destinationAccountIds?: string[];
  value: PlanCategoryTrackingValue;
  onChange(value: PlanCategoryTrackingValue): void;
  commitmentId?: string;
  allocationId?: string;
  effectiveFrom?: string;
  readOnly?: boolean;
}) {
  const { allCategories } = useCategories();
  const name = useId();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; activity?: PlanCategoryActivity; failed?: boolean } | null>(null);
  const category = value?.category ?? "";
  const destinations = destinationAccountIds?.join(",") ?? "";
  const key = JSON.stringify([category, sourceAccountId, destinations, kind, commitmentId, allocationId, effectiveFrom, readOnly, retry]);
  useEffect(() => {
    if (!category || !sourceAccountId) return;
    let disposed = false;
    api.planCategoryActivity({ preview: !readOnly, kind, source_account_id: sourceAccountId, destination_account_ids: destinations ? destinations.split(",") : [], category, commitment_id: commitmentId, allocation_id: allocationId, effective_from: effectiveFrom })
      .then(activity => { if (!disposed) setResult({ key, activity }); })
      .catch(() => { if (!disposed) setResult({ key, failed: true }); });
    return () => { disposed = true; };
  }, [key, category, sourceAccountId, destinations, kind, commitmentId, allocationId, effectiveFrom, readOnly]);
  const activity = result?.key === key ? result.activity : undefined;
  const failed = result?.key === key && result.failed;
  const transferScope = kind === "goal" || Boolean(destinations);
  const pick = (category: string) => onChange({ category, ...(kind === "set-aside" && destinations ? { destination_account_ids: destinations.split(",") } : {}) });
  if (!value) return readOnly ? null : <button type="button" onClick={() => pick(allCategories.includes(transferScope ? "Savings" : "Groceries") ? transferScope ? "Savings" : "Groceries" : allCategories[0] ?? "Other")} className="min-h-11 text-sm font-semibold text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300">Track a category instead</button>;
  return <section className="min-w-0 space-y-3" aria-label="Category activity">
    {!readOnly && <>
      <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold">Category</h4><button type="button" onClick={() => onChange(null)} className="min-h-11 rounded px-1 text-sm font-semibold text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300">Use a payment instead</button></div>
      <fieldset className="min-w-0"><legend className="sr-only">Tracking category</legend><div className="max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 dark:border-slate-600">{allCategories.map(categoryName => {
        const Icon = getCategoryIcon(categoryName), colour = getCategoryColour(categoryName);
        return <label key={categoryName} className="flex min-h-14 cursor-pointer items-center gap-3 border-t border-slate-200 px-3 py-2 first:border-t-0 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-500 dark:border-slate-600 dark:hover:bg-slate-800"><span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ color: colour, backgroundColor: `${colour}26` }}><Icon size={16} /></span><span className="min-w-0 flex-1 text-sm font-semibold">{categoryName}</span><input type="radio" name={name} checked={categoryName === category} onChange={() => pick(categoryName)} className="size-4 shrink-0 accent-indigo-600" /></label>;
      })}</div></fieldset>
    </>}
    {!sourceAccountId ? <p className="text-sm text-slate-700 dark:text-slate-200">Choose a paying account to see matching activity.</p> : failed ? <p role="status" className="text-sm text-slate-700 dark:text-slate-200">Couldn’t load category activity. <button type="button" onClick={() => setRetry(n => n + 1)} className="min-h-11 rounded px-1 font-semibold text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300">Retry</button></p> : !activity ? <p role="status" className="text-sm text-slate-600 dark:text-slate-300">Checking this pay period…</p> : <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
      <dl className="space-y-2">{!transferScope && <><div className="flex items-baseline justify-between gap-3"><dt>Purchases</dt><dd><MoneyText text={money(activity.gross)} /></dd></div><div className="flex items-baseline justify-between gap-3"><dt>Refunds</dt><dd><MoneyText text={money(-activity.refunds)} /></dd></div></>}<div className={`flex items-baseline justify-between gap-3 font-semibold ${transferScope ? "" : "border-t border-slate-200 pt-2 dark:border-slate-600"}`}><dt>{transferScope ? `${activity.count} ${activity.count === 1 ? "transfer" : "transfers"}` : activity.amount < 0 ? "Net refund" : "Used this pay period"}</dt><dd><MoneyText text={money(activity.amount)} /></dd></div></dl>
      <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">{dateLabel(activity.period_start)} to {dateLabel(activity.period_end)} · {category}</p>
    </div>}
    <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">{transferScope ? "Only verified transfers from the paying account to the selected savings account are shown." : "Matching spending in the paying account is shown net of refunds."} This activity does not change the amount held back{kind === "goal" ? " or add to goal progress" : ""}.</p>
  </section>;
}
