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
- [ ] **A1. Title.** [owner: claude] [priority: p1] [state: in-progress] [unblocks: Q5, Q6] Description text.
  - note (2026-09-06, kevin): a note about A1.
```

- The checkbox (`[ ]` / `[x]`) carries done/not-done. A done item gets a
  trailing marker: `(done 2026-09-06, abc1234)` (the commit hash is
  optional). Marking an item done clears any state tag; reopening it
  clears the done marker and leaves the state at to do.
- `[state: in-progress]`, `[state: blocked: <reason>]`,
  `[state: review: feature-<ID>-<slug>]`, `[state: rejected: <reason>]` or
  `[state: uat: <link>]` is the workflow state. Absent means to do. It is
  meaningless once the item is done (the checkbox wins). The `review`
  state and its branch are set by `scripts/session.sh finish` and
  consumed by `scripts/integrate.py`, see "Branch per item" below.
  `in-progress` can carry its own `[branch: <name>]` tag too (H31): set
  the moment `scripts/session.sh start` creates a live worktree, so a
  second `start` on the same id can tell "a session is genuinely live on
  this" (branch recorded, refuses) apart from "approved from a uat round,
  no worktree yet" (no branch, the one case `start` now accepts besides
  `todo` — see "Branch per item" below).
- A design round never sits `blocked` waiting for Kevin to choose between
  variants he cannot open. See "Design work" in `CLAUDE.md` and
  `AGENTS.md`: build coded, linkable variants under
  `frontend/app/design/<slug>/`, then finish the session with
  `scripts/session.sh finish <ID> --uat-review` so a clean integrate pass
  lands the item in `uat` with a working link, instead of blocking it on a
  choice Kevin cannot see yet — the fix for the B19 mistake, where an item
  was blocked "awaiting Kevin's choice of plan-picker variant" with the
  branch still unpushed and no working link. See "uat state" below.
- Which skill to run for a design round (`impeccable`, `design-taste-frontend`,
  `emil-design-eng`, `web-design-guidelines`) is also part of "Design work" in
  `CLAUDE.md` / `AGENTS.md`; the item's note should record the skill used.
- `rejected` is what a reviewer sets the moment they find a defect in an
  item sitting in `review`, instead of leaving it there. `review` alone
  is treated as consent to merge by any integrate pass, including one
  from a concurrent session, so a rejection has to land on the board
  immediately, not just in conversation, or a pass can merge the very
  branch that was just rejected (this is exactly what happened to G15 on
  2026-09-10: a reviewer sent the branch back in conversation, and a
  concurrent integrate pass merged it, ticked the item done, and deleted
  the branch and worktree before the correction landed anywhere durable).
  `rejected` requires a reason, the same way `review` requires a branch.
  A rejected item keeps the branch it was rejected on in a separate
  `[branch: <name>]` tag (since the `[state: rejected: ...]` slot already
  carries the reason), so the reviewer can see which branch was refused.
  `scripts/integrate.py` never selects a `rejected` item as a merge
  candidate, `start` or `todo` moves it back out again (clearing both the
  reason and the retained branch).
- `uat` (H31) is the analogous state for a design round: a branch that
  builds new preview variants under `frontend/app/design/` and nothing
  else still gets merged and rebuilds UAT like any other item, but lands
  in `uat` instead of `done` — flagged explicitly by
  `scripts/session.sh finish <ID> --uat-review` (recorded on the item as
  `[uat-review]` while it sits in `review`, consumed the moment it lands),
  or, as a backstop when that flag was forgotten, whenever the merged
  diff touches only `frontend/app/design/`. `uat` requires a link, which
  must be on the public UAT host, `https://uat.wealth.auriqltd.co.uk`; a
  loopback link (127.0.0.1, localhost) is silently rewritten onto that
  host, any other host is rejected outright
  (`backend/app/services/backlog.py` `normalise_preview_link`) — Kevin
  opens this from his phone, a link to this VPS's loopback interface
  would be dead on arrival, exactly the B19 failure mode this state
  exists to close. Like `rejected`, a `uat` item keeps the branch that
  produced it in a separate `[branch: <name>]` tag (the `[state: uat:
  ...]` slot already carries the link), and `scripts/integrate.py` never
  selects a `uat` item as a merge candidate either — landing there is the
  point, so it can never be merged a second time. `scripts/backlog.py
  approve <ID> "<choice>"` records which variant Kevin picked as a dated
  note and moves the item back to `in-progress` with its owner UNCHANGED
  and NO branch recorded (the old one was already deleted by integrate),
  so the same agent implements the winner on a fresh branch; only valid
  on an item currently in `uat`. That in-progress-with-no-branch shape is
  what makes "the same agent implements the winner on a fresh branch"
  literally true: it is the one `in-progress` case `scripts/session.sh
  start` accepts besides `todo` (H31 "start after approve" — see "Branch
  per item" below), so nothing has to be done by hand to open the next
  worktree. Landing in `uat` also pushes Kevin a notification
  (FCM/APNs/webpush, same path as every other push) with the preview link
  in the body, gated by his own notification preference and sent only to
  him, never broadcast — see "Notification" below.
- `[owner: kevin]`, `[owner: claude]` or `[owner: codex]` says who is
  doing the work. Each agent only starts items it owns: a Claude session
  only starts `[owner: claude]` items, a Codex session only starts
  `[owner: codex]` items, and `[owner: kevin]` items are Kevin's own and
  neither agent starts them. `scripts/session.sh start` enforces this by
  reading the caller's type from the `BACKLOG_AGENT` environment variable
  (`claude` or `codex`, defaulting to `claude`) and refusing an item whose
  owner does not match, unless `--any-owner` is passed (see item H29 and
  "Branch per item" below). An agent that wants an item reassigned asks
  Kevin, or uses `scripts/backlog.py owner <id> <type>` once Kevin has
  agreed; it never reassigns another agent's item on its own.
- `[priority: p1]`, `[priority: p2]` or `[priority: p3]` is the item's
  priority. Absent means `p3`, the tag is only written for `p1`/`p2`, the
  same way `[state: ...]` is only written when the state isn't `todo`.
- `[unblocks: Q5, Q6]` names the compliance-questionnaire question ids
  this item is gating (comma-separated `Qn`). Absent or empty means the
  item doesn't unblock any question. Each named question gets an
  `unblocked_by` reverse index (`["A1", "A2"]`, sorted) computed from every
  item's `unblocks` tag, that's what the board's "Unblocked by A1, A2"
  line on a question card reads from.
- Indented `- note (date, actor): text` sub-bullets sit directly under the
  item line, oldest first.

Questions in the compliance doc keep their existing `## Qn <title>` /
`Status: <status>` shape, where status is one of `ready`, `needs-kevin`,
`blocked-deploy`, `submitted`.

## The shared library

`backend/app/services/backlog.py` is the only code that parses or writes
either file. It exposes:

- `load(todo_path=None, compliance_path=None)`, read-only snapshot with
  `.items()` and `.questions()` returning plain dicts ready to serialise.
- `set_done(item_id, done, commit=None, actor="claude")`
- `set_state(item_id, state, reason=None, branch=None, link=None, uat_review=False, actor="claude")`:
  `state` is `"todo"`, `"in-progress"` (optionally takes `branch`, see
  below), `"blocked"` (needs `reason`), `"review"` (needs `branch`),
  `"rejected"` (needs `reason`; retains the item's existing branch unless
  a different one is passed explicitly) or `"uat"` (needs `link`,
  validated/normalised by `normalise_preview_link`; retains the item's
  existing branch the same way `rejected` does). `uat_review=True` only
  does anything when `state="review"`, where it sets the item's
  `[uat-review]` flag. `"in-progress"` is the one state where `branch` is
  neither required nor retained from whatever the item had before: it is
  exactly what's passed, `None` by default — `scripts/session.sh start`
  passes the live worktree's branch the moment it creates one (H31 "start
  after approve"), and `approve` deliberately passes none, clearing
  whatever branch the item's `uat` round had (that branch was already
  deleted by integrate, so carrying it forward would be a stale
  reference, not a live one).
- `set_review(item_id, branch, actor="claude", uat_review=False)`,
  convenience wrapper over `set_state(..., "review", branch=branch,
  uat_review=uat_review)`.
- `set_rejected(item_id, reason, actor="claude")`, convenience wrapper
  over `set_state(..., "rejected", reason=reason)`, what a reviewer uses
  the moment they find a defect in an item sitting in `review`.
- `set_uat(item_id, link, actor="claude")`, convenience wrapper over
  `set_state(..., "uat", link=link)` — what `scripts/integrate.py` calls
  when it lands a design round, or what a session/Kevin calls by hand to
  retrofit an item that should have gone through this path.
- `set_approved(item_id, choice, actor="kevin")`: records `choice` as a
  dated note and calls `set_state(..., "in-progress")`, leaving `owner`
  untouched. Raises `BacklogError` if the item isn't currently in `uat`.
- `normalise_preview_link(raw)`: validates/normalises a `uat` link. A
  loopback host (127.0.0.1, localhost, 0.0.0.0, ::1, with or without a
  port) is rewritten onto `PUBLIC_UAT_HOST`
  (`uat.wealth.auriqltd.co.uk`), keeping the path/query; any other host
  raises `BacklogError`; anything that isn't a parseable URL at all raises
  too. Called both by `set_uat` above and, for defence in depth, inside
  `TodoDoc.set_state` itself, so a caller that talks to `TodoDoc` directly
  can never write a loopback link to disk either.
- `add_item(section, title, owner=None, actor="claude")`, allocates the
  next id in `section` and appends it as a new to-do item.
- `set_owner(item_id, owner, actor="claude")`
- `set_priority(item_id, priority, actor="claude")`, `priority` is `"p1"`,
  `"p2"` or `"p3"`.
- `set_unblocks(item_id, questions, actor="claude")`, `questions` is a
  list of question ids (`["Q5", "Q6"]`); an empty list clears the tag.
- `add_note(item_id, text, actor="claude")`
- `set_question_status(q_id, status, actor="kevin")`

The repo root every one of these resolves against is fixed to
`/root/ai-wealth-dashboard` (override with the `BACKLOG_ROOT` env var,
tests only) rather than derived from where this file's own checkout lives,
see "Branch per item" below for why that matters once sessions run from
git worktrees.

Every mutator writes the file atomically (temp file + rename) under an
`fcntl.flock` on `.backlog.lock` in the repo root, so two writers can
never interleave and corrupt the file. After the write lands, it runs
`git add <file>`, `git commit -m "backlog: <item> <action> by <actor>"
--author "Sorted Ops <ops@auriqltd.co.uk>" -- <file>`, then a best-effort
`git push origin HEAD` (15 second timeout). A failed commit or push is
logged and reported back as `committed: false`, but the file write itself
already happened by that point, so a flaky git command never loses an
edit, worst case, the change sits on disk uncommitted until the next
successful write or a manual `git add && git commit`.

## The CLI

```bash
backend/.venv/bin/python scripts/backlog.py list
backend/.venv/bin/python scripts/backlog.py add A "New item title" --owner claude
backend/.venv/bin/python scripts/backlog.py start <id> [--branch <name>]
backend/.venv/bin/python scripts/backlog.py block <id> "<reason>"
backend/.venv/bin/python scripts/backlog.py review <id> --branch feature-<id>-<slug> [--uat-review]
backend/.venv/bin/python scripts/backlog.py reject <id> "<reason>"
backend/.venv/bin/python scripts/backlog.py uat <id> --link <url>
backend/.venv/bin/python scripts/backlog.py approve <id> "<choice>"
backend/.venv/bin/python scripts/backlog.py todo <id>
backend/.venv/bin/python scripts/backlog.py done <id> --commit <sha>
backend/.venv/bin/python scripts/backlog.py reopen <id>
backend/.venv/bin/python scripts/backlog.py note <id> "<text>"
backend/.venv/bin/python scripts/backlog.py owner <id> kevin|claude
backend/.venv/bin/python scripts/backlog.py priority <id> p1|p2|p3
backend/.venv/bin/python scripts/backlog.py unblocks <id> Q5,Q6
backend/.venv/bin/python scripts/backlog.py status Q7 ready|needs-kevin|blocked-deploy|submitted
```

`start --branch <name>` records the branch a live worktree is attached
to (H31: `scripts/session.sh start` passes this the moment it creates
one); omit it for a plain "mark in progress" with no worktree, e.g. a
manual start from the board. This is also what `start` narrows its own
guard on: an `in-progress` item is only startable again through
`scripts/session.sh start` when it has NO branch recorded, see "Branch
per item" below.

`priority` defaults to `p3` when never set. `unblocks` takes a
comma-separated list of question ids (`Q5,Q6`); pass an empty string
(`unblocks <id> ""`) to clear it. `reject` requires a reason, use it the
moment a reviewer finds a defect in an item sitting in `review`, never
leave the item sitting in `review` while the correction happens
elsewhere, since `review` alone is treated as consent to merge by any
integrate pass, including one from a concurrent session. `review
--uat-review` flags a branch as a design round so a clean integrate pass
lands it in `uat` instead of `done` (see "uat state" above and "Branch
per item" below); normally set by `scripts/session.sh finish <ID>
--uat-review`, not called directly. `uat <id> --link <url>` moves an item
into `uat` by hand (the link is validated/normalised, see
`normalise_preview_link` above); this is what `scripts/integrate.py`
calls automatically on a clean design-round merge, use it directly only
to retrofit an item. `approve <id> "<choice>"` requires the item to
currently be in `uat`, records the choice as a note, and moves it back to
`in-progress` with its owner unchanged.

Every command takes `--actor kevin|claude` (defaults to `claude`), which
is what shows up in the commit message and any note. Sessions should
always use this instead of hand-editing `TODO.md`, a hand edit still
works (the parser tolerates it), but it skips the lock, the atomic write
and the commit, which is how the file and the git history quietly drift
apart.

This CLI's repo root is fixed to `/root/ai-wealth-dashboard` regardless of
the caller's working directory (override with `BACKLOG_ROOT`, tests only),
so it always edits the one shared board even when run from a git worktree
under `/root/worktrees/<branch>`, see "Branch per item" below.

## The page

`frontend/app/ops/go-live/page.tsx` is the same board in the browser,
split into components under `frontend/app/ops/go-live/` (`FilterBar.tsx`,
`ListView.tsx`, `BoardView.tsx`, `ItemMenu.tsx`, `ItemDetailSheet.tsx`,
`QuestionsSection.tsx`, `HeaderHero.tsx`, `Badges.tsx`) once priorities,
unblocks, filters and a kanban view made the single-file version too long.
`GET /ops/go-live` (owner-only, `backend/app/routers/ops.py`) returns the
raw markdown plus the parsed `items` (each with `priority` and
`unblocks`) and `questions` (each with `unblocked_by`) so the page never
re-parses anything itself. `POST /ops/go-live/items/{id}` accepts the
same actions as the CLI's mutators, including `priority` (body
`{priority}`), `unblocks` (body `{questions: [...]}`, `[]` clears),
`uat` (body `{link}`) and `approve` (body `{choice}`);
`POST /ops/go-live/questions/{q}` sets a question's status. Both always
attribute the write to `kevin` (the page is owner-only end to end), and
return the full refreshed GET payload plus `committed`. The page replaces
its state from that response rather than guessing, and shows a quiet
"Saved" or "Saved to file, git commit failed" line when `committed` is
false.

A sticky filter bar sits under the header: owner (All / Kevin / Claude),
priority chips (P1/P2/P3, multi-select), state chips (Open / In progress
/ Blocked / In review / Rejected / UAT / Done, "Open" means not done), a
search box, and a List/Board view toggle. All of it persists together under one
localStorage key (`wd_go_live_filters`, see `lib/goLive.ts`). The filters
apply to both views and to the questionnaire section: a question is shown
when its own status falls in the selected state chips, or, once an owner
is selected, when one of the items unblocking it (its `unblocked_by`)
has that owner, so narrowing to "Claude" still surfaces the questions his
open work is gating.

List view is the original layout (sections as collapsible cards, items as
rows) plus a priority pill and "unblocks Q5, Q6" tags on each item, and a
"Unblocked by A1, A2" line on each question card whose ids scroll to that
item's row. UAT and Rejected items are pulled out of their section into
standalone lanes pinned above the rest of the backlog (`ListView.tsx`):
"UAT, waiting on you" first, then "Rejected, needs a decision" — a design
round waiting on Kevin's choice, or a rejection, must read as something
needing attention, never blend into the ordinary per-section list, and
can't be missed the way a rejection could before H25 (one that only lived
in conversation, with no board state of its own). The item's "more
actions" menu gained "Priority" (three-way) and "Unblocks…" (a
comma-separated inline field) alongside Start/Block/Note, plus "Reject"
(shown only on an item in `review`, requires a reason, same
reason-textarea pattern as Block) and "Approve" (H31, shown only on an
item in `uat`, records which variant Kevin picked, same textarea
pattern). Board view is a kanban: columns To do / In progress / Blocked /
In review / Rejected / UAT / Done, swimlanes by section or owner (a
"Lanes: Section | Owner" switch), each lane collapsible with per-column
counts and a horizontally scrolling row of columns (the lane label stays
put). Cards show the id in mono, a two-line-clamped title, an
owner-initial chip, the priority pill, unblocks tags and a note count;
tapping one opens `ItemDetailSheet.tsx`, a popover with the same controls
as the list row (done, reopen, start, block with reason, reject with
reason on a review item, approve which variant on a uat item with a
tappable preview link, note, owner, priority, unblocks). Review, Rejected
and UAT are never drag targets: review is set automatically, rejecting
needs a reason a drag can't capture, and approving a uat item needs a
choice a drag can't capture either, so all three only ever change through
a control, same discipline as every other state change. The header hero
keeps the overall done/total count and adds five figures computed from
the whole (unfiltered) board: P1 items still open, blocked items, items
in review, rejected items, and items in uat. Rejected and UAT both read
amber everywhere on this page, the same treatment as Blocked, never red:
a rejection means a reviewer wants a decision and a uat item means Kevin
has a real page to look at, neither means anything has failed (DESIGN.md
"The Red Is Risk Rule").

## The shared working tree caveat

All sessions on the VPS work in the same checkout, so a write from the
page or the CLI is visible to every other session immediately, there is
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

- `main` is the integration branch, it is what the shared tree at
  `/root/ai-wealth-dashboard` stays checked out to, and what UAT
  (`systemctl restart wealth-*`) runs. Nothing merges into it except
  through `scripts/integrate.py`.
- `release` is the production branch. Vercel's production branch points at
  `release`. Railway (project `gleaming-miracle`, services
  `ai-wealth-dashboard` and `worker`) auto-deploys from whatever branch
  each service's dashboard has configured under Settings, Source, Branch,
  and must be set to `release` there too, one-time, by hand (H17); until
  both services are switched, every push to `main` rebuilds and restarts
  the production backend. Promoting `main` to `release` is a separate,
  deliberate step, done only via `scripts/release.py deploy` (see
  `docs/ops/RELEASE.md`), never a manual `git push`.
- A session that picks up backlog item `<ID>` works only inside a git
  worktree at `/root/worktrees/feature-<ID>[-slug]`, on a branch named
  `feature-<ID>[-slug]` (the slug is appended only when one is given or
  can be derived from the item's title; e.g. `feature-A2` or
  `feature-A2-pin-login`), created off `origin/main`. It never edits
  files in the shared tree, and never restarts a UAT service from the
  worktree, UAT only ever changes when integrate merges the branch.
  Worktrees/branches from before this convention may still exist named
  `item/<ID>-<slug>`; `scripts/session.sh list`/`abandon` still recognise
  those so they can be cleaned up, and `scripts/integrate.py` merges a
  recorded branch regardless of its prefix (it only warns if the branch
  doesn't start with `feature-<ID>` for that item's id).
- The board (`TODO.md`, `docs/compliance/...`) is edited **only** in the
  shared tree, only through `scripts/backlog.py` (unchanged from the rest
  of this doc). A worktree's own checked-out copy of those files is not
  the board, it is a stale snapshot from whenever the branch forked off
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
  fetches, derives a branch name (`feature-<ID>[-slug]`, slug from the
  item's title if you don't give one and one can be derived; omitted
  entirely if not), creates the worktree + branch off
  `origin/main`, symlinks `frontend/node_modules`,
  `capacitor-spike/node_modules` and `backend/.venv` in from the shared
  tree (so you don't reinstall anything per worktree), with `@wealth/shared`
  exempted from that symlink via `frontend/tsconfig.json` `paths`, which
  point `tsc` and Next straight at the current checkout's own `shared/src`
  so edits to a worktree's `shared/` are visible there without a reinstall,
  checks that
  `import app` in the worktree's `backend/` resolves to the worktree's own
  package rather than the shared tree's, marks the item in-progress on the
  board with the new branch recorded (`scripts/backlog.py start <ID>
  --branch feature-<ID>[-slug]`), and prints the worktree path plus the
  rules above. If `<ID>` isn't on the board yet, pass `--title "..."` and
  it runs `scripts/backlog.py add` first (into the section matching
  `<ID>`'s leading letter), the id it actually uses is whatever `add`
  allocates, printed on the way past.

  `<ID>` must already be on the board AND either `todo`, or `in-progress`
  with NO branch recorded — the latter is a narrow, deliberate addition
  (H31 "start after approve"): `approve <ID> "<choice>"` (see "uat state"
  above) moves a `uat` item back to `in-progress` with its old,
  already-deleted branch cleared, specifically so the same agent can open
  a fresh worktree for the winning variant. Without this, the whole uat
  review loop deadlocked one step after Kevin's approval — `approve` said
  "the same agent implements the winner on a fresh branch" but nothing
  could actually attach a worktree to it. An `in-progress` item that
  already HAS a branch recorded means a worktree is genuinely live on it
  (the moment `start` creates one it records that branch, as above), and
  `start` still refuses that case exactly as it did before this change —
  it is the original item H21 guard (`start` silently re-attaching to an
  already-claimed item is how stray branches happen), narrowed rather
  than weakened: only the specific "in-progress with no branch" shape was
  carved out, every other refusal (`blocked`, `review`, `uat`, `rejected`,
  `done`, `in-progress` with a branch) is unchanged, each with its own
  distinct message. The state-decision logic lives in `decide_start_state`
  in `scripts/session.sh`, exercised directly (no git, no filesystem) by
  `scripts/session-start-state.test.sh`, and end to end (real worktrees,
  a synthetic fake shared tree) by `backend/tests/test_session_start_guard.py`.
- `finish [--uat-review]` runs inside the worktree: the backend test
  suite, then the frontend typecheck (not a full `npm run build`,
  integrate does that once, after merging, rather than every session
  building its own copy of the frontend). It refuses if the worktree is
  dirty or either check fails. On success it pushes the branch and calls
  `scripts/backlog.py review <ID> --branch feature-<ID>[-slug]`, which is
  the new `[state: review: feature-<ID>[-slug]]` tag integrate looks for.
  `--uat-review` additionally passes `--uat-review` through to that call,
  flagging the branch as a design round (H31): a clean integrate pass
  lands it in `uat` instead of `done`. Pass this whenever the branch's
  only job is new preview variants under `frontend/app/design/<slug>/`
  for Kevin to choose between; see "Design work" in `CLAUDE.md` /
  `AGENTS.md`.
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
every board item in `review` with a branch, in id order: fetch, warn (but
do not block) if the recorded branch doesn't start with `feature-<ID>`
for that item's id, then `git merge --no-ff origin/<branch>` regardless:
a branch is merged whatever its name is, the check just catches likely
copy-paste mistakes early. A conflict aborts that one merge and
blocks the item with a reason ("conflict with main; merge origin/main
into the branch (do not rebase, it is already pushed) and re-run
session.sh finish"), a real problem for the owning session to fix, not
integrate's to solve. It says merge, not rebase, deliberately: by the
time an item reaches `review` its branch is already pushed to origin, so
rebasing rewrites commits the remote already has, and landing the
rebased branch again needs a force-push, which CLAUDE.md forbids; a
plain `merge origin/main` into the branch resolves the conflict with new
commits instead of rewriting old ones, so the next `session.sh finish`
push is a normal fast-forward. After a clean merge it reinstalls dependencies if the
merge changed a lockfile (`pip install -r backend/requirements.txt` into the
shared venv, `npm ci` in `frontend/`), then runs the backend suite,
rebuilds the frontend and restarts `wealth-frontend` if `frontend/` or
`shared/` changed, restarts `wealth-api` and `wealth-worker` if `backend/`
changed at all (the worker imports services and core modules under
`backend/app`, not just `backend/app/workers`, so cron code never runs
stale), and checks both health endpoints. Any failure there rolls the merge back
(`git reset --hard ORIG_HEAD`), restores services from the reverted tree,
and blocks the item; main never sits on a broken merge waiting for someone
to notice. Block and reject reasons are stored on the board as a single
sanitised line of at most 200 characters (first line only, whitespace
collapsed, no `[`/`]`), whatever the caller passed in; the full command
output goes to the integrate log at error level and to a board note
instead, so the detail is not lost, it just never corrupts the item's
one-line format (see H27). A clean pass pushes `main`, then decides
between two landings (H31): if the item's `uat_review` flag is set (from
`scripts/session.sh finish <ID> --uat-review`) or, as a backstop, if the
merge's own diff touches only `frontend/app/design/`
(`_is_design_round_diff`), it marks the item `uat` with a preview link on
`https://uat.wealth.auriqltd.co.uk/design` (`scripts/backlog.py uat <ID>
--link <url>`) and pushes Kevin a notification through the existing
FCM/APNs/webpush path (`app.services.notifications.notify_uat_ready`,
gated by his own notification preference, sent only to him). Otherwise it
marks the item done with the merge commit (`scripts/backlog.py done <ID>
--merge <sha>`, `--merge` is just `--commit` under another name for
readability at the call site). Either way it deletes the remote branch
and the worktree and moves on to the next item — a `uat` item is not
"finished" the way `done` is, but its code is already merged and its
branch already gone, same as any other clean pass. It prints a merged /
blocked / skipped summary at the end and exits non-zero only if the
shared-tree preconditions themselves failed (wrong branch, dirty tree, lock
held), a blocked item is a normal, expected outcome, not a script failure.
A `uat` item, like a `rejected` one, is never selected as a merge
candidate again (`_review_items()` only ever looks at `review` state), so
there is no risk of the same design round being merged twice.

**Notification** (H31): the push Kevin gets when an item lands in `uat`
goes through `app.services.notifications.notify_uat_ready(item_id, title,
link)`, which calls the same `send_push_to_user` every other notifier in
that module uses (APNs, FCM and web push together), gated by a
`"uat_review"` key in `NOTIF_DEFAULTS` (default on, no Settings toggle
yet, same as `connection_health`) and sent only to `PRIMARY_EMAIL` — the
account owner, never a broadcast to every allow-listed tester, since
`/ops/go-live` (where a `uat` item is reviewed) is owner-only end to end.
The preview link is in the push body and is also the tap-through URL.

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
