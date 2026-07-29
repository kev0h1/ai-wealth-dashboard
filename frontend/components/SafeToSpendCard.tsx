"use client";

import { CreditCard, ShieldCheck, AlertCircle, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { SafeToSpend } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";

interface SafeToSpendCardProps {
  data: SafeToSpend | null;
  loading?: boolean;
  suppressCTA?: boolean;
}

function fmt(n: number): string {
  return `£${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export default function SafeToSpendCard({ data, loading, suppressCTA }: SafeToSpendCardProps) {
  const { hideNetWorth: hidden } = usePreferences();
  const router = useRouter();

  // Loading skeleton
  if (loading) {
    return (
      <div className="rounded-3xl p-6 bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
          Safe to Spend
        </p>
        <div className="h-6 w-56 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse mb-3" />
        <div className="h-4 w-64 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
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

  // Weekday name of next payday
  const weekday = new Date(next_payday).toLocaleDateString("en-GB", { weekday: "long" });

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

  // ── 1. Verdict headline ───────────────────────────────────────────────────
  let verdictText: string;
  if (state === "comfortable") {
    verdictText = `You're okay — ${fmt(safe_to_spend)} to spare before payday.`;
  } else if (state === "tight") {
    verdictText = `Tight until ${weekday} — ${fmt(safe_to_spend)} in hand until payday.`;
  } else {
    verdictText = `Short before payday — ${fmt(gap)} to cover.`;
  }

  // ── Bridge figure colour ─────────────────────────────────────────────────
  const freeClass =
    state === "comfortable"
      ? "text-emerald-600 dark:text-emerald-400 font-semibold"
      : state === "tight"
      ? "text-amber-500 dark:text-amber-400 font-semibold"
      : "text-red-500 dark:text-red-400 font-semibold";

  const hasSpendableNow = spendable_now != null;
  const hasPaydayIncome = (payday_income ?? 0) > 0;
  const hasCardDebt = (card_debt ?? 0) >= 1000;

  // ── CTA / credit-link dedup logic ────────────────────────────────────────
  // Rule: avoid two /debt links. If tight+card_debt we show CTA "See your cards →"
  // and make the credit acknowledgment line non-interactive text (no button).
  // If short, CTA goes to /spend?view=upcoming; credit line (if shown) is non-interactive.
  // If comfortable, no CTA; credit line (if shown) is interactive.
  const showDebtCTA = state === "tight" && hasCardDebt;
  const showSpendCTA = state === "short";
  const debtCTAVisible = showDebtCTA && !suppressCTA;
  // Credit acknowledgment is interactive when there's card debt but no visible /debt CTA
  const creditLineIsInteractive = hasCardDebt && !debtCTAVisible;

  return (
    <div className="rounded-3xl p-6 bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700">
      {/* Whisper label */}
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
        Safe to Spend
      </p>

      {/* ── 1. Verdict headline ── */}
      <div className="flex items-start gap-2 mb-3">
        <StateIcon
          size={18}
          className={`${stateIconClass} flex-shrink-0 mt-0.5`}
          aria-hidden="true"
        />
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 leading-snug">
          {verdictText}
          {estimated && (
            <span className="text-slate-400 dark:text-slate-500 font-normal text-sm"> · estimated</span>
          )}
        </h2>
      </div>

      {/* ── 2. Coherence bridge ── */}
      {hasSpendableNow && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mb-3">
          <span className="text-sm text-slate-500 dark:text-slate-400 num">
            {hidden ? "••" : fmt(spendable_now!)} now
          </span>
          <span className="text-slate-300 dark:text-slate-600 text-sm">·</span>
          <span className="text-sm text-slate-500 dark:text-slate-400 num">
            −{hidden ? "••" : fmt(bills_total)} bills
          </span>
          <span className="text-slate-300 dark:text-slate-600 text-sm">·</span>
          <span className={`text-sm num ${freeClass}`}>
            {state === "short"
              ? `= −${hidden ? "••" : fmt(gap)}`
              : `= ${hidden ? "••" : fmt(safe_to_spend)} free`}
          </span>

          {/* Payday pill */}
          {hasPaydayIncome && (
            <span className="inline-flex items-center bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-full px-2 py-0.5 text-xs font-medium num">
              Payday {weekday} +{hidden ? "••" : fmt(payday_income!)}
            </span>
          )}
        </div>
      )}

      {/* ── 3. Credit acknowledgment ── */}
      {hasCardDebt && (
        creditLineIsInteractive ? (
          <button
            onClick={() => router.push("/debt")}
            className="flex items-center gap-1.5 text-sm text-slate-400 dark:text-slate-500 mb-3 hover:text-slate-600 dark:hover:text-slate-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
          >
            <CreditCard size={13} aria-hidden="true" />
            <span className="num">{hidden ? "••" : fmt(card_debt!)} across cards</span>
            <span className="text-slate-300 dark:text-slate-600">›</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-sm text-slate-400 dark:text-slate-500 mb-3">
            <CreditCard size={13} aria-hidden="true" />
            <span className="num">{hidden ? "••" : fmt(card_debt!)} across cards</span>
          </div>
        )
      )}

      {/* ── 4. Single CTA ── */}
      {showSpendCTA && !suppressCTA && (
        <button
          onClick={() => router.push("/spend?view=upcoming")}
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          See what&apos;s due →
        </button>
      )}
      {debtCTAVisible && (
        <button
          onClick={() => router.push("/debt")}
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          See your cards →
        </button>
      )}
    </div>
  );
}
