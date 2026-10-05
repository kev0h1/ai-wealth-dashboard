# Undesigned UI inventory (G215, 2026-10-05)

Every place the app can show UI that is not in Sorted's design. Status: done = fixed on
feature-G215-undesigned-ui-audit, follow-up = listed, not edited here (file owned by another
in-flight builder, or out of scope with the reason given).

Already covered by A68 / G199: `shared/signin-handoff/template.html` (brand line "Sorted by Auriq",
verdict heading, one sentence, 48 px "Return to Sorted" action, hashed route CSP via
`signin_handoff_csp`), `bank_handoff_html(ok, ...)`, the Google mobile callback (`finish()`), and
`frontend/lib/callbackRelay.ts` (relays a 303 or the backend's 200 page, builds its own 502 error
page otherwise).

## A. Browser-native dialogs (`window.alert`; there are no `confirm`/`prompt` calls, and no `@capacitor/dialog`)

| file:line | trigger | user sees today | replacement | status |
|---|---|---|---|---|
| app/components/HomePage.tsx:928 | reconnect start fails | native alert, API message or "Failed to start reconnection" | `noticeSheet` | done |
| app/components/AccountsPage.tsx:1030 | reconnect start fails | native alert | `noticeSheet` | done |
| app/components/AccountsPage.tsx:1046, 1104 | remove account fails | native alert | `noticeSheet` | done |
| app/components/AccountsPage.tsx:1183 | delete entry fails | native alert | `noticeSheet` | done |
| app/components/AccountsPage.tsx:1264, 1277 | update or delete rule fails | native alert | `noticeSheet` | done |
| app/components/AccountsPage.tsx:1318 | investment refresh fails | native alert | `noticeSheet` | done |
| app/components/AccountsPage.tsx:1332 | remove investment account fails | native alert | `noticeSheet` | done |
| app/components/AccountsPage.tsx:1366 | delete note fails | native alert | `noticeSheet` | done |
| app/design/spend-live/SpendLiveClient.tsx:321 | tap in a design preview | native alert "Would open ..." | `noticeSheet` ("Preview only") | done |

The guard `check:no-native-dialogs` has an empty allowlist.

## B. Backend pages a browser reaches by top-level navigation

| file:line | trigger | user sees today | replacement | status |
|---|---|---|---|---|
| routers/finexer.py callback | no consent id | JSON `{"detail":"Missing consent id"}` 400 | hand-off error page, 400 | done |
| routers/finexer.py callback | unknown consent | JSON 404 "Consent not found" | hand-off error page, 404 | done |
| routers/finexer.py callback | state missing or mismatched (A88) | JSON 400 "State mismatch" | hand-off error page, 400 (check unchanged) | done |
| routers/truelayer.py callback | provider returned `?error=` with no `code` | FastAPI 422 JSON | optional `code`, hand-off error page, 400 | done |
| routers/truelayer.py callback | not configured | JSON 500 | hand-off error page, 503 | done |
| routers/truelayer.py callback | token exchange failed | `<h2>Token exchange failed</h2><pre>{upstream text}</pre>`, unstyled and reflecting upstream | hand-off error page, 502, no upstream text | done |
| routers/oauth.py `/auth/oauth/authorize` | unknown client, redirect mismatch | `text/plain` sentence | hand-off error page, 400 | done |
| routers/oauth.py `/oauth/request`, `/oauth/decision` | expired request | JSON 404 (read by the consent client, not navigated) | none needed; consent page maps it | no change |
| routers/auth.py `/auth/google/mobile` | Google not configured | JSON 500 | hand-off sign-in error page, 503 | done |
| routers/auth.py `/auth/google` | Google not configured | JSON 500 | redirect to `/?error=auth_failed` like its callback | done |
| routers/auth.py google callbacks | all other failures | redirect / hand-off page | already designed | no change |
| routers/yapily.py callback | any | always redirects | already designed | no change |
| `/auth/*/link`, `/providers`, `/yapily/*`, `/oauth/register` `/token` `/revoke` | called by fetch or by machine clients | JSON | protocol or API responses, never navigated | no change |

## C. Next.js framework surfaces

| file | today | replacement | status |
|---|---|---|---|
| app/not-found.tsx | missing, Next default black-and-white 404 | designed page | done |
| app/error.tsx | missing, Next default | designed page with retry | done |
| app/global-error.tsx | missing | self-contained designed page (inline tokens) | done |
| app/design/error-states | missing | preview rendering not-found, error and the notice sheet (global-error replaces the whole document, so it is checked as static HTML) | done |
| Suspense `fallback={null}` / blank canvas | blank canvas while loading | token canvas, acceptable | no change |
| ErrorBoundary / componentDidCatch | none exist in app, components or lib | n/a (covered by app/error.tsx) | no change |

## D. Error and status text that bypasses the tokens (red on non-financial errors)

DESIGN.md: an error is ink; Risk Red 12 px message only for field errors. Financial-risk red
(Safe-to-Spend, bills at risk, debt, GrowPanel shortfall, transaction debit) is untouched.

| file:line | what | change | status |
|---|---|---|---|
| components/InvestmentUpload.tsx:135-137 | red error box | slate panel, ink text | done |
| components/StatementUpload.tsx:161-163 | red error box | slate panel, ink text | done |
| app/oauth/consent/OAuthConsentCard.tsx:66-67 | red error box | slate panel, ink text | done |
| components/BankPickerSheet.tsx:168 | `text-red-500` text-xs | 12 px field-style message, red-600/400 | done |
| components/ConnectedAssistantsCard.tsx:443 | `text-red-500` 11 px | slate secondary | done |
| app/settings/SettingsPage.tsx:1200, 1560, 1661, 1722 | `text-red-500` failure messages | ink | done |
| app/ops/go-live/AllowlistSection.tsx:134,137 | red 12 px messages | field-error style, left | no change |
| components/LoginScreen.tsx:232-233 | red error box | slate panel | done |
| app/components/AccountsPage.tsx:2790-2796 | "Wrong account connected" red banner | amber attention treatment, ink text | done |
| components/SpendVerdictView, TeachingSheet, IntentConsentSheet, MiscategorisedReviewSheet | 12 px semibold red `role=alert` | this is the DESIGN.md field-error pattern | no change |
| danger-zone / destructive confirm buttons (SettingsPage, ConfirmDialog, SpendTrends) | red for irreversible actions | destructive action, not an error | no change |

## E. Other
- Capacitor native dialogs: none (`@capacitor/dialog` not a dependency).
- Capacitor in-app browser landing on backend JSON: covered by B (every callback now ends in the
  hand-off page or a redirect).
- `ConfirmDialog.tsx` (centred dialog, used by Settings and Accounts) is a designed primitive but
  not a SheetFrame; left as is. It has no `confirm()` semantics to replace.

## Counts
Native dialogs 11 (all 11 fixed); backend navigation error paths 10 fixed, 4 groups confirmed fine; Next surfaces 3 created; non-financial red all sites fixed, rest intentionally unchanged.

`confirmSheet` has no caller yet: every destructive action found (AccountsPage entry, rule and account removal, Settings delete and unlink) already confirms through ConfirmDialog or AccountsPage's own showConfirm, so nothing needed wiring. It is exported and ready for the next confirm that is needed, in place of a native confirm.
