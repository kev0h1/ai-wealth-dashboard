import type { CardPromo, CardTermsCard } from "./api";

export type CardOfferListItem = {
  id: string;
  card: CardTermsCard;
  promo: CardPromo;
};

export type MonthlyClearingIllustration = {
  monthlyAmount: number;
  paymentCount: number;
  firstPaymentDate: string;
  lastPaymentDate: string;
};

type CalendarDate = { year: number; month: number; day: number };

function parseISO(iso: string | null | undefined): CalendarDate | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function formatISO(date: CalendarDate): string {
  return `${date.year.toString().padStart(4, "0")}-${date.month.toString().padStart(2, "0")}-${date.day.toString().padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function compareDates(a: CalendarDate, b: CalendarDate): number {
  return formatISO(a).localeCompare(formatISO(b));
}

function addMonthsClamped(original: CalendarDate, offset: number): CalendarDate {
  const zeroBased = original.month - 1 + offset;
  const year = original.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12 + 1;
  return { year, month, day: Math.min(original.day, daysInMonth(year, month)) };
}

/** Flattens the stored per-card promos without treating a whole-card balance as an offer balance. */
export function listCardOffers(cards: CardTermsCard[]): CardOfferListItem[] {
  return cards
    .flatMap((card) => (card.terms?.promos ?? []).map((promo, index) => ({
      id: `${card.account_id}:${promo.id ?? index}`,
      card,
      promo,
    })))
    .sort((a, b) => {
      const aDate = parseISO(a.promo.until);
      const bDate = parseISO(b.promo.until);
      if (!aDate) return bDate ? 1 : a.id.localeCompare(b.id);
      if (!bDate) return -1;
      return formatISO(aDate).localeCompare(formatISO(bDate)) || a.id.localeCompare(b.id);
    });
}

export function offerLabel(promo: Pick<CardPromo, "kind" | "offer_type">): string {
  switch (promo.offer_type) {
    case "purchase": return "Purchases";
    case "balance_transfer": return "Balance transfer";
    case "money_transfer": return "Money transfer";
    case "cash": return "Cash advance";
    default:
      return promo.kind === "balance_transfer" ? "Balance transfer" : promo.kind === "both" ? "Purchases and balance transfers" : "Purchases";
  }
}

export function offerTimeLeft(endDate: string | null | undefined, fromISO: string): string | null {
  const end = parseISO(endDate);
  const from = parseISO(fromISO);
  if (!end || !from) return null;
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const days = Math.round((endMs - fromMs) / 86_400_000);
  if (days < 0) return "Ended";
  if (days === 0) return "Ends today";
  if (days === 1) return "1 day left";
  if (days < 31) return `${days} days left`;
  let months = (end.year - from.year) * 12 + end.month - from.month;
  if (end.day < from.day) months -= 1;
  return `${months} month${months === 1 ? "" : "s"} left`;
}

/**
 * An arithmetic illustration for a known 0% offer, not a repayment plan.
 * Payment dates use the from-date day each month, clamped anew per month.
 */
export function monthlyClearingIllustration(
  promo: Pick<CardPromo, "apr_pct" | "balance" | "until">,
  fromISO: string,
): MonthlyClearingIllustration | null {
  const from = parseISO(fromISO);
  const end = parseISO(promo.until);
  if (!from || !end || promo.apr_pct !== 0 || !Number.isFinite(promo.balance) || (promo.balance ?? 0) <= 0) return null;
  if (compareDates(end, from) <= 0) return null;

  const monthsToExpiry = (end.year - from.year) * 12 + end.month - from.month;
  if (monthsToExpiry < 1) return null;
  const firstPayment = addMonthsClamped(from, 1);
  if (compareDates(firstPayment, end) >= 0) return null;
  const lastPossible = addMonthsClamped(from, monthsToExpiry);
  const paymentCount = compareDates(lastPossible, end) < 0 ? monthsToExpiry : monthsToExpiry - 1;
  if (paymentCount < 1) return null;
  const lastPayment = addMonthsClamped(from, paymentCount);
  return {
    monthlyAmount: Math.ceil((promo.balance as number) / paymentCount),
    paymentCount,
    firstPaymentDate: formatISO(firstPayment),
    lastPaymentDate: formatISO(lastPayment),
  };
}
