"use client";

// Reached from the Penny sheet header's usage-ring crossfade (tap the title
// a second time while it shows the count — see PennySheet.tsx's
// AvatarRingButton) and from the composer's "Get more messages" link once
// the tier hits its monthly cap (PennyConversation.tsx's composer). Ported
// from the approved design preview (app/design/penny-usage-ring/
// MoreMessagesSheet.tsx, variant A2) with real data from
// PennySheetProvider's usePennyUsage() singleton, and wired to close via
// that same file's closeMoreMessagesSheet() rather than local state — the
// two trigger points live in different components (PennySheet.tsx and
// PennyConversation.tsx), so open/closed has to be shared the same way
// usePennySheet() itself already is.
//
// Rendered by PennySheet.tsx as an absolute overlay on top of the existing
// floating panel (header + thread + composer), not as its own portal/sheet
// — see that file's own render for the exact positioning.
//
// B5: rows are real buttons once `info.billing_live` is true (POST
// /billing/checkout, api.startCheckout) — tapping a pack or the Move to Max
// row starts a Stripe Checkout session and redirects the browser to it
// (window.location.assign). Until BILLING_ENABLED flips true somewhere
// (no Stripe account exists yet, see CLAUDE.md's Backlog B5 note), every
// row still renders the muted "Available soon" trailing label instead, so
// nothing here reads as broken.
//
// B26: on a native build neither row can ever become a real button,
// regardless of `billing_live` — Apple's guideline 3.1.1 forbids a button,
// link, or "buy here" copy pointing at anything other than in-app
// purchase, which this app has never wired up on either platform, so
// `canPurchaseInApp()` (frontend/lib/nativeAuth.ts) gates the interactive
// state the same way `billing_live` already did, and a native build gets
// its own trailing label ("Not available on this app") rather than
// "Available soon", which would wrongly promise it'll show up here later.
//
// B11 (docs/pricing/tiering-unit-economics-mcp-2026-09.md section 9):
// replaced the single £2.99/100-message row with three packs, good/better/
// best, read from `info.topups` (falls back to the legacy single-pack
// `info.topup` if an older backend hasn't deployed `topups` yet). Packs
// last 90 days and draw down after the monthly allowance — the footnote
// below says so. After a user's SECOND pack purchase in one calendar month
// (`usage.penny_packs_bought_this_month`), the Move to Max row leads and
// the packs render below it instead of above.
//
// Copy rules: no em dashes, British English, "Move to Max" not "upgrade"
// (Kevin's framing, see the design preview's own header comment for why).

import { useState } from "react";
import { X } from "lucide-react";
import { usePennyUsage, formatPennyResetDate } from "@/components/PennySheetProvider";
import { api } from "@/lib/api";
import { canPurchaseInApp } from "@/lib/nativeAuth";
import type { SubscriptionTopupPack } from "@wealth/shared";

const LEGACY_FALLBACK_PACKS: SubscriptionTopupPack[] = [
  { id: "small", messages: 20, price_gbp: 0.99, badge: null },
  { id: "medium", messages: 100, price_gbp: 2.99, badge: "Most popular" },
  { id: "large", messages: 200, price_gbp: 4.99, badge: "Best value" },
];

/** B26: `"buy"` (real Checkout button), `"soon"` (billing not live yet, but
 * this platform will get a real button once it is, so "Available soon" is
 * still true), or `"unavailable"` (native, where "soon" would be a false
 * promise since this platform never gets a purchase button). */
type PurchaseRowStatus = "buy" | "soon" | "unavailable";

function TrailingPrice({
  priceGbp, status, busy,
}: {
  priceGbp: number | undefined;
  status: PurchaseRowStatus;
  busy: boolean;
}) {
  return (
    <span className="flex-shrink-0 flex flex-col items-end gap-0.5">
      {typeof priceGbp === "number" && (
        <span className="font-mono text-[13px] text-slate-900 dark:text-slate-100">£{priceGbp.toFixed(2)}</span>
      )}
      {status === "buy" ? (
        <span className="text-[10px] font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
          {busy ? "Opening…" : "Buy"}
        </span>
      ) : (
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {status === "soon" ? "Available soon" : "Not available on this app"}
        </span>
      )}
    </span>
  );
}

function PackRow({
  pack, status, busy, onBuy,
}: {
  pack: SubscriptionTopupPack;
  status: PurchaseRowStatus;
  busy: boolean;
  onBuy: () => void;
}) {
  const inner = (
    <>
      <span className="flex items-center gap-2 min-w-0 pr-2">
        <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100">
          {pack.messages} messages
        </span>
        {pack.badge && (
          <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/15 rounded-full px-2 py-0.5">
            {pack.badge}
          </span>
        )}
      </span>
      <TrailingPrice priceGbp={pack.price_gbp} status={status} busy={busy} />
    </>
  );

  if (status !== "buy") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 min-h-[44px]">
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onBuy}
      disabled={busy}
      className="w-full flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 min-h-[44px] text-left active:scale-[0.99] transition-transform disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      {inner}
    </button>
  );
}

export default function MoreMessagesSheet({ onClose }: { onClose: () => void }) {
  const usage = usePennyUsage();
  const info = usage.info;
  const used = info?.usage.penny_messages ?? 0;
  const limit = info?.usage.penny_limit ?? 0;
  const resetLabel = formatPennyResetDate(usage.resetsOn);
  const packs = info?.topups?.length ? info.topups : LEGACY_FALLBACK_PACKS;
  // ASSUMPTION (contract doesn't name this key explicitly — flagged in this
  // feature's own report): `prices_gbp` is keyed by SubscriptionTier value,
  // same as every other tier reference in this codebase (SubscriptionTier
  // itself is "statements" | "lite" | "standard" | "connect" | "max"), so
  // the Max tier's own monthly price is `prices_gbp.max`.
  const maxPrice = info?.prices_gbp?.max;
  const billingLive = info?.billing_live ?? false;
  // B26: neither row can ever become a real button on a native build, see
  // this file's top comment — computed once and fed into every row's
  // status below rather than re-checked per row.
  const purchasingAllowed = canPurchaseInApp();
  const rowStatus: PurchaseRowStatus = !purchasingAllowed ? "unavailable" : billingLive ? "buy" : "soon";
  // Hide the Max row entirely once the user is already on it — there is
  // nothing to move to.
  const onMax = info?.tier === "max";
  // Leads with Move to Max once a second pack has been bought this month
  // (section 9's cannibalisation guard for the large pack).
  const maxLeads = (info?.usage.penny_packs_bought_this_month ?? 0) >= 2 && !onMax;

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function buy(kind: "subscription" | "pack", target: string) {
    if (pendingId || !purchasingAllowed) return;
    setErrorMsg(null);
    setPendingId(target);
    try {
      const { url } = await api.startCheckout(kind, target);
      window.location.assign(url);
    } catch {
      setErrorMsg("Could not start checkout. Try again in a moment.");
      setPendingId(null);
    }
  }

  const maxRow = !onMax && (
    rowStatus === "buy" ? (
      <button
        type="button"
        onClick={() => buy("subscription", "max")}
        disabled={!!pendingId}
        className="w-full flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 min-h-[44px] text-left active:scale-[0.99] transition-transform disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100 pr-2">
          Move to Max, 400 a month
        </span>
        <TrailingPrice priceGbp={maxPrice} status={rowStatus} busy={pendingId === "max"} />
      </button>
    ) : (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 min-h-[44px]">
        <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100 pr-2">
          Move to Max, 400 a month
        </span>
        <TrailingPrice priceGbp={maxPrice} status={rowStatus} busy={false} />
      </div>
    )
  );

  const packRows = packs.map((pack) => (
    <PackRow
      key={pack.id}
      pack={pack}
      status={rowStatus}
      busy={pendingId === pack.id}
      onBuy={() => buy("pack", pack.id)}
    />
  ));

  return (
    // Backdrop — tapping outside the card closes it, same convention as
    // every other sheet in this app (PennySheet.tsx's own click-catcher,
    // CommitmentSheet.tsx, etc).
    <div
      className="absolute inset-0 z-10 flex flex-col justify-end bg-slate-900/40 p-3 rounded-3xl"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More Penny messages"
        onClick={(e) => e.stopPropagation()}
        className="w-full glass-sheet rounded-3xl shadow-xl ring-1 ring-black/[0.06] dark:ring-white/[0.12] px-5 pt-4 pb-5 space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">More Penny messages</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 min-w-[44px] min-h-[44px] -m-2.5 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:scale-90 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X size={15} className="text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
          You have used <span className="money">{used}</span> of <span className="money">{limit}</span> this month.
          Your allowance resets on {resetLabel}.
        </p>

        <div className="space-y-2">
          {maxLeads ? (
            <>
              {maxRow}
              {packRows}
            </>
          ) : (
            <>
              {packRows}
              {maxRow}
            </>
          )}
        </div>

        {errorMsg && (
          <p className="text-[11px] leading-snug text-red-500 dark:text-red-400">{errorMsg}</p>
        )}

        <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          Packs last 90 days and are used after your monthly allowance. Quick questions from the chips are always free.
        </p>
      </div>
    </div>
  );
}
