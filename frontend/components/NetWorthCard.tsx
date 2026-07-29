"use client";

import { useState } from "react";
import { KPIs } from "@/lib/api";
import { TrendingDown, TrendingUp, Eye, EyeOff } from "lucide-react";
import { usePreferences } from "@/components/PreferencesContext";

interface NetWorthCardProps {
  kpis: KPIs | null;
  loading?: boolean;
  compact?: boolean;
  compactRow?: boolean;
}

function fmt(n: number, sym = "£"): string {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function NetWorthCard({ kpis, loading, compact, compactRow }: NetWorthCardProps) {
  const { hideNetWorth: hidden, setHideNetWorth, region } = usePreferences();
  const [runwayExpanded, setRunwayExpanded] = useState(false);
  const sym = region === "Kenya" ? "KES " : "£";
  const netWorth = kpis?.net_worth ?? 0;
  const isNegative = netWorth < 0;
  const cash = kpis?.cash ?? 0;
  const runway = kpis?.runway ?? 0;

  // compactRow — borderless row for the unified index block
  if (compactRow) {
    if (loading) {
      return <div className="min-h-[44px] flex items-center"><div className="h-4 w-48 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" /></div>;
    }
    return (
      <div className="min-h-[44px] flex items-center justify-between">
        {/* Left */}
        <div className="flex items-center gap-2">
          {isNegative
            ? <TrendingDown size={15} strokeWidth={2} className="text-slate-400 dark:text-slate-400 flex-shrink-0" />
            : <TrendingUp size={15} strokeWidth={2} className="text-slate-400 dark:text-slate-400 flex-shrink-0" />}
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Net worth</span>
        </div>
        {/* Right */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 num" aria-label={hidden ? "Balance hidden" : undefined}>
            {hidden ? <span aria-hidden="true">••••••</span> : `${isNegative ? "-" : ""}${fmt(netWorth, sym)}`}
          </span>
          <button
            onClick={() => setHideNetWorth(!hidden)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label={hidden ? "Show balance" : "Hide balance"}
          >
            {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
    );
  }

  // Compact strip mode — single-line summary used when SafeToSpend is the hero
  if (compact) {
    if (loading) {
      return <div className="rounded-2xl h-11 bg-white dark:bg-slate-800 shadow-sm animate-pulse" />;
    }
    return (
      <div className="rounded-2xl px-4 py-3 bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">
        {/* Left: small trend icon + muted label */}
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Direction conveyed by icon shape; colour is neutral so the compact
              strip doesn't add to the amber/red signal count on Home */}
          {isNegative
            ? <TrendingDown size={13} strokeWidth={2} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
            : <TrendingUp size={13} strokeWidth={2} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />}
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">Net worth</span>
        </div>
        {/* Right: figure + eye toggle */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className="text-base font-semibold text-slate-900 dark:text-slate-100 num"
            aria-label={hidden ? "Balance hidden" : undefined}
          >
            {hidden
              ? <span aria-hidden="true">••••••</span>
              : `${isNegative ? "-" : ""}${fmt(netWorth, sym)}`}
          </span>
          <button
            onClick={() => setHideNetWorth(!hidden)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1 rounded-full"
            aria-label={hidden ? "Show balance" : "Hide balance"}
          >
            {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
    );
  }

  // Neutral surface; direction is conveyed by the trend icon shape alone —
  // the figure stays slate so Net Worth never reads as a risk signal
  return (
    <div className="rounded-3xl p-6 bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700">
      {/* Title row */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {isNegative
            ? <TrendingDown size={16} strokeWidth={2} className="text-amber-500 dark:text-amber-400/80" />
            : <TrendingUp size={16} strokeWidth={2} className="text-emerald-500 dark:text-emerald-400/80" />}
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Net Worth</span>
        </div>
        <button
          onClick={() => setHideNetWorth(!hidden)}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1 rounded-full"
          aria-label={hidden ? "Show balance" : "Hide balance"}
        >
          {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      {/* Verdict — one calm line before the number */}
      {!loading && (
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-2 leading-snug">
          {isNegative ? "Building towards net-positive — stay the course" : "Tracking in the right direction"}
        </p>
      )}

      {/* Main figure */}
      {loading ? (
        <div className="h-10 w-48 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse mb-4" />
      ) : (
        <div
          className={`text-4xl font-bold tracking-tight mb-4 select-none num fade-in ${
            "text-slate-900 dark:text-slate-100"
          }`}
          aria-label={hidden ? "Balance hidden" : undefined}
        >
          {hidden
            ? <span aria-hidden="true">••••••</span>
            : `${isNegative ? "-" : ""}${fmt(netWorth, sym)}`}
        </div>
      )}

      {/* Chips — items-start + explainer outside the chips keeps both boxes
          the same height, so Cash and Cash runway always align */}
      <div className="flex gap-3 flex-wrap items-start">
        <div className="bg-slate-50 dark:bg-slate-700/60 rounded-xl px-4 py-2">
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-0.5 leading-4">Cash</p>
          {loading
            ? <div className="h-5 w-20 bg-slate-100 dark:bg-slate-600 rounded animate-pulse" />
            : <p
                className="text-base font-semibold text-slate-800 dark:text-slate-100 num"
                aria-label={hidden ? "Balance hidden" : undefined}
              >
                {hidden ? <span aria-hidden="true">••••</span> : fmt(cash, sym)}
              </p>}
        </div>
        <div className="bg-slate-50 dark:bg-slate-700/60 rounded-xl px-4 py-2">
          <button
            onClick={() => setRunwayExpanded(prev => !prev)}
            aria-expanded={runwayExpanded}
            title="All cash ÷ average monthly outgoings"
            className="block text-xs text-slate-400 dark:text-slate-500 mb-0.5 leading-4 text-left underline decoration-dotted underline-offset-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
          >
            Cash runway
          </button>
          {loading
            ? <div className="h-5 w-16 bg-slate-100 dark:bg-slate-600 rounded animate-pulse" />
            : <p
                className="text-base font-semibold text-slate-800 dark:text-slate-100 num"
                aria-label={hidden ? "Balance hidden" : undefined}
              >
                {hidden ? <span aria-hidden="true">••</span> : (
                  runway < 1
                    ? <span className={runway * 30 < 7 ? "text-amber-500 dark:text-amber-400" : ""}>~{Math.round(runway * 30)} days</span>
                    : `~${Math.round(runway)} months`
                )}
              </p>}
        </div>
      </div>
      {runwayExpanded && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2 leading-snug">
          Cash runway = all cash ÷ average monthly outgoings · based on your last 90 days of spending
        </p>
      )}
    </div>
  );
}
