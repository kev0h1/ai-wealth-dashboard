"use client";

import { ShieldCheck, AlertCircle, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { SafeToSpend } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";

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
    state,
    next_payday,
    bills_total,
    estimated,
    spendable_now,
    payday_income,
    card_debt,
  } = data;

  const gap = Math.abs(safe_to_spend); // used when short

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
    cardDelta !== null && (card_debt ?? 0) > 0 && safe_to_spend > 0;
  const cardsGrew = showCardStrip && (cardDelta as number) >= 10;
  const cardsDown = showCardStrip && (cardDelta as number) <= -10;
  const netAfterCards = cardsGrew ? safe_to_spend - (cardDelta as number) : null;

  // ── 1. Verdict headline ───────────────────────────────────────────────────
  let verdictText: string;
  if (state === "comfortable") {
    verdictText = `You're okay — ${fmt(safe_to_spend)} to spare this pay period.`;
    if (cardsGrew && netAfterCards !== null) {
      verdictText = netAfterCards > 0
        ? `You're okay — ${fmt(safe_to_spend)} to spare, ${fmt(netAfterCards)} ahead once credit cards are counted.`
        : `You're okay for bills — ${fmt(safe_to_spend)} to spare, though credit cards have grown ${fmt(cardDelta as number)} this month.`;
    }
  } else if (state === "tight") {
    verdictText = `Tight until your pay period ends — ${fmt(safe_to_spend)} in hand.`;
    if (cardsGrew && netAfterCards !== null) {
      verdictText = netAfterCards > 0
        ? `Tight until period end — ${fmt(safe_to_spend)} cash in hand, ${fmt(netAfterCards)} ahead once credit cards are counted.`
        : `Tight until period end — ${fmt(safe_to_spend)} cash in hand, though credit cards have grown ${fmt(cardDelta as number)} this month.`;
    }
  } else {
    verdictText = `Short this pay period — ${fmt(gap)} to cover.`;
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
            <span className="text-base font-semibold text-slate-800 dark:text-slate-100 tabular-nums num text-left">{hidden ? "£••••" : fmt(spendable_now!)}</span>
          </div>
          {/* BILLS */}
          <div className="flex flex-col gap-0.5 items-start rounded-xl glass-tile px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 text-left">Bills</span>
            <span className="text-base font-semibold text-slate-800 dark:text-slate-100 tabular-nums num text-left">−{hidden ? "£••••" : fmt(bills_total)}</span>
          </div>
          {/* FREE */}
          <div className="flex flex-col gap-0.5 items-start rounded-xl glass-tile px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 text-left">Free</span>
            <span className={`text-base font-semibold tabular-nums num text-left ${freeClass}`}>
              {state === "short" ? `−${hidden ? "£••••" : fmt(gap)}` : (hidden ? "£••••" : fmt(safe_to_spend))}
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
                <span className="text-base font-semibold tabular-nums num text-slate-600 dark:text-slate-300">{hidden ? "£••••" : fmt(safe_to_spend)}</span>
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
                <span className="text-base font-semibold tabular-nums num text-slate-600 dark:text-slate-300">{hidden ? "£••••" : fmt(safe_to_spend)}</span>
                <span className="text-[13px] text-slate-500 dark:text-slate-400">free</span>
                <span className="text-[13px] text-slate-400 dark:text-slate-500" aria-hidden="true">·</span>
                <span className="text-base font-semibold tabular-nums num text-emerald-600 dark:text-emerald-400">{hidden ? "£••••" : fmt(Math.abs(cardDelta as number))}</span>
                <span className="text-[13px] text-slate-500 dark:text-slate-400">paid off credit cards</span>
              </>
            ) : (
              <>
                <span className="text-base font-semibold tabular-nums num text-slate-600 dark:text-slate-300">{hidden ? "£••••" : fmt(safe_to_spend)}</span>
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
      {/* Pace rate line — only for non-risk states with a valid sustainable rate */}
      {(() => {
        const pace = data.status === "ok" ? data.pace : undefined;
        const showPace = pace != null &&
          (pace.state === "comfortable" || pace.state === "on_pace" || pace.state === "ahead" || pace.state === "early") &&
          pace.sustainable != null;
        if (!showPace) return null;
        return (
          <p className="text-[13px] text-slate-500 dark:text-slate-400 num">
            {hidden ? "£••" : fmt2(pace!.sustainable!)}/day until pay period end
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
            {hidden ? "£••" : fmt(data.commitments_reserved!)}/period reserved for {data.commitments_count ?? 1} plan{(data.commitments_count ?? 1) === 1 ? "" : "s"}
          </span>
          <span className="text-slate-400 dark:text-slate-500 text-sm flex-shrink-0" aria-hidden="true">›</span>
        </button>
      )}
      {/* Payday muted line — replaces emerald pill */}
      {hasPaydayIncome && (
        <p className="text-sm text-slate-500 dark:text-slate-400 num">
          Pay period ends {paydayLabel} · ~{hidden ? "••" : fmt(payday_income!)} expected
        </p>
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
