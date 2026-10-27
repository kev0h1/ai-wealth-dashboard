# G347 design and implementation contract

Preview-only, synthetic local state. No category, preference or transaction API writes. Production changes wait for Kevin's choice.

## Diagnosis

Read-only inspection on 27 October 2026 found Business stored as discretionary. The completed period, 28 August to 24 September, already includes Business in Free. The amount Kevin mentioned belongs to the following period. Show the selected period and distinguish no activity in it from actual exclusions. No personal data is embedded here.

POST /categories already changes an existing custom category's kind idempotently. The board's statement that no route changes kinds is incomplete. Shipping still needs an explicit validated update/reset contract.

## Options and authority

A: category rows under group headings, with search across all groups. B: one searchable list with group filters. Both use the same editor, impact preview, explicit save, failed-save recovery and reset review. Back or dismissal discards the unsaved radio choice. A separate settings button sits beside the card heading; it must never be nested inside the existing whole-card button.

Both preserve the current rule that built-in groups are fixed. Kevin was asked whether everyday built-ins may also move between Fixed and Free; an unanswered question is not approval to change ENGINE.md. Custom categories use the three currently user-selectable kinds. Not counted is an explanation, never an editable exclusion/income kind. Reset uses the category's original meaning, not a blanket Free fallback.

## Accounting requirements before production

One persisted per-user kind: commitment→Fixed, discretionary→Free, movement→Moved. No card-only mapping. No activity in a period does not change a category's kind.

Current money_shape.bucket_period includes saving flows, Investment and confirmed own-account moves in Moved, but not arbitrary custom movement categories. Before shipping the preview's editable Moved choice, canonical accounting must include declared custom movements once and consistently with Spend/Penny. Do not ship the browser simulation or silently drop their amounts. Preserve savings-credit/debit deduplication.

Debt and Transfer are mixed flow labels: loan repayments may count in Fixed; card repayments are excluded; confirmed own-account movements are Moved; unmatched transfers remain outside this split. The preview keeps these locked, explains the rules, and models loan repayments and confirmed moves separately from editable category amounts. The production response must expose the exact selected period's contributions/exclusions with traceable reasons, rather than infer them from a category label alone.

## Protected rules

- Built-in meanings, pending Kevin's explicit everyday-built-in policy choice.
- Income remains the starting inflow, never a spend-group choice.
- Card repayments stay excluded; evidenced loan repayments remain Fixed.
- Own-account evidence overrides a spend-category choice. Business payments to third parties can still be spending.
- Refund credits reduce the corresponding spend rather than becoming Income or positive spending.
- Savings/investment flows and savings-account credits count once.
- Other remains the engine's unresolved state.
- This editor does not create/delete categories, recategorise payments, move money or grant coaching consent.

## Proposed API after approval

GET returns all effective categories, current and original kind, edit permissions/lock reasons, selected period, signed counted contributions and excluded contributions with reasons. Distinguish unavailable classification from zero.

PATCH /categories/{name}/kind is authenticated/user-scoped, validates known normalised names, permitted kinds and an expected revision, and reuses _cas_update. Reject unknown category creation, protected/internal kinds, stale revisions and malformed input. Reset updates the same canonical record; store original kind so a custom commitment does not reset to Free. Define a historical-record migration policy before enabling reset.

Use _invalidate_kind_caches and data-version/response invalidation for Money Shape periods/averages, comparison, Spend Out/pace/charts, Mirror, Left to spend and Penny. Refresh from one committed version; never announce success with stale totals. Review aim/behaviour consequences without changing consent.

Required production tests: user isolation; invalid/unknown/internal/locked kinds; case/space normalisation; concurrent edits; no transaction-label writes; original-kind reset; cache coverage; Fixed↔Free preserves Spend total; custom movement counts once; own-account override, card-vs-loan evidence and refunds; historical periods/averages/Penny parity; missing/loading/masking/error/retry; keyboard focus and discard on dismissal.

## Preview verification

The preview was checked at 390px in both themes, 320px, 195px and desktop. Browser checks covered editing, unchanged-spending transitions, movement impact, reset, discard/focus return, failed save and retry, masking, locked rules and loading/missing states; no API requests or browser exceptions occurred. The grouped amounts reconcile, including protected loan repayments and transfers between accounts. Independent source review corrected the preview-only success wording, period distinction and visible protected contributions. A fresh Web Interface Guidelines audit and screenshot inspection were completed; no specialised detector pass is claimed.

After the chosen design is implemented, remove this preview and its index entry under H113 unless another active item imports or references it. The backend contract above remains required work for the fold-in, not functionality supplied by this design round.
