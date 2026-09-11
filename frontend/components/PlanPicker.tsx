"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Crown, FileText, Landmark, Link2, Zap } from "lucide-react";
import { api } from "@/lib/api";
import type {
  SubscriptionBillingPeriod,
  SubscriptionInfo,
  SubscriptionTier,
} from "@wealth/shared";

type PaidTier = Exclude<SubscriptionTier, "statements">;
type Tier = {
  id: SubscriptionTier;
  name: string;
  lead: string;
  includes: string[];
  icon: typeof FileText;
};

const TIERS: Tier[] = [
  {
    id: "statements",
    name: "Statements",
    lead: "A clear money view from uploaded statements.",
    includes: ["3 statement uploads a month", "90 days of history", "10 Penny messages a month"],
    icon: FileText,
  },
  {
    id: "lite",
    name: "Lite",
    lead: "Keep up with day-to-day money across your main banks.",
    includes: ["Up to 3 connected banks", "Daily bank updates", "6 months of history", "40 Penny messages a month"],
    icon: Landmark,
  },
  {
    id: "standard",
    name: "Standard",
    lead: "Your full money picture, kept up to date through the day.",
    includes: ["Up to 20 connected accounts", "Updates every 4 hours", "Full history", "150 Penny messages a month"],
    icon: Zap,
  },
  {
    id: "connect",
    name: "Connect",
    lead: "Use your Sorted figures in an assistant you connect.",
    includes: ["Everything in Standard", "2,000 connected-assistant calls a month", "Read-only sharing you can revoke"],
    icon: Link2,
  },
  {
    id: "max",
    name: "Max",
    lead: "The highest limits and fastest updates.",
    includes: ["All your bank accounts", "Priority bank updates", "400 Penny messages a month", "5,000 connected-assistant calls a month"],
    icon: Crown,
  },
];

const PERIODS: { id: SubscriptionBillingPeriod; short: string; renewal: string }[] = [
  { id: "monthly", short: "Monthly", renewal: "every month" },
  { id: "three_months", short: "3 months", renewal: "every 3 months" },
  { id: "six_months", short: "6 months", renewal: "every 6 months" },
  { id: "annual", short: "Yearly", renewal: "every year" },
];

const MONTHS: Record<SubscriptionBillingPeriod, number> = {
  monthly: 1,
  three_months: 3,
  six_months: 6,
  annual: 12,
};

function money(value: number): string {
  return Number.isFinite(value) ? `£${value.toFixed(2)}` : "Price unavailable";
}

function tierPrice(info: SubscriptionInfo, tier: SubscriptionTier, period: SubscriptionBillingPeriod): number {
  const configured = info?.billing_prices_gbp?.[tier]?.[period];
  if (typeof configured === "number") return configured;
  const monthly = info.prices_gbp?.[tier];
  return typeof monthly === "number" ? monthly * MONTHS[period] : Number.NaN;
}

function displayIsoDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function MoneyCopy({ text }: { text: string }) {
  return <>{text.split(/(£\d+(?:\.\d+)?)/g).map((part, index) => part.startsWith("£") ? <span key={index} className="money tabular-nums">{part}</span> : part)}</>;
}

function moveRadio(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  count: number,
  select: (nextIndex: number) => void,
) {
  let next = index;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % count;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + count) % count;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = count - 1;
  else return;
  event.preventDefault();
  select(next);
  const group = event.currentTarget.closest('[role="radiogroup"]');
  requestAnimationFrame(() => group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus());
}

export default function PlanPicker({
  info,
  context,
  onContinue,
  previewOnly = false,
}: {
  info: SubscriptionInfo;
  context: "settings" | "onboarding";
  onContinue?: () => void;
  previewOnly?: boolean;
}) {
  const current = info.tier;
  const [selected, setSelected] = useState<SubscriptionTier>(() => context === "onboarding" ? "statements" : (info?.tier ?? "statements"));
  const [period, setPeriod] = useState<SubscriptionBillingPeriod>(info?.billing_period ?? "monthly");
  const [trial, setTrial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = TIERS.find((tier) => tier.id === selected) ?? TIERS[0];
  const chosenPeriod = PERIODS.find((item) => item.id === period) ?? PERIODS[0];
  const total = tierPrice(info, selected, period);
  const trialDays = info.trial_days ?? 14;
  const trialChargeTiming = info.trial_charge_on ? `on ${displayIsoDate(info.trial_charge_on)}` : `after your ${trialDays}-day trial`;
  const billingLive = info.billing_live ?? false;
  const hasPaidSubscription = info.has_paid_subscription === true;
  const managedPaidSubscription = hasPaidSubscription && ["active", "trialing", "past_due"].includes(info.status);
  const billingChangeInPortal = context === "settings" && managedPaidSubscription;

  const disclosure = useMemo(() => {
    if (billingChangeInPortal) {
      if (info.status === "past_due") return "Your payment needs attention. Open billing to update the payment method or change the plan.";
      return "Your active subscription and its renewal are managed securely in billing.";
    }
    if (selected === "statements") return "Free. No card and no automatic renewal.";
    if (trial && period === "annual") {
      return `${trialDays} days free. You will be charged ${money(total)} ${trialChargeTiming}, then every year unless you cancel.`;
    }
    return `${money(total)} ${chosenPeriod.renewal}. Renews ${chosenPeriod.renewal} unless you cancel.`;
  }, [billingChangeInPortal, chosenPeriod.renewal, info.status, period, selected, total, trial, trialChargeTiming, trialDays]);

  async function openPortal() {
    const { url } = await api.openBillingPortal();
    window.location.assign(url);
  }

  async function handlePrimary() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (previewOnly) {
        setError("Preview only. No plan or payment has changed.");
        setBusy(false);
        return;
      }
      if (selected === "statements") {
        if (billingChangeInPortal) {
          await openPortal();
          return;
        }
        if (current !== "statements") await api.selectFreePlan();
        onContinue?.();
        return;
      }

      if (!billingLive) return;
      if (billingChangeInPortal) {
        await openPortal();
        return;
      }
      if (context === "onboarding") localStorage.setItem("wealth_onboarding_resume", "plan");
      const { url } = await api.startCheckout("subscription", selected as PaidTier, {
        billing_period: period,
        trial: trial && period === "annual" && !hasPaidSubscription,
        flow: context,
      });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing. Try again in a moment.");
      setBusy(false);
    }
  }

  const primaryLabel = (() => {
    if (busy) return "Opening…";
    if (billingChangeInPortal) return info.status === "past_due" ? "Fix payment in billing" : "Manage plan and renewal";
    if (selected === "statements") {
      return context === "onboarding" ? "Continue with Statements" : current === "statements" ? "Current plan" : "Choose Statements";
    }
    if (!billingLive) return "Paid plans are not available yet";
    if (trial && period === "annual" && !hasPaidSubscription) return `Start ${trialDays}-day free trial`;
    return `Choose ${chosen.name}`;
  })();

  const disabled = busy || (!billingChangeInPortal && selected !== "statements" && !billingLive) || (context === "settings" && selected === "statements" && current === "statements");

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Choose a plan" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60 dark:bg-slate-800 dark:shadow-none dark:ring-white/[0.07]">
        {TIERS.map((tier, index) => {
          const active = tier.id === selected;
          const Icon = tier.icon;
          const monthly = info.prices_gbp?.[tier.id];
          return (
            <div key={tier.id} className={index ? "border-t border-slate-100 dark:border-white/[0.06]" : ""}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => { setSelected(tier.id); setError(null); }}
                onKeyDown={(event) => moveRadio(event, index, TIERS.length, (next) => { setSelected(TIERS[next].id); setError(null); })}
                className={`flex min-h-[68px] w-full items-center gap-3 px-4 text-left outline-none transition-colors active:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:active:bg-white/[0.04] ${active ? "bg-indigo-50/70 dark:bg-indigo-400/[0.06]" : ""}`}
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400"}`}>
                  <Icon size={16} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{tier.name}</span>
                    {context === "settings" && tier.id === current && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-white/[0.07] dark:text-slate-300">Current</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-slate-400">{tier.lead}</span>
                </span>
                <span className="whitespace-nowrap text-right text-slate-950 dark:text-white">
                  <span className="money block text-sm font-bold">{monthly === 0 ? "Free" : typeof monthly === "number" ? money(monthly) : "Unavailable"}</span>
                  {typeof monthly === "number" && monthly > 0 && <span className="block text-[10px] text-slate-600 dark:text-slate-300">a month</span>}
                </span>
                <ChevronDown size={15} aria-hidden="true" className={`shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${active ? "rotate-180" : ""}`} />
              </button>
              {active && (
                <div className="border-t border-indigo-100/70 bg-indigo-50/40 px-4 pb-4 pt-3 dark:border-indigo-400/10 dark:bg-indigo-400/[0.035]">
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{tier.lead}</p>
                  <ul className="mt-3 space-y-2">
                    {tier.includes.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-xs leading-snug text-slate-600 dark:text-slate-300">
                        <Check size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-indigo-500 dark:text-indigo-400" strokeWidth={2.5} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selected !== "statements" && !billingChangeInPortal && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 dark:bg-slate-800 dark:shadow-none dark:ring-white/[0.07]">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-300">How often would you like to pay?</p>
          <div role="radiogroup" aria-label="Billing period" className="mt-3 grid grid-cols-2 gap-2">
            {PERIODS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={period === item.id}
                tabIndex={period === item.id ? 0 : -1}
                onClick={() => { setPeriod(item.id); if (item.id !== "annual") setTrial(false); }}
                onKeyDown={(event) => moveRadio(event, index, PERIODS.length, (next) => { const nextPeriod = PERIODS[next].id; setPeriod(nextPeriod); if (nextPeriod !== "annual") setTrial(false); })}
                className={`min-h-11 rounded-xl px-3 text-xs font-semibold outline-none transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-indigo-500 ${period === item.id ? "bg-indigo-600 text-white" : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-700/70 dark:text-slate-200 dark:ring-slate-600"}`}
              >
                <span className="block">{item.short}</span>
                <span className={`money mt-0.5 block text-[10px] ${period === item.id ? "text-indigo-100" : "text-slate-600 dark:text-slate-300"}`}>{money(tierPrice(info, selected, item.id))}</span>
              </button>
            ))}
          </div>

          {period === "annual" && !hasPaidSubscription && (
            <button
              type="button"
              role="switch"
              aria-checked={trial}
              onClick={() => setTrial((value) => !value)}
              className={`mt-3 flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left outline-none transition active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-indigo-500 ${trial ? "bg-indigo-50 ring-1 ring-indigo-200 dark:bg-indigo-400/[0.08] dark:ring-indigo-400/20" : "bg-slate-50 ring-1 ring-slate-200 dark:bg-slate-700/60 dark:ring-slate-600"}`}
            >
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${trial ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 dark:border-slate-500"}`}>{trial && <Check size={12} strokeWidth={3} />}</span>
              <span>
                <span className="block text-xs font-semibold text-slate-900 dark:text-slate-100">Start with {trialDays} days free</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-600 dark:text-slate-300"><MoneyCopy text={`Then ${money(total)} a year. Card required, cancel before the trial ends to pay nothing.`} /></span>
              </span>
            </button>
          )}
        </div>
      )}

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 dark:bg-slate-800 dark:shadow-none dark:ring-white/[0.07]">
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300"><MoneyCopy text={disclosure} /></p>
        <button
          type="button"
          onClick={handlePrimary}
          disabled={disabled}
          className="mt-3 min-h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white outline-none transition hover:bg-indigo-700 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
        >
          {primaryLabel}
        </button>
        {selected !== "statements" && !billingLive && (
          <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">You can compare every plan now. Paid checkout will open when billing is live.</p>
        )}
        {error && <p role="alert" className="mt-2 text-xs text-slate-600 dark:text-slate-300">{error}</p>}
      </div>
    </div>
  );
}
