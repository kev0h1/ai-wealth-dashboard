// Invented figures for the G269 pay-split preview. Three states of one month:
// under take-home, exactly at it, and beyond (the £610 case). Built the way
// backend/app/services/money_shape.py builds them: shares are of take-home
// while there is money left, and of what went out once Beyond is present.
import type { MoneyShape, MoneyShapeJob, MoneyShapePeriodEntry } from "@/lib/api";

export type Fixture = "under" | "at" | "beyond";
export type Source = "cards" | "savings" | "both" | "unknown";

const label = "1 Sep to 30 Sep";

function jobs(fixed: number, moved: number, free: number, takeHome: number): MoneyShapeJob[] {
  const out = fixed + moved + free;
  const left = Math.max(0, takeHome - out);
  const base = out > takeHome ? out : takeHome;
  const share = (n: number) => Math.round((n / base) * 100);
  const f = share(fixed), m = share(moved), fr = share(free);
  const l = out > takeHome ? 0 : 100 - f - m - fr;
  return [
    { id: "fixed", label: "Fixed (bills, debt, rent)", amount: fixed, share: f, categories: ["Bills"], txn_type: "debit" },
    { id: "moved", label: "Moved to savings", amount: moved, share: m, categories: ["Savings"], txn_type: "debit" },
    { id: "free", label: "Free spending", amount: free, share: out > takeHome ? 100 - f - m : fr, categories: ["Eating Out"], txn_type: "debit" },
    { id: "left", label: "Left over", amount: left, share: l, categories: ["Income"], txn_type: "credit" },
  ];
}

const SPEC: Record<Fixture, { takeHome: number; fixed: number; moved: number; free: number }> = {
  under: { takeHome: 2100, fixed: 1000, moved: 300, free: 480 },
  at: { takeHome: 2100, fixed: 1134, moved: 357, free: 609 },
  beyond: { takeHome: 2100, fixed: 1463, moved: 461, free: 786 },
};

export function makeShape(fixture: Fixture, source: Source, consent: boolean): MoneyShape {
  const { takeHome, fixed, moved, free } = SPEC[fixture];
  const out = fixed + moved + free;
  const beyond = Math.max(0, out - takeHome);
  const js = jobs(fixed, moved, free, takeHome);
  const sourceKey = beyond < 1 ? null : source === "both" ? "cards_and_savings" : source === "unknown" ? null : source;
  const cardGrowth = beyond >= 1 && (source === "cards" || source === "both") ? (source === "both" ? 380 : 700) : 0;
  const savingsDrawdown = beyond >= 1 && (source === "savings" || source === "both") ? (source === "both" ? 300 : 650) : 0;
  const fixedShare = js[0].share;
  const verdict = beyond >= 1
    ? `Of every £100 that went out, £${fixedShare} was spoken for before you chose anything.`
    : `Of every £100 you take home, £${fixedShare} is spoken for before you choose anything. £${js[2].share} is yours to spend freely.`;
  const entry: MoneyShapePeriodEntry = {
    start: "2026-09-01", end: "2026-09-30", label, take_home: takeHome, overspent: beyond,
    total_out: out, beyond, beyond_source: sourceKey, card_growth: cardGrowth, savings_drawdown: savingsDrawdown,
    jobs: js, verdict,
  };
  return {
    status: "ok",
    computed_at: "2026-10-01T08:00:00",
    period: { start: entry.start, end: entry.end, label },
    take_home: takeHome, overspent: beyond,
    total_out: out, beyond, beyond_source: sourceKey, card_growth: cardGrowth, savings_drawdown: savingsDrawdown,
    jobs: js, verdict,
    trend: { periods: [], fixed: [], moved: [], free: [], left: [] },
    trend_line: null,
    what_works: {
      state: "no_pattern", periods_available: 5, periods_needed: 4, pattern_id: null,
      headline: "No clear pattern yet.", flag_labels: null, evidence: [],
      trait: { id: "saving_habit", title: "You save in bursts, not dribs", choice: consent ? "change" : "keep" },
      proposal: null,
    },
    periods: [entry],
    averages: [],
  };
}
