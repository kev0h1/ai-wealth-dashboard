"use client";

// Settings' compact plan entry. PlanPicker remains the sole owner of plan
// selection and billing actions; this component only presents the current
// subscription and opens that existing flow.

import { useEffect, useState } from "react";
import { ChevronRight, CreditCard, Loader2 } from "lucide-react";
import type { SubscriptionInfo } from "@/lib/api";
import PennyUsageRow from "@/components/PennyUsageRow";
import PlanPicker from "@/components/PlanPicker";
import { refreshPennyUsage } from "@/components/PennySheetProvider";
import { usePurchaseChannel, PURCHASE_UNAVAILABLE_SENTENCE } from "@/lib/nativeAuth";
import { SheetFrame } from "@/components/SheetFrame";
import { api } from "@/lib/api";
import { appleManageLine, endsOnLine, FIX_PAYMENT_LABEL, googleManageLine, paymentFailedBody, paymentFailedBodyApple, paymentFailedBodyGoogle, PAYMENT_FAILED_TITLE } from "@/lib/billingCopy";

function capitalize(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value;
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function MoneyCopy({ text }: { text: string }) {
  return <>{text.split(/(£\d+(?:\.\d+)?)/g).map((part, index) => part.startsWith("£") ? <span key={index} className="money tabular-nums">{part}</span> : part)}</>;
}

function providerName(provider: SubscriptionInfo["billing_provider"]): string | null {
  if (provider === "apple") return "the App Store";
  if (provider === "google") return "Google Play";
  if (provider === "stripe") return "Stripe";
  return null;
}

function periodLabel(period: SubscriptionInfo["billing_period"]): string | null {
  if (period === "annual") return "a year";
  if (period === "six_months") return "every 6 months";
  if (period === "three_months") return "every 3 months";
  if (period === "monthly") return "a month";
  return null;
}

function planReading(info: SubscriptionInfo): { title: string; detail: string; price: string | null; period: string | null; attention: boolean } {
  const tier = capitalize(info.tier);
  const provider = providerName(info.billing_provider);
  const title = info.status === "trialing" ? `${tier} trial` : `${tier} plan`;
  const total = info.billing_period ? info.billing_prices_gbp?.[info.tier]?.[info.billing_period] : undefined;
  const period = periodLabel(info.billing_period);
  // Cancellation wins over a trial reading: access ends, rather than renews.
  if (info.cancel_at_period_end) {
    const end = info.status === "trialing" && info.trial_ends_at ? info.trial_ends_at : info.renews_at;
    return { title, detail: end ? `Renewal is cancelled. ${endsOnLine(end, shortDate)}.` : "Renewal is cancelled.", price: null, period: null, attention: false };
  }
  if (info.status === "past_due") {
    return { title, detail: `Payment is being retried${info.grace_until ? `. Access is kept until ${shortDate(info.grace_until)}.` : "."}`, price: null, period: null, attention: true };
  }
  if (info.status === "trialing") {
    const charge = typeof total === "number" && period ? `, then £${total.toFixed(2)} ${period}${provider ? ` through ${provider}` : ""}.` : ".";
    return { title, detail: info.trial_ends_at ? `Free until ${shortDate(info.trial_ends_at)}${charge}` : "Free trial.", price: null, period: null, attention: false };
  }
  if (info.status === "expired") {
    return { title, detail: "Your paid plan has ended.", price: null, period: null, attention: false };
  }
  if (!info.has_paid_subscription) {
    return { title: info.tier === "plus" ? "Plus access" : title, detail: info.tier === "plus" ? "No paid subscription." : "Free access with no automatic renewal.", price: null, period: null, attention: false };
  }

  // A paid subscription only displays an amount supplied for its actual
  // period. Do not infer a monthly price from a missing period table.
  const detail = info.renews_at
    ? `Renews ${shortDate(info.renews_at)}${provider ? ` through ${provider}` : ""}.`
    : provider ? `Billed through ${provider}.` : "Paid subscription.";
  return { title, detail, price: typeof total === "number" ? `£${total.toFixed(2)}` : null, period: typeof total === "number" ? period : null, attention: false };
}

export default function YourPlanCard({
  info,
  error = false,
  onRetry,
}: {
  info: SubscriptionInfo | null;
  /** True once a subscription request has failed. */
  error?: boolean;
  /** Lets a host provide its own refresh action while preserving the existing default. */
  onRetry?: () => void | Promise<void>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fixBusy, setFixBusy] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const hasPlan = Boolean(info);

  useEffect(() => {
    if (!hasPlan || new URLSearchParams(window.location.search).get("plans") !== "1") return;
    const frame = requestAnimationFrame(() => setPickerOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [hasPlan]);

  async function retry() {
    if (onRetry) await onRetry();
    else await refreshPennyUsage();
  }

  async function fixPayment() {
    if (fixBusy) return;
    setFixBusy(true);
    setFixError(null);
    try {
      const { url } = await api.openBillingPortal();
      window.location.assign(url);
    } catch {
      setFixError("Could not open billing. Try again in a moment.");
      setFixBusy(false);
    }
  }

  const channel = usePurchaseChannel();
  const appleSourced = info?.billing_provider === "apple";
  const googleSourced = info?.billing_provider === "google";
  const reading = info ? planReading(info) : null;
  const loading = !info && !error;
  const failed = !info && error;

  return <>
    <div className="glass-card overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={() => { if (info) setPickerOpen(true); else if (error) void retry(); }}
        disabled={loading}
        className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 disabled:cursor-wait dark:hover:bg-slate-700/50"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" aria-hidden="true">
          {loading ? <Loader2 size={17} className="animate-spin motion-reduce:animate-none" /> : <CreditCard size={17} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{loading ? "Checking your plan" : failed ? "Could not load your plan" : reading?.title}</span>
          <span className="mt-0.5 block text-xs leading-5 text-slate-600 dark:text-slate-400">{loading ? "Your current plan will appear here." : failed ? "Tap to try again." : <MoneyCopy text={reading?.detail ?? ""} />}</span>
        </span>
        {reading?.attention && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-amber-500" />}
        {reading?.price && <span className="shrink-0 text-right"><span className="money block text-sm font-semibold text-slate-900 dark:text-slate-100">{reading.price}</span>{reading.period && <span className="block text-[11px] text-slate-500 dark:text-slate-400">{reading.period}</span>}</span>}
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-slate-400" />
      </button>

      {info?.status === "past_due" && <div role="status" className="border-t border-slate-100 px-4 py-3 dark:border-slate-700">
        <p className="flex items-start gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100"><span aria-hidden="true" className="mt-1 size-2 shrink-0 rounded-full bg-amber-500" />{PAYMENT_FAILED_TITLE}</p>
        <p className="mt-1 pl-4 text-[11px] leading-snug text-slate-600 dark:text-slate-300">{appleSourced ? paymentFailedBodyApple(info.grace_days) : googleSourced ? paymentFailedBodyGoogle(info.grace_days) : paymentFailedBody(info.grace_days)}</p>
        {channel === "stripe_web" && !appleSourced && !googleSourced && <button type="button" onClick={fixPayment} disabled={fixBusy} className="ml-4 mt-2 min-h-11 rounded-xl px-3 text-sm font-medium text-indigo-600 outline-none transition-colors hover:bg-indigo-50 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:text-slate-500 dark:text-indigo-400 dark:hover:bg-indigo-900/10">{fixBusy ? "Opening…" : FIX_PAYMENT_LABEL}</button>}
        {fixError && <p role="alert" className="mt-1 pl-4 text-xs text-slate-600 dark:text-slate-300">{fixError}</p>}
      </div>}

      <PennyUsageRow info={info} error={error} className="border-t border-slate-100 dark:border-slate-700" />

      {(appleSourced || googleSourced || info?.double_play_subscription === true || (channel !== "storekit" && channel !== "play" && channel !== "stripe_web" && info?.tier === "statements")) && <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
        {appleSourced && <p>{appleManageLine}</p>}
        {(googleSourced || info?.double_play_subscription === true) && <p className={appleSourced ? "mt-1" : undefined}>{googleManageLine}</p>}
        {channel !== "storekit" && channel !== "play" && channel !== "stripe_web" && info?.tier === "statements" && <p className={(appleSourced || googleSourced || info?.double_play_subscription) ? "mt-1" : undefined}>{PURCHASE_UNAVAILABLE_SENTENCE}</p>}
      </div>}
    </div>

    {pickerOpen && info && <SheetFrame title="Choose what fits" description="Compare all four plans, then choose how often you want a paid plan to renew." onClose={() => setPickerOpen(false)}>
      <PlanPicker key={`${info.tier}-${info.billing_period ?? "monthly"}`} info={info} context="settings" onContinue={() => { setPickerOpen(false); void refreshPennyUsage(); }} />
    </SheetFrame>}
  </>;
}
