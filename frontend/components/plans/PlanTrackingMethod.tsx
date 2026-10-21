"use client";

import { useId } from "react";

export type TrackingMethod = "payment" | "category" | "none";
const choices = [
  { value: "payment", label: "A payment", help: "Match a payment you recognise." },
  { value: "category", label: "A category", help: "See matching activity in this pay period." },
  { value: "none", label: "Not now", help: "You can add tracking later." },
] as const;

export function PlanTrackingMethod({ value, onChange }: { value: TrackingMethod; onChange(value: TrackingMethod): void }) {
  const name = useId();
  return <fieldset className="min-w-0 space-y-2"><legend className="sr-only">Tracking method</legend>{choices.map(choice => <label key={choice.value} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-500 ${value === choice.value ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950/30" : "border-slate-200 dark:border-slate-700"}`}><input type="radio" name={name} checked={value === choice.value} onChange={() => onChange(choice.value)} className="mt-1 size-4 shrink-0 accent-indigo-600" /><span><strong className="block text-sm text-slate-900 dark:text-slate-100">{choice.label}</strong><span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">{choice.help}</span></span></label>)}</fieldset>;
}
