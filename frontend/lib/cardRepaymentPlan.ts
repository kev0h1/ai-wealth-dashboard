// G475: card repayment plans. A plan is a commitment whose target is a card, so
// it reuses the goal sheet; this file holds the few pure helpers and every
// word the Debt row and the sheet say about one. Copy rules: British English,
// no em dashes, no exclamation marks, predictions are hedged ("about",
// "would"), never advice to pay a particular card, red is not used here.
import type { Account, CardPlanFacts, Commitment } from "@/lib/api";

export const CARD_PLAN_KIND = "card_repayment";

export function isCardPlan(item: Pick<Commitment, "plan_kind"> | null | undefined): boolean {
  return item?.plan_kind === CARD_PLAN_KIND;
}

/** A credit card, by the same type and subtype words the rest of the app reads. */
export function isCardAccount(account: Pick<Account, "type" | "subtype">): boolean {
  return `${account.type ?? ""} ${account.subtype ?? ""}`.toLowerCase().includes("credit");
}

const gbp = (value: number) => `£${Math.round(value).toLocaleString("en-GB")}`;
const gbp2 = (value: number) => `£${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function longDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : "date unavailable";
}

/** "£150 a pay period" or "£150 each pay period (monthly)": the plan's amount for the live period. */
export function planAmountLine(facts: CardPlanFacts | null | undefined, periodLabel: string | null | undefined): string {
  const planned = facts?.this_period_planned;
  if (planned == null) return "Amount unavailable";
  const cadence = periodLabel ? `each pay period (${periodLabel})` : "a pay period";
  return `${gbp(planned)} ${cadence}`;
}

/** What has been paid towards this period's amount. Never a promise. */
export function paidLine(facts: CardPlanFacts | null | undefined): string | null {
  if (!facts || facts.this_period_planned == null) return null;
  const paid = facts.paid_this_period ?? 0;
  if (paid <= 0) return "Nothing paid yet this pay period";
  return `${gbp2(paid)} paid this pay period`;
}

/** "would clear by Mar 2028": hedged, and silent when the balance is cleared or no month is known. */
export function projectedMonthLine(facts: CardPlanFacts | null | undefined): string | null {
  if (!facts?.would_clear_by) return null;
  return `At this pace it would clear by about ${facts.would_clear_by}`;
}

/** A fact about an offer with an end date, never advice. Null when the card has none. */
export function offerLine(facts: CardPlanFacts | null | undefined): string | null {
  const promo = facts?.promo;
  if (!promo) return null;
  const by = `${gbp(promo.planned_by_end)} by ${longDate(promo.until)}`;
  const against = promo.balance_is_offer ? "the offer balance" : "the card balance";
  if (promo.clears_before_end) {
    return `The offer ends ${longDate(promo.until)}. The plan would pay about ${by}, which would cover ${against} of about ${gbp(promo.balance)}.`;
  }
  const left = Math.max(0, promo.balance - promo.planned_by_end);
  return `The offer ends ${longDate(promo.until)}. The plan would pay about ${by}, which would leave about ${gbp(left)} of ${against} when it ends.`;
}

/** What the sheet says about where a prefilled amount came from. */
export function prefillBasisLine(basis: string | null | undefined, estimated: boolean): string | null {
  if (!basis) return null;
  const what = basis === "direct_debit" ? "your usual direct debit" : basis === "fixed_payment" ? "the fixed payment on this card" : "the statement estimate";
  return `${estimated ? "About, from" : "From"} ${what}. Change it if you like.`;
}

export const CARD_PLAN_COPY = {
  setPlan: "Set a plan",
  debtFootnote: "The amounts above add up to the total owed. Balances stay in Accounts. Each card can have one repayment plan, set here.",
  emptyHint: "A plan replaces that card's usual payment in your figures, so it is counted once.",
  deleteConfirm: "Delete this plan? That card's usual payment counts again. Nothing is paid or moved.",
  purpose: "Choose a card",
  noCards: "No credit card is connected. Connect a card in Accounts first.",
  allCardsHavePlans: "Every connected card already has a plan.",
  moneyNote: "Saving changes this plan only. It does not move money.",
} as const;
