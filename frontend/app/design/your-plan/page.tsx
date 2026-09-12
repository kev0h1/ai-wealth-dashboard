"use client";

// TEMPORARY PREVIEW, delete with the other /design/* routes.
// B19: five-tier picker variants for Kevin to compare before the picker is
// wired into Settings or onboarding. Static fixtures only, no API calls.
//
// /design/your-plan?variant=a|b|c&context=settings|onboarding&mode=light|dark&billing=off|on

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import PlanPicker from "@/components/PlanPicker";
import type { SubscriptionInfo } from "@wealth/shared";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Crown,
  FileText,
  Landmark,
  Link2,
  X,
  Zap,
} from "lucide-react";

type Variant = "a" | "b" | "c";
type Context = "settings" | "onboarding";
type Mode = "light" | "dark";
type Billing = "off" | "on";
type TierName = "statements" | "lite" | "standard" | "connect" | "max";

type Tier = {
  id: TierName;
  name: string;
  price: number;
  lead: string;
  includes: string[];
  icon: typeof FileText;
};

const TIERS: Tier[] = [
  {
    id: "statements",
    name: "Statements",
    price: 0,
    lead: "A clear money view from uploaded statements.",
    includes: ["3 statement uploads a month", "90 days of history", "10 Penny messages a month"],
    icon: FileText,
  },
  {
    id: "lite",
    name: "Lite",
    price: 5.99,
    lead: "Keep up with day-to-day money across your main banks.",
    includes: ["Up to 3 connected banks", "Daily bank updates", "6 months of history", "40 Penny messages a month"],
    icon: Landmark,
  },
  {
    id: "standard",
    name: "Standard",
    price: 9.99,
    lead: "Your full money picture, kept up to date through the day.",
    includes: ["Up to 20 connected accounts", "Updates every 4 hours", "Full history", "150 Penny messages a month"],
    icon: Zap,
  },
  {
    id: "connect",
    name: "Connect",
    price: 12.99,
    lead: "Use your Sorted figures in an assistant you connect.",
    includes: ["Everything in Standard", "2,000 connected-assistant calls a month", "Read-only sharing you can revoke"],
    icon: Link2,
  },
  {
    id: "max",
    name: "Max",
    price: 16.99,
    lead: "The highest limits and fastest updates.",
    includes: ["All your bank accounts", "Priority bank updates", "400 Penny messages a month", "5,000 connected-assistant calls a month"],
    icon: Crown,
  },
];

const NOTES: Record<Variant, { title: string; thesis: string; risk: string }> = {
  a: {
    title: "A · Capability ladder · recommended",
    thesis: "All five choices stay visible. The selected rung opens into monthly, 3-month, 6-month and yearly renewal choices, with the 14-day trial disclosed against yearly billing.",
    risk: "Longer terms add one decision after the plan choice, so renewal wording stays next to the final action rather than inside every tier row.",
  },
  b: {
    title: "B · Plan cards",
    thesis: "Each plan gets a complete card, making benefits easy to scan without opening anything.",
    risk: "The five-card stack is long and makes the decision feel heavier during onboarding.",
  },
  c: {
    title: "C · Needs first",
    thesis: "Translate tiers into five recognisable jobs before revealing the exact allowance detail.",
    risk: "The plain-language jobs help orientation, but hide more of the factual comparison behind a tap.",
  },
};

function price(tier: Tier): string {
  return tier.price === 0 ? "Free" : `£${tier.price.toFixed(2)}`;
}

function Price({ tier, compact = false }: { tier: Tier; compact?: boolean }) {
  if (tier.price === 0) {
    return <span className={`${compact ? "text-[14px]" : "text-[18px]"} font-bold text-slate-950 dark:text-white`}>Free</span>;
  }
  return (
    <span className="whitespace-nowrap text-slate-950 dark:text-white">
      <span className={`money ${compact ? "text-[14px]" : "text-[18px]"} font-bold`}>£{tier.price.toFixed(2)}</span>
      <span className="ml-0.5 text-[10px] text-slate-400 dark:text-slate-500">/month</span>
    </span>
  );
}

function Includes({ tier, quiet = false }: { tier: Tier; quiet?: boolean }) {
  return (
    <ul className="mt-3 space-y-2">
      {tier.includes.map((item) => (
        <li key={item} className={`flex items-start gap-2 text-[12px] leading-snug ${quiet ? "text-slate-500 dark:text-slate-400" : "text-slate-600 dark:text-slate-300"}`}>
          <Check size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-indigo-500 dark:text-indigo-400" strokeWidth={2.5} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function VariantB({ selected, current, onSelect }: { selected: TierName; current: TierName | null; onSelect: (tier: TierName) => void }) {
  return (
    <div className="space-y-3">
      {TIERS.map((tier) => {
        const active = tier.id === selected;
        const Icon = tier.icon;
        return (
          <button
            type="button"
            key={tier.id}
            onClick={() => onSelect(tier.id)}
            aria-pressed={active}
            className={`w-full rounded-2xl p-4 text-left shadow-sm outline-none transition-transform active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-indigo-500 dark:shadow-none ${active ? "bg-indigo-50 ring-2 ring-indigo-500 dark:bg-indigo-400/[0.08]" : "bg-white ring-1 ring-slate-200/60 dark:bg-[#1e293b] dark:ring-white/[0.07]"}`}
          >
            <span className="flex items-start gap-3">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400"}`}>
                <Icon size={16} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-slate-100">
                    {tier.name}
                    {tier.id === current && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300">Current</span>}
                  </span>
                  <Price tier={tier} />
                </span>
                <span className="mt-1 block text-[12px] leading-snug text-slate-500 dark:text-slate-400">{tier.lead}</span>
                <Includes tier={tier} quiet />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function VariantC({ selected, current, onSelect }: { selected: TierName; current: TierName | null; onSelect: (tier: TierName) => void }) {
  const jobs: Record<TierName, string> = {
    statements: "I upload statements",
    lite: "I want the basics connected",
    standard: "I want my full picture",
    connect: "I use another AI assistant",
    max: "I want the highest limits",
  };
  const chosen = TIERS.find((tier) => tier.id === selected) ?? TIERS[0];
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Choose a plan" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60 dark:bg-[#1e293b] dark:shadow-none dark:ring-white/[0.07]">
        {TIERS.map((tier, index) => {
          const active = tier.id === selected;
          return (
            <button key={tier.id} type="button" role="radio" aria-checked={active} onClick={() => onSelect(tier.id)} className={`flex min-h-[58px] w-full items-center gap-3 px-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${index ? "border-t border-slate-100 dark:border-white/[0.06]" : ""} ${active ? "bg-indigo-50/70 dark:bg-indigo-400/[0.06]" : "active:bg-slate-50 dark:active:bg-white/[0.04]"}`}>
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 dark:border-slate-600"}`}>
                {active && <Check size={11} aria-hidden="true" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-slate-900 dark:text-slate-100">{jobs[tier.id]}</span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">{tier.name}{tier.id === current ? " · Current" : ""}</span>
              </span>
              <span className="money text-[12px] font-semibold text-slate-800 dark:text-slate-200">{price(tier)}</span>
              <ChevronRight size={15} aria-hidden="true" className="text-slate-400" />
            </button>
          );
        })}
      </div>
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 dark:bg-[#1e293b] dark:shadow-none dark:ring-white/[0.07]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">{chosen.name} includes</p>
            <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">{chosen.lead}</p>
          </div>
          <Price tier={chosen} compact />
        </div>
        <Includes tier={chosen} />
      </div>
    </div>
  );
}

function ChoiceAction({ selected, current, billing, context }: { selected: TierName; current: TierName | null; billing: Billing; context: Context }) {
  const tier = TIERS.find((item) => item.id === selected) ?? TIERS[0];
  const isCurrent = selected === current;
  const paidUnavailable = tier.price > 0 && billing === "off";
  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={isCurrent || paidUnavailable}
        className="min-h-12 w-full rounded-xl bg-indigo-600 px-4 text-[14px] font-semibold text-white shadow-sm transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
      >
        {isCurrent ? "Current plan" : context === "onboarding" ? `Continue with ${tier.name}` : tier.id === "statements" ? "Choose Statements" : `Move to ${tier.name}`}
      </button>
      {!isCurrent && paidUnavailable && (
        <p className="mt-2 text-center text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          Paid plans are not available yet. You can start free with Statements.
        </p>
      )}
      {context === "onboarding" && tier.id !== "statements" && billing === "on" && (
        <p className="mt-2 text-center text-[11px] text-slate-500 dark:text-slate-400">You’ll finish payment securely before setup continues.</p>
      )}
    </div>
  );
}

function Controls({ variant, context, mode, billing }: { variant: Variant; context: Context; mode: Mode; billing: Billing }) {
  return (
    <nav aria-label="Preview controls" className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-2" style={{ bottom: "calc(env(safe-area-inset-bottom) + 10px)" }}>
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/15 bg-slate-950/95 p-1 shadow-xl">
        {(["a", "b", "c"] as Variant[]).map((item) => (
          <a key={item} href={`?variant=${item}&context=${context}&mode=${mode}&billing=${billing}`} className={`grid min-h-11 min-w-11 place-items-center rounded-full text-xs font-bold ${variant === item ? "bg-indigo-600 text-white" : "text-slate-400"}`}>{item.toUpperCase()}</a>
        ))}
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/15" />
        <a href={`?variant=${variant}&context=${context === "settings" ? "onboarding" : "settings"}&mode=${mode}&billing=${billing}`} className="flex min-h-11 items-center rounded-full px-2.5 text-[11px] font-semibold text-slate-300">{context === "settings" ? "Onboard" : "Settings"}</a>
        <a href={`?variant=${variant}&context=${context}&mode=${mode === "light" ? "dark" : "light"}&billing=${billing}`} className="flex min-h-11 items-center rounded-full px-2.5 text-[11px] font-semibold text-slate-300">{mode === "light" ? "Dark" : "Light"}</a>
        <a href={`?variant=${variant}&context=${context}&mode=${mode}&billing=${billing === "off" ? "on" : "off"}`} className="flex min-h-11 items-center rounded-full px-2.5 text-[11px] font-semibold text-slate-300">{billing === "off" ? "Billing on" : "Billing off"}</a>
      </div>
    </nav>
  );
}

function Preview() {
  const params = useSearchParams();
  const rawVariant = params.get("variant") ?? params.get("state");
  const rawContext = params.get("context");
  const rawMode = params.get("mode");
  const rawBilling = params.get("billing");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const context: Context = rawContext === "onboarding" ? "onboarding" : "settings";
  const mode: Mode = rawMode === "dark" ? "dark" : "light";
  const billing: Billing = rawBilling === "on" ? "on" : "off";
  const current: TierName | null = context === "settings" ? "standard" : null;
  const [selected, setSelected] = useState<TierName>(() => current ?? "statements");
  const note = NOTES[variant];
  // B22: Kevin's agreed pricing of 2026-09-11 (TODO.md B22 notes), matching
  // backend/app/core/subscription.py's TIER_BILLING_PRICES_GBP verbatim —
  // this preview fabricates a SubscriptionInfo (no API call), so it has to
  // hand-carry the same explicit totals the real endpoint now serves,
  // not a naive monthly-times-months multiplication. The three_months
  // field is kept here too (B27, 2026-09-12: dropped from what's offered)
  // for the same one-line-flip-back reason the backend table keeps its
  // column — it just isn't read by PERIOD_MONTHS/PERIOD_LABELS below, so
  // this preview never offers a period the product doesn't.
  const AGREED_TOTALS: Record<TierName, { monthly: number; three_months: number; six_months: number; annual: number }> = {
    statements: { monthly: 0, three_months: 0, six_months: 0, annual: 0 },
    lite:       { monthly: 5.99, three_months: 16.99, six_months: 31.99, annual: 59.99 },
    standard:   { monthly: 9.99, three_months: 28.99, six_months: 53.99, annual: 99.99 },
    connect:    { monthly: 12.99, three_months: 36.99, six_months: 69.99, annual: 129.99 },
    max:        { monthly: 16.99, three_months: 48.99, six_months: 91.99, annual: 169.99 },
  };
  const PERIOD_MONTHS: Record<"monthly" | "six_months" | "annual", number> = {
    monthly: 1, six_months: 6, annual: 12,
  };
  const PERIOD_LABELS: Record<"monthly" | "six_months" | "annual", string> = {
    monthly: "Monthly", six_months: "Every 6 months", annual: "Yearly",
  };
  const previewInfo = {
    tier: current ?? "statements",
    status: "active",
    prices_gbp: Object.fromEntries(TIERS.map((tier) => [tier.id, tier.price])),
    billing_prices_gbp: Object.fromEntries(TIERS.map((tier) => [tier.id, AGREED_TOTALS[tier.id]])),
    billing_periods: Object.fromEntries(TIERS.map((tier) => [
      tier.id,
      (Object.keys(PERIOD_MONTHS) as (keyof typeof PERIOD_MONTHS)[]).map((id) => {
        const months = PERIOD_MONTHS[id];
        const total = AGREED_TOTALS[tier.id][id];
        const monthlyTotal = tier.price * months;
        const saving_gbp = Number(Math.max(0, monthlyTotal - total).toFixed(2));
        const per_month_gbp = Number((total / months).toFixed(2));
        return { id, label: PERIOD_LABELS[id], months, total, saving_gbp, per_month_gbp };
      }),
    ])),
    trial_periods: ["annual"],
    billing_live: billing === "on",
    trial_days: 14,
    trial_charge_on: "2026-09-25",
  } as SubscriptionInfo;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    return () => {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = "light";
    };
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <main className="min-h-dvh bg-[#f0f2f7] pb-24 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
        <div className="mx-auto min-h-dvh max-w-[430px] px-4 pb-8 pt-[calc(env(safe-area-inset-top)+20px)]">
        {context === "settings" ? (
          <header className="mb-5 flex items-center gap-3">
            <button type="button" aria-label="Back to Settings" className="grid min-h-11 min-w-11 place-items-center rounded-xl text-slate-600 active:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:active:bg-white/[0.05]"><ArrowLeft size={19} /></button>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Your plan</p>
              <h1 className="mt-0.5 text-xl font-bold tracking-tight text-slate-950 dark:text-white">Choose what works for you</h1>
            </div>
            <button type="button" aria-label="Close plan picker" className="grid min-h-11 min-w-11 place-items-center rounded-xl text-slate-500 active:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:active:bg-white/[0.05]"><X size={18} /></button>
          </header>
        ) : (
          <header className="mb-5">
            <div className="mb-7 flex gap-2" aria-label="Onboarding step 3 of 6">
              {[0, 1, 2, 3, 4, 5].map((item) => <span key={item} className={`h-1.5 rounded-full ${item === 2 ? "w-6 bg-indigo-500" : item < 2 ? "w-4 bg-indigo-300 dark:bg-indigo-700" : "w-4 bg-slate-200 dark:bg-slate-700"}`} />)}
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Start your way</p>
            <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-tight text-slate-950 dark:text-white">Choose how you want to use Sorted</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">Statements is free and selected for you. You can change plan any time in Settings.</p>
          </header>
        )}

        {variant === "a" ? (
          <PlanPicker info={previewInfo} context={context} previewOnly />
        ) : (
          <>
            {variant === "b" ? <VariantB selected={selected} current={current} onSelect={setSelected} /> : <VariantC selected={selected} current={current} onSelect={setSelected} />}
            <ChoiceAction selected={selected} current={current} billing={billing} context={context} />
          </>
        )}

        <section className="mt-7 rounded-2xl border border-dashed border-slate-300 px-4 py-3 dark:border-slate-700" aria-label="Design notes">
          <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">{note.title}</p>
          <p className="mt-1.5 text-[12px] leading-snug text-slate-600 dark:text-slate-300">{note.thesis}</p>
          <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">Risk: {note.risk}</p>
        </section>
        </div>
        <Controls variant={variant} context={context} mode={mode} billing={billing} />
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={(
        <main className="grid min-h-dvh place-items-center bg-[#f0f2f7] px-4 dark:bg-[#0f172a]">
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading plan preview…</p>
        </main>
      )}
    >
      <Preview />
    </Suspense>
  );
}
