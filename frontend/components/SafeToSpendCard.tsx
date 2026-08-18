"use client";

import { ShieldCheck, AlertCircle, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { SafeToSpend } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { useCountUp } from "@/lib/useCountUp";

interface SafeToSpendCardProps {
  data: SafeToSpend | null;
  loading?: boolean;
  suppressCTA?: boolean;
  /** Net card growth since payday (GET /needle/summary → current.card_delta_so_far). */
  cardDeltaSoFar?: number | null;
}

function fmt(n: number): string {
  return `£${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function fmt2(n: number): string {
  return `£${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Returns a human-readable freshness string, or null if data is fresh (< 3 h old).
 *  Guards against negative diffs from clock skew by treating them as fresh. */
function syncAgeLabel(isoString: string | null | undefined): string | null {
  if (!isoString) return null;
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs < 0) return null; // clock skew — treat as fresh
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 3) return null; // fresh — render nothing
  if (diffH < 24) return `Synced ${Math.floor(diffH)} hours ago`;
  if (diffH < 48) return "Synced yesterday";
  const diffD = diffMs / (1000 * 60 * 60 * 24);
  if (diffD < 7) return `Synced ${Math.floor(diffD)} days ago`;
  const d = new Date(isoString);
  return `Synced on ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

export default function SafeToSpendCard({ data, loading, suppressCTA, cardDeltaSoFar }: SafeToSpendCardProps) {
  const { hideNetWorth: hidden } = usePreferences();
  const router = useRouter();

  // Tiny negative floats (rounding/float artefacts, e.g. -£0.03) must never
  // render as "−£0" or flip a verdict into the alarm state. Widened to < 1
  // (not < 0.5) so it lines up exactly with the "genuine shortfall" remap
  // threshold below (freeAmount > -1 ⇒ comfortable) — otherwise the
  // (-1,-0.5] band survives zeroSafe as a small negative number, which
  // fmt()'s Math.abs+round then displays as a positive "£1 to spare" on a
  // GREEN comfortable card for a user who is actually short. Accepted side
  // effect: raw values in +0.5..0.99 now also normalise to £0 instead of £1.
  // Applied before every sign check, colour choice, and verdict branch.
  const zeroSafe = (v: number) => (Math.abs(v) < 1 ? 0 : v);

  // Count-up targets for the NOW / BILLS / FREE tiles — computed unconditionally
  // (before any early return) since hooks can't be called conditionally. Falls
  // back to 0 when there's no "ok" data yet; the hook itself no-ops until the
  // card actually renders these values.
  const okData = data?.status === "ok" ? data : null;
  const nowTarget = okData?.spendable_now ?? 0;
  const billsTarget = zeroSafe(okData?.bills_total ?? 0);
  const freeTarget = okData ? Math.abs(zeroSafe(okData.safe_to_spend)) : 0;
  const nowCounted = useCountUp(nowTarget);
  const billsCounted = useCountUp(billsTarget);
  const freeCounted = useCountUp(freeTarget);

  // Loading skeleton — only while this card's own data hasn't arrived yet;
  // once data exists we render it even if a background refresh is in flight
  if (loading && !data) {
    return (
      <div className="rounded-3xl p-5 glass-hero">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-3">
          Safe to Spend
        </p>
        <div className="h-6 w-56 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse mb-3" />
        <div className="grid grid-cols-3 gap-2">
          <div className="h-14 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />
          <div className="h-14 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />
          <div className="h-14 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  // Render nothing when data is absent or insufficient
  if (!data || data.status === "insufficient_data") return null;

  const {
    safe_to_spend,
    state: rawState,
    next_payday,
    bills_total,
    estimated,
    spendable_now,
    payday_income,
    card_debt,
  } = data;

  // Normalised free-cash figure — see zeroSafe above. A backend "short"
  // state only earns the alarm verdict/colour when the shortfall is real
  // (≥ £1 after normalisation); anything smaller is rounding noise and
  // falls through to the normal on-track ("comfortable") verdict path.
  const freeAmount = zeroSafe(safe_to_spend);
  const state: "comfortable" | "tight" | "short" =
    rawState === "short" && freeAmount > -1 ? "comfortable" : rawState;

  const gap = Math.abs(freeAmount); // used when short (guaranteed >= 1 here)

  // Distance-aware label for next payday — today/tomorrow/weekday name (2–6
  // days away)/short date (7+ days away). Prevents "Tight until Friday"
  // misreading as "this Friday" when payday is actually weeks out.
  const paydayDate = new Date(next_payday);
  paydayDate.setHours(0, 0, 0, 0);
  const _today0 = new Date();
  _today0.setHours(0, 0, 0, 0);
  const daysAway = Math.round((paydayDate.getTime() - _today0.getTime()) / 86400000);
  const paydayLabel =
    daysAway <= 0 ? "today"
    : daysAway === 1 ? "tomorrow"
    : daysAway < 7 ? new Date(next_payday).toLocaleDateString("en-GB", { weekday: "long" })
    : new Date(next_payday).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  // Non-colour state cue: distinct icon per state for colour-blind users
  const StateIcon =
    state === "comfortable" ? ShieldCheck
    : state === "tight" ? AlertCircle
    : AlertTriangle;

  const stateIconClass =
    state === "comfortable"
      ? "text-emerald-600 dark:text-emerald-400"
      : state === "tight"
      ? "text-amber-500 dark:text-amber-400"
      : "text-red-500 dark:text-red-400";

  // ── Net-after-cards flow ────────────────────────────────────────────────
  // Card growth so far this pay period, from GET /needle/summary. Framed as a
  // flow ("in hand once that's counted"), never as a scary position — and
  // never coloured red/rose per the Red Is Risk rule.
  const cardDelta = cardDeltaSoFar ?? null;
  const showCardStrip =
    cardDelta !== null && (card_debt ?? 0) > 0 && freeAmount > 0;
  const cardsGrew = showCardStrip && (cardDelta as number) >= 10;
  const cardsDown = showCardStrip && (cardDelta as number) <= -10;
  const netAfterCards = cardsGrew ? freeAmount - (cardDelta as number) : null;

  // ── 1. Verdict headline ───────────────────────────────────────────────────
  let verdictText: string;
  if (state === "comfortable") {
    verdictText = `You're okay. ${fmt(freeAmount)} to spare this pay period.`;
    if (cardsGrew && netAfterCards !== null) {
      verdictText = netAfterCards > 0
        ? `You're okay. ${fmt(freeAmount)} to spare, ${fmt(netAfterCards)} ahead once credit cards are counted.`
        : `You're okay for bills. ${fmt(freeAmount)} to spare, though credit cards have grown ${fmt(cardDelta as number)} this month.`;
    }
  } else if (state === "tight") {
    verdictText = `Tight until your pay period ends. ${fmt(freeAmount)} in hand.`;
    if (cardsGrew && netAfterCards !== null) {
      verdictText = netAfterCards > 0
        ? `Tight until period end. ${fmt(freeAmount)} cash in hand, ${fmt(netAfterCards)} ahead once credit cards are counted.`
        : `Tight until period end. ${fmt(freeAmount)} cash in hand, though credit cards have grown ${fmt(cardDelta as number)} this month.`;
    }
  } else {
    // Only reached when state === "short" AND freeAmount <= -1 (genuine
    // shortfall) — see the remap above.
    verdictText = `Short this pay period. ${fmt(gap)} to cover.`;
  }

  // ── Bridge figure colour ─────────────────────────────────────────────────
  const freeClass =
    state === "comfortable"
      ? "text-emerald-600 dark:text-emerald-400"
      : state === "tight"
      ? "text-amber-500 dark:text-amber-400"
      : "text-red-500 dark:text-red-400";

  const hasSpendableNow = spendable_now != null;
  const hasPaydayIncome = (payday_income ?? 0) > 0;
  const hasCardDebt = (card_debt ?? 0) >= 1000;
  const freshnessLabel = data.status === "ok" ? syncAgeLabel(data.last_synced) : null;

  // ── CTA logic ────────────────────────────────────────────────────────────
  // If tight+card_debt: show "See your cards ›" CTA — taps through to /cards story.
  // If short: CTA goes to /planning.
  // If comfortable: no CTA.
  const showDebtCTA = state === "tight" && hasCardDebt;
  const showSpendCTA = state === "short";
  // The chain strip already routes to /cards — this CTA is only a fallback when the strip can't render (no needle data)
  const debtCTAVisible = showDebtCTA && !suppressCTA && !showCardStrip;

  return (
    <div className="hero-arrive sts-card relative rounded-3xl p-5 glass-hero">
      {/* Whisper label + state icon */}
      <div className="flex items-center gap-1.5 mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Safe to Spend
        </p>
        <StateIcon
          size={14}
          className={`${stateIconClass} flex-shrink-0`}
          aria-hidden="true"
        />
      </div>

      {/* ── 1–4. Content stack ── */}
      <div className="space-y-3">
      {/* ── 1. Verdict headline ── */}
      <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 leading-snug">
        {verdictText}
        {estimated && (
          <span className="text-slate-400 dark:text-slate-500 font-normal text-sm"> · estimated</span>
        )}
      </h2>

      <div className="space-y-2">
      {/* ── 2. 3-column instrument readout ── */}
      {hasSpendableNow && (
        <div className="grid grid-cols-3 gap-2">
          {/* NOW */}
          <div className="flex flex-col gap-0.5 items-start rounded-xl glass-tile px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 text-left">Now</span>
            <span className="text-base font-semibold text-slate-800 dark:text-slate-100 tabular-nums num text-left">{hidden ? "£••••" : fmt(nowCounted)}</span>
          </div>
          {/* BILLS — minus sign only when there's a real bills figure to
              subtract; a zero-normalised total never renders "−£0". */}
          <div className="flex flex-col gap-0.5 items-start rounded-xl glass-tile px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 text-left">Bills</span>
            <span className="text-base font-semibold text-slate-800 dark:text-slate-100 tabular-nums num text-left">{billsTarget > 0 ? "−" : ""}{hidden ? "£••••" : fmt(billsCounted)}</span>
          </div>
          {/* FREE — minus sign (and red, via freeClass) only for a genuine
              shortfall (state === "short", already gated to <= −£1). */}
          <div className="flex flex-col gap-0.5 items-start rounded-xl glass-tile px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 text-left">Free</span>
            <span className={`text-base font-semibold tabular-nums num text-left ${freeClass}`}>
              {state === "short" ? `−${hidden ? "£••••" : fmt(freeCounted)}` : (hidden ? "£••••" : fmt(freeCounted))}
            </span>
          </div>
        </div>
      )}
      {/* The chain — this month as one equation, tappable through to /cards.
          Inline spans on a shared baseline: glyphs can never float, and the
          words replace eyebrow labels so column widths can't wander. */}
      {showCardStrip && (
        <button
          onClick={() => router.push("/cards")}
          className="w-full rounded-xl glass-tile px-3 py-2.5 flex items-center justify-between gap-3 active:scale-[0.98] transition-transform text-left"
          aria-label={
            cardsGrew
              ? "See what drove this month's credit card spending"
              : cardsDown
              ? "See this month's credit card paydown"
              : "See your credit cards"
          }
        >
          <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            {cardsGrew && netAfterCards !== null ? (
              <>
                <span className="text-base font-semibold tabular-nums num text-slate-600 dark:text-slate-300">{hidden ? "£••••" : fmt(freeAmount)}</span>
                <span className="text-[13px] text-slate-500 dark:text-slate-400">free</span>
                <span className="text-[13px] text-slate-400 dark:text-slate-500" aria-hidden="true">−</span>
                <span className="text-base font-semibold tabular-nums num text-slate-600 dark:text-slate-300">{hidden ? "£••••" : fmt(cardDelta as number)}</span>
                <span className="text-[13px] text-slate-500 dark:text-slate-400">on credit cards</span>
                <span className="text-[13px] text-slate-400 dark:text-slate-500" aria-hidden="true">=</span>
                <span className={`text-base font-semibold tabular-nums num ${netAfterCards > 0 ? "text-slate-900 dark:text-slate-100" : "text-amber-600 dark:text-amber-400"}`}>
                  {hidden ? "£••••" : fmt(Math.abs(netAfterCards))}
                </span>
                <span className={`text-[13px] ${netAfterCards > 0 ? "text-slate-500 dark:text-slate-400" : "text-amber-600 dark:text-amber-400"}`}>
                  {netAfterCards > 0 ? "net" : "behind"}
                </span>
              </>
            ) : cardsDown ? (
              <>
                <span className="text-base font-semibold tabular-nums num text-emerald-600 dark:text-emerald-400">{hidden ? "£••••" : fmt(Math.abs(cardDelta as number))}</span>
                <span className="text-[13px] text-slate-500 dark:text-slate-400">paid off credit cards</span>
              </>
            ) : (
              <>
                <span className="text-base font-semibold tabular-nums num text-slate-600 dark:text-slate-300">{hidden ? "£••••" : fmt(freeAmount)}</span>
                <span className="text-[13px] text-slate-500 dark:text-slate-400">free</span>
                <span className="text-[13px] text-slate-400 dark:text-slate-500" aria-hidden="true">·</span>
                <span className="text-[13px] text-slate-500 dark:text-slate-400">credit cards steady this month</span>
              </>
            )}
          </p>
          <span className="text-slate-400 dark:text-slate-500 text-sm flex-shrink-0" aria-hidden="true">›</span>
        </button>
      )}
      </div>
      <div className="space-y-1">
      {/* Pace + payday line — merges the daily-rate pace and the pay-period-end/
          expected-income facts into one muted line. Degrades gracefully: rate
          and expected income are each independently optional; the period-end
          date is always available for "ok" status, so it anchors the line. */}
      {(() => {
        const pace = data.status === "ok" ? data.pace : undefined;
        const showPace = pace != null &&
          (pace.state === "comfortable" || pace.state === "on_pace" || pace.state === "ahead" || pace.state === "early") &&
          pace.sustainable != null;
        const leadText = showPace
          ? `${hidden ? "£••" : fmt2(pace!.sustainable!)}/day until ${paydayLabel}`
          : `Pay period ends ${paydayLabel}`;
        const incomeText = hasPaydayIncome ? `~${hidden ? "••" : fmt(payday_income!)} expected` : null;
        return (
          <p className="text-[13px] text-slate-500 dark:text-slate-400 num text-pretty">
            {leadText}{incomeText ? ` · ${incomeText}` : ""}
          </p>
        );
      })()}
      {/* Commitments reserved — one muted line, tappable through to Planning */}
      {(data.commitments_reserved ?? 0) > 0 && (
        <button
          onClick={() => router.push("/planning")}
          className="min-h-[44px] flex items-center gap-1 text-left text-[13px] text-slate-500 dark:text-slate-400 num hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
          aria-label="See the plans this is reserved for"
        >
          <span>
            {hidden ? "£••" : fmt(data.commitments_reserved!)}{" "}
            {data.commitments_reserved_period_label
              ? `each pay period (${data.commitments_reserved_period_label})`
              : "a period"}{" "}
            reserved for {data.commitments_count ?? 1} plan{(data.commitments_count ?? 1) === 1 ? "" : "s"}
          </span>
          <span className="text-slate-400 dark:text-slate-500 text-sm flex-shrink-0" aria-hidden="true">›</span>
        </button>
      )}
      {/* Freshness caveat — only when sync is older than 3 hours */}
      {freshnessLabel && (
        <p className="text-sm text-slate-400 dark:text-slate-500">{freshnessLabel}</p>
      )}
      </div>

      {/* ── 3. Single CTA ── */}
      {showSpendCTA && !suppressCTA && (
        <button
          onClick={() => router.push("/planning")}
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:opacity-80 active:scale-[0.98] transition-[transform,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          See what&apos;s due ›
        </button>
      )}
      {debtCTAVisible && (
        <button
          onClick={() => router.push("/cards")}
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:opacity-80 active:scale-[0.98] transition-[transform,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          See your cards ›
        </button>
      )}
      </div>
      </div>
  );
}
