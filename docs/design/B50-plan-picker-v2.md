# B50: room to choose a plan

Design round only. Operate mode inside the established Calm Cockpit. Prices, entitlements, purchasing policy and legal terms are not being changed. The task is to make choosing and comparing readable on a phone, with an honest current-plan and trial state.

## Direction contract

THESIS: separate a plan's full description from its price and payment decision, so neither is squeezed into a trailing column.

OWN-WORLD: existing Figtree UI, mono currency, slate canvas and white/dark-slate action surfaces. Indigo marks selection, not a sales recommendation. No Penny gradient, invented popularity badge or warning-coloured prices.

STORY: understand the existing plan, compare full descriptions, choose a plan and billing period, read the total and any eligible trial terms, then review with the correct billing provider. Selection never changes the current subscription.

FIRST VIEWPORT: A shows readable full-width plan choices, with descriptions and prices on separate lines. B gives one selected plan a full reading area and puts comparison behind a labelled inline control. Both show the current account state early; desktop earns comparison space rather than stretching a phone.

FORM: two code-led alternatives for an existing component, not a new visual world or identity exercise. Both use one fixture/pricing model and local-only actions. The real unchanged `PlanPicker` remains a labelled reference using `previewOnly` and `nativeOverride` props; no pre-approval production variant prop is added. The signature interaction is selection updating the disclosed price, billing period and adjacent offer together, without a pop-up or subscription mutation.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Product and billing truth

- Four default plans: Statements, Lite, Standard and Max. Connect appears only in an explicitly enabled web/UAT fixture, never as an iOS/Android SKU. A legacy Connect subscriber can still see their existing state without being silently moved to another tier. B51 owns actual tier availability and any migration decision.
- Prices and enabled periods mirror `backend/app/core/subscription.py`: monthly, six months and annual. Savings are the exact pounds against the same number of monthly payments, not a free-month claim. Equivalent monthly prices are subordinate to the actual charged total. Static tests compare the fixture against the backend's literal catalogue without importing application code or touching a database.
- B50's original Android external-Stripe wording and the older C13 spec are superseded by Kevin's C24 decision of 17 October 2026: Google Play Billing on Android, StoreKit on iOS, Stripe on web. The latest C21/C24 correction records store target prices matching web, with no Connect products. This round changes none of those integrations.
- Store-ready examples are labelled proposals with mocked product/eligibility responses, not currently live functionality. Actual store product prices and eligibility must be fetched and verified before a purchase. Missing products/prices and unknown eligibility never promise a trial or enable a purchase.
- A 14-day trial is shown only for an eligible new subscription and an enabled period. The amount, charge timing, automatic renewal and cancellation route sit beside its action. Existing trial/paid/grace/cancelled states lead to the original provider, never a second subscription or a fresh trial. Comparing a new period does not overwrite the current renewal amount/date. Proration is not invented.
- Web trial wording uses the existing B22/B45 billing-copy helpers. Native cancellation wording is provider-specific, not the web's promise of keeping all remaining free days. Terms and privacy documents are not rewritten by a layout round; new native wording remains proposed copy for review.
- All account examples are synthetic and dated 17 October 2026. No checkout, portal, StoreKit, Play, restore, account mutation, external model, storage write or customer API call is implemented. The existing component is shown through its safe preview boundary.

## Verification contract

Check both alternatives at 390px in both themes for free, trialling and paid states on web/iOS/Android; narrow 320px, wide desktop, long copy, unavailable prices/products, unknown trial eligibility, cancelled/past-due and legacy/cross-provider cases. Test plan and period selection, radio keyboard behaviour, comparison, local action/restore notices and recovery. Prices and meaningful signs remain whole and right-aligned where compared; descriptions never truncate. Native readiness is a proposal, not a tested store integration. Use one initial root screenshot batch, one combined correction and one confirmation, then independent finish review and documentation audit. Finish B50 with `--uat-review`; the coordinator publishes `/design/plan-picker-v2` before Kevin chooses. Delete the round on fold-in under H113.

## Sources checked, 17 October 2026

- [StoreKit introductory-offer eligibility](https://developer.apple.com/documentation/storekit/product/subscriptioninfo/introductoryoffer): an offer's existence does not establish the customer's eligibility.
- [Apple cancellation help](https://support.apple.com/en-gb/118428): trial cancellation should precede its end by at least 24 hours.
- [Google Play product and offer handling](https://developer.android.com/google/play/billing/integrate): real product metadata and eligible offers drive the final purchase flow; an existing subscriber should not be offered a duplicate subscription.

These are design constraints, not a legal opinion or a claim that either store integration has shipped.

## Review record

Both variants were inspected at 390px across the three platform proposals,
free/trial/paid states and both themes, plus 320px edge states and 1440px
desktop. Extra checks cover long descriptions, the explicitly enabled web
Connect fixture, cross-provider ownership, comparison, the actual inert
reference, keyboard radios, local notices and recovery. No API writes or
browser page errors occurred. Catalogue/limits/eligibility tests, the build,
new-file lint and design-index/stale checks passed.

The unavailable detector supplied no verdict. A fresh independent manual
finish review returned `disposition: ship` for this coded preview only, and
the documentation audit recommended no system changes. PRODUCT.md and
DESIGN.md remain authoritative and unchanged. Native runtime, purchase and
restore behaviour are not verified or shipped by this round.
