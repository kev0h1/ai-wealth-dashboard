# Settings profile plan and Penny permission

G296 is an Impeccable Operate-mode extension of G201 D, not another Settings information architecture. The design round proposes postcode-free Profile, one compact plan action and a reversible Penny permission with explicit consent before enabling. Production code, billing, preferences, policies and stored location data stay unchanged until an approved fold-in.

## Direction contract

THESIS: Settings should show what is enabled and let the user change it without finding a conversational back door. Billing and permission remain separate jobs.

OWN-WORLD: Inherit Sorted's slate canvas, Figtree text, mono currency, restrained indigo controls and existing G201 grouping. Penny alone retains its gradient. No new artwork, hero or identity system.

STORY: Read the current plan and usage, open the real plan picker, or ask to change Penny's permission. A switch request does not grant consent. The user reads the explanation and explicitly agrees; cancelling leaves the previous value intact.

FIRST VIEWPORT: The Penny and your plan detail has one compact, fully tappable plan row with usage below. A separate Penny section has a familiar, labelled 44px switch and a short explanation. Profile remains its own detail, with full name and Save, not a mixed account-settings scroll.

FORM: Two narrow coded variants, A In place and B Focused consent. A reveals consent within the current page; B uses the existing SheetFrame with protected focus and persistent actions. They share the plan row and Profile proposal. This is an established local extension, so no concept seed or raster comp applies. Kevin's board brief supplies the requirements; his choice follows the published coded variants.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. DESIGN.md and PRODUCT.md remain unchanged for this unapproved local extension; no raster ships.

## Production truth and reuse

Profile and the Penny permission are private inline JSX in `frontend/app/settings/SettingsPage.tsx`, not prop-backed exported sections. Their proposed rows are therefore explicitly local prototypes, not claims that production already has Settings opt-in. Reused production parts are `ConsentCard`, `PennyUsageRow`, `PlanPicker`, `SheetFrame` and the current `YourPlanCard` as a guarded reference. No production component is changed to make this preview possible.

The source of the off-only dead end is Settings' unconditional consent branch: it renders Turn off for a recorded `penny_agent_consent`, and otherwise instructions to ask Penny. There is no native-specific or agent-mode deployment flag in that render path. `run_penny_agent` offers propose schemas and gates dispatch on consent; `POST /penny/agent-consent` records consent, and DELETE clears it and cancels pending proposals. This source finding does not inspect Kevin's installed bundle, deployment configuration or personal preference record.

Both proposed on flows retain the current ConsentCard explanation and explicit acceptance. Both off flows explain that pending proposals will be cancelled before changing the switch. Errors preserve the last confirmed value and offer retry; unknown/loading permission is not labelled Off. A hypothetical unavailable state is labelled unavailable, not presented as a verified production flag. Web, iOS and Android examples share the same permission flow. Plan-store examples are fixtures, not StoreKit or Google Play runtime verification. Price, trial, cancelled renewal and payment-retry states must not imply a charge that the fixture does not contain.

The same propose-only perimeter remains: internal app records can be drafted, every change requires a separate confirmation, and no bank payment or money movement is authorised by this permission. No regulated guidance or automatic action is introduced.

## Postcode removal and later privacy approval

The profile stores `postcode`, `lat` and `lng` together in `user_profiles`. Removing the Settings input alone would leave derived home location behind and keep the fuel endpoint's stored-location fallback active. Onboarding also collects the same field. Fuel forecourt postcodes and coordinates are separate vendor data and must not be deleted.

An approved implementation should remove home-location collection from Profile and onboarding, narrow the profile API, and use the Fuel card's point-of-use device-location flow. Update the endpoint's 422 message so it no longer sends users to Profile. If a manual fuel-location option is wanted, design it at the point of use rather than silently restoring a home profile field.

Deletion is a separate approval boundary: do not run a migration during this design round or treat a visual choice as permission to erase data. The later operational migration should explicitly target only `user_profiles.postcode`, `.lat` and `.lng`, be idempotent with dry-run/count/report, and leave station snapshots untouched. Kevin must approve its scope and policy wording. `PRIVACY.md` and `frontend/content/privacy.md` currently disclose optional postcode collection and postcodes.io; their approved updates and derived-policy artefacts belong to that implementation, not this preview.

## Verification and delivery

Exercise both variants, themes, 320/390/768/1280px widths, all platform examples, consent cancellation and revocation, save failure/retry, unknown/unavailable permission, plan states and Profile. Assert no customer API requests, product navigation or product-storage mutations. Compare source with the unchanged production parts, inspect screenshots and obtain an independent finish review plus Web Interface Guidelines review. The Impeccable launcher was unavailable earlier in this session; use direct project context and disclose detector availability rather than inventing a pass.

Local verification completed on 20 October 2026: the preview contract suite, scoped ESLint, typecheck, design-index/stale gates and final `next build --webpack` passed. The first Turbopack build passed, but rebuilding the changed CSS module was refused when its worker tried to bind a local port, including on the escalated retry. The supported Webpack build verified the final source instead; no deployment configuration was changed.

The isolated browser matrix passed 33 layout checks and produced 15 inspected captures under `.impeccable/review/g296/`. It exercised both consent variants in both themes, narrow/tablet/desktop layouts, cancellation and revocation, failed save/retry, Space, Escape and browser Back, plan states and guarded primary/policy actions, and Profile typing/Enter submission/save retry. There were no browser exceptions, API requests or product-storage writes. The only excluded storage namespace was the app's existing scroll restorer for this preview route. The first batch's sheet focus-return defect was corrected, its oversized sheet reduced using the existing compact variant, and its nested dark surface removed.

The final Impeccable detector attempt exited 126, Permission denied. Its packaged reviewer and documenter agent roles were also unavailable, so fresh independent manual review and documentation audit were used instead. No detector or native-device-runtime pass is claimed. The documentation audit found no material mismatch and preserved the existing global design and product files.

The independent finish review matched the five direction promises and raised one dark Profile capture finding. An original-detail recapture and DOM text bounds demonstrated the complete, unclipped account-tab label at 390px without a UI change. The reviewer scored that finding resolved and returned `ship`; this verdict covers the listed capture fix. The scoped Web Interface Guidelines review checked semantic controls, labels, focus styles, reduced motion, live save feedback, touch sizes and theme handling against the fresh published rules; it required no further production or design-system changes.

The delivery gate's native-dialog scanner mistook the local `confirm()` callback for the browser API. Renaming it to `confirmPermission()` resolved the ambiguity without changing any handler body, copy or layout. A byte-for-byte comparison after normalising that identifier confirmed the equivalence; the contract suite also rejects ambiguous native-dialog call names.

Finish with `scripts/session.sh finish G296 --uat-review` after the normal repository gates. The coordinator publishes the preview and returns the item to UAT for Kevin's choice. Retire `app/design/settings-followups/`, its index entry and preview-only checks during the approved fold-in under H113, preserving only independently needed fixtures or regression tests.
