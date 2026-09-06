# Jira sync

## The model

`TODO.md` and `docs/compliance/finexer-agent-controls-2026-09.md` stay the
content: what an item says, who owns it, whether it is done. A Jira Cloud
Kanban board (project key `SRT` by default) is the workflow: To Do, In
Progress, Blocked, Done, comments, and a place for Kevin to add work
directly.

The two are linked by a key written into the markdown once an issue
exists: `(SRT-12)` appended to a TODO.md item line, or `Jira: SRT-40`
appended to a question's `Status:` line in the compliance doc. Nobody
should hand-edit those keys. `scripts/jira_sync.py` is the only thing that
writes them, and it is also the only thing that should create or move
issues on the board — editing just one side (ticking a checkbox without
moving the Jira issue, or dragging a card without ticking the item) lets
the two drift apart.

Sessions call `start` / `block` / `done` when they pick up, get stuck on,
or finish a backlog item, instead of editing TODO.md by hand and leaving
the board untouched.

## One-time setup (Kevin)

1. If there is no Jira Cloud site yet, create one (a free/standard Jira
   Cloud site is enough to start).
2. Create a project with key `SRT`, type "Kanban" (software), team-managed
   is fine. Make sure its workflow has four statuses: **To Do**, **In
   Progress**, **Blocked**, **Done**. `bootstrap` checks for these and
   prints a manual step if one is missing — it does not edit workflows via
   the API.
3. Create an API token for your own Atlassian account at
   <https://id.atlassian.com/manage-profile/security/api-tokens>.
4. Optional but recommended: create a second Atlassian user, "Claude"
   (any mailbox you control, e.g. a `+claude` alias), and an API token for
   it too. This lets Claude's transitions on the board show up as a
   distinct actor instead of as you.
5. Find Atlassian `accountId`s (not emails) for both users: sign in as
   each and call `GET /rest/api/3/myself`, or look them up in the Jira
   people directory (Settings > People) — the URL for a person's profile
   contains their accountId.
6. Copy `.jira.env.example` to `.jira.env` in the repo root and fill in
   `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_ASSIGNEE_KEVIN`,
   `JIRA_ASSIGNEE_CLAUDE`, and (optionally) `JIRA_CLAUDE_EMAIL` /
   `JIRA_CLAUDE_API_TOKEN`. `.jira.env` is gitignored; never commit it.
7. Dry run first, then for real:

   ```bash
   backend/.venv/bin/python scripts/jira_sync.py bootstrap --dry-run
   backend/.venv/bin/python scripts/jira_sync.py bootstrap
   ```

   `bootstrap` creates one Epic per TODO.md section (A–H) plus a "Finexer
   questionnaire" epic, then one Task per backlog item and questionnaire
   question that does not already carry a Jira key, and writes the new
   keys back into the markdown. It is idempotent — re-running it after
   some items already have keys creates nothing new.

Until `.jira.env` exists, every command still runs in `--dry-run` (it
prints what it would do and touches neither the network nor the
markdown), which is how this repo works today with no Jira project yet.

## Commands

All commands run via:

```bash
backend/.venv/bin/python scripts/jira_sync.py <command> ...
```

- **`bootstrap [--dry-run]`** — one-time (and idempotent) setup: epics,
  tasks, and key write-back. See above.

- **`start <item-id> [--dry-run]`** — transitions the issue to In
  Progress and comments "Started by \<actor\> on \<date\>".

  ```bash
  backend/.venv/bin/python scripts/jira_sync.py start A3
  backend/.venv/bin/python scripts/jira_sync.py start Q7 --dry-run
  ```

- **`block <item-id> "<reason>"`** — transitions to Blocked with the
  reason as a comment.

  ```bash
  backend/.venv/bin/python scripts/jira_sync.py block B5 "Waiting on Vercel Pro upgrade"
  ```

- **`done <item-id> [--commit <sha>] [--dry-run]`** — ticks the checkbox
  in TODO.md, appends `(done <date>, <sha>)` to the item, transitions the
  Jira issue to Done, and comments with the commit hash. For a question
  (`Q7`), sets its `Status:` line to `submitted` instead of ticking a
  checkbox, and still transitions the issue to Done.

  ```bash
  backend/.venv/bin/python scripts/jira_sync.py done B1 --commit a1b2c3d
  backend/.venv/bin/python scripts/jira_sync.py done Q1
  ```

- **`status <item-id> <ready|needs-kevin|blocked-deploy>`** — questions
  only. Updates the `Status:` line and transitions the issue: `ready` →
  In Progress (label `ready-to-paste` — ready means ready to paste into
  the questionnaire, not submitted), `needs-kevin` → To Do, assigned to
  Kevin, `blocked-deploy` → Blocked.

  ```bash
  backend/.venv/bin/python scripts/jira_sync.py status Q5 blocked-deploy
  ```

- **`pull [--dry-run]`** — reads the board and reconciles: an issue moved
  to Done whose markdown item is still unticked gets ticked (suffixed
  `(done via Jira)`); an issue moved back to To Do whose item is ticked
  gets unticked. Any issue under a section epic that has no markdown
  counterpart and no `from-jira` label (i.e. Kevin added it straight to
  the board) is appended as a new item under that section in TODO.md and
  labelled `from-jira` so it is not appended twice. Prints a diff summary.
  `--dry-run` still reads the board (there is no other way to compute the
  diff) but writes nothing back.

  ```bash
  backend/.venv/bin/python scripts/jira_sync.py pull
  ```

- **`list`** — prints every item with its Jira key, owner, the markdown
  status, and (if `.jira.env` is configured) the live Jira status. Works
  offline: with no `.jira.env`, it prints the markdown-only columns and
  says so.

  ```bash
  backend/.venv/bin/python scripts/jira_sync.py list
  ```

Transitions are looked up by name at call time (`GET
/rest/api/3/issue/{key}/transitions`) — the script never hardcodes a
transition id, since those are workflow-specific.

## Assumptions worth knowing

- Issues use the `parent` field to link a Task to its section Epic, which
  is how team-managed (next-gen) Jira Cloud Kanban projects model
  epic/child relationships. A classic (company-managed) project uses a
  different "Epic Link" custom field instead — if `SRT` turns out to be
  classic, `bootstrap` will fail on the parent field and this doc's step 2
  should say "team-managed" more forcefully.
- Descriptions are written as plain-paragraph Atlassian Document Format
  (one paragraph per blank-line-separated block of the source text) — no
  rich formatting, since the source text is plain markdown-ish prose.
- `pull`'s reverse-sync for questions (an issue moved to Done sets
  `Status: submitted`) is one-directional; moving a question's Jira issue
  back out of Done does not guess which of `ready` / `needs-kevin` /
  `blocked-deploy` it should revert to, so that case is left for a manual
  `status` call.

## Tests

```bash
backend/.venv/bin/python -m pytest -q scripts/tests
```

Tests use temp copies of TODO.md / the compliance doc and a fake Jira
client that records calls instead of making network requests — there is
no live Jira project to test against yet.
