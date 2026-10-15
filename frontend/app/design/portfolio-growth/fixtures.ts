// Invented fixtures only (no API). Each example is a seeded walk that starts
// at the statement date (4 Sep 2026), the way real tracking does: the first
// point is the statement value and counts as money paid in. The walk is
// detrended so it ends at a chosen total change, and the holdings are built
// so their statement values sum to the opening value and their current
// values sum to the headline value. No contributions in the window.
import type { GrowthHolding, GrowthPoint, GrowthRange, InvestmentGrowth } from "@/lib/investmentGrowth";

export type Fixture = "growing" | "flat" | "fallen";
export const FIXTURES: { label: string; value: Fixture }[] = [
  { label: "Growing", value: "growing" },
  { label: "Flat", value: "flat" },
  { label: "Fallen", value: "fallen" },
];

const STATEMENT = "2026-09-04";
const DAYS = 39; // 4 Sep to 13 Oct 2026, 40 daily points
const OPENING = 41820.4;
const CASH = 412.3;
const RANGE_DAYS: Record<GrowthRange, number | null> = { "1m": 30, "3m": 91, "6m": 182, "1y": 365, all: null };

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(day: number): string {
  const d = new Date(Date.UTC(2026, 8, 4));
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

function series(seed: number, noise: number, targetChange: number): GrowthPoint[] {
  const r = rng(seed);
  const walk: number[] = [0];
  for (let i = 1; i <= DAYS; i++) walk.push(walk[i - 1] + (r() - 0.5) * noise);
  const end = walk[DAYS];
  return walk.map((w, i) => {
    const t = i / DAYS;
    const value = OPENING * Math.exp(w - t * end + t * Math.log(1 + targetChange));
    return { date: iso(i), value: Math.round(value * 100) / 100, paid_in: OPENING };
  });
}

const SERIES: Record<Fixture, GrowthPoint[]> = {
  growing: series(11, 0.006, 0.042),
  flat: series(7, 0.004, 0.0004),
  fallen: series(3, 0.007, -0.056),
};

const NAMES = ["Global all-cap index fund", "UK government bond fund", "Emerging markets index fund"];
const WEIGHTS = [0.7, 0.2, 0.1];
const SENSITIVITY = [1, 0.4, 1.8]; // how strongly each fund follows the move

function holdingsFor(fixture: Fixture): GrowthHolding[] {
  const closing = SERIES[fixture][DAYS].value;
  const pool = OPENING - CASH;
  const stmt = WEIGHTS.map((w) => Math.round(pool * w * 100) / 100);
  stmt[0] = Math.round((pool - stmt[1] - stmt[2]) * 100) / 100;
  const g = (closing - CASH - pool) / stmt.reduce((a, v, i) => a + v * SENSITIVITY[i], 0);
  const cur = stmt.map((v, i) => Math.round(v * (1 + g * SENSITIVITY[i]) * 100) / 100);
  cur[0] = Math.round((closing - CASH - cur[1] - cur[2]) * 100) / 100;
  const rows: GrowthHolding[] = NAMES.map((name, i) => {
    const change = Math.round((cur[i] - stmt[i]) * 100) / 100;
    return { id: `h${i + 1}`, name, isin: null, type: "Fund", value: cur[i], statement_value: stmt[i], change_abs: change, change_pct: Math.round((change / stmt[i]) * 10000) / 100, price_date: iso(DAYS) };
  });
  rows.push({ id: "h4", name: "Cash", isin: null, type: "Cash", value: CASH, statement_value: CASH, change_abs: 0, change_pct: 0, price_date: null });
  return rows;
}

const HOLDINGS: Record<Fixture, GrowthHolding[]> = {
  growing: holdingsFor("growing"),
  flat: holdingsFor("flat"),
  fallen: holdingsFor("fallen"),
};

export function growthFor(fixture: Fixture, range: GrowthRange): InvestmentGrowth {
  const all = SERIES[fixture];
  const days = RANGE_DAYS[range];
  const points = days === null ? all : all.slice(Math.max(0, all.length - 1 - days));
  const first = points[0];
  const last = points[points.length - 1];
  const growth = Math.round(((last.value - last.paid_in) - (first.value - first.paid_in)) * 100) / 100;
  const capital = first.value + (last.paid_in - first.paid_in);
  return {
    account_id: "fixture", currency: "GBP", range, method: "simple", method_label: "Value minus money paid in",
    statement_date: STATEMENT, points, since: first.date, as_of: last.date,
    value: last.value, paid_in: last.paid_in, growth_abs: growth,
    growth_pct: Math.round((growth / capital) * 10000) / 100, holdings: HOLDINGS[fixture],
  };
}
