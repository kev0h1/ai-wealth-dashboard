# A45: proposed Q11 answer (draft, not yet applied)

**This is a draft for Kevin's review and sign-off. Nothing here is submitted anywhere.
It has not been applied to `docs/compliance/finexer-agent-controls-2026-09.md`.**

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
markers included): **1,994**.

```text
Confirmed; the controls in our Security and Incident Response Policy are implemented in production: bank tokens encrypted at rest (AES/Fernet), key held only in platform secrets, outside source control; signed, time-limited session tokens on every request; sign-in only via verified Google/Apple identities, registration allow-listed until launch; TLS in transit; restricted CORS; rate limiting on auth/webhook routes; HMAC verification on Finexer webhooks; API docs disabled in production; MongoDB Atlas with network access controls; encrypted nightly backups, 30-day retention; platform logging on Vercel, Railway and Atlas.

Testing completed:
- Automated backend test suite (1,150+ tests) on every change; internal review of auth, session handling, logout hygiene and the webhook receiver (Aug/Sep 2026); CI-automated dependency scanning (SECURITY.md section 2).
- Internal security testing, 2026-09-19/20: seven work packages run by this project's own AI agents (Claude, Codex) under a signed ROE (2026-09-20): web shell, API tenant/deletion, API input handling, OAuth 2.1, Android (static), Finexer/TrueLayer, OpenRouter/Penny. Internal only, not an independent third-party or CREST engagement. No Critical findings. Three High, one deletion-lifecycle root cause (deletion does not revoke the Finexer consent, the connections list hides it, a deleted session stays valid up to 7 days and can still write data), all open. Rest Medium/Low. Not yet complete: cross-model review, API rate-limit/CORS, MCP, Android dynamic, Stripe, iOS dynamic. Detail: SECURITY.md, docs/security/pentest-runs/.
- No independently commissioned (third-party/CREST) test has taken place. [KEVIN: decide whether to commission one; A7, the external CREST engagement, stays open ahead of public launch.]

Outstanding findings: the three High findings above, all open, none remediated (SECURITY.md 3b). Two earlier Medium items (legacy PIN login, reconnect-cache data) remain closed, unchanged since last submission.
```

[KEVIN: review and approve before submission. Once satisfied, apply this block from the
shared tree (replacing the current Q11 answer text), decide whether `Status:` should move
off `blocked-deploy`, and then this file can be deleted.]

## What changed from the currently-submitted answer

The previous answer (still in the document today) said only "Internal security review of
authentication, session handling, data hygiene on logout, and the webhook receiver (August
and September 2026)" and "No independent penetration test has been commissioned at this
stage", with outstanding findings stated as "none rated Critical or High." That is no
longer accurate: the seven-work-package internal testing round below happened after that
answer was drafted and found three High findings, all currently open. This draft updates
the testing summary and the outstanding-findings line to reflect that, and folds in the
scope caveats (cross-model review owed, two provider-gated cases blocked, iOS dynamic
testing not yet run, four work packages not yet executed at all) so the answer does not
overstate coverage. Full detail lives in `SECURITY.md` section 3b, which this answer now
cites, matching the existing citation style section 3a already uses for Q11.
