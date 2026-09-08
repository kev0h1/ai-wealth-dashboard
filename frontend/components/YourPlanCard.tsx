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
// real vs. fixture data. The one exception is "Manage plan" itself, which
// calls POST /billing/portal directly (api.openBillingPortal) and
// redirects the browser there, the same self-contained pattern
// ConnectedAssistantsCard.tsx's MCP pack row and MoreMessagesSheet.tsx use
// for checkout.
//
// "Manage plan" only renders once `info.billing_live` is true; until a
// Stripe account exists (see CLAUDE.md's Backlog B5 note) the card instead
// shows the quiet line "Plans and packs are coming soon." — no dead
// button.
//
// Copy: no em dashes (repo-wide rule).

import { useState } from "react";
import { CreditCard } from "lucide-react";
import { api } from "@/lib/api";
import type { SubscriptionInfo } from "@/lib/api";
import PennyUsageRow from "@/components/PennyUsageRow";

const INDIGO = "#4f46e5";

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function formatSubtitle(info: SubscriptionInfo | null, error: boolean): string {
  if (!info) return error ? "Could not load your plan" : "Checking…";
  const tierName = capitalize(info.tier);
  const price = info.prices_gbp?.[info.tier];
  if (typeof price !== "number") return `${tierName} plan`;
  return price > 0 ? `${tierName} plan, £${price.toFixed(2)} a month` : `${tierName} plan, free`;
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
  const [busy, setBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const billingLive = info?.billing_live ?? false;
  const subtitle = formatSubtitle(info, error);

  async function handleManagePlan() {
    if (busy) return;
    setPortalError(null);
    setBusy(true);
    try {
      const { url } = await api.openBillingPortal();
      window.location.assign(url);
    } catch {
      setPortalError("Could not open billing. Try again in a moment.");
      setBusy(false);
    }
  }

  return (
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
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
        </div>
      </div>

      <PennyUsageRow info={info} error={error} className="border-b border-slate-100 dark:border-slate-700" />

      <div className="px-4 py-3.5">
        {billingLive ? (
          <>
            <button
              type="button"
              onClick={handleManagePlan}
              disabled={busy}
              className="min-h-[44px] px-3 text-sm font-medium text-indigo-600 dark:text-indigo-400 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/10 active:bg-indigo-100 transition-colors disabled:opacity-60"
            >
              {busy ? "Opening…" : "Manage plan"}
            </button>
            {portalError && (
              <p className="text-xs text-red-500 dark:text-red-400 mt-1">{portalError}</p>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">Plans and packs are coming soon.</p>
        )}
      </div>
    </div>
  );
}
