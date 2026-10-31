# G385 account availability and shortfall

This is a design-only round, guided by impeccable and constrained by PRODUCT.md and DESIGN.md. It does not change Accounts, Home, APIs or saved data.

## The financial distinction

`spend_from_headroom` is the conservative, pooled Spend from limit. It is already floored at zero and accounts for earlier low points, plans and an active cover-plan move. It is the only source for **Available**. It must not be recalculated from the bank balance, `headroom`, or a projected payday balance.

The account position separately provides `after_payments_and_plans` and `low_point_and_plans`. When a known payment makes an account fall below zero, G385 pairs the zero Available figure with the positive shortfall before payday. The calculation remains behind **Working**. A plans-only gap is informational and amber, not a red payment risk.

## Variants

- **A, Paired figures** keeps the established balance-over-Available account row. Its second compact line says `£289 short before payday` only for a known payment risk. This is recommended because the two related facts can be read together without turning the row into a card.
- **B, Verdict line** puts a plain-language sentence below Available. It is more explicit but costs a little more vertical space.

Both show the same sentence in Accounts, Home's **Your estate**, and account detail. Rows use whole-pound rounding consistently for the bank balance, Available and the shortfall; **Working** retains exact pence. A six-pence covered fixture proves that the floor is not confused with a plans gap. A cover-plan link appears only where a move is actually suggested. Loading, unknown, error, hidden amounts, payment shortfall and plans-gap fixtures are included in the preview controls.
