import { upcomingDisplayName } from "./upcomingDisplayName";

/**
 * G266: a credit card repayment is a payment at risk for coverage (a missed
 * one carries fees and interest), even though the server keeps its kind as
 * "movement" so Spend totals and the pooled Safe to Spend walk never count it
 * as spending. The server sets `is_card_repayment`; this is the one reader.
 */
export function isCardRepayment(item: { kind?: string; is_card_repayment?: boolean | null }): boolean {
  return item.kind === "movement" && item.is_card_repayment === true;
}

/** True for an own-account move (savings top-up, pot transfer) that may simply stay put. */
export function isOptionalMove(item: { kind?: string; is_card_repayment?: boolean | null }): boolean {
  return item.kind === "movement" && !isCardRepayment(item);
}

/** G426/G434: a recurring transfer into the user's own non-spendable (savings or investment) account: a learned own destination that is not spendable; with none learned, the server's own-savings-held-elsewhere stamp (user filed it as Savings or Investment, or wording plus own-money evidence). An engine-assigned category alone never counts. Mirrors the backend `is_savings_order`. */
export function isSavingsOrder(item: { kind?: string; category?: string | null; own_savings_elsewhere?: boolean | null; is_card_repayment?: boolean | null; dest_account_id?: string | null; dest_account_spendable?: boolean | null }): boolean {
  if (!isOptionalMove(item)) return false;
  if (item.dest_account_id) return item.dest_account_spendable !== true;
  return item.own_savings_elsewhere === true;
}

/** "NW World Mastercard repayment", without doubling the word when the series already says it. */
export function repaymentLabel(item: { name: string; display_name?: string | null }): string {
  const name = upcomingDisplayName(item);
  return /repayment/i.test(name) ? name : `${name} repayment`;
}

/** "28 Oct" from an ISO date. */
export function shortDayMonth(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date)
    : "an unknown date";
}
