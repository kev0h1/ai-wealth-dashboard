"use client";

// ── Grow — Variant 1: "Instrument-panel ladder" ─────────────────────────────
// A calm cockpit gauge cluster. The priority ladder is the hero: each rung is
// an illuminated segment, dark/quiet when locked and glowing when active or
// cleared — dense but quiet, like reading a dashboard rather than a form.
//
// FCA note: only verdict/surplus/buffer/debt/invest/notes fields below are
// personal facts pulled straight from the API. `ladder[].options` is fixed
// generic phrasing from the backend ("some people…") and is rendered as-is —
// never rewritten into an instruction.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  CircleCheck,
  Gauge,
  Lock,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { GrowLadderStep, GrowView } from "@wealth/shared";
import { api, SavingsInsights, SavingsPlan } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";
import { goBack } from "@/lib/goBack";
import { usePreferences } from "@/components/PreferencesContext";
import MoneyText from "@/components/MoneyText";
import SavingsGoalSheet from "@/components/SavingsGoalSheet";
import SavingsPlanCard from "@/components/SavingsPlanCard";

// ── formatting ───────────────────────────────────────────────────────────

function money(n: number): string {
  return formatCurrency(n);
}

/** ISO date ("2026-09-30") → readable UK date ("30 Sep 2026"). Uses UTC to
 *  avoid off-by-one drift since the API sends date-only ISO strings. */
function formatPromoCliff(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Best-effort icon per rung, keyed off free-text title/key from the API.
 *  Renders the element directly (rather than returning a component
 *  reference) so callers never assign a dynamic tag inside render. */
function stepIcon(step: GrowLadderStep, size: number) {
  const k = `${step.key} ${step.title}`.toLowerCase();
  if (k.includes("invest") || k.includes("stocks") || k.includes("isa")) return <Sparkles size={size} strokeWidth={2.25} />;
  if (k.includes("debt") || k.includes("card") || k.includes("loan")) return <Gauge size={size} strokeWidth={2.25} />;
  return <ShieldCheck size={size} strokeWidth={2.25} />;
}

// ── skeleton ─────────────────────────────────────────────────────────────

function SkeletonGauge() {
  return (
    <div className="space-y-3 animate-pulse" aria-hidden>
      <div className="glass-hero rounded-3xl p-5 space-y-3">
        <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-7 w-52 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-3 w-40 bg-slate-100 dark:bg-slate-700/60 rounded" />
      </div>
      <div className="glass-card rounded-2xl p-4 space-y-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex gap-3">
            <div className="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-700 shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-700/60 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── LED rung indicator ──────────────────────────────────────────────────

function RungNode({ step }: { step: GrowLadderStep }) {
  if (step.state === "done") {
    return (
      <div
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white"
        style={{ boxShadow: "0 0 0 3px rgba(16,185,129,0.16), 0 2px 6px rgba(16,185,129,0.35)" }}
      >
        <CircleCheck size={17} strokeWidth={2.25} />
      </div>
    );
  }
  if (step.state === "active") {
    return (
      <div
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white motion-safe:animate-pulse"
        style={{ boxShadow: "0 0 0 4px rgba(79,70,229,0.18), 0 3px 10px rgba(79,70,229,0.45)" }}
      >
        {stepIcon(step, 16)}
      </div>
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500">
      <Lock size={14} strokeWidth={2} />
    </div>
  );
}

/** A dense little "segment strip" — the gauge-cluster flourish next to each
 *  rung title. Purely a state indicator (lit vs unlit), never a fabricated
 *  progress fraction — we don't have per-rung completion data from the API. */
function SegmentStrip({ state }: { state: GrowLadderStep["state"] }) {
  const lit = state !== "locked";
  const pulsing = state === "active";
  const colour =
    state === "done" ? "bg-emerald-400" : state === "active" ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-700";
  return (
    <div className="flex items-center gap-[3px]" aria-hidden>
      {[0, 1, 2, 3, 4].map(i => (
        <span
          key={i}
          className={`h-2.5 w-1 rounded-full ${lit ? colour : "bg-slate-150 dark:bg-slate-700/60"} ${
            pulsing ? "motion-safe:animate-pulse" : ""
          }`}
          style={pulsing ? { animationDelay: `${i * 90}ms` } : undefined}
        />
      ))}
    </div>
  );
}

function StatePill({ state }: { state: GrowLadderStep["state"] }) {
  const label = state === "done" ? "Cleared" : state === "active" ? "In progress" : "Locked";
  const cls =
    state === "done"
      ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10"
      : state === "active"
      ? "text-indigo-700 dark:text-indigo-300 bg-indigo-500/10"
      : "text-slate-500 dark:text-slate-400 bg-slate-500/10";
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-widest rounded-full px-2 py-0.5 ${cls}`}>
      {label}
    </span>
  );
}

// ── ladder rung row ──────────────────────────────────────────────────────

function LadderRung({ step, isLast }: { step: GrowLadderStep; isLast: boolean }) {
  const router = useRouter();
  const quiet = step.state === "locked";
  return (
    <div className="relative flex gap-3">
      {/* rail */}
      <div className="flex flex-col items-center">
        <RungNode step={step} />
        {!isLast && (
          <div
            className={`w-px flex-1 min-h-[18px] mt-1 ${
              step.state === "done" ? "bg-emerald-300/70 dark:bg-emerald-700/50" : "bg-slate-200 dark:bg-slate-700"
            }`}
          />
        )}
      </div>

      {/* content */}
      <div className={`flex-1 pb-6 ${isLast ? "pb-0" : ""}`}>
        <div
          className={`rounded-2xl p-3 ${
            step.state === "active"
              ? "bg-indigo-50/70 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20"
              : "border border-transparent"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <h3
              className={`text-sm font-bold ${
                quiet ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-50"
              }`}
            >
              {step.title}
            </h3>
            <StatePill state={step.state} />
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <SegmentStrip state={step.state} />
            <p className={`text-xs ${quiet ? "text-slate-400 dark:text-slate-600" : "text-slate-600 dark:text-slate-300"}`}>
              <MoneyText text={step.detail} />
            </p>
          </div>

          {/* Quiet in-app link — "›" suffix comes from the backend label */}
          {step.link && (
            <button
              type="button"
              onClick={() => router.push(step.link!.route)}
              className="min-h-[44px] flex items-center text-xs font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
            >
              {step.link.label}
            </button>
          )}

          {/* Generic options — under the active rung only, per FCA guardrail:
              fixed neutral phrasing from the backend, never "you should". */}
          {step.state === "active" && step.options.length > 0 && (
            <ul className="mt-2.5 space-y-1 border-t border-indigo-100 dark:border-indigo-500/20 pt-2.5">
              {step.options.map((opt: string, i: number) => (
                <li key={i} className="text-xs text-slate-500 dark:text-slate-400 leading-snug flex gap-1.5">
                  <span className="text-indigo-400 dark:text-indigo-500 leading-snug">·</span>
                  <span>{opt}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── save vs invest split (cash held vs capital at risk) ─────────────────

function SplitGauge({ view }: { view: GrowView }) {
  const cash = Math.max(0, view.buffer.current);
  const atRisk = Math.max(0, view.invest.portfolio_value);
  const total = cash + atRisk;
  const cashPct = total > 0 ? (cash / total) * 100 : 100;
  const riskPct = 100 - cashPct;

  return (
    <div className="glass-card rounded-2xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">
        Where it&apos;s sitting
      </p>

      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {cashPct > 0 && <div className="h-full bg-emerald-500" style={{ width: `${cashPct}%` }} />}
        {riskPct > 0 && <div className="h-full bg-sky-400" style={{ width: `${riskPct}%` }} />}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <div>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 font-mono tabular-nums">{money(cash)}</p>
            <p className="text-[10px] uppercase tracking-widest text-slate-400">Cash, safe</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-right">
          <div>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 font-mono tabular-nums">{money(atRisk)}</p>
            <p className="text-[10px] uppercase tracking-widest text-slate-400">Invested, at risk</p>
          </div>
          <span className="h-2 w-2 rounded-full bg-sky-400" />
        </div>
      </div>
      {!view.invest.has_investments && (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 italic">
          Nothing invested yet, this fills in once the ladder reaches that rung.
        </p>
      )}
    </div>
  );
}

// ── main component ───────────────────────────────────────────────────────

export default function GrowVariant1() {
  const router = useRouter();
  const { region, hideNetWorth } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";
  const [view, setView] = useState<GrowView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Safety-net goal editor state — fetched alongside the grow view, in
  // parallel, tolerating failure (the Edit affordance simply stays hidden).
  const [savings, setSavings] = useState<SavingsInsights | null>(null);
  const [savingsPlan, setSavingsPlan] = useState<SavingsPlan | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api.getGrow();
      setView(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSavings = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.savingsInsights(), api.getSavingsPlan()]);
      setSavings(s);
      setSavingsPlan(p.plan);
    } catch {
      setSavings(null);
      setSavingsPlan(null);
    }
  }, []);

  useEffect(() => {
    load();
    loadSavings();
  }, [load, loadSavings]);

  async function toggleSavingsStep(id: string, done: boolean) {
    try {
      const { plan } = await api.toggleSavingsPlanStep(id, done);
      setSavingsPlan(plan);
    } catch {}
  }

  async function deleteSavingsStep(id: string) {
    try {
      const { plan } = await api.deleteSavingsPlanStep(id);
      setSavingsPlan(plan);
    } catch {}
  }

  async function deleteSavingsPlanFn() {
    try {
      await api.deleteSavingsPlan();
      setSavingsPlan(null);
    } catch {}
  }

  const hasLadder = !!view && view.ladder.length > 0;

  return (
    <>
    <div className="min-h-dvh pb-12 lg:pb-8" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="px-4 pt-6 pb-2 max-w-xl mx-auto">
        <button
          onClick={() => goBack(router)}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 active:opacity-70 transition-[transform,opacity] mb-5"
        >
          <ChevronLeft size={15} />
          Back
        </button>

        {loading ? (
          <SkeletonGauge />
        ) : error || !view ? (
          <div className="glass-card rounded-2xl p-5 space-y-3">
            <p className="text-sm text-slate-700 dark:text-slate-200">
              Grow couldn&apos;t load, the instrument panel needs a live reading to show the ladder.
            </p>
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold px-4 py-2 active:scale-95 transition-transform"
            >
              <RefreshCw size={14} />
              Try again
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* ── Hero verdict — the gauge cluster's headline reading ── */}
            <div className="glass-hero rounded-3xl p-5 relative overflow-hidden">
              {/* quiet dashboard-panel backdrop: faint horizontal scan lines */}
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.05] dark:opacity-[0.08]"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(180deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 5px)",
                }}
                aria-hidden
              />
              <div className="relative">
                <div className="flex items-center gap-1.5 mb-2">
                  <Gauge size={13} className="text-indigo-500" />
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Grow
                  </p>
                </div>
                <h1 className="text-[28px] leading-tight font-bold tracking-tight text-slate-900 dark:text-slate-50">
                  <MoneyText text={view.verdict.headline} />
                </h1>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300"><MoneyText text={view.verdict.sub} /></p>
                {view.debt.all_promo && view.debt.promo_cliff && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Your card&apos;s at 0% until {formatPromoCliff(view.debt.promo_cliff)}, the after-debt figure reflects those repayments.
                  </p>
                )}

                <div className="mt-4 glass-tile rounded-xl px-3.5 py-2.5 inline-flex items-baseline gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    {view.surplus_monthly < 0 ? "Short each month" : "Spare each month"}
                  </span>
                  <span className="text-base font-bold text-slate-900 dark:text-slate-50 font-mono tabular-nums">
                    {money(Math.abs(view.surplus_monthly))}
                  </span>
                </div>
                <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
                  Excludes money moved to savings or investments.
                </p>
              </div>
            </div>

            {/* ── The ladder — hero instrument, illuminated rungs ── */}
            {hasLadder && (
              <div className="glass-card rounded-2xl p-4">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-4">
                  Priority ladder
                </p>
                <div>
                  {view.ladder.map((step, i) => (
                    <LadderRung key={step.key} step={step} isLast={i === view.ladder.length - 1} />
                  ))}
                </div>
              </div>
            )}

            {!hasLadder && (
              <div className="glass-card rounded-2xl p-5">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  No ladder to show yet, connect an account so Grow has a live reading to work from.
                </p>
              </div>
            )}

            {/* ── Savings plan milestones — sits below the ladder once a plan exists ── */}
            {savings?.configured && savingsPlan && (
              <SavingsPlanCard
                plan={savingsPlan}
                sym={sym}
                accent="#059669"
                hideValues={hideNetWorth}
                onToggleStep={toggleSavingsStep}
                onDeleteStep={deleteSavingsStep}
                onDelete={deleteSavingsPlanFn}
              />
            )}

            {/* ── Save vs invest split ── */}
            <SplitGauge view={view} />

            {/* ── Buffer + debt mini readouts — supporting gauges ── */}
            <div className="grid grid-cols-2 gap-3">
              <div className="glass-card rounded-2xl p-3.5">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Buffer</p>
                  {savings && (
                    <button
                      onClick={() => setSheetOpen(true)}
                      aria-label="Edit safety net goal"
                      className="flex-shrink-0 -m-1 p-1 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                    >
                      <Pencil size={12} strokeWidth={2.25} />
                    </button>
                  )}
                </div>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-50 font-mono tabular-nums">
                  {money(view.buffer.current)}{" "}
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">/ {money(view.buffer.target)}</span>
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  ~{Math.max(0, Math.round(view.buffer.days_covered))} days covered
                </p>
              </div>
              <div className="glass-card rounded-2xl p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Debt</p>
                {view.debt.has_debt ? (
                  <>
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-50 font-mono tabular-nums">{money(view.debt.total)}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {view.debt.all_promo ? "all on 0%" : (
                        <><span className="font-mono tabular-nums">{money(view.debt.expensive_total)}</span> not on 0%</>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">None on record</p>
                )}
              </div>
            </div>

            {/* ── Quiet footnotes ── */}
            {view.notes.length > 0 && (
              <div className="space-y-1 px-1">
                {view.notes.map((n, i) => (
                  <p key={i} className="text-[11px] text-slate-500 dark:text-slate-400 italic leading-snug">
                    <MoneyText text={n} />
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {sheetOpen && (
      <SavingsGoalSheet
        data={savings}
        sym={sym}
        hideValues={hideNetWorth}
        onClose={() => setSheetOpen(false)}
        onSaved={() => { load(); loadSavings(); }}
      />
    )}
    </>
  );
}
