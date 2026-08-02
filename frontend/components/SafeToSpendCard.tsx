"use client";

import { ShieldCheck, AlertCircle, AlertTriangle } from "lucide-react";
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

function fmt2(n: number): string {
  return `£${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function SafeToSpendCard({ data, loading, suppressCTA }: SafeToSpendCardProps) {
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
      ? "text-emerald-600 dark:text-emerald-400"
      : state === "tight"
      ? "text-amber-500 dark:text-amber-400"
      : "text-red-500 dark:text-red-400";

  const hasSpendableNow = spendable_now != null;
  const hasPaydayIncome = (payday_income ?? 0) > 0;
  const hasCardDebt = (card_debt ?? 0) >= 1000;

  // ── CTA logic ────────────────────────────────────────────────────────────
  // If tight+card_debt: show "See your cards ›" CTA — taps through to /cards story.
  // If short: CTA goes to /spend?view=upcoming.
  // If comfortable: no CTA.
  const showDebtCTA = state === "tight" && hasCardDebt;
  const showSpendCTA = state === "short";
  const debtCTAVisible = showDebtCTA && !suppressCTA;

  return (
    <div className="hero-arrive rounded-3xl p-5 glass-hero">
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
      {/* Pace rate line — only for non-risk states with a valid sustainable rate */}
      {(() => {
        const pace = data.status === "ok" ? data.pace : undefined;
        const showPace = pace != null &&
          (pace.state === "comfortable" || pace.state === "on_pace" || pace.state === "ahead" || pace.state === "early") &&
          pace.sustainable != null;
        if (!showPace) return null;
        return (
          <p className="text-[13px] text-slate-500 dark:text-slate-400 num">
            {hidden ? "£••" : fmt2(pace!.sustainable!)}/day to payday
          </p>
        );
      })()}
      {/* Payday muted line — replaces emerald pill */}
      {hasPaydayIncome && (
        <p className="text-sm text-slate-500 dark:text-slate-400 num">
          Payday {weekday} · +{hidden ? "••" : fmt(payday_income!)} lands
        </p>
      )}

      {/* ── 3. Single CTA ── */}
      {showSpendCTA && !suppressCTA && (
        <button
          onClick={() => router.push("/spend?view=upcoming")}
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
