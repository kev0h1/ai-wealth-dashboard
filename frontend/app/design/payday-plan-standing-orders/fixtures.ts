// G173 fixtures — the payday plan speaking against Kevin's own standing
// orders. Kevin's real 2026-08-10 observed payday ritual (salary + eight
// destinations, each with its own standing order and, where he gave one, its
// own stated need) plus ONE invented ninth row demonstrating the "needs a
// standing order but has none" case his real accounts don't happen to show.
//
// Field-by-field provenance (so a reviewer never has to guess):
// - `standingOrder` is what Kevin's note says the standing order sends on
//   payday. Real for all eight of his own destinations (`standingOrderObserved:
//   true`); the ninth (Council Tax Reserve) has none at all, which is the
//   point of that row.
// - `needsTotal` is "what the account needs this period" — bills + typical
//   spend + buffer for a bills/spending account (this is exactly the backend's
//   own `target` field, companion.py's `_acct_bills`/`everyday_spend`/
//   `payday_buffer` sum), or the ritual amount itself for a savings/investment
//   pot (the backend's savings branch: target mirrors the habitual transfer,
//   never balance-filled). `needsTotalObserved: true` only for NatWest, where
//   Kevin stated the total directly ("needs about £596"), and for every
//   savings/investment pot, where the "need" is definitionally the observed
//   ritual amount. Every other `needsTotal` (HSBC, Monzo's buffer portion,
//   NatWest's own payments/spend/buffer split, Council Tax Reserve) is
//   INVENTED for this preview, marked illustrative on the `breakdown` object.
export type DestKind = "bills" | "spending" | "savings" | "investment";

export interface FixtureBreakdown {
  billsTotal: number;
  spendTypical: number;
  buffer: number;
  /** True when any part of this split was invented for the preview rather
   *  than given by Kevin. The TOTAL can still be real even when the split
   *  isn't — see `needsTotalObserved` on the parent row. */
  illustrative: boolean;
}

export interface FixtureDest {
  id: string;
  name: string;
  provider: string;
  kind: DestKind;
  hasStandingOrder: boolean;
  standingOrder: number;
  standingOrderObserved: boolean;
  needsTotal: number;
  needsTotalObserved: boolean;
  breakdown?: FixtureBreakdown;
  /** A cadence that isn't "on payday itself" — Vanguard lands ~3 days later. */
  cadenceNote?: string;
  /** The one invented row (Council Tax Reserve) demonstrating the "needs a
   *  standing order but has none" case — excluded from every real total. */
  illustrativeExample?: boolean;
}

export const SALARY = {
  name: "Premier Current Account",
  provider: "Barclays",
  amount: 4798,
};

export const DESTS: FixtureDest[] = [
  {
    id: "hsbc-bills",
    name: "Household bills account",
    provider: "HSBC",
    kind: "bills",
    hasStandingOrder: true,
    standingOrder: 1885,
    standingOrderObserved: true,
    needsTotal: 1587,
    needsTotalObserved: false,
    breakdown: { billsTotal: 1587, spendTypical: 0, buffer: 0, illustrative: true },
  },
  {
    id: "monzo-spending",
    name: "Everyday spending",
    provider: "Monzo",
    kind: "spending",
    hasStandingOrder: true,
    standingOrder: 1106,
    standingOrderObserved: true,
    needsTotal: 1106,
    needsTotalObserved: false,
    // spendTypical (£1,016) is Kevin's real usual-spend median for this
    // account; the £90 buffer is invented to complete the split.
    breakdown: { billsTotal: 0, spendTypical: 1016, buffer: 90, illustrative: true },
  },
  {
    id: "natwest-bills",
    name: "Second bills account",
    provider: "NatWest",
    kind: "bills",
    hasStandingOrder: true,
    standingOrder: 910,
    standingOrderObserved: true,
    needsTotal: 596,
    // Kevin gave this total directly ("needs about £596") — the only
    // observed TOTAL among the invented-breakdown rows.
    needsTotalObserved: true,
    breakdown: { billsTotal: 460, spendTypical: 86, buffer: 50, illustrative: true },
  },
  {
    id: "rainy-day-saver",
    name: "Rainy Day Saver",
    provider: "Monzo",
    kind: "savings",
    hasStandingOrder: true,
    standingOrder: 100,
    standingOrderObserved: true,
    needsTotal: 100,
    needsTotalObserved: true,
  },
  {
    id: "chase-saver",
    name: "Chase",
    provider: "Chase",
    kind: "savings",
    hasStandingOrder: true,
    standingOrder: 50,
    standingOrderObserved: true,
    needsTotal: 50,
    needsTotalObserved: true,
  },
  {
    id: "revolut-saver",
    name: "Revolut",
    provider: "Revolut",
    kind: "savings",
    hasStandingOrder: true,
    standingOrder: 20,
    standingOrderObserved: true,
    needsTotal: 20,
    needsTotalObserved: true,
  },
  {
    id: "crypto-com",
    name: "Crypto.com",
    provider: "Crypto.com",
    kind: "investment",
    hasStandingOrder: true,
    standingOrder: 25,
    standingOrderObserved: true,
    needsTotal: 25,
    needsTotalObserved: true,
  },
  {
    id: "vanguard",
    name: "Vanguard",
    provider: "Vanguard",
    kind: "investment",
    hasStandingOrder: true,
    standingOrder: 400,
    standingOrderObserved: true,
    needsTotal: 400,
    needsTotalObserved: true,
    cadenceNote: "Sent about 3 days after payday, not on payday itself.",
  },
  {
    id: "council-tax-reserve",
    name: "Council Tax Reserve",
    provider: "Starling",
    kind: "bills",
    hasStandingOrder: false,
    standingOrder: 0,
    standingOrderObserved: false,
    needsTotal: 150,
    needsTotalObserved: false,
    breakdown: { billsTotal: 150, spendTypical: 0, buffer: 0, illustrative: true },
    illustrativeExample: true,
  },
];

/** A destination "needs a change" once the gap between what the standing
 *  order sends and what the account needs reaches £100 — small variances
 *  (Monzo's £0 gap here, after its invented buffer closes it) aren't worth
 *  touching a standing order over. This threshold is a preview design
 *  decision, not a backend rule. */
export const CHANGE_THRESHOLD = 100;

export function delta(d: FixtureDest): number {
  return d.standingOrder - d.needsTotal;
}

export type Bucket = "change" | "about-right" | "start";

export function bucketOf(d: FixtureDest): Bucket {
  if (!d.hasStandingOrder) return "start";
  return Math.abs(delta(d)) >= CHANGE_THRESHOLD ? "change" : "about-right";
}

export function buildVerdict(dests: FixtureDest[]) {
  const real = dests.filter((d) => !d.illustrativeExample);
  const changed = real.filter((d) => bucketOf(d) === "change");
  const aboutRight = real.filter((d) => bucketOf(d) === "about-right");
  const start = dests.filter((d) => bucketOf(d) === "start");
  const totalLess = changed.reduce((sum, d) => sum + delta(d), 0);
  return { changed, aboutRight, start, totalLess };
}

export function breakdownParts(b: FixtureBreakdown): string[] {
  const parts: string[] = [];
  if (b.billsTotal > 0) parts.push(`£${b.billsTotal.toLocaleString("en-GB")} payments`);
  if (b.spendTypical > 0) parts.push(`~£${b.spendTypical.toLocaleString("en-GB")} spending`);
  if (b.buffer > 0) parts.push(`£${b.buffer.toLocaleString("en-GB")} buffer`);
  return parts;
}
