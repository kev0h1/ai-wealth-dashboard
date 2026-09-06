# Sorted backlog (written 2026-09-06)

Working rules for any session picking an item: branch `docs/mobile-porting-checkpoint`; UAT is this VPS (`systemctl restart wealth-api` / `wealth-worker` / `wealth-frontend` after `npm run build`); production is Vercel + Railway and is NOT touched by restarts here. Never commit `backend/.env` or any key file. Fable plans, Sonnet agents edit and commit, commit trailers `Co-Authored-By: Claude <model> <noreply@anthropic.com>`. No em dashes in user-facing copy. Design changes go through Kevin as coded variants on `/design/*` before touching production components. Tick items here as they land; add the commit hash.

Context documents: `docs/compliance/finexer-agent-controls-2026-09.md` (due diligence answers, `[KEVIN]` markers), `docs/pricing/tiering-unit-economics-mcp-2026-09.md` (tier table, unit economics, scaling, MCP design), `PENNY_TOOLS.md`, `SECURITY.md`, `PRIVACY.md`, `TERMS.md`, `DEPLOY.md`.

Board: the private page /ops/go-live on UAT reads and edits these files. Sessions use `scripts/backlog.py` (`start`, `block`, `done <id> --commit <sha>`, `note`) so the file, the page and git history stay one thing. Never tick by hand.

## A. Finexer go-live blockers (target 2026-10-01)

- [ ] **A1. Production deploy of this branch.** [owner: claude] [priority: p1] [unblocks: Q5, Q6, Q7, Q10, Q11] (needs Kevin's approval to start) Prod is 160+ commits behind: `/terms` and `/privacy` 404, `/api/docs` open, no Finexer webhook receiver, old bundle id defaults, no linked identities, no tiers or metering. Steps: merge to `main` (Vercel auto-deploys the frontend), `railway up --service ai-wealth-dashboard --ci` and `railway up --service worker --ci` (needs acceptEdits mode), then set new Railway env vars (`FINEXER_WEBHOOK_SIGNING_SECRET`, `APNS_BUNDLE_ID=co.uk.auriqltd.sorted`, `APPLE_BUNDLE_ID` if set, `DEFAULT_TIER=max`, leave `OPEN_SIGNUP` unset). Verify each changed endpoint on prod with a minted token, not just `/health`. Owner: Kevin approves, agent executes. Blocks A2, A3, A4, Q5/Q6/Q7/Q10/Q11 answers.
- [ ] **A2. Close the two open security items.** [owner: claude] [priority: p1] [state: in-progress] [unblocks: Q11] (a) `frontend/components/LoginOverlay.tsx` and `frontend/app/login/page.tsx`: dead legacy PIN login with a hardcoded PIN in source; delete both and any route/link to them. (b) `reconnect_expected` in localStorage holds a real account number and sort code; store only the connection id or a masked form. Then run a dependency audit (`npm audit` in frontend, `pip-audit` or `safety` in backend/.venv) and record the date and result in `SECURITY.md`. Needed for Q11.
- [ ] **A3. Retention sweeps.** [owner: claude] [priority: p1] [state: in-progress] [unblocks: Q10] `SECURITY.md` section 6 and `PRIVACY.md` section 8 promise two automated sweeps that do not exist: dormant accounts deleted after 12 months of inactivity, and a connection's data deleted 30 days after consent withdrawal or expiry if the user never pressed Disconnect. Build one nightly arq cron in `backend/app/workers/sync_worker.py` that reuses the existing account-deletion routine (`routers/profile.py` DELETE /account) and the existing disconnect routine. Tests with fake collections. Needed for Q10; remove the "to be implemented" note from SECURITY.md.
- [ ] **A4. In-app agent disclosure line.** [owner: claude] [priority: p1] [state: in-progress] [unblocks: Q6] Q6 asks where customers are told AURIQ LTD acts as Finexer's agent. Add one line at the bank-connect step and the sign-in footer: "Account information is provided by Finexer LTD, authorised by the FCA. AURIQ LTD acts as Finexer's agent." Wording depends on A9 (FRN). Design: quiet caption, not a card.
  - note (2026-09-06, claude): Finexer's hosted consent page already carries the footer 'Auriq acts as Finexer Ltd's registered agent. Finexer Ltd is authorised by the FCA ... firm reference number 925695' (verified in sandbox 2026-09-06). The in-app line for the step before it is still needed.
- [ ] **A5. FRN wording on the legal pages.** [owner: kevin] [priority: p1] [unblocks: Q6, Q7] Until the FCA register shows AURIQ LTD, `frontend/content/terms.md` section 2 and `privacy.md` section 1 say "registered agent" in the present tense. Interim text is drafted in the compliance doc under Q6. Kevin confirms with Finexer which wording to publish; keep `TERMS.md`/`PRIVACY.md` at the root byte-identical with `frontend/content/*`. `PRIVACY.pdf` and `TERMS.pdf` at the root are stale and cannot be regenerated on this VPS.
- [ ] **A6. Screenshots and recording for Q5 and Q6** [owner: kevin] [priority: p1] [unblocks: Q5, Q6] on production after A1: sign-in, connect bank, Finexer consent, bank auth, return, accounts and transactions, disconnect, delete account, plus the terms and privacy disclosure sections. Kevin captures.
- [ ] **A7. Penetration test.** [owner: kevin] [priority: p1] [unblocks: Q11] Now: run OWASP ZAP baseline against UAT and fix findings. Before public launch: CREST manual test of web app, API and both mobile shells (UK market 2026: about £3,750 to £8,000, 5 to 7 days; Precursor Security publishes from £3,750). Kevin books; record the scheduled date in Q11.
- [ ] **A8. Kevin-only inputs for the questionnaire:** [owner: kevin] [priority: p1] [unblocks: Q2, Q12, Q13] insurance details (Q12), last backup restore test date or run one (Q13), Penny agent mode timing (recommend: not before approval, Q2 says not live), confirm nothing else changed in the onboarding data-sharing list (Q9).
- [ ] **A9. Play Console record.** [owner: kevin] [priority: p1] [unblocks: Q4] Organisation account for AURIQ LTD (D-U-N-S), create app "Sorted", package `co.uk.auriqltd.sorted` fixed by first upload, Finance category, financial-features declaration (personal finance management), privacy URL `https://wealth.auriqltd.co.uk/privacy`. Needs an Android release signing config and AAB build (see C2). Gives the Q4 Play URL.
- [ ] **A10. Web shell for production: a build flag (NEXT_PUBLIC_WEB_PRODUCT=off) that renders a 'Sorted is an app' page with store badges on every product route while /terms, /privacy, the Finexer and Google return pages and the landing page keep working; owner sign-in may stay allowed.** [owner: claude] [priority: p1] [unblocks: Q4]
- [ ] **A11. Create the API custom domain api.wealth.auriqltd.co.uk on the Railway web service and the DNS record, so the apps call Railway directly instead of the Vercel /api rewrite.** [owner: kevin] [priority: p1] [unblocks: Q4]
- [ ] **A12. Point mobile builds at the API domain: build:mobile:prod base and the Codemagic prod variable become https://api.wealth.auriqltd.co.uk, add the domain to CORS, keep the Finexer return URL on the web domain.** [owner: claude] [priority: p1] [unblocks: Q4]
- [x] **A13. Switch Vercel's Production Branch from main to release before the first merge into main; then confirm so the docs branch can be merged.** [owner: kevin] [priority: p1] [unblocks: Q7] (done 2026-09-06)
  - note (2026-09-06, claude): Vercel production branch is release; docs branch fast-forwarded into main at cb9e1c1 on 2026-09-06
- [ ] **A14. Own bank picker for Finexer: reuse BankPickerSheet in Finexer mode so the user picks the bank in our design and lands straight on Finexer's consent screen with the provider preselected; Finexer accounts reconnect through the Finexer link too.** [owner: claude] [priority: p1] [state: in-progress] [unblocks: Q5]

## B. Penny cost, tiers and billing

- [ ] **B1. Shorten the grow cache.** [owner: claude] [priority: p2] `GET /grow` caches up to 6 h, `GET /safe-to-spend` 90 s, so Planning and Home can show different figures for the same gap (£1,053.91 vs £749 seen 2026-09-06). Align the grow cache TTL to the safe-to-spend one or invalidate it on sync.
- [ ] **B2. Bill display names in the due-list chip.** [owner: claude] [priority: p2] `services/penny_chips.py` `home_payday_due` prints "a card or account payment" for card repayments and own-transfers. Use the destination card or account display name ("American Express card payment"). Squarespace lines clean to "Worksp"; consider a merchant alias.
- [ ] **B3. Tax chips still on the model.** [owner: claude] [priority: p2] `tax_pension_carry_forward`, `tax_salary_sacrifice`, `tax_gift_aid` return `kind: "llm"` and count as messages. Add registry entries (verified, general explanation) plus the user's own figure where the tax engine exposes one. Registry doctrine in `PENNY_TOOLS.md`.
- [ ] **B4. Settings usage row.** [owner: claude] [priority: p2] Show "Penny messages used 37 of 150, resets 1 Oct" in Settings under Sign-in methods, from `GET /subscription`.
- [ ] **B5. Billing.** [owner: claude] [priority: p2] Stripe subscriptions on the web first (`prices_gbp` in `core/subscription.py`), then App Store and Play subscription products, then the £2.99 top-up as a consumable in-app purchase writing `penny_topups`. Wire the "Available soon" rows in `components/MoreMessagesSheet.tsx`. Vercel is already on Pro (verified 2026-09-06).
- [ ] **B6. Statements-only free tier path.** [owner: claude] [priority: p2] Tier `statements` has `open_banking: False` and `statement_uploads_per_month: 3`; nothing enforces either yet. Gate bank connect and count uploads (PDF parser in `services/pdf.py`, pipeline `pdf_statement` in `llm_usage`).
- [ ] **B7. Lite refresh cadence.** [owner: claude] [priority: p2] Tier `lite` says `refresh: "daily"`; the 4-hourly reconcile cron syncs everyone. Make the cron respect the tier's cadence.
- [ ] **B8. OpenRouter organisation account.** [owner: kevin] Move from Kevin's personal account to an AURIQ LTD organisation with per-environment keys and spend limits; keep `data_collection: deny`; file their data processing terms for the sub-processor record. Kevin creates the account; agent rotates keys in env (never in git).
- [ ] **B9. Cost dashboard.** [owner: claude] [priority: p2] Bot-only `GET /admin/llm-usage?month=` aggregating `llm_usage` by pipeline and by user, so real AI cost per user replaces the estimates in the pricing doc.

## C. Store publishing

- [ ] **C1. iOS rebuild** [owner: kevin] [priority: p2] via Codemagic `ios-capacitor` to pick up the ring, chips, cap and Apple linking. Then Kevin links Apple from Settings once (Sign-in methods, Link Apple ID) so Hide My Email signs into his account.
- [ ] **C2. Android release signing and AAB.** [owner: claude] [priority: p2] `capacitor-spike/android/app/build.gradle` has no release signingConfig and no upload keystore; Play needs an AAB. Generate an upload keystore (kept out of git, path documented in DEPLOY.md), add the release config, `./gradlew bundleRelease`. Rebuild the debug APK to UAT too (`/var/www/wealth-downloads/wealth.apk`).
- [ ] **C3. Build tag.** [owner: claude] [priority: p2] `frontend/lib/buildTag.ts` is a hand-edited constant ("build 2026-08-18c"). Derive it from the git short SHA or CI build number at build time.
- [ ] **C4. iPhone-only target.** [owner: claude] [priority: p2] Capacitor targets iPad by default, which means iPad screenshots at review. Set `TARGETED_DEVICE_FAMILY` to iPhone in the Codemagic plist/pbxproj step.
- [ ] **C5. Store listings.** [owner: claude] [priority: p2] App Store: screenshots for 6.9 and 6.5 inch, description, keywords, support URL, App Privacy labels, age rating, review notes with a demo account (needs D2). Play: Data safety form, feature graphic 1024x500 (does not exist), screenshots. Icon master: `capacitor-spike/assets/icon.png`.
- [ ] **C6. Housekeeping in the portals.** [owner: kevin] Remove the "Sorted by Auriq - Demised" App Store Connect record, delete provisioning profile "Sorted AppStore A", consider revoking the manually created iOS Distribution certificate (only Codemagic's API-key certificate should remain), remove the old `co.uk.auriqltd.wealth` App ID and Firebase Android app.
- [ ] **C7. Apple relay email.** [owner: claude] Not needed until the backend sends email; if outbound email is ever added, register the sending domain in Sign in with Apple for Email Communication.
- [ ] **C8. Codemagic: add a production workflow variant (build:mobile:prod) alongside the UAT one so a TestFlight build against the production backend can be produced for Q5 evidence and for release.** [owner: claude] [priority: p1] [unblocks: Q5]

## D. Identity and sign-up

- [ ] **D1. Enable open sign-up on UAT** [owner: kevin] [priority: p2] by adding `OPEN_SIGNUP=true` to `backend/.env` on the VPS and restarting `wealth-api`, then test: new Google account, new Apple account with Hide My Email, dot-variant Gmail lands in the same account, explicit link claims an automatic link. Keep prod off until launch.
- [ ] **D2. Reviewer path.** [owner: kevin] [priority: p1] Store review needs a working sign-in without the allow list: either `OPEN_SIGNUP=true` on prod at review time, or a demo account added to `ALLOWED_EMAILS`. Decide and document in the review notes.
- [ ] **D3. Orphaned relay accounts.** [owner: claude] [priority: p2] When an explicit link claims an automatic relay link, the empty account keyed by the relay email stays behind. Add a sweep or delete it at link time when it has no connections (reuse the account-deletion routine; never delete an account with data).
- [ ] **D4. Rate limiting and mobile login state for replicas.** [owner: claude] [priority: p2] `routers/auth.py` `_pending` dict and the in-memory rate limiter assume one process. Move both to Redis before running more than one Railway replica.

## E. Platform and scaling (from the pricing doc, section 6)

- [ ] **E1. Atlas M0 to M10** [owner: kevin] [priority: p2] before real users; M20 or M30 by 10,000. Kevin actions in Atlas; agent updates connection string in env.
- [ ] **E2. Railway Pro and replicas** [owner: claude] [priority: p2] once D4 is done; spread the 4-hourly reconcile across the window and check Finexer rate limits (10,000 connections is about 42 syncs a minute).
- [x] **E3. Vercel Pro** [owner: kevin] already in place (verified 2026-09-06), nothing to do. (done 2026-09-06)
- [ ] **E4. Backup restore test** [owner: kevin] [priority: p2] documented with a date (Q13).

## F. MCP connector (start after Finexer production approval)

- [ ] **F1. Design sign-off** [owner: kevin] with Finexer in writing: read-only, user-directed disclosure, masked identifiers, revocation and audit log. Full design in the pricing doc section 7.
- [ ] **F2. OAuth 2.1 authorisation server** [owner: claude] with PKCE and dynamic client registration on the backend; consent page reusing Google or Apple sign-in; token storage with refresh and revocation.
- [ ] **F3. `/mcp` Streamable HTTP endpoint** [owner: claude] exposing `TOOL_SCHEMAS` read tools through `execute_tool`; output masking of account numbers, sort codes, IBANs, consent ids; scopes `accounts:read`, `transactions:read`, `plans:read`, `insights:read`; per-user rate limit and the tier's monthly call allowance (Connect 2,000, Max 5,000); audit log.
- [ ] **F4. Settings "Connected assistants"** [owner: claude] list with client name, last used, revoke.
- [ ] **F5. Policy updates:** [owner: claude] Privacy Policy section "AI assistants you connect", Terms clause, Finexer Q2 and Q9 disclosure.

## G. Design and copy follow-ups

- [ ] **G1. DESIGN.md drift.** [owner: claude] Still describes the retired Out-vs-In gap line, the old four-tab nav, and the old three-tile Safe-to-Spend card. Update to the current surface map in `CLAUDE.md`.
- [ ] **G2. Dead code in `app/planning/PlanningPage.tsx`** [owner: claude] (`PlansDock`, `CommitmentCards`, `computeDebtRow`, `computeGrowRow`) and the duplicated fetch path in `lib/useAllTransactions.ts`.
- [ ] **G3. Design index.** [owner: claude] `app/design/page.tsx` now lists `penny-usage-ring`, `planning-plans`, `spend-penny-flow`, `upcoming-plan`; keep it current for every new preview.
- [ ] **G4. `chat.py` tax explainer prompt** [owner: claude] [priority: p1] [unblocks: Q8] has no product constraints (EIS/SEIS content invites investment-product suggestions) and no temperature; tighten before go-live (Q8 promises it).
- [ ] **G5. Penny agent mode** [owner: claude] (propose-only writes, consent-gated) stays off until Finexer approval; when it ships it is a disclosed change with a privacy update.

## H. Repo hygiene

- [ ] **H1. Firebase config history.** [owner: kevin] `capacitor-spike/google-services.json` was tracked until 2026-09-05 and an old copy with the Android API key remains in git history. Decision: restrict the key to the Android package in Google Cloud console rather than rewrite history. Kevin.
- [ ] **H2. Retired Expo project `mobile/`.** [owner: claude] `sync-shared.sh` still writes into `mobile/lib/shared/`; either delete the directory or stop syncing to it.
  - note (2026-09-06, claude): session abandoned, branch item/H2-shared-sync discarded
- [ ] **H3. `docs/compliance` and `docs/pricing`** [owner: claude] are committed; keep `[KEVIN]` markers until answered, then remove them before the questionnaire is submitted.
  - note (2026-09-06, kevin): Board write-side smoke test
- [ ] **H4. Prune stale git worktrees on the VPS left by earlier sessions (git worktree prune, then remove directories whose branches are merged), without touching worktrees of live sessions.** [owner: claude] [priority: p2]
- [x] **H5. Branch naming: feature branches are named feature-<ID>[-slug]; update session.sh, integrate.py, backlog docs and CLAUDE.md** [owner: claude] (done 2026-09-06, 68f568279ec58d8dd7c3db1263fcd73ff624b215)
