"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// SpendTrends.tsx just grew two new chart widgets (pace_curve, debt_burndown)
// that nobody has looked at: /spend is authenticated so it can't be
// screenshotted, and no /design/* route rendered SpendTrends at all. This
// route renders the REAL widget components (PaceCurveWidget,
// DebtBurndownWidget, both exported additively from SpendTrends.tsx for this
// purpose) against fixture data, not a redrawn mockup, so review sees the
// exact pixels production would draw.
//
// debt_burndown normally fetches GET /debt-plan/summary, which requires
// auth and would 401 here. DebtBurndownWidget takes an optional
// `previewState` prop (a preview seam, see that component's comment) that
// swaps in fixture data instead of the network call; production never
// passes it, so the real fetch/guard/error path is untouched.
//
// Deep-linkable:
//   /design/spend-charts?mode=light|dark&widget=pace|debt&state=<slug>&compact=0|1
//
// State hoppers below use plain <a> tags (not next/link) so switching state
// is a full navigation and every fixture-driven initial state (in
// particular DebtBurndownWidget's previewState-seeded useState) starts
// clean, matching the /design/spend-live and /design/insights-live routes.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { PaceCurveWidget, DebtBurndownWidget, type WidgetData } from "@/components/SpendTrends";
import { DEFAULT_PAY_PERIOD_CONFIG } from "@/lib/payPeriod";
import type { Transaction } from "@/lib/api";
import { PACE_FIXTURES, PACE_STATE_ORDER, DEBT_FIXTURES, DEBT_STATE_ORDER } from "./fixtures";

type Mode = "light" | "dark";
type WidgetKind = "pace" | "debt";

const NO_TXNS: Transaction[] = [];

// Neither widget reads periodTxns/allTxns/colours (pace_curve reads
// paceSeries, debt_burndown fetches its own data), so these are inert
// placeholders that satisfy WidgetData's shape, not meaningful fixtures.
const BASE_WIDGET_DATA: Omit<WidgetData, "paceSeries"> = {
  periodTxns: NO_TXNS,
  allTxns: NO_TXNS,
  periodStart: new Date("2026-09-01T00:00:00Z"),
  periodEnd: new Date("2026-09-28T00:00:00Z"),
  payPeriodConfig: DEFAULT_PAY_PERIOD_CONFIG,
  colours: {},
};

export default function SpendChartsClient() {
  const params = useSearchParams();
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const widget: WidgetKind = params.get("widget") === "debt" ? "debt" : "pace";
  const compact = params.get("compact") === "1";

  const paceStateSlug = PACE_STATE_ORDER.includes(params.get("state") ?? "")
    ? (params.get("state") as string)
    : PACE_STATE_ORDER[0];
  const debtStateSlug = DEBT_STATE_ORDER.includes(params.get("state") ?? "")
    ? (params.get("state") as string)
    : DEBT_STATE_ORDER[0];

  const stateSlug = widget === "pace" ? paceStateSlug : debtStateSlug;

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document
        .querySelector('meta[name="color-scheme"]')
        ?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const hrefFor = (w: WidgetKind, s: string, c: boolean, m: Mode) =>
    `?mode=${m}&widget=${w}&state=${s}&compact=${c ? "1" : "0"}`;

  const cardChrome = compact
    // Mirrors PinnedWidgetCard's chrome (Home's pinned-widget card).
    ? "glass-card rounded-2xl p-4"
    // Mirrors WidgetCard's chrome (the Charts tab's card).
    : "glass-card rounded-2xl p-4";

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-40">
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6">
          <h1 className="text-[13px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-3">
            spend-charts preview · {widget === "pace" ? "Spending pace" : "Card balance ahead"}
            {compact ? " · compact" : ""}
          </h1>

          <div className={cardChrome}>
            {!compact && (
              <p className="text-base font-bold text-slate-800 dark:text-slate-100 mb-3">
                {widget === "pace" ? "Spending pace" : "Card balance ahead"}
              </p>
            )}
            {widget === "pace" ? (
              <PaceCurveWidget
                data={{ ...BASE_WIDGET_DATA, paceSeries: PACE_FIXTURES[paceStateSlug].series }}
                compact={compact}
              />
            ) : (
              <DebtBurndownWidget compact={compact} previewState={DEBT_FIXTURES[debtStateSlug].state} />
            )}
          </div>

          <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
            {widget === "pace" ? PACE_FIXTURES[paceStateSlug].label : DEBT_FIXTURES[debtStateSlug].label}
          </p>
        </div>

        {/* Fixed state hopper footer */}
        <div
          className="fixed bottom-0 left-0 right-0 glass-sheet border-t border-slate-100 dark:border-slate-700 px-3 py-2 space-y-2"
          style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="mx-auto w-full max-w-[430px] flex items-center gap-2">
            <a
              href={hrefFor("pace", paceStateSlug, compact, mode)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                widget === "pace" ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
              }`}
            >
              Pace curve
            </a>
            <a
              href={hrefFor("debt", debtStateSlug, compact, mode)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                widget === "debt" ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
              }`}
            >
              Debt burn-down
            </a>
            <a
              href={hrefFor(widget, stateSlug, !compact, mode)}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
            >
              {compact ? "Full" : "Compact"}
            </a>
            <a
              href={hrefFor(widget, stateSlug, compact, mode === "dark" ? "light" : "dark")}
              className="flex-shrink-0 ml-auto px-3 py-1.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
            >
              {mode === "dark" ? "Light" : "Dark"}
            </a>
          </div>
          <div className="mx-auto w-full max-w-[430px] flex items-center gap-2 overflow-x-auto">
            {(widget === "pace" ? PACE_STATE_ORDER : DEBT_STATE_ORDER).map((s) => (
              <a
                key={s}
                href={hrefFor(widget, s, compact, mode)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  s === stateSlug ? "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                }`}
              >
                {s}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
