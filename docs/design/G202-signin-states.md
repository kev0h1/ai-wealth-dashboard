# G202: native sign-in, what the user sees today

Read-only inventory, 2026-10-04. Paths are under `frontend/`. Nothing here is changed by the design round; the new optional props on `LoginScreen` are unused by production until a variant is picked.

## Summary

The login form (`components/LoginScreen.tsx:107-189`, the "Continue with Google" link at :150-162) is the only thing on screen at every point of a native sign-in except the in-app browser sheet itself and the blank slate div while `checking` is true. Nothing in `LoginScreen` knows a sign-in is in flight. There is no `phase`, no busy flag, no disabled state. The two failure outcomes use `window.alert`.

## State machine, tap to signed in (Google, native)

| # | Moment | Code | What renders | Bound |
|---|--------|------|--------------|-------|
| 0 | Idle form | LoginScreen.tsx:107-189, mounted by AuthProvider.tsx:412-414 (`!user`) | Form, enabled | none |
| 1 | Tap | `handleGoogleClick` LoginScreen.tsx:52-63 -> `nativeGoogleLogin` nativeAuth.ts:306-333; `savePendingLogin` :314 before the browser opens | Form unchanged, no feedback | instant |
| 2 | Opening the sheet | `Browser.open` raced against `BROWSER_OPEN_TIMEOUT_MS` nativeAuth.ts:318-325 | Form unchanged until the sheet slides up | up to 10 s, then the loop starts anyway; a rejection returns `"failed"` and `alert()` at LoginScreen.tsx:61 |
| (a) | Sheet open, polling | `runMobileLoginLoop` mobileLoginLoop.ts:35-112: interval 2 s (:36, :92), overall timeout 5 min (:37, :93); each POST bounded to 10 s (nativeAuth.ts:266) | The sheet covers the form. If the user dismisses the sheet (`browserFinished`) the form is fully visible and tappable, with the loop still polling behind it. A second tap starts a second login and a second pending record | 5 min, then `finish("failed")` -> `alert()` |
| (b1) | Deep link `wealthdash://auth-done` arrives | `onUrlOpen` mobileLoginLoop.ts:98-102 closes the sheet, triggers a poll; `finish` waits for `Browser.close()` up to `closeTimeoutMs` 1.5 s (:38, :69) | **The login form, enabled, no indication.** This is the flash Kevin reports | poll up to 10 s plus close up to 1.5 s |
| (b2) | Token applied, `establishSession` running | `finishNativeSignIn` LoginScreen.tsx:41-50 -> AuthProvider.tsx:78-93: `validateOnce` (:99-124) POST /auth/session/validate, on `unreachable` waits 1500 ms (`SESSION_RETRY_DELAY_MS` :53) and retries once, then awaits the profile (:91). `setUser` inside `validateOnce` (:116) is what swaps in the app | **The login form, enabled, no indication.** `validateOnce` has no abort or timeout of its own (`gatedFetch` is plain `fetch`, api.ts:1709), so the bound is whatever the platform's network timeout is | uncapped in code |
| 3 | Success | `setUser` -> AuthProvider.tsx:412 no longer matches; children mount | app | |

### Failure and edge paths

| Path | Code | What the user sees |
|------|------|--------------------|
| Sheet failed to open | nativeAuth.ts:326-329 | form, then a native `alert("Sign-in failed. Please try again.")` (LoginScreen.tsx:61) |
| Loop result `"failed"` (server `err`, or the 5 min timeout) | mobileLoginLoop.ts:85, :93 | same alert |
| Invite-only | `"invite_only"` -> `setNativeInviteOnly` LoginScreen.tsx:59-60 -> dedicated screen :78-105 | calm invite-only screen (already designed, D5) |
| `establishSession` -> `"rejected"` | AuthProvider.tsx:103-104, :81 | form, then `alert("Sign-in failed. Please try again.")` (LoginScreen.tsx:49) |
| `establishSession` -> `"unreachable"` (d) | LoginScreen.tsx:48 sets `unreachable`; notice button :134-143 | `setUnreachable(false)` at :45 hides the notice the moment a retry starts, so during the retry (about 1.5 s delay plus two fetches) the plain form shows again with no feedback. If it fails again the grey button returns: "Signed in, but we could not reach Sorted. Tap to try again." (grey, not announced to assistive tech, no focus move) |
| Apple (iOS) | `handleAppleClick` :65-74, `nativeAppleLogin` nativeAuth.ts:200-229, no poll loop | the native Apple sheet, then the form with no feedback while the POST /auth/apple/native and `establishSession` run; same alerts |

### (c) Resume after a process kill or WebView reload

`AuthProvider.init` AuthProvider.tsx:129-: `checking` starts true (:58) and renders the blank slate div `min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]` (:394-396) while it hydrates the token (:133) and calls `resumePendingLogin` (:140, nativeAuth.ts:341-364).

* First poll returns `ok` (token ready): token applied, `checking` stays true through the normal validate (:170-), so the user sees only the blank slate, then the app. No form flash. Honest enough but a blank screen with no mark or copy.
* First poll returns `pending` (the user has not finished in the browser, or the deep link was missed): `resumePendingLogin` returns `"pending"` straight away and starts a background loop for the remaining TTL (nativeAuth.ts:358-363). `init` falls through, finds no token, `setChecking(false)` (:176), so **the login form shows, enabled, with a background poll that can sign the user in for up to 5 minutes minus elapsed with no UI**. On late success, `onLateSuccess` runs `establishSession()` (:140) and the app appears with no transition; a late failure is silent.
* First poll `err`/`invite_only`: record cleared, form shown. An `invite_only` result here is dropped (no invite-only screen); not in scope for this round, noted for the planner.

## Where a loading state hooks in

1. `LoginScreen` is the right owner for the Google and Apple tap paths because it already holds the call sequence (`handleGoogleClick` -> `nativeGoogleLogin` -> `finishNativeSignIn`). A local `phase` (`idle | signing-in | failed | unreachable`) with a `startedAt` set on tap, cleared on every exit, covers (a), (b1), (b2) and (d).
2. The resume path (c) is owned by `AuthProvider`, not `LoginScreen`. It needs a small piece of shared state ("a pending login exists and is being awaited") that `AuthProvider` passes down, for example `resuming?: {startedAt}`. `resumePendingLogin` already knows `pending.startedAt` (nativeAuth.ts:343), so the elapsed clock survives a process kill honestly.
3. The failure messages replace the two `alert()` calls with an inline message in the card (focus moved to it), so a failure returns to the form with words.
4. Bound: the loop's 5 min timeout stays. `establishSession` needs its own overall bound (suggest 15 s per attempt via AbortController inside `validateOnce`) or the "signing in" state can outlive any copy we write. This is an implementation note, not part of the design round.

## What this round adds (preview only)

Optional `LoginScreen` props, all ignored by production (`AuthProvider` passes none of them): `phase` (a discriminated union) and `renderPhase` (a render slot). With them unset nothing changes. The variants (the `app/design/signin-loading/` preview, retired under H114) rendered the production `LoginScreen` shell and form through these props and supply only the signing-in panel and the notices.
