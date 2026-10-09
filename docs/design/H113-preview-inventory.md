# H113 design preview inventory

Phase 1 (2026-10-08) listed 132 preview directories, nothing deleted. Phase 2 (2026-10-09) applied Kevin's decision: DELETE merged previews entirely, no gate preview per shipped surface (this overrides the G48 rule and H43/H44's conversion plan).

## Final state

- Before: 132 directories. Deleted: 66 in total (61 in the first four commits, then 5 more once the importer regex was fixed). After: 66.
- Rule applied: delete when every referencing item (ignoring housekeeping H43, H44, H113, G126; a cancelled item counts as finished) is done or cancelled, or when no item references it and it is older than 7 days, including the 24 former GATE-CANDIDATEs and the UNSURE ones that fit. Keep when an item is todo, in-progress, review, uat, rejected or blocked; when code outside `app/design` imports or reads it (production, `frontend/remotion`, `frontend/scripts/*.test.mjs`); when another kept preview imports it; for compliance/approval packs; and for marketing assets.
- Kept only because something imports or reads it (Kevin may decide later): allocation-shortfall (g217 test), bank-consent-journeys and bank-picker (a155 tests), card-terms-sheet (g225 test), finexer-consent-intro (a155/g226 tests plus compliance README), g176-account-plans/-status/-upcoming-rows (g176/g235 tests), home-cleanup (g221 test), penny-keyboard (g191 test), plan-deferral (g228 test), planning-ladder-timeline (g187 test), signin-loading (mobile-login-loop test), spend-hero and spend-hero-scale (g186 tests), spend-pace-copy (g140 test), sts-accounts-route (g219/g221 tests), upcoming-by-account (g229 test), ad-safe-to-spend (remotion), marketing-kit (remotion).
- Kept because a kept preview imports it: cards-page, g88-home-real, home-brief-cards, insights-live, month-story, planning, safe-to-spend-hero.
- Not deleted despite the plain rule: g100-scenario-canvas, g99-month-story-canvas (G100, G99 in uat, matched by surface name), month-closed-card (G168 blocked), signin-handoff (hand-off page drift gate, `scripts/check-signin-handoff.mjs`), penny-fullscreen (G240 shipped, G244 polishing).
- `check:design-stale` is now strict and exempts previews imported by code, by a sibling preview, or referenced by compliance/media.

## Correction (review of 6b9b851e)

The importer detection matched the word `from` on comment lines, so account-picker, dismissed, penny-usage-ring, planning-create, spend-tips and mcp-activity-canvas-before-cards were wrongly kept as "imported by production code". The regex now strips comments first. Five were deleted. spend-tips is kept because spend-live (A29 todo) imports `../spend-tips/fixtures`. Dead `/design/<slug>` links in account-detail and settings-overhaul were fixed and `check:design-index` now fails on any such link.

## UNSURE resolutions (grep TODO.md for the surface name)

- v1, v2, v3: no item names them (`backend/app/routers/goals.py` has one comment); 18 days old. Deleted.
- app-only: C17 (blocked) mentions `AppOnlyPage.tsx` but not the preview, and the component is never rendered in the mobile export. Deleted.
- month-closed-card: G168 (blocked) says the preview supports the production card. KEPT.
- payday-plan-executed: G164 lifecycle stripped by G172; payday-plan-standing-orders (G173 uat) is the live preview. Deleted.
- g111-spend-from-bank: G111 done. g89-planning-canvas: G89 done. Deleted.
- g99-month-story-canvas, g100-scenario-canvas: G99, G100 in uat. KEPT.
- miscategorised, connected-assistants, penny-chat/-sheet/-thread, spend-charts, settings-usage-row, month-story: items done or none; only code comments mention them. Deleted (month-story is kept for now because g99-month-story-canvas imports it).
- accounts-rows, accounts-tiles, cards-check, g29-reconnect-rows, g31-planning-hero, safe-to-spend-hero (H43 remainder), home-brief-cards (H44; G48 and G69 are done): deleted, except safe-to-spend-hero, cards-page and home-brief-cards, which stay because sync-loading, first-sync, safe-to-spend-figure, g91-cards-canvas and g134-home-inventory import them.

## Deleted (61)

`g88-home-canvas`, `category-kind`, `cover-plan-sources`, `date-picker`, `error-states`, `g115-spend-from-accounts`, `g119-filter-pill`, `g128-payday-reconcile`, `goal-link-sheet`, `home-tip-gesture`, `move-card-grammar`, `oauth-consent`, `payday-plan-grammar`, `plan-source-account`, `planning-ladder`, `spend-containment`, `spend-page-refurbishment`, `spend-penny-flow`, `spend-period-round`, `tax-canvas-before-cards`, `upcoming-account-edit`, `your-plan`, `accounts-preview`, `app-icon`, `coming-up`, `g16-safe-to-spend`, `penny-glyph`, `planning-plans`, `scenario-a`, `scenario-b`, `scenario-c`, `spend-a`, `spend-b`, `spend-header-rules`, `type`, `upcoming-hero-setaside`, `upcoming-plan`, `accounts-rows`, `accounts-tiles`, `app-only`, `cards-check`, `connected-assistants`, `dismiss-x`, `g111-spend-from-bank`, `g29-reconnect-rows`, `g31-planning-hero`, `g89-planning-canvas`, `home-brief-width`, `miscategorised`, `payday-plan-executed`, `penny-chat`, `penny-sheet`, `penny-thread`, `settings-usage-row`, `spend-charts`, `spend-shape`, `spend-verdict-b`, `spend-verdict-c`, `v1`, `v2`, `v3`

## Kept (71)

| Slug | Why |
|---|---|
| `account-detail` | open G205(in-progress) |
| `accounts-canvas-before-cards` | open G117(in-progress),G123(todo),H92(todo) |
| `accounts-header` | open G236(uat) |
| `ad-safe-to-spend` | open C22(uat),G222(uat) |
| `ai-intro-reel` | open C22(uat),G224(uat) |
| `allocation-shortfall` | imported/read by frontend/scripts/g217-allocation-card.test.mjs |
| `app-lock` | open A131(todo) |
| `bank-consent-journeys` | imported/read by frontend/scripts/a155-consent-journeys.test.mjs |
| `bank-picker` | imported/read by frontend/scripts/a155-bank-picker.test.mjs, frontend/scripts/a155-consent-journeys.test.mjs |
| `card-terms-sheet` | imported/read by frontend/scripts/g225-card-terms.test.mjs |
| `cards-page` | imported by a kept preview (design-internal import) |
| `cover-plan-safeguards` | open G200(uat) |
| `cover-plan-sources-scale` | open G200(uat) |
| `finexer-consent-intro` | imported/read by frontend/scripts/a155-consent-journeys.test.mjs, frontend/scripts/g226-finexer-intro.test.mjs |
| `first-sync` | open G214(in-progress) |
| `g100-scenario-canvas` | open item G100 (uat); name match, not slug |
| `g119-transactions-live` | open A29(todo) |
| `g124-upcoming-refine` | open G125(uat),H86(todo) |
| `g134-home-inventory` | open G134(uat),H92(todo) |
| `g149-transfer-review-placement` | open H92(todo) |
| `g176-account-plans` | imported/read by frontend/scripts/g176-account-plans.test.mjs, frontend/scripts/g235-plan-overlap.test.mjs |
| `g176-account-status` | imported/read by frontend/scripts/g176-account-status.test.mjs |
| `g176-upcoming-rows` | imported/read by frontend/scripts/g176-accounts.test.mjs, frontend/scripts/g176-preview.test.mjs |
| `g88-home-real` | imported by a kept preview (design-internal import) |
| `g91-cards-canvas` | open G91(uat) |
| `g93-penny-canvas` | open G93(uat) |
| `g94-settings-canvas` | open G94(rejected:fea) |
| `g96-receipts-canvas` | open G96(uat),G98(uat) |
| `g98-month-canvas` | open G98(uat) |
| `g99-month-story-canvas` | open item G99 (uat); name match |
| `home-brief-cards` | imported by a kept preview (design-internal import) |
| `home-cleanup` | imported/read by frontend/scripts/g221-home-cleanup.test.mjs |
| `insights-live` | imported by a kept preview (design-internal import) |
| `invite-only` | open A137(todo),D9(blocked) |
| `marketing-kit` | open C22(uat) |
| `mirror-canvas-before-cards` | open G97(uat),G98(uat) |
| `money-shape-canvas-before-cards` | open G95(uat) |
| `month-closed-card` | G168 (blocked) is the month-closed card item; its note says the preview supports the production card |
| `month-story` | imported by a kept preview (design-internal import) |
| `offline-account` | open G233(uat) |
| `ops-board-mobile` | open A97(todo),H65(todo) |
| `payday-plan-standing-orders` | open G173(uat) |
| `penny-fullscreen` | G240/G244 round (G244 in-progress polishing it) |
| `penny-keyboard` | read by frontend/scripts/g191-keyboard.test.mjs |
| `plan-deferral` | imported/read by frontend/scripts/g228-plan-deferral.test.mjs |
| `planning` | imported by a kept preview (design-internal import) |
| `planning-ladder-timeline` | imported/read by frontend/scripts/g187-timeline.test.mjs |
| `reel-safe-to-spend` | open C22(uat),G223(uat) |
| `safe-to-spend-figure` | open G214(in-progress) |
| `safe-to-spend-hero` | imported by a kept preview (design-internal import) |
| `settings-overhaul` | open G201(uat) |
| `sheet-anatomy` | open G205(in-progress) |
| `sheet-swipe` | open G205(in-progress) |
| `signin-handoff` | approval pack: checked by scripts/check-signin-handoff.mjs and shared/signin-handoff (G199) |
| `signin-loading` | read by frontend/scripts/mobile-login-loop.test.mjs |
| `spend-hero` | imported/read by frontend/scripts/g186-hero-scale.test.mjs, frontend/scripts/g186-spend-hero.test.mjs |
| `spend-hero-scale` | imported/read by frontend/scripts/g186-hero-scale.test.mjs |
| `spend-live` | open A29(todo) |
| `spend-pace-copy` | imported/read by frontend/scripts/g140-pace-copy.test.mjs |
| `spend-tips` | imported by a kept preview (design-internal import) |
| `spend-verdict-a` | open A29(todo) |
| `sts-accounts-route` | imported/read by frontend/scripts/g219-accounts-route.test.mjs, frontend/scripts/g221-home-cleanup.test.mjs |
| `sync-loading` | open G214(in-progress) |
| `transactions-canvas-before-cards` | open G118(todo) |
| `upcoming-by-account` | imported/read by frontend/scripts/g229-by-account.test.mjs |
| `upcoming-canvas-before-cards` | open G90(uat) |

G246 (2026-10-09): `g100-scenario-canvas` was deleted with the /scenario page it designed (the life simulator was removed).
