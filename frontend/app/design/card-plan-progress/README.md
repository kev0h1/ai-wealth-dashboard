# Card repayment-plan progress preview

Temporary, fixture-only G492 design round. The route is registered as `/design/card-plan-progress` and supports `?variant=a|b|c&state=ready|future|paused|loading|stale|unavailable|empty|hidden|long&mode=light|dark&hide=0|1`. `state=hidden` aliases ready data with figures hidden; `hide=1` independently preserves privacy through every other state.

## The three proposals

- **A, Two tracks** puts separately labelled Repaid and Expected by now rails on the same supplied 0–100 scale. It has no floating marker or legend to decode. A paused plan retains only its neutral historical Repaid track.
- **B, Compact ring** puts an actual recorded-repayment ratio beside the exact Repaid amount and target. The SVG uses the supplied precomputed percentage directly; expected pace remains in Details.
- **C, Figures only** makes the exact Repaid amount and target the reading, with no chart, ring, marker or percentage.

All proposals keep names wrapping rather than truncating, show the offer deadline once, and retain the same payment and short-outlook row structure. The displayed repayment treatment follows the backend outlook: emerald on pace, amber when behind or projected short, and slate while paused or before the start. Financial figures stay ink. Active progress uses a dated, confirmed single-offer starting target whose matched repayments reconcile exactly to the bank balance. A future target is explicitly provisional and is not retained before the plan starts. A separate known-plan row stays neutral and unavailable when several active offers make allocation unsafe.

Future rows visibly qualify both target and outlook as provisional until the plan starts. The qualifier is precomputed, appears beside the target, forms part of the row description and progressbar name, and also describes the projected status.

## Fixture contract

All monetary amounts, percentages, marker positions, projected residuals and status strings are precomputed fictional fixture fields. Run `backend/.venv/bin/python frontend/app/design/card-plan-progress/generate_fixtures.py` from the repository root to regenerate `generated-fixtures.json` through the real pure backend calculator. The generator makes no database calls and forces a disposable test database name before importing backend modules. The browser does no financial calculation, division or residual derivation. `ready` demonstrates £1,200 of £5,691 and £627 of £7,402 matched since plan start, with current remaining offer balances £4,491 and £6,775 and a reconciled £12,466 debt total including the £1,200 balance of the third, progress-unavailable card. `future` pins the reported shape: as of 23 November 2026, current pay period 30 October to 26 November, first payment 27 November, current-period planned £0, future schedules £30.71/£62.70, £0 of £3,024/£7,402 progress and marker, and precomputed £214.97/£627 projections with £2,809.03/£6,775 residuals. The future total is £11,626 including the third card. The active shortfall example has £62.70 recurring, £689.70 of future scheduled payments and a £6,085.30 residual. The surrounding Daily Challenge background example says £61 of £871 by 16 January and is explicitly fictional, not a claim about a live user record.

`hide=1` replaces money with plain “Payment hidden”, “Figures hidden” or “Hidden” wording and removes all graphical monetary progress, percentage ARIA and percentage styles, including in the SheetFrame detail. It preserves non-money dates and status facts, including a paused state. `loading` is a separate skeleton, while failed-read `unavailable` is separate again. The known-plan unavailable row does not stand in a zero, chart or percentage for missing allocation evidence. `long` proves names wrap. `paused` shows zero planned/reserved while retaining real historical payments; `stale` withholds old progress; `empty` has no broken rows.

## Scope and interaction

This preview does not call an API, edit plans, move money or navigate into product routes. Each plan's native button opens local synthetic evidence in the existing SheetFrame, with no second sheet system. The query controls are normal links so state is deep-linkable and browser Back restores the previous preview URL. All variants include light and dark modes, visible keyboard focus, 44px controls, reduced-motion handling, and `data-g492-row` / `data-g492-row-content` plus `data-g492-rail`, `data-g492-fill` and `data-g492-marker` hooks for the required spacing and geometry measurement.

Retire this entire directory and its design-index entry when the chosen variant is folded into production under H113. The generator and generated figures are temporary preview evidence.
