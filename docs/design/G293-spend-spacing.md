# Spend header spacing

Kevin approved B, Closer grouping, on 19 October 2026. The fold-in removes the accumulated empty space between the Spend header and financial hero, using one 12px gap without changing their identity, figures, copy or controls. Impeccable's layout guidance informed the original round and the production spacing rule.

## Spacing proposal

The reading path is Spend, selected dates, then Out. Dates and their navigation belong together; the hero follows as the answer to that selection. Today the header adds 20px below its controls and the page grid adds another 28px. Completed periods also show a 44px return action after a 12px margin.

Variant A removes the header's bottom padding and uses one 20px gap before the hero. Variant B makes the same correction with a 12px gap, grouping the period and its figures more closely. The completed-period return action stays inside the control group, with its existing 12px gap and 44px target. The period picker's full dates, day caption, cross-year context, arrow guards, Search and sheet paths remain unchanged.

The original preview imported the real `SpendPeriodBar`, `SpendPaceHero` and journey navigation. Its page wrapper matched `SpendPage` rather than adding a padded phone frame. Original spacing was available as a reference, with review controls hidden by `clean=1` for first-viewport checks. The lower journey was an illustrative context stub, not a proposal to rewrite its content.

## Acceptance

Use the current and completed states in both themes at 390px, with 320px, 768px and desktop checks. Include cross-year dates and no spending. Confirm the computed gap, unchanged money reconciliation, 44px controls, natural reading and focus order, visible keyboard focus, long dates, native sheet dismissal and no overflow or live API attempts. No new typography, colour, imagery or animation is needed. Mobile and desktop retain the actual page's stacked and two-column structures.

The Impeccable launcher and layout detector were unavailable, so assessment used source-backed and independent review, not a claimed detector pass. The design round ended with independent source and visual review, Web Interface Guidelines checks and published previews for Kevin's choice. Production and DESIGN.md were unchanged during that round. The approved fold-in below retires its temporary preview and index entry.

## Design round review

PASS. Independent source and visual review found no blocking defects; a separate documentation audit also passed. Root inspected all eleven confirmation captures. A is the recommended option: 20px keeps the documented section rhythm while removing the duplicated 28px of empty space. B removes 36px by using the closer 12px relationship.

The production-mode browser confirmation passed 96 layouts: three spacing treatments, four example states, both themes and 320px, 390px, 768px and 1280px widths. Measured gaps, 44px controls, unchanged 30px hero type, no overflow and desktop/mobile topology passed. Native touch navigation, the return action, period-sheet Escape and focus return, Tab order, local Search, income and calculation disclosures passed with zero exceptions or customer API attempts. The first run's generic dialog selector also matched the app's hidden Penny panel; the confirmation targets the real period-sheet frame instead. Local geometry captures and results are under `frontend/.impeccable/review/g293-final/`.

The confirmation exposed a preview-only date parse error: local midnight was passed to a formatter that reads UTC. The final source restores explicit UTC midnight, with literal expected calendar labels tested on the host and in America/Los_Angeles. The captures predate that date-only correction and prove geometry, not the final date labels. Exact component rendering, literal-date contracts, financial reconciliation and comparison-control availability are pinned by `check:g293-spend-spacing`; the date correction is source/SSR verified rather than another screenshot cycle.

TypeScript, preview ESLint, the build, design-index, strict stale-preview and anonymous-preview checks passed during the round. Web Interface Guidelines review preserved labelled native controls, focus indication, a skip target, semantic colour, both themes and the existing reduced-motion behaviour. No raster imagery was needed.

## Approved production fold in

The production change removes `SpendPeriodBar`'s 20px bottom padding and changes `SpendPage`'s grid margin from 28px to 12px. This brings the hero 36px higher in both current and completed periods. The existing return action remains inside the navigation group. `spend-live`, an independently retained fixture using the real header, receives the same grid-margin correction so it does not show a different handoff. Its older journey summary is not evidence of the current production financial hero.

The separate cold-loading skeleton is unchanged. `SpendPaceHero`, its financial calculations, typography, wording and callbacks are untouched. DESIGN.md records the approved spacing rule.

The temporary `spend-spacing` preview and its design-index entry are retired under H113. Its synthetic fixtures and browser utility move to `frontend/scripts/`; `check:g293-spend-spacing` now tests the actual production page-shell classes and real header/hero renders. The manual browser check reads the outer wrapper, safe-area style, grid and summary-section classes directly from `SpendPage`'s syntax tree and uses the built CSS and fonts. It is isolated shell-layout evidence, not an authenticated page screenshot. The permanent G285 browser check separately exercises the hydrated header's real controls and focus behaviour.

Fold-in verification passed: the production build, TypeScript, source/SSR contracts on the host and in America/Los_Angeles, design-index and strict stale-preview checks. The browser batch passed 32 isolated shell layouts across four states, four widths and both themes, measuring 12px handoffs, intact gutters, 44px controls, unchanged 30px hero figures and no overflow, exceptions or customer API attempts. The permanent G285 browser check passed 36 additional header layouts and native navigation, return, sheet, keyboard and focus interactions. Root inspected all twelve captures. Evidence is under `/tmp/g293-fold-in-b-layout` and `/tmp/g293-fold-in-b-controls` on the working host.

Independent diff review and Web Interface Guidelines review found no blocking defects. ESLint passed for the changed header, retained fixture and regression files; the SpendPage diagnostic comparison matched its unchanged baseline exactly, 16 errors and 2 warnings, with no new diagnostics. The repository finish workflow runs the full backend suite, TypeScript and all registered frontend gates before pushing. The former `/design/spend-spacing` URL is historical and will retire when the coordinator publishes this branch; it is not a retained production gate.
