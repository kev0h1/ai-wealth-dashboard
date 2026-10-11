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

## The fix

The server issues the state.

- `POST /auth/mobile/start {challenge}` returns `{state, poll_secret,
  expires_at}`. `challenge` is the sha256 of a PKCE `code_verifier` the app
  keeps. The state and the poll secret are server-generated (128 bits each).
  The record (sha256(poll_secret), PKCE challenge, starter's network prefix)
  lives in Redis with a 10 minute TTL (in-process fallback), pre-auth and not
  user-keyed, so it is not in `ERASURE_MANIFEST` and needs no Mongo collection.
  Rate limit: 10 per minute per IP (`/auth/mobile/start` in `RULES`).
- `GET /auth/google/mobile` and the callback only act on a live, unused,
  server-issued state. Anything else (unknown, expired, used, malformed, or a
  client-chosen state) gets one identical `404 {"detail":"Not Found"}`. A
  `challenge` in the URL is ignored for an issued state, so it cannot be
  rebound.
- `POST /auth/mobile/poll` for an issued state needs the poll secret AND the
  code verifier. A wrong guess consumes nothing and looks like "pending".
- Single use: once the token is released the state stops being authorisable,
  and the record lingers only for the 30 second replay window.

## Transition (installed binaries bundle their web code)

`MOBILE_LOGIN_LEGACY_STATE` (default ON, set 2026-10-11) keeps the old
client-chosen state (A133 format and pre-A133 format) working for builds in the
field. Each legacy authorise and callback logs `mobile login: legacy state used`
(never the state), so the log is the metric: when it goes quiet after the next
app release reaches users, set the flag to `false` and later delete the
branches. While the flag is ON the original hole is still open for legacy
requests, so the fix is only complete once the flag is off.

## What this does not prove, and the extra signal

A server-issued state alone does not stop an attacker who calls
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
