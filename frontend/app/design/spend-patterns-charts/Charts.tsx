import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type Period = { label: string; value: number | null };
type SizeBand = { label: string; count: number; total: number };

const GRID = "#e2e8f0";

function pounds(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}

/** A stable four-interval ceiling keeps comparable chart scales easy to read. */
export function niceCeiling(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 4;
  const rawInterval = value / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawInterval));
  const fraction = rawInterval / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return niceFraction * magnitude * 4;
}

function ChartHidden() {
  return <div className="flex min-h-[190px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">Figures hidden</div>;
}

function ChartDetails({ children, label = "Show figures as a table" }: { children: ReactNode; label?: string }) {
  return <details className="group mt-2 border-t border-slate-200 dark:border-slate-700">
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[12px] font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 [&::-webkit-details-marker]:hidden">
      {label}
      <ChevronDown aria-hidden="true" size={16} className="shrink-0 text-slate-500 transition-transform motion-reduce:transition-none group-open:rotate-180 dark:text-slate-400" />
    </summary>
    <div className="overflow-x-auto pb-2">{children}</div>
  </details>;
}

function MoneyCell({ value }: { value: number }) {
  return <span className="font-mono tabular-nums">{pounds(value, 2)}</span>;
}

export function DailyChart({ values, hidden }: { values: number[]; hidden: boolean }) {
  if (hidden) return <ChartHidden />;

  const safeValues = values.map(value => Number.isFinite(value) && value > 0 ? value : 0);
  const ceiling = niceCeiling(Math.max(...safeValues, 0));
  const width = 320;
  const height = 190;
  const plot = { left: 68, right: 10, top: 14, bottom: 32 };
  const innerWidth = width - plot.left - plot.right;
  const innerHeight = height - plot.top - plot.bottom;
  const baseline = plot.top + innerHeight;
  const step = safeValues.length > 1 ? innerWidth / (safeValues.length - 1) : 0;
  const barWidth = Math.max(3, Math.min(6, innerWidth / Math.max(safeValues.length, 1) - 2));
  const labels = [[0, "1 Oct"], [14, "15 Oct"], [29, "30 Oct"]] as const;

  return <figure className="min-w-0">
    <figcaption className="mb-2 text-[12px] text-slate-600 dark:text-slate-300">Daily spending <span className="font-mono tabular-nums">£0–{pounds(ceiling)}</span> scale.</figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-hidden="true" focusable="false" className="block w-full max-w-[480px] mx-auto overflow-visible" preserveAspectRatio="xMidYMid meet">
      {[0, 1, 2, 3, 4].map(interval => {
        const y = plot.top + (innerHeight * interval / 4);
        const tick = ceiling - (ceiling * interval / 4);
        return <g key={interval}>
          <line x1={plot.left} x2={width - plot.right} y1={y} y2={y} stroke={GRID} className="dark:stroke-slate-700" strokeWidth="1" />
          <text x={plot.left - 7} y={y + 4} textAnchor="end" className="fill-slate-600 font-mono text-[12px] tabular-nums dark:fill-slate-300">{pounds(tick)}</text>
        </g>;
      })}
      {safeValues.map((value, index) => {
        const x = plot.left + (index * step) - barWidth / 2;
        const barHeight = value / ceiling * innerHeight;
        return <rect key={index} x={x} y={baseline - barHeight} width={barWidth} height={barHeight} rx="1.5" className="fill-indigo-600 dark:fill-indigo-400" />;
      })}
      {labels.map(([index, label]) => {
        const x = plot.left + Math.min(index, Math.max(0, safeValues.length - 1)) * step;
        return <text key={label} x={x} y={height - 8} textAnchor={index === 0 ? "start" : index === 29 ? "end" : "middle"} className="fill-slate-600 text-[12px] dark:fill-slate-300">{label}</text>;
      })}
    </svg>
    <ChartDetails label="Show daily figures as a table">
      <table className="w-full min-w-[220px] text-left text-xs">
        <caption className="sr-only">Daily spending figures</caption>
        <thead className="text-[11px] uppercase tracking-wide text-slate-600 dark:text-slate-300"><tr><th scope="col" className="py-2 font-semibold">Day</th><th scope="col" className="py-2 text-right font-semibold">Spent</th></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">{safeValues.map((value, index) => <tr key={index}><th scope="row" className="py-2 font-medium text-slate-700 dark:text-slate-200">{index + 1} Oct</th><td className="py-2 text-right text-slate-900 dark:text-slate-100"><MoneyCell value={value} /></td></tr>)}</tbody>
      </table>
    </ChartDetails>
  </figure>;
}

export function PeriodChart({ periods, hidden, caption = "Spending by period", tableLabel = "Show pay-period figures as a table" }: { periods: Period[]; hidden: boolean; caption?: ReactNode; tableLabel?: string }) {
  if (hidden) return <ChartHidden />;
  const values = periods.flatMap(period => period.value === null || !Number.isFinite(period.value) ? [] : [Math.max(period.value, 0)]);
  const ceiling = niceCeiling(Math.max(...values, 0));
  return <figure className="min-w-0">
    <figcaption className="mb-3 text-[12px] text-slate-600 dark:text-slate-300">{caption} <span className="font-mono tabular-nums">£0–{pounds(ceiling)}</span> scale.</figcaption>
    <div className="space-y-4">{periods.map(period => <div key={period.label}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]"><span className="min-w-0 truncate font-medium text-slate-700 dark:text-slate-200">{period.label}</span><span className="shrink-0 font-mono tabular-nums text-slate-900 dark:text-slate-100">{period.value === null ? "No data" : pounds(period.value, 2)}</span></div>
      {period.value !== null && <div className="mt-1.5 h-3 overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-sm bg-indigo-600 dark:bg-indigo-400" style={{ width: `${Math.min(100, Math.max(0, period.value) / ceiling * 100)}%` }} /></div>}
    </div>)}</div>
    <div aria-hidden="true" className="relative mt-2 h-5 text-[12px] font-mono tabular-nums text-slate-600 dark:text-slate-300">{[0, 1, 2, 3, 4].map(interval => { const tick = ceiling * interval / 4; return <span key={interval} className="absolute whitespace-nowrap" style={{ left: `${interval * 25}%`, transform: `translateX(${interval === 0 ? 0 : interval === 4 ? -100 : -50}%)` }}>{tick >= 1000 ? `£${tick / 1000}k` : pounds(tick)}</span>; })}</div>
    <ChartDetails label={tableLabel}>
      <table className="w-full text-left text-xs"><caption className="sr-only">{tableLabel}</caption><thead className="text-[11px] uppercase tracking-wide text-slate-600 dark:text-slate-300"><tr><th scope="col" className="py-2 font-semibold">Period</th><th scope="col" className="py-2 text-right font-semibold">Spent</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{periods.map(period => <tr key={period.label}><th scope="row" className="py-2 font-medium text-slate-700 dark:text-slate-200">{period.label}</th><td className="py-2 text-right text-slate-900 dark:text-slate-100">{period.value === null ? "No data" : <MoneyCell value={period.value} />}</td></tr>)}</tbody></table>
    </ChartDetails>
  </figure>;
}

export function SizeChart({ bands, hidden }: { bands: SizeBand[]; hidden: boolean }) {
  if (hidden) return <ChartHidden />;
  const maximum = Math.max(...bands.map(band => Math.max(0, band.count)), 1);
  return <figure className="min-w-0">
    <figcaption className="mb-3 text-[12px] text-slate-600 dark:text-slate-300">Number of transactions by spending size.</figcaption>
    <div className="space-y-4">{bands.map(band => <div key={band.label}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]"><span className="min-w-0 truncate font-mono tabular-nums text-slate-700 dark:text-slate-200">{band.label}</span><span className="shrink-0 tabular-nums text-slate-900 dark:text-slate-100">{band.count}</span></div>
      <div className="mt-1.5 h-3 overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-sm bg-indigo-600 dark:bg-indigo-400" style={{ width: `${Math.min(100, Math.max(0, band.count) / maximum * 100)}%` }} /></div>
    </div>)}</div>
    <ChartDetails label="Show spending-size figures as a table">
      <table className="w-full text-left text-xs"><caption className="sr-only">Transaction count and spend totals by size</caption><thead className="text-[11px] uppercase tracking-wide text-slate-600 dark:text-slate-300"><tr><th scope="col" className="py-2 font-semibold">Spending size</th><th scope="col" className="py-2 text-right font-semibold">Transactions</th><th scope="col" className="py-2 text-right font-semibold">Total</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{bands.map(band => <tr key={band.label}><th scope="row" className="py-2 font-mono font-medium tabular-nums text-slate-700 dark:text-slate-200">{band.label}</th><td className="py-2 text-right tabular-nums text-slate-900 dark:text-slate-100">{band.count}</td><td className="py-2 text-right text-slate-900 dark:text-slate-100"><MoneyCell value={band.total} /></td></tr>)}</tbody></table>
    </ChartDetails>
  </figure>;
}
