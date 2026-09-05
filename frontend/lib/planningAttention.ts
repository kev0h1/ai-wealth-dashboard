// Pure helpers for Planning's "needs a look" signals — the jump strip's
// dots trace back to these, and so did the planning-ladder design preview
// before variant A shipped. No React, no fetches: every function takes the
// facts the caller already has (a DebtPlanSummary, a Commitment list,
// "today") and returns a fact or a boolean, so the live Planning tab and
// the preview (now re-pointed at these) share one implementation instead of
// two that can drift.

import type { Commitment, DebtPlanSummary } from "@/lib/api";

/** Walks every card's rate_schedule for the earliest still-future "promo"
 *  segment end date. `today` is a parameter, never `new Date()` read inside
 *  this module, so callers (and the design preview pinning a fixed date)
 *  get a deterministic answer. */
export function findEarliestPromoCliff(
  debtSummary: DebtPlanSummary | null,
  today: Date
): { name: string; until: Date; balance: number } | null {
  if (!debtSummary) return null;
  let earliest: { name: string; until: Date; balance: number } | null = null;
  for (const card of debtSummary.cards) {
    for (const segment of card.rate_schedule) {
      if (segment.source !== "promo" || !segment.until) continue;
      const [year, monthNum] = segment.until.split("-").map(Number);
      // End of the last day of that "YYYY-MM", not local midnight — midnight
      // would put the cliff "in the past" for the entirety of its own last
      // day, switching the dot off hours before the offer actually ends.
      const untilDate = new Date(year, monthNum, 0, 23, 59, 59, 999);
      if (Number.isNaN(untilDate.getTime()) || untilDate.getTime() < today.getTime()) continue;
      if (!earliest || untilDate.getTime() < earliest.until.getTime()) {
        earliest = { name: card.name, until: untilDate, balance: card.debt };
      }
    }
  }
  return earliest;
}

/** True when a cliff date falls within "this month" or the next 30 days of
 *  `today` — the one window every "is this cliff soon" check in Planning
 *  gates on. */
export function isCliffSoon(until: Date, today: Date): boolean {
  const daysAway = (until.getTime() - today.getTime()) / 86_400_000;
  const sameMonth = until.getFullYear() === today.getFullYear() && until.getMonth() === today.getMonth();
  return sameMonth || daysAway <= 30;
}

/** The Debt chip's dot balance floor. A live 0% cliff is a fact regardless
 *  of size, but the owner's own card data has a card literally named
 *  "Credit Card" carrying a real promo cliff on a balance of about £43 —
 *  dotting the Debt chip for that would be technically honest and
 *  practically useless, training the user to stop trusting the dot. £250 is
 *  a deliberately round, hand-picked floor, not a computed one. */
export const minCliffBalance = 250;

/** True when a long-term goal is running behind its own pace — the same
 *  three-way check GoalRow already badges a row with, reused here so the
 *  jump strip's Goals dot can never drift from what the goals list itself
 *  already signals. */
export function goalNeedsLook(goal: Commitment): boolean {
  return goal.feasibility_tone === "caution" || goal.feasibility === "stretch" || !goal.on_track;
}

/** True when the debt section has a 0% offer worth a look: a promo cliff
 *  landing this month or within 30 days, on a card carrying at least
 *  `minCliffBalance`. Filters to cards past the balance floor FIRST, then
 *  finds the earliest cliff among only those — so a soon, material cliff
 *  is never masked by an earlier cliff sitting on a trivial balance
 *  elsewhere. `debt` accepts the loading (`undefined`) and failed (`null`)
 *  states the live tab's fetch can be in; both read as "nothing to dot"
 *  rather than throwing. */
export function debtNeedsLook(debt: DebtPlanSummary | null | undefined, today: Date): boolean {
  if (!debt) return false;
  const materialCards = debt.cards.filter((card) => card.debt >= minCliffBalance);
  const cliff = findEarliestPromoCliff({ ...debt, cards: materialCards }, today);
  return !!cliff && isCliffSoon(cliff.until, today);
}
