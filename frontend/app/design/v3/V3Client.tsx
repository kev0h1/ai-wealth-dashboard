"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  Eye,
  EyeOff,
  Sparkles,
  ScanFace,
} from "lucide-react";
import { useHomeTopData } from "@/lib/useHomeTopData";
import { usePreferences } from "@/components/PreferencesContext";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(n: number, sym: string): string {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function weekdayOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "long" });
}

function timeGreeting(firstName?: string): string {
  const h = new Date().getHours();
  const name = firstName || "there";
  if (h < 12) return `Good morning, ${name}.`;
  if (h < 18) return `Good afternoon, ${name}.`;
  return `Good evening, ${name}.`;
}

// goalBarColour and humaniseDetail replicated from GoalsStrip.tsx
function goalBarColour(g: { done?: boolean; at_risk?: boolean; pillar: string }): string {
  if (g.done) return "#10b981";
  if (g.at_risk) return "#f59e0b";
  if (g.pillar === "savings") return "#34d399";
  if (g.pillar === "debt") return "#6366f1";
  return "#6366f1";
}

function humaniseDetail(g: { pillar: string; detail: string; at_risk?: boolean }): string {
  if (g.pillar === "budget" && g.at_risk) {
    const match = g.detail.match(/^(\d+)\s+over$/);
    if (match) return `${match[1]} categories over budget`;
  }
  return g.detail;
}

// ─── PennyDot ───────────────────────────────────────────────────────────────
// Outer flex items-baseline + dot in self-start 26px wrapper keeps dot pinned
// to the first line even when prose wraps.

function PennyDot() {
  return (
    <span
      className="self-start h-[26px] flex items-center flex-shrink-0"
      aria-hidden="true"
    >
      <span className="w-[7px] h-[7px] rounded-full bg-gradient-to-br from-indigo-500 to-violet-600" />
    </span>
  );
}

// ─── SpeechBlock ─────────────────────────────────────────────────────────────
// The spoken page: one flowing prose block, Penny dot inline with first line.

interface SpeechProps {
  firstName?: string;
  safeToSpend: ReturnType<typeof useHomeTopData>["safeToSpend"];
  companionItems: ReturnType<typeof useHomeTopData>["companionItems"];
  hidden: boolean;
  sym: string;
  router: ReturnType<typeof useRouter>;
}

function SpeechBlock({
  firstName,
  safeToSpend,
  companionItems,
  hidden,
  sym,
  router,
}: SpeechProps) {
  const greeting = timeGreeting(firstName);

  // ── insufficient_data / null ─────────────────────────────────────────────
  if (!safeToSpend || safeToSpend.status === "insufficient_data") {
    return (
      <div className="flex items-baseline gap-2">
        <PennyDot />
        <div className="flex-1 min-w-0 text-[16px] leading-relaxed text-slate-800 dark:text-slate-100 max-w-prose">
          <p>
            <span className="font-semibold">{greeting}</span>{" "}
            I don&apos;t have enough history yet for a verdict — a few more days of data and I&apos;ll have it.
          </p>
        </div>
      </div>
    );
  }

  const {
    state,
    next_payday,
    bills_total,
    estimated,
    spendable_now,
    payday_income,
    card_debt,
  } = safeToSpend;

  const weekday = weekdayOf(next_payday);
  const hasSpendableNow = spendable_now != null;
  const hasPaydayIncome = (payday_income ?? 0) > 0;
  const hasCardDebt = (card_debt ?? 0) >= 1000;

  // safe_to_spend is always present when status === "ok"
  const safe_to_spend = (safeToSpend as { safe_to_spend: number }).safe_to_spend;
  const gap = Math.abs(safe_to_spend);

  // Free/gap figure colour class — the ONLY coloured figure in the speech
  const freeColour =
    state === "comfortable"
      ? "text-emerald-600 dark:text-emerald-400"
      : state === "tight"
      ? "text-amber-500 dark:text-amber-400"
      : "text-red-500 dark:text-red-400";

  // Mask helper for inline figures
  function mfmt(n: number): string {
    return hidden ? `${sym}••••` : fmt(n, sym);
  }

  // ── Verdict sentences ────────────────────────────────────────────────────
  // We build verdict as JSX so individual figures can be <strong>.
  let verdictNode: React.ReactNode;

  if (state === "comfortable") {
    verdictNode = (
      <>
        You&apos;re okay —{" "}
        {hasSpendableNow && (
          <>
            you&apos;re holding{" "}
            <strong className="font-semibold num text-slate-900 dark:text-slate-100">
              {mfmt(spendable_now!)}
            </strong>
            , bills take{" "}
            <strong className="font-semibold num text-slate-900 dark:text-slate-100">
              {mfmt(bills_total)}
            </strong>
            , leaving{" "}
          </>
        )}
        <strong className={`font-semibold num ${freeColour}`}>
          {mfmt(safe_to_spend)}
        </strong>{" "}
        {hasSpendableNow ? "to spare before payday" : "to spare before payday"}
        .{hasPaydayIncome && (
          <>
            {" "}
            Payday lands{" "}
            <strong className="font-semibold num text-slate-900 dark:text-slate-100">
              {weekday}
            </strong>{" "}
            with{" "}
            <strong className="font-semibold num text-slate-900 dark:text-slate-100">
              +{mfmt(payday_income!)}
            </strong>
            .
          </>
        )}
        {estimated && (
          <span className="text-slate-400 dark:text-slate-500 font-normal text-[14px]">
            {" "}· estimated
          </span>
        )}
      </>
    );
  } else if (state === "tight") {
    verdictNode = (
      <>
        Tight until{" "}
        <strong className="font-semibold num text-slate-900 dark:text-slate-100">
          {weekday}
        </strong>{" "}
        —{" "}
        {hasSpendableNow && (
          <>
            you&apos;re holding{" "}
            <strong className="font-semibold num text-slate-900 dark:text-slate-100">
              {mfmt(spendable_now!)}
            </strong>
            , bills take{" "}
            <strong className="font-semibold num text-slate-900 dark:text-slate-100">
              {mfmt(bills_total)}
            </strong>
            , leaving{" "}
            <strong className={`font-semibold num ${freeColour}`}>
              {mfmt(safe_to_spend)}
            </strong>{" "}
            in hand.{" "}
          </>
        )}
        {hasPaydayIncome && (
          <>
            Payday lands{" "}
            <strong className="font-semibold num text-slate-900 dark:text-slate-100">
              {weekday}
            </strong>{" "}
            with{" "}
            <strong className="font-semibold num text-slate-900 dark:text-slate-100">
              +{mfmt(payday_income!)}
            </strong>
            .
          </>
        )}
        {estimated && (
          <span className="text-slate-400 dark:text-slate-500 font-normal text-[14px]">
            {" "}· estimated
          </span>
        )}
      </>
    );
  } else {
    // short
    verdictNode = (
      <>
        Short before payday —{" "}
        {hasSpendableNow && (
          <>
            you&apos;re holding{" "}
            <strong className="font-semibold num text-slate-900 dark:text-slate-100">
              {mfmt(spendable_now!)}
            </strong>
            , bills take{" "}
            <strong className="font-semibold num text-slate-900 dark:text-slate-100">
              {mfmt(bills_total)}
            </strong>
            , leaving you{" "}
            <strong className={`font-semibold num ${freeColour}`}>
              {mfmt(gap)}
            </strong>{" "}
            short.{" "}
          </>
        )}
        {!hasSpendableNow && (
          <>
            you&apos;re{" "}
            <strong className={`font-semibold num ${freeColour}`}>
              {mfmt(gap)}
            </strong>{" "}
            short.{" "}
          </>
        )}
        {hasPaydayIncome && (
          <>
            Payday lands{" "}
            <strong className="font-semibold num text-slate-900 dark:text-slate-100">
              {weekday}
            </strong>{" "}
            with{" "}
            <strong className="font-semibold num text-slate-900 dark:text-slate-100">
              +{mfmt(payday_income!)}
            </strong>
            .
          </>
        )}
        {estimated && (
          <span className="text-slate-400 dark:text-slate-500 font-normal text-[14px]">
            {" "}· estimated
          </span>
        )}
      </>
    );
  }

  // ── Card debt quiet sentence ─────────────────────────────────────────────
  const cardDebtSentence = hasCardDebt ? (
    <span>
      {" "}You&apos;re carrying{" "}
      <strong className="font-semibold num text-slate-900 dark:text-slate-100">
        {mfmt(card_debt!)}
      </strong>{" "}
      across cards.
    </span>
  ) : null;

  // ── Companion item (first item only, woven as next paragraph) ────────────
  const firstItem = companionItems[0] ?? null;

  // ── CTA: spoken offer ────────────────────────────────────────────────────
  // tight+card_debt → cards → /debt
  // short → see what's due → /spend?view=upcoming
  // else if first companion has action → use that
  // comfortable + no action → no offer
  let ctaNode: React.ReactNode = null;
  if (state === "tight" && hasCardDebt) {
    ctaNode = (
      <button
        onClick={() => router.push("/debt")}
        className="text-indigo-600 dark:text-indigo-400 font-medium active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
      >
        Want me to show your cards? ›
      </button>
    );
  } else if (state === "short") {
    ctaNode = (
      <button
        onClick={() => router.push("/spend?view=upcoming")}
        className="text-indigo-600 dark:text-indigo-400 font-medium active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
      >
        Want to see what&apos;s due? ›
      </button>
    );
  } else if (firstItem?.action) {
    ctaNode = (
      <button
        onClick={() => router.push(firstItem.action!.route)}
        className="text-indigo-600 dark:text-indigo-400 font-medium active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
      >
        {firstItem.action.label} ›
      </button>
    );
  }

  // ── Mask companion text for hideNetWorth ─────────────────────────────────
  function maskText(text: string): string {
    if (!hidden) return text;
    return text.replace(/£[\d,]+/g, "£••••");
  }

  return (
    <div className="flex items-baseline gap-2">
      <PennyDot />
      <div className="flex-1 min-w-0 text-[16px] leading-relaxed text-slate-800 dark:text-slate-100 max-w-prose space-y-4">
        {/* First paragraph: greeting + verdict + card debt */}
        <p>
          <span className="font-semibold">{greeting}</span>{" "}
          {verdictNode}
          {cardDebtSentence}
        </p>

        {/* Second paragraph: first companion item (if any) */}
        {firstItem && (
          <p>
            <strong className="font-semibold text-slate-900 dark:text-slate-100">
              {maskText(firstItem.headline)}.
            </strong>{" "}
            {maskText(firstItem.body)}
          </p>
        )}

        {/* Spoken CTA */}
        {ctaNode && <p>{ctaNode}</p>}
      </div>
    </div>
  );
}

// ─── StatChip ────────────────────────────────────────────────────────────────

interface StatChipProps {
  label: string;
  value: string;
  valueClassName?: string;
}

function StatChip({ label, value, valueClassName = "" }: StatChipProps) {
  return (
    <div className="bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2 flex-1 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-0.5 leading-none">
        {label}
      </p>
      <p className={`text-sm font-semibold num leading-tight ${valueClassName || "text-slate-900 dark:text-slate-100"}`}>
        {value}
      </p>
    </div>
  );
}

// ─── IndexRows ───────────────────────────────────────────────────────────────

interface IndexRowsProps {
  kpis: ReturnType<typeof useHomeTopData>["kpis"];
  valueDelivered: ReturnType<typeof useHomeTopData>["valueDelivered"];
  hidden: boolean;
  sym: string;
  router: ReturnType<typeof useRouter>;
  setHideNetWorth: (v: boolean) => void;
}

function IndexRows({
  kpis,
  valueDelivered,
  hidden,
  sym,
  router,
  setHideNetWorth,
}: IndexRowsProps) {
  const netWorth = kpis?.net_worth ?? 0;
  const isNegative = netWorth < 0;

  const verified = valueDelivered?.verified_monthly_saving ?? 0;
  const monthly = valueDelivered?.total_monthly_saving ?? 0;
  const showSavings = valueDelivered != null && (monthly > 0 || verified > 0);

  return (
    <div className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
      {/* Row 1: Net worth */}
      <div className="min-h-[44px] flex items-center justify-between py-1">
        <div className="flex items-center gap-2">
          {isNegative ? (
            <TrendingDown size={15} strokeWidth={2} className="text-slate-400 flex-shrink-0" aria-hidden="true" />
          ) : (
            <TrendingUp size={15} strokeWidth={2} className="text-slate-400 flex-shrink-0" aria-hidden="true" />
          )}
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Net worth</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className="text-sm font-semibold text-slate-900 dark:text-slate-100 num"
            aria-label={hidden ? "Balance hidden" : undefined}
          >
            {hidden ? (
              <span aria-hidden="true">••••••</span>
            ) : (
              `${isNegative ? "-" : ""}${fmt(netWorth, sym)}`
            )}
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

      {/* Row 2: Savings (hidden if no data) */}
      {showSavings && (
        <button
          onClick={() => router.push("/insights?tab=save")}
          className="w-full min-h-[44px] flex items-center justify-between py-1 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-slate-400 flex-shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
              {verified > 0
                ? `${sym}${verified.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo saved`
                : `${sym}${monthly.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo potential savings`}
            </span>
          </div>
          <span className="text-sm text-slate-400 dark:text-slate-500 flex-shrink-0">›</span>
        </button>
      )}

      {/* Row 3: Mirror */}
      <button
        onClick={() => router.push("/mirror")}
        className="w-full min-h-[44px] flex items-center justify-between py-1 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
      >
        <div className="flex items-center gap-2">
          <ScanFace size={15} className="text-slate-400 flex-shrink-0" aria-hidden="true" />
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">How your money behaves</span>
        </div>
        <span className="text-sm text-slate-400 dark:text-slate-500 flex-shrink-0">›</span>
      </button>
    </div>
  );
}

// ─── GoalsRows ───────────────────────────────────────────────────────────────

interface GoalsRowsProps {
  goals: ReturnType<typeof useHomeTopData>["goals"];
  goalsStatus: ReturnType<typeof useHomeTopData>["goalsStatus"];
  reload: () => void;
  router: ReturnType<typeof useRouter>;
}

function GoalsRows({ goals, goalsStatus, reload, router }: GoalsRowsProps) {
  if (goalsStatus === "loading") {
    return (
      <div className="space-y-3">
        {[0, 1].map(i => (
          <div key={i} className="min-h-[44px] flex flex-col justify-center gap-1.5">
            <div className="h-3 w-48 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
            <div className="h-1 w-full bg-slate-100 dark:bg-slate-700/50 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (goalsStatus === "failed") {
    return (
      <div className="min-h-[44px] flex items-center justify-between">
        <p className="text-sm text-slate-400 dark:text-slate-500">Couldn&apos;t load goals</p>
        <button
          onClick={reload}
          className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  if (goals.length === 0) {
    return (
      <p className="text-sm text-slate-400 dark:text-slate-500 min-h-[44px] flex items-center">
        No goals set yet.
      </p>
    );
  }

  return (
    <div className="divide-y divide-slate-200/60 dark:divide-slate-700/50">
      {goals.map(g => {
        const colour = goalBarColour(g);
        const pctClamped = Math.max(Math.min(g.pct, 100), 2);
        return (
          <button
            key={g.pillar}
            onClick={() => router.push(g.url)}
            className="w-full min-h-[44px] py-2 text-left active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
          >
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
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
                {humaniseDetail(g)}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(g.pct, 100))}
              aria-label={g.label}
              className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden"
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${pctClamped}%`, backgroundColor: colour }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── V3Client ────────────────────────────────────────────────────────────────

export default function V3Client() {
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

  const { hideNetWorth, setHideNetWorth, region } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";

  // Stat chips: only render when spendable_now is available
  const okSpend =
    safeToSpend &&
    safeToSpend.status === "ok" &&
    (safeToSpend as any).spendable_now != null;

  const spendData = okSpend
    ? (safeToSpend as {
        spendable_now: number;
        bills_total: number;
        safe_to_spend: number;
        state: "comfortable" | "tight" | "short";
      })
    : null;

  const freeChipColour = spendData
    ? spendData.state === "comfortable"
      ? "text-emerald-600 dark:text-emerald-400"
      : spendData.state === "tight"
      ? "text-amber-500 dark:text-amber-400"
      : "text-red-500 dark:text-red-400"
    : "";

  function mfmt(n: number): string {
    return hideNetWorth ? `${sym}••••` : fmt(n, sym);
  }

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-28">
      <div className="max-w-lg mx-auto px-4 pt-6">

        {/* ── Speech block ────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-baseline gap-2">
            <PennyDot />
            <div className="flex-1 min-w-0 space-y-2 pt-1">
              <div className="h-4 w-3/4 bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse" />
              <div className="h-4 w-full bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse" />
              <div className="h-4 w-2/3 bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse" />
            </div>
          </div>
        ) : (
          <SpeechBlock
            firstName={firstName}
            safeToSpend={safeToSpend}
            companionItems={companionItems}
            hidden={hideNetWorth}
            sym={sym}
            router={router}
          />
        )}

        {/* ── Stat chips: Now / Bills / Free ──────────────────────────────── */}
        {spendData && (
          <div className="flex gap-2 mt-6">
            <StatChip
              label="Now"
              value={mfmt(spendData.spendable_now)}
            />
            <StatChip
              label="Bills"
              value={mfmt(spendData.bills_total)}
            />
            <StatChip
              label="Free"
              value={
                spendData.state === "short"
                  ? `−${mfmt(Math.abs(spendData.safe_to_spend))}`
                  : mfmt(spendData.safe_to_spend)
              }
              valueClassName={freeChipColour}
            />
          </div>
        )}

        {/* ── Index rows ───────────────────────────────────────────────────── */}
        <div className="mt-10">
          <IndexRows
            kpis={kpis}
            valueDelivered={valueDelivered}
            hidden={hideNetWorth}
            sym={sym}
            router={router}
            setHideNetWorth={setHideNetWorth}
          />
        </div>

        {/* ── Goals rows ───────────────────────────────────────────────────── */}
        <div className="mt-10">
          <GoalsRows
            goals={goals}
            goalsStatus={goalsStatus}
            reload={reload}
            router={router}
          />
        </div>

      </div>

      {/* ── Footer swap chip (fixed) ─────────────────────────────────────── */}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <Link
          href="/design/v1"
          className="block bg-white/90 dark:bg-slate-800/90 backdrop-blur border border-slate-200 dark:border-slate-700 rounded-full px-3.5 py-1.5 text-xs text-slate-500 dark:text-slate-400 shadow-sm active:scale-95 transition-transform whitespace-nowrap"
        >
          Variant 3 of 3 · swap: /design/v1
        </Link>
      </div>
    </div>
  );
}
