# H113 design preview inventory (phase 1, nothing deleted)

Generated 2026-10-08 by `frontend/scripts/design-preview-inventory.mjs`. 132 preview directories under `frontend/app/design/` (excluding `_components`).

## Counts per proposed action

- KEEP: 61
- GATE-CANDIDATE: 24
- DELETE-CANDIDATE: 17
- UNSURE: 30

## Rules

- KEEP: a referencing item is todo, in-progress, review, uat, rejected or blocked (including marketing items G222 to G224, C22); or referenced by `docs/compliance`, marketing assets or `docs/design/c22-marketing-kit.md`; or really imported (not just mentioned in a comment) from outside `app/design`.
- Housekeeping items H113, H43 and G126 only list previews while sweeping them, so they appear in the Items column but do not on their own keep a preview.
- GATE-CANDIDATE: renders production components and every referencing item is done or cancelled (at least one). One per shipped surface is what Kevin may keep.
- DELETE-CANDIDATE: no open item, last commit older than 7 days, hand-authored markup only.
- UNSURE: anything else.
- "Renders production" means a file in the directory imports from `@/components`, any `@/app/<route>` other than `@/app/design`, or a relative `components` path. It does not prove the page is a faithful gate for the shipped surface.
- Item matching: `design/<slug>` in an item's TODO.md block, or the bare slug when it contains a hyphen. One-word slugs match path form only, so expect some false negatives where prose names a preview loosely.

## Table

| Action | Slug | Items (state) | Last commit | Renders | Outside imports (mentions) | Compliance / media | Reason |
|---|---|---|---|---|---|---|---|
| KEEP | `account-detail` | G87 (done), G126 (todo), G205 (in-progress) | 2026-08-16 | production | none | none | open item G205 (in-progress); also mentioned by housekeeping G126 |
| KEEP | `account-picker` | none | 2026-09-02 | production | frontend/components/AccountRadioPicker.tsx (mentions: frontend/components/PlanOneOffSheet.tsx) | none | imported outside app/design (frontend/components/AccountRadioPicker.tsx) |
| KEEP | `accounts-canvas-before-cards` | G105 (done), G113 (done), G117 (in-progress), G123 (todo), G231 (done), H92 (todo) | 2026-10-07 | production | none (mentions: frontend/scripts/accounts-pinned.test.mjs) | none | open item G117 (in-progress), G123 (todo), H92 (todo) |
| KEEP | `accounts-header` | G236 (uat) | 2026-10-08 | production | frontend/scripts/g236-accounts-header.test.mjs (mentions: frontend/components/AccountsHeader.tsx) | none | open item G236 (uat) |
| KEEP | `ad-safe-to-spend` | C22 (uat), G222 (uat) | 2026-10-06 | production | frontend/remotion/PhoneLayer.tsx | none | marketing item C22 (uat), G222 (uat) |
| KEEP | `ai-intro-reel` | C22 (uat), G224 (uat) | 2026-10-06 | hand-authored | none | none | marketing item C22 (uat), G224 (uat) |
| KEEP | `allocation-shortfall` | G217 (done) | 2026-10-06 | production | frontend/scripts/g217-allocation-card.test.mjs | none | imported outside app/design (frontend/scripts/g217-allocation-card.test.mjs) |
| KEEP | `app-lock` | A121 (done), A125 (done), A131 (todo), A140 (done), G203 (done) | 2026-10-04 | production | none | none | open item A131 (todo) |
| KEEP | `bank-consent-journeys` | A149 (done), A155 (done) | 2026-10-08 | production | frontend/scripts/a155-consent-journeys.test.mjs (mentions: frontend/scripts/a149-bank-return-reset.test.mjs) | none | imported outside app/design (frontend/scripts/a155-consent-journeys.test.mjs) |
| KEEP | `bank-picker` | A155 (done) | 2026-10-08 | production | frontend/scripts/a155-bank-picker.test.mjs, frontend/scripts/a155-consent-journeys.test.mjs | none | imported outside app/design (frontend/scripts/a155-bank-picker.test.mjs, frontend/scripts/a155-consent-journeys.test.mjs) |
| KEEP | `card-terms-sheet` | G225 (done) | 2026-10-07 | production | frontend/scripts/g225-card-terms.test.mjs | none | imported outside app/design (frontend/scripts/g225-card-terms.test.mjs) |
| KEEP | `cover-plan-safeguards` | G200 (uat) | 2026-10-03 | production | none | none | open item G200 (uat) |
| KEEP | `cover-plan-sources-scale` | G51 (done), G200 (uat), H40 (done), H42 (done), H44 (todo) | 2026-09-13 | production | none | none | open item G200 (uat), H44 (todo) |
| KEEP | `dismissed` | none | 2026-09-14 | production | frontend/app/planning/dismissed/SetAsideClient.tsx (mentions: frontend/app/planning/dismissed/bankBadge.ts) | none | imported outside app/design (frontend/app/planning/dismissed/SetAsideClient.tsx) |
| KEEP | `finexer-consent-intro` | G226 (done) | 2026-10-08 | hand-authored | frontend/scripts/a155-consent-journeys.test.mjs, frontend/scripts/g226-finexer-intro.test.mjs (mentions: frontend/scripts/gen-finexer-intro-fixtures.mjs) | docs/compliance/finexer-template-approval/README.md | referenced by compliance docs (docs/compliance/finexer-template-approval/README.md) |
| KEEP | `first-sync` | G210 (done), G212 (done), G214 (in-progress), G218 (done), G219 (done), G221 (done) | 2026-10-05 | production | none | none | open item G214 (in-progress) |
| KEEP | `g119-transactions-live` | A29 (todo), G119 (done), G122 (done), G126 (todo) | 2026-09-18 | production | none (mentions: frontend/app/transactions/TransactionsPage.tsx, frontend/components/TransactionFilterChips.tsx, frontend/components/TransactionFilterSheet.tsx, frontend/lib/transactionFilters.ts, frontend/lib/transactionGrouping.ts) | none | open item A29 (todo); also mentioned by housekeeping G126 |
| KEEP | `g124-upcoming-refine` | G125 (uat), G127 (done), G130 (done), G131 (done), G227 (done), H86 (todo) | 2026-10-07 | production | none (mentions: frontend/components/upcoming/SetAsideList.tsx, frontend/components/upcoming/UpcomingDivider.tsx, frontend/lib/upcomingMarkers.ts, frontend/scripts/set-aside-display.test.mjs) | none | open item G125 (uat), H86 (todo) |
| KEEP | `g134-home-inventory` | G134 (uat), H92 (todo) | 2026-09-26 | production | none | none | open item G134 (uat), H92 (todo) |
| KEEP | `g149-transfer-review-placement` | G149 (done), H92 (todo) | 2026-09-23 | production | none | none | open item H92 (todo) |
| KEEP | `g176-account-plans` | G176 (done), G235 (done) | 2026-10-08 | production | frontend/scripts/g176-account-plans.test.mjs, frontend/scripts/g235-plan-overlap.test.mjs | none | imported outside app/design (frontend/scripts/g176-account-plans.test.mjs, frontend/scripts/g235-plan-overlap.test.mjs) |
| KEEP | `g176-account-status` | G176 (done) | 2026-09-30 | production | frontend/scripts/g176-account-status.test.mjs | none | imported outside app/design (frontend/scripts/g176-account-status.test.mjs) |
| KEEP | `g176-upcoming-rows` | G176 (done) | 2026-09-30 | production | frontend/scripts/g176-accounts.test.mjs, frontend/scripts/g176-preview.test.mjs | none | imported outside app/design (frontend/scripts/g176-accounts.test.mjs, frontend/scripts/g176-preview.test.mjs) |
| KEEP | `g88-home-canvas` | G88 (cancelled:feature-G88-real-data), G221 (done) | 2026-09-16 | production | none | none | open item G88 (cancelled:feature-G88-real-data) |
| KEEP | `g88-home-real` | G88 (cancelled:feature-G88-real-data), G221 (done) | 2026-09-23 | production | none | none | open item G88 (cancelled:feature-G88-real-data) |
| KEEP | `g91-cards-canvas` | G91 (uat) | 2026-09-16 | hand-authored | none | none | open item G91 (uat) |
| KEEP | `g93-penny-canvas` | G93 (uat) | 2026-09-16 | production | none | none | open item G93 (uat) |
| KEEP | `g94-settings-canvas` | G94 (rejected:feature-G94-fold-in-approved-variant-c) | 2026-09-16 | hand-authored | none | none | open item G94 (rejected:feature-G94-fold-in-approved-variant-c) |
| KEEP | `g96-receipts-canvas` | G96 (uat), G98 (uat) | 2026-09-15 | hand-authored | none | none | open item G96 (uat), G98 (uat) |
| KEEP | `g98-month-canvas` | G98 (uat) | 2026-09-16 | hand-authored | none | none | open item G98 (uat) |
| KEEP | `home-brief-cards` | G48 (done), H42 (done), H43 (todo), H44 (todo) | 2026-09-22 | production | none | none | open item H44 (todo); also mentioned by housekeeping H43 |
| KEEP | `home-cleanup` | G221 (done) | 2026-10-06 | production | frontend/scripts/g221-home-cleanup.test.mjs | none | imported outside app/design (frontend/scripts/g221-home-cleanup.test.mjs) |
| KEEP | `invite-only` | A137 (todo), D5 (done), D9 (blocked) | 2026-09-08 | production | none | none | open item A137 (todo), D9 (blocked) |
| KEEP | `marketing-kit` | C22 (uat) | 2026-10-08 | production | frontend/remotion/marketing-kit/MarketingFilm.tsx | none | marketing item C22 (uat) |
| KEEP | `mcp-activity-canvas-before-cards` | none | 2026-09-16 | hand-authored | frontend/app/mcp-activity/McpActivityPage.tsx | none | imported outside app/design (frontend/app/mcp-activity/McpActivityPage.tsx) |
| KEEP | `mirror-canvas-before-cards` | G97 (uat), G98 (uat) | 2026-09-16 | hand-authored | none | none | open item G97 (uat), G98 (uat) |
| KEEP | `money-shape-canvas-before-cards` | G95 (uat) | 2026-09-15 | hand-authored | none | none | open item G95 (uat) |
| KEEP | `offline-account` | G233 (uat) | 2026-10-07 | production | frontend/scripts/g233-offline-account.test.mjs | none | open item G233 (uat) |
| KEEP | `ops-board-mobile` | A97 (todo), G126 (todo), G213 (done), H56 (done), H65 (todo) | 2026-09-18 | production | frontend/app/ops/go-live/BoardView.tsx (mentions: frontend/app/ops/go-live/MobileRibbonBoard.tsx) | none | open item A97 (todo), H65 (todo); also mentioned by housekeeping G126 |
| KEEP | `payday-plan-standing-orders` | G173 (uat) | 2026-09-27 | production | none | none | open item G173 (uat) |
| KEEP | `penny-fullscreen` | G240 (uat) | 2026-10-08 | production | none | none | open item G240 (uat) |
| KEEP | `penny-usage-ring` | G3 (done) | 2026-09-08 | production | frontend/components/MoreMessagesSheet.tsx (mentions: frontend/components/PennySheet.tsx) | none | imported outside app/design (frontend/components/MoreMessagesSheet.tsx) |
| KEEP | `plan-deferral` | G228 (done) | 2026-10-07 | production | frontend/scripts/g228-plan-deferral.test.mjs | none | imported outside app/design (frontend/scripts/g228-plan-deferral.test.mjs) |
| KEEP | `planning-create` | none | 2026-09-02 | production | frontend/components/SetAsideSheet.tsx | none | imported outside app/design (frontend/components/SetAsideSheet.tsx) |
| KEEP | `planning-ladder-timeline` | G187 (done) | 2026-10-01 | production | frontend/scripts/g187-timeline.test.mjs | none | imported outside app/design (frontend/scripts/g187-timeline.test.mjs) |
| KEEP | `reel-safe-to-spend` | C22 (uat), G223 (uat) | 2026-10-06 | hand-authored | none | none | marketing item C22 (uat), G223 (uat) |
| KEEP | `safe-to-spend-figure` | G214 (in-progress), G218 (done), G231 (done), G234 (done) | 2026-10-08 | production | frontend/scripts/g218-figure-tone.test.mjs, frontend/scripts/g219-accounts-route.test.mjs, frontend/scripts/g221-home-cleanup.test.mjs, frontend/scripts/g231-exclude-account.test.mjs | none | open item G214 (in-progress) |
| KEEP | `settings-overhaul` | G201 (uat) | 2026-10-03 | production | none | none | open item G201 (uat) |
| KEEP | `sheet-anatomy` | G192 (done), G205 (in-progress) | 2026-10-04 | production | none (mentions: frontend/scripts/g192-sheet-anatomy.test.mjs) | none | open item G205 (in-progress) |
| KEEP | `sheet-swipe` | G205 (in-progress) | 2026-10-04 | production | none | none | open item G205 (in-progress) |
| KEEP | `spend-hero` | G186 (done) | 2026-10-01 | production | frontend/scripts/g186-hero-scale.test.mjs, frontend/scripts/g186-spend-hero.test.mjs | none | imported outside app/design (frontend/scripts/g186-hero-scale.test.mjs, frontend/scripts/g186-spend-hero.test.mjs) |
| KEEP | `spend-hero-scale` | G186 (done) | 2026-10-01 | production | frontend/scripts/g186-hero-scale.test.mjs | none | imported outside app/design (frontend/scripts/g186-hero-scale.test.mjs) |
| KEEP | `spend-live` | A29 (todo), G57 (done), G73 (done), G75 (done), G126 (todo) | 2026-10-05 | production | none (mentions: frontend/components/SpendHeader.tsx, frontend/components/SpendVerdictView.tsx, frontend/components/TeachingSheet.tsx) | none | open item A29 (todo); also mentioned by housekeeping G126 |
| KEEP | `spend-pace-copy` | G140 (done) | 2026-10-01 | production | frontend/scripts/g140-pace-copy.test.mjs | none | imported outside app/design (frontend/scripts/g140-pace-copy.test.mjs) |
| KEEP | `spend-tips` | none | 2026-09-05 | production | frontend/components/TipsLine.tsx, frontend/lib/spendTips.ts (mentions: frontend/components/InsightCard.tsx) | none | imported outside app/design (frontend/components/TipsLine.tsx, frontend/lib/spendTips.ts) |
| KEEP | `spend-verdict-a` | A29 (todo) | 2026-09-02 | production | none | none | open item A29 (todo) |
| KEEP | `sts-accounts-route` | G219 (done) | 2026-10-06 | production | frontend/scripts/g219-accounts-route.test.mjs, frontend/scripts/g221-home-cleanup.test.mjs | none | imported outside app/design (frontend/scripts/g219-accounts-route.test.mjs, frontend/scripts/g221-home-cleanup.test.mjs) |
| KEEP | `sync-loading` | G214 (in-progress) | 2026-10-06 | production | none (mentions: frontend/components/SyncNote.tsx) | none | open item G214 (in-progress) |
| KEEP | `transactions-canvas-before-cards` | G118 (todo) | 2026-09-16 | hand-authored | none | none | open item G118 (todo) |
| KEEP | `upcoming-by-account` | G229 (done) | 2026-10-07 | production | frontend/scripts/g229-by-account.test.mjs | none | imported outside app/design (frontend/scripts/g229-by-account.test.mjs) |
| KEEP | `upcoming-canvas-before-cards` | G90 (uat), G127 (done) | 2026-09-16 | hand-authored | none (mentions: frontend/app/planning/PlanningPage.tsx) | none | open item G90 (uat) |
| GATE-CANDIDATE | `cards-page` | G15 (done), H43 (todo) | 2026-09-09 | production | none | none | renders production components; items done or cancelled; also mentioned by housekeeping H43 |
| GATE-CANDIDATE | `category-kind` | G20 (done), G39 (done), G83 (done), G126 (todo), H35 (done) | 2026-08-15 | production | none (mentions: frontend/components/CategoryKindChooser.tsx) | none | renders production components; items done or cancelled; also mentioned by housekeeping G126 |
| GATE-CANDIDATE | `cover-plan-sources` | G46 (done) | 2026-09-12 | production | none | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `date-picker` | G136 (done) | 2026-10-05 | production | none | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `error-states` | G215 (done) | 2026-10-05 | production | none (mentions: frontend/components/ErrorState.tsx) | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `g115-spend-from-accounts` | G184 (done) | 2026-09-29 | production | none | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `g119-filter-pill` | G119 (done), G213 (done) | 2026-09-18 | production | none (mentions: frontend/components/TransactionFilterChips.tsx) | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `g128-payday-reconcile` | G128 (done), G129 (done) | 2026-09-28 | production | none | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `goal-link-sheet` | G204 (done) | 2026-10-04 | production | none | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `home-tip-gesture` | G207 (done) | 2026-10-04 | production | none (mentions: frontend/components/HomeInsightSpotlight.tsx) | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `move-card-grammar` | G69 (done), G70 (done) | 2026-09-14 | production | none | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `oauth-consent` | F2 (done) | 2026-09-08 | production | none (mentions: frontend/app/oauth/consent/OAuthConsentCard.tsx, frontend/lib/oauthScopes.ts) | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `payday-plan-grammar` | G69 (done) | 2026-09-13 | production | none | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `penny-keyboard` | G191 (done), G197 (done) | 2026-10-02 | production | none (mentions: frontend/scripts/g191-keyboard.test.mjs) | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `plan-source-account` | G230 (done) | 2026-10-07 | production | none | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `planning-ladder` | G126 (todo), G187 (done) | 2026-09-10 | production | none (mentions: frontend/app/planning/GrowPanel.tsx) | none | renders production components; items done or cancelled; also mentioned by housekeeping G126 |
| GATE-CANDIDATE | `signin-loading` | G202 (done) | 2026-10-04 | production | none (mentions: frontend/components/LoginScreen.tsx, frontend/scripts/mobile-login-loop.test.mjs) | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `spend-containment` | G78 (done), G85 (done), G87 (done) | 2026-09-15 | production | none | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `spend-page-refurbishment` | G57 (done), G67 (done), G73 (done), H43 (todo) | 2026-09-18 | production | none | none | renders production components; items done or cancelled; also mentioned by housekeeping H43 |
| GATE-CANDIDATE | `spend-penny-flow` | G3 (done), G126 (todo) | 2026-09-05 | production | none | none | renders production components; items done or cancelled; also mentioned by housekeeping G126 |
| GATE-CANDIDATE | `spend-period-round` | G53 (done), G73 (done), H34 (done) | 2026-09-18 | production | none | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `tax-canvas-before-cards` | G86 (done) | 2026-09-16 | production | none | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `upcoming-account-edit` | G216 (done) | 2026-10-05 | production | none | none | renders production components; items done or cancelled |
| GATE-CANDIDATE | `your-plan` | B19 (done), B30 (done), G74 (done) | 2026-09-14 | production | none (mentions: frontend/components/PlanPicker.tsx, frontend/components/YourPlanCard.tsx) | none | renders production components; items done or cancelled |
| DELETE-CANDIDATE | `accounts-preview` | G126 (todo) | 2026-08-16 | hand-authored | none | none | no referencing item; hand-authored; 53 days old; also mentioned by housekeeping G126 |
| DELETE-CANDIDATE | `app-icon` | G126 (todo) | 2026-09-02 | hand-authored | none | none | no referencing item; hand-authored; 36 days old; also mentioned by housekeeping G126 |
| DELETE-CANDIDATE | `coming-up` | G17 (done), G35 (done), H43 (todo) | 2026-08-21 | hand-authored | none (mentions: frontend/components/UpcomingBillsStrip.tsx, frontend/lib/comingUp.tsx) | none | items done or cancelled; hand-authored; 48 days old; also mentioned by housekeeping H43 |
| DELETE-CANDIDATE | `g100-scenario-canvas` | none | 2026-09-16 | hand-authored | none | none | no referencing item; hand-authored; 22 days old |
| DELETE-CANDIDATE | `g16-safe-to-spend` | G16 (done), H43 (todo) | 2026-09-23 | hand-authored | none | none | items done or cancelled; hand-authored; 15 days old; also mentioned by housekeeping H43 |
| DELETE-CANDIDATE | `penny-glyph` | G126 (todo) | 2026-08-18 | hand-authored | none (mentions: frontend/components/PennyMark.tsx, frontend/components/SettleMark.tsx) | none | no referencing item; hand-authored; 51 days old; also mentioned by housekeeping G126 |
| DELETE-CANDIDATE | `planning` | none | 2026-09-02 | hand-authored | none | none | no referencing item; hand-authored; 36 days old |
| DELETE-CANDIDATE | `planning-plans` | G3 (done) | 2026-09-05 | hand-authored | none | none | items done or cancelled; hand-authored; 33 days old |
| DELETE-CANDIDATE | `scenario-a` | none | 2026-08-22 | hand-authored | none (mentions: frontend/app/scenario/ScenarioPage.tsx) | none | no referencing item; hand-authored; 47 days old |
| DELETE-CANDIDATE | `scenario-b` | none | 2026-08-22 | hand-authored | none | none | no referencing item; hand-authored; 47 days old |
| DELETE-CANDIDATE | `scenario-c` | none | 2026-08-22 | hand-authored | none | none | no referencing item; hand-authored; 47 days old |
| DELETE-CANDIDATE | `spend-a` | G126 (todo) | 2026-08-13 | hand-authored | none | none | no referencing item; hand-authored; 56 days old; also mentioned by housekeeping G126 |
| DELETE-CANDIDATE | `spend-b` | G126 (todo) | 2026-08-13 | hand-authored | none (mentions: frontend/components/TeachingSheet.tsx) | none | no referencing item; hand-authored; 56 days old; also mentioned by housekeeping G126 |
| DELETE-CANDIDATE | `spend-header-rules` | G75 (done) | 2026-09-14 | hand-authored | none | none | items done or cancelled; hand-authored; 24 days old |
| DELETE-CANDIDATE | `type` | none | 2026-08-21 | hand-authored | none | none | no referencing item; hand-authored; 48 days old |
| DELETE-CANDIDATE | `upcoming-hero-setaside` | none | 2026-09-25 | hand-authored | none | none | no referencing item; hand-authored; 13 days old |
| DELETE-CANDIDATE | `upcoming-plan` | G3 (done) | 2026-09-05 | hand-authored | none | none | items done or cancelled; hand-authored; 33 days old |
| UNSURE | `accounts-rows` | G126 (todo), H43 (todo) | 2026-08-24 | production | none (mentions: frontend/components/AccountLedgerRow.tsx, frontend/lib/accountsEstate.ts) | none | renders production components but no referencing item; also mentioned by housekeeping G126, H43 |
| UNSURE | `accounts-tiles` | H43 (todo) | 2026-08-24 | production | none | none | renders production components but no referencing item; also mentioned by housekeeping H43 |
| UNSURE | `app-only` | none | 2026-09-06 | production | none (mentions: frontend/components/AppOnlyPage.tsx) | none | renders production components but no referencing item |
| UNSURE | `cards-check` | G126 (todo), H43 (todo) | 2026-08-15 | production | none | none | renders production components but no referencing item; also mentioned by housekeeping G126, H43 |
| UNSURE | `connected-assistants` | none | 2026-09-10 | production | none (mentions: frontend/components/ConnectedAssistantsCard.tsx, frontend/lib/oauthScopes.ts) | none | renders production components but no referencing item |
| UNSURE | `dismiss-x` | G126 (todo) | 2026-09-02 | production | none (mentions: frontend/components/HomeBrief.tsx, frontend/components/HomeInsightSpotlight.tsx, frontend/components/PaydayPlanCard.tsx) | none | renders production components but no referencing item; also mentioned by housekeeping G126 |
| UNSURE | `g111-spend-from-bank` | none | 2026-09-16 | production | none | none | renders production components but no referencing item |
| UNSURE | `g29-reconnect-rows` | H43 (todo) | 2026-09-14 | production | none (mentions: frontend/components/ReconnectStrip.tsx) | none | renders production components but no referencing item; also mentioned by housekeeping H43 |
| UNSURE | `g31-planning-hero` | H43 (todo) | 2026-09-13 | production | none | none | renders production components but no referencing item; also mentioned by housekeeping H43 |
| UNSURE | `g89-planning-canvas` | none | 2026-09-16 | production | none | none | renders production components but no referencing item |
| UNSURE | `g99-month-story-canvas` | none | 2026-09-15 | production | none | none | renders production components but no referencing item |
| UNSURE | `home-brief-width` | G126 (todo) | 2026-09-13 | production | none | none | renders production components but no referencing item; also mentioned by housekeeping G126 |
| UNSURE | `insights-live` | G126 (todo) | 2026-09-05 | production | none (mentions: frontend/app/spend/shape/MoneyShapeHero.tsx, frontend/components/InsightCard.tsx, frontend/lib/pennyScreenConfig.tsx) | none | renders production components but no referencing item; also mentioned by housekeeping G126 |
| UNSURE | `miscategorised` | none | 2026-08-24 | production | none (mentions: frontend/components/MiscategorisedReviewSheet.tsx) | none | renders production components but no referencing item |
| UNSURE | `month-closed-card` | none | 2026-09-26 | production | none | none | renders production components but no referencing item |
| UNSURE | `month-story` | none | 2026-09-02 | production | none (mentions: frontend/app/month/story/StoryPlayer.tsx) | none | renders production components but no referencing item |
| UNSURE | `payday-plan-executed` | none | 2026-09-26 | production | none | none | renders production components but no referencing item |
| UNSURE | `penny-chat` | none | 2026-08-18 | production | none (mentions: frontend/components/PennyConversation.tsx) | none | renders production components but no referencing item |
| UNSURE | `penny-sheet` | none | 2026-08-25 | production | none (mentions: frontend/components/PennyConversation.tsx, frontend/components/PennySheet.tsx) | none | renders production components but no referencing item |
| UNSURE | `penny-thread` | none | 2026-08-25 | production | none (mentions: frontend/components/ChatMarkdown.tsx) | none | renders production components but no referencing item |
| UNSURE | `safe-to-spend-hero` | H43 (todo) | 2026-09-23 | production | none | none | renders production components but no referencing item; also mentioned by housekeeping H43 |
| UNSURE | `settings-usage-row` | none | 2026-09-10 | production | none (mentions: frontend/components/PennyUsageRow.tsx) | none | renders production components but no referencing item |
| UNSURE | `signin-handoff` | A108 (done), G199 (done), H107 (done), H113 (in-progress) | 2026-10-04 | hand-authored | none (mentions: frontend/scripts/check-signin-handoff.mjs) | none | hand-authored, only 4 days old, items done; also mentioned by housekeeping H113 |
| UNSURE | `spend-charts` | none | 2026-09-02 | production | none (mentions: frontend/components/SpendTrends.tsx) | none | renders production components but no referencing item |
| UNSURE | `spend-shape` | none | 2026-09-05 | production | none (mentions: frontend/app/spend/shape/ShapePage.tsx, frontend/components/SpendShapeCard.tsx) | none | renders production components but no referencing item |
| UNSURE | `spend-verdict-b` | none | 2026-09-02 | production | none | none | renders production components but no referencing item |
| UNSURE | `spend-verdict-c` | none | 2026-09-02 | production | none | none | renders production components but no referencing item |
| UNSURE | `v1` | none | 2026-09-21 | production | none | none | renders production components but no referencing item |
| UNSURE | `v2` | none | 2026-09-21 | production | none | none | renders production components but no referencing item |
| UNSURE | `v3` | none | 2026-09-21 | production | none | none | renders production components but no referencing item |
