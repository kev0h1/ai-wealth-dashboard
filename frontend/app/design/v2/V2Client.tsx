"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  CreditCard,
  TrendingUp,
  TrendingDown,
  Eye,
  EyeOff,
  Sparkles,
  ScanFace,
} from "lucide-react";
import { useHomeTopData } from "@/lib/useHomeTopData";
import { usePreferences } from "@/components/PreferencesContext";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number, sym = "£"): string {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function maskAmounts(text: string): string {
  return text.replace(/£[\d,]+/g, "£••••");
}

function goalBarColour(g: { done?: boolean; at_risk?: boolean; pillar: string }): string {
  if (g.done) return "#10b981";
  if (g.at_risk) return "#f59e0b";
  if (g.pillar === "savings") return "#34d399";
  if (g.pillar === "debt") return "#6366f1";
  return "#6366f1";
}

function humaniseDetail(g: { pillar: string; at_risk?: boolean; detail: string }): string {
  if (g.pillar === "budget" && g.at_risk) {
    const match = g.detail.match(/^(\d+)\s+over$/);
    if (match) return `${match[1]} categories over budget`;
  }
  return g.detail;
}

// ── Skeleton atoms ───────────────────────────────────────────────────────────

function PulseLine({ w = "w-full", h = "h-4" }: { w?: string; h?: string }) {
  return (
    <div
      className={`${h} ${w} rounded-lg bg-slate-100 dark:bg-slate-700 animate-pulse`}
    />
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function V2Client() {
  const router = useRouter();
  const {
    loading,
    kpis,
    safeToSpend,
    companionItems,
    goals,
    goalsStatus,
    valueDelivered,
    firstName,
    reload,
  } = useHomeTopData();

  const { hideNetWorth: hidden, setHideNetWorth, region } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";

  // ── Greeting ────────────────────────────────────────────────────────────────
  const hour = new Date().getHours();
  const name = firstName || "there";
  const greeting =
    hour < 12
      ? `Good morning, ${name}`
      : hour < 18
      ? `Good afternoon, ${name}`
      : `Good evening, ${name}`;

  // ── Companion brief logic ────────────────────────────────────────────────────
  const displayItems = companionItems.slice(0, 2);

  function fallbackText(): string {
    if (!safeToSpend || safeToSpend.status === "insufficient_data") {
      return "Nothing needs you today.";
    }
    if (safeToSpend.state === "tight") return "Nothing needs you today — payday's close.";
    if (safeToSpend.state === "short") return "One thing worth a look below.";
    return "Nothing needs you today.";
  }

  // ── Safe-to-spend derived values ─────────────────────────────────────────────
  const hasData = safeToSpend && safeToSpend.status === "ok";

  const s = hasData ? safeToSpend : null;
  const state = s?.state ?? "comfortable";
  const safe_to_spend = s?.safe_to_spend ?? 0;
  const bills_total = s?.bills_total ?? 0;
  const spendable_now = s?.spendable_now ?? null;
  const payday_income = s?.payday_income ?? 0;
  const card_debt = s?.card_debt ?? 0;
  const next_payday = s?.next_payday ?? "";
  const estimated = s?.estimated ?? false;

  const gap = Math.abs(safe_to_spend);

  const weekday = next_payday
    ? new Date(next_payday).toLocaleDateString("en-GB", { weekday: "long" })
    : "";

  let verdictText = "";
  if (hasData) {
    if (state === "comfortable") {
      verdictText = `You're okay — ${fmt(safe_to_spend, sym)} to spare before payday.`;
    } else if (state === "tight") {
      verdictText = `Tight until ${weekday} — ${fmt(safe_to_spend, sym)} in hand until payday.`;
    } else {
      verdictText = `Short before payday — ${fmt(gap, sym)} to cover.`;
    }
  }

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

  // FREE cell colour
  const freeValueClass =
    state === "comfortable"
      ? "text-emerald-600 dark:text-emerald-400"
      : state === "tight"
      ? "text-amber-500 dark:text-amber-400"
      : "text-red-500 dark:text-red-400";

  const hasSpendableNow = spendable_now != null;
  const hasPaydayIncome = payday_income > 0;
  const hasCardDebt = card_debt >= 1000;

  // CTA dedup (mirrors SafeToSpendCard exactly)
  const showDebtCTA = state === "tight" && hasCardDebt;
  const showSpendCTA = state === "short";

  // ── Net worth derived values ─────────────────────────────────────────────────
  const netWorth = kpis?.net_worth ?? 0;
  const isNegative = netWorth < 0;

  // ── Value delivered ──────────────────────────────────────────────────────────
  const verified = valueDelivered?.verified_monthly_saving ?? 0;
  const monthly = valueDelivered?.total_monthly_saving ?? 0;
  const showSavingsRow =
    valueDelivered != null && (monthly > 0 || verified > 0);

  const savingsLabel = verified > 0
    ? `${sym}${verified.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo saved`
    : `${sym}${monthly.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo potential savings`;

  // ── Masked figure helpers ────────────────────────────────────────────────────
  function displayFmt(n: number): string {
    return hidden ? `${sym}••••` : fmt(n, sym);
  }

  return (
    <>
      {/* Mount animation — scoped keyframe guarded by prefers-reduced-motion */}
      <style>{`
        @keyframes v2HeroIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .v2-hero-arrive {
          animation: v2HeroIn 250ms ease-out both;
        }
        @media (prefers-reduced-motion: reduce) {
          .v2-hero-arrive { animation: none; opacity: 1; transform: none; }
        }
      `}</style>

      <div className="min-h-dvh pb-28">
        <div className="max-w-lg mx-auto px-4 pt-6 space-y-4">

          {/* ── 1. Greeting ──────────────────────────────────────────────────── */}
          <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">
            {greeting}
          </h1>

          {/* ── 2. Companion brief with Penny dot ────────────────────────────── */}
          <div className="flex items-baseline gap-2">
            <span
              className="self-start h-[24px] flex items-center flex-shrink-0"
              aria-hidden="true"
            >
              <span className="w-[7px] h-[7px] rounded-full bg-gradient-to-br from-indigo-500 to-violet-600" />
            </span>
            <div className="flex-1 min-w-0">
              {loading ? (
                <div className="space-y-2">
                  <PulseLine w="w-3/4" />
                  <PulseLine w="w-1/2" />
                </div>
              ) : displayItems.length === 0 ? (
                <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed">
                  {fallbackText()}
                </p>
              ) : (
                <div className="space-y-2">
                  {displayItems.map((item) => {
                    const headline = hidden ? maskAmounts(item.headline ?? "") : item.headline;
                    const body = hidden ? maskAmounts(item.body ?? "") : item.body;
                    return (
                      <p
                        key={item.id}
                        className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed"
                      >
                        <strong className="font-semibold text-slate-900 dark:text-slate-100">
                          {headline}.
                        </strong>{" "}
                        {body}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── 3. Hero instrument card ──────────────────────────────────────── */}
          <div
            className={`rounded-3xl p-5 bg-gradient-to-b from-white to-slate-50 dark:from-slate-800 dark:to-slate-800/60 border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${!loading ? "v2-hero-arrive" : ""}`}
          >
            {/* Whisper label */}
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">
              Safe to Spend
            </p>

            {loading ? (
              <div className="space-y-3">
                <PulseLine w="w-56" h="h-5" />
                <PulseLine w="w-64" h="h-4" />
              </div>
            ) : !hasData ? (
              /* Insufficient data — graceful empty state */
              <p className="text-[15px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Not enough history yet for a verdict — a few more days of data will unlock it.
              </p>
            ) : (
              <>
                {/* Verdict headline + state icon */}
                <div className="flex items-start gap-2 mb-4">
                  <StateIcon
                    size={18}
                    className={`${stateIconClass} flex-shrink-0 mt-0.5`}
                    aria-hidden="true"
                  />
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug">
                    {verdictText}
                    {estimated && (
                      <span className="text-slate-400 dark:text-slate-500 font-normal text-sm">
                        {" "}· estimated
                      </span>
                    )}
                  </h2>
                </div>

                {/* 3-column instrument grid — only when spendable_now is available */}
                {hasSpendableNow && (
                  <div className="grid grid-cols-3 gap-2 mb-4 rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60 p-3">
                    {/* NOW */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                        Now
                      </span>
                      <span className="text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums num">
                        {displayFmt(spendable_now!)}
                      </span>
                    </div>
                    {/* BILLS */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                        Bills
                      </span>
                      <span className="text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums num">
                        −{displayFmt(bills_total)}
                      </span>
                    </div>
                    {/* FREE */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                        Free
                      </span>
                      <span
                        className={`text-base font-semibold tabular-nums num ${freeValueClass}`}
                      >
                        {state === "short"
                          ? `−${hidden ? `${sym}••••` : fmt(gap, sym)}`
                          : displayFmt(safe_to_spend)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Payday muted line */}
                {hasPaydayIncome && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-2 num">
                    Payday {weekday} · +{displayFmt(payday_income)} lands
                  </p>
                )}

                {/* Card debt line */}
                {hasCardDebt && (
                  <div className="flex items-center gap-1.5 text-sm text-slate-400 dark:text-slate-500 mb-3">
                    <CreditCard size={13} aria-hidden="true" />
                    <span className="num">{displayFmt(card_debt)} across cards</span>
                  </div>
                )}

                {/* Single indigo CTA — dedup rule from SafeToSpendCard */}
                {showSpendCTA && (
                  <button
                    onClick={() => router.push("/planning")}
                    className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 active:scale-[0.98] transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                  >
                    See what&apos;s due ›
                  </button>
                )}
                {showDebtCTA && (
                  <button
                    onClick={() => router.push("/debt-plan")}
                    className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 active:scale-[0.98] transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                  >
                    See your cards ›
                  </button>
                )}
              </>
            )}
          </div>

          {/* ── 4. Quiet index + goals card ──────────────────────────────────── */}
          <div className="rounded-2xl bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700 overflow-hidden">

            {/* Index rows */}
            <div className="divide-y divide-slate-100 dark:divide-slate-700/50 px-4">

              {/* Net worth row */}
              <div className="min-h-[44px] flex items-center justify-between active:scale-[0.98] transition-transform duration-150">
                <div className="flex items-center gap-2">
                  {isNegative
                    ? <TrendingDown size={15} strokeWidth={2} className="text-slate-400 flex-shrink-0" />
                    : <TrendingUp size={15} strokeWidth={2} className="text-slate-400 flex-shrink-0" />}
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    Net worth
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {loading ? (
                    <PulseLine w="w-24" h="h-4" />
                  ) : (
                    <span
                      className="text-sm font-semibold text-slate-900 dark:text-slate-100 num"
                      aria-label={hidden ? "Balance hidden" : undefined}
                    >
                      {hidden
                        ? <span aria-hidden="true">••••••</span>
                        : `${isNegative ? "-" : ""}${fmt(netWorth, sym)}`}
                    </span>
                  )}
                  <button
                    onClick={() => setHideNetWorth(!hidden)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    aria-label={hidden ? "Show balance" : "Hide balance"}
                  >
                    {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Savings row — only when data available and non-zero */}
              {showSavingsRow && (
                <button
                  onClick={() => router.push("/insights?tab=save")}
                  className="w-full min-h-[44px] flex items-center justify-between active:scale-[0.98] transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                >
                  <div className="flex items-center gap-2">
                    <Sparkles size={15} className="text-slate-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      {savingsLabel}
                    </span>
                  </div>
                  <span className="text-sm text-slate-400 dark:text-slate-500">›</span>
                </button>
              )}

              {/* Mirror row */}
              <button
                onClick={() => router.push("/mirror")}
                className="w-full min-h-[44px] flex items-center justify-between active:scale-[0.98] transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
              >
                <div className="flex items-center gap-2">
                  <ScanFace size={15} className="text-slate-400 flex-shrink-0" />
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    How your money behaves
                  </span>
                </div>
                <span className="text-sm text-slate-400 dark:text-slate-500">›</span>
              </button>
            </div>

            {/* Divider between index and goals */}
            <div className="h-px bg-slate-100 dark:bg-slate-700/50 mx-4" />

            {/* Goals section */}
            <div className="px-4 py-3">
              {goalsStatus === "loading" ? (
                <div className="space-y-3">
                  <PulseLine w="w-full" h="h-3" />
                  <PulseLine w="w-3/4" h="h-3" />
                </div>
              ) : goalsStatus === "failed" ? (
                <div className="flex items-center gap-3 py-1">
                  <p className="text-sm text-slate-400 dark:text-slate-500 flex-1">
                    Couldn&apos;t load goals
                  </p>
                  <button
                    onClick={reload}
                    className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                  >
                    Retry
                  </button>
                </div>
              ) : goals.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 py-1">
                  No goals set yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {goals.map((g) => {
                    const colour = goalBarColour(g);
                    const detail = humaniseDetail(g);
                    return (
                      <button
                        key={g.pillar}
                        onClick={() => router.push(g.url)}
                        className="w-full active:scale-[0.98] transition-transform duration-150 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                      >
                        <div className="flex items-baseline justify-between gap-3 mb-1.5">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
                            {g.label}
                          </span>
                          <span
                            className={`text-[11px] font-medium flex-shrink-0 ${
                              g.done
                                ? "text-emerald-500"
                                : g.at_risk
                                ? "text-slate-500 dark:text-slate-400"
                                : "text-slate-400 dark:text-slate-500"
                            }`}
                          >
                            {detail}
                          </span>
                        </div>
                        <div
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(Math.min(g.pct, 100))}
                          aria-label={g.label}
                          className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden"
                        >
                          <div
                            className="h-full rounded-full bar-sweep"
                            style={{
                              width: `${Math.max(Math.min(g.pct, 100), 2)}%`,
                              backgroundColor: colour,
                            }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Footer swap chip (fixed) ─────────────────────────────────────────── */}
      <Link
        href="/design/v3"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 mb-[env(safe-area-inset-bottom)]"
      >
        <span className="flex items-center bg-white/90 dark:bg-slate-800/90 backdrop-blur border border-slate-200 dark:border-slate-700 rounded-full px-3.5 py-1.5 text-xs text-slate-500 dark:text-slate-400 shadow-sm active:scale-95 transition-transform">
          Variant 2 of 3 · swap: /design/v3
        </span>
      </Link>
    </>
  );
}
