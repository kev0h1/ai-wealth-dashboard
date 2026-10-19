# G291: a plan you can understand at a glance

Design round only, Operate mode, within the existing Calm Cockpit. G274 is already cancelled by Kevin and its keep-money-here intent belongs here; do not reopen it or ship it separately. This round changes no production component, reservation engine, API or durable design rule.

## Direction contract

THESIS: ask for the purpose and amount before the machinery. A person should be able to start, understand, edit and stop a plan without learning payment-rule jargon.

OWN-WORLD: the existing solid SheetFrame/UpcomingFlowSheet, Figtree, mono money, slate/white surfaces, indigo actions and small honest caution signifiers. No new identity, Penny gradient, elaborate motion or dashboard.

STORY: name the purpose, decide whether there is a target, confirm where money stays or goes, then save one clear plan. Return to a view with progress where it exists and direct Edit, Pause and Delete actions. Back retraces the same sheet, not another popup.

FIRST VIEWPORT: A, Small steps, gives one plain question and a large next choice per view. B, One clear page, starts with a short editable plan sentence and only opens the field being changed in that same frame. Both lead to the same plain view and final confirmation, with a 30px amount and one persistent primary action.

FORM: two code-led variants extending existing plan surfaces; no new-world concept seed or raster comp is applicable. Reuse production sheet, picker, bank and plan presentation components through fixture props where they fit. New journey markup is preview-only. Shared-start versus separate-start is an optional user preference asked in chat; proceed with one shared start unless directed otherwise.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Product and financial boundaries

- Plain words must not invent capabilities. A plan is not a bank instruction. Saving, pausing or deleting it does not move money or stop a standing order.
- Source accounts are counted current accounts only. A suggestion is visible and must be confirmed; never save an inferred account silently. With one account there is no pointless picker, but the source is explicit in the final confirmation. No eligible source has a clear blocked state, not an unassigned default.
- A source-only set-aside defaults to keeping money there. It has no fictitious receiving account, goal target or automatic transfer fulfilment, and retains its full applicable reserve. Choosing another account is optional and is the only point where transfer matching becomes relevant.
- A goal has a target, month and real progress. Its per-period amount follows the current target/date engine; an editable target is not silently redefined as a stored fixed monthly contribution. Label illustrative local draft quotes as estimates and withhold fresh affordability for arbitrary unquoted edits. Existing saved progress never resets on a simple edit.
- A known own-account transfer is a suggested match, confirmed with one clear tap. No history is not an empty contains box or a promise that money has already counted. With no confirmed rule, say the amount stays held back until a payment is linked. Advanced matching stays available under a plain optional disclosure, never required in the main path.
- An early affordability reading uses the existing server-shaped synthetic fixture, explicitly about the typical month after debt payments, not a claim about today's bank balance. Keep figures in ink, amber in a small signifier only, and offer Lower target / Later date. Unknown affordability stays unknown.
- Permanent Pause for goals is a proposed action needing API support; current goal status has active/done/cancelled, not paused. Show and label that limitation in review notes instead of pretending it ships already or abusing cancellation as pause. Set-asides already support active/inactive. No unapproved reservation-core, debt, shared-sink, rollover or safety-net framework is folded in.
- Delete is reachable directly from the view, with an explicit confirmation describing the effect on Sorted only. No Undo: re-edit/recreate is the route back. Distinguish leaving an edit from deleting the plan.
- Use synthetic examples and local operations only, never customer data or API requests. Any route link demonstrates its destination locally.

## Acceptance and review

Required cases: goal with a known transfer, no matching history, one-account keep-here set-aside, several accounts with an optional receiving account, typical-month shortfall, offline/unseen pot, and no eligible source. Show create, view, edit and direct pause/delete with correct Back and unchanged saved state until final confirmation. A set-aside goes directly from confirmed paying account to review; choosing another account is an optional summary action, never a mandatory receiving-account detour. A new goal starts at £0 progress, not the entire receiving pot balance. Existing progress comes from the fixture's recorded goal progress, not a new checkbox claim.

Root owns financial intent, index, tests, readability scoring, usability script, browser captures, Git, board and delivery. Verify 390px in both themes plus 320px, desktop and keyboard/touch. The reading goal is about age 9 to 11; score primary copy transparently as a heuristic, not a claim of human usability testing. Give Kevin a short create/view/edit/cancel walkthrough targeted under 30 seconds, and report click counts rather than claiming measured user times.

Impeccable distill and Operate guidance preserve necessary functionality while removing jargon and layers. The context launcher failed with permission denied; direct documentation and manual checks are the fallback. Perform Web Interface Guidelines and an independent finish review before `finish G291 --uat-review`. Coordinator publication precedes Kevin's choice; no blocked unpublished design round. Retire this preview at approved fold-in under H113.

## Short review script

Once the coordinator publishes `/design/plans-simple`, start with the one-account example. Try A then B: Make a new plan, name it School clothes, choose No, keep some money aside, set an amount, confirm the account and save. In A the default route is six taps to Save; B is five using the visible amount default, or eight when changing it. View the plan, tap Edit, change its name, then Back to confirm the saved name is unchanged. From View, Pause and Delete each take two taps including their explicit confirmation. The target is a sub-30-second walkthrough per individual task, not a claim of measured user completion time; no user study has been run.

For a goal, use the known-transfer example. A is eight taps to Save with the suggested payment confirmed; B is five with matching left optional, or seven with the suggested payment confirmed. The person still enters/checks the name, target and month. Confirming a payment rule is not an actual bank movement and does not advance progress or release the amount held back.

The shared primary questions and safety copy total 140 words across 21 sentences. The reproducible vowel-group Flesch-Kincaid heuristic in `model.test.mjs` gives grade 1.9. This is a rough check on those short questions only, not the complete UI, a verified reading age or accessibility certification. Existing account names, pay-period terms, date controls and financial explanations still need Kevin's phone review. The intended reading-confidence target remains about age 9 to 11.

## Review and evidence

An independent source review requested removal of the destination-balance progress shortcut, persistent estimated labels, visible proposed-goal-Pause wording and the repository's destructive-action treatment. These were addressed together. Optional receiving accounts remain an explicit review action rather than another required picker, preserving G274's keep-here default. Native SheetFrame, UpcomingFlowSheet, bank/account picker, date picker and plan summaries are reused, with local state and synthetic accounts. Goal quotes other than the fixed July example remain unknown, with recorded progress still visible.

The independent documentation audit found no new durable rule or generated raster asset. Preserve DESIGN.md and the design sidecar until Kevin chooses. Specialised finish-reviewer/documenter roles are unavailable in this session, so independent agents used the documented fallback contracts. No product API or reservation-framework implementation is included.

The first production-mode browser batch passed 60 layout checks plus full goal/set-aside creation, edit/Back saved-state separation, local pause/resume/delete, no-history reserve copy, source confirmation, shortfall adjustment, phone touch and keyboard focus. Final confirmation and finish gates are recorded below once complete. Browser evidence is scratch output under `frontend/.impeccable/review/`, with reproducible `browser.test.mjs`, `model.test.mjs` and `render.test.mjs` alongside the preview. The render gate covers 91 step/scenario cases including proposed Pause, estimate labels and source-only separation. Headless Chrome verifies focus and geometry, not the physical iOS/Android software keyboard.

Local Chrome requires approved out-of-sandbox access. The initial development badge covered a footer test target, so browser verification uses the built preview, not the developer overlay. CDP supplies true 320/390px viewports and waits explicitly for hydration, fonts and animation settling. The intentional second-tap guard is respected by spacing automated touch events. The uncached CSS worker also needed approved local loopback access for the final build; this was an environment restriction, not a shipped product change.

Final confirmation passed on the frozen production-mode build: 28 A layouts, 28 B layouts and four additional narrow/desktop/create-summary measurements. The separate journey batch passed both create paths, explicit source confirmation, the optional other-account route and suggested payment, no-history skip, actionable shortfall adjustment, nested month-picker Escape/return, native touch and keyboard focus. No page exceptions or customer API attempts. The computed destructive-button text contrast is 6.42:1 in light mode and 10.34:1 in dark mode. Root inspected the final captures, including the 320px view and 1280px centred dialog. One earlier long confirmation process was terminated; its partial output is not counted as a pass. Three shorter, complete runs provide the final evidence.

Web Interface Guidelines were checked alongside the project rules: associated input labels, 16px editable inputs, native controls, visible focus, 44px minimum targets, reduced motion, safe-area footer, phone/desktop geometry, both themes and truthful blocked/unknown states. The 91 render cases, financial-model checks, lint, design-index/stale/no-live-data/raw-fetch gates and final production build passed. The independent finish verdict is recorded at handoff. This is evidence of the preview only, not a claim that a chosen design is already implemented in production. The required backend/frontend gates run again through session finish.

Final independent finish verdict: PASS, no required fixes. The final review added the required Upcoming pointer for set-asides without an affordability calculation and hid the optional receiving-account action when there is no paying account. The source-less amount is explicitly planned, with no asserted account reserve. The reviewer and root inspected all 12 targeted captures in `frontend/.impeccable/review/g291-caveat/`. `caveat.test.mjs` passed 24 further view/edit layouts across A/B, light/dark and one/many/no-source cases, plus zero exceptions or customer API attempts. These captures supersede the earlier set-aside and missing-source captures in those changed details. A first targeted run timed out during hydration; the completed fresh-browser run waits for native sheet-history teardown between examples. No further layout changes are proposed after this confirmation.
