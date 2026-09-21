# A45: proposed Q11 answer (draft, not yet applied)

**This is a draft for Kevin's review and sign-off. Nothing here is submitted anywhere.
It has not been applied to `docs/compliance/finexer-agent-controls-2026-09.md`.**

Revision 2 (2026-09-21): updated after three more work packages executed (WP2/A49,
WP6/A53, WP10/A58), bringing coverage to 10 of 12, and after the resulting findings were
folded into the same-model severity triage. See "What changed" at the end for the delta
from revision 1.

## Why this is a separate file, not an edit to the compliance doc

`docs/ops/BACKLOG.md` ("Branch per item") is explicit that `TODO.md` and
`docs/compliance/finexer-agent-controls-2026-09.md` together make up "the board", and the
board is edited **only** from the shared tree at `/root/ai-wealth-dashboard`, never from a
session's worktree by hand. This session ran entirely inside the worktree for A45
(`/root/worktrees/feature-A45-q11-security-report`), so it cannot edit that file directly
without breaking that rule.

Separately, `scripts/backlog.py`'s `status` command only ever sets a question's `Status:`
line (`ready` / `needs-kevin` / `blocked-deploy` / `submitted`); there is no command that
writes a question's prose answer text. The answer body under each `## Qn` heading is, and
always has been, a direct prose edit of the markdown file (see every existing answer in
that document, all authored the same way). So there is no command this session could have
called instead of an edit either.

Putting the two together: the right way to land this is for a session working from the
shared tree (or Kevin himself) to copy the block below into `docs/compliance/finexer-agent-controls-2026-09.md`'s
existing `## Q11` section, replacing the current fenced answer text, once Kevin has
reviewed it. The current `Status: blocked-deploy` line is left untouched here; whether it
changes is Kevin's call once the rest of the Q12/Q13 prerequisites are also resolved, this
item does not touch it.

## Proposed replacement for the fenced answer block under `## Q11`

Character count of the block below (matching the document's own "answer block stays under
2000 characters" rule, counted the same way: everything inside the fence, `[KEVIN: ...]`
markers included): **1,996**.

```text
Confirmed; the controls in our Security and Incident Response Policy are implemented in production: bank tokens encrypted at rest (AES/Fernet), key held only in platform secrets outside source control; signed, time-limited session tokens on every request; sign-in only via verified Google/Apple identities, registration allow-listed until launch; TLS in transit; restricted CORS; rate limiting on auth/webhook routes; HMAC verification on Finexer webhooks; API docs disabled; MongoDB Atlas access controls; encrypted nightly backups, 30-day retention; platform logging on Vercel, Railway, Atlas.

Testing completed:
- Automated backend test suite (1,150+ tests) on every change; internal review of auth, session and logout hygiene, webhook receiver (Aug/Sep 2026); CI-automated dependency scanning (SECURITY.md 2).
- Internal security testing, 2026-09: ten of twelve work packages run by this project's own AI agents (Claude, Codex) under a signed ROE (2026-09-20): web shell, API boundaries/limits, tenant/deletion, input handling, OAuth 2.1, MCP, Android (static), Finexer/TrueLayer, Stripe, OpenRouter/Penny. Internal only, not an independent third-party or CREST engagement. No Critical findings. Four High: three form one deletion-lifecycle issue (deletion does not revoke the Finexer consent, connections list hides it, deleted sessions stay valid up to 7 days and can write data); the fourth is an MCP prompt-injection gap, UAT-only (connector off in production). All four open. Rest Medium/Low/Info. Android/iOS dynamic testing not yet run, deferred to A7; cross-model review outstanding. Detail: SECURITY.md, docs/security/pentest-runs/.
- No independently commissioned (third-party/CREST) test has taken place. [KEVIN: decide whether to commission one; A7 stays open ahead of launch.]

Outstanding: the four High findings above, all open, none remediated (SECURITY.md 3b). Two earlier Medium items (legacy PIN login, reconnect-cache data) remain closed, unchanged since last submission.
```

[KEVIN: review and approve before submission. Once satisfied, apply this block from the
shared tree (replacing the current Q11 answer text), decide whether `Status:` should move
off `blocked-deploy`, and then this file can be deleted.]

## What changed from the currently-submitted answer

The previous answer (still in the document today) said only "Internal security review of
authentication, session handling, data hygiene on logout, and the webhook receiver (August
and September 2026)" and "No independent penetration test has been commissioned at this
stage", with outstanding findings stated as "none rated Critical or High." That is no
longer accurate: the internal testing round below found four High findings, all currently
open. This draft updates the testing summary and the outstanding-findings line to reflect
that, and folds in the scope caveats (cross-model review owed, two provider-gated cases
blocked, Android/iOS dynamic testing not yet run) so the answer does not overstate
coverage. Full detail lives in `SECURITY.md` section 3b, which this answer cites, matching
the existing citation style section 3a already uses for Q11.

## What changed from revision 1 of this draft (same day, 2026-09-21)

Three more work packages executed after revision 1 was written: WP2 (API inventory,
credential boundaries, rate limits, CORS, error handling, A49), WP6 (the MCP connector,
A53) and WP10 (the Stripe fail-closed boundary, A58). Coverage moved from 7 to 10 of 12
work packages; only the two dynamic device packages (Android, iOS) remain unexecuted, both
deferred to the external A7 engagement or a future device-equipped session, not to be read
as coverage gaps this answer glosses over.

Six new findings came out of that work: A90 (Low, MCP protocol-version negotiation gap),
A91 (**High**, MCP output masking is structural only and never sanitises content, a live
prompt-injection surface; UAT-only exposure today because the connector is off in
production by design, but a must-fix before it is switched on), A92 (Medium, production's
proxy chain does not strip a spoofable client-IP header, downgraded from an initially
proposed High because there is no password login behind it to brute-force and per-user
data-route limits are untouched), A93 (Low, a NUL byte crashes one search endpoint with no
data leak), A94 (Informational, a dead/unreachable authorisation branch), and A95 (Medium,
`/logo/{domain}` has no rate limit at all). WP10 (Stripe) found nothing: every case passed,
fail-closed behaviour confirmed. The headline moved from three High findings to four: the
original deletion-lifecycle three (A82/A83/A84) plus A91.

Note on A92 specifically: its board priority tag reads `p2`, which is a work-scheduling
priority, not its security severity. Its assessed severity is Medium, and this answer
states it as Medium, not High.
