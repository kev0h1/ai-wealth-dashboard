# G339: Bank balance and after payments and plans

Mode: Operate. Skill: impeccable. Extension of the existing Accounts and Home estate, not a replacement visual world. Code-led comparison with existing fonts, surfaces, bank badges, privacy preference grammar and sheet frame.

## Direction contract

THESIS: put the present bank balance beside the account's dated end-of-period position, without implying that either is permission to spend. Revision: C puts a smaller labelled forecast line directly under the prominent bank balance; D aligns the smaller figure beneath it with the label on the next line. Earlier A/B remain under Previous layouts, outside the current comparison.

OWN-WORLD: Sorted slate canvas, white/slate account groups, Figtree names, JetBrains Mono money, fixed bank badge column and right-aligned figures. Risk/caution stays in a small icon and plain label; forecast money stays ink with its real minus.

STORY: read the balance, compare the position after known payments and assigned plans, then tap that account to inspect its own events and the distinction from Spend from. The group subtotal remains bank balances; pinned duplicates never add to net worth twice.

FIRST VIEWPORT: actual AccountsHeader, a dated estimate caption, the two pinned current accounts and Current group. At desktop the account list and the design/data explanation sit side by side. Home estate has its own switch and the same two readings, without adding a Home net-worth hero.

FORM: two revised coded row treatments in the established interface. No raster assets or generated art. Forecasts are literal API-shaped fixtures from the canonical account-position fields, not a client-side replacement engine. A row opens one production SheetFrame with local fixture content, never a new bank operation or fabricated URL contract.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. Existing DESIGN.md remains authoritative; no shipping raster is introduced.

## Financial contract

Use `GET /today.account_eligibility[id].after_payments_and_plans` as the second amount. The shared backend account-position module defines it as after_payments minus active assigned plan reserves. Inferred sources retain their estimated qualifier. Unknown/uncertain, excluded and loading states have no substitute £0; stale values are marked last known and do not show live risk colours.

Spend from is distinct: min(after_payments_and_plans, low_point_and_plans), less a visible move reserve, capped to the pooled estimate and floored at zero. The preview never relabels that limit as a closing balance or sums individual low points. The working shows the unchanged source fields separately. No forecast subtotal is added because unassigned plans/shared buffer stay pooled-only and unavailable rows must not be silently omitted.

Bank balances sum to £486 for six fictional current accounts; savings £1,400 and card −£2,141 give net worth −£255 across eight bank accounts. The production header rounds its net-worth figure; the pence fixture explicitly says so. Per-account forecast and bank figures retain pence. Savings/cards retain their balance-only rows in this round: no made-up equivalent.

An account's own negative payment low point permits a risk icon even when its ending position is positive. A plans-only gap never becomes red. The numeric fields and row details remain masked with the shared BalancesHiddenContext, including the portal sheet and signed event figures.

## Navigation and provenance

The existing Upcoming account view uses in-page flow state (`setFlowView({kind:"account",id})`), not an existing account URL parameter. This design round opens local account-specific working in the actual sheet frame. Fold-in needs an intentional account-selection handoff to the existing Upcoming flow, preserving normal account-sheet access; it must not invent a deep link that production ignores.

Production components used: AccountsHeader, BankBadge, unchanged non-current AccountLedgerRow, MoneyText and SheetFrame. Paired rows, groups and the account working body are hand-authored proposals. No production component, data source, preference or backend is changed. No live API calls or real customer data. No G325 preview import/dependency.

Verify 320/390/1280, light/dark, both variants and Home estate; masks including sheet/ARIA, minus/pence, inferred sources, unknown/excluded/loading/stale, optional-plan gaps, earlier cash gap, exact group bank totals, long names, row tap, keyboard, Escape/focus return and no requests. Root owns build/tests/Git/board, with independent review before finish --uat-review.

## Reference and refinement

Kevin prefers the hierarchy in his NatWest reference: the actual bank balance is the primary right-aligned reading, with a smaller after-deductions figure beneath it in the same column. Preserve Sorted surfaces, bank badges, type and status grammar. No reference screenshot, real account identifier or bank artwork is shipped. C uses an 18px bank figure and an inline 12px After bills & plans line; D puts the secondary figure above its small caption. Both keep the account identity on the left, including long names, while the stack takes only its content width up to 140px, reduced to 112px below 361px so long names have more room. The same hierarchy applies on Home.

The short label is not a new financial calculation: it is still the canonical end-of-period after_payments_and_plans value. The dated scope and working retain expected income, assigned plans, the separate earlier low point, excluded pooled buffer/unassigned plans and the distinction from Spend from. Do not call it the bank’s Available balance or promise that every deduction is known.

## Prior-round verification and verdict

Production build, preview fixture ledger walks, presentation checks, ESLint, design index and strict stale checks passed. A final 62-case browser pass covered 320/390/1280px, both themes, Accounts and Home, all fixture states, accessible shown/hidden row names, portal masking, row opening, sheet bounds, Escape and focus return. No document overflow, undersized controls, runtime exceptions or live API requests were found. Final captures were read directly; A moves the identity onto its own line at 360px and below to keep long names readable. Sheet geometry is measured after its viewport effect and motion settle.

Web Interface Guidelines audit: no blocking findings in the proposed files. Independent source review cleared the financial distinction, privacy and accessible names. Existing production components are reused unchanged; their unrelated behaviours are outside this design round. Required repository finish checks remain the delivery gate.

## Stacked-round verification

The final production build and 64-case browser confirmation passed at 320/390/1280px, both themes and both Accounts/Home surfaces. Checks include 18px bank / 12px forecast type, equal right edges, estimate below balance, masks and accessible label-before-amount order, all fixture states, pence/minus signs, earlier payment versus plans-only gaps, row-specific sheet working, Escape/focus return, and keyboard access to Previous layouts. No document overflow, short controls, exceptions or live API calls. Screenshots were read directly; narrow phones wrap the secondary line to protect account identity space.

Fixture ledger and presentation checks, ESLint and registry passed. Web Interface Guidelines audit and independent source/visual review cleared the final batch after repairing D’s screen-reader label order. Required stale-preview gate has a separate H137 dependency owned by Claude; this round does not edit its previews. Repository finish and publication remain separate delivery gates, not evidence of product implementation.
