"use client";

import type { ReactNode } from "react";
import { ChevronRight, CreditCard, Loader2 } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import PennyUsageRow from "@/components/PennyUsageRow";
import type { SubscriptionInfo } from "@/lib/api";

export function ProfilePreview({
  name,
  phase,
  dirty,
  onNameChange,
  onSave,
}: {
  name: string;
  phase: "idle" | "saving" | "saved" | "error";
  dirty: boolean;
  onNameChange: (value: string) => void;
  onSave: () => void;
}) {
  const status = phase === "saved" ? "Profile saved" : phase === "error" ? "Could not save profile. Try again." : null;
  return <section aria-labelledby="profile-preview-heading" className="mt-8">
    <h2 id="profile-preview-heading" className="text-base font-bold text-slate-900 dark:text-slate-100">Profile</h2>
    <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-400">Your name in Sorted.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (dirty && phase !== "saving") onSave(); }} className="glass-card mt-3 rounded-2xl p-4">
      <label htmlFor="settings-followups-name" className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Full name</label>
      <input id="settings-followups-name" name="full-name" autoComplete="name" aria-describedby="profile-name-help profile-save-status" value={name} onChange={(event) => onNameChange(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
      <p id="profile-name-help" className="mt-1 text-xs text-slate-600 dark:text-slate-400">Used to recognise transfers between your own accounts.</p>
      <button type="submit" disabled={!dirty || phase === "saving"} className="mt-4 min-h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-transform motion-reduce:transition-none hover:bg-indigo-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-offset-slate-800">
        {phase === "saving" ? "Saving…" : "Save profile"}
      </button>
      <p id="profile-save-status" aria-live="polite" className="mt-2 min-h-5 text-xs font-medium text-slate-700 dark:text-slate-200">{status}</p>
    </form>
  </section>;
}

function dateLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function planLine(info: SubscriptionInfo): { title: string; detail: ReactNode; attention: boolean } {
  const tier = `${info.tier.charAt(0).toUpperCase()}${info.tier.slice(1)}`;
  const provider = info.billing_provider === "apple" ? "the App Store" : info.billing_provider === "google" ? "Google Play" : "Stripe";
  if (info.status === "past_due") return { title: `${tier} plan`, detail: `Payment is being retried. Access is kept until ${dateLabel(info.grace_until) ?? "the end of the grace period"}.`, attention: true };
  if (info.cancel_at_period_end) return { title: `${tier} plan`, detail: `Renewal is cancelled. Access ends on ${dateLabel(info.renews_at) ?? "the end of the current period"}.`, attention: false };
  if (info.status === "trialing") return { title: `${tier} trial`, detail: <>Free until {dateLabel(info.trial_ends_at) ?? "the trial ends"}, then <MoneyText text={`£${(info.prices_gbp[info.tier] ?? 0).toFixed(2)} a month`} /> through {provider}.</>, attention: false };
  if (info.has_paid_subscription) return { title: `${tier} plan`, detail: `Renews ${dateLabel(info.renews_at) ?? "at the end of the current period"} through ${provider}.`, attention: false };
  if (info.tier === "plus") return { title: "Plus access", detail: "No paid subscription.", attention: false };
  return { title: "Statements plan", detail: "Free access with no automatic renewal.", attention: false };
}

export function PlanPreview({ info, phase, onOpenPlans, onRetry }: {
  info: SubscriptionInfo | null;
  phase: "ready" | "loading" | "error";
  onOpenPlans: () => void;
  onRetry: () => void;
}) {
  const loading = phase === "loading";
  const failed = phase === "error";
  const reading = info ? planLine(info) : null;

  return <section aria-labelledby="plan-preview-heading" className="mt-8">
    <h2 id="plan-preview-heading" className="text-base font-bold text-slate-900 dark:text-slate-100">Your plan</h2>
    <div className="glass-card mt-3 overflow-hidden rounded-2xl">
      <button type="button" onClick={failed ? onRetry : onOpenPlans} disabled={loading} className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition-opacity hover:bg-slate-50 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 disabled:cursor-wait dark:hover:bg-slate-700/50">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-600 dark:bg-indigo-400/20 dark:text-indigo-300" aria-hidden="true">{loading ? <Loader2 size={17} className="animate-spin motion-reduce:animate-none" /> : <CreditCard size={17} />}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{loading ? "Checking your plan" : failed ? "Could not load your plan" : reading?.title}</span>
          <span className="mt-0.5 block text-xs leading-5 text-slate-600 dark:text-slate-400">{loading ? "Your current plan will appear here." : failed ? "Tap to try again." : reading?.detail}</span>
        </span>
        {reading?.attention && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-amber-500" />}
        {info?.has_paid_subscription && info.status !== "trialing" && <span className="shrink-0 text-right"><span className="money block text-sm font-semibold text-slate-900 dark:text-slate-100"><MoneyText text={`£${(info.prices_gbp[info.tier] ?? 0).toFixed(2)}`} /></span><span className="block text-[11px] text-slate-500 dark:text-slate-400">a month</span></span>}
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-slate-400" />
      </button>
      <PennyUsageRow info={info} error={failed} className="border-t border-slate-100 dark:border-slate-700" />
    </div>
  </section>;
}
