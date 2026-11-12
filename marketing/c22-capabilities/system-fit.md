# C22 capability stories: system fit

## Handoff

This is an ordinary extension of the approved C22 campaign, not a new visual
world. The specialised Impeccable documenter was unavailable, so this note is
the independent documenter substitute. It records checked evidence and
remaining review boundaries; it does not repair governing-file drift.

## What was checked

| Area | Evidence | Fit with the incumbent system |
| --- | --- | --- |
| Typography and money | `frontend/app/design/marketing-kit/features/feature-poster.module.css`, `FeaturePoster.tsx`, and `frontend/remotion/c22-features/FeatureFilm.tsx` use Figtree for interface/display copy and JetBrains Mono with tabular figures for currency. | Preserves the typography-led C22 treatment and the Money Is Mono rule. Currency examples retain the `£` sign and use British English. |
| Surfaces and themes | Feature proof scenes and posters use Mist (`#f0f2f7`) / Midnight (`#0f172a`) grounds, slate ink and hairlines; `CampaignGallery` and `StoreShelf` keep light/dark URL state. | Extends both existing themes without introducing a separate campaign canvas or visual world. |
| Colour meaning | `spend-fixtures.ts` resolves categories through product category colours. `FeatureFilm.tsx` reserves the indigo-to-violet gradient for the Penny close state. | Native category semantics remain informative; Penny remains the only accent owner. |
| Production UI evidence | `FeatureProofScene.tsx` routes stories into fixture hosts `PennyProof`, `SpendProof`, `CoverProof`, `PaymentsProof` and `ActionProof`. The proof components import production conversation, chart, plan and payment surfaces. | The campaign shows recognisable product interactions rather than generic AI imagery or recreated interface lettering. |
| Fixture boundary | The proof components document local, fictional fixture state and API-free hosts. Optional fixture-operation props are additive defaults, leaving production behaviour unchanged. | Capture determinism is explicit without claiming that campaign fixtures are live account data. |
| Gallery and delivery | `CampaignGallery.tsx` keeps theme, format, topic controls, native video controls, captions, downloads and URL state. `StoreShelf.tsx` presents ordered eight-screen sets by platform and theme. | The gallery remains an ordinary extension with keyboard-visible controls and reviewable media, not a replacement information architecture. |

## Capability truth carried by the stories

- Spend is explicit: £860 out by day 10 versus a usual £740; Eating Out is
  £240 versus £120 usual, with four payments totalling £240. The separate
  £400 moved to savings is not counted as spending.
- Cover is explicit: Bills has £68 against an £188 Energy payment. Sorted
  suggests £80 from Everyday and £40 from Joint for the £120 gap. The user
  makes any transfer in their bank; Sorted does not move funds.
- Penny planning is explicit: a £600 car-insurance goal is three £200
  contributions on 30 November, 30 December and 30 January. Confirmation
  creates the plan. A plan is not a bank transfer.
- Upcoming management is explicit: a Boiler service changes from £90 due 24
  November to £95 due 26 November. A scheduled or planned entry is not proof
  that a bank payment has been arranged.
- Set-aside is explicit: £250 for groceries changes the plan and estimate and
  does not transfer money.
- The additional month and 50/30/20 stories remain dated, fictional scenarios;
  the 50/30/20 view is a reference, not a grade or financial advice.

## Media and provenance facts

The current handoff reports 48 social PNGs, 22 films, 66 store PNGs, 10 store
ZIPs, 66 feature UI captures and 10 original captures. New 15-second feature
films use five held three-second shots; the original cuts retain their existing
edits. The gallery and README describe fictional data, provenance metadata and
the boundary between review artwork and native-store submission.

## Unresolved or intentionally unclaimed

- The completed independent media/gallery review returned **ship**. Its scope
  and recorded checks are in [review.json](./review.json). This system-fit note
  records design documentation rather than substituting for that review.
- This note does not claim a backend gate result, native-store parity, or store
  publication approval. Native parity and console submission remain C5 work.
- `.impeccable/design.json` was requested for comparison but is not present in
  this worktree, so no token comparison against that sidecar is claimed.
- Existing PRODUCT Register and current skill metadata drift is reported, not
  repaired. PRODUCT.md, DESIGN.md and any design sidecar remain unchanged.
