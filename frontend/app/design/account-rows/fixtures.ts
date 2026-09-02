// Static fixtures for the account-rows redesign preview (/design/account-rows).
// Mirrors the owner's real /accounts page (2026-08-30 phone screenshots):
// a Pinned band, 6 current accounts, one savings row, and all 7 real credit
// cards, plus one invented 8th card with NO terms recorded to demo the
// "Add APR" entry point. Standalone — no API calls, no auth.

export interface RowFixture {
  id: string;
  name: string;
  provider: string; // BANK_META key resolves via accountBrand()
  kind: "Current" | "Savings" | "Credit";
  balance: number; // credit cards owed render negative, matching live EstateRow.balance
  pinned?: boolean;
  /** Credit-card terms — mirrors CardTermsCard["terms"]. Omit entirely for
   *  the one no-terms fixture card (the "Add APR" entry point). */
  terms?: {
    apr_pct: number | null;
    promos: { apr_pct: number; until: string /* ISO date */ }[];
  };
}

// "Today" the preview reasons against — matches the brief's 2026-08-30 date,
// so Chase's "0% ends 30 Sept" promo reads as genuinely soon (31 days out).
export const TODAY = new Date("2026-08-30T09:00:00");

export const PINNED: RowFixture[] = [
  { id: "pin-1", name: "MAINGI K M", provider: "BARCLAYS", kind: "Current", balance: 2143.5, pinned: true },
  { id: "pin-2", name: "Emergency fund", provider: "HSBC", kind: "Savings", balance: 8210.0, pinned: true },
];

export const CURRENT: RowFixture[] = [
  { id: "cur-1", name: "MAINGI K M", provider: "BARCLAYS", kind: "Current", balance: 2143.5 },
  { id: "cur-2", name: "THE NUMBER ONE", provider: "NATWEST", kind: "Current", balance: 5210.0 },
  { id: "cur-3", name: "Personal GBP", provider: "HSBC", kind: "Current", balance: 812.4 },
  { id: "cur-4", name: "Kevin Maingi", provider: "REVOLUT", kind: "Current", balance: 276.15 },
  { id: "cur-5", name: "Personal", provider: "STARLING", kind: "Current", balance: 2033.77 },
  { id: "cur-6", name: "Kevin Mbithi Maingi", provider: "MONZO", kind: "Current", balance: -84.2 },
];

// One "savings summary row" per the brief — a single row standing in for
// the Savings group.
export const SAVINGS: RowFixture[] = [
  { id: "sav-1", name: "Emergency fund", provider: "HSBC", kind: "Savings", balance: 8210.0 },
];

// The 7 real credit cards from the brief, balances back-solved so the
// group subtotal lands on the owner's real -£24,414, plus one invented
// no-terms card (Halifax Clarity) for the "Add APR" affordance demo.
export const CREDIT: RowFixture[] = [
  {
    id: "cc-amex-1",
    name: "Platinum Card",
    provider: "AMEX",
    kind: "Credit",
    balance: -129,
    terms: { apr_pct: 24.9, promos: [] },
  },
  {
    id: "cc-amex-2",
    name: "Everyday Card",
    provider: "AMEX",
    kind: "Credit",
    balance: -640,
    terms: { apr_pct: 29.1, promos: [] },
  },
  {
    id: "cc-chase",
    name: "Chase Credit Card",
    provider: "CHASE",
    kind: "Credit",
    balance: -877,
    terms: { apr_pct: 27.9, promos: [{ apr_pct: 0, until: "2026-09-30" }] },
  },
  {
    id: "cc-barclays",
    name: "Barclaycard IBCM",
    provider: "BARCLAYS",
    kind: "Credit",
    balance: -3116,
    terms: { apr_pct: 26.9, promos: [{ apr_pct: 0, until: "2027-05-31" }] },
  },
  {
    id: "cc-natwest-1",
    name: "NatWest Credit Card",
    provider: "NATWEST",
    kind: "Credit",
    balance: -6160,
    terms: { apr_pct: 25.9, promos: [{ apr_pct: 0, until: "2027-08-31" }] },
  },
  {
    id: "cc-natwest-2",
    name: "NatWest Credit Card ••92",
    provider: "NATWEST",
    kind: "Credit",
    balance: -7139,
    terms: { apr_pct: 25.9, promos: [{ apr_pct: 0, until: "2027-08-31" }] },
  },
  {
    id: "cc-hsbc",
    name: "HSBC Credit Card",
    provider: "HSBC",
    kind: "Credit",
    balance: -6353,
    terms: { apr_pct: 26.4, promos: [{ apr_pct: 0, until: "2027-10-31" }] },
  },
  {
    id: "cc-halifax",
    name: "Halifax Clarity",
    provider: "HALIFAX",
    kind: "Credit",
    balance: -245,
    // No terms object at all — mirrors CardTermsCard.terms.status !== "confirmed".
  },
];

export function subtotal(rows: RowFixture[]): number {
  return rows.reduce((sum, r) => sum + r.balance, 0);
}

/** Days between TODAY and an ISO date (promo end), ceil-rounded — matches
 *  AccountsPage's termsPillFor. */
export function daysUntil(iso: string): number {
  const end = new Date(`${iso}T00:00:00`);
  return Math.ceil((end.getTime() - TODAY.getTime()) / 86_400_000);
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}
function fmtLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export interface TermsRead {
  /** True when this card is on a real, unrestricted APR right now — no
   *  active 0% cover — so interest is genuinely accruing on the balance. */
  accruingInterest: boolean;
  /** True when the soonest active promo ends within 60 days (matches the
   *  live termsPillFor amber threshold). */
  expiringSoon: boolean;
  /** Confirmed-terms label, e.g. "0% ends 30 Sep" / "24.9% APR". Null when
   *  there's no confirmed terms at all (the "Add APR" card). */
  label: string | null;
  daysLeft: number | null;
}

/** Reads a fixture's terms the same way AccountsPage's termsPillFor does,
 *  but also exposes the accruingInterest / expiringSoon facts each variant
 *  needs to take its own red-doctrine position. */
export function readTerms(row: RowFixture): TermsRead {
  const t = row.terms;
  if (!t) return { accruingInterest: false, expiringSoon: false, label: null, daysLeft: null };

  const active = (t.promos ?? [])
    .map((p) => ({ ...p, days: daysUntil(p.until) }))
    .filter((p) => p.days >= 0)
    .sort((a, b) => a.days - b.days);

  if (active.length > 0) {
    const soonest = active[0];
    const expiringSoon = soonest.days <= 60;
    const label = expiringSoon
      ? `0% ends ${fmtShort(soonest.until)}`
      : `0% until ${fmtLong(soonest.until)}`;
    return { accruingInterest: false, expiringSoon, label, daysLeft: soonest.days };
  }

  if (t.apr_pct != null) {
    return { accruingInterest: true, expiringSoon: false, label: `${t.apr_pct}% APR`, daysLeft: null };
  }
  return { accruingInterest: false, expiringSoon: false, label: null, daysLeft: null };
}
