/**
 * SpendTrends — native chart widgets for the Spend screen Trends tab.
 *
 * Uses react-native-svg (already installed) for all rendering.
 * No dnd-kit (web only) — swipe left/right between charts instead.
 *
 * Widgets:
 *   1. category_pie   — donut chart + legend
 *   2. daily_bars     — bar chart per day with slate-400 avg reference line
 *   3. period_compare — 6-period comparison bars (no reference line)
 *   4. size_distribution — bands <£5 … £250+, toggle by spend / by count
 *   5. transport_modes   — 90-day rolling split bar + mode rows
 *
 * Tooltip: long-press bar/slice → shows dark slate overlay (rgba(15,23,42,0.92)).
 * "Review large" button → calls onReviewLarge() which switches parent to list view.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import Svg, {
  G,
  Path,
  Rect,
  Line,
  Text as SvgText,
  Circle,
} from "react-native-svg";
import { tw } from "@/lib/tw";
import { CATEGORY_COLOURS } from "@/lib/shared";
import { spendApi } from "@/lib/api/spend";
import type { Transaction, TransportSummary } from "@/lib/api/spend";
import {
  filterPeriod,
  prevPeriod,
  getCurrentPeriod,
} from "./periodUtils";
import type { PeriodBounds } from "./periodUtils";
import {
  ChartPie,
  BarChart3,
  TrendingUp,
  AlignStartVertical,
  Plus,
  Car,
  Train,
  Bus,
  CarTaxiFront,
  Plug,
  Wrench,
  SquareParking,
  Fuel,
} from "lucide-react-native";


const MONTH_SHORT = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

function fmtGBP(n: number): string {
  return `£${Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function spendDebits(txns: Transaction[]): Transaction[] {
  return txns.filter(
    (t) =>
      t.transaction_type === "debit" &&
      (t.category || "Other") !== "Transfer"
  );
}

function catColour(name: string, colours: Record<string, string> = {}): string {
  return colours[name] ?? CATEGORY_COLOURS[name] ?? "#94a3b8";
}

// ── Tooltip overlay ────────────────────────────────────────────────────────────

interface TooltipProps {
  label: string;
  value: string;
  visible: boolean;
}

function Tooltip({ label, value, visible }: TooltipProps) {
  if (!visible) return null;
  return (
    <View style={styles.tooltip} pointerEvents="none">
      <Text style={styles.tooltipLabel}>{label}</Text>
      <Text style={styles.tooltipValue}>{value}</Text>
    </View>
  );
}

// ── Category Pie ───────────────────────────────────────────────────────────────

interface PieSlice {
  name: string;
  value: number;
  colour: string;
  startAngle: number;
  endAngle: number;
}

function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number
): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number
): string {
  const clampedEnd = Math.min(endAngle, startAngle + 359.99);
  const large = clampedEnd - startAngle > 180 ? 1 : 0;
  const s1 = polarToCartesian(cx, cy, outerR, startAngle);
  const e1 = polarToCartesian(cx, cy, outerR, clampedEnd);
  const s2 = polarToCartesian(cx, cy, innerR, clampedEnd);
  const e2 = polarToCartesian(cx, cy, innerR, startAngle);
  return [
    `M ${s1.x} ${s1.y}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${e1.x} ${e1.y}`,
    `L ${s2.x} ${s2.y}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${e2.x} ${e2.y}`,
    "Z",
  ].join(" ");
}

interface CategoryPieWidgetProps {
  periodTxns: Transaction[];
  colours: Record<string, string>;
  dark: boolean;
}

function CategoryPieWidget({ periodTxns, colours, dark }: CategoryPieWidgetProps) {
  const [tooltip, setTooltip] = useState<{ label: string; value: string } | null>(null);

  const slices = useMemo((): PieSlice[] => {
    const map: Record<string, number> = {};
    for (const t of periodTxns) {
      const cat = t.category || "Other";
      if (cat === "Transfer" || cat === "Income") continue;
      map[cat] =
        (map[cat] ?? 0) +
        (t.transaction_type === "credit" ? -Math.abs(t.amount) : Math.abs(t.amount));
    }
    const entries = Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);

    const total = entries.reduce((s, x) => s + x.value, 0);
    let angle = 0;
    return entries.map((e) => {
      const sweep = (e.value / total) * 360;
      const slice: PieSlice = {
        name: e.name,
        value: e.value,
        colour: catColour(e.name, colours),
        startAngle: angle,
        endAngle: angle + sweep - 2.5, // paddingAngle 2.5
      };
      angle += sweep;
      return slice;
    });
  }, [periodTxns, colours]);

  const total = slices.reduce((s, x) => s + x.value, 0);
  const subTone = dark ? tw.color.slate400 : tw.color.slate500;
  const nameTone = dark ? tw.color.slate300 : tw.color.slate600;
  const valTone = dark ? tw.color.slate100 : tw.color.slate800;

  if (slices.length === 0) {
    return <EmptyWidget dark={dark} />;
  }

  const SIZE = 128;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const outerR = 60;
  const innerR = 38;

  return (
    <View style={styles.pieRow}>
      <View style={{ position: "relative" }}>
        <Svg width={SIZE} height={SIZE}>
          <G>
            {slices.map((s) => (
              <Path
                key={s.name}
                d={arcPath(cx, cy, innerR, outerR, s.startAngle, s.endAngle)}
                fill={s.colour}
                onLongPress={() =>
                  setTooltip({
                    label: s.name,
                    value: `${fmtGBP(s.value)} · ${Math.round((s.value / total) * 100)}%`,
                  })
                }
                onPressOut={() => setTooltip(null)}
              />
            ))}
          </G>
        </Svg>
        {tooltip && (
          <View style={styles.pieTooltip}>
            <Text style={styles.tooltipLabel}>{tooltip.label}</Text>
            <Text style={styles.tooltipValue}>{tooltip.value}</Text>
          </View>
        )}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        {slices.slice(0, 5).map((s) => (
          <View key={s.name} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: s.colour }]} />
            <Text
              style={[styles.legendName, { color: nameTone }]}
              numberOfLines={1}
            >
              {s.name}
            </Text>
            <Text style={[styles.legendPct, { color: valTone }]}>
              {Math.round((s.value / total) * 100)}%
            </Text>
          </View>
        ))}
        {slices.length > 5 && (
          <Text style={[styles.legendMore, { color: subTone }]}>
            +{slices.length - 5} more
          </Text>
        )}
      </View>
    </View>
  );
}

// ── Daily Bars ─────────────────────────────────────────────────────────────────

interface DayBar {
  label: string;
  spend: number;
}

interface DailyBarsWidgetProps {
  periodTxns: Transaction[];
  periodStart: Date;
  periodEnd: Date;
  dark: boolean;
}

function DailyBarsWidget({
  periodTxns,
  periodStart,
  periodEnd,
  dark,
}: DailyBarsWidgetProps) {
  const [tooltip, setTooltip] = useState<{ label: string; value: string; x: number } | null>(null);

  const days = useMemo((): DayBar[] => {
    const byDay: Record<string, number> = {};
    for (const t of spendDebits(periodTxns)) {
      const key = t.date.slice(0, 10);
      byDay[key] = (byDay[key] ?? 0) + Math.abs(t.amount);
    }
    const out: DayBar[] = [];
    const d = new Date(periodStart);
    const today = new Date();
    while (d <= periodEnd && d <= today) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.push({
        label: `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`,
        spend: byDay[key] ?? 0,
      });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [periodTxns, periodStart, periodEnd]);

  const activeDays = days.filter((d) => d.spend > 0);
  const avg =
    activeDays.length > 0
      ? activeDays.reduce((s, d) => s + d.spend, 0) / activeDays.length
      : 0;

  if (!days.some((d) => d.spend > 0)) return <EmptyWidget dark={dark} />;

  const W = 320;
  const H = 144;
  const PAD = { top: 8, right: 8, bottom: 20, left: 4 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const maxSpend = Math.max(...days.map((d) => d.spend), avg * 1.2, 1);
  const barW = Math.max(4, Math.min(12, chartW / days.length - 2));

  const tickFill = dark ? tw.color.slate400 : tw.color.slate500;
  const refLineColor = tw.color.slate400; // #94a3b8 per spec
  const headText = dark ? tw.color.slate100 : tw.color.slate900;
  const subTone = dark ? tw.color.slate400 : tw.color.slate500;

  // Busiest day insight
  const busiest = activeDays.length > 0
    ? activeDays.reduce((best, d) => (d.spend > best.spend ? d : best), activeDays[0])
    : null;
  const ratio = busiest && avg > 0 ? (busiest.spend / avg).toFixed(1) : null;

  const avgY = PAD.top + chartH - (avg / maxSpend) * chartH;

  // tick positions: first, middle, last
  const tickIdxs = [0, Math.floor(days.length / 2), days.length - 1].filter(
    (v, i, a) => a.indexOf(v) === i
  );

  return (
    <View>
      {busiest && (
        <Text style={[styles.insightLine, { color: subTone }]}>
          <Text style={[styles.insightBold, { color: headText }]}>
            Busiest day: {busiest.label}
          </Text>
          {" · "}
          <Text style={[styles.insightBold, { color: headText }]}>
            {fmtGBP(busiest.spend)}
          </Text>
          {ratio && ` · ${ratio}× your daily average`}
        </Text>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Svg width={Math.max(W, days.length * (barW + 2) + PAD.left + PAD.right)} height={H}>
          {/* Bars */}
          {days.map((d, i) => {
            const x = PAD.left + i * ((chartW) / days.length) + (chartW / days.length - barW) / 2;
            const barH = d.spend > 0 ? (d.spend / maxSpend) * chartH : 0;
            const y = PAD.top + chartH - barH;
            return (
              <Rect
                key={i}
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={2}
                fill={d.spend <= 0 ? `${tw.color.indigo500}26` : tw.color.indigo500}
                onLongPress={() =>
                  setTooltip({ label: d.label, value: fmtGBP(d.spend), x })
                }
                onPressOut={() => setTooltip(null)}
              />
            );
          })}
          {/* Average reference line — slate-400 dashed per spec */}
          {avg > 0 && (
            <>
              <Line
                x1={PAD.left}
                y1={avgY}
                x2={W - PAD.right}
                y2={avgY}
                stroke={refLineColor}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <SvgText
                x={W - PAD.right - 2}
                y={avgY - 4}
                textAnchor="end"
                fontSize={9}
                fill={tickFill}
              >
                {`avg ${fmtGBP(Math.round(avg))}/day`}
              </SvgText>
            </>
          )}
          {/* X-axis ticks */}
          {tickIdxs.map((i) => {
            const d = days[i];
            if (!d) return null;
            const x = PAD.left + i * (chartW / days.length) + (chartW / days.length) / 2;
            return (
              <SvgText
                key={i}
                x={x}
                y={H - 4}
                textAnchor="middle"
                fontSize={9}
                fill={tickFill}
              >
                {d.label}
              </SvgText>
            );
          })}
        </Svg>
      </ScrollView>
      {tooltip && (
        <View style={styles.tooltip} pointerEvents="none">
          <Text style={styles.tooltipLabel}>{tooltip.label}</Text>
          <Text style={styles.tooltipValue}>{tooltip.value}</Text>
        </View>
      )}
    </View>
  );
}

// ── Period Compare ─────────────────────────────────────────────────────────────

interface PeriodBar {
  label: string;
  spend: number;
  current: boolean;
}

interface PeriodCompareWidgetProps {
  allTxns: Transaction[];
  periodStart: Date;
  periodEnd: Date;
  dark: boolean;
}

function PeriodCompareWidget({
  allTxns,
  periodStart,
  periodEnd,
  dark,
}: PeriodCompareWidgetProps) {
  const [tooltip, setTooltip] = useState<{ label: string; value: string } | null>(null);

  const periods = useMemo((): PeriodBar[] => {
    const out: PeriodBar[] = [];
    let start = periodStart;
    let end = periodEnd;
    for (let i = 0; i < 6; i++) {
      const txns = spendDebits(filterPeriod(allTxns, start, end));
      out.unshift({
        label: `${start.getDate()} ${MONTH_SHORT[start.getMonth()]}`,
        spend: txns.reduce((s, t) => s + Math.abs(t.amount), 0),
        current: i === 0,
      });
      const prev = prevPeriod(start);
      start = prev.start;
      end = prev.end;
    }
    while (out.length > 1 && out[0].spend === 0) out.shift();
    return out;
  }, [allTxns, periodStart, periodEnd]);

  const subTone = dark ? tw.color.slate400 : tw.color.slate500;
  const headText = dark ? tw.color.slate100 : tw.color.slate900;
  const tickFill = dark ? tw.color.slate400 : tw.color.slate500;

  if (periods.every((p) => p.spend === 0)) return <EmptyWidget dark={dark} />;

  const currentEntry = periods.find((p) => p.current) ?? periods[periods.length - 1];
  const currentIdx = periods.indexOf(currentEntry);
  const prevEntry = currentIdx > 0 ? periods[currentIdx - 1] : null;
  const delta = prevEntry && prevEntry.spend > 0 ? currentEntry.spend - prevEntry.spend : null;
  const absDelta = delta !== null ? Math.abs(delta) : null;
  const pct =
    delta !== null && prevEntry && prevEntry.spend > 0
      ? Math.round((Math.abs(delta) / prevEntry.spend) * 100)
      : null;

  const W = 320;
  const H = 160;
  const PAD = { top: 8, right: 40, bottom: 24, left: 4 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const maxSpend = Math.max(...periods.map((p) => p.spend), 1);
  const barW = Math.min(28, chartW / periods.length - 4);

  return (
    <View>
      {/* Insight line */}
      <Text style={[styles.insightLine, { color: subTone }]}>
        <Text style={[styles.insightBold, { color: headText }]}>
          {fmtGBP(currentEntry.spend)}
        </Text>
        {" this period"}
        {delta !== null && absDelta !== null && pct !== null && (
          delta > 0 ? (
            <Text style={{ color: tw.color.amber600 }}>
              {" · "}
              <Text style={[styles.insightBold, { color: tw.color.amber600 }]}>
                {fmtGBP(absDelta)}
              </Text>
              {` (${pct}%) more than last`}
            </Text>
          ) : delta < 0 ? (
            <Text style={{ color: tw.color.emerald600 }}>
              {" · "}
              <Text style={[styles.insightBold, { color: tw.color.emerald600 }]}>
                {fmtGBP(absDelta)}
              </Text>
              {` (${pct}%) less than last`}
            </Text>
          ) : null
        )}
      </Text>

      <Svg width={W} height={H}>
        {/* Y-axis labels */}
        {[0, 0.5, 1].map((frac) => {
          const val = maxSpend * frac;
          const y = PAD.top + chartH - frac * chartH;
          return (
            <SvgText
              key={frac}
              x={W - PAD.right + 4}
              y={y + 4}
              fontSize={9}
              fill={tickFill}
            >
              {fmtGBP(val)}
            </SvgText>
          );
        })}

        {/* Bars */}
        {periods.map((p, i) => {
          const x =
            PAD.left +
            i * (chartW / periods.length) +
            (chartW / periods.length - barW) / 2;
          const barH = (p.spend / maxSpend) * chartH;
          const y = PAD.top + chartH - barH;
          return (
            <G key={i}>
              <Rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={3}
                fill={p.current ? tw.color.indigo500 : tw.color.indigo200}
                onLongPress={() =>
                  setTooltip({ label: p.label, value: fmtGBP(p.spend) })
                }
                onPressOut={() => setTooltip(null)}
              />
              <SvgText
                x={x + barW / 2}
                y={H - 4}
                textAnchor="middle"
                fontSize={9}
                fill={tickFill}
              >
                {p.label}
              </SvgText>
            </G>
          );
        })}
      </Svg>

      {tooltip && (
        <View style={styles.tooltip} pointerEvents="none">
          <Text style={styles.tooltipLabel}>{tooltip.label}</Text>
          <Text style={styles.tooltipValue}>{tooltip.value}</Text>
        </View>
      )}
    </View>
  );
}

// ── Size Distribution ──────────────────────────────────────────────────────────

const SIZE_BANDS = [
  { label: "<£5", min: 0, max: 5 },
  { label: "£5–10", min: 5, max: 10 },
  { label: "£10–25", min: 10, max: 25 },
  { label: "£25–50", min: 25, max: 50 },
  { label: "£50–100", min: 50, max: 100 },
  { label: "£100–250", min: 100, max: 250 },
  { label: "£250+", min: 250, max: Infinity },
];

interface SizeBand {
  label: string;
  count: number;
  total: number;
}

interface SizeDistributionWidgetProps {
  periodTxns: Transaction[];
  dark: boolean;
  onReviewLarge?: () => void;
}

function SizeDistributionWidget({
  periodTxns,
  dark,
  onReviewLarge,
}: SizeDistributionWidgetProps) {
  const [mode, setMode] = useState<"spend" | "count">("spend");
  const [tooltip, setTooltip] = useState<{ label: string; value: string } | null>(null);

  const bands = useMemo((): SizeBand[] => {
    const totals = SIZE_BANDS.map((b) => ({ label: b.label, count: 0, total: 0 }));
    for (const t of spendDebits(periodTxns)) {
      const amt = Math.abs(t.amount);
      const idx = SIZE_BANDS.findIndex((b) => amt >= b.min && amt < b.max);
      if (idx >= 0) {
        totals[idx].count += 1;
        totals[idx].total += amt;
      }
    }
    return totals;
  }, [periodTxns]);

  if (bands.every((b) => b.count === 0)) return <EmptyWidget dark={dark} />;

  const largeBand = bands[bands.length - 1];
  const sumAll = bands.reduce((s, b) => s + b.total, 0);
  const largeCount = largeBand?.count ?? 0;
  const largePct = sumAll > 0 && largeBand ? Math.round((largeBand.total / sumAll) * 100) : 0;

  const W = 320;
  const H = 144;
  const PAD = { top: 8, right: 4, bottom: 24, left: 4 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const barW = chartW / bands.length - 4;

  const dataKey = mode === "spend" ? "total" : "count";
  const maxVal = Math.max(...bands.map((b) => b[dataKey]), 1);

  const tickFill = dark ? tw.color.slate400 : tw.color.slate500;
  const headText = dark ? tw.color.slate100 : tw.color.slate900;
  const subTone = dark ? tw.color.slate400 : tw.color.slate500;
  const segActiveBg = dark ? tw.color.slate600 : tw.color.slate200;
  const segActiveText = dark ? tw.color.slate100 : tw.color.slate900;
  const segInactiveText = dark ? tw.color.slate400 : tw.color.slate500;
  const segBorder = dark ? tw.color.slate600 : tw.color.slate200;

  return (
    <View>
      {/* Insight + toggle */}
      <View style={styles.sizeHeader}>
        <Text style={[styles.insightLine, { color: subTone, flex: 1 }]}>
          {largeCount === 0 ? (
            "No single payment over £250 this period"
          ) : (
            <>
              <Text style={[styles.insightBold, { color: headText }]}>
                {largeCount}
              </Text>
              {` ${largeCount === 1 ? "payment" : "payments"} over £250 · `}
              <Text style={[styles.insightBold, { color: headText }]}>
                {largePct}%
              </Text>
              {" of your spend"}
            </>
          )}
        </Text>

        {/* By spend / by count segmented toggle */}
        <View style={[styles.segToggle, { borderColor: segBorder }]}>
          <Pressable
            onPress={() => setMode("spend")}
            style={[
              styles.segOption,
              mode === "spend" && [styles.segOptionActive, { backgroundColor: segActiveBg }],
            ]}
          >
            <Text
              style={[
                styles.segOptionText,
                { color: mode === "spend" ? segActiveText : segInactiveText },
              ]}
            >
              By spend
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode("count")}
            style={[
              styles.segOption,
              mode === "count" && [styles.segOptionActive, { backgroundColor: segActiveBg }],
            ]}
          >
            <Text
              style={[
                styles.segOptionText,
                { color: mode === "count" ? segActiveText : segInactiveText },
              ]}
            >
              By count
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Review large button */}
      {largeCount > 0 && onReviewLarge && (
        <Pressable
          onPress={onReviewLarge}
          style={({ pressed }) => [
            styles.reviewBtn,
            { borderColor: dark ? tw.color.slate600 : tw.color.slate300, transform: [{ scale: pressed ? 0.97 : 1 }] },
          ]}
        >
          <Text style={[styles.reviewBtnText, { color: dark ? tw.color.slate200 : tw.color.slate700 }]}>
            Review large payments
          </Text>
        </Pressable>
      )}

      <Svg width={W} height={H}>
        {bands.map((b, i) => {
          const val = b[dataKey];
          const x = PAD.left + i * (chartW / bands.length) + (chartW / bands.length - barW) / 2;
          const barH = val > 0 ? (val / maxVal) * chartH : 0;
          const y = PAD.top + chartH - barH;
          return (
            <G key={i}>
              <Rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={3}
                fill={tw.color.indigo500}
                onLongPress={() =>
                  setTooltip({
                    label: b.label,
                    value: mode === "spend" ? fmtGBP(b.total) : `${b.count} payment${b.count !== 1 ? "s" : ""}`,
                  })
                }
                onPressOut={() => setTooltip(null)}
              />
              <SvgText
                x={x + barW / 2}
                y={H - 4}
                textAnchor="middle"
                fontSize={8}
                fill={tickFill}
              >
                {b.label}
              </SvgText>
            </G>
          );
        })}
      </Svg>

      {tooltip && (
        <View style={styles.tooltip} pointerEvents="none">
          <Text style={styles.tooltipLabel}>{tooltip.label}</Text>
          <Text style={styles.tooltipValue}>{tooltip.value}</Text>
        </View>
      )}
    </View>
  );
}

// ── Transport Modes ────────────────────────────────────────────────────────────

const TRANSPORT_ICON: Record<string, React.ReactNode> = {
  "Fuel":             <Fuel size={14} color="#fff" />,
  "Parking":          <SquareParking size={14} color="#fff" />,
  "Taxi & Rideshare": <CarTaxiFront size={14} color="#fff" />,
  "Rail":             <Train size={14} color="#fff" />,
  "TfL / Oyster":     <Train size={14} color="#fff" />,
  "Bus & Coach":      <Bus size={14} color="#fff" />,
  "EV Charging":      <Plug size={14} color="#fff" />,
  "Car Rental":       <Car size={14} color="#fff" />,
  "Car Care":         <Wrench size={14} color="#fff" />,
};

interface TransportModesWidgetProps {
  dark: boolean;
}

function TransportModesWidget({ dark }: TransportModesWidgetProps) {
  const [data, setData] = useState<TransportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    spendApi
      .transportSummary()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const subTone = dark ? tw.color.slate400 : tw.color.slate500;
  const headText = dark ? tw.color.slate100 : tw.color.slate900;
  const modeName = dark ? tw.color.slate200 : tw.color.slate700;
  const trackBg = dark ? tw.color.slate700 : tw.color.slate100;

  if (loading) return <EmptyWidget dark={dark} />;
  if (!data || data.total_spend === 0) return <EmptyWidget dark={dark} />;

  const total = data.total_spend;
  const carPct = total > 0 ? (data.car_total / total) * 100 : 0;
  const ridesharePct = total > 0 ? (data.rideshare_total / total) * 100 : 0;
  const ptPct = total > 0 ? (data.pt_total / total) * 100 : 0;
  const activeSplitGroups = [carPct, ridesharePct, ptPct].filter((p) => p > 0).length;
  const maxModeTotal = Math.max(...data.modes.map((m) => m.total), 1);

  return (
    <View style={styles.transportWrap}>
      {/* Hero */}
      <View>
        <Text
          style={[
            styles.transportHeroLabel,
            { color: subTone, letterSpacing: tw.tracking(tw.trackingEm.wide, 11) },
          ]}
        >
          TRANSPORT · 90 DAYS
        </Text>
        <Text style={[styles.transportHero, { color: headText }]}>
          {fmtGBP(data.monthly_avg)}
          <Text style={[styles.transportHeroSub, { color: tw.color.slate400 }]}>/mo</Text>
        </Text>
      </View>

      {/* Split bar */}
      {activeSplitGroups >= 2 && (
        <>
          <View style={styles.splitBar}>
            {carPct > 1 && (
              <View style={[styles.splitSegment, { width: `${carPct}%`, backgroundColor: tw.color.amber400 }]} />
            )}
            {ridesharePct > 1 && (
              <View style={[styles.splitSegment, { width: `${ridesharePct}%`, backgroundColor: "#3b82f6" }]} />
            )}
            {ptPct > 1 && (
              <View style={[styles.splitSegment, { width: `${ptPct}%`, backgroundColor: tw.color.violet500 }]} />
            )}
          </View>
          <View style={styles.splitLegend}>
            {carPct > 0 && (
              <View style={styles.splitLegendItem}>
                <View style={[styles.splitLegendDot, { backgroundColor: tw.color.amber400 }]} />
                <Text style={[styles.splitLegendText, { color: "#b45309" }]}>
                  Car · {Math.round(carPct)}%
                </Text>
              </View>
            )}
            {ridesharePct > 0 && (
              <View style={styles.splitLegendItem}>
                <View style={[styles.splitLegendDot, { backgroundColor: "#3b82f6" }]} />
                <Text style={[styles.splitLegendText, { color: "#1d4ed8" }]}>
                  Rideshare · {Math.round(ridesharePct)}%
                </Text>
              </View>
            )}
            {ptPct > 0 && (
              <View style={styles.splitLegendItem}>
                <View style={[styles.splitLegendDot, { backgroundColor: tw.color.violet500 }]} />
                <Text style={[styles.splitLegendText, { color: "#6d28d9" }]}>
                  Public · {Math.round(ptPct)}%
                </Text>
              </View>
            )}
          </View>
        </>
      )}

      {/* Mode rows */}
      <Text style={[styles.modeTitle, { color: headText }]}>Where it goes</Text>
      {data.modes.map((m) => {
        const w = Math.max(Math.round((m.total / maxModeTotal) * 100), 3);
        return (
          <View key={m.name} style={styles.modeRow}>
            <View style={[styles.modeIcon, { backgroundColor: m.colour }]}>
              {TRANSPORT_ICON[m.name] ?? <Car size={12} color="#fff" />}
            </View>
            <View style={styles.modeInfo}>
              <View style={styles.modeInfoTop}>
                <Text style={[styles.modeName, { color: modeName }]} numberOfLines={1}>
                  {m.name}
                </Text>
                <Text style={[styles.modeAmt, { color: headText }]}>
                  {fmtGBP(m.monthly)}
                  <Text style={[styles.modeAmtSub, { color: tw.color.slate400 }]}>/mo</Text>
                </Text>
              </View>
              <View style={[styles.modeBar, { backgroundColor: trackBg }]}>
                <View
                  style={[styles.modeBarFill, { width: `${w}%`, backgroundColor: m.colour }]}
                />
              </View>
            </View>
            <Text style={[styles.modePct, { color: dark ? tw.color.slate500 : tw.color.slate400 }]}>
              {Math.round(m.pct)}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Empty widget ───────────────────────────────────────────────────────────────

function EmptyWidget({ dark }: { dark: boolean }) {
  return (
    <View style={styles.emptyWidget}>
      <Text style={[styles.emptyWidgetText, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
        No spending in this period
      </Text>
    </View>
  );
}

// ── Widget card chrome ─────────────────────────────────────────────────────────

type WidgetId =
  | "category_pie"
  | "daily_bars"
  | "period_compare"
  | "size_distribution"
  | "transport_modes";

const DEFAULT_WIDGETS: WidgetId[] = ["category_pie", "daily_bars"];

const WIDGET_META: Record<WidgetId, { title: string; description: string }> = {
  category_pie:      { title: "Category breakdown", description: "Where this period's spend went, as a donut" },
  daily_bars:        { title: "Daily spend",        description: "How much you spent each day this period" },
  period_compare:    { title: "Period comparison",  description: "Total spend across your last six pay periods" },
  size_distribution: { title: "Transaction sizes",  description: "How many transactions fall in each price band" },
  transport_modes:   { title: "Transport by mode",  description: "Where your transport spend goes" },
};

const ALL_WIDGETS = Object.keys(WIDGET_META) as WidgetId[];

// ── SpendTrends (main export) ──────────────────────────────────────────────────

interface SpendTrendsProps {
  periodTxns: Transaction[];
  allTxns: Transaction[];
  periodStart: Date;
  periodEnd: Date;
  colours: Record<string, string>;
  dark: boolean;
  onReviewLarge?: () => void;
}

export function SpendTrends({
  periodTxns,
  allTxns,
  periodStart,
  periodEnd,
  colours,
  dark,
  onReviewLarge,
}: SpendTrendsProps) {
  const [widgets, setWidgets] = useState<WidgetId[]>(DEFAULT_WIDGETS);
  const [galleryOpen, setGalleryOpen] = useState(false);

  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const headText = dark ? tw.color.slate100 : tw.color.slate800;
  const subTone = dark ? tw.color.slate400 : tw.color.slate500;
  const dashed = dark ? tw.color.slate700 : tw.color.slate200;

  function removeWidget(id: WidgetId) {
    setWidgets((prev) => prev.filter((w) => w !== id));
  }

  function addWidget(id: WidgetId) {
    setWidgets((prev) => [...prev, id]);
    setGalleryOpen(false);
  }

  const available = ALL_WIDGETS.filter((w) => !widgets.includes(w));

  function renderWidgetContent(id: WidgetId) {
    switch (id) {
      case "category_pie":
        return (
          <CategoryPieWidget
            periodTxns={periodTxns}
            colours={colours}
            dark={dark}
          />
        );
      case "daily_bars":
        return (
          <DailyBarsWidget
            periodTxns={periodTxns}
            periodStart={periodStart}
            periodEnd={periodEnd}
            dark={dark}
          />
        );
      case "period_compare":
        return (
          <PeriodCompareWidget
            allTxns={allTxns}
            periodStart={periodStart}
            periodEnd={periodEnd}
            dark={dark}
          />
        );
      case "size_distribution":
        return (
          <SizeDistributionWidget
            periodTxns={periodTxns}
            dark={dark}
            onReviewLarge={onReviewLarge}
          />
        );
      case "transport_modes":
        return <TransportModesWidget dark={dark} />;
    }
  }

  return (
    <View style={styles.trendsWrap}>
      {widgets.length === 0 && (
        <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor }]}>
          <Text style={[styles.emptyText, { color: subTone }]}>
            No charts yet — add one below to start visualising your spending.
          </Text>
        </View>
      )}

      {widgets.map((id) => (
        <View
          key={id}
          style={[styles.widgetCard, { backgroundColor: cardBg, borderColor }]}
        >
          {/* Widget header */}
          <View style={styles.widgetHeader}>
            <Text style={[styles.widgetTitle, { color: headText }]}>
              {WIDGET_META[id].title}
            </Text>
            <Pressable
              onPress={() => removeWidget(id)}
              hitSlop={8}
              style={({ pressed }) => [
                styles.removeBtn,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.removeBtnText, { color: subTone }]}>Remove</Text>
            </Pressable>
          </View>
          {renderWidgetContent(id)}
        </View>
      ))}

      {/* Add widget button */}
      {available.length > 0 && (
        <Pressable
          onPress={() => setGalleryOpen(true)}
          style={({ pressed }) => [
            styles.addWidgetBtn,
            { borderColor: dashed, transform: [{ scale: pressed ? 0.98 : 1 }] },
          ]}
        >
          <Plus size={14} color={subTone} />
          <Text style={[styles.addWidgetText, { color: subTone }]}>Add widget</Text>
        </Pressable>
      )}

      {/* Widget gallery */}
      {galleryOpen && (
        <View style={[styles.galleryCard, { backgroundColor: cardBg, borderColor }]}>
          <Text style={[styles.galleryTitle, { color: headText }]}>Add a widget</Text>
          <Text style={[styles.gallerySub, { color: subTone }]}>
            Charts use the pay period you're viewing.
          </Text>
          <View style={styles.galleryList}>
            {available.map((id) => (
              <Pressable
                key={id}
                onPress={() => addWidget(id)}
                style={({ pressed }) => [
                  styles.galleryItem,
                  {
                    backgroundColor: dark ? "rgba(51,65,85,0.5)" : tw.color.slate50,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  },
                ]}
              >
                <View
                  style={[
                    styles.galleryItemIcon,
                    { backgroundColor: dark ? "rgba(79,70,229,0.3)" : tw.color.indigo50 },
                  ]}
                >
                  <BarChart3 size={16} color={tw.color.indigo500} />
                </View>
                <View style={styles.galleryItemInfo}>
                  <Text style={[styles.galleryItemTitle, { color: headText }]}>
                    {WIDGET_META[id].title}
                  </Text>
                  <Text style={[styles.galleryItemDesc, { color: subTone }]}>
                    {WIDGET_META[id].description}
                  </Text>
                </View>
                <Plus size={15} color={dark ? tw.color.slate500 : tw.color.slate300} />
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => setGalleryOpen(false)}
            style={styles.galleryClose}
          >
            <Text style={[styles.galleryCloseText, { color: subTone }]}>Close</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  trendsWrap: {
    paddingHorizontal: tw.space[4],
    paddingTop: tw.space[4],
    gap: tw.space[3],
  },
  widgetCard: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    borderWidth: 1,
  },
  widgetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: tw.space[3],
  },
  widgetTitle: {
    fontSize: tw.text.base.fontSize,
    lineHeight: tw.text.base.lineHeight,
    fontWeight: tw.weight.bold,
  },
  removeBtn: {},
  removeBtnText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.medium,
  },
  emptyCard: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[8],
    borderWidth: 1,
    alignItems: "center",
  },
  emptyText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    textAlign: "center",
  },
  addWidgetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: tw.radius["2xl"],
    borderWidth: 2,
    borderStyle: "dashed",
  },
  addWidgetText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  galleryCard: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[5],
    borderWidth: 1,
  },
  galleryTitle: {
    fontSize: tw.text.base.fontSize,
    lineHeight: tw.text.base.lineHeight,
    fontWeight: tw.weight.bold,
    marginBottom: 4,
  },
  gallerySub: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    marginBottom: tw.space[4],
  },
  galleryList: {
    gap: tw.space[2],
  },
  galleryItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    padding: tw.space[3],
    borderRadius: tw.radius["2xl"],
  },
  galleryItemIcon: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  galleryItemInfo: {
    flex: 1,
    minWidth: 0,
  },
  galleryItemTitle: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  galleryItemDesc: {
    fontSize: 11,
    lineHeight: 16,
  },
  galleryClose: {
    marginTop: tw.space[4],
    alignItems: "center",
  },
  galleryCloseText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
  },
  // Pie chart
  pieRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
  },
  pieTooltip: {
    position: "absolute",
    top: "30%",
    left: "10%",
    right: "10%",
    backgroundColor: "rgba(15,23,42,0.92)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
  },
  legend: {
    flex: 1,
    gap: 6,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: tw.radius.full,
    flexShrink: 0,
  },
  legendName: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    flex: 1,
  },
  legendPct: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  legendMore: {
    fontSize: 11,
    lineHeight: 16,
    paddingLeft: 16,
  },
  // Tooltip (shared)
  tooltip: {
    position: "absolute",
    bottom: "100%",
    left: 0,
    right: 0,
    backgroundColor: "rgba(15,23,42,0.92)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
    zIndex: 10,
  },
  tooltipLabel: {
    fontSize: 11,
    lineHeight: 16,
    color: tw.color.slate400,
  },
  tooltipValue: {
    fontSize: 11,
    lineHeight: 16,
    color: "#f1f5f9",
    fontWeight: tw.weight.semibold,
  },
  // Insight lines (daily/compare)
  insightLine: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    marginBottom: tw.space[3],
  },
  insightBold: {
    fontWeight: tw.weight.bold,
  },
  // Size distribution
  sizeHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tw.space[3],
    marginBottom: tw.space[2],
  },
  segToggle: {
    flexDirection: "row",
    borderRadius: tw.radius.full,
    borderWidth: 1,
    overflow: "hidden",
    flexShrink: 0,
  },
  segOption: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  segOptionActive: {},
  segOptionText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: tw.weight.semibold,
  },
  reviewBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: tw.space[4],
    paddingVertical: 6,
    borderRadius: tw.radius.full,
    borderWidth: 1,
    marginBottom: tw.space[3],
  },
  reviewBtnText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  // Transport
  transportWrap: {
    gap: tw.space[3],
  },
  transportHeroLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: tw.weight.semibold,
    marginBottom: 4,
  },
  transportHero: {
    fontSize: tw.text["2xl"].fontSize,
    lineHeight: tw.text["2xl"].lineHeight,
    fontWeight: tw.weight.bold,
  },
  transportHeroSub: {
    fontSize: tw.text.sm.fontSize,
    fontWeight: "400",
  },
  splitBar: {
    height: 8,
    borderRadius: tw.radius.full,
    overflow: "hidden",
    flexDirection: "row",
    gap: 1,
  },
  splitSegment: {
    height: "100%",
  },
  splitLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tw.space[3],
  },
  splitLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  splitLegendDot: {
    width: 8,
    height: 8,
    borderRadius: tw.radius.full,
    flexShrink: 0,
  },
  splitLegendText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: tw.weight.medium,
  },
  modeTitle: {
    fontSize: tw.text.base.fontSize,
    lineHeight: tw.text.base.lineHeight,
    fontWeight: tw.weight.bold,
  },
  modeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
  },
  modeIcon: {
    width: 28,
    height: 28,
    borderRadius: tw.radius.lg,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  modeInfo: {
    flex: 1,
    minWidth: 0,
  },
  modeInfoTop: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  modeName: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.medium,
    flex: 1,
  },
  modeAmt: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    marginLeft: tw.space[2],
    flexShrink: 0,
  },
  modeAmtSub: {
    fontSize: 11,
    fontWeight: "400",
  },
  modeBar: {
    height: 6,
    width: "100%",
    borderRadius: tw.radius.full,
    overflow: "hidden",
  },
  modeBarFill: {
    height: "100%",
    borderRadius: tw.radius.full,
  },
  modePct: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: tw.weight.medium,
    width: 24,
    textAlign: "right",
    flexShrink: 0,
  },
  // Empty widget
  emptyWidget: {
    height: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyWidgetText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
  },
});
