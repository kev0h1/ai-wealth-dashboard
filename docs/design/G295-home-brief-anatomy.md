# Home brief card anatomy

Kevin chose B, Inline cues, on 20 October 2026. It extends G292's shared reading edge across the Home brief family with compact icons beside the kind or Penny badge. This is a narrow Impeccable layout refinement in Operate mode, preserving Sorted's Calm Cockpit.

## Direction

The reading path is card kind and status, headline, optional monetary lead, body or evidence, then the existing action. The headline, lead, body and action start at the card's 16px reading inset. Semantic marks belong within the eyebrow row, not in a separate 36px column that leaves a hole above full-width evidence. Penny retains its gradient badge; all other meaning uses the existing neutral, watch and positive vocabulary. The V2 dismiss control keeps its 44px target and space beside the header.

B uses a transparent 16px glyph, an 8px column gap and a 4px row gap before the headline spans both columns. The icon replaces, rather than duplicates, a fact's watch dot or positive tick. Its label keeps its existing ink; a spending-pattern icon retains the user's resolved category colour. No type scale, financial sign, wording, figure, data-row identity or action dock is redesigned.

Home's existing 12px card and 20px section rhythm stays unchanged. Each card uses native production markup, not preview wrapper CSS. The permanent regression harness supplies synthetic props and the same mobile gutters as Home; the tip keeps its own gutter and is not padded twice. Its two-column desktop catalogue compares card layouts, not a replacement for Home's page layout.

## Card inventory

The reported debt-trajectory and Card detail cards lead the comparison, with Covered as the approved reference. The family also includes payday check, rate change, informational and interactive spending patterns, pace note, both cover-plan branches, compact and fallback overdue moves, allocation shortfall, eligible and capped goal easing, the existing deferred-plan note, payday allocation and settled states, the tip and the month-closed invitation.

Bank badges and right-aligned figure columns inside movement and payday ledgers remain data, not decorative header tiles. The payday plan keeps its total and salary allocation structure. The deferred-plan note and empty brief remain canvas content, with no new card boundary. The month-closed invitation already has one text edge; its existing action receives a 44px minimum target. The collapsed payday entry rows are already aligned and retain their current structure. The generic fallback for future companion types is deliberately plain text and gains no invented card, label or dismissal.

## Copy and money

The debt-trajectory explanation is dense, including unknown-interest and missing-rate caveats. This round flags that density without shortening or collapsing it. The rising fixture uses the current production copy templates with synthetic balances: £2,100 on zero-rate deals plus £504 unclear equals £2,604 carried; the lead is the £186 movement over three months, not the carried position. Card detail uses the existing “Want your card picture sharp?” wording and rates action. Nothing in the production copy generator changes.

Synthetic payday moves total £1,510, comprising £1,040 and £470. With £1,450 remaining in the salary account, these reconcile to £2,960 expected pay. Each destination balance plus its move equals its target. The set-aside suggestion equals its £45 gap. The deferred goal shows the reduced contribution, £70, not the £90 reduction, with later contributions rounded to £180. Tips make no savings claim.

The hidden-amount view exercises only components that expose supported masking props. It does not pre-mask fixtures or claim to repair unrelated legacy masking gaps, including B54. The real tip's props do not expose the same masking switch, so it is not included in that view.

## Behaviour and regression coverage

Production actions, routes, API calls and local dismissal rules are unchanged. The spending-pattern dismiss control becomes absolute within the card, retaining its 44px V2 target, accessible label and DOM order. The kind row reserves its end space. The tip retains 24px of kind-row clearance beneath its existing 52px close target.

Permanent checks live under `frontend/scripts/`: `g295-home-brief-anatomy.test.mjs`, its browser check and synthetic fixtures. They import production components only. Browser layout evidence uses server-rendered components with the actual Next CSS and fonts, not an authenticated Home page. Native touch and Tab/Enter dismissal are exercised separately through the real hydrated CliffCard in the existing trajectory catalogue, with a local callback. Customer API requests are blocked. Storage checks exclude only that catalogue's own scroll-position namespace, not product keys.

The G295 temporary preview directory and design-index entry are retired under H113. Its fixtures have moved to permanent scripts, reusing G292 fixtures; the browser check reuses the permanent G293 helper. No production code or regression gate imports the retired preview. Publish the approved fold-in through normal `scripts/session.sh finish G295`; the coordinator owns the merge and UAT rebuild.

## Design round evidence

The source/SSR contracts pass 108 component renders and five state deep-links, preserving actual production-card markup apart from generated IDs and hoisted image resource hints. Synthetic arithmetic, Penny identity, dismiss targets and supported masking pass. TypeScript, lint, design-index, strict stale-preview, no-live-data and preview-isolation checks pass. Both the initial and confirmation production builds completed successfully.

The single consolidated correction fixed the family grid's intrinsic minimum width and restored the tip eyebrow's original 24px vertical clearance after tile removal. The grid now has explicit zero-minimum columns and items; each card must fit the viewport even when AppShell could clip its overflow. The shared scroll restorer's own preview-route bookkeeping is explicitly distinguished from product-storage mutations.

The confirmation passed 38 layouts and 374 card instances across 320, 390, 768 and 1280px, both themes, both candidates, the original-layout reference, all family/optional/hidden/empty states. Reading insets, lead/body alignment, dismiss clearance, 44px actions, 16px B glyphs and viewport bounds passed with no layout errors. Native touch navigation, Tab and Enter dismissal, Reset, local preview answers and guarded actions passed, with no customer API attempts or runtime exceptions and no product-storage changes. Root inspected all twelve final captures. Evidence is local at `/tmp/g295-anatomy-final/`; the failed initial batch at `/tmp/g295-anatomy-first/` records the corrected defects, not the final design.

Independent source and final visual reviews passed for the design round. Web Interface Guidelines found no new accessibility issue in that preview. These results belong to the exploration, not to the subsequent production fold-in.

## Approved B implementation

The production diff has passed independent review against B and DESIGN.md. The first implementation browser batch covered 40 layouts and 288 card instances. It found one discrepancy from B: anonymous text lines made non-Penny kind rows 8px too tall. Making the kind wrappers flex containers removes that extra line height without changing typography. Bounds, reading edges, dismiss clearance, supported masking and native local dismissals otherwise passed. The single confirmation build and browser batch passed all 40 layouts and 288 card instances, including the approved B headline-position comparisons. Root inspected all eight final captures at `/tmp/g295-b-foldin-final/`. Native local touch and keyboard dismissals, runtime exception and customer API checks, and product-storage preservation passed.

The Impeccable launcher and detector remain unavailable, so the evidence is source review and rendered measurements, not a detector pass. The focused set-aside, goal and G292 checks pass. Existing ESLint findings are unchanged from main: nine errors and one warning in HomeBrief, one error in HomeInsightSpotlight, none in PaydayPlanCard. No unrelated lint repair is included. Normal finish gates remain required before coordinator publication.
