# Penny presence design round

G388 now refines Kevin’s selected C layout. His 71726/71725 screenshots show a small filled purple tile nested in the raised adviser control, plus faded action fills that read as disabled. This is a second coded design round, not production approval. Visitor mode is Operate: UK users checking what to do next on a phone, in daylight or at night. Keep the Calm Cockpit, Figtree, money typography, facts, financial signs, semantic warnings and real actions.

## Direction contract

THESIS: Keep C’s quiet cards; give Penny one clear, comfortably sized icon and make enabled primary actions look active.

OWN-WORLD: Existing slate/white surfaces, Figtree and mono money, with solid Adviser Indigo #4f46e5 actions and white labels in both themes. The neutral 56px raised door holds one 26px monochrome mark directly, not an icon inside a coloured tile. C1 outlines the canonical Penny geometry, C2 uses the existing Lucide outline vocabulary for chat, C3 uses the exact incumbent PennyMark. Header and door use the same glyph. No sparkle or decorative gradient. Kevin explicitly requested an outline and other icon variants; this does not replace the global mark.

STORY: Compare the same Card detail, Cover plan, Payday plan and Covered examples. Covered remains a financial verdict, never falsely labelled as Penny-authored advice. Read the evidence, recognise the next action, and find Penny without decoding a new navigation model.

FIRST VIEWPORT: A 390px phone column shows Card detail and the start of Cover plan, with a clearly active solid primary action and a readable adviser glyph in the raised nav. Desktop keeps that working column beside concise comparison notes. Primary controls are at least 44px. The stack and individual cards are deep-linkable in both themes. C1 is the default and Previous C is an explicit comparison.

FORM: Local component-family exploration inside the established app, code-led. No replacement-world seed or image comp: the deliverable is three working coded variants, as requested by the board. Frontend Design substitutes for the unavailable design-taste-frontend skill; Impeccable polishes the components. Its context launcher was unavailable, so project context was read directly.

FINISH: Finish the screenshot and interaction checks, independent review, documentation audit and --uat-review handoff before Kevin chooses. Preserve DESIGN.md and the incumbent sidecar until final approval. No raster assets are produced in this round.

## Options

- C1 Outline Penny (`variant=d`): one outline-only adaptation of the canonical Penny geometry, uniform strokes, no faint bars, no inner tile.
- C2 Chat outline (`variant=e`): the Lucide chat outline, using the same stroke language as the other nav icons, with the Penny label retained.
- C3 Ink Penny (`variant=f`): the exact existing PennyMark in monochrome at 26px, without a filled tile around it.

All three use solid #4f46e5 primary buttons, white 14px/600 labels, a 12px radius and 44px minimum height. The icon is the only difference between C1/C2/C3. They use no gradient; the Penny Gradient Rule reserves its use but does not require it. No repeated Penny attribution returns to the cards.

Previous C remains visible for comparison. Earlier A, B and Current stay deep-linkable under Examples and display. These are different icon treatments, not different calculations. All examples are synthetic. Card and navigation actions are intercepted locally; the Penny door opens a labelled local demonstration, never a customer chat or bank action.

## Delivery boundary

Only the new design route, its checks, registry entry and this brief change. Production components, product/design doctrine, APIs and money logic stay untouched. After approval, fold in only the chosen treatment and update DESIGN.md quoting Kevin's choice. Retire the temporary round under H113.

Verification results and publication state are recorded on G388. Preview captures prove this preview, not a production rollout.

## First-round verification evidence

The production webpack build passed. Synthetic Chromium checks passed 60 combinations across 320px, 390px and 1280px, both themes, all four directions, individual cards and masked figures. Twenty final captures were inspected under `.impeccable/review/g388/final/`. Primary action text contrast measured at least 6.28:1. Card/navigation interception, the local adviser sheet, keyboard activation, Escape, focus restoration, reversible masking and invalid-query fallback passed with no page exceptions or customer API attempts.

The Impeccable launcher returned permission denied for context and the single detector attempt. Project context was read directly; manual craft-floor and Web Interface Guidelines checks substitute for a detector result. The specialist finish-reviewer and documenter types were unavailable, so fresh ordinary reviewer agents cover those bounded checks. These fallbacks do not imply a scanner or specialist-agent pass. Incumbent PRODUCT.md, DESIGN.md and the design sidecar remain unchanged pending Kevin's pick.

## C refinement verification evidence

The refinement production webpack build and TypeScript passed. Source contracts compare all four real card families across all seven retained/new variants. The first browser matrix passed 60 layouts before its process stopped during the interaction phase. Separate final production-bundle phases passed 26 targeted layouts plus card/navigation actions, matching direct glyphs in both header themes, Escape, keyboard activation, focus restoration, masking and fallback states. Both final phases recorded no page exceptions or customer API attempts.

Twenty-nine final viewport captures were inspected under `.impeccable/review/g388-c/final/`: phone and desktop tops, narrow screens, lower card content, adviser headers and Previous C. Viewport captures avoid Chrome’s full-page screenshot artefact that can reposition sticky elements. Primary action contrast is at least 6.28:1, icon contrast 7.90:1, glyphs are 26px, primary actions are enabled at opacity 1 and the adviser target remains 56px.

Fresh independent reviewer disposition: ship for UAT design-round handoff, no material fixes. Documentation audit: no incumbent system changes required. The detector launcher again returned permission denied; manual craft-floor and Web Interface Guidelines checks were used, with ordinary independent agents substituting for unavailable specialist reviewer/documenter roles. This evidence covers the coded preview only and does not approve a production icon choice.

## QA inventory

- Compare all four real card families in C1/C2/C3 and Previous C, in both themes; preserve copy, signs, financial ledgers and actions. Source contracts also retain the earlier A/B/Current comparisons.
- Inspect the Home stack at 390px and desktop, plus a 320px narrow check; the Penny door must be visible, usable and contained without covering the final card or page notes.
- Check proposal card attributions stay hidden, Covered stays unbranded, primary actions use solid colour at full opacity, are enabled and meet AA. Outline proposals use no filled shape or inner tile; direct 26px glyphs match between header and door.
- Activate card CTAs and every navigation slot locally; open and close the adviser example with touch, keyboard and Escape, restoring focus. No customer requests or persistent changes.
- Toggle example masking and themes in both directions. Hidden money must not leak through visible or accessible text; malformed parameters must fall back safely.
- Run source/render contracts, TypeScript, scoped lint, design registry/isolation/staleness gates and the full repository finish gate. Inspect one batched screenshot pass, fix material issues together, confirm once, then hand off to fresh independent review.
