"use client";

/**
 * Grow — Variant 2: "Verdict-first minimal"
 *
 * Art direction: one large plain-English factual verdict fills the top of
 * the screen. Only the single active ladder rung is expanded with its
 * options; every other rung collapses into a quiet stepped list the user
 * taps to expand. Calm Cockpit rules apply throughout: verdicts lead,
 * colour is information, red is reserved for genuine risk (unused here —
 * "at risk" investments are a fact, not a warning), and the indigo→violet
 * Penny gradient never appears on this screen.
 *
 * FCA doctrine: only the verdict/detail/buffer/debt/invest fields are
 * personal facts. The `options` copy under the active rung is generic
 * ("some people…") and is rendered verbatim — never rewritten into advice.
 */

import { useEffect, useState } from "react";
import {
  Check,
  Lock,
  ChevronDown,
  Wallet,
  TrendingUp,
  Info,
} from "lucide-react";
import { api, type GrowView } from "@/lib/api";
import type { GrowLadderStep } from "@wealth/shared";
import { fmt as money } from "@/lib/format";

// ── Loading skeleton ──────────────────────────────────────────────────────

function GrowSkeleton() {
  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] px-4 pt-6 pb-16 lg:max-w-2xl lg:mx-auto">
      <div className="animate-pulse space-y-4">
        <div className="h-40 rounded-3xl bg-white/60 dark:bg-white/5" />
        <div className="h-16 rounded-2xl bg-white/60 dark:bg-white/5" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 rounded-2xl bg-white/60 dark:bg-white/5" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Empty / error state ───────────────────────────────────────────────────

function GrowEmptyState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] flex items-center justify-center px-6">
      <div className="glass-card rounded-3xl p-6 max-w-sm w-full text-center">
        <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 mb-1">
          Grow isn&apos;t ready yet
        </p>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {message}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-4 min-h-[44px] px-5 rounded-xl bg-indigo-600 text-white text-[14px] font-semibold active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

// ── Rung row (collapsed / expanded) ───────────────────────────────────────

function RungRow({
  step,
  index,
  isOpen,
  onToggle,
}: {
  step: GrowLadderStep;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const isActive = step.state === "active";
  const isDone = step.state === "done";
  const isLocked = step.state === "locked";

  // Icon / index badge
  const badge = isDone ? (
    <span className="w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
      <Check size={15} strokeWidth={2.75} />
    </span>
  ) : isLocked ? (
    <span className="w-7 h-7 rounded-full bg-slate-200/70 dark:bg-slate-700/60 text-slate-400 dark:text-slate-500 flex items-center justify-center flex-shrink-0">
      <Lock size={13} strokeWidth={2.25} />
    </span>
  ) : (
    <span className="w-7 h-7 rounded-full bg-indigo-600 text-white text-[12px] font-bold flex items-center justify-center flex-shrink-0">
      {index + 1}
    </span>
  );

  return (
    <div
      className={
        isActive
          ? "glass-card rounded-2xl px-4 py-4 shadow-sm ring-1 ring-indigo-500/15 dark:ring-indigo-400/20"
          : "rounded-2xl px-4 py-3 border border-transparent"
      }
    >
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className={
          "w-full flex items-center gap-3 text-left min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded-xl " +
          (isLocked ? "opacity-60" : "active:scale-[0.99] transition-transform")
        }
      >
        {badge}
        <span className="flex-1 min-w-0">
          <span
            className={
              isActive
                ? "block text-[15px] font-bold text-slate-900 dark:text-slate-100"
                : isDone
                ? "block text-[13px] font-medium text-slate-500 dark:text-slate-400 line-through decoration-slate-300 dark:decoration-slate-600"
                : "block text-[13px] font-medium text-slate-400 dark:text-slate-500"
            }
          >
            {step.title}
          </span>
          {isActive && (
            <span className="block text-[10px] font-semibold uppercase tracking-widest text-indigo-500 dark:text-indigo-400 mt-0.5">
              You are here
            </span>
          )}
        </span>
        {!isActive && (
          <ChevronDown
            size={16}
            className={
              "flex-shrink-0 text-slate-300 dark:text-slate-600 transition-transform " +
              (isOpen ? "rotate-180" : "")
            }
          />
        )}
      </button>

      {/* Active rung: always expanded with detail + generic options */}
      {isActive && (
        <div className="mt-3 pl-10 space-y-3">
          <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
            {step.detail}
          </p>
          {step.options.length > 0 && (
            <ul className="space-y-2">
              {step.options.map((opt, i) => (
                <li
                  key={i}
                  className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed pl-3 border-l-2 border-slate-200 dark:border-slate-700"
                >
                  {opt}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Non-active rungs: quiet, tap-to-expand */}
      {!isActive && isOpen && (
        <div className="mt-2 pl-10 pr-1 space-y-2">
          <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {step.detail}
          </p>
          {!isLocked && step.options.length > 0 && (
            <ul className="space-y-1.5">
              {step.options.map((opt, i) => (
                <li
                  key={i}
                  className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed pl-3 border-l-2 border-slate-200/70 dark:border-slate-700/70"
                >
                  {opt}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Save vs invest split ───────────────────────────────────────────────────

function SaveInvestSplit({ data }: { data: GrowView }) {
  const cash = Math.max(0, data.buffer.current);
  const atRisk = Math.max(0, data.invest.portfolio_value);
  const total = cash + atRisk;
  const cashPct = total > 0 ? Math.round((cash / total) * 100) : 100;
  const investPct = 100 - cashPct;

  if (total <= 0) return null;

  return (
    <div className="glass-card rounded-2xl p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">
        Where your money sits
      </p>

      {/* Split bar — cash (emerald) vs invested/at-risk (indigo), never red */}
      <div className="h-2.5 rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-700 mb-3">
        {cashPct > 0 && (
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${cashPct}%` }}
            aria-hidden="true"
          />
        )}
        {investPct > 0 && (
          <div
            className="h-full bg-indigo-500"
            style={{ width: `${investPct}%` }}
            aria-hidden="true"
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="glass-tile rounded-xl p-3">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
            <Wallet size={12} strokeWidth={2.5} />
            Cash
          </span>
          <span className="block mt-1 text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {money(cash)}
          </span>
        </div>
        <div className="glass-tile rounded-xl p-3">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
            <TrendingUp size={12} strokeWidth={2.5} />
            Invested
          </span>
          <span className="block mt-1 text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {money(atRisk)}
          </span>
          <span className="block text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
            capital at risk
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────

export default function GrowVariant2() {
  const [data, setData] = useState<GrowView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    api
      .getGrow()
      .then((v) => setData(v))
      .catch(() => setError("We couldn't load your Grow plan just now."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <GrowSkeleton />;
  if (error) return <GrowEmptyState message={error} onRetry={load} />;
  if (!data) return <GrowEmptyState message="Nothing to show yet." onRetry={load} />;

  const hasLadder = data.ladder && data.ladder.length > 0;

  return (
    <div
      className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] px-4 pb-16 lg:max-w-2xl lg:mx-auto"
      style={{ paddingTop: "env(safe-area-inset-top, 16px)" }}
    >
      {/* ── Verdict hero — dominates the top, plain factual language ── */}
      <div className="glass-hero rounded-3xl px-5 pt-7 pb-6 mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
          Grow
        </p>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {data.verdict.headline}
        </h1>
        <p className="mt-2 text-[14px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {data.verdict.sub}
        </p>
      </div>

      {/* ── Detected monthly surplus — quiet stat under the verdict ── */}
      <div className="mt-3 flex items-center justify-between glass-tile rounded-2xl px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
          Monthly surplus
        </span>
        <span
          className={
            "text-xl font-bold tabular-nums " +
            (data.surplus_monthly >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-slate-700 dark:text-slate-300")
          }
        >
          {data.surplus_monthly >= 0 ? "+" : "−"}
          {money(data.surplus_monthly)}
          <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">/mo</span>
        </span>
      </div>

      {/* ── Save vs invest split ── */}
      <div className="mt-3">
        <SaveInvestSplit data={data} />
      </div>

      {/* ── Ladder — quiet stepped list, only the active rung expanded ── */}
      {hasLadder && (
        <div className="mt-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 px-1 mb-2">
            Your priority order
          </p>
          <div className="space-y-1.5">
            {data.ladder.map((step, i) => (
              <RungRow
                key={step.key}
                step={step}
                index={i}
                isOpen={openKey === step.key}
                onToggle={() =>
                  setOpenKey((k) => (k === step.key ? null : step.key))
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Notes — quiet footnotes ── */}
      {data.notes && data.notes.length > 0 && (
        <div className="mt-6 px-1 space-y-1.5">
          {data.notes.map((note, i) => (
            <p
              key={i}
              className="flex items-start gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed"
            >
              <Info size={12} className="flex-shrink-0 mt-0.5" strokeWidth={2} />
              <span>{note}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
