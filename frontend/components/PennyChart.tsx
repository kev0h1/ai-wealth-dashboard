"use client";

import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useColours } from "@/components/ColourProvider";
import PennyTable from "@/components/PennyTable";
import { useIsDark } from "@/lib/useIsDark";
import {
  chartColour, chartRows, chartToTable, formatChartValue, normalisePennyChart,
  type PennyChartSpec,
} from "@/lib/pennyChart";

/**
 * G252: a chart inside Penny's reply, drawn from data with the library the
 * Spend charts use (recharts), in their style: thin rounded marks, recessive
 * grid, 9-10px mono ticks, the dark tap-for-value tooltip, category colours
 * from the app palette (user overrides win). Static by default: no animation
 * gates visibility. The server-written summary sits above the chart, the chart
 * is described to assistive tech by that same sentence, and "Show as table"
 * swaps in the G251 table of the same numbers. Colour is information: the
 * Penny gradient and red are never used here. Every value is React text.
 */
const SURFACE = "bg-white dark:bg-slate-800";
const TIP = {
  backgroundColor: "rgba(15,23,42,0.92)", color: "#f1f5f9", borderRadius: 10, padding: "6px 10px", fontSize: 11,
} as const;
const MONO = "var(--font-jbmono), monospace";

function Tip({ spec, active, payload, label }: { spec: PennyChartSpec; active?: boolean; payload?: ReadonlyArray<{ value?: unknown; name?: unknown; color?: string; dataKey?: unknown; payload?: { label?: string } }>; label?: unknown }) {
  if (!active || !payload || payload.length === 0) return null;
  const head = spec.type === "donut" ? null : String(payload[0]?.payload?.label ?? label ?? "");
  return (
    <div style={TIP} data-penny-chart-tip>
      {head && <div style={{ opacity: 0.8, marginBottom: 2 }}>{head}</div>}
      {payload.map((p, i) => {
        if (typeof p.value !== "number") return null;
        const idx = typeof p.dataKey === "string" && /^s\d+$/.test(p.dataKey) ? Number(p.dataKey.slice(1)) : 0;
        const name = spec.type === "donut" ? String(p.name ?? "") : spec.series.length > 1 ? spec.series[idx]?.name : null;
        return (
          <div key={i} className="flex items-center gap-1.5">
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: p.color, display: "inline-block" }} />
            {name && <span>{name}</span>}
            <span className={spec.y.unit === "money" ? "money" : "num"} style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
              {formatChartValue(spec, p.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const MONTH_YEAR = /^([A-Z][a-z]{2}) (\d{4})$/;

/** Axis text: "Aug 2026" labels become "Aug", with the year ("Aug 26") only on
 * the first tick and where the year changes, so six months fit at 390px. */
function tickLabels(rows: { label: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  const parsed = rows.map((r) => MONTH_YEAR.exec(r.label));
  const allMonths = parsed.length > 0 && parsed.every(Boolean);
  let prevYear = "";
  rows.forEach((r, i) => {
    const m = parsed[i];
    if (!allMonths || !m) { out[r.label] = r.label; return; }
    out[r.label] = m[2] === prevYear ? m[1] : `${m[1]} ${m[2].slice(2)}`;
    prevYear = m[2];
  });
  return out;
}

function axisWidth(spec: PennyChartSpec, max: number, min: number): number {
  const widest = Math.max(formatChartValue(spec, max, true).length, formatChartValue(spec, min, true).length);
  return Math.max(34, Math.ceil(widest * 5.6) + 10);
}

/** The chart itself. `size` is only for the node check, which renders it
 * without a browser to measure; in the app the ResponsiveContainer sizes it. */
export function PennyChartPlot({ spec, dark, overrides, size }: { spec: PennyChartSpec; dark: boolean; overrides: Record<string, string>; size?: { width: number; height: number } }) {
  const tick = dark ? "#94a3b8" : "#64748b";
  const grid = dark ? "#334155" : "#e2e8f0";
  const surface = dark ? "#1e293b" : "#ffffff";
  const rows = useMemo(() => chartRows(spec), [spec]);
  const colours = spec.series.map((s, i) => chartColour(spec, s.name, i, dark, overrides));
  if (spec.type === "donut") {
    const pts = spec.series[0].points;
    return (
      <PieChart {...size}>
        <Pie data={pts.map((p) => ({ name: p.x, value: p.y }))} dataKey="value" nameKey="name" innerRadius={34} outerRadius={54}
          paddingAngle={2.5} cornerRadius={3} stroke="none" isAnimationActive={false}>
          {pts.map((p, i) => <Cell key={p.x} fill={chartColour(spec, p.x, i, dark, overrides)} />)}
        </Pie>
        <Tooltip trigger="click" content={(props) => <Tip spec={spec} {...(props as object)} />} />
      </PieChart>
    );
  }
  const all = spec.series.flatMap((s) => s.points.map((p) => p.y));
  const stackTotals = spec.type === "stacked_bar" ? rows.map((r) => spec.series.reduce((t, _, i) => t + (Number(r[`s${i}`]) || 0), 0)) : [];
  const max = Math.max(0, ...all, ...stackTotals);
  const min = Math.min(0, ...all);
  const ticks = tickLabels(rows);
  const common = { ...size, data: rows, margin: { top: 6, right: 6, bottom: 0, left: 0 } };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={grid} strokeWidth={1} />
      <XAxis dataKey="label" tickLine={false} axisLine={false} interval={rows.length > 6 ? "preserveStartEnd" : 0}
        tick={{ fontSize: 10, fill: tick }} minTickGap={14} tickFormatter={(l: string) => ticks[l] ?? l} />
      <YAxis tickLine={false} axisLine={false} width={axisWidth(spec, max, min)} domain={[min < 0 ? "auto" : 0, "auto"]}
        tick={{ fontSize: 9, fill: tick, fontFamily: spec.y.unit === "money" ? MONO : undefined }}
        tickFormatter={(v: number) => formatChartValue(spec, v, true)} />
      {min < 0 && <ReferenceLine y={0} stroke={tick} strokeOpacity={0.5} />}
      <Tooltip trigger="click" cursor={{ fill: "rgba(100,116,139,0.08)", stroke: "none" }} content={(props) => <Tip spec={spec} {...(props as object)} />} />
    </>
  );
  if (spec.type === "line") {
    return (
      <LineChart {...common}>
        {axes}
        {spec.series.map((s, i) => (
          <Line key={s.name} dataKey={`s${i}`} name={s.name} type="linear" stroke={colours[i]} strokeWidth={2}
            dot={rows.length <= 12 ? { r: 4, fill: colours[i], stroke: surface, strokeWidth: 2 } : false}
            activeDot={{ r: 5, fill: colours[i], stroke: surface, strokeWidth: 2 }} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    );
  }
  const stacked = spec.type === "stacked_bar";
  return (
    <BarChart {...common} barCategoryGap={rows.length > 12 ? "12%" : "28%"}>
      {axes}
      {spec.series.map((s, i) => (
        <Bar key={s.name} dataKey={`s${i}`} name={s.name} fill={colours[i]} maxBarSize={28} isAnimationActive={false}
          {...(stacked ? { stackId: "a", stroke: surface, strokeWidth: 2 } : {})}
          radius={stacked ? (i === spec.series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]} />
      ))}
    </BarChart>
  );
}

function Legend({ spec, dark, overrides }: { spec: PennyChartSpec; dark: boolean; overrides: Record<string, string> }) {
  const donut = spec.type === "donut";
  const items = donut
    ? spec.series[0].points.map((p, i) => ({ key: p.x, name: p.x, value: p.y, colour: chartColour(spec, p.x, i, dark, overrides) }))
    : spec.series.map((s, i) => ({ key: s.name, name: s.name, value: null as number | null, colour: chartColour(spec, s.name, i, dark, overrides) }));
  if (!donut && items.length < 2) return null; // one series: the title names it
  const total = donut ? items.reduce((t, x) => t + (x.value ?? 0), 0) : 0;
  return (
    <ul className={donut ? "m-0 min-w-0 flex-1 list-none space-y-1.5 p-0" : "m-0 mt-1 flex list-none flex-wrap gap-x-3 gap-y-1 p-0"} data-penny-chart-legend>
      {items.map((it) => (
        <li key={it.key} className="flex min-w-0 items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: it.colour }} />
          <span className="min-w-0 flex-1 truncate">{it.name}</span>
          {it.value !== null && (
            <span className="shrink-0 text-slate-800 dark:text-slate-100">
              <span className={spec.y.unit === "money" ? "money" : "num"}>{formatChartValue(spec, it.value)}</span>
              <span className="num ml-1.5 text-slate-500 dark:text-slate-400">{total ? Math.round((100 * it.value) / total) : 0}%</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function PennyChart({ chart }: { chart: PennyChartSpec }) {
  const [asTable, setAsTable] = useState(false);
  const dark = useIsDark();
  const { colours } = useColours();
  const spec = useMemo(() => normalisePennyChart(chart), [chart]);
  const table = useMemo(() => (spec ? chartToTable(spec) : null), [spec]);
  if (!spec) return null;
  const donut = spec.type === "donut";
  // The title already captions the figure, so the sentence under it drops the
  // "Title: " lead the server writes (the full sentence still labels the chart).
  const lead = `${spec.title}: `;
  const shown = spec.summary.startsWith(lead) && spec.summary.length > lead.length
    ? spec.summary.charAt(lead.length).toUpperCase() + spec.summary.slice(lead.length + 1)
    : spec.summary;
  return (
    <figure className="mt-2.5 mb-0 min-w-0" data-penny-chart data-chart-type={spec.type}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400 break-words">
        {spec.title}
      </p>
      <p className="mb-1.5 text-[13px] leading-snug text-slate-700 dark:text-slate-200 break-words" data-penny-chart-summary>{shown}</p>
      {asTable && table ? (
        <PennyTable table={table} />
      ) : (
        <div className={`rounded-xl border border-slate-200 p-2 dark:border-slate-600 ${SURFACE}`}>
          <div role="img" aria-label={spec.summary} className={donut ? "flex items-center gap-3" : ""}>
            <div className={donut ? "h-[112px] w-[112px] shrink-0" : "h-[200px] w-full"}>
              <ResponsiveContainer width="100%" height="100%" initialDimension={donut ? { width: 112, height: 112 } : { width: 300, height: 200 }}>
                <PennyChartPlot spec={spec} dark={dark} overrides={colours} />
              </ResponsiveContainer>
            </div>
            {donut && <Legend spec={spec} dark={dark} overrides={colours} />}
          </div>
          {!donut && <Legend spec={spec} dark={dark} overrides={colours} />}
        </div>
      )}
      {table && (
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
          className="mt-1.5 min-h-11 rounded-full border border-slate-300 bg-transparent px-4 text-[13px] font-semibold text-slate-700 transition-[background-color,transform] hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {asTable ? "Show as chart" : "Show as table"}
        </button>
      )}
      {spec.note && !asTable && (
        <figcaption className="mt-1 text-[12px] leading-snug text-slate-500 dark:text-slate-400 break-words">{spec.note}</figcaption>
      )}
    </figure>
  );
}
