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
  /** G278: units held now (statement units plus later contract notes), or null. */
  units: number | null;
  /** G278: end-of-day price, or null which reads "No price yet". */
  price: number | null;
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

/** G278: what the provider shows on a date, entered by the user. */
export interface GrowthAnchor {
  date: string;
  provider_value: number;
  provider_return: number | null;
  total_paid_in: number | null;
  provider_rate_of_return_pct: number | null;
  source: "user";
  entered_at?: string;
  use_provider_value?: boolean;
}

export interface AnchorInput {
  date: string;
  provider_value: number;
  provider_return?: number | null;
  total_paid_in?: number | null;
  provider_rate_of_return_pct?: number | null;
}

/** G278: the PRIMARY lifetime figure, from the anchor. */
export interface GrowthLifetime {
  anchor: GrowthAnchor;
  provider: string;
  net_paid_in_at_anchor: number;
  paid_in_after: number;
  withdrawn_after: number;
  paid_in: number;
  growth_abs: number;
  growth_pct: number | null;
  since: string;
  rate_of_return: { pct: number; as_of: string; label: string; note: string } | null;
  reconciliation: { date: string; ours: number; provider_value: number; difference: number; override: boolean; text?: string } | null;
}

export interface SinceStatement { date: string; closing_value: number; paid_in: number; growth_abs: number; fees: number }

export interface StatementPeriodGrowth {
  from: string | null; to: string; opening_value: number; closing_value: number; payments_in: number; withdrawals: number;
  growth_abs: number; growth_pct: number | null; fees: number; interest: number; before_fees_and_interest: number;
}

export interface PeriodsChain { from: string | null; to: string; periods: number; growth_abs: number; fees: number; interest: number; payments_in: number }

export interface GrowthPurchase {
  date: string | null; fund_name: string; units: number | null; amount: number;
  price: number | null; value: number | null; gain_abs: number | null; gain_pct: number | null;
  source: "statement" | "contract_note";
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
  provider?: string | null;
  /** G278 */
  value_source?: "sorted" | "provider";
  header_value?: number | null;
  value_note?: string | null;
  lifetime?: GrowthLifetime | null;
  anchor?: GrowthAnchor | null;
  since_statement?: SinceStatement | null;
  statement_periods?: StatementPeriodGrowth[];
  periods_chain?: PeriodsChain | null;
  purchases?: GrowthPurchase[];
}

/** The three risk lines, verbatim, on every growth surface. */
export const RISK_LINES = [
  "Capital at risk.",
  "Past performance is not a guide to future returns.",
  "Prices are end of day and may be delayed.",
] as const;

export const METHOD_NOTE = "Growth is simple: what each holding is worth now minus what you paid for it. Cost comes from your contract notes and from the book cost on a statement, where it shows one. A holding with no known cost adds nothing to the gain.";
export const LIFETIME_NOTE = "Lifetime growth starts from the value and return your provider showed on the anchor date, then adds what you paid in after it from contract notes and statements, and takes off any withdrawals. Fees are part of growth, not money paid in.";

export const COST_UNKNOWN = "Cost not known";
export const NO_PRICE_YET = "No price yet";
export const ANCHOR_PROMPT = "Anchor from your provider to see lifetime growth";
export const ANCHOR_EDIT = "Edit anchor";
export const ANCHOR_USER_NOTE = "Entered by you. You can edit or clear it at any time.";
export const RATE_NOTE = "Money-weighted, as shown by your provider. Sorted does not recompute it.";

/** The provider's own name for the rate line, "from Vanguard". */
export function fromProvider(provider: string | null | undefined): string {
  return `from ${provider && provider.trim() ? provider.trim() : "your provider"}`;
}

/** "Sorted shows £20,342.64, Vanguard showed £20,313.61 on 15 Oct, likely price timing." */
export function reconciliationText(rc: { ours: number; provider_value: number; date: string }, provider: string | null | undefined, hidden?: boolean): string {
  const who = provider && provider.trim() ? provider.trim() : "Your provider";
  return `Sorted shows ${money(rc.ours, { hidden })}, ${who} showed ${money(rc.provider_value, { hidden })} on ${shortDate(rc.date)}, likely price timing.`;
}
export const SIMPLE_GAIN_NOTE = "Simple gain, not a time-weighted return.";
export const SIMPLE_GAIN_LABEL = "Simple gain, not a time-weighted return";
export const CHART_WAITING = "Chart fills in as daily prices arrive.";
export const NO_COST_LINE = "Growth shows once we know what was paid. Anchor from your provider, add a contract note, or add a statement that shows book cost.";

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

/** "£20,313.61", "20313.61" or "−1,341.92" to a number; null when it is not one. */
export function parseMoneyInput(raw: string): number | null {
  const t = raw.replace(/[£,\s]/g, "").replace(/[−–]/g, "-");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "14.61" or "14.61%" to a number; null when blank or not a number. */
export function parsePercentInput(raw: string): number | null {
  const t = raw.replace(/[%\s]/g, "").replace(/[−–]/g, "-");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
