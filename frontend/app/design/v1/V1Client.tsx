"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Sparkles,
  ScanFace,
  Eye,
  EyeOff,
  ChevronRight,
} from "lucide-react";
import { useHomeTopData } from "@/lib/useHomeTopData";
import { usePreferences } from "@/components/PreferencesContext";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtAbs(n: number, sym: string): string {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
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

// ── Skeleton ───────────────────────────────────────────────────────────────────

function PulseLine({ w }: { w: string }) {
  return <div className={`h-4 ${w} bg-slate-100 dark:bg-slate-700/70 rounded-lg animate-pulse`} />;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function V1Client() {
  const router = useRouter();
  const { hideNetWorth: hidden, setHideNetWorth, region } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";

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

  // ── Greeting ────────────────────────────────────────────────────────────────
  const hour = new Date().getHours();
  const name = firstName || "there";
  const greeting =
    hour < 12
      ? `Good morning, ${name}`
      : hour < 18
      ? `Good afternoon, ${name}`
      : `Good evening, ${name}`;

  // ── Companion brief helpers ──────────────────────────────────────────────────
  function maskAmounts(text: string): string {
    if (!hidden) return text;
    return text.replace(/£[\d,]+/g, "£••••");
  }

  const briefItems = companionItems.slice(0, 2);

  function fallbackBriefText(): string {
    if (!safeToSpend || safeToSpend.status === "insufficient_data") {
      return "Nothing needs you today.";
    }
    if (safeToSpend.state === "tight") return "Nothing needs you today — payday's close.";
    if (safeToSpend.state === "short") return "One thing worth a look below.";
    return "Nothing needs you today.";
  }

  // ── Verdict helpers ──────────────────────────────────────────────────────────
  const hasVerdict = safeToSpend && safeToSpend.status === "ok";
  const verdict = hasVerdict ? safeToSpend : null;

  let verdictHeadlineParts: { before: string; figure: string; after: string } | null = null;
  let verdictStateIcon: typeof ShieldCheck | null = null;
  let verdictIconClass = "";
  let verdictFigureClass = "";
  let verdictSubline: string | null = null;
  let verdictCTALabel: string | null = null;
  let verdictCTAHref: string | null = null;

  if (verdict) {
    const { safe_to_spend, state, next_payday, bills_total, estimated, spendable_now, payday_income, card_debt } =
      verdict;

    const weekday = new Date(next_payday).toLocaleDateString("en-GB", { weekday: "long" });
    const weekdayShort = new Date(next_payday).toLocaleDateString("en-GB", { weekday: "short" });
    const gap = Math.abs(safe_to_spend);
    const figure = hidden ? `${sym}••••` : fmtAbs(safe_to_spend, sym);
    const gapFigure = hidden ? `${sym}••••` : fmtAbs(gap, sym);

    if (state === "comfortable") {
      verdictHeadlineParts = {
        before: "You're okay — ",
        figure,
        after: " to spare before payday.",
      };
    } else if (state === "tight") {
      verdictHeadlineParts = {
        before: `Tight until ${weekday} — `,
        figure,
        after: " in hand until payday.",
      };
    } else {
      verdictHeadlineParts = {
        before: "Short before payday — ",
        figure: gapFigure,
        after: " to cover.",
      };
    }

    if (estimated) {
      verdictHeadlineParts = {
        ...verdictHeadlineParts,
        after: verdictHeadlineParts.after + " · estimated",
      };
    }

    verdictStateIcon =
      state === "comfortable" ? ShieldCheck : state === "tight" ? AlertCircle : AlertTriangle;

    verdictIconClass =
      state === "comfortable"
        ? "text-emerald-600 dark:text-emerald-400"
        : state === "tight"
        ? "text-amber-500 dark:text-amber-400"
        : "text-red-500 dark:text-red-400";

    verdictFigureClass =
      state === "comfortable"
        ? "text-emerald-600 dark:text-emerald-400"
        : state === "tight"
        ? "text-amber-500 dark:text-amber-400"
        : "text-red-500 dark:text-red-400";

    // Quiet sub-line: spendable_now − bills · payday weekdayShort +income
    const subParts: string[] = [];
    if (spendable_now != null) {
      const spendNow = hidden ? `${sym}••••` : fmtAbs(spendable_now, sym);
      const billsFmt = hidden ? `${sym}••••` : fmtAbs(bills_total, sym);
      subParts.push(`${spendNow} now − ${billsFmt} bills`);
    }
    if ((payday_income ?? 0) > 0) {
      const incomeFmt = hidden ? `${sym}••••` : fmtAbs(payday_income!, sym);
      subParts.push(`payday ${weekdayShort} +${incomeFmt}`);
    }
    verdictSubline = subParts.length > 0 ? subParts.join(" · ") : null;

    // Single quiet CTA
    if (state === "tight" && (card_debt ?? 0) >= 1000) {
      verdictCTALabel = "See your cards ›";
      verdictCTAHref = "/debt-plan";
    } else if (state === "short") {
      verdictCTALabel = "See what's due ›";
      verdictCTAHref = "/planning";
    }
  }

  // ── Net worth values ─────────────────────────────────────────────────────────
  const netWorth = kpis?.net_worth ?? 0;
  const isNegative = netWorth < 0;

  // ── Value delivered ──────────────────────────────────────────────────────────
  const verified = valueDelivered?.verified_monthly_saving ?? 0;
  const monthly = valueDelivered?.total_monthly_saving ?? 0;
  const showSavings = valueDelivered != null && (monthly > 0 || verified > 0);
  const savingsLabel =
    verified > 0
      ? `${sym}${verified.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo saved`
      : `${sym}${monthly.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo potential savings`;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-dvh pb-28">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-10">

        {/* ── 1. Greeting ─────────────────────────────────────────────────── */}
        <section
          className="rise-in"
          style={{ "--rise-index": 0 } as React.CSSProperties}
        >
          <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight mb-4">
            {greeting}
          </h1>

          {/* Companion brief with Penny dot */}
          {loading ? (
            <div className="space-y-2">
              <PulseLine w="w-3/4" />
              <PulseLine w="w-1/2" />
            </div>
          ) : briefItems.length > 0 ? (
            <div className="flex items-baseline gap-2">
              {/* Penny dot — ONLY gradient on this screen */}
              <span
                className="self-start h-[24px] flex items-center flex-shrink-0"
                aria-hidden="true"
              >
                <span className="w-[7px] h-[7px] rounded-full bg-gradient-to-br from-indigo-500 to-violet-600" />
              </span>
              <div className="flex-1 min-w-0 space-y-2">
                {briefItems.map((item) => (
                  <p
                    key={item.id}
                    className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed"
                  >
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {maskAmounts(item.headline ?? "")}.
                    </span>{" "}
                    {maskAmounts(item.body ?? "")}
                  </p>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span
                className="self-start h-[24px] flex items-center flex-shrink-0"
                aria-hidden="true"
              >
                <span className="w-[7px] h-[7px] rounded-full bg-gradient-to-br from-indigo-500 to-violet-600" />
              </span>
              <p className="flex-1 min-w-0 text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed">
                {fallbackBriefText()}
              </p>
            </div>
          )}
        </section>

        {/* ── 2. Verdict ──────────────────────────────────────────────────── */}
        <section
          className="rise-in"
          style={{ "--rise-index": 1 } as React.CSSProperties}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-3">
            Safe to spend
          </p>

          {loading ? (
            <div className="space-y-2">
              <PulseLine w="w-4/5" />
              <PulseLine w="w-2/3" />
            </div>
          ) : verdict && verdictHeadlineParts && verdictStateIcon ? (
            <div>
              {/* Icon + headline — typographic statement, no card */}
              <div className="flex items-start gap-2 mb-2">
                {(() => {
                  const Icon = verdictStateIcon;
                  return (
                    <Icon
                      size={18}
                      className={`${verdictIconClass} flex-shrink-0 mt-1`}
                      aria-hidden="true"
                    />
                  );
                })()}
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 leading-snug">
                  {verdictHeadlineParts.before}
                  <span className={`num ${verdictFigureClass}`}>
                    {verdictHeadlineParts.figure}
                  </span>
                  <span className="text-slate-900 dark:text-slate-100">
                    {verdictHeadlineParts.after}
                  </span>
                </h2>
              </div>

              {/* Quiet sub-line */}
              {verdictSubline && (
                <p className="text-sm text-slate-500 dark:text-slate-400 num ml-7 mb-2">
                  {verdictSubline}
                </p>
              )}

              {/* Single quiet action link */}
              {verdictCTALabel && verdictCTAHref && (
                <div className="ml-7 mt-3">
                  <Link
                    href={verdictCTAHref}
                    className="text-sm font-medium text-indigo-600 dark:text-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                  >
                    {verdictCTALabel}
                  </Link>
                </div>
              )}
            </div>
          ) : (
            /* Insufficient data graceful state */
            <p className="text-[15px] text-slate-400 dark:text-slate-500 leading-relaxed">
              Not enough history yet for a verdict — a few more days of data will unlock it.
            </p>
          )}
        </section>

        {/* ── 3. Index rows ───────────────────────────────────────────────── */}
        <section
          className="rise-in"
          style={{ "--rise-index": 2 } as React.CSSProperties}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
            Your position
          </p>

          <div className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
            {/* Net worth row */}
            <div className="min-h-[44px] flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                {isNegative ? (
                  <TrendingDown
                    size={15}
                    strokeWidth={2}
                    className="text-slate-400 flex-shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <TrendingUp
                    size={15}
                    strokeWidth={2}
                    className="text-slate-400 flex-shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span className="text-sm text-slate-600 dark:text-slate-300">Net worth</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {loading ? (
                  <div className="h-4 w-20 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                ) : (
                  <span
                    className="text-sm font-semibold text-slate-900 dark:text-slate-100 num"
                    aria-label={hidden ? "Balance hidden" : undefined}
                  >
                    {hidden ? (
                      <span aria-hidden="true">••••••</span>
                    ) : (
                      `${isNegative ? "-" : ""}${fmtAbs(netWorth, sym)}`
                    )}
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

            {/* Savings row — hidden when null / both zeros */}
            {showSavings && (
              <button
                onClick={() => router.push("/insights?tab=save")}
                className="w-full min-h-[44px] flex items-center justify-between py-1 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
              >
                <div className="flex items-center gap-2">
                  <Sparkles
                    size={15}
                    className="text-slate-400 flex-shrink-0"
                    aria-hidden="true"
                  />
                  <span className="text-sm text-slate-600 dark:text-slate-300">
                    {savingsLabel}
                  </span>
                </div>
                <ChevronRight size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
              </button>
            )}

            {/* Mirror row */}
            <button
              onClick={() => router.push("/mirror")}
              className="w-full min-h-[44px] flex items-center justify-between py-1 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
            >
              <div className="flex items-center gap-2">
                <ScanFace
                  size={15}
                  className="text-slate-400 flex-shrink-0"
                  aria-hidden="true"
                />
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  How your money behaves
                </span>
              </div>
              <ChevronRight size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
            </button>
          </div>
        </section>

        {/* ── 4. Goals strip ──────────────────────────────────────────────── */}
        <section
          className="rise-in"
          style={{ "--rise-index": 3 } as React.CSSProperties}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
            Goals
          </p>

          {goalsStatus === "loading" && (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between">
                    <div className="h-3.5 w-32 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                    <div className="h-3.5 w-16 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                  </div>
                  <div className="h-1 w-full bg-slate-100 dark:bg-slate-700 rounded-full animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {goalsStatus === "failed" && (
            <div className="flex items-center justify-between py-2">
              <p className="text-sm text-slate-400 dark:text-slate-500">
                Couldn&apos;t load goals
              </p>
              <button
                onClick={reload}
                className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
              >
                Retry
              </button>
            </div>
          )}

          {goalsStatus === "ready" && goals.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-slate-500">No goals set yet.</p>
          )}

          {goalsStatus === "ready" && goals.length > 0 && (
            <div className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
              {goals.map((g) => {
                const colour = goalBarColour(g);
                const detail = humaniseDetail(g);
                return (
                  <button
                    key={g.pillar}
                    onClick={() => router.push(g.url)}
                    className="w-full py-3 active:opacity-70 transition-opacity text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                  >
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <span className="text-sm text-slate-700 dark:text-slate-200 truncate">
                        {g.label}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 flex-shrink-0">
                        {detail}
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(Math.min(g.pct, 100))}
                      aria-label={g.label}
                      className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-700/70 overflow-hidden"
                    >
                      <div
                        className="h-full rounded-full"
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
        </section>

      </div>

      {/* ── Footer swap chip — fixed, clears iOS home bar ─────────────────── */}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <Link
          href="/design/v2"
          className="bg-white/90 dark:bg-slate-800/90 backdrop-blur border border-slate-200 dark:border-slate-700 rounded-full px-3.5 py-1.5 text-xs text-slate-500 dark:text-slate-400 shadow-sm active:scale-95 transition-transform block"
        >
          Variant 1 of 3 · swap: /design/v2
        </Link>
      </div>
    </div>
  );
}
