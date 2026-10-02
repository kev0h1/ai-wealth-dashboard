"use client";

// B5: "Your plan" — Settings card placed directly above the Penny card,
// giving the current tier and price and a way to manage billing once it's
// live. Hosts components/PennyUsageRow.tsx (moved here from the Penny
// card, per that component's own "re-homes into a Your plan card (tier,
// price, top-up packs) once billing lands" note) — usage against the
// tier's monthly allowance reads more naturally next to the tier itself
// than inside the agent-mode consent card.
//
// Fully presentational, no fetching of its own — same convention as
// PennyUsageRow.tsx and ConnectedAssistantsCard.tsx, so the live card
// (app/settings/SettingsPage.tsx) and its design preview
// (app/design/your-plan/page.tsx) render the exact same markup against
// real vs. fixture data. Its plan picker owns free-plan selection, paid
// Checkout and customer-portal redirects, keeping every path in one
// production component. Paid actions remain visibly disabled until
// `info.billing_live` becomes true.
//
// Copy: no em dashes (repo-wide rule).

import { useState } from "react";
import { CreditCard } from "lucide-react";
import type { SubscriptionInfo } from "@/lib/api";
import PennyUsageRow from "@/components/PennyUsageRow";
import PlanPicker from "@/components/PlanPicker";
import { refreshPennyUsage } from "@/components/PennySheetProvider";
import { usePurchaseAvailability, PURCHASE_UNAVAILABLE_SENTENCE } from "@/lib/nativeAuth";
import { SheetFrame } from "@/components/SheetFrame";

const INDIGO = "#4f46e5";

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function MoneyCopy({ text }: { text: string }) {
  return <>{text.split(/(£\d+(?:\.\d+)?)/g).map((part, index) => part.startsWith("£") ? <span key={index} className="money tabular-nums">{part}</span> : part)}</>;
}

function formatSubtitle(info: SubscriptionInfo | null, error: boolean): string {
  if (!info) return error ? "Could not load your plan" : "Checking…";
  const tierName = capitalize(info.tier);
  if (info.status === "trialing" && info.trial_ends_at) {
    return `${tierName} trial, free until ${shortDate(info.trial_ends_at)}`;
  }
  if (info.status === "past_due") return `${tierName} plan, payment needs attention`;
  if (info.cancel_at_period_end && info.renews_at) {
    return `${tierName} plan, ends ${shortDate(info.renews_at)}`;
  }
  const price = info.prices_gbp?.[info.tier];
  if (typeof price !== "number") return `${tierName} plan`;
  if (price === 0) return `${tierName} plan, free`;
  const period = info.billing_period ?? "monthly";
  const total = info.billing_prices_gbp?.[info.tier]?.[period] ?? price;
  const renewal = period === "annual" ? "a year" : period === "six_months" ? "every 6 months" : period === "three_months" ? "every 3 months" : "a month";
  return `${tierName} plan, £${total.toFixed(2)} ${renewal}`;
}

export default function YourPlanCard({
  info,
  error = false,
}: {
  info: SubscriptionInfo | null;
  /** True once a fetch has been attempted and still left `info` null (a
   * failed GET /subscription) — mirrors PennyUsageRow.tsx's own `error`
   * prop, and is passed straight through to it. */
  error?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const subtitle = formatSubtitle(info, error);
  const purchaseAvailability = usePurchaseAvailability();

  return (
    <>
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-start gap-2.5">
        <span
          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${INDIGO}26` }}
          aria-hidden="true"
        >
          <CreditCard size={16} style={{ color: INDIGO }} />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Your plan</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5"><MoneyCopy text={subtitle} /></p>
        </div>
      </div>

      <PennyUsageRow info={info} error={error} className="border-b border-slate-100 dark:border-slate-700" />

      <div className="px-4 py-3.5">
        <button
          type="button"
          onClick={() => { if (info) setPickerOpen(true); else if (error) void refreshPennyUsage(); }}
          disabled={!info && !error}
          className="min-h-11 rounded-xl px-3 text-sm font-medium text-indigo-600 outline-none transition-colors hover:bg-indigo-50 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:text-slate-500 dark:text-indigo-400 dark:hover:bg-indigo-900/10 dark:disabled:text-slate-400"
        >
          {info ? "See plans" : error ? "Try loading plans again" : "Checking plans…"}
        </button>
        {/* B26: on native this never mentions checkout going live, since
            it never will in this app (Apple guideline 3.1.1, no in-app
            purchase integration) — only shown for a free-tier user, an
            existing paid subscriber's status already reads from the
            subtitle above with nothing further to say here. */}
        {/* B40: usePurchaseAvailability() starts "unknown" through SSR and
            the first client render, resolving to "web"/"native" only
            after mount, so this never shows the wrong branch during the
            server-render/hydration gap the way a direct canPurchaseInApp()
            call in render could. "unknown" reads the same as "native"
            here (falls into the unavailable-sentence branch), matching
            the fail-closed direction of canPurchaseInApp() itself. */}
        {purchaseAvailability !== "web" ? (
          info?.tier === "statements" && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{PURCHASE_UNAVAILABLE_SENTENCE}</p>
          )
        ) : (
          !info?.billing_live && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">You can choose Statements now. Paid checkout is not live yet.</p>
          )
        )}
      </div>

    </div>

      {pickerOpen && info && (
        <SheetFrame
          title="Choose what fits"
          description="Compare all five plans, then choose how often you want a paid plan to renew."
          onClose={() => setPickerOpen(false)}
        >
              <PlanPicker
                key={`${info?.tier ?? "loading"}-${info?.billing_period ?? "monthly"}`}
                info={info}
                context="settings"
                onContinue={() => { setPickerOpen(false); void refreshPennyUsage(); }}
              />
        </SheetFrame>
      )}
    </>
  );
}
