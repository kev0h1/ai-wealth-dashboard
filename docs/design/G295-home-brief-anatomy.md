# Home brief card anatomy

G295 extends the approved G292 A reading edge across the Home brief family. This is a narrow Impeccable layout round in Operate mode, preserving Sorted's Calm Cockpit. Production and DESIGN.md stay unchanged until Kevin selects a variant.

## Direction

The reading path is card kind and status, headline, optional monetary lead, body or evidence, then the existing action. The headline, lead, body and action start at the card's 16px reading inset. Semantic marks belong within the eyebrow row, not in a separate 36px column that leaves a hole above full-width evidence. Penny retains its gradient badge; all other meaning uses the existing neutral, watch and positive vocabulary. The V2 dismiss control keeps its 44px target and space beside the header.

A, Quiet spine, carries G292 A directly through every card: remove the decorative header tile and retain the existing small status marks. B, Inline cues, uses the same text edge but moves a compact 16px glyph into the eyebrow row, replacing rather than duplicating its dot or tick. The unmodified layout is available as a reference. No type scale, financial sign, wording, figure, data-row identity or action dock is redesigned.

Cards stack at 12px, with 20px between preview sections. The preview uses the actual card components with synthetic props and scoped CSS. Each ordinary HomeBrief example receives the same outer mobile gutter its HomeBrief parent supplies; the tip keeps its own production gutter and is not padded twice. Desktop family views use two independent columns instead of stretching a phone card. This is component-layout evidence, not an authenticated Home screenshot.

## Card inventory

The reported debt-trajectory and Card detail cards lead the comparison, with Covered as the approved reference. The family also includes payday check, rate change, informational and interactive spending patterns, pace note, both cover-plan branches, compact and fallback overdue moves, allocation shortfall, eligible and capped goal easing, the existing deferred-plan note, payday allocation and settled states, the tip and the month-closed invitation.

Bank badges and right-aligned figure columns inside movement and payday ledgers remain data, not decorative header tiles. The payday plan keeps its total and salary allocation structure. The deferred-plan note and empty brief remain canvas content, with no new card boundary. The month-closed invitation already has one text edge; its existing action receives a 44px minimum target in the candidate preview. The collapsed payday entry rows are already aligned and retain their current structure. The generic fallback for future companion types is deliberately plain text and gains no invented card, label or dismissal.

## Copy and money

The debt-trajectory explanation is dense, including unknown-interest and missing-rate caveats. This round flags that density without shortening or collapsing it. The rising fixture uses the current production copy templates with synthetic balances: £2,100 on zero-rate deals plus £504 unclear equals £2,604 carried; the lead is the £186 movement over three months, not the carried position. Card detail uses the existing “Want your card picture sharp?” wording and rates action. Nothing in the production copy generator changes.

Synthetic payday moves total £1,510, comprising £1,040 and £470. With £1,450 remaining in the salary account, these reconcile to £2,960 expected pay. Each destination balance plus its move equals its target. The set-aside suggestion equals its £45 gap. The deferred goal shows the reduced contribution, £70, not the £90 reduction, with later contributions rounded to £180. Tips make no savings claim.

The hidden-amount view exercises only components that expose supported masking props. It does not pre-mask fixtures or claim to repair unrelated legacy masking gaps, including B54. The real tip's props do not expose the same masking switch, so it is not included in that view.

## Interaction and approval

Existing preview-mode guards and local dismissal callbacks are used where available. Capture guards stop navigation, the live payday dismiss, tip navigation, the rhythm payment handoff and plan-editor actions from reaching product routes, storage or services. Those actions show a local explanation or hide the example; Reset restores it. Local disclosures and preview-safe answers retain their real component behaviour. The round is about anatomy, not a new editor or banking journey.

The review covers current and optional content, both themes, true phone widths, intermediate and desktop layouts, masked values, empty content, dismiss overlap, reading edges, semantic marks, touch and keyboard actions, preserved product storage and no customer API attempts. The shared scroll restorer may remember this preview's own position; the storage assertion excludes only that precise preview-route key namespace. Account, preference, handoff and other-route keys remain in the assertion. The Impeccable launcher and layout detector are not executable here, so verification uses source evidence, independent review and rendered measurements rather than a claimed detector pass. Web Interface Guidelines supplies the final accessibility gate alongside PRODUCT.md and DESIGN.md.

Publish through `scripts/session.sh finish G295 --uat-review` so Kevin receives a working preview after coordinator integration, not a blocked item with an unpublished link. The temporary `app/design/home-brief-anatomy/` directory, index entry and preview-only package check must retire when the approved choice is folded into production under H113. The synthetic data reuses permanent G292 fixtures, and the browser check reuses the permanent G293 helper. No other temporary preview is imported.

## Verification

The source/SSR contracts pass 108 component renders and five state deep-links, preserving actual production-card markup apart from generated IDs and hoisted image resource hints. Synthetic arithmetic, Penny identity, dismiss targets and supported masking pass. TypeScript, lint, design-index, strict stale-preview, no-live-data and preview-isolation checks pass. Both the initial and confirmation production builds completed successfully.

The single consolidated correction fixed the family grid's intrinsic minimum width and restored the tip eyebrow's original 24px vertical clearance after tile removal. The grid now has explicit zero-minimum columns and items; each card must fit the viewport even when AppShell could clip its overflow. The shared scroll restorer's own preview-route bookkeeping is explicitly distinguished from product-storage mutations.

The confirmation passed 38 layouts and 374 card instances across 320, 390, 768 and 1280px, both themes, both candidates, the original-layout reference, all family/optional/hidden/empty states. Reading insets, lead/body alignment, dismiss clearance, 44px actions, 16px B glyphs and viewport bounds passed with no layout errors. Native touch navigation, Tab and Enter dismissal, Reset, local preview answers and guarded actions passed, with no customer API attempts or runtime exceptions and no product-storage changes. Root inspected all twelve final captures. Evidence is local at `/tmp/g295-anatomy-final/`; the failed initial batch at `/tmp/g295-anatomy-first/` records the corrected defects, not the final design.

Independent source and final visual reviews passed, including the consolidated corrections. A is recommended as the closest continuation of G292 A; B is a valid, restrained alternative. Repository finish gates remain before publication. Web Interface Guidelines review found no new accessibility issue in the preview: native labelled controls and summaries, keyboard access, visible focus, a skip target, semantic status colours and both themes are retained. No raster asset or new global design rule ships in this round.
