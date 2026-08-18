// Fixture payloads for /design/spend-live — one per SpendVerdictState, typed
// against the real `SpendVerdict` (lib/api.ts, mirrored field-for-field from
// backend/app/services/spend_verdict.py). Typing against the real interface
// means an accidental payload-shape drift fails `tsc --noEmit` here, not
// silently in production.
//
// Each fixture is internally consistent: pace.spent/usual_by_now roughly
// match the stated multiple/excess, majority totals roughly match the pills,
// and the `reading` string is hand-derived from the same template logic as
// `spend_verdict.py`'s `build_reading` so this route shows exactly what a
// real payload in that state would say.
import type { Checkpoint, SpendVerdict, SpendVerdictPaceEntry, SpendVerdictState, Transaction } from "@/lib/api";

// Deterministic cumulative actual-vs-usual series for SpendHeader's pace
// strip — linear interpolation from day 1 to `days`, endpoint-corrected so
// the final day's `actual` always lands exactly on the fixture's
// `pills.spent` (the strip's own reconciliation invariant). `usualFinal:
// null` produces an all-null usual column, matching build_pace_series'
// thin_history behaviour (still-learning baseline never fabricates a usual).
function linearSeries(days: number, actualFinal: number, usualFinal: number | null): SpendVerdictPaceEntry[] {
  const series: SpendVerdictPaceEntry[] = [];
  for (let day = 1; day <= days; day++) {
    series.push({
      day,
      actual: Math.round((actualFinal * day) / days),
      usual: usualFinal === null ? null : Math.round((usualFinal * day) / days),
    });
  }
  if (series.length > 0) series[series.length - 1] = { ...series[series.length - 1], actual: actualFinal };
  return series;
}

// Income drill-down fixture — production builds this list client-side from
// live transactions (SpendPage.tsx's `incomeTxns`); this route has none, so
// a small representative pair stands in wherever the top region's "In" tap
// demonstrates the same drill-down. Values are illustrative only — they do
// not need to sum to any fixture's pills.income.
export const PREVIEW_INCOME_TXNS: Transaction[] = [
  {
    id: "fixture-income-salary",
    account_id: "fixture-account",
    date: "2026-07-31",
    amount: 2400,
    currency: "GBP",
    description: "ACME CORP LTD PAYROLL",
    merchant_name: "Acme Corp",
    category: "Income",
    transaction_type: "credit",
  },
  {
    id: "fixture-income-interest",
    account_id: "fixture-account",
    date: "2026-08-05",
    amount: 12,
    currency: "GBP",
    description: "SAVINGS INTEREST",
    merchant_name: "Bank interest",
    category: "Income",
    transaction_type: "credit",
  },
];

// The aim/checkpoint mechanism's fixture signals — feeds SpendVerdictView's
// `signals` prop the same shape SpendPage.tsx's real `/spend/category-
// signals` map does, for exactly the two "normal" notables that should show
// it: Bills (no checkpoint yet — the manual "Set an aim" offer) and Health
// (an active checkpoint — the live progress + cancel state). Transport is
// deliberately left out (multiple 1.4 < the 1.5 aim-eligibility threshold)
// so this route also demonstrates a notable WITHOUT the aim prompt.
export const PREVIEW_SIGNALS: Record<string, { suggested_aim: number | null; checkpoint: Checkpoint | null }> = {
  Bills: { suggested_aim: 1350, checkpoint: null },
  Health: {
    suggested_aim: 150,
    checkpoint: { id: "fixture-checkpoint-health", aim_amount: 150, spent_so_far: 118, days_left: 6, on_track: true },
  },
};

const PERIOD_13 = { start: "2026-07-31", end: "2026-08-27", days_elapsed: 13, days_left: 15, offset: 0, closed: false };
const PERIOD_3 = { start: "2026-07-31", end: "2026-08-27", days_elapsed: 3, days_left: 25, offset: 0, closed: false };

const MOVED_FULL: SpendVerdict["moved"] = [
  { kind: "pots", label: "To your pots", amount: 2724, payments_count: 49, goal_names: ["Japan", "Rainy Day Saver"] },
  { kind: "credit_cards", label: "To your credit cards", amount: 834, payments_count: 2 },
  { kind: "investments", label: "To your investments", amount: 400, payments_count: 1 },
];

const NORMAL: SpendVerdict = {
  state: "normal",
  // Matches the shipped compose_reading grammar: sentence 1 overrides to the
  // pound-led pace fact (state "normal" + notables + excess > 0), sentence 2
  // is the movement-reassurance fallback (moved_total 3,958 clears the £50
  // material floor, no bills_risk/horizon/move consequence in this fixture).
  reading: "Running about £1,301 ahead of usual, mostly Bills. You also moved £3,958 to savings and cards.",
  notables: [
    {
      category: "Bills", spent: 2028, multiple: 2.0, excess: 1028, payments_count: 14,
      cause: [{ name: "British Gas", amount: 340 }, { name: "EDF", amount: 180 }, { name: "Council Tax", amount: 167 }],
      pace: { spent: 2028, usual_by_now: 1000 },
    },
    {
      category: "Transport", spent: 449, multiple: 1.4, excess: 129, payments_count: 22,
      cause: [{ name: "Shell", amount: 210 }],
      pace: { spent: 449, usual_by_now: 320 },
    },
    {
      category: "Health", spent: 228, multiple: 2.0, excess: 114, payments_count: 7,
      cause: [{ name: "David Lloyd", amount: 117 }],
      pace: { spent: 228, usual_by_now: 114 },
    },
  ],
  quiet_flags: [
    { category: "Subscriptions", spent: 122, multiple: 1.6, excess: 30, payments_count: 9 },
  ],
  // Descending by spent (nonzero rows), zero rows last — MajorityRowView
  // renders this order verbatim, it does not sort client-side.
  majority: [
    { category: "Groceries", spent: 421, payments_count: 4, has_baseline: true, elevated: false },
    { category: "Subscriptions", spent: 122, payments_count: 9, has_baseline: true, elevated: true },
    { category: "Travel", spent: 118, payments_count: 4, has_baseline: true, elevated: false },
    { category: "Cash", spent: 115, payments_count: 2, has_baseline: true, elevated: false },
    { category: "Shopping", spent: 61, payments_count: 3, has_baseline: true, elevated: false },
    { category: "Golf", spent: 36, payments_count: 2, has_baseline: true, elevated: false },
    { category: "Software", spent: 22, payments_count: 1, has_baseline: true, elevated: false },
    { category: "Beauty", spent: 18, payments_count: 1, has_baseline: true, elevated: false },
    { category: "Charity", spent: 5, payments_count: 1, has_baseline: true, elevated: false },
    { category: "Eating Out", spent: 0, payments_count: 0, has_baseline: true, elevated: false },
    { category: "Entertainment", spent: 0, payments_count: 0, has_baseline: true, elevated: false },
  ],
  unresolved: {
    // The real, long provider string from the brief — proves the reserved
    // truncate slot never wraps even at this length, and that the display
    // name strips down to "Finexer" (not "FINEXER LTD OPENBANKINGPAYMENT
    // FT." — a raw provider string never reaches the card).
    total: 1020, payments_count: 1, ask_worthy: true, weight: "material",
    largest: {
      id: "fixture-finexer-1",
      display_name: "Finexer",
      raw_description: "FINEXER LTD OPENBANKINGPAYMENT FT.",
      amount: 1020,
      date: "2026-08-04",
    },
  },
  moved: MOVED_FULL,
  // pills.spent = sum(notables.spent) 2705 + sum(majority.spent) 918 +
  // unresolved.total 1020 = 4643 (reconciliation invariant, guarded below).
  pills: { spent: 4643, income: 253, net: -4390 },
  period: PERIOD_13,
  // Established baseline (thin_history false) — real `usual` values.
  // usualFinal 3,342 = actualFinal 4,643 - the 1,301 excess the reading names.
  pace_series: linearSeries(13, 4643, 3342),
  moved_total: 3958,
};

const NOTHING: SpendVerdict = {
  state: "nothing",
  // compose_reading always caps at 2 sentences: the movement-reassurance
  // fallback fires (moved_total 500 clears the £50 floor, no consequence in
  // this fixture) and `_first_sentence` truncates the 3-sentence
  // elevated/no-baseline base_reading down to its first sentence before
  // appending it — the same trade the real composer makes, not a fixture
  // shortcut.
  reading: "Nothing crossed the line this period. You also moved £500 to savings and cards.",
  notables: [],
  quiet_flags: [],
  majority: [
    { category: "Bills", spent: 690, payments_count: 6, has_baseline: true, elevated: false },
    { category: "Groceries", spent: 380, payments_count: 5, has_baseline: true, elevated: false },
    { category: "Transport", spent: 210, payments_count: 9, has_baseline: true, elevated: false },
    { category: "Cash", spent: 140, payments_count: 3, has_baseline: true, elevated: true },
    { category: "Subscriptions", spent: 88, payments_count: 6, has_baseline: true, elevated: false },
    { category: "Golf", spent: 24, payments_count: 1, has_baseline: false, elevated: false },
    { category: "Eating Out", spent: 0, payments_count: 0, has_baseline: true, elevated: false },
  ],
  unresolved: {
    total: 45, payments_count: 1, ask_worthy: false, weight: "routine",
    largest: { id: "fixture-local-shop-1", display_name: "Local Shop", raw_description: "Local shop", amount: 45, date: "2026-08-10" },
  },
  moved: [{ kind: "pots", label: "To your pots", amount: 500, payments_count: 2, goal_names: ["Rainy Day Saver"] }],
  // pills.spent = sum(notables.spent) 0 + sum(majority.spent) 1532 +
  // unresolved.total 45 = 1577.
  pills: { spent: 1577, income: 2100, net: 523 },
  period: PERIOD_13,
  // Established baseline, running slightly hot overall (usualFinal 1,537 <
  // actualFinal 1,577) — matches "ran hotter than usual, just not by much".
  pace_series: linearSeries(13, 1577, 1537),
  moved_total: 500,
};

const EVERYTHING: SpendVerdict = {
  state: "everything",
  // Matches the shipped compose_reading grammar: sentence 1 overrides to the
  // pound-led pace fact (excess 1,411 = sum of notables + quiet_flags
  // excess below, same figure the old reading named), sentence 2 is the
  // movement-reassurance fallback (moved_total clears the £50 floor).
  reading: "Running about £1,411 ahead of usual, mostly Bills. You also moved £3,958 to savings and cards.",
  notables: [
    {
      category: "Bills", spent: 2028, multiple: 2.0, excess: 1028, payments_count: 14,
      cause: [{ name: "British Gas", amount: 340 }, { name: "EDF", amount: 180 }, { name: "Council Tax", amount: 167 }],
      pace: { spent: 2028, usual_by_now: 1000 },
      // The loudest notable's priced consequence — same share-of-total copy
      // pattern as spend_verdict.py's compute_spend_verdict (1,028 / 1,411
      // excess = 73% >= the 0.6 "accounts for most of that" threshold).
      consequence_line: { text: "Bills alone accounts for most of that." },
    },
    {
      category: "Transport", spent: 449, multiple: 1.4, excess: 129, payments_count: 22,
      cause: [{ name: "Shell", amount: 210 }],
      pace: { spent: 449, usual_by_now: 320 },
    },
    {
      category: "Health", spent: 228, multiple: 2.0, excess: 114, payments_count: 7,
      cause: [{ name: "David Lloyd", amount: 117 }],
      pace: { spent: 228, usual_by_now: 114 },
    },
  ],
  quiet_flags: [
    { category: "Groceries", spent: 520, multiple: 1.6, excess: 80, payments_count: 6 },
    { category: "Travel", spent: 210, multiple: 1.55, excess: 60, payments_count: 3 },
  ],
  // The backend guarantees quiet-flagged categories are also present in
  // majority (test_spend_verdict.py:141) — Groceries and Travel below are
  // the same rows named in quiet_flags above, elevated: true to match.
  majority: [
    { category: "Groceries", spent: 520, payments_count: 6, has_baseline: true, elevated: true },
    { category: "Travel", spent: 210, payments_count: 3, has_baseline: true, elevated: true },
    { category: "Subscriptions", spent: 122, payments_count: 9, has_baseline: true, elevated: false },
    { category: "Cash", spent: 115, payments_count: 2, has_baseline: true, elevated: false },
    { category: "Golf", spent: 36, payments_count: 2, has_baseline: true, elevated: false },
    { category: "Software", spent: 22, payments_count: 1, has_baseline: true, elevated: false },
    { category: "Charity", spent: 5, payments_count: 1, has_baseline: true, elevated: false },
    { category: "Entertainment", spent: 0, payments_count: 0, has_baseline: true, elevated: false },
  ],
  unresolved: {
    // Short-string / "routine" density case (£4.50 to Playtomic, recurring
    // twice — ask-worthy via recurrence, not size) — proves the reserved
    // truncate slot doesn't wrap short strings either, and demonstrates the
    // reduced-prominence "routine" density alongside NORMAL's "material"
    // full density above.
    total: 9, payments_count: 2, ask_worthy: true, weight: "routine",
    largest: {
      id: "fixture-playtomic-1",
      display_name: "Playtomic",
      raw_description: "PLAYTOMIC* PI-F0D6 ON 11 JUL BCC",
      amount: 4.5,
      date: "2026-08-11",
    },
  },
  moved: MOVED_FULL,
  // pills.spent = sum(notables.spent) 2705 + sum(majority.spent) 1030 +
  // unresolved.total 9 = 3744.
  pills: { spent: 3744, income: 253, net: -3491 },
  period: PERIOD_13,
  // Established baseline. usualFinal 2,333 = actualFinal 3,744 - the 1,411
  // excess the reading names.
  pace_series: linearSeries(13, 3744, 2333),
  moved_total: 3958,
};

const NOBASELINE: SpendVerdict = {
  state: "nobaseline",
  // compose_reading: no sentence-1 override (excess floors at 0 — no
  // majority row has a baseline yet, so compute_pace_totals has nothing to
  // sum), so sentence 1 stays build_reading's own template (comma, not the
  // em-dash the old fixture had). The movement-reassurance fallback fires
  // (moved_total 300 clears the £50 floor) and truncates the base template
  // to its first sentence, same trade compose_reading always makes.
  reading:
    "Still learning your usual, I need about two full pay periods before I can compare. You also moved £300 to savings and cards.",
  notables: [],
  quiet_flags: [],
  majority: [
    { category: "Bills", spent: 540, payments_count: 4, has_baseline: false, elevated: false },
    { category: "Groceries", spent: 260, payments_count: 3, has_baseline: false, elevated: false },
    { category: "Transport", spent: 130, payments_count: 5, has_baseline: false, elevated: false },
    { category: "Golf", spent: 40, payments_count: 2, has_baseline: false, elevated: false },
    { category: "Eating Out", spent: 0, payments_count: 0, has_baseline: false, elevated: false },
  ],
  unresolved: { total: 0, payments_count: 0, ask_worthy: false, weight: "routine", largest: null },
  moved: [{ kind: "pots", label: "To your pots", amount: 300, payments_count: 1, goal_names: ["Japan"] }],
  // pills.spent = sum(notables.spent) 0 + sum(majority.spent) 970 +
  // unresolved.total 0 = 970.
  pills: { spent: 970, income: 1800, net: 830 },
  period: PERIOD_13,
  // thin_history true (baseline still learning) — usual is null every day,
  // never a fabricated comparison.
  pace_series: linearSeries(13, 970, null),
  moved_total: 300,
};

const EARLY: SpendVerdict = {
  state: "early",
  // build_reading's own template, comma not em-dash (matches production);
  // no sentence-2 fallback — moved_total 0 stays under the £50 material
  // floor and the period is too young for any impact-engine consequence.
  reading: "3 days in, too soon to compare against usual.",
  notables: [],
  quiet_flags: [],
  // Recut properly per the task: early = 3 days of genuinely sparse data —
  // a couple of small categories only, nothing that could look like a
  // multiple (structurally impossible this early — pace.py suppresses it).
  majority: [
    { category: "Groceries", spent: 62, payments_count: 1, has_baseline: false, elevated: false },
    { category: "Transport", spent: 18, payments_count: 2, has_baseline: false, elevated: false },
    { category: "Eating Out", spent: 0, payments_count: 0, has_baseline: false, elevated: false },
  ],
  unresolved: { total: 0, payments_count: 0, ask_worthy: false, weight: "routine", largest: null },
  moved: [],
  // pills.spent = sum(notables.spent) 0 + sum(majority.spent) 80 +
  // unresolved.total 0 = 80.
  pills: { spent: 80, income: 0, net: -80 },
  period: PERIOD_3,
  // thin_history true — usual null every day; nothing moved yet.
  pace_series: linearSeries(3, 80, null),
  moved_total: 0,
};

export const SPEND_VERDICT_FIXTURES: Record<SpendVerdictState, SpendVerdict> = {
  normal: NORMAL,
  nothing: NOTHING,
  everything: EVERYTHING,
  nobaseline: NOBASELINE,
  early: EARLY,
};

// ── Dev-only invariant guard ──────────────────────────────────────────────
// No test runner is configured in this frontend (package.json has no
// jest/vitest/etc. and no "test" script — checked 2026-08-14) so this
// substitutes for a unit test: it re-derives the same three invariants the
// design gate measured by hand and throws immediately, in development only,
// if a future fixture edit breaks one. It intentionally does nothing in a
// production build (`next build`/`next start` run with NODE_ENV=production)
// so it never affects the real app — this file only feeds the auth-exempt
// /design/spend-live preview route.
function assertFixtureInvariants(state: SpendVerdictState, v: SpendVerdict): void {
  const notablesSum = v.notables.reduce((s, n) => s + n.spent, 0);
  const majoritySum = v.majority.reduce((s, m) => s + m.spent, 0);
  const reconciled = notablesSum + majoritySum + v.unresolved.total;
  if (reconciled !== v.pills.spent) {
    throw new Error(
      `[fixtures.ts] state "${state}" fails reconciliation: notables ${notablesSum} + majority ${majoritySum} + ` +
        `unresolved ${v.unresolved.total} = ${reconciled}, but pills.spent = ${v.pills.spent}`,
    );
  }

  const nonZero = v.majority.filter((m) => m.spent > 0);
  for (let i = 1; i < nonZero.length; i++) {
    if (nonZero[i].spent > nonZero[i - 1].spent) {
      throw new Error(
        `[fixtures.ts] state "${state}" majority (spent>0) is not descending: ` +
          `"${nonZero[i - 1].category}" (${nonZero[i - 1].spent}) precedes "${nonZero[i].category}" (${nonZero[i].spent})`,
      );
    }
  }

  const majorityCategories = new Set(v.majority.map((m) => m.category));
  for (const q of v.quiet_flags) {
    if (!majorityCategories.has(q.category)) {
      throw new Error(
        `[fixtures.ts] state "${state}" has quiet_flags category "${q.category}" missing from majority ` +
          `(the backend guarantees quiet-flagged categories are in majority — test_spend_verdict.py:141)`,
      );
    }
  }
}

if (process.env.NODE_ENV !== "production") {
  for (const [state, verdict] of Object.entries(SPEND_VERDICT_FIXTURES)) {
    assertFixtureInvariants(state as SpendVerdictState, verdict);
  }
}
