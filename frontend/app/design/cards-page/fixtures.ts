// TEMPORARY PREVIEW FIXTURES — delete after design review.
//
// G10 round 2: Kevin viewed /design/cards-outlook (the earlier round) and
// asked to see the WHOLE Cards page with the variants in place, not just
// the new section against a 3-card fixture — his real page has seven cards
// and a second full list (Variants A/B) repeats that list, which the old
// fixture hid. This fixture set is structurally identical to the real
// /cards page (CardsStory shape, lib/api.ts) plus an "outlook" layer
// (structurally identical to the retired debt page's compute_debt_plan
// shape, same as cards-outlook/fixtures.ts) keyed onto the same card ids.
// All figures are illustrative, not Kevin's real balances — magnitudes
// only, changed from the actual numbers.
//
// CARD_META is the single source of truth for each fixture card's identity
// (id, provider, raw bank-descriptor name, proposed clean name) so PER_CARD
// and OUTLOOK_CARDS both key off accountId and never duplicate a name
// string that could drift between the two.

export type CardMeta = {
  accountId: string;
  provider: string;
  /** Exactly what the live page shows today — raw bank descriptor. */
  rawName: string;
  /** names=clean proposal: bank name + a distinguishing suffix (last4 when
   *  the fixture carries one), shouty ALL-CAPS descriptors title-cased. */
  cleanName: string;
};

// Order matches WHERE IT MOVED's real ordering (largest movement first,
// including two identically-named NatWest "MASTERCARD" cards — the
// duplicate is deliberate, it's the reason this round's names=raw|clean
// toggle exists).
export const CARD_META: CardMeta[] = [
  { accountId: "fx-hsbc-1", provider: "hsbc", rawName: "SMITH,JOHN A/MR", cleanName: "Smith, John A" },
  { accountId: "fx-natwest-1", provider: "natwest", rawName: "MASTERCARD", cleanName: "NatWest Mastercard 4821" },
  { accountId: "fx-amex-ba", provider: "amex", rawName: "British Airways American Express® C", cleanName: "Amex British Airways" },
  { accountId: "fx-natwest-2", provider: "natwest", rawName: "MASTERCARD", cleanName: "NatWest Mastercard 0219" },
  { accountId: "fx-barclays-ibcm", provider: "barclays", rawName: "IBCM PLATINUM", cleanName: "IBCM Platinum" },
  { accountId: "fx-amex-corp-green", provider: "amex", rawName: "American Express® Corporate Green C", cleanName: "Amex Corporate Green" },
  { accountId: "fx-chase-cc", provider: "chase", rawName: "Credit Card", cleanName: "Chase Credit Card" },
];

export function metaFor(accountId: string): CardMeta {
  const m = CARD_META.find((c) => c.accountId === accountId);
  if (!m) throw new Error(`No CARD_META for ${accountId}`);
  return m;
}

export function nameFor(accountId: string, namesMode: "raw" | "clean"): string {
  const m = metaFor(accountId);
  return namesMode === "clean" ? m.cleanName : m.rawName;
}

// ── Section 1: period ────────────────────────────────────────────────────
export const PERIOD = { start: "2026-08-28", end: "2026-09-24", days_elapsed: 13 };

// ── Section 2: movement headline ────────────────────────────────────────
export const MOVEMENT = { delta: 1205, new_spend: 1325, payments: 120 };

// ── Section 3: WHERE IT MOVED (balance follows the flipped TrueLayer
// convention CardsPage.tsx already uses — negative = owed) ─────────────
export type FixtureCard = { account_id: string; balance: number; delta: number; apr: number | null };

export const PER_CARD: FixtureCard[] = [
  { account_id: "fx-hsbc-1", balance: -6783, delta: 430, apr: null },
  { account_id: "fx-natwest-1", balance: -7552, delta: 413, apr: null },
  { account_id: "fx-amex-ba", balance: -1064, delta: 394, apr: null },
  { account_id: "fx-natwest-2", balance: -6160, delta: -62, apr: null },
  { account_id: "fx-barclays-ibcm", balance: -3116, delta: 0, apr: null },
  { account_id: "fx-amex-corp-green", balance: -100, delta: 0, apr: null },
  { account_id: "fx-chase-cc", balance: -179, delta: 0, apr: null },
];

// ── Section 4: WHAT DROVE IT ────────────────────────────────────────────
export const DRIVERS = [
  { category: "Shopping", total: 410 },
  { category: "Entertainment", total: 310 },
  { category: "Groceries", total: 260 },
  { category: "Subscriptions", total: 180 },
  { category: "Bills", total: 165 },
];

export const PATTERN_LINE =
  "Your credit card use ramps up through the month as cash flow tightens after payday.";

// ── Section 5: THE TRAJECTORY — three closed cycles, all growth (no
// green): Jun, Jul, Aug ─────────────────────────────────────────────────
export const TRAJECTORY = [
  { period_end: "2026-06-30", delta: 210 },
  { period_end: "2026-07-31", delta: 165 },
  { period_end: "2026-08-27", delta: 340 },
];

// ── Section 6 (proposed): outlook layer, keyed onto CARD_META's ids ────
//
// classification / payingInterest / monthlyInterestNow / ratePill /
// paceMonthly / payoffMonth / promoUntil mirror the retired debt page's
// compute_debt_plan(uid) shape (backend/app/services/debt_plan.py),
// same field meanings as cards-outlook/fixtures.ts. payoffMonth is the
// "at your current demonstrated pace" projection per card — it can land
// later than the aggregate debtFreeMonth below, which assumes the extra
// £/month is actually applied; that's the same relationship the original
// outlook fixture used (an individually slow card, cleared sooner in the
// aggregate "with extra" scenario).
export type RatePill = { label: string; amber: boolean };

export type OutlookCard = {
  accountId: string;
  classification: "carried_zero" | "carried_interest" | "cleared_monthly";
  payingInterest: boolean;
  monthlyInterestNow: number;
  ratePill: RatePill;
  paceMonthly: number | null;
  payoffMonth: string | null; // "YYYY-MM"
  promoUntil: string | null; // "YYYY-MM"
};

// "Today" this fixture set is built around, for Variant B's month rail.
export const FIXTURE_TODAY = "2026-09-09";

// Five carried cards (nonzero, genuinely rolling a balance forward). The
// two smallest (Amex Corporate Green, Chase) clear in full each cycle —
// see CLEARED_MONTHLY below — so they carry no outlook row of their own.
export const OUTLOOK_CARDS: OutlookCard[] = [
  {
    accountId: "fx-hsbc-1",
    classification: "carried_zero",
    payingInterest: false,
    monthlyInterestNow: 0,
    ratePill: { label: "Not charged this cycle", amber: false },
    paceMonthly: 140,
    payoffMonth: "2027-10",
    promoUntil: null,
  },
  {
    accountId: "fx-natwest-1",
    classification: "carried_interest",
    payingInterest: true,
    monthlyInterestNow: 168,
    ratePill: { label: "27.9%", amber: true },
    paceMonthly: 90,
    payoffMonth: "2028-03",
    promoUntil: null,
  },
  {
    accountId: "fx-amex-ba",
    classification: "carried_zero",
    payingInterest: false,
    monthlyInterestNow: 0,
    ratePill: { label: "0% until 18 Feb 2027", amber: false },
    paceMonthly: 120,
    payoffMonth: "2027-01",
    promoUntil: "2027-02",
  },
  {
    accountId: "fx-natwest-2",
    classification: "carried_zero",
    payingInterest: false,
    monthlyInterestNow: 0,
    ratePill: { label: "Not charged this cycle", amber: false },
    paceMonthly: 95,
    payoffMonth: "2028-01",
    promoUntil: null,
  },
  {
    accountId: "fx-barclays-ibcm",
    classification: "carried_zero",
    payingInterest: false,
    monthlyInterestNow: 0,
    ratePill: { label: "Not charged this cycle", amber: false },
    paceMonthly: 70,
    payoffMonth: "2027-09",
    promoUntil: null,
  },
];

// Folded, quiet close for cards that clear in full each cycle — not rows.
export const CLEARED_MONTHLY: { accountId: string }[] = [
  { accountId: "fx-amex-corp-green" },
  { accountId: "fx-chase-cc" },
];

export const EXTRA_PER_MONTH = 95;
export const DEBT_FREE_MONTH = "2027-06"; // "YYYY-MM"
