# G287: calm, useful Safe to Spend shortfalls

Design round only. Operate mode, extending the existing Home instrument. The current G218 hero is the reference, not silently replaced. Kevin will choose between coded alternatives before any production or DESIGN.md change.

## Direction contract

THESIS: state the cash consequence and a useful next step without a daily wall of red. Familiarity with a shortfall never makes a genuine payment risk disappear.

OWN-WORLD: Calm Cockpit slate/white surfaces, Figtree labels, mono ink money and compact semantic signifiers. No new brand language, decorative warning surfaces or Penny gradient.

STORY: distinguish money needed for payments from money reserved for optional plans, see the exact working, inspect a relevant next step and understand any recurring pattern without blame.

FIRST VIEWPORT: A keeps the amount-led instrument but replaces coloured money with ink and a precise consequence signifier. B leads with the next useful review and shows the gap beside its cause. Both preserve the calculation and an inspectable ledger; on desktop the evidence gains its own column rather than stretching the phone.

FORM: two local coded treatments of the existing hero. The unchanged production SafeToSpendCard is available through synthetic fixture props as the current reference, while proposed new layouts remain preview-only. No new production prop or CSS override ships in this round. Same data, different hierarchy, no competing financial calculation.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Financial and emotional boundaries

- Required fixtures: one-off cash shortfall, habitual cash shortfall, plans-only shortfall and an account-level gap coverable by an own-account transfer. Also verify a small gap, immediate genuine payment risk, masked values, loading/stale/error and long figures.
- A recurring pattern never downgrades genuine risk. Red may identify an evidenced payment at risk, not a person's identity. Small does not mean harmless if a payment is due. Optional plans are not bills, so passing a plan reserve is not a red payment warning.
- A transfer between counted accounts cannot repair a negative pooled cash forecast. The coverable fixture must have sufficient pooled cash, a specifically short paying account, a valid spare source and conditional wording. A proposed transfer is not a completed transfer. Do not fabricate a recovery action for a pooled gap.
- Use existing `deriveSafeToSpendHeadline` and real SafeToSpend fixture shapes for the headline basis. Show the signed shortfall in the working even when the main figure reads an unsigned amount with a clear 'needed' label. Reconcile every displayed operand, including the time-ordered low point where applicable.
- The historical '4 of 6 periods' example is synthetic, based on comparable completed periods and labelled as a proposed evidence view. Unknown or stale history is withheld. It is not a prediction, a character judgement or a new claim about stored production history.
- No financial advice, bank action, account mutation, plan save, automatic Penny turn or external model call. Controls explore local state and review evidence only. The standard estimate disclaimer remains. No em dashes; British English; full grouped mono currency and meaningful signs.
- Measure current red-on-dark contrast and report it, but do not revise global tokens or DESIGN.md until a winner is chosen. Root inspects 390px both themes, 320px/desktop and material states in bounded passes, then gets an independent review.
- Register `/design/sts-tone`, run index/stale gates and finish G287 with `--uat-review`, leaving publication to the coordinator. Remove the temporary preview on fold-in under H113.

## Review evidence, 17 October 2026

- Root inspected an initial batched matrix, made one combined refinement batch and confirmed the final captures. Evidence is retained locally in `frontend/.impeccable/review/g287/`, not shipped as app assets: 48 viewport/state captures, 12 review-sheet captures and two current-reference captures. Coverage includes 390px both themes, 320px long figures, 1440px desktop, all financial cases, masking and loading/stale/error. The evidence panel has an explicit browser visibility assertion.
- Working opens inline, rather than duplicating the ledger in another modal. Local review sheets show the relevant account, reserve or payment calculation. Browser checks passed for opening/closing, Escape and focus return, stale/error recovery and masked sheet values. All customer API requests were intercepted; no customer writes, unexpected external requests or page exceptions occurred.
- Current production reference contrast was measured from computed browser CSS, converted to sRGB, rather than assumed from an old token. Dark: red RGB(251,44,54) on RGB(28,37,55), ratio 4.028:1. Light: red RGB(231,0,11) on white, ratio 4.770:1. The current figure is 38px/700, so it meets the large-text AA threshold of 3:1; the dark measurement is below the 4.5:1 ordinary-text threshold, but is not a large-figure contrast failure. This round explores emotional tone and hierarchy, not a fabricated accessibility defect.
- Production build, scoped ESLint, exact financial fixture checks, design-index and strict design-stale checks passed. `session.sh finish --uat-review` additionally requires the disposable-database backend suite, typecheck and all registered frontend checks; its delivery result is recorded on the board.
- A fresh independent finish reviewer returned `disposition: ship`, with no material fixes, for the design previews. Production and the approved G218 coloured-hero doctrine are unchanged. A fresh documentation audit preserved `DESIGN.md` and its sidecar, explicitly leaving this proposed ink-money alternative uncanonised until Kevin chooses.
- The Impeccable launcher/detector returned permission denied, so no detector pass is claimed. Manual craft-floor/current Web Interface Guidelines checks and fresh isolated fallback reviewer/documenter agents were used because the specialised roles were unavailable. No raster assets or external model calls were introduced.
