# Spend header spacing

G293 is a narrow Impeccable layout round in Operate mode. The header and financial hero already have approved designs. This proposal removes the accumulated empty space between them without changing their identity, figures, copy or controls.

## Spacing proposal

The reading path is Spend, selected dates, then Out. Dates and their navigation belong together; the hero follows as the answer to that selection. Today the header adds 20px below its controls and the page grid adds another 28px. Completed periods also show a 44px return action after a 12px margin.

Variant A removes the header's bottom padding and uses one 20px gap before the hero. Variant B makes the same correction with a 12px gap, grouping the period and its figures more closely. The completed-period return action stays inside the control group, with its existing 12px gap and 44px target. The period picker's full dates, day caption, cross-year context, arrow guards, Search and sheet paths remain unchanged.

The preview imports the real `SpendPeriodBar`, `SpendPaceHero` and journey navigation. Its page wrapper matches `SpendPage` rather than adding a padded phone frame. Current spacing is available as a reference. Review controls can be hidden with `clean=1` for a full first-viewport check. The lower journey is an illustrative context stub, not a proposal to rewrite its content.

## Acceptance

Use the current and completed states in both themes at 390px, with 320px, 768px and desktop checks. Include cross-year dates and no spending. Confirm the computed gap, unchanged money reconciliation, 44px controls, natural reading and focus order, visible keyboard focus, long dates, native sheet dismissal and no overflow or live API attempts. No new typography, colour, imagery or animation is needed. Mobile and desktop retain the actual page's stacked and two-column structures.

The Impeccable launcher and layout detector are unavailable in this session, so assessment is source-backed and independent, not a claimed detector pass. The round ends with independent source and visual review, Web Interface Guidelines checks and published previews for Kevin's choice. Production and DESIGN.md remain unchanged until approval. Delete this temporary preview and its index entry when the approved spacing is folded in.

## Review verdict

PASS. Independent source and visual review found no blocking defects; a separate documentation audit also passed. Root inspected all eleven confirmation captures. A is the recommended option: 20px keeps the documented section rhythm while removing the duplicated 28px of empty space. B removes 36px by using the closer 12px relationship.

The production-mode browser confirmation passed 96 layouts: three spacing treatments, four example states, both themes and 320px, 390px, 768px and 1280px widths. Measured gaps, 44px controls, unchanged 30px hero type, no overflow and desktop/mobile topology passed. Native touch navigation, the return action, period-sheet Escape and focus return, Tab order, local Search, income and calculation disclosures passed with zero exceptions or customer API attempts. The first run's generic dialog selector also matched the app's hidden Penny panel; the confirmation targets the real period-sheet frame instead. Local geometry captures and results are under `frontend/.impeccable/review/g293-final/`.

The confirmation exposed a preview-only date parse error: local midnight was passed to a formatter that reads UTC. The final source restores explicit UTC midnight, with literal expected calendar labels tested on the host and in America/Los_Angeles. The captures predate that date-only correction and prove geometry, not the final date labels. Exact component rendering, literal-date contracts, financial reconciliation and comparison-control availability are pinned by `check:g293-spend-spacing`; the date correction is source/SSR verified rather than another screenshot cycle.

TypeScript, preview ESLint, the build, design-index, strict stale-preview and anonymous-preview checks passed during the round. The final workflow runs TypeScript and all registered gates again. Web Interface Guidelines review preserves labelled native controls, focus indication, a skip target, semantic colour, both themes and the existing reduced-motion behaviour. No raster imagery or new production rule ships. H113 cleanup must also remove or replace this round's package check when the preview retires.
