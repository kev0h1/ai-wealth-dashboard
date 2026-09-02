"use client";

// The Trends tab on the Spend page: a user-configurable stack of chart
// widgets, all computed client-side from the already-loaded transactions and
// scoped to the pay period the user is viewing. One widget can be pinned to
// the home page (PinnedWidgetCard), where it renders compact and deep-links
// back here.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  ChartPie, BarChart3, TrendingUp, TrendingDown, AlignStartVertical, MoreVertical,
  Pin, PinOff, Trash2, Plus, ChevronRight, Activity,
  Car, Fuel, Train, Bus, CarTaxiFront, PlugZap, Wrench, SquareParking,
} from "lucide-react";
import {
  DndContext, closestCenter, MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, Transaction, TransportSummary, SpendVerdictPaceEntry, DebtPlanSummary } from "@/lib/api";
import { cachedVerdict, fetchVerdictData } from "@/lib/verdictCache";
import { usePreferences } from "@/components/PreferencesContext";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { getCategoryColour } from "@/lib/categories";
import {
  PayPeriodConfig, prevPeriodWithConfig, filterPeriod,
} from "@/lib/payPeriod";

function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export type WidgetId = "category_pie" | "daily_bars" | "period_compare" | "size_distribution" | "transport_modes" | "pace_curve" | "debt_burndown";

export const DEFAULT_WIDGETS: WidgetId[] = ["category_pie", "daily_bars"];

const WIDGET_META: Record<WidgetId, { title: string; description: string; Icon: typeof ChartPie }> = {
  category_pie: {
    title: "Category breakdown",
    description: "Where this period's spend went, as a donut",
    Icon: ChartPie,
  },
  pace_curve: {
    title: "Spending pace",
    description: "This period's running total against your usual",
    Icon: Activity,
  },
  debt_burndown: {
    title: "Card balance ahead",
    description: "Where your card balances land at the pace you're paying",
    Icon: TrendingDown,
  },
  daily_bars: {
    title: "Daily spend",
    description: "How much you spent each day this period",
    Icon: BarChart3,
  },
  period_compare: {
    title: "Period comparison",
    description: "Total spend across your last six pay periods",
    Icon: TrendingUp,
  },
  size_distribution: {
    title: "Transaction sizes",
    description: "How many transactions fall in each price band",
    Icon: AlignStartVertical,
  },
  transport_modes: {
    title: "Transport by mode",
    description: "Where your transport spend goes: car, rideshare, public",
    Icon: BarChart3,
  },
};

const ALL_WIDGETS = Object.keys(WIDGET_META) as WidgetId[];

function isWidgetId(v: unknown): v is WidgetId {
  return typeof v === "string" && v in WIDGET_META;
}

// Exported (in addition to the module's internal use) for the auth-exempt
// design route at app/design/spend-charts, which renders PaceCurveWidget
// against fixture data since /spend is authenticated and can't be
// screenshotted directly. Not used by any other real caller.
export interface WidgetData {
  periodTxns: Transaction[];
  allTxns: Transaction[];
  periodStart: Date;
  periodEnd: Date;
  payPeriodConfig: PayPeriodConfig;
  colours: Record<string, string>;
  onReviewLarge?: () => void;
  // pace_curve's data — lives on the /spend/verdict payload, not on the
  // loaded transactions, so it can't be derived client-side like the other
  // widgets' data. Threaded in from SpendPage.tsx's verdict state; absent
  // for PinnedWidgetCard (Home has no verdict in scope) and for any caller
  // on an older cached verdict, in which case the widget degrades to a
  // quiet empty state rather than fabricating a series.
  paceSeries?: SpendVerdictPaceEntry[];
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function spendDebits(txns: Transaction[]): Transaction[] {
  return txns.filter(t => t.transaction_type === "debit" && (t.category || "Other") !== "Transfer");
}

const fmtGBP = (n: number) =>
  `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

// Recharts' YAxis `width` is a fixed pixel box, not an auto-sizing one — a
// box sized for a 3-4 character label clips the leading £ off anything
// wider (found by screenshot review, 2026-09: a debt_burndown tick of
// "£32,000" rendered as ":32,000", only the right sliver of the £ glyph
// surviving). The first fix here padded the raw data max by 20% and sized
// the box off that guess — wrong, because recharts' own "nice round
// number" top tick can round up further than 20% (an actual max of 635
// still drew a "£1,000" top tick, one digit wider than the padded guess).
// So instead of guessing what recharts will pick, this computes the nice
// ceiling ourselves (classic 1-2-5-10 progression) and FORCES the chart's
// own `domain` to end there via the `domain` prop everywhere this is used
// — the box width and the axis's actual top tick then both derive from the
// exact same number and can never drift apart again.
function niceAxisCeiling(maxValue: number): number {
  const v = Math.max(0, maxValue);
  if (v <= 0) return 0;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const frac = v / base;
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return Math.round(niceFrac * base * 100) / 100;
}

// Width for a y-axis whose top tick will read `niceMax` (already run
// through niceAxisCeiling above) — every currency y-axis in this file ticks
// in the same 9px monospace (var(--font-jbmono)); ~5.6px/char is a rough
// measure at that size with a little slack. 34 is the floor every widget
// already used before this fix, kept so a small-value chart (e.g. "£0")
// doesn't shrink below what was already comfortable.
function currencyAxisWidth(niceMax: number): number {
  const widest = fmtGBP(niceMax).length;
  return Math.max(34, Math.ceil(widest * 5.6) + 10);
}

const TOOLTIP_STYLE = {
  backgroundColor: "rgba(15,23,42,0.92)",
  border: "none",
  borderRadius: 10,
  padding: "6px 10px",
  fontSize: 11,
  color: "#f1f5f9",
} as const;

/* ── Widget renderers ─────────────────────────────────────────────── */

function CategoryPieWidget({ data, compact }: { data: WidgetData; compact?: boolean }) {
  const slices = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of data.periodTxns) {
      const cat = t.category || "Other";
      if (cat === "Transfer" || cat === "Income") continue;
      // Credits are refunds — net them against the category
      map[cat] = (map[cat] ?? 0) + (t.transaction_type === "credit" ? -Math.abs(t.amount) : Math.abs(t.amount));
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .filter(s => s.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [data.periodTxns]);

  if (slices.length === 0) return <EmptyWidget compact={compact} />;
  const total = slices.reduce((s, x) => s + x.value, 0);
  const colour = (name: string) => getCategoryColour(name, data.colours);

  return (
    <div className="flex items-center gap-3">
      <div className={compact ? "w-20 h-20" : "w-32 h-32"} style={{ flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices} dataKey="value" nameKey="name"
              innerRadius={compact ? 24 : 38} outerRadius={compact ? 38 : 60}
              paddingAngle={2.5} cornerRadius={3} strokeWidth={0} isAnimationActive={false}
            >
              {slices.map(s => <Cell key={s.name} fill={colour(s.name)} />)}
            </Pie>
            {!compact && <Tooltip trigger="click" contentStyle={TOOLTIP_STYLE} itemStyle={{ fontFamily: "var(--font-jbmono), monospace" }} formatter={(v) => fmtGBP(Number(v ?? 0))} />}
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        {slices.slice(0, compact ? 3 : 5).map(s => (
          <div key={s.name} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colour(s.name) }} />
            <span className="text-xs text-slate-600 dark:text-slate-300 truncate flex-1">{s.name}</span>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
              {Math.round((s.value / total) * 100)}%
            </span>
          </div>
        ))}
        {slices.length > (compact ? 3 : 5) && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 pl-4">
            +{slices.length - (compact ? 3 : 5)} more
          </p>
        )}
      </div>
    </div>
  );
}

function DailyBarsWidget({ data, compact }: { data: WidgetData; compact?: boolean }) {
  const isDark = useIsDark();
  const tickFill = isDark ? "#94a3b8" : "#64748b";
  const days = useMemo(() => {
    const byDay: Record<string, number> = {};
    for (const t of spendDebits(data.periodTxns)) {
      const key = t.date.slice(0, 10);
      byDay[key] = (byDay[key] ?? 0) + Math.abs(t.amount);
    }
    const out: { label: string; spend: number }[] = [];
    const d = new Date(data.periodStart);
    const today = new Date();
    while (d <= data.periodEnd && d <= today) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.push({
        label: `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`,
        spend: byDay[key] ?? 0,
      });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [data.periodTxns, data.periodStart, data.periodEnd]);

  if (!days.some(d => d.spend > 0)) return <EmptyWidget compact={compact} />;
  const ticks = [days[0]?.label, days[Math.floor(days.length / 2)]?.label, days[days.length - 1]?.label].filter(Boolean) as string[];

  const activeDays = days.filter(d => d.spend > 0);
  const avg = activeDays.length > 0
    ? activeDays.reduce((s, d) => s + d.spend, 0) / activeDays.length
    : 0;

  return (
    <>
      {!compact && (() => {
        if (activeDays.length === 0) return null;
        const busiest = activeDays.reduce((best, d) => d.spend > best.spend ? d : best, activeDays[0]);
        const ratio = avg > 0 ? (busiest.spend / avg).toFixed(1) : null;
        return (
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-snug mb-3">
            {"Busiest day: "}<span className="font-bold text-slate-900 dark:text-slate-100">{busiest.label}</span>
            {" · "}<span className="font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">{fmtGBP(busiest.spend)}</span>
            {ratio !== null && ` · ${ratio}× your daily average`}
          </p>
        );
      })()}
      <div className={compact ? "h-20" : "h-36"}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={days} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          {!compact && (
            <XAxis dataKey="label" ticks={ticks} tickLine={false} axisLine={false}
              tick={{ fontSize: 9, fill: tickFill }} interval="preserveStartEnd" />
          )}
          <YAxis hide scale="sqrt" domain={[0, "auto"]} />
          <Tooltip
            trigger="click"
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ fontFamily: "var(--font-jbmono), monospace" }}
            formatter={(v) => fmtGBP(Number(v ?? 0))}
            cursor={{ fill: "rgba(100,116,139,0.08)" }}
          />
          <Bar dataKey="spend" radius={[2, 2, 0, 0]} maxBarSize={12} isAnimationActive={false}>
            {days.map((d, i) => (
              <Cell key={i} fill="#6366f1" fillOpacity={d.spend <= 0 ? 0.15 : 1} />
            ))}
          </Bar>
          {!compact && avg > 0 && (
            <ReferenceLine
              y={avg}
              strokeDasharray="4 4"
              stroke="#94a3b8"
              strokeWidth={1}
              label={{
                value: `avg ${fmtGBP(Math.round(avg))}/day`,
                position: "insideTopRight",
                fontSize: 9,
                fill: tickFill,
                fontFamily: "var(--font-jbmono), monospace",
                offset: 4,
              }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
      </div>
    </>
  );
}

function PeriodCompareWidget({ data, compact }: { data: WidgetData; compact?: boolean }) {
  const isDark = useIsDark();
  const tickFill = isDark ? "#94a3b8" : "#64748b";
  const periods = useMemo(() => {
    // Walk back five periods from the one being viewed
    const out: { label: string; spend: number; current: boolean }[] = [];
    let start = data.periodStart;
    let end = data.periodEnd;
    for (let i = 0; i < 6; i++) {
      const txns = spendDebits(filterPeriod(data.allTxns, start, end));
      out.unshift({
        label: `${start.getDate()} ${MONTH_SHORT[start.getMonth()]}`,
        spend: txns.reduce((s, t) => s + Math.abs(t.amount), 0),
        current: i === 0,
      });
      [start, end] = prevPeriodWithConfig(start, data.payPeriodConfig);
    }
    // Drop leading periods with no data (before the user's history begins)
    while (out.length > 1 && out[0].spend === 0) out.shift();
    return out;
  }, [data.allTxns, data.periodStart, data.periodEnd, data.payPeriodConfig]);

  if (periods.every(p => p.spend === 0)) return <EmptyWidget compact={compact} />;
  const yMax = niceAxisCeiling(Math.max(...periods.map(p => p.spend), 0));

  return (
    <>
      {!compact && (() => {
        const currentEntry = periods.find(p => p.current) ?? periods[periods.length - 1];
        const currentIdx = periods.indexOf(currentEntry);
        const prevEntry = currentIdx > 0 ? periods[currentIdx - 1] : null;
        const currentSpend = currentEntry?.spend ?? 0;
        const prevSpend = prevEntry?.spend ?? 0;
        const delta = prevEntry && prevSpend > 0 ? currentSpend - prevSpend : null;
        const absDelta = delta !== null ? Math.abs(delta) : null;
        const pct = delta !== null && prevSpend > 0 ? Math.round((Math.abs(delta) / prevSpend) * 100) : null;
        return (
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-snug mb-3">
            <span className="font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">{fmtGBP(currentSpend)}</span>
            {" this period"}
            {delta !== null && absDelta !== null && pct !== null && (
              delta > 0 ? (
                <span className="text-amber-600 dark:text-amber-400">
                  {" · "}<span className="font-bold font-mono tabular-nums">{fmtGBP(absDelta)}</span>{` (${pct}%) more than last`}
                </span>
              ) : delta < 0 ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  {" · "}<span className="font-bold font-mono tabular-nums">{fmtGBP(absDelta)}</span>{` (${pct}%) less than last`}
                </span>
              ) : null
            )}
          </p>
        );
      })()}
      <div className={compact ? "h-20" : "h-36"}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={periods} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          {!compact && (
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: tickFill }} />
          )}
          {!compact && (
            <YAxis width={currencyAxisWidth(yMax)} domain={[0, yMax > 0 ? yMax : "auto"]} tickLine={false} axisLine={false}
              tick={{ fontSize: 9, fill: tickFill, fontFamily: "var(--font-jbmono), monospace" }} tickFormatter={(v: number) => fmtGBP(v)} />
          )}
          <Tooltip trigger="click" contentStyle={TOOLTIP_STYLE} itemStyle={{ fontFamily: "var(--font-jbmono), monospace" }} formatter={(v) => fmtGBP(Number(v ?? 0))} cursor={{ fill: "rgba(100,116,139,0.08)" }} />
          <Bar dataKey="spend" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false}>
            {periods.map((p, i) => (
              <Cell key={i} fill={p.current ? "#6366f1" : "#c7d2fe"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      </div>
    </>
  );
}

const SIZE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "<£5", min: 0, max: 5 },
  { label: "£5–10", min: 5, max: 10 },
  { label: "£10–25", min: 10, max: 25 },
  { label: "£25–50", min: 25, max: 50 },
  { label: "£50–100", min: 50, max: 100 },
  { label: "£100–250", min: 100, max: 250 },
  { label: "£250+", min: 250, max: Infinity },
];

function SizeDistributionWidget({ data, compact }: { data: WidgetData; compact?: boolean }) {
  const isDark = useIsDark();
  const tickFill = isDark ? "#94a3b8" : "#64748b";
  // "spend" is the decision-relevant default; "count" is the alternative
  const [mode, setMode] = useState<"spend" | "count">("spend");

  const bands = useMemo(() => {
    const totals = SIZE_BANDS.map(b => ({ label: b.label, count: 0, total: 0 }));
    for (const t of spendDebits(data.periodTxns)) {
      const amt = Math.abs(t.amount);
      const idx = SIZE_BANDS.findIndex(b => amt >= b.min && amt < b.max);
      if (idx >= 0) { totals[idx].count += 1; totals[idx].total += amt; }
    }
    return totals;
  }, [data.periodTxns]);

  if (bands.every(b => b.count === 0)) return <EmptyWidget compact={compact} />;

  const dataKey = mode === "spend" ? "total" : "count";
  const yFormatter = mode === "spend"
    ? (v: number) => fmtGBP(v)
    : (v: number) => `${v}`;
  const tooltipFormatter = mode === "spend"
    ? (v: unknown) => [fmtGBP(Number(v ?? 0)), ""]
    : (v: unknown) => [`${Number(v ?? 0)} payment${Number(v ?? 0) !== 1 ? "s" : ""}`, ""];
  // Only "spend" ticks in currency — "count" stays the small plain integer
  // it always was, no digit-boundary risk worth forcing a domain over.
  const spendYMax = mode === "spend" ? niceAxisCeiling(Math.max(...bands.map(b => b.total), 0)) : 0;

  return (
    <>
      {!compact && (() => {
        const largeBand = bands[bands.length - 1]; // £250+ is the last band
        const sumAll = bands.reduce((s, b) => s + b.total, 0);
        const largeCount = largeBand?.count ?? 0;
        const largePct = sumAll > 0 && largeBand ? Math.round((largeBand.total / sumAll) * 100) : 0;
        return (
          <div className="mb-3">
            <div className="flex items-start justify-between gap-3 mb-2">
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-snug flex-1">
                {largeCount === 0
                  ? <>No single payment over <span className="font-mono tabular-nums">£250</span> this period</>
                  : (
                    <>
                      <span className="font-bold text-slate-900 dark:text-slate-100">{largeCount}</span>
                      {` ${largeCount === 1 ? "payment" : "payments"} over `}
                      <span className="font-mono tabular-nums">£250</span>
                      {" · "}
                      <span className="font-bold text-slate-900 dark:text-slate-100">{largePct}%</span>
                      {" of your spend"}
                    </>
                  )
                }
              </p>
              {/* By spend / By count segmented pill toggle */}
              <div className="flex-shrink-0 flex rounded-full border border-slate-200 dark:border-slate-600 overflow-hidden text-[11px] font-semibold">
                <button
                  onClick={() => setMode("spend")}
                  className={`px-2.5 py-1 transition-colors ${
                    mode === "spend"
                      ? "bg-slate-200 dark:bg-slate-600 text-slate-900 dark:text-slate-100"
                      : "bg-transparent text-slate-500 dark:text-slate-400 active:bg-slate-100 dark:active:bg-slate-700"
                  }`}
                >
                  By spend
                </button>
                <button
                  onClick={() => setMode("count")}
                  className={`px-2.5 py-1 transition-colors ${
                    mode === "count"
                      ? "bg-slate-200 dark:bg-slate-600 text-slate-900 dark:text-slate-100"
                      : "bg-transparent text-slate-500 dark:text-slate-400 active:bg-slate-100 dark:active:bg-slate-700"
                  }`}
                >
                  By count
                </button>
              </div>
            </div>
            {largeCount > 0 && data.onReviewLarge && (
              <button
                onClick={data.onReviewLarge}
                className="px-4 py-1.5 rounded-full border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition-transform bg-transparent"
              >
                Review large payments
              </button>
            )}
          </div>
        );
      })()}
      <div className={compact ? "h-20" : "h-36"}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bands} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            {!compact && (
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 8.5, fill: tickFill, fontFamily: "var(--font-jbmono), monospace" }} interval={0} />
            )}
            {!compact && (
              <YAxis width={mode === "spend" ? currencyAxisWidth(spendYMax) : 24}
                domain={mode === "spend" ? [0, spendYMax > 0 ? spendYMax : "auto"] : undefined}
                tickLine={false} axisLine={false}
                allowDecimals={false} tick={{ fontSize: 9, fill: tickFill, fontFamily: mode === "spend" ? "var(--font-jbmono), monospace" : undefined }}
                tickFormatter={yFormatter} />
            )}
            <Tooltip trigger="click" contentStyle={TOOLTIP_STYLE}
              itemStyle={mode === "spend" ? { fontFamily: "var(--font-jbmono), monospace" } : undefined}
              formatter={tooltipFormatter}
              cursor={{ fill: "rgba(100,116,139,0.08)" }} />
            <Bar dataKey={dataKey} fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function EmptyWidget({ compact, message }: { compact?: boolean; message?: string }) {
  return (
    <div className={`flex items-center justify-center ${compact ? "h-20" : "h-24"}`}>
      <p className="text-xs text-slate-500 dark:text-slate-400">{message ?? "No spending in this period"}</p>
    </div>
  );
}

// pace_curve — the running-total pace curve, cut from SpendHeader's hero in
// the weighted-instrument round (2026-08-27, see that file's comment) and
// restored here as an opt-in Charts widget instead. Reads verdict.pace_series
// verbatim (backend/app/services/spend_verdict.py:build_pace_series) — never
// recomputed client-side, so this can never draw a different "usual" than
// the reading/notables do. `usual` is null on every day while the baseline
// is thin (see that function's docstring) — a fabricated flat ramp would be
// a lie, so when the whole series has no usual we draw actual alone and say
// plainly that we're still learning, rather than implying a comparison.
// Exported for app/design/spend-charts (see WidgetData's comment above) —
// the real widget renderer, not a redrawn mockup, so the design route and
// production can never draw different pixels for the same data.
export function PaceCurveWidget({ data, compact }: { data: WidgetData; compact?: boolean }) {
  const isDark = useIsDark();
  const tickFill = isDark ? "#94a3b8" : "#64748b";
  const series = data.paceSeries;

  if (!series || series.length === 0) {
    return <EmptyWidget compact={compact} message="No pace data for this period yet." />;
  }

  const hasUsual = series.some(p => p.usual !== null);
  const last = series[series.length - 1];
  const lastUsual = hasUsual
    ? series.slice().reverse().find(p => p.usual !== null)?.usual ?? null
    : null;
  const diff = lastUsual !== null ? last.actual - lastUsual : null;

  const chartData = series.map(p => ({ day: p.day, actual: p.actual, usual: p.usual }));
  const midIdx = Math.floor((series.length - 1) / 2);
  const ticks = Array.from(new Set([series[0]?.day, series[midIdx]?.day, last.day].filter((d): d is number => d !== undefined)));
  const yMax = niceAxisCeiling(Math.max(...chartData.flatMap(d => [d.actual, d.usual ?? 0]), 0));

  return (
    <>
      {!compact && (
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-snug mb-3">
          {hasUsual && diff !== null ? (
            <>
              {"Day "}<span className="font-bold text-slate-900 dark:text-slate-100">{last.day}</span>
              {": "}<span className="font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">{fmtGBP(last.actual)}</span>
              {" so far"}
              {diff > 0 ? (
                <span className="text-amber-600 dark:text-amber-400">
                  {" · "}<span className="font-bold font-mono tabular-nums">{fmtGBP(Math.abs(diff))}</span>{" ahead of usual"}
                </span>
              ) : diff < 0 ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  {" · "}<span className="font-bold font-mono tabular-nums">{fmtGBP(Math.abs(diff))}</span>{" behind usual"}
                </span>
              ) : (
                " · right on usual"
              )}
            </>
          ) : (
            "Still learning your usual pace."
          )}
        </p>
      )}
      <div className={compact ? "h-20" : "h-36"}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            {!compact && (
              <XAxis dataKey="day" ticks={ticks} tickLine={false} axisLine={false}
                tick={{ fontSize: 9, fill: tickFill }} tickFormatter={(d: number) => `Day ${d}`} interval="preserveStartEnd" />
            )}
            {!compact && (
              <YAxis width={currencyAxisWidth(yMax)} domain={[0, yMax > 0 ? yMax : "auto"]} tickLine={false} axisLine={false}
                tick={{ fontSize: 9, fill: tickFill, fontFamily: "var(--font-jbmono), monospace" }} tickFormatter={(v: number) => fmtGBP(v)} />
            )}
            <Tooltip
              trigger="click"
              contentStyle={TOOLTIP_STYLE}
              itemStyle={{ fontFamily: "var(--font-jbmono), monospace" }}
              labelFormatter={(d) => `Day ${d}`}
              formatter={(v, name) => [fmtGBP(Number(v ?? 0)), name === "actual" ? "Actual" : "Usual"]}
            />
            {/* actual — the prominent, solid line: this period's real running
                total, same indigo the rest of this file uses for "the thing
                that happened". */}
            <Line type="monotone" dataKey="actual" stroke="#6366f1" strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls />
            {/* usual — a quieter dashed reference, only drawn when at least
                one day has a real learned value; never a fabricated line for
                a thin-history period (see the docstring above). Neutral grey
                regardless of whether actual sits above or below it — colour
                here is information, not a verdict (DESIGN.md), so running
                hot is never rendered red. */}
            {hasUsual && (
              // No connectNulls here, unlike actual above. A null usual
              // means the baseline had not learned that day, not a missing
              // number to fill in. build_pace_series only ever emits a
              // day's usual once it has one, so bridging a null run would
              // draw a value the engine never asserted. If this line looks
              // broken with a gap in it, that gap is the honest picture.
              // Do not "fix" it by adding connectNulls back.
              <Line type="monotone" dataKey="usual" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

// debt_burndown — card balance total projected forward month by month at
// the demonstrated paydown pace. Format "YYYY-MM" (debt_plan.py's
// _month_label) as "Mon 'YY", the same short-date convention DailyBars/
// PeriodCompare use elsewhere in this file, no date library needed.
const DEBT_MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtProjectionMonth(m: string): string {
  const [y, mo] = m.split("-");
  const short = DEBT_MONTH_SHORT[Number(mo) - 1] ?? mo;
  return `${short} '${(y ?? "").slice(2)}`;
}

// Why this exists: debt_plan.py sets N = min(HORIZON_MONTHS, max(months_to_
// payoff) + PROJECTION_TAIL_MONTHS) ONLY when every card has a months_to_
// payoff (the healthy, clears-eventually case) — that keeps the payload
// short, ending shortly after the last card hits zero. The moment any card
// never clears at the demonstrated pace, the backend falls back to the full
// HORIZON_MONTHS (120-month) walk, and a carried-interest card compounding
// faster than the paydown drags the total upward for a decade. Plotting all
// 121 points then would be a "Card balance ahead" chart that climbs for ten
// years off a median monthly-movement figure — an extrapolation nobody
// should stand behind, and it would bury whatever's actually happening in
// the next couple of years under nine years of noise. So: if the series
// reaches zero, draw all of it (the backend has already kept that short);
// if it never reaches zero, draw only the first 24 months and let the
// caller say plainly why the chart stops there.
function clipProjection(projection: { month: string; total: number }[]): {
  points: { month: string; total: number }[];
  clippedNonClearing: boolean;
} {
  const reachesZero = projection.some(p => p.total <= 0);
  if (reachesZero) return { points: projection, clippedNonClearing: false };
  const HORIZON_WINDOW_MONTHS = 24;
  return {
    points: projection.slice(0, HORIZON_WINDOW_MONTHS),
    clippedNonClearing: projection.length > HORIZON_WINDOW_MONTHS,
  };
}

// This widget is NOT period-scoped (a card balance projection has nothing
// to do with the pay period the Charts tab happens to be viewing), so
// unlike every other widget in this file it fetches its own data rather
// than reading it off WidgetData.
//
// Exported, and takes an optional `previewState` prop, for app/design/
// spend-charts (see WidgetData's comment above). /debt-plan/summary requires
// auth, which the design route deliberately doesn't have, so there is no
// real fetch to point it at. `previewState` is a PREVIEW SEAM: when set, the
// effect below skips the network call entirely and the widget renders the
// given status/projection instead. Production never passes this prop, so
// the real path is untouched: fetch on mount, out-of-order guard, honest
// states.
export function DebtBurndownWidget({
  compact,
  previewState,
}: {
  compact?: boolean;
  previewState?: { status: "loading" | "error" | "ok"; projection?: DebtPlanSummary["projection"] };
}) {
  const isDark = useIsDark();
  const tickFill = isDark ? "#94a3b8" : "#64748b";
  const [status, setStatus] = useState<"loading" | "error" | "ok">(previewState?.status ?? "loading");
  const [projection, setProjection] = useState<DebtPlanSummary["projection"]>(previewState?.projection);
  // Out-of-order guard — StrictMode/fast remounts can fire this effect
  // twice; without this, a slow first response landing after a fast second
  // one would clobber the newer state with stale data.
  const requestSeq = useRef(0);

  useEffect(() => {
    if (previewState) return; // preview seam — no fixture, no fetch
    const seq = ++requestSeq.current;
    setStatus("loading");
    api.getDebtPlanSummary()
      .then(summary => {
        if (requestSeq.current !== seq) return;
        setProjection(summary.projection);
        setStatus("ok");
      })
      .catch(() => {
        if (requestSeq.current !== seq) return;
        setStatus("error");
      });
  }, [previewState]);

  if (status === "loading") return <EmptyWidget compact={compact} message="Loading your card balances…" />;
  if (status === "error") return <EmptyWidget compact={compact} message="Couldn't load your card balances just now." />;
  // Older backend deployed ahead of the field going live — honest "not
  // available", never a fabricated projection.
  if (projection === undefined) return <EmptyWidget compact={compact} message="Card balance projection isn't available yet." />;
  // Empty is good news here, not an error: no card carries a balance worth
  // projecting.
  if (projection.length === 0) return <EmptyWidget compact={compact} message="No card carries a balance worth projecting. Nothing to chart here." />;

  const { points, clippedNonClearing } = clipProjection(projection);
  const chartData = points.map(p => ({ total: p.total, label: fmtProjectionMonth(p.month) }));
  const midIdx = Math.floor((chartData.length - 1) / 2);
  const ticks = Array.from(new Set([chartData[0]?.label, chartData[midIdx]?.label, chartData[chartData.length - 1]?.label].filter((l): l is string => l !== undefined)));
  const yMax = niceAxisCeiling(Math.max(...chartData.map(d => d.total), 0));

  return (
    <>
      <div className={compact ? "h-20" : "h-36"}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            {!compact && (
              <XAxis dataKey="label" ticks={ticks} tickLine={false} axisLine={false}
                tick={{ fontSize: 9, fill: tickFill }} interval="preserveStartEnd" />
            )}
            {!compact && (
              <YAxis width={currencyAxisWidth(yMax)} domain={[0, yMax > 0 ? yMax : "auto"]} tickLine={false} axisLine={false}
                tick={{ fontSize: 9, fill: tickFill, fontFamily: "var(--font-jbmono), monospace" }} tickFormatter={(v: number) => fmtGBP(v)} />
            )}
            <Tooltip
              trigger="click"
              contentStyle={TOOLTIP_STYLE}
              itemStyle={{ fontFamily: "var(--font-jbmono), monospace" }}
              formatter={(v) => [fmtGBP(Number(v ?? 0)), "Balance"]}
              cursor={{ fill: "rgba(100,116,139,0.08)" }}
            />
            {/* Same indigo the rest of this file uses for "the thing that's
                actually happening" — this line is allowed to rise, DESIGN.md
                colour-is-information doctrine means a climbing balance isn't
                painted red just for being bad news; the caption below says
                the honest thing in words instead. */}
            <Area type="monotone" dataKey="total" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {!compact && clippedNonClearing && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 leading-snug">
          At the pace you're paying, these balances aren't on track to clear. Showing the next two years rather than a longer projection we wouldn't stand behind.
        </p>
      )}
      {/* Compact (pinned to Home) has no room for the full caption above,
          but the chart's honesty lives entirely in that caption — a bare
          rising sparkline with no words reads as a plain trend line, not
          the "we cut this off, here's why" the full card says. So compact
          gets a short version of the same fact, and ONLY the same fact: no
          payoff date, no debt-free month, no figure, just the direction.
          Shown only in the non-clearing case, matching the full caption's
          own gate exactly — a series that reaches zero says nothing extra
          here either. Neutral grey, not amber or red: this is a
          projection, not a risk event (DESIGN.md, colour is information). */}
      {compact && clippedNonClearing && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 leading-snug">
          Not on track to clear at this pace
        </p>
      )}
    </>
  );
}

const TRANSPORT_MODE_ICON: Record<string, import("react").ReactNode> = {
  "Fuel":             <Fuel size={14} />,
  "Parking":          <SquareParking size={14} />,
  "Taxi & Rideshare": <CarTaxiFront size={14} />,
  "Rail":             <Train size={14} />,
  "TfL / Oyster":     <Train size={14} />,
  "Bus & Coach":      <Bus size={14} />,
  "EV Charging":      <PlugZap size={14} />,
  "Car Rental":       <Car size={14} />,
  "Car Care":         <Wrench size={14} />,
};

function TransportModesWidget({ compact }: { compact?: boolean }) {
  const [data, setData] = useState<TransportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.transportSummary()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <EmptyWidget compact={compact} />;
  if (!data || data.total_spend === 0) return <EmptyWidget compact={compact} />;

  const total        = data.total_spend;
  const carPct       = total > 0 ? (data.car_total       / total) * 100 : 0;
  const ridesharePct = total > 0 ? (data.rideshare_total / total) * 100 : 0;
  const ptPct        = total > 0 ? (data.pt_total        / total) * 100 : 0;
  const activeSplitGroups = [carPct, ridesharePct, ptPct].filter(p => p > 0).length;
  const maxModeTotal      = Math.max(...data.modes.map(m => m.total), 1);

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {/* Hero */}
      <div>
        <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1">
          Transport · 90 days
        </p>
        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          <span className="font-mono tabular-nums">{fmtGBP(data.monthly_avg)}</span><span className="text-sm font-normal text-slate-400">/mo</span>
        </p>
      </div>

      {/* Split bar + legend */}
      {activeSplitGroups >= 2 && (
        <>
          <div className="h-2 rounded-full overflow-hidden flex gap-px">
            {carPct > 1 && <div className="h-full bg-amber-400" style={{ width: `${carPct}%` }} />}
            {ridesharePct > 1 && <div className="h-full bg-blue-500" style={{ width: `${ridesharePct}%` }} />}
            {ptPct > 1 && <div className="h-full bg-violet-500" style={{ width: `${ptPct}%` }} />}
          </div>
          <div className="flex flex-wrap gap-3">
            {carPct > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />Car · {Math.round(carPct)}%
              </span>
            )}
            {ridesharePct > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />Rideshare · {Math.round(ridesharePct)}%
              </span>
            )}
            {ptPct > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
                <span className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />Public · {Math.round(ptPct)}%
              </span>
            )}
          </div>
        </>
      )}

      {/* Mode rows */}
      {!compact && (
        <>
          <p className="text-base font-bold text-slate-800 dark:text-slate-100">Where it goes</p>
          <div className="space-y-3">
            {data.modes.map(m => {
              const w = Math.max(Math.round((m.total / maxModeTotal) * 100), 3);
              return (
                <div key={m.name} className="flex items-center gap-3">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-white"
                    style={{ backgroundColor: m.colour }}
                  >
                    {TRANSPORT_MODE_ICON[m.name] ?? <Car size={12} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{m.name}</span>
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 ml-2 flex-shrink-0">
                        <span className="font-mono tabular-nums">{fmtGBP(m.monthly)}</span><span className="text-[11px] font-normal text-slate-400">/mo</span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${w}%`, backgroundColor: m.colour }} />
                    </div>
                  </div>
                  <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 w-6 text-right flex-shrink-0">
                    {Math.round(m.pct)}%
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function renderWidget(id: WidgetId, data: WidgetData, compact?: boolean) {
  switch (id) {
    case "category_pie":      return <CategoryPieWidget data={data} compact={compact} />;
    case "daily_bars":        return <DailyBarsWidget data={data} compact={compact} />;
    case "period_compare":    return <PeriodCompareWidget data={data} compact={compact} />;
    case "size_distribution": return <SizeDistributionWidget data={data} compact={compact} />;
    case "transport_modes":   return <TransportModesWidget compact={compact} />;
    case "pace_curve":        return <PaceCurveWidget data={data} compact={compact} />;
    case "debt_burndown":     return <DebtBurndownWidget compact={compact} />;
  }
}

/* ── Widget card chrome ───────────────────────────────────────────── */

function WidgetCard({
  id, data, pinned, otherPinned, onPin, onRemove,
}: {
  id: WidgetId;
  data: WidgetData;
  pinned: boolean;
  otherPinned: boolean; // one Home slot — pinning here evicts the current pin
  onPin: () => void;
  onRemove: () => void;
}) {
  // Hold (300ms) anywhere on the card to lift and drag it into a new spot;
  // quick touches still scroll/tap as normal
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const meta = WIDGET_META[id];

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [menuOpen]);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: "manipulation",
        zIndex: isDragging ? 30 : undefined,
        position: "relative",
      }}
      className={`glass-card rounded-2xl p-4 ${
        isDragging ? "shadow-xl ring-2 ring-indigo-300 dark:ring-indigo-500/50 scale-[1.02]" : ""
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">{meta.title}</p>
          {pinned && <Pin size={11} className="text-indigo-400 flex-shrink-0" />}
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="w-10 h-10 -mr-1 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 active:bg-slate-100 dark:active:bg-slate-700"
          >
            <MoreVertical size={15} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 w-52 bg-white dark:bg-slate-700 rounded-xl shadow-lg border border-slate-100 dark:border-slate-600 py-1 overflow-hidden">
              <MenuItem
                icon={pinned ? <PinOff size={13} /> : <Pin size={13} />}
                label={pinned ? "Unpin from Home" : otherPinned ? "Pin to Home (replaces pin)" : "Pin to Home"}
                onClick={() => { setMenuOpen(false); onPin(); }}
              />
              <MenuItem icon={<Trash2 size={13} />} label="Remove" destructive
                onClick={() => { setMenuOpen(false); onRemove(); }} />
            </div>
          )}
        </div>
      </div>
      {renderWidget(id, data)}
    </div>
  );
}

function MenuItem({ icon, label, onClick, destructive }: {
  icon: React.ReactNode; label: string; onClick: () => void; destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-left active:bg-slate-50 dark:active:bg-slate-600 ${
        destructive ? "text-red-500 dark:text-red-400" : "text-slate-700 dark:text-slate-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/* ── The Trends tab ───────────────────────────────────────────────── */

export default function SpendTrends(props: {
  periodTxns: Transaction[];
  allTxns: Transaction[];
  periodStart: Date;
  periodEnd: Date;
  payPeriodConfig: PayPeriodConfig;
  colours: Record<string, string>;
  onReviewLarge?: () => void;
  // Threaded from SpendPage.tsx's verdict?.pace_series — see WidgetData's
  // own comment for why this can't be derived from periodTxns/allTxns.
  paceSeries?: SpendVerdictPaceEntry[];
}) {
  const { spendWidgets: ctxWidgets, homePinnedWidget: ctxPinned, setSpendWidgets: setCtxWidgets, setHomePinnedWidget: setCtxPinned } = usePreferences();
  // prefsLoaded is true once the context has received the server response (non-null array).
  const prefsLoaded = ctxWidgets !== null;
  const [widgets, setWidgets] = useState<WidgetId[]>(DEFAULT_WIDGETS);
  const [pinnedWidget, setPinnedWidget] = useState<WidgetId | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);

  // Sync local state from context whenever context loads/changes.
  useEffect(() => {
    if (ctxWidgets !== null) setWidgets(ctxWidgets.filter(isWidgetId));
  }, [ctxWidgets]);

  useEffect(() => {
    setPinnedWidget(isWidgetId(ctxPinned) ? ctxPinned : null);
  }, [ctxPinned]);

  function saveWidgets(next: WidgetId[]) {
    setWidgets(next);
    setCtxWidgets(next);
    api.updatePreferences({ spend_widgets: next }).catch(() => {});
  }

  function savePinned(next: WidgetId | null) {
    setPinnedWidget(next);
    setCtxPinned(next);
    api.updatePreferences({ home_pinned_widget: next }).catch(() => {});
  }

  function removeWidget(id: WidgetId) {
    saveWidgets(widgets.filter(w => w !== id));
    if (pinnedWidget === id) savePinned(null);
  }

  // TouchSensor (not PointerSensor): pointer events are passive, so the browser
  // hijacks the gesture for scrolling and the lifted card never moves. The touch
  // sensor prevents the scroll takeover once the hold delay has activated.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = widgets.indexOf(active.id as WidgetId);
    const to = widgets.indexOf(over.id as WidgetId);
    if (from < 0 || to < 0) return;
    saveWidgets(arrayMove(widgets, from, to));
  }

  const data: WidgetData = {
    periodTxns: props.periodTxns,
    allTxns: props.allTxns,
    periodStart: props.periodStart,
    periodEnd: props.periodEnd,
    payPeriodConfig: props.payPeriodConfig,
    colours: props.colours,
    onReviewLarge: props.onReviewLarge,
    paceSeries: props.paceSeries,
  };

  const available = ALL_WIDGETS.filter(w => !widgets.includes(w));

  return (
    <div className="px-4 pt-4 space-y-3">
      {prefsLoaded && widgets.length === 0 && (
        <div className="glass-card rounded-2xl p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No charts yet, add one below to start visualising your spending.
          </p>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={widgets} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {widgets.map(id => (
              <WidgetCard
                key={id}
                id={id}
                data={data}
                pinned={pinnedWidget === id}
                otherPinned={pinnedWidget !== null && pinnedWidget !== id}
                onPin={() => savePinned(pinnedWidget === id ? null : id)}
                onRemove={() => removeWidget(id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {available.length > 0 && (
        <button
          onClick={() => setGalleryOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 py-3.5 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-semibold active:scale-[0.98] transition-transform"
        >
          <Plus size={14} /> Add widget
        </button>
      )}

      {galleryOpen && (
        <AddWidgetGallery
          available={available}
          onAdd={id => { saveWidgets([...widgets, id]); setGalleryOpen(false); }}
          onClose={() => setGalleryOpen(false)}
        />
      )}
    </div>
  );
}

function AddWidgetGallery({ available, onAdd, onClose }: {
  available: WidgetId[];
  onAdd: (id: WidgetId) => void;
  onClose: () => void;
}) {
  useLockBodyScroll();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[65]" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add a widget"
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] lg:max-w-md lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 glass-sheet rounded-t-3xl lg:rounded-3xl z-[70] max-h-[88dvh] overflow-y-auto p-5 pb-[calc(2rem+env(safe-area-inset-bottom))] lg:pb-5"
      >
        <p className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">Add a widget</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Most charts use the pay period you're viewing.
        </p>
        <div className="space-y-2">
          {available.map(id => {
            const { title, description, Icon } = WIDGET_META[id];
            return (
              <button
                key={id}
                onClick={() => onAdd(id)}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-700/50 active:scale-[0.98] transition-transform text-left"
                  >
                    <span className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                      <Icon size={16} className="text-indigo-500 dark:text-indigo-400" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">{description}</span>
                    </span>
                    <Plus size={15} className="text-slate-300 dark:text-slate-500 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ── Compact pinned card for the home page ────────────────────────── */

export function PinnedWidgetCard({
  id, transactions, periodStart, periodEnd, payPeriodConfig, colours, onOpen,
}: {
  id: string;
  transactions: Transaction[];
  periodStart: Date;
  periodEnd: Date;
  payPeriodConfig: PayPeriodConfig;
  colours: Record<string, string>;
  onOpen: () => void;
}) {
  const periodTxns = useMemo(
    () => filterPeriod(transactions, periodStart, periodEnd),
    [transactions, periodStart, periodEnd],
  );
  // pace_curve only: its data lives on the /spend/verdict payload, not on
  // the transactions already loaded for Home, so unlike every other widget
  // here it fetches its own slice on the side. Offset 0 is correct — Home
  // always shows the CURRENT pay period (see periodStart/periodEnd above,
  // derived from getPayPeriodWithConfig(new Date(), ...) at the HomePage
  // callsite), and offset 0 is /spend/verdict's current-period request,
  // the same convention SpendPage.tsx uses for its own current period.
  const [paceStatus, setPaceStatus] = useState<"idle" | "loading" | "error" | "ok">(
    id === "pace_curve" ? "loading" : "idle",
  );
  const [paceSeries, setPaceSeries] = useState<SpendVerdictPaceEntry[] | undefined>(undefined);
  // Out-of-order guard, same idiom as DebtBurndownWidget's requestSeq above.
  const requestSeq = useRef(0);

  useEffect(() => {
    if (id !== "pace_curve") return; // no other widget needs this fetch
    const hit = cachedVerdict(0);
    if (hit) {
      // Shared with SpendPage.tsx via lib/verdictCache.ts — a recent Spend
      // visit means this paints with no fetch at all (TTL 90s, matches the
      // server's own /spend/verdict cache window).
      setPaceSeries(hit.pace_series);
      setPaceStatus("ok");
      return;
    }
    const seq = ++requestSeq.current;
    setPaceStatus("loading");
    fetchVerdictData(0)
      .then(v => {
        if (requestSeq.current !== seq) return;
        setPaceSeries(v.pace_series);
        setPaceStatus("ok");
      })
      .catch(() => {
        if (requestSeq.current !== seq) return;
        setPaceStatus("error");
      });
  }, [id]);

  if (!isWidgetId(id)) return null;

  const data: WidgetData = {
    periodTxns, allTxns: transactions, periodStart, periodEnd, payPeriodConfig, colours,
    paceSeries: id === "pace_curve" ? paceSeries : undefined,
  };

  return (
    <div className="lg:mx-0">
      <button
        onClick={onOpen}
        className="w-full glass-card rounded-2xl p-4 text-left active:scale-[0.99] transition-transform"
      >
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-base font-bold text-slate-800 dark:text-slate-100">
            {WIDGET_META[id].title}
          </p>
          <span className="flex items-center gap-0.5 text-[11px] font-semibold text-indigo-500 dark:text-indigo-400">
            Trends <ChevronRight size={12} />
          </span>
        </div>
        {id === "pace_curve" && paceStatus === "loading" && (
          <EmptyWidget compact message="Loading your spending pace..." />
        )}
        {id === "pace_curve" && paceStatus === "error" && (
          <EmptyWidget compact message="Couldn't load your spending pace just now." />
        )}
        {(id !== "pace_curve" || paceStatus === "ok") && renderWidget(id, data, true)}
      </button>
    </div>
  );
}
