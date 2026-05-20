"use client";

import { KPIs } from "@/lib/api";
import { TrendingDown, TrendingUp, Eye, EyeOff } from "lucide-react";
import { usePreferences } from "@/components/PreferencesContext";

interface NetWorthCardProps {
  kpis: KPIs | null;
  loading?: boolean;
}

function fmt(n: number): string {
  return `£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function NetWorthCard({ kpis, loading }: NetWorthCardProps) {
  const { hideNetWorth: hidden, setHideNetWorth } = usePreferences();
  const netWorth = kpis?.net_worth ?? 0;
  const isNegative = netWorth < 0;
  const cash = kpis?.cash ?? 0;
  const runway = kpis?.runway ?? 0;

  const gradient = isNegative
    ? "linear-gradient(135deg,#dc2626 0%,#9f1239 100%)"
    : "linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)";
  const shadow = isNegative
    ? "0 8px 32px rgba(220,38,38,0.35)"
    : "0 8px 32px rgba(79,70,229,0.35)";

  return (
    <div className="rounded-3xl p-6 text-white relative overflow-hidden"
      style={{ background: gradient, boxShadow: shadow }}>
      <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full opacity-10 bg-white" />
      <div className="absolute -bottom-12 -left-6 w-44 h-44 rounded-full opacity-10 bg-white" />

      <div className="relative z-10">
        {/* Title row */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            {isNegative
              ? <TrendingDown size={16} strokeWidth={2} className="opacity-80" />
              : <TrendingUp size={16} strokeWidth={2} className="opacity-80" />}
            <span className="text-sm font-medium opacity-80">Net Worth</span>
          </div>
          <button
            onClick={() => setHideNetWorth(!hidden)}
            className="opacity-70 hover:opacity-100 transition-opacity p-1 rounded-full"
            aria-label={hidden ? "Show balance" : "Hide balance"}
          >
            {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {/* Main figure */}
        {loading ? (
          <div className="h-10 w-48 bg-white/20 rounded-lg animate-pulse mb-4" />
        ) : (
          <div className="text-4xl font-bold tracking-tight mb-4 select-none">
            {hidden
              ? "••••••"
              : `${isNegative ? "-" : ""}${fmt(netWorth)}`}
          </div>
        )}

        {/* Chips */}
        <div className="flex gap-3 flex-wrap">
          <div className="bg-white/15 backdrop-blur rounded-xl px-4 py-2">
            <p className="text-xs opacity-70 mb-0.5">Cash</p>
            {loading
              ? <div className="h-5 w-20 bg-white/20 rounded animate-pulse" />
              : <p className="text-base font-semibold">{hidden ? "••••" : fmt(cash)}</p>}
          </div>
          <div className="bg-white/15 backdrop-blur rounded-xl px-4 py-2">
            <p className="text-xs opacity-70 mb-0.5">Runway</p>
            {loading
              ? <div className="h-5 w-16 bg-white/20 rounded animate-pulse" />
              : <p className="text-base font-semibold">{hidden ? "••" : `${runway}mo`}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
