# G291 goals and set asides feedback round

Revised design round for Kevin's five screenshots and feedback on 20 October 2026. Both A Small steps and B One clear page remain available. No variant has been selected. This round changes preview code only, not production components, APIs or reservation calculations. G274 remains cancelled and its keep-money-here intent stays within G291.

## Direction

Operate mode within the Calm Cockpit. Impeccable clarify and polish guide the revision: tighter groups, clear monetary hierarchy, examples beside choices, and one primary footer action. Existing SheetFrame, UpcomingFlowSheet, DateField, AccountRadioPicker, BankBadge and plan presentation components remain the baseline. Figtree, tabular money, white/slate surfaces and solid indigo actions are retained. No Penny gradient or decorative financial warning colour.

New goal and New set-aside preselect the relevant path. A generic start still offers both choices, with concrete examples: save £2,000 for a trip to Japan by December 2028, or set aside £300 for groceries each pay period. A walks through the questions; B shows a review with editable details in the same sheet. Back preserves the distinction between an unsaved draft and the saved plan.

The target amount and contribution have distinct labels. Contribution captions sit below the amount, rather than competing on one baseline. Review groups purpose, contribution, accounts and tracking, with a single Save action. The payment step no longer repeats Skip for now in its body and footer.

## Financial contract

- The date control recomputes a visible estimate using a labelled synthetic monthly calendar. Today is 19 October 2026; future period starts run from 1 November. July 2027 has nine starts, August ten and December 2028 twenty-six. Remaining target divided by future starts is rounded up to £5. The production engine must supply the user's actual pay calendar at implementation. A date-only edit preserves progress and the include-existing choice. Affordability is not fabricated from this local estimate.
- Include existing pot money is explicit and off for a new goal. The £600 Holiday pot fixture has £200 unclaimed. The other £400 belongs to recorded goal claims; the existing Holiday goal already owns £300 of those claims. A new goal can include only the free £200, never all £600. Enabling the option adds the free share once; disabling reverses that choice. The goal target caps displayed progress. Changing destination resets the choice. An offline pot does not offer fresh unclaimed money from a potentially stale balance.
- Category tracking is a proposed addition to both kinds, not an existing API feature. The current period is 1 to 31 October 2026. Use the effective category, with a custom category taking precedence, and the selected paying account. De-duplicate stable transaction IDs and exclude transactions claimed by another plan.
- A keep-here set-aside can track eligible category spending net of refunds. The Groceries example has four matching transactions: three purchases totalling £105, minus a £5 refund, giving £100 used. The purchases, refund and net total are shown separately so they reconcile. Net refunds retain their negative sign rather than being hidden at zero. Own-account transfers and card repayments do not count as grocery spending.
- For a goal, or a set-aside with a receiving account, category matching covers qualifying transfers from the source into that exact destination. Grocery purchases are not saved money. The Savings example has two transfers to Holiday totalling £150; a separate transfer to Bills is excluded. Category evidence is displayed only in this preview: it does not independently credit goal progress or release a reservation.
- Confirming a payment or category rule is not a bank movement. Saving, pausing and deleting a plan do not move money or cancel a standing order. Existing source confirmation, counted-current-account eligibility, unknown affordability and no-source blocking are retained.
- A keep-here set-aside has no goal target or invented receiving account. Moving it to another account is optional. A visible Upcoming pointer explains where to check whether it fits before payday.
- Permanent goal Pause remains proposed and requires API support; it must not be implemented as cancellation. Delete retains a direct, explicit confirmation.

Implementation must reconcile pot baselines and shared claims server-side. The include-existing fixture is not permission to use a raw pot balance or to allocate the same pound twice. Category support needs a persisted rule, direction, pay-period bounds, account scope, transaction evidence and rival-plan conflict handling before it can affect production money calculations. The live evidence ledger must retain a plan's own evidence on edit and exclude other plans' claims; the local fixture conservatively excludes all already-claimed rows.

## Review checklist

1. Start New goal, enter Japan trip and continue. There should be no second goal-versus-set-aside question. Repeat with New set-aside and Groceries.
2. Change a goal's month. The estimate should remain visible, recalculate, and leave existing progress intact.
3. On the Holiday pot, toggle Include existing money. Only £200 becomes newly available to this goal; toggle back and confirm it is removed once.
4. Choose category tracking. Groceries on a keep-here set-aside shows £100 used this pay period. Savings on a goal shows £150 in qualifying transfers, while Groceries shows no savings transfers.
5. Return to review, save, view and edit. Confirm the selected rule and existing-money choice remain understandable, with one sheet and one primary footer action.
6. Exercise known transfer, no history, one/several accounts, short month, offline pot and no paying account in both themes, plus 320px and desktop layouts. Check keyboard focus, 16px labelled fields, safe-area footer, long names, direct pause/delete and Back discarding unsaved edits.

## Verification and delivery

The context launcher was unavailable earlier in this session, so direct PRODUCT.md and DESIGN.md context and manual inspection are the fallback. No durable design rule or generated raster asset is added. The previous round's browser evidence does not verify this revision.

The updated model tests cover date recalculation, explicit unclaimed pot shares, category refunds and exclusions, duplicate transactions, competing-plan claims and unchanged reservation/progress from rule confirmation. Primary copy scores 2.1 on the reproducible vowel-group Flesch-Kincaid heuristic, not a measured reading age or user study.

Run render and browser coverage, Web Interface Guidelines, an independent diff review, TypeScript and repository finish checks before hand-off. Record the completed evidence below. Finish with `--uat-review`; the coordinator publishes the previews before Kevin chooses. Retire the whole preview, its index entry and its preview-only package check at approved production fold-in under H113.

The first frozen browser batch passed 66 layout checks and both complete journeys with zero page exceptions or account API attempts. Root inspected the phone, narrow and desktop captures. The batched corrections made refunds visibly reconcile, added always-visible amount examples, stacked all contribution captions, corrected once-only wording and constrained long names. Source review also caught and closed a functional reconfirmation gap: changing an account now explicitly asks to confirm the retained category rule before Save can be enabled.

Final confirmation passed 68 layout checks across A/B, light/dark and the seven account scenarios, plus 320px and desktop. Both journeys exercise a real month-picker change, opt-in pot money saved once, category/refund evidence, no-history validation, account-scope reconfirmation, unchanged saved state after Back, pause/resume/delete, touch and keyboard focus. Every measured contribution caption occupies its own line, fields are labelled and at least 16px, long names do not overflow, and footers stay within the viewport. There were zero page exceptions and zero account API attempts. Headless checks do not claim to verify a physical iOS or Android software keyboard.

Evidence is under `/tmp/g291-feedback-final/`, with reproducible browser, model and render tests beside the preview. The model checks, 116 render cases, targeted lint and final production-mode build passed. Web Interface Guidelines passed; root and the independent reviewer inspected the responsive captures. The final independent verdict is SHIP/PASS with no release blockers. Session finish reruns the backend and full frontend gates, with its delivery result recorded on G291. These checks verify the preview, not a production fold-in.
