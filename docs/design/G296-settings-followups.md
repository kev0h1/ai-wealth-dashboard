# G296 approved Settings implementation

Kevin chose variant A on 20 October 2026. The implementation keeps consent inline, makes the plan one tappable row and removes home-location collection from Profile and onboarding. Stored-location cleanup and privacy wording remain separately gated under G301.

## Folded-in production behaviour

- `ProfileSettingsForm` collects and saves the user's name only.
- `PennyPermissionSettings` reuses the exact `ConsentCard` for inline opt-in and a separate inline confirmation for revocation. Shared preferences are authoritative, with unknown, retry and lost-response reconciliation states. Consent grant and revoke both bump the preferences version so an older GET cannot replace the verified result.
- The compact `YourPlanCard` uses the known real billing-period catalogue and the shared real `PlanPicker`, including its native guards and usage handling.
- Profile, onboarding and API paths no longer collect or expose home postcode or coordinates. Fuel requires explicit point-of-use coordinates, and `next.config` permits same-origin geolocation.

The stored legacy `user_profiles` postcode, latitude and longitude fields remain untouched. A cleanup migration and related privacy wording require separate explicit approval and are still pending. Vendor station locations are unchanged.

## Historic design choice and provenance

Variant A kept consent inline, with the plan action and Penny permission as separate jobs. It retained Sorted's slate canvas, Figtree text, restrained indigo controls and existing G201 grouping, with the indigo to violet gradient reserved for Penny. The earlier preview established the useful interaction contract: consent is explicit, cancellation preserves the last confirmed value, errors offer retry, and unknown permission is not labelled Off. Those choices are now represented by production components and shared state rather than a temporary preview.

The temporary settings-followups preview and index entry have been retired. Preview tests and fixtures now live under `frontend/scripts` where still needed. The old design-round instructions to finish with a public variant choice, or to claim that production remained unchanged, no longer apply.

## Verification status

Focused backend verification passed 98 tests, including the unchanged exception-leak scanner after updating its existing allowlisted line positions for the two-line consent change. G296 production SSR and all 16 reconciliation paths passed, as did the G201, B50 and native billing gates. The production Webpack build, TypeScript, new-component ESLint and design-index/stale gates passed. Existing unrelated lint errors in Settings and onboarding were checked against the base revision and left outside this change.

The isolated browser host rendered the actual production components with built Next CSS and fonts. All 27 layouts passed across 320, 390, 768 and 1280px, both themes and the subscription edge states. It exercised consent acceptance, cancellation, revocation, retry, unknown state, a response lost after a successful write, Space and focus restoration, the real PlanPicker sheet, and Profile Enter submission. Ten original-detail captures were inspected under `/tmp/g296-a-production`. The host stubs all permission writes and preference reads and blocks customer API traffic. It is a regression harness under `frontend/scripts`, not a retained product or design route.

The Web Interface Guidelines review used the fresh published rules and checked labels, native semantic controls, touch targets, focus, live feedback, reduced motion and unknown permission semantics. Full repository delivery checks run through `scripts/session.sh finish G296`; the coordinator, not this worktree, merges and publishes the branch.

The independent source review returned Ship after the geolocation fix. A pre-existing execute/revoke concurrency race is recorded separately as A170; it was not fixed or introduced by this work. The preferences version increment orders UI snapshots, not proposal execution.

The Impeccable launcher previously returned Permission denied, and its packaged reviewer and documenter roles were unavailable. Manual independent source review and documentation review were therefore used as the substitute. No detector pass or native-device-runtime pass is claimed.

## Remaining approval boundary

Do not remove legacy home-location fields, run a cleanup migration, or change privacy wording without separate explicit approval covering scope, dry-run and reporting, and policy text. G301 records this approval boundary. Do not alter vendor station locations. G296 is ready for the normal delivery gates, not a claim that UAT or a native bundle has already been deployed.
