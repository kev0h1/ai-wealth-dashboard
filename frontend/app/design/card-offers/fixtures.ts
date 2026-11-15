/**
 * G471 design-only fixtures. These records are invented and never leave the
 * preview route. Dates are ISO calendar dates so they do not move with a
 * viewer's timezone.
 */
export const PREVIEW_DATE = "2026-11-15";

export type OfferKind = "Balance transfer" | "Purchases" | "Money transfer";

export interface OfferSource {
  file: string;
  label: string;
  page?: number;
  asOf: string;
  note?: string;
}

export interface CardFixture {
  id: string;
  issuer: string;
  name: string;
  last4: string;
  purchaseApr: number;
  cashApr: number;
  statementDate: string;
}

export interface OfferFixture {
  id: string;
  cardId: string;
  type: OfferKind;
  rate: number;
  balance: number;
  endDate: string | null;
  revertRate: number | null;
  source: OfferSource;
  note?: string;
}

export interface ClearingIllustration {
  monthlyPayment: number;
  paymentCount: number;
  firstPaymentDate: string;
  assumptions: string;
}

export const CARDS: CardFixture[] = [
  {
    id: "harbour-platinum",
    issuer: "Harbour Bank",
    name: "Harbour Platinum",
    last4: "4826",
    purchaseApr: 23.9,
    cashApr: 29.9,
    statementDate: "2026-11-12",
  },
  {
    id: "moorland-rewards",
    issuer: "Moorland Credit",
    name: "Moorland Rewards",
    last4: "7391",
    purchaseApr: 24.9,
    cashApr: 29.9,
    statementDate: "2026-11-10",
  },
];

const harbourSource: OfferSource = {
  file: "Harbour illustrative statement.pdf",
  label: "Promotional offers table",
  page: 2,
  asOf: "2026-11-12",
  note: "Synthetic preview statement for Harbour Platinum ending •••• 4826.",
};

const moorlandSource: OfferSource = {
  file: "Moorland illustrative card screen.png",
  label: "Card offers screen",
  asOf: "2026-11-10",
  note: "Synthetic preview screen for Moorland Rewards ending •••• 7391.",
};

export const OFFERS: OfferFixture[] = [
  { id: "harbour-bt-2027", cardId: "harbour-platinum", type: "Balance transfer", rate: 0, balance: 4812.80, endDate: "2027-07-24", revertRate: 23.9, source: harbourSource },
  { id: "harbour-bt-2028", cardId: "harbour-platinum", type: "Balance transfer", rate: 0, balance: 1296.18, endDate: "2028-06-08", revertRate: 23.9, source: harbourSource },
  { id: "moorland-purchases", cardId: "moorland-rewards", type: "Purchases", rate: 0, balance: 312, endDate: "2026-12-15", revertRate: 24.9, source: moorlandSource },
  { id: "moorland-money-transfer", cardId: "moorland-rewards", type: "Money transfer", rate: 3.9, balance: 860, endDate: "2027-02-15", revertRate: 24.9, source: moorlandSource, note: "The rate shown is the recorded promotional rate." },
];


function asUtcDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

function isoFromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatGBP(amount: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "No end date recorded";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(asUtcDate(iso));
}

/** A calendar-distance label for preview only, based on the fixed preview date. */
export function timeLeft(endDate: string | null, fromDate = PREVIEW_DATE): string {
  if (!endDate) return "End date not recorded";
  const days = Math.round((asUtcDate(endDate).getTime() - asUtcDate(fromDate).getTime()) / 86_400_000);
  if (days < 0) return "Ended";
  if (days === 0) return "Ends today";
  if (days === 1) return "1 day left";
  if (days < 31) return `${days} days left`;
  const start = asUtcDate(fromDate);
  const end = asUtcDate(endDate);
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  if (end.getUTCDate() < start.getUTCDate()) months -= 1;
  return `${months} month${months === 1 ? "" : "s"} left`;
}

export function sortOffersByExpiry<T extends { endDate: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (!a.endDate) return b.endDate ? 1 : 0;
    if (!b.endDate) return -1;
    return a.endDate.localeCompare(b.endDate);
  });
}

function nextMonthlyPaymentDate(fromDate: string): Date {
  const from = asUtcDate(fromDate);
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, from.getUTCDate(), 12));
}

/**
 * This is an illustration, never a payment instruction. It intentionally only
 * exists for a current 0% offer with a known future end date.
 */
export function monthlyIllustration(offer: Pick<OfferFixture, "rate" | "balance" | "endDate">, fromDate = PREVIEW_DATE): ClearingIllustration | null {
  if (offer.rate !== 0 || !offer.endDate || offer.balance <= 0) return null;
  const end = asUtcDate(offer.endDate);
  if (end <= asUtcDate(fromDate)) return null;

  let cursor = nextMonthlyPaymentDate(fromDate);
  let paymentCount = 0;
  while (cursor < end) {
    paymentCount += 1;
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate(), 12));
  }
  if (paymentCount < 1) return null;

  return {
    paymentCount,
    firstPaymentDate: isoFromUtc(nextMonthlyPaymentDate(fromDate)),
    monthlyPayment: Math.ceil(offer.balance / paymentCount),
    assumptions: "Illustration only: monthly payments on the same day as this preview, starting next month and before the end date. Rounded up to the next £1. It assumes no new spending or fees, and the recorded balance may differ today.",
  };
}

