// TEMPORARY PREVIEW FIXTURES — delete after design review.
//
// Trimmed shape derived from backend/app/services/debt_plan.py's
// compute_debt_plan(uid) return value (cards[], totals, extra_to_clear),
// NOT a live fetch — G10 is a design proposal, not a build. Field meanings:
//   ratePill      — "0% until <date>" (muted) while on a promo, or the
//                   standard APR (amber) once interest is actually being
//                   paid; mirrors rate_schedule's active segment.
//   paceMonthly   — £/mo the balance is coming down at your demonstrated
//                   pace (movement.monthly from _compute_movement, positive
//                   = paying down).
//   payoffMonth   — "YYYY-MM" from card.payoff_month, or null when the
//                   card never clears within the horizon.
//   monthlyInterestNow — observed interest charged last cycle
//                        (card.monthly_interest_now); only shown when > 0.
// extraPerMonth/debtFreeMonth mirror totals.extra_to_clear's
// {amount, debt_free_month} (services/debt_plan.py _compute_extra_to_clear,
// ~line 937).

export type RatePill = { label: string; amber: boolean };

export type OutlookCard = {
  accountId: string;
  name: string;
  provider: string;
  debt: number;
  classification: "carried_zero" | "carried_interest" | "cleared_monthly";
  payingInterest: boolean;
  monthlyInterestNow: number;
  ratePill: RatePill;
  paceMonthly: number | null;
  payoffMonth: string | null; // "YYYY-MM"
  /** "YYYY-MM" the active promo segment ends, from rate_schedule's "until"
   *  field, or null when the card isn't on a promo. Drives Variant B's
   *  hollow promo-end tick. */
  promoUntil: string | null;
};

export type OutlookFixture = {
  /** null = no material carried debt, nothing to compute an extra-to-clear for. */
  extraPerMonth: number | null;
  debtFreeMonth: string | null; // "YYYY-MM"
  cards: OutlookCard[];
};

// "Today" this fixture set is built around, for the Variant B month rail.
export const FIXTURE_TODAY = "2026-09-09";

export const OUTLOOK_CARRIED: OutlookFixture = {
  extraPerMonth: 95,
  debtFreeMonth: "2027-06",
  cards: [
    {
      accountId: "fx-halifax-clarity",
      name: "Halifax Clarity",
      provider: "halifax",
      debt: 640,
      classification: "carried_zero",
      payingInterest: false,
      monthlyInterestNow: 0,
      ratePill: { label: "0% until 14 Mar 2027", amber: false },
      paceMonthly: 45,
      payoffMonth: "2027-11",
      promoUntil: "2027-03",
    },
    {
      accountId: "fx-amex-platinum-cashback",
      name: "Amex Platinum Cashback",
      provider: "amex",
      debt: 1240,
      classification: "carried_interest",
      payingInterest: true,
      monthlyInterestNow: 26,
      ratePill: { label: "24.9%", amber: true },
      paceMonthly: 65,
      payoffMonth: "2028-06",
      promoUntil: null,
    },
  ],
};

// Folded, quiet close for cards that clear in full each cycle — not rows.
export const CLEARED_MONTHLY_CARDS = [{ accountId: "fx-amex-gold", name: "Amex Gold" }];

// True empty state: no material carried debt AND no accounts to fold into a
// closing line either (e.g. no credit cards connected, or every balance is
// zero) — the calm one-line sentence, nothing else on the section.
export const OUTLOOK_CLEAR: OutlookFixture = {
  extraPerMonth: null,
  debtFreeMonth: null,
  cards: [],
};

export const CLEARED_MONTHLY_CLEAR: { accountId: string; name: string }[] = [];

// ── THE TRAJECTORY tail (copied verbatim in grammar from CardsPage.tsx so
// the new section is seen in the context it will actually ship in) ─────────
export const TRAJECTORY_FIXTURE = [
  { period_end: "2026-04-30", delta: 120 },
  { period_end: "2026-05-31", delta: -80 },
  { period_end: "2026-06-30", delta: 45 },
  { period_end: "2026-07-31", delta: -210 },
  { period_end: "2026-08-31", delta: -60 },
  { period_end: "2026-09-09", delta: -140 },
];
