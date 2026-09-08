"use client";

// TEMPORARY PREVIEW — delete with the other /design/* routes.
// B5: "Your plan" Settings card, real components/YourPlanCard.tsx (placed
// directly above the Penny card in app/settings/SettingsPage.tsx, hosting
// PennyUsageRow.tsx the way that component's own docstring anticipated)
// against static SubscriptionInfo fixtures, no data fetching, no session
// — /design/* is exempt (see components/AuthProvider.tsx).
//
// Two headline states per Kevin's ask: billing not live (today, everywhere
// — no Stripe account exists yet, "Plans and packs are coming soon.") and
// billing live (once BILLING_ENABLED, "Manage plan" opens Stripe's
// customer portal). "Manage plan" is wired to the real
// api.openBillingPortal() call inside YourPlanCard.tsx itself (same
// self-contained pattern as MoreMessagesSheet.tsx's checkout buttons) — on
// this unauthenticated preview page clicking it will fail and show the
// component's own inline error line, which is the correct, safe failure
// mode to demonstrate here rather than something to route around.
//
// Deep-linkable at /design/your-plan.

import YourPlanCard from "@/components/YourPlanCard";
import type { SubscriptionInfo } from "@/lib/api";

function fixture(
  tier: SubscriptionInfo["tier"],
  billingLive: boolean,
  usage: Partial<SubscriptionInfo["usage"]>,
): SubscriptionInfo {
  return {
    tier,
    status: "active",
    prices_gbp: { statements: 0, lite: 5.99, standard: 9.99, connect: 12.99, max: 16.99 },
    billing_live: billingLive,
    topup: { messages: 100, price_gbp: 2.99 },
    topups: [
      { id: "small", messages: 20, price_gbp: 0.99, badge: null },
      { id: "medium", messages: 100, price_gbp: 2.99, badge: "Most popular" },
      { id: "large", messages: 200, price_gbp: 4.99, badge: "Best value" },
    ],
    limits: {
      open_banking: true,
      max_banks: null,
      max_accounts: null,
      refresh: "daily",
      penny_messages_per_month: 150,
      mcp_tool_calls_per_month: null,
      history_days: null,
      statement_uploads_per_month: null,
    },
    usage: {
      year_month: "2026-09",
      penny_messages: 0,
      cost_usd: 0,
      penny_limit: 150,
      penny_remaining: 150,
      penny_resets_on: "2026-10-01",
      penny_topup_messages: 0,
      penny_topup_expires_soonest: null,
      penny_packs_bought_this_month: 0,
      ...usage,
    },
  };
}

const NOT_LIVE = fixture("standard", false, { penny_messages: 37, penny_limit: 150, penny_remaining: 113 });
const LIVE_STANDARD = fixture("standard", true, { penny_messages: 92, penny_limit: 150, penny_remaining: 58 });
const LIVE_MAX = fixture("max", true, { penny_messages: 84, penny_limit: null, penny_remaining: null });
const LOADING = null;

function CardFrame({ label, info, error = false }: { label: string; info: SubscriptionInfo | null; error?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">{label}</p>
      <YourPlanCard info={info} error={error} />
    </div>
  );
}

function ThemeBlock({ dark }: { dark: boolean }) {
  return (
    <div className={dark ? "dark" : ""} style={{ colorScheme: dark ? "dark" : "light" }}>
      <div className="rounded-3xl p-4 space-y-5 bg-[#f0f2f7] dark:bg-[#0f172a]">
        <CardFrame label="Billing not live (today, everywhere)" info={NOT_LIVE} />
        <CardFrame label="Billing live, Standard plan" info={LIVE_STANDARD} />
        <CardFrame label="Billing live, Max plan (unlimited Penny messages)" info={LIVE_MAX} />
        <CardFrame label="Loading" info={LOADING} />
        <CardFrame label="Failed to load" info={null} error={true} />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <div className="min-h-screen bg-[#f0f2f7] dark:bg-[#0f172a]">
      <div className="mx-auto max-w-[430px] px-4 py-8">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Your plan</h1>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Backlog B5, real YourPlanCard.tsx against fixtures
        </p>

        <div className="mt-6 flex flex-col gap-8">
          <ThemeBlock dark={false} />
          <ThemeBlock dark={true} />
        </div>

        <p className="mt-8 text-[11px] text-slate-500 dark:text-slate-400 text-pretty">
          Tier and price come from `prices_gbp[tier]` (GET /subscription). PennyUsageRow.tsx renders unchanged
          inside this card, moved here from the Penny card. &ldquo;Manage plan&rdquo; only appears once
          `billing_live` is true and opens Stripe&apos;s customer portal (POST /billing/portal); until then the
          card shows &ldquo;Plans and packs are coming soon.&rdquo; Neither state is reachable in any environment
          today, no Stripe account exists yet (see CLAUDE.md&apos;s Backlog B5 note and DEPLOY.md&apos;s Stripe
          setup checklist).
        </p>
      </div>
    </div>
  );
}
