# A136: native sign-in state fixation

Found by the A133 review (2026-10-03), pre-existing. Fixed 2026-10-11 under A136.

## The attack as it stood

The app chose its own sign-in `state` and a `challenge` (sha256 of a poll
secret it kept) and opened `GET /auth/google/mobile?state=S&challenge=C` in the
system browser. The callback stored the session token under `S`; the app
polled `POST /auth/mobile/poll {state: S, poll_secret: P}` and the server
released the token when sha256(P) equalled C.

Nothing tied `S` to the device or person who finished the Google sign-in:

1. The attacker generates `S`, `P` and `C = sha256(P)` themselves (no app
   needed, a script is enough).
2. They send the victim the link `.../auth/google/mobile?state=S&challenge=C`.
3. The victim opens it, signs in with Google, and sees "Signed in".
4. The callback stores the victim's session token under `S`.
5. The attacker polls with `P` and receives the victim's session token.

Impact: full account takeover for anyone who can be tricked into one tap on a
link. The A133 challenge stopped a log reader who only had the state, but not
an attacker who chose the state and challenge up front.

## The fix (final design)

The first cut (server-issued state, poll secret and PKCE verifier on the poll)
did not close the attack: the attacker calls `POST /auth/mobile/start`
themselves, holds the verifier and poll secret, sends the victim the link and
polls. The final design binds the result to the device that COMPLETES the flow.

- `POST /auth/mobile/start {challenge}` issues `{state, poll_secret,
  expires_at}`; `challenge` is sha256 of a PKCE verifier the app keeps. Record
  (PKCE challenge, starter network prefix) in Redis, 10 minute TTL, pre-auth, not
  user-keyed, so not in `ERASURE_MANIFEST`. Rate limit 10 per minute per IP.
- `GET /auth/google/mobile` and the callback only act on a live, unused issued
  state; anything else is a uniform `404 {"detail":"Not Found"}`.
- On callback the outcome is NOT stored under the state. The server mints a
  one-time 128-bit `code` (Redis, 2 minute TTL, single use) holding the outcome
  and sends the completing browser to `wealthdash://auth-done?code=<code>`
  (the path is frozen for installed binaries; the code rides in the query).
  The state is closed at the same moment.
- `POST /auth/mobile/redeem {code, code_verifier}` releases the outcome only if
  sha256(verifier) equals the challenge stored at start and the code is live and
  unused; a wrong verifier consumes nothing; every failure is the same 404.
  Rate limit 20 per minute per IP.
- `POST /auth/mobile/poll` for an issued state returns `pending` forever (even
  with the legacy flag), so an attacker holding state, poll secret and verifier
  gets nothing.
- Client: `nativeGoogleLogin` calls start, opens the authorise URL with the
  server state, and redeems on the `wd:deeplink` event using the verifier it
  holds. A code received when no login with a verifier is pending, or one that
  404s on redeem, is dropped silently and shows nothing.

Why it closes the hole: the code goes to whoever finished the Google sign-in
(the victim's browser, which returns to the victim's app, which holds no
matching verifier). The attacker holds the verifier but never receives the code.

Residual: another app registered for the `wealthdash://` scheme could read the
code, but would also need the verifier, which never leaves the starting app.
The scheme return itself must work on the device: see the iOS note below.

## Transition (installed binaries bundle their web code)

`MOBILE_LOGIN_LEGACY_STATE` (default ON, set 2026-10-11) keeps the old
client-chosen state (A133 format and pre-A133 format) working for builds in the
field. Each legacy authorise and callback logs `mobile login: legacy state used`
(never the state), so the log is the metric: when it goes quiet after the next
app release reaches users, set the flag to `false` and later delete the
branches. While the flag is ON the original hole is still open for legacy
requests, so the fix is only complete once the flag is off.

## What this does not prove, and the extra signal

(First-cut analysis, superseded by the code return above.) A server-issued state alone does not stop an attacker who calls
`/auth/mobile/start` themselves and sends the victim the resulting link: the
server cannot tell the app's own browser from a link opened elsewhere without
device attestation. What the fix removes is choosing the state, unlimited
cheap attempts, replay, and redeeming without both secrets. As a further
signal the start record stores the starter's network prefix (IPv4 /24, IPv6
/64); `MOBILE_LOGIN_NET_BIND` is `off`, `log` (default: warn on a mismatch at
authorise or callback) or `enforce` (404). It defaults to `log` because a
phone can legitimately change address between the app and the browser; move to
`enforce` once the log shows mismatches are rare. App attestation (Play
Integrity, App Attest) remains the full answer and is not done.

## iOS scheme registration

Android: `capacitor-spike/scripts/ensure-wealthdash-manifest.py` places the
intent-filter. iOS: the `ios/` project is generated at build time, and the
`wealthdash` URL scheme is registered by the PlistBuddy step "Register
wealthdash URL scheme" in `codemagic.yaml` (CFBundleURLTypes). Nothing else
outside the repo is relied on for registration. Open risk: the hand-off page
notes that on iPhone a `wealthdash://` navigation from the in-app browser can be
swallowed (A133), and with the code return that is now the only way the result
reaches the app. Verify on a real iPhone before switching
`MOBILE_LOGIN_LEGACY_STATE` off; until then the legacy poll keeps old and
unverified builds working.
