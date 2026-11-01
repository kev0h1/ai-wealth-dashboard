# Penny presence: approved C fold-in

Kevin approved C and asked for a saved icon choice beside Dark mode: the current production icon, C1 and C3, without a Penny caption underneath. This supersedes the second-round preview contract. Visitor mode remains Operate, within the Calm Cockpit.

## Shipped direction

- Home brief and Payday plan keep their facts, money signs, masking, actions and semantic kind/cues. Repeated gradient Penny attribution is removed; Covered remains unbranded.
- Primary actions stay enabled at full-strength Adviser Indigo, white labels, 12px corners and 44px minimum height.
- Settings > Display places Penny icon immediately after Dark mode. Original is the existing/default gradient appearance, Outline is C1, and Ink is C3. Native labelled radios support touch and keyboard. The preference saves through the existing versioned account-preference pipeline with rollback and inline failure feedback.
- Original keeps the mobile production button. Outline and Ink use a neutral 56px raised door with a direct 26px monochrome glyph. No option has a visible caption below it. Accessible naming, open/pressed state, payday dot and keyboard/nav behaviour remain. The saved appearance also follows the user into the desktop adviser entry, chat header and composer entry.
- No C2 chat bubble and no changed financial calculation. The canonical PennyMark remains unchanged for other authored attribution elsewhere.

## Delivery and evidence boundary

Production fold-in, with independent diff review against DESIGN.md and the approved direction. The temporary `penny-presence` comparison and index entry are retired under H113. Its synthetic card fixtures are retained only in the regression-test directory; production imports no preview files.

The earlier evidence below belongs to its respective preview rounds. Implementation validation is recorded separately on G388 and at the end of this brief; a preview screenshot is never a claim that production has shipped.

## First-round verification evidence

The production webpack build passed. Synthetic Chromium checks passed 60 combinations across 320px, 390px and 1280px, both themes, all four directions, individual cards and masked figures. Twenty final captures were inspected under `.impeccable/review/g388/final/`. Primary action text contrast measured at least 6.28:1. Card/navigation interception, the local adviser sheet, keyboard activation, Escape, focus restoration, reversible masking and invalid-query fallback passed with no page exceptions or customer API attempts.

The Impeccable launcher returned permission denied for context and the single detector attempt. Project context was read directly; manual craft-floor and Web Interface Guidelines checks substitute for a detector result. The specialist finish-reviewer and documenter types were unavailable, so fresh ordinary reviewer agents cover those bounded checks. These fallbacks do not imply a scanner or specialist-agent pass. Incumbent PRODUCT.md, DESIGN.md and the design sidecar remain unchanged pending Kevin's pick.

## C refinement verification evidence

The refinement production webpack build and TypeScript passed. Source contracts compare all four real card families across all seven retained/new variants. The first browser matrix passed 60 layouts before its process stopped during the interaction phase. Separate final production-bundle phases passed 26 targeted layouts plus card/navigation actions, matching direct glyphs in both header themes, Escape, keyboard activation, focus restoration, masking and fallback states. Both final phases recorded no page exceptions or customer API attempts.

Twenty-nine final viewport captures were inspected under `.impeccable/review/g388-c/final/`: phone and desktop tops, narrow screens, lower card content, adviser headers and Previous C. Viewport captures avoid Chrome’s full-page screenshot artefact that can reposition sticky elements. Primary action contrast is at least 6.28:1, icon contrast 7.90:1, glyphs are 26px, primary actions are enabled at opacity 1 and the adviser target remains 56px.

Fresh independent reviewer disposition: ship for UAT design-round handoff, no material fixes. Documentation audit: no incumbent system changes required. The detector launcher again returned permission denied; manual craft-floor and Web Interface Guidelines checks were used, with ordinary independent agents substituting for unavailable specialist reviewer/documenter roles. This evidence covers the coded preview only and does not approve a production icon choice.

## Historical preview QA inventory

- Compare all four real card families in C1/C2/C3 and Previous C, in both themes; preserve copy, signs, financial ledgers and actions. Source contracts also retain the earlier A/B/Current comparisons.
- Inspect the Home stack at 390px and desktop, plus a 320px narrow check; the Penny door must be visible, usable and contained without covering the final card or page notes.
- Check proposal card attributions stay hidden, Covered stays unbranded, primary actions use solid colour at full opacity, are enabled and meet AA. Outline proposals use no filled shape or inner tile; direct 26px glyphs match between header and door.
- Activate card CTAs and every navigation slot locally; open and close the adviser example with touch, keyboard and Escape, restoring focus. No customer requests or persistent changes.
- Toggle example masking and themes in both directions. Hidden money must not leak through visible or accessible text; malformed parameters must fall back safely.
- Run source/render contracts, TypeScript, scoped lint, design registry/isolation/staleness gates and the full repository finish gate. Inspect one batched screenshot pass, fix material issues together, confirm once, then hand off to fresh independent review.

## Approved implementation verification

Independent production diff review found no material issues. A temporary local fixture harness rendered the real Settings selector, saved-preference provider, mobile launcher, chat header and four Home card families. Final Chromium checks passed 15 layouts at 320px, 390px and 1280px in both themes, native radio keyboard selection, save/reload, failed-save rollback and retry, message-allowance interaction, launcher toggle, exact action colour/opacity and masked figures. Eighteen captures were inspected; the final run recorded no page exceptions or API requests. The temporary harness was deleted before commit. This is component and source evidence, not a deployment claim.

New-component lint and repository checks are recorded in the G388 board handoff. An expanded lint run also reported two pre-existing set-state-in-effect errors in BottomNav's unchanged badge-cache hooks; those hooks are outside this change. The earlier Impeccable launcher/specialist availability limitations remain: direct project context, manual craft-floor/Web Interface Guidelines checks and ordinary independent review were used. The full finish gate and coordinator handoff determine delivery state.
