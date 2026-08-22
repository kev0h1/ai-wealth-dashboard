// TEMPORARY PREVIEW — delete after design review.
//
// Shared fixture data for /design/scenario-a, /design/scenario-b and
// /design/scenario-c — three art-direction variants of the "what if"
// scenario verdict screen (Penny answers a question like "what if I start
// paying £450 a month for a car from October?" with a deterministic verdict
// across four axes: month-end cash, debt, plans/goals, and Grow, plus a
// "where would this come from" absorb block).
//
// All three pages import ONLY from this file for data, so they render
// identical numbers and differ purely in layout and hierarchy. No API
// calls, no auth, no /scenario/run — this is a static preview.
//
// Two fixtures, deliberately different shapes:
//   CAR_PAYMENT_FIXTURE   — a new ongoing monthly cost against an already
//                            deeply negative baseline. Debt and plans both
//                            come back null and must read as honest, not
//                            broken. Has a "where would this come from"
//                            absorb block (real shortfall to place).
//   CAR_INSURANCE_FIXTURE — cancelling an annual policy, a lumpy scenario:
//                            a small steady monthly average hides a large
//                            one-off October lump. No absorb block, freeing
//                            money doesn't need a "where from" answer.

export type ItemKind = "new_cost" | "cancellation";

export type ScenarioItem = {
  name: string;
  amount: number;
  cadence: "monthly" | "annual";
  startLabel: string;
  kind: ItemKind;
  ongoing: boolean;
};

export type MonthEndCash = {
  baselineSurplus: number;
  /** Steady-state monthly delta this scenario introduces. Negative = worse. */
  delta: number;
  afterSurplus: number;
  /** Server/LLM-composed plain-English headline, answer-first, hedged. */
  headline: string;
  /** Present only for lumpy scenarios where the steady average hides a lump. */
  lumpNote?: string;
};

export type DebtAxis = {
  available: false;
  debtFreeMonthNow: null;
  debtFreeMonthAfter: null;
  monthsLater: null;
  extraInterest: null;
  reason: string;
};

export type PlansAxis = {
  available: false;
  reason: string;
};

export type GrowAxis = {
  monthsCoverBefore: number;
  monthsCoverAfter: number;
};

export type AbsorbCandidate = {
  category: string;
  monthlyMedian: number;
};

export type AbsorbBlock = {
  shortfall: number;
  coveredBySurplus: number;
  candidates: AbsorbCandidate[];
};

export type ScenarioFixture = {
  id: "car_payment" | "car_insurance";
  question: string;
  item: ScenarioItem;
  monthEndCash: MonthEndCash;
  debt: DebtAxis;
  plans: PlansAxis;
  grow: GrowAxis;
  absorb: AbsorbBlock | null;
  assumptions: string[];
};

// Shared across both fixtures: the debt and plans reality is the same
// household, evaluated against the same live position, regardless of which
// scenario is asked about.
const DEBT_UNAVAILABLE: DebtAxis = {
  available: false,
  debtFreeMonthNow: null,
  debtFreeMonthAfter: null,
  monthsLater: null,
  extraInterest: null,
  reason:
    "We can't give you a debt-free date here. Several of your cards aren't on track to clear inside our projection window, and one has been moving the wrong way, not down.",
};

const PLANS_NONE: PlansAxis = {
  available: false,
  reason: "No active plans to check against this scenario.",
};

const ASSUMPTIONS = ["Assumes your payday and rhythm stay as they are."];

export const CAR_PAYMENT_FIXTURE: ScenarioFixture = {
  id: "car_payment",
  question: "what if I start paying £450 a month for a car from October?",
  item: {
    name: "Car payment",
    amount: 450,
    cadence: "monthly",
    startLabel: "from October 2026",
    kind: "new_cost",
    ongoing: true,
  },
  monthEndCash: {
    baselineSurplus: -1832.95,
    delta: -450,
    afterSurplus: -2282.95,
    headline:
      "This scenario worsens your monthly deficit from £1,833 to an expected £2,283, with a £450 steady monthly shortfall you cannot currently cover.",
  },
  debt: DEBT_UNAVAILABLE,
  plans: PLANS_NONE,
  grow: {
    monthsCoverBefore: 2.3,
    monthsCoverAfter: 1.9,
  },
  absorb: {
    shortfall: 450,
    coveredBySurplus: 0,
    candidates: [
      { category: "Groceries", monthlyMedian: 320 },
      { category: "Eating Out", monthlyMedian: 210 },
      { category: "Shopping", monthlyMedian: 165 },
      { category: "Subscriptions", monthlyMedian: 38 },
    ],
  },
  assumptions: ASSUMPTIONS,
};

export const CAR_INSURANCE_FIXTURE: ScenarioFixture = {
  id: "car_insurance",
  question: "what if I cancel my car insurance from October?",
  item: {
    name: "Car insurance",
    amount: 1200,
    cadence: "annual",
    startLabel: "from October 2026",
    kind: "cancellation",
    ongoing: true,
  },
  monthEndCash: {
    baselineSurplus: -1832.95,
    delta: 100,
    afterSurplus: -1732.95,
    headline:
      "Cancelling Car insurance frees up about £100 a month on average, with the full £1,200 landing in October each year.",
    lumpNote: "The full £1,200 lands in October 2026, and again in October 2027 if the change holds, not spread evenly across the year.",
  },
  debt: DEBT_UNAVAILABLE,
  plans: PLANS_NONE,
  grow: {
    monthsCoverBefore: 2.3,
    monthsCoverAfter: 2.6,
  },
  absorb: null,
  assumptions: ASSUMPTIONS,
};

export const SCENARIOS: ScenarioFixture[] = [CAR_PAYMENT_FIXTURE, CAR_INSURANCE_FIXTURE];

// ── Formatting helpers ───────────────────────────────────────────────────
// Plain strings only (no JSX here — this file stays a data module so all
// three variants can share it without pulling react into a .ts file).
// Every caller wraps the result in a mono, tabular-nums span itself per
// The Money Is Mono Rule.

/** Absolute-value whole-pound money string with the Unicode minus for
 * negatives, e.g. "−£1,833". Whole pounds matches the app-wide convention
 * for summary/monthly figures (backend/app/routers/can_i.py's `_fmt_gbp`
 * defaults to 0 decimals; live Planning shows "£195", "£1,833/mo short").
 * Every figure this screen renders is a monthly or median summary, never a
 * single transaction, so there is no genuinely-pennies figure to preserve. */
export function money(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `−£${abs}` : `£${abs}`;
}

/** Signed whole-pound delta string, e.g. "+£100" or "−£450". Zero renders unsigned. */
export function moneyDelta(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (n > 0) return `+£${abs}`;
  if (n < 0) return `−£${abs}`;
  return `£${abs}`;
}

/** Whole-pound money string, no decimals, e.g. "£450". Unicode minus for negatives. */
export function moneyWhole(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `−£${abs}` : `£${abs}`;
}

export function months(n: number): string {
  return `${n.toFixed(1)} month${Math.abs(n - 1) < 0.05 ? "" : "s"}`;
}

export function itemLine(item: ScenarioItem): string {
  const cadence = item.cadence === "monthly" ? "a month" : "a year";
  const verb = item.kind === "cancellation" ? "Cancel" : "Add";
  return `${verb} ${item.name}, ${moneyWhole(item.amount)} ${cadence}, ${item.startLabel}`;
}
