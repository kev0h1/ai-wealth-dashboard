/**
 * The single definition of what does / does not move the pooled spendable
 * cash total, shared by every pooled-walk consumer in
 * app/planning/PlanningPage.tsx (the runway hero's own walk, and its
 * row-by-row ledger). Pulled into its own module so it can be imported by a
 * framework-free node test, the same pattern as lib/pennyScreenViews.ts and
 * scripts/penny-screen-views.test.mjs.
 */

/**
 * A traced internal transfer whose destination lands inside the same
 * spendable pool as its source is a POOLED NO-OP: the money never enters or
 * leaves the "everywhere" total tracked by the pooled walk in
 * PlanningPage.tsx, it only reallocates within it. Strict `=== true`: a
 * missing or null `dest_account_spendable` means the destination was never
 * traced (untraced movement, or one bound for a savings pot), so it keeps
 * the ordinary debiting behaviour rather than guessing. This is the single
 * place allowed to interpret the dest_account_spendable pair, every
 * pooled-walk consumer must call this rather than re-deriving the rule
 * inline, so the definition of "no-op" cannot drift between them. Per-
 * account walks (atRiskWalks, accountShortfalls in PlanningPage.tsx) do NOT
 * use this: a destination account genuinely receives the money, so
 * per-account risk still needs both legs regardless of this flag.
 */
export function isPooledNoOp(item: { kind?: string; dest_account_spendable?: boolean | null }): boolean {
  return item.kind === "movement" && item.dest_account_spendable === true;
}

/**
 * G109 (2026-09-16, owner-reported: a £180 Anthropic charge on the Amex
 * dropped projected cash from £603 to £423 with no cash moving, then the
 * separate Amex repayment from Barclays dropped it again): whether an item
 * touches the pooled spendable cash total at all, for the runway hero and
 * its row-by-row ledger. False for a POOLED NO-OP transfer (isPooledNoOp,
 * above) or for a bill sitting ON a credit card (is_credit_card): a card
 * charge only moves a limit, no cash has left any bank account yet. A
 * repayment TO a card is a plain debit on the paying (non-card) account —
 * its own `is_credit_card` is false, so it is untouched by this check and
 * keeps reducing the walk, same cash-led rule as `_touches_pooled_cash` on
 * the backend (backend/app/routers/analytics.py). Every pooled cash-walk
 * consumer must call this rather than re-deriving the rule inline,
 * mirroring isPooledNoOp's own single-source-of-truth contract. Per-account
 * walks (atRiskWalks, accountShortfalls) already exclude `is_credit_card`
 * bills at their own source query, independently of this helper.
 */
export function doesNotTouchCash(item: { kind?: string; dest_account_spendable?: boolean | null; is_credit_card?: boolean | null }): boolean {
  return isPooledNoOp(item) || item.is_credit_card === true;
}
