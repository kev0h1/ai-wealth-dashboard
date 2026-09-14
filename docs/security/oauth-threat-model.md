# OAuth 2.1 authorisation server — threat model

Covers `backend/app/routers/oauth.py` and `backend/app/core/pending_oauth.py`
(built for F2 so a user's own AI assistant can connect to the MCP connector,
`backend/app/routers/mcp.py`), plus the two integration points in
`backend/app/core/auth.py` (the `/mcp` `WWW-Authenticate` discovery header,
and `resolve_mcp_principal` accepting a `sorted_at_...` access token). This
has never had an external review; A26 is the first pass. `BOT_SECRET` (a
separate, unrelated admin bypass in `core/auth.py`) is A28's scope, not
this document's.

Written 2026-09, against the code as it stood after this pass's one fix
(see "Findings" below). Read alongside
`docs/security/pentest-scope-2026-09.md` for where this surface sits in the
overall engagement scope.

## What this server is, in one paragraph

Sorted runs a public-client-only OAuth 2.1 authorisation server
(`token_endpoint_auth_method: "none"` everywhere — every connector is a
native or browser app that cannot keep a secret) so that an MCP client like
Claude or ChatGPT can register itself, send the user through a
session-authenticated consent screen, and receive a short-lived access
token plus a rotating refresh token, scoped to read-only account/plan/
insight data (`V1_SCOPES` = `accounts:read`, `plans:read`, `insights:read`;
there is no write scope in v1). PKCE (S256, mandatory) is the entire
defence against authorization-code interception, since there is no client
secret to also check.

## Assets

- The user's session (Google/Apple-verified identity) — must never be
  extended to a connector without the user seeing and approving what's
  being granted.
- Read access to the user's accounts/plans/insights data — what a stolen
  or over-broadly-granted token actually lets someone do.
- The authorization code and the refresh token themselves — bearer secrets
  that, if intercepted, are exactly as good as a real grant until revoked.
- The consent screen's integrity — the one place a user is shown who's
  asking for what; if this can be bypassed or spoofed, the rest of the
  flow's careful checks don't matter.

## Actors / trust boundaries

- **A legitimate connector** (Claude, ChatGPT, a future first-party mobile
  app) — registers itself, redirects the user's browser to `/authorize`,
  and later calls `/token` from its own backend or a loopback listener.
  Not trusted with a client secret (there isn't one), trusted only as far
  as PKCE and a validated `redirect_uri` bind a specific code/token to it.
- **The consenting user** — the only human in this flow. Trusted to read
  the consent screen; not defended against clicking approve without
  reading it (a general phishing/consent-fatigue problem no OAuth
  implementation solves on its own).
- **A network attacker / an app that can intercept a redirect** — the
  classic OAuth 2.1 threat model target: someone who can observe or
  intercept the `code` in the redirect URI (a malicious app on the same
  device registering the same custom scheme, a compromised network, a
  browser history/log leak) but does not have the user's session.
- **A malicious or careless "client"** — anyone can call
  `POST /auth/oauth/register`, since dynamic registration is
  unauthenticated by design (that's what makes it "dynamic"; RFC 7591).
  Trust in a registered client_id is therefore zero until a real user
  approves a real consent screen naming that client.
- **A malicious/compromised connector host** — has valid tokens for
  whichever users approved it, scoped to `V1_SCOPES`, revocable via
  `/oauth/connections`.

## Threats, mitigation, and where it's tested

### T1 — Authorization code interception / replay

An attacker who captures a `code` (browser history, a referrer leak, a
compromised redirect endpoint, a proxy log) tries to redeem it themselves.

- **PKCE binds the code to whoever generated the original `code_verifier`.**
  `code_challenge_method` must be exactly `S256` (`authorize()` rejects
  anything else, including the deprecated `plain` method) and the token
  endpoint recomputes the SHA-256/base64url challenge from the presented
  verifier and compares with `secrets.compare_digest` (constant-time).
  Tested: `test_token_exchange_fails_with_wrong_verifier`.
- **Redemption is one-shot.** Reusing a code revokes the whole token family
  it (or anything refresh-rotated from it) ever produced — the assumption
  is that reuse is itself evidence of leakage, so the safe response is to
  kill the family, not just reject the second attempt. Tested:
  `test_code_reuse_revokes_the_whole_family`.
- **`redirect_uri` must match exactly** what was presented at `/authorize`
  and stored with the code — tested implicitly by every happy-path test
  (`_approve_and_get_code` threads the same `redirect_uri` through both
  legs) and explicitly rejected on mismatch in `_handle_authorization_code_grant`.
- **Codes expire in 5 minutes** (`CODE_TTL`), narrowing the interception
  window regardless of the above.

### T2 — Concurrent redemption of the same code (found and fixed by A26)

Before this pass, the code-exchange handler read the code
(`find_one`), ran its checks, and only *then* wrote `used_at` in a separate
`update_one`. Two requests presenting the same code at the same time could
both pass the `used_at is None` read before either write landed, and both
would mint a live token pair from one code — a genuine gap in the "a code
can only ever be redeemed once" guarantee, distinct from and not caught by
the sequential-reuse test above (which only exercises one request finishing
before the next starts).

**Fixed in this pass**: the final step is now a single atomic
`find_one_and_update({"_id": code_hash, "used_at": None}, ...)`. MongoDB
serialises writes to one document, so of any number of concurrent callers,
exactly one can ever match `used_at: None` and claim the code; every other
caller's filter fails and it falls into the same "already used" handling as
a sequential replay (which, per T1, revokes the whole family — including,
if the race is lost by the attacker, the legitimate winner's own
just-issued tokens; this is the same fail-safe-over-convenience choice the
sequential case already made, not a new tradeoff introduced by the fix).
The refresh-token rotation leg (`_handle_refresh_token_grant`) had the
identical shape of gap and got the identical fix.

Tested: `test_concurrent_code_exchange_only_one_winner`,
`test_concurrent_refresh_rotation_only_one_winner` — both force the race
deterministically (an `asyncio.Event`-based rendezvous gate ensures both
concurrent requests have already passed their non-mutating checks before
either reaches the atomic claim, modelling the worst case rather than
hoping the scheduler happens to interleave that way) and assert exactly one
of the two responses is a 200.

This was the one real, previously-unknown weakness this pass found in the
OAuth server. It required a live network race to exploit in practice
(sending the same intercepted code twice within the same few-millisecond
window), so the practical severity was low, but it was a genuine violation
of "an authorization code cannot be replayed" as an absolute property, and
is exactly the kind of thing this item exists to find before an external
tester does.

### T3 — PKCE downgrade or bypass

Could a client skip PKCE entirely, or use the weaker `plain` method?

- `authorize()` requires `code_challenge_method == "S256"` and a non-empty
  `code_challenge`; anything else (including omission, or `plain`) redirects
  with `invalid_request`. There is no code path that stores a code without
  a challenge. Tested: covered by every happy-path test using a real S256
  challenge, and `test_authorize_missing_state_redirects_with_invalid_request`'s
  sibling checks confirm the redirect-with-error shape for bad input in
  general.

### T4 — Refresh token theft / reuse after rotation

An attacker who captures a refresh token (e.g. from a compromised
connector's storage) tries to use it after the legitimate client has
already rotated it, or races the legitimate client to redeem it first.

- **Rotation is mandatory and one-way**: every refresh grant issues a new
  pair and revokes the presented refresh token in the same atomic step (see
  T2's fix). A rotated-out token fails the same `revoked_at` check as any
  other dead token. Tested: `test_refresh_rotation_revokes_old_refresh_token`
  (sequential reuse) and `test_concurrent_refresh_rotation_only_one_winner`
  (the race, added this pass).
- Unlike authorization-code reuse, refresh-token reuse does **not**
  currently revoke the whole family the way code reuse does — it just fails
  the individual redemption. This is a smaller gap than it sounds (the
  attacker's stolen token is already dead either way, and the legitimate
  client's next legitimate rotation continues working), but it means a
  detected refresh-token-reuse event doesn't proactively kill the access
  token that was issued alongside the stolen refresh token. **Not fixed in
  this pass** (see "Residual risks" below) — flagged rather than
  silently patched, per this item's brief.

### T5 — Revocation not actually effective

Does `POST /auth/oauth/revoke` (or the settings-page
`DELETE /oauth/connections/{client_id}`) leave anything still usable?

- Revocation targets the whole `pair_id` (access + refresh minted together),
  not just the presented token, so revoking either half kills both.
  Tested: `test_revoke_endpoint_revokes_access_and_its_refresh_sibling`,
  `test_delete_connection_revokes_every_token_for_that_client`.
- Revoking an unknown or already-revoked token still returns 200 (RFC 7009
  §2.2 — this is correct behaviour, not a bug: it stops a caller from using
  the revoke endpoint's response code to probe whether a token exists,
  and an already-dead token is by definition already not usable). Tested:
  `test_revoke_unknown_token_is_still_a_200`.
- Effectiveness is immediate, not just eventual: `resolve_mcp_principal`
  (`app/routers/mcp.py`) checks `revoked_at` on every call, there is no
  cache of "still valid" to go stale. Tested:
  `test_resolve_mcp_principal_rejects_revoked_token`.

### T6 — Dynamic client registration used to escalate

Since `POST /auth/oauth/register` is deliberately unauthenticated (RFC 7591
— that's what "dynamic" means), can registering a client gain anything
beyond "a client_id exists"?

- **`client_id` is server-generated** (`secrets.token_urlsafe(16)`), never
  client-supplied — no squatting on another client's id.
- **`redirect_uris` are validated at registration time** (must be `https`
  with a real hostname, or `http://localhost`/`http://127.0.0.1` on any
  port — the standard OAuth 2.1 native-app loopback exception) and again at
  `/authorize` time (the presented `redirect_uri` must exactly match one
  registered for that `client_id`), so a client cannot register one
  redirect and later redirect somewhere else. Tested:
  `test_register_rejects_non_https_non_loopback_redirect`,
  `test_register_accepts_loopback_redirect_any_port`,
  `test_register_accepts_https_redirect`,
  `test_authorize_redirect_uri_mismatch_returns_plain_400`.
- **An unknown `client_id` or a redirect that doesn't match never becomes a
  redirect at all** — `authorize()` returns a plain 400 response for both
  failures rather than 302-ing anywhere, which is what stops this endpoint
  from being usable as a generic open redirect. Tested:
  `test_authorize_unknown_client_returns_plain_400_never_a_redirect`,
  `test_authorize_redirect_uri_mismatch_returns_plain_400`.
- **Scopes are capped server-side**: `/authorize` rejects any scope not in
  `V1_SCOPES` (there is no write scope to request even if a client asks).
  Tested: `test_authorize_bad_scope_redirects_with_error_and_state`.
- **The consent screen shows the real redirect host** before the user
  approves anything (`GET /oauth/request/{id}` returns `redirect_host`,
  parsed from the stored, already-validated `redirect_uri`) — the standard
  mitigation for "a legitimate-sounding client name with an attacker-
  controlled redirect," since the user sees where the grant is actually
  going, not just a name. Tested:
  `test_get_request_details_plain_language_scopes`.
- **Registration is rate-limited** (`app/core/ratelimit.py`, 10 requests per
  60 seconds per IP, ahead of the generic `/auth/` rule) — out of scope to
  change here (A27 owns that file), noted because it directly mitigates a
  registration-flood / storage-exhaustion concern that would otherwise sit
  on this surface.

No client-impersonation or privilege-escalation path was found in dynamic
registration during this review.

### T7 — Consent request tampering / replay

Between `/authorize` validating a request and `/oauth/decision` resolving
it, the request's parameters live in `app.core.pending_oauth` (Redis, or an
in-process fallback), keyed by a random 16-byte id, 10-minute TTL.

- **Read-then-consume is split deliberately**: `GET /oauth/request/{id}`
  peeks (doesn't consume, so the consent page can safely re-render on
  refresh/back), `POST /oauth/decision` pops via Redis `GETDEL` (atomic
  read-then-delete) or the in-process equivalent — a double-submit of the
  decision (double-tap, retry) can't mint two codes from one pending
  request, and an expired/already-decided request 404s rather than
  resolving to stale data. Tested: `test_decision_expired_request_raises_404`.
- **The decision endpoint is session-authenticated** (`current_user`
  dependency) — a pending request can only be approved or denied by
  whoever is signed in on that browser, not by anyone who merely guesses or
  intercepts the `req_id`. Guessing is also infeasible on its own
  (16 bytes of `secrets.token_urlsafe`).

### T8 — `/mcp`'s own bearer handling

Two bearer shapes reach `/mcp`: a `sorted_at_...` OAuth access token
(scoped per the grant that produced it) and, for the F3 stopgap, a plain
session bearer (granted all of `V1_SCOPES`, `client: "session"`). Reviewed
for cross-contamination between the two:

- `auth_middleware` only lets a `sorted_at_` token through to `/mcp`
  itself, not to any other route — a connector's access token can't be used
  as a substitute session token anywhere else in the app even if presented.
  Tested: `test_sorted_at_bearer_on_a_non_mcp_route_is_rejected_by_the_middleware`.
- A `sorted_rt_` refresh token is never accepted outside `/auth/oauth/token`
  and `/auth/oauth/revoke` (both already-public `/auth/` routes) — it never
  even reaches the `/mcp`-specific branch. Tested:
  `test_sorted_rt_refresh_token_on_mcp_is_rejected_by_the_middleware`.
- Each individual tool call is checked against the resolved principal's own
  `scopes`, not just "is this bearer valid at all" — a token minted with
  only `accounts:read` cannot call a `plans:read`-scoped tool. Tested:
  `test_tools_call_enforces_the_access_tokens_own_scopes`.
- The `WWW-Authenticate` discovery header (RFC 9728) is only ever attached
  to `/mcp`'s own 401s, not leaked onto unrelated routes' error responses.
  Tested: `test_mcp_401_with_no_bearer_carries_www_authenticate`,
  `test_other_routes_401_has_no_www_authenticate_header`.

## Residual risks (not fixed this pass, flagged rather than patched)

- **T4's partial gap**: refresh-token reuse fails the individual redemption
  but doesn't revoke the sibling access token the way code reuse revokes
  the whole family. Closing this fully means deciding whether refresh reuse
  should be treated as seriously as code reuse (revoke everything under
  that `pair_id`/`origin_code_hash`) — a five-line change once that product
  decision is made, but a decision, not a "small and safe" fix to make
  silently in a pentest-readiness pass.
- **No per-client rate limit beyond the IP-based rules in
  `app/core/ratelimit.py`** (A27's file): a single compromised or malicious
  client_id can still hit `/auth/oauth/token` at the generic 30/60 budget
  from many IPs. Not assessed further here since it's explicitly A27's
  surface.
- **Consent-fatigue / social engineering**: nothing in an OAuth
  implementation stops a user from approving a consent screen they didn't
  read carefully. The screen does show the real redirect host and
  plain-language scope descriptions (T6), which is the standard mitigation;
  beyond that this is a UX/education problem, not a protocol one.
- **`BOT_SECRET`** is a separate, much higher-severity issue (a single
  static shared secret that authenticates as the product owner's own
  account with no expiry, scoping or audit trail) but is explicitly A28's
  scope, not touched or re-assessed here beyond noting it exists on the
  same host.

## Abuse-test inventory (what the brief asked for, and where it lives)

| Requirement | Test(s) |
|---|---|
| An authorization code cannot be replayed | `test_code_reuse_revokes_the_whole_family`, `test_concurrent_code_exchange_only_one_winner` (new, A26) |
| PKCE actually binds the verifier | `test_token_exchange_succeeds_with_correct_verifier`, `test_token_exchange_fails_with_wrong_verifier` |
| A refresh token cannot be reused after rotation | `test_refresh_rotation_revokes_old_refresh_token`, `test_concurrent_refresh_rotation_only_one_winner` (new, A26) |
| Revocation is effective immediately | `test_revoke_endpoint_revokes_access_and_its_refresh_sibling`, `test_delete_connection_revokes_every_token_for_that_client`, `test_resolve_mcp_principal_rejects_revoked_token` |
| Dynamic client registration cannot be used to escalate | `test_register_rejects_non_https_non_loopback_redirect`, `test_register_accepts_loopback_redirect_any_port`, `test_register_accepts_https_redirect`, `test_authorize_unknown_client_returns_plain_400_never_a_redirect`, `test_authorize_redirect_uri_mismatch_returns_plain_400`, `test_authorize_bad_scope_redirects_with_error_and_state` |

All in `backend/tests/test_oauth_server.py`. Run with:

```bash
cd backend && .venv/bin/python -m pytest -q tests/test_oauth_server.py
```
