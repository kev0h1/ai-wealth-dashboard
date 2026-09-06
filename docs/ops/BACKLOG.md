# Backlog board

Kevin chose our own board over Jira. `TODO.md` and
`docs/compliance/finexer-agent-controls-2026-09.md` stay the source of
truth for content and workflow together (what an item says, who owns it,
whether it is to do, in progress, blocked or done, and any notes). Git is
the history: every write is a commit. The private page `/ops/go-live` is
read-write for the owner, and `scripts/backlog.py` gives any session the
same writes from the terminal. All three (the markdown, the page and the
CLI) go through one shared library, `backend/app/services/backlog.py`, so
they can never drift from each other.

## The model

A TODO.md item line looks like this:

```
- [ ] **A1. Title.** [owner: claude] [state: in-progress] Description text.
  - note (2026-09-06, kevin): a note about A1.
```

- The checkbox (`[ ]` / `[x]`) carries done/not-done. A done item gets a
  trailing marker: `(done 2026-09-06, abc1234)` (the commit hash is
  optional). Marking an item done clears any state tag; reopening it
  clears the done marker and leaves the state at to do.
- `[state: in-progress]` or `[state: blocked: <reason>]` is the workflow
  state. Absent means to do. It is meaningless once the item is done (the
  checkbox wins).
- `[owner: kevin]` or `[owner: claude]` says who is doing the work.
- Indented `- note (date, actor): text` sub-bullets sit directly under the
  item line, oldest first.

Questions in the compliance doc keep their existing `## Qn <title>` /
`Status: <status>` shape, where status is one of `ready`, `needs-kevin`,
`blocked-deploy`, `submitted`.

## The shared library

`backend/app/services/backlog.py` is the only code that parses or writes
either file. It exposes:

- `load(todo_path=None, compliance_path=None)` — read-only snapshot with
  `.items()` and `.questions()` returning plain dicts ready to serialise.
- `set_done(item_id, done, commit=None, actor="claude")`
- `set_state(item_id, state, reason=None, actor="claude")` — `state` is
  `"todo"`, `"in-progress"` or `"blocked"`.
- `set_owner(item_id, owner, actor="claude")`
- `add_note(item_id, text, actor="claude")`
- `set_question_status(q_id, status, actor="kevin")`

Every mutator writes the file atomically (temp file + rename) under an
`fcntl.flock` on `.backlog.lock` in the repo root, so two writers can
never interleave and corrupt the file. After the write lands, it runs
`git add <file>`, `git commit -m "backlog: <item> <action> by <actor>"
--author "Sorted Ops <ops@auriqltd.co.uk>" -- <file>`, then a best-effort
`git push origin HEAD` (15 second timeout). A failed commit or push is
logged and reported back as `committed: false`, but the file write itself
already happened by that point, so a flaky git command never loses an
edit — worst case, the change sits on disk uncommitted until the next
successful write or a manual `git add && git commit`.

## The CLI

```bash
backend/.venv/bin/python scripts/backlog.py list
backend/.venv/bin/python scripts/backlog.py start <id>
backend/.venv/bin/python scripts/backlog.py block <id> "<reason>"
backend/.venv/bin/python scripts/backlog.py done <id> --commit <sha>
backend/.venv/bin/python scripts/backlog.py reopen <id>
backend/.venv/bin/python scripts/backlog.py note <id> "<text>"
backend/.venv/bin/python scripts/backlog.py owner <id> kevin|claude
backend/.venv/bin/python scripts/backlog.py status Q7 ready|needs-kevin|blocked-deploy|submitted
```

Every command takes `--actor kevin|claude` (defaults to `claude`), which
is what shows up in the commit message and any note. Sessions should
always use this instead of hand-editing `TODO.md` — a hand edit still
works (the parser tolerates it), but it skips the lock, the atomic write
and the commit, which is how the file and the git history quietly drift
apart.

## The page

`frontend/app/ops/go-live/page.tsx` is the same board in the browser.
`GET /ops/go-live` (owner-only, `backend/app/routers/ops.py`) returns the
raw markdown plus the parsed `items` and `questions` so the page never
re-parses anything itself. `POST /ops/go-live/items/{id}` and
`POST /ops/go-live/questions/{q}` make the same writes the CLI does,
always attributed to `kevin` (the page is owner-only end to end), and
return the full refreshed GET payload plus `committed`. The page replaces
its state from that response rather than guessing, and shows a quiet
"Saved" or "Saved to file, git commit failed" line when `committed` is
false.

## The shared working tree caveat

All sessions on the VPS work in the same checkout, so a write from the
page or the CLI is visible to every other session immediately — there is
no separate "your copy" to sync. Commits exist for history and for
recovering from a bad edit, not for merging concurrent copies. The file
lock only protects a single write from tearing; it does not serialise two
sessions editing the same item at the same moment, so treat "who's
working on what" as a social contract (the owner tag and `[state:
in-progress]` are there to make that visible) rather than something the
lock enforces for you.
