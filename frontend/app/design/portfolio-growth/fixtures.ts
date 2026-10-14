// Invented fixtures only (no API). Daily snapshots are generated from a
// seeded walk so the three examples are stable between loads.
import type { GrowthHolding, GrowthPoint, GrowthRange, InvestmentGrowth } from "@/lib/investmentGrowth";

export type Fixture = "growing" | "flat" | "fallen";
export const FIXTURES: { label: string; value: Fixture }[] = [
  { label: "Growing", value: "growing" },
  { label: "Flat", value: "flat" },
  { label: "Fallen", value: "fallen" },
];

const AS_OF = "2026-10-13";
const STATEMENT = "2026-09-04";
const DAYS = 400;
const RANGE_DAYS: Record<GrowthRange, number | null> = { "1m": 30, "3m": 91, "6m": 182, "1y": 365, all: null };

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(offsetFromEnd: number): string {
  const d = new Date(Date.UTC(2026, 9, 13));
  d.setUTCDate(d.getUTCDate() - offsetFromEnd);
  return d.toISOString().slice(0, 10);
}

function series(seed: number, drift: number, noise: number, tail: number): GrowthPoint[] {
  const r = rng(seed);
  const out: GrowthPoint[] = [];
  let paid = 31000;
  let value = 31000;
  for (let i = DAYS; i >= 0; i--) {
    const date = iso(i);
    const monthly = date.endsWith("-01") ? 250 : 0;
    paid += monthly;
    const shock = (r() - 0.5) * noise;
    const pull = i < 25 ? tail : 0; // shape the last weeks of each example
    value = (value + monthly) * (1 + drift + shock + pull);
    out.push({ date, value: Math.round(value * 100) / 100, paid_in: paid });
  }
  return out;
}

const SERIES: Record<Fixture, GrowthPoint[]> = {
  growing: series(11, 0.00045, 0.009, 0.0009),
  flat: series(7, -0.00004, 0.004, 0),
  fallen: series(3, -0.00018, 0.01, -0.0013),
};

const HOLDINGS: Record<Fixture, GrowthHolding[]> = (() => {
  const mk = (id: string, name: string, type: string, value: number, change: number): GrowthHolding => {
    const stmt = Math.round((value - change) * 100) / 100;
    return { id, name, isin: null, type, value, statement_value: stmt, change_abs: change, change_pct: Math.round((change / stmt) * 10000) / 100, price_date: AS_OF };
  };
  return {
    growing: [mk("h1", "Global all-cap index fund", "Fund", 31842.55, 3980.1), mk("h2", "UK government bond fund", "Fund", 9210.4, 211.3), mk("h3", "Emerging markets index fund", "Fund", 4120.85, 1117.58), { id: "h4", name: "Cash", isin: null, type: "Cash", value: 412.3, statement_value: 412.3, change_abs: 0, change_pct: 0, price_date: null }],
    flat: [mk("h1", "Global all-cap index fund", "Fund", 28104.2, 41.9), mk("h2", "UK government bond fund", "Fund", 9880.15, -36.2), mk("h3", "Emerging markets index fund", "Fund", 3604.4, 12.75), { id: "h4", name: "Cash", isin: null, type: "Cash", value: 640.0, statement_value: 640.0, change_abs: 0, change_pct: 0, price_date: null }],
    fallen: [mk("h1", "Global all-cap index fund", "Fund", 26310.9, -2104.65), mk("h2", "UK government bond fund", "Fund", 9102.55, -148.4), mk("h3", "Emerging markets index fund", "Fund", 3315.2, -402.8), { id: "h4", name: "Cash", isin: null, type: "Cash", value: 288.05, statement_value: 288.05, change_abs: 0, change_pct: 0, price_date: null }],
  };
})();

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
