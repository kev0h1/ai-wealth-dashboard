// G271: types, copy and pure helpers for the portfolio growth surfaces.
// The server owns every figure (GET /investment/accounts/{id}/growth); this
// file only formats and lays out what it returns.

export type GrowthRange = "1m" | "3m" | "6m" | "1y" | "all";

export const GROWTH_RANGES: { value: GrowthRange; label: string }[] = [
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" },
];

/** paid_in is null when only some holdings have a known cost (no paid-in line is drawn). */
export interface GrowthPoint { date: string; value: number; paid_in: number | null }

export interface GrowthHolding {
  id: string;
  name: string | null;
  isin: string | null;
  type: string;
  value: number;
  statement_value: number;
  change_abs: number | null;
  change_pct: number | null;
  /** G277: what was paid, from a statement's book cost or contract notes; null is Cost not known. */
  cost: number | null;
  cost_source: "statement" | "contract_notes" | null;
  gain_abs: number | null;
  gain_pct: number | null;
  price_date: string | null;
}

export interface InvestmentGrowth {
  account_id: string;
  currency: string;
  range: GrowthRange;
  method: "simple";
  method_label: string;
  statement_date: string | null;
  points: GrowthPoint[];
  since: string | null;
  as_of: string | null;
  value: number | null;
  paid_in: number | null;
  growth_abs: number | null;
  growth_pct: number | null;
  holdings_with_cost: number;
  holdings_total: number;
  /** "over 2 of 3 holdings" when only some holdings have a known cost. */
  cost_coverage: string | null;
  holdings: GrowthHolding[];
}

/** The three risk lines, verbatim, on every growth surface. */
export const RISK_LINES = [
  "Capital at risk.",
  "Past performance is not a guide to future returns.",
  "Prices are end of day and may be delayed.",
] as const;

export const METHOD_NOTE = "Growth is simple: what each holding is worth now minus what you paid for it. Cost comes from your contract notes and from the book cost on a statement, where it shows one. A holding with no known cost adds nothing to the gain.";

export const COST_UNKNOWN = "Cost not known";
export const SIMPLE_GAIN_NOTE = "Simple gain, not a time-weighted return.";
export const CHART_WAITING = "Chart fills in as daily prices arrive.";
export const NO_COST_LINE = "Growth shows once we know what was paid. Add a contract note, or a statement that shows book cost.";

/** G277: the card shows at once when any holding has a known cost. It never
 *  waits for two daily snapshots. */
export function hasKnownCost(g: InvestmentGrowth | null): boolean {
  return !!g && g.growth_abs !== null && g.paid_in !== null;
}

/** A chart needs two points; until then one quiet line stands in. */
export function chartReady(points: GrowthPoint[]): boolean {
  return points.length >= 2;
}

export function showsPaidLine(points: GrowthPoint[]): boolean {
  return points.length > 0 && points.every((p) => p.paid_in !== null);
}

const MINUS = "−";

/** £1,234.56, with the currency minus kept (−£) and an optional leading +. */
export function money(n: number, opts: { sign?: boolean; hidden?: boolean } = {}): string {
  if (opts.hidden) return "£••••";
  const body = `£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (n < 0 && Math.abs(n) >= 0.005) return `${MINUS}${body}`;
  if (opts.sign && n >= 0.005) return `+${body}`;
  return body;
}

export function percent(n: number, opts: { hidden?: boolean } = {}): string {
  if (opts.hidden) return "•••%";
  const body = `${Math.abs(n).toFixed(2)}%`;
  if (n < 0 && Math.abs(n) >= 0.005) return `${MINUS}${body}`;
  return n >= 0.005 ? `+${body}` : body;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "13 Oct" (or "13 Oct 2025" when withYear), from a YYYY-MM-DD string. */
export function shortDate(iso: string, withYear = false): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/** Direction of a change as a plain word for assistive tech; never colour alone. */
export function direction(n: number | null): "up" | "down" | "level" {
  if (n === null || Math.abs(n) < 0.005) return "level";
  return n > 0 ? "up" : "down";
}

/** At most `max` evenly spread points, always keeping the first and last. */
export function samplePoints<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]);
  return out;
}

export interface ChartGeometry {
  xs: number[];
  ys: number[];
  paidYs: number[];
  width: number;
  height: number;
}

/** Map points into an SVG box. The y domain covers value (and paid in when
 *  `includePaid`), padded so a flat series sits mid-chart rather than on an edge. */
export function chartGeometry(points: GrowthPoint[], width: number, height: number, includePaid: boolean, pad = 10): ChartGeometry {
  const vals = points.flatMap((p) => (includePaid && p.paid_in !== null ? [p.value, p.paid_in] : [p.value]));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const span = hi - lo;
  lo -= span * 0.08;
  hi += span * 0.08;
  const innerH = height - pad * 2;
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * innerH;
  const n = points.length;
  const xs = points.map((_, i) => (n === 1 ? width / 2 : (i / (n - 1)) * width));
  return { xs, ys: points.map((p) => y(p.value)), paidYs: points.map((p) => y(p.paid_in ?? p.value)), width, height };
}

export function linePath(xs: number[], ys: number[]): string {
  return xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
}
