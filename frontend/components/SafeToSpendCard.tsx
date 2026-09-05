"use client";

import { AlertCircle, AlertTriangle, ArrowRight, ChevronDown, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { SafeToSpend } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import MoneyText from "@/components/MoneyText";

interface SafeToSpendCardProps {
  data: SafeToSpend | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

function zeroSafe(value: number): number {
  return Math.abs(value) < 1 ? 0 : value;
}

function fmt(value: number): string {
  return `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmt2(value: number): string {
  return `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function syncAgeLabel(isoString: string | null | undefined): string | null {
  if (!isoString) return null;
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs < 0) return null;
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 3) return null;
  if (diffH < 24) return `Synced ${Math.floor(diffH)} hours ago`;
  if (diffH < 48) return "Synced yesterday";
  const diffD = diffMs / (1000 * 60 * 60 * 24);
  if (diffD < 7) return `Synced ${Math.floor(diffD)} days ago`;
  return `Synced on ${new Date(isoString).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

function BreakdownRow({ label, value, detail, tone = "default", derived = false, operator = "=" }: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "risk";
  derived?: boolean;
  operator?: "=" | "→";
}) {
  return (
    <div className={`flex items-start justify-between gap-3 py-2.5 ${derived ? "mt-1 border-t-2 border-slate-300 pt-3 dark:border-slate-600" : "border-b border-slate-100 last:border-b-0 dark:border-white/10"}`}>
      <div className="min-w-0">
        <dt className={`text-[11px] font-semibold uppercase tracking-wide ${derived ? "text-slate-700 dark:text-slate-200" : "text-slate-500 dark:text-slate-400"}`}>
          {derived && <span aria-hidden="true">{operator} </span>}{label}
        </dt>
        {detail && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 text-pretty">{detail}</p>}
      </div>
      <dd className={`money shrink-0 text-sm font-semibold ${tone === "risk" ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-100"}`}>{value}</dd>
    </div>
  );
}

export default function SafeToSpendCard({ data, loading, error, onRetry }: SafeToSpendCardProps) {
  const { hideNetWorth, preferencesReady } = usePreferences();
  const router = useRouter();
  // A saved preference arrives asynchronously. Mask before it settles so
  // returning users never see a one-frame balance flash.
  const hidden = hideNetWorth || !preferencesReady;

  if (loading && !data) {
    return (
      <div className="rounded-3xl p-5 glass-hero" aria-busy="true" aria-label="Loading Safe to Spend">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">Safe to Spend</p>
        <div className="h-6 w-56 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse mb-3" />
        <div className="h-24 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <section className="rounded-3xl p-5 glass-hero" role="alert" aria-labelledby="safe-to-spend-unavailable">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Safe to Spend</p>
        <h2 id="safe-to-spend-unavailable" className="text-base font-bold text-slate-900 dark:text-slate-100">Your Safe to Spend figure is unavailable</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 text-pretty">Your accounts may still be visible, but we can&apos;t safely calculate what is free until payday.</p>
        {onRetry && <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl px-3 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Try again</button>}
      </section>
    );
  }

  if (!data || data.status === "insufficient_data") {
    const unsupported = data?.calculation_status === "unsupported";
    return (
      <section className="rounded-3xl p-5 glass-hero" aria-labelledby="safe-to-spend-history">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Safe to Spend</p>
        <h2 id="safe-to-spend-history" className="text-base font-bold text-slate-900 dark:text-slate-100">{unsupported ? "Safe to Spend isn’t available for these accounts yet" : "Your figure isn’t ready yet"}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 text-pretty">{unsupported ? "We won’t show a spending figure until this account and currency setup can be calculated safely." : "We need a little more account history to map bills and work out what is safe until payday."}</p>
        {onRetry && !unsupported && <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl px-3 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Check again</button>}
      </section>
    );
  }

  if (data.calculation_status === "degraded") {
    return (
      <section className="rounded-3xl p-5 glass-hero" role="alert" aria-labelledby="safe-to-spend-incomplete">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Safe to Spend</p>
        <h2 id="safe-to-spend-incomplete" className="text-base font-bold text-slate-900 dark:text-slate-100">We couldn&apos;t verify every set-aside</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 text-pretty">We&apos;re withholding the figure rather than risk showing more money as available than is actually safe.</p>
        {onRetry && <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl px-3 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Try again</button>}
      </section>
    );
  }

  const freeAmount = zeroSafe(data.safe_to_spend);
  const isCardsShort = data.state === "short" && data.short_reason === "cards";
  const state: "comfortable" | "tight" | "short" = data.state === "short" && !isCardsShort && freeAmount > -1 ? "comfortable" : data.state;
  const cashRunway = data.safe_to_spend_cash == null ? null : zeroSafe(data.safe_to_spend_cash);
  const cardReserve = data.card_growth_reserved == null ? null : zeroSafe(data.card_growth_reserved);
  // Keep raw values for the expanded ledger. The summary intentionally
  // suppresses sub-pound noise when it rounds to whole pounds; the ledger
  // must retain those pennies or its equations would stop reconciling.
  const exactCashRunway = data.safe_to_spend_cash ?? null;
  const exactCardReserve = data.card_growth_reserved ?? null;
  const exactLowestProjected = data.lowest_projected_balance ?? null;
  const gap = Math.abs(freeAmount);

  const amount = (value: number) => hidden ? "£••••" : fmt(value);
  const pennies = (value: number) => Math.abs(value) < 0.005 ? 0 : value;
  const exactAmount = (value: number) => hidden ? "£••••" : fmt2(pennies(value));
  const signedExactAmount = (value: number) => {
    const exact = pennies(value);
    return hidden ? `${exact < 0 ? "−" : ""}£••••` : `${exact < 0 ? "−" : ""}${fmt2(exact)}`;
  };
  const debitExactAmount = (value: number) => hidden ? "−£••••" : `−${fmt2(value)}`;

  const paydayDate = new Date(data.next_payday);
  paydayDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysAway = Math.round((paydayDate.getTime() - today.getTime()) / 86400000);
  const paydayLabel = daysAway <= 0 ? "today" : daysAway === 1 ? "tomorrow" : daysAway < 7
    ? new Date(data.next_payday).toLocaleDateString("en-GB", { weekday: "long" })
    : new Date(data.next_payday).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  const StateIcon = state === "comfortable" ? ShieldCheck : state === "tight" || isCardsShort ? AlertCircle : AlertTriangle;
  const stateLabel = state === "comfortable" ? "On track" : state === "tight" ? "Tight" : isCardsShort ? "Cards used the spare" : "Short";
  const stateChipClass = state === "comfortable"
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
    : state === "tight" || isCardsShort
      ? "bg-slate-100 text-amber-800 dark:bg-slate-700/70 dark:text-amber-200"
      : "bg-slate-100 text-red-700 dark:bg-slate-700/70 dark:text-red-300";
  const figureClass = state === "comfortable"
    ? "text-emerald-700 dark:text-emerald-300"
    : state === "short" && !isCardsShort
      ? "text-red-600 dark:text-red-400"
      : "text-slate-900 dark:text-slate-100";

  let heroAmount: number;
  let heroCaption: string;
  if (state === "comfortable") {
    heroAmount = freeAmount;
    heroCaption = "free until payday";
  } else if (state === "tight") {
    heroAmount = freeAmount;
    heroCaption = "left until payday";
  } else if (isCardsShort) {
    heroAmount = 0;
    heroCaption = "free until payday";
  } else {
    heroAmount = gap;
    heroCaption = "safety gap before payday";
  }

  const pace = data.pace;
  const showPace = pace != null && ["comfortable", "on_pace", "ahead", "early"].includes(pace.state) && pace.sustainable != null;
  const freshnessLabel = syncAgeLabel(data.last_synced);
  const calculationItems = [
    { label: "Buffer", value: data.buffer },
    { label: "Plans reserved", value: data.commitments_reserved ?? 0 },
    { label: "Allocations reserved", value: data.allocations_reserved ?? 0 },
  ].filter((item) => item.value > 0);
  const hasSetAsides = calculationItems.length > 0;
  const hasCardReserve = exactCardReserve != null && exactCardReserve > 0;
  const cashPositionLabel = cashRunway != null && cashRunway < 0
    ? "Cash after set-asides"
    : "Cash left after set-asides";
  const showGapComposition = state === "short" && !isCardsShort && cashRunway != null && cashRunway < 0 && cardReserve != null && cardReserve > 0;
  const compositionTotal = showGapComposition ? Math.abs(cashRunway) + cardReserve : 0;
  const cashShare = compositionTotal > 0 ? Math.max(6, Math.min(94, Math.abs(cashRunway!) / compositionTotal * 100)) : 50;
  const recovery = state === "short"
    ? isCardsShort ? { label: "Review card spending", href: "/cards" } : { label: "See what’s due", href: "/upcoming" }
    : state === "tight" && (data.card_debt ?? 0) >= 1000 ? { label: "See your cards", href: "/cards" } : null;

  return (
    <section className="hero-arrive sts-card relative rounded-3xl p-5 glass-hero" aria-labelledby="safe-to-spend-heading">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Safe to Spend</p>
        <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${stateChipClass}`}>
          <StateIcon size={13} className="shrink-0" aria-hidden="true" />
          {stateLabel}
        </span>
      </div>

      {error && <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30" role="status"><p className="text-xs text-slate-700 dark:text-slate-200">Couldn&apos;t refresh. Showing your last figure.</p>{onRetry && <button type="button" onClick={onRetry} className="min-h-9 shrink-0 rounded-lg px-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Retry</button>}</div>}

      <h2 id="safe-to-spend-heading" className="mt-5">
        <span className={`money block text-[34px] font-bold leading-none tracking-[-0.045em] sm:text-[38px] ${figureClass}`}>{amount(heroAmount)}</span>
        <span className="mt-2 block text-[15px] font-medium text-slate-600 dark:text-slate-300">
          {heroCaption}{data.estimated && <span className="font-normal text-slate-500 dark:text-slate-400"> · estimated</span>}
        </span>
      </h2>

      {showGapComposition && (
        <div className="mt-4" aria-label={`${amount(Math.abs(cashRunway))} projected cash gap and ${amount(cardReserve)} unpaid card balance growth make up the safety gap`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">What makes up the safety gap</p>
          <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-hidden="true">
            <span className="h-full bg-rose-300/80 dark:bg-rose-400/60" style={{ width: `${cashShare}%` }} />
            <span className="h-full flex-1 bg-slate-300 dark:bg-slate-500" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <p className="money text-base font-bold text-slate-900 dark:text-slate-100">{amount(Math.abs(cashRunway))}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">Projected cash gap</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">after bills and set-asides</p>
            </div>
            <div className="text-right">
              <p className="money text-base font-bold text-slate-900 dark:text-slate-100">{amount(cardReserve)}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">Unpaid card growth</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">net balance increase</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400 text-pretty">
            This is not your total card spending. It is how much your balance has grown this pay period after payments and refunds, less any card bill already forecast. Spend shows your actual purchases.
          </p>
        </div>
      )}

      {!showGapComposition && cashRunway != null && cardReserve != null && cardReserve > 0 && (
        <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-pretty">
          {cashRunway < 0
            ? <MoneyText text={`${amount(Math.abs(cashRunway))} is the projected cash gap after bills and set-asides.`} />
            : <MoneyText text={`Bills and set-asides leave ${amount(cashRunway)}, but ${amount(cardReserve)} of unpaid card balance growth means nothing is free right now.`} />}
        </p>
      )}

      <div className="mt-3 border-t border-slate-100 pt-1 dark:border-white/10">
        <details className="group">
          <summary className="min-h-11 flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden">
            Full calculation
            <ChevronDown size={17} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="pb-2 pt-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 text-pretty">Each step starts with a carried balance. = means a direct sum; → marks the lowest point in the dated forecast. Exact pennies make every sum traceable.</p>

            <div className="mt-4 space-y-5">
              <section aria-labelledby="cash-forecast-stage">
                <h3 id="cash-forecast-stage" className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-200">1 · Cash forecast</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Bills and income are applied in date order.</p>
                <dl className="mt-1.5">
                  {data.spendable_now != null && <BreakdownRow label="Available now" value={signedExactAmount(data.spendable_now)} />}
                  {data.bills_total > 0 && <BreakdownRow label="Bills due before payday" value={debitExactAmount(data.bills_total)} />}
                  {data.income_before_payday > 0 && <BreakdownRow label="Income before payday" value={`+${exactAmount(data.income_before_payday)}`} />}
                  {exactLowestProjected != null && (
                    <BreakdownRow
                      label={!hasSetAsides && !hasCardReserve ? (state === "short" ? "Final safety position" : "Safe to spend") : "Lowest balance reached"}
                      value={signedExactAmount(exactLowestProjected)}
                      derived
                      operator="→"
                      detail="The lowest point after applying each bill and income item on its due date."
                      tone={!hasSetAsides && !hasCardReserve && state === "short" && !isCardsShort ? "risk" : "default"}
                    />
                  )}
                </dl>
              </section>

              {hasSetAsides && exactCashRunway != null && (
                <section aria-labelledby="set-asides-stage">
                  <h3 id="set-asides-stage" className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-200">2 · Set-asides</h3>
                  <dl className="mt-1.5">
                    {exactLowestProjected != null && <BreakdownRow label="From cash forecast" value={signedExactAmount(exactLowestProjected)} />}
                    {calculationItems.map((item) => <BreakdownRow key={item.label} label={item.label} value={debitExactAmount(item.value)} />)}
                    <BreakdownRow
                      label={!hasCardReserve ? (state === "short" ? "Final safety position" : "Safe to spend") : cashPositionLabel}
                      value={signedExactAmount(exactCashRunway)}
                      derived
                      tone={!hasCardReserve && state === "short" && !isCardsShort ? "risk" : "default"}
                    />
                  </dl>
                </section>
              )}

              {hasCardReserve && exactCashRunway != null && (
                <section aria-labelledby="card-position-stage">
                  <h3 id="card-position-stage" className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-200">{hasSetAsides ? "3" : "2"} · Card position</h3>
                  <dl className="mt-1.5">
                    <BreakdownRow label="Cash brought forward" value={signedExactAmount(exactCashRunway)} />
                    <BreakdownRow label="Unpaid card growth" value={debitExactAmount(exactCardReserve!)} detail="Net balance increase this pay period; not total card purchases." />
                    <BreakdownRow label={state === "short" ? "Final safety position" : "Safe to spend"} value={signedExactAmount(data.safe_to_spend)} derived tone={state === "short" && !isCardsShort ? "risk" : "default"} />
                  </dl>
                </section>
              )}
            </div>
            {(data.pooled_transfers_excluded ?? 0) > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400 text-pretty">
                Transfers between your own included accounts do not change the total, so they are left out of this calculation.
              </p>
            )}
            {cashRunway != null && cardReserve != null && cardReserve > 0 && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 text-pretty">The summary above is rounded to whole pounds; this calculation shows the exact values used.</p>}
          </div>
        </details>
      </div>

      <div className="mt-3 space-y-1">
        <p className="text-[13px] text-slate-600 dark:text-slate-300 text-pretty"><MoneyText text={showPace ? `${hidden ? "£••••" : fmt2(pace!.sustainable!)}/day until ${paydayLabel}` : `Pay period ends ${paydayLabel}`} />{(data.payday_income ?? 0) > 0 && <><span aria-hidden="true"> · </span><MoneyText text={`~${hidden ? "••" : fmt(data.payday_income!)} expected`} /></>}</p>
        {freshnessLabel && <p className="text-sm text-slate-500 dark:text-slate-400">{freshnessLabel}</p>}
      </div>

      {recovery && <button type="button" onClick={() => router.push(recovery.href)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 active:scale-[0.98] dark:bg-indigo-400/10 dark:text-indigo-300 dark:hover:bg-indigo-400/15 transition-[transform,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{recovery.label}<ArrowRight size={15} aria-hidden="true" /></button>}
    </section>
  );
}
