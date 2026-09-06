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
- `[state: in-progress]`, `[state: blocked: <reason>]` or
  `[state: review: item/<ID>-<slug>]` is the workflow state. Absent means
  to do. It is meaningless once the item is done (the checkbox wins). The
  `review` state and its branch are set by `scripts/session.sh finish`
  and consumed by `scripts/integrate.py` — see "Branch per item" below.
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
- `set_state(item_id, state, reason=None, branch=None, actor="claude")` —
  `state` is `"todo"`, `"in-progress"`, `"blocked"` (needs `reason`) or
  `"review"` (needs `branch`).
- `set_review(item_id, branch, actor="claude")` — convenience wrapper over
  `set_state(..., "review", branch=branch)`.
- `add_item(section, title, owner=None, actor="claude")` — allocates the
  next id in `section` and appends it as a new to-do item.
- `set_owner(item_id, owner, actor="claude")`
- `add_note(item_id, text, actor="claude")`
- `set_question_status(q_id, status, actor="kevin")`

The repo root every one of these resolves against is fixed to
`/root/ai-wealth-dashboard` (override with the `BACKLOG_ROOT` env var,
tests only) rather than derived from where this file's own checkout lives
— see "Branch per item" below for why that matters once sessions run from
git worktrees.

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
backend/.venv/bin/python scripts/backlog.py add A "New item title" --owner claude
backend/.venv/bin/python scripts/backlog.py start <id>
backend/.venv/bin/python scripts/backlog.py block <id> "<reason>"
backend/.venv/bin/python scripts/backlog.py review <id> --branch item/<id>-<slug>
backend/.venv/bin/python scripts/backlog.py todo <id>
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

This CLI's repo root is fixed to `/root/ai-wealth-dashboard` regardless of
the caller's working directory (override with `BACKLOG_ROOT`, tests only),
so it always edits the one shared board even when run from a git worktree
under `/root/worktrees/<branch>` — see "Branch per item" below.

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

## Branch per item

Everything above still holds for the board files themselves. What changed
is where sessions do their *code* work: instead of every parallel Claude
session editing the one shared checkout at `/root/ai-wealth-dashboard`
(the actual source of most of that "who's working on what" friction), each
backlog item gets its own git worktree on its own branch, and a separate
integrate step folds finished branches back into `main` on a schedule.

**The model.**

- `main` is the integration branch — it is what the shared tree at
  `/root/ai-wealth-dashboard` stays checked out to, and what UAT
  (`systemctl restart wealth-*`) runs. Nothing merges into it except
  through `scripts/integrate.py`.
- `release` is the production branch. Vercel's production branch points at
  `release`; Railway deploys off it stay manual. Promoting `main` to
  `release` is a separate, deliberate step (not part of this workflow) —
  ask Kevin before touching it.
- A session that picks up backlog item `<ID>` works only inside a git
  worktree at `/root/worktrees/item-<ID>-<slug>`, on a branch named
  `item/<ID>-<slug>`, created off `origin/main`. It never edits files in
  the shared tree, and never restarts a UAT service from the worktree —
  UAT only ever changes when integrate merges the branch.
- The board (`TODO.md`, `docs/compliance/...`) is edited **only** in the
  shared tree, only through `scripts/backlog.py` (unchanged from the rest
  of this doc). A worktree's own checked-out copy of those files is not
  the board — it is a stale snapshot from whenever the branch forked off
  `main`, and editing it does nothing but create merge noise. This is why
  it never conflicts: every session's code changes live on an isolated
  branch, and the one file that all of them might otherwise touch
  concurrently is never touched from inside a worktree at all.

**The three commands** (`scripts/session.sh`, `scripts/backlog.py`):

```bash
scripts/session.sh start <ID> [slug] [--title "New item title"]
scripts/session.sh finish <ID>
scripts/session.sh abandon <ID>
scripts/session.sh list
```

- `start` verifies the shared tree is clean (or only has untracked files),
  fetches, derives a branch name (`item/<ID>-<slug>`, slug from the item's
  title if you don't give one), creates the worktree + branch off
  `origin/main`, symlinks `frontend/node_modules`,
  `capacitor-spike/node_modules` and `backend/.venv` in from the shared
  tree (so you don't reinstall anything per worktree), checks that
  `import app` in the worktree's `backend/` resolves to the worktree's own
  package rather than the shared tree's, marks the item in-progress on the
  board, and prints the worktree path plus the rules above. If `<ID>`
  isn't on the board yet, pass `--title "..."` and it runs
  `scripts/backlog.py add` first (into the section matching `<ID>`'s
  leading letter) — the id it actually uses is whatever `add` allocates,
  printed on the way past.
- `finish` runs inside the worktree: the backend test suite, then the
  frontend typecheck (not a full `npm run build` — integrate does that
  once, after merging, rather than every session building its own copy of
  the frontend). It refuses if the worktree is dirty or either check
  fails. On success it pushes the branch and calls
  `scripts/backlog.py review <ID> --branch item/<ID>-<slug>`, which is the
  new `[state: review: item/<ID>-<slug>]` tag integrate looks for.
- `abandon` deletes the worktree and its local branch and resets the item
  to to-do with a note, for a session that didn't pan out.

**Integrate** (`scripts/integrate.py`, run with `backend/.venv/bin/python`
from the shared tree):

```bash
backend/.venv/bin/python scripts/integrate.py --once
backend/.venv/bin/python scripts/integrate.py --loop 600
```

Refuses unless the shared tree is on `main` and clean apart from
untracked files, and takes a lock file so two passes never overlap. For
every board item in `review` with a branch, in id order: fetch, then
`git merge --no-ff origin/<branch>`. A conflict aborts that one merge and
blocks the item with a reason ("integration conflict with main; rebase
the branch") — a real problem for the owning session to fix, not
integrate's to solve. After a clean merge it runs the backend suite,
rebuilds the frontend and restarts `wealth-frontend` if `frontend/` or
`shared/` changed, restarts `wealth-api` (and `wealth-worker` if
`backend/app/workers` changed) if `backend/` changed, and checks both
health endpoints. Any failure there rolls the merge back
(`git reset --hard ORIG_HEAD`), restores services from the reverted tree,
and blocks the item with the first 300 characters of whatever failed — main
never sits on a broken merge waiting for someone to notice. A clean pass
pushes `main`, marks the item done with the merge commit
(`scripts/backlog.py done <ID> --merge <sha>` — `--merge` is just `--commit`
under another name for readability at the call site), deletes the remote
branch and the worktree, and moves on to the next item. It prints a merged
/ blocked / skipped summary at the end and exits non-zero only if the
shared-tree preconditions themselves failed (wrong branch, dirty tree, lock
held) — a blocked item is a normal, expected outcome, not a script failure.

`ops/integrate.service` + `ops/integrate.timer` run `--once` every 10
minutes; they are **not installed by default**. To install:

```bash
cp ops/integrate.service ops/integrate.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now integrate.timer
```

Until that's done (or in the meantime), the coordinator session can just
run `scripts/integrate.py --once` by hand after any item is sent to
review.
