# Repository workflow

## Board and branches, read this before editing anything

This repository is shared with Claude sessions and with Kevin. It runs on
one board and one branch-per-item workflow, and every agent, Codex
included, follows the same rules so nobody's work collides or goes
unrecorded.

- `TODO.md` plus `docs/compliance/finexer-agent-controls-2026-09.md` are
  the board. Kevin reads it on UAT at `/ops/go-live`. Never edit those two
  files by hand; every write goes through `scripts/backlog.py` so the
  file, the page, and git history stay one thing.
- Nothing is worked off-board. If the task in front of you is not already
  on the board, add it first, then start it:
  `backend/.venv/bin/python scripts/backlog.py add <section-letter> "<one sentence title>" --owner codex`
- Each agent only works items owned by its own model type. A Codex session
  only starts items marked `[owner: codex]`. Items marked `[owner: claude]`
  belong to Claude sessions, and items marked `[owner: kevin]` are Kevin's
  own; leave both alone, even when asked to clear the board. When adding
  an unplanned item, set `--owner codex` unless Kevin says otherwise. If
  Kevin asks for work on an item owned by another agent, say so and let
  him reassign it with `scripts/backlog.py owner <id> codex`; never
  reassign it silently. `scripts/session.sh start` enforces this: set
  `BACKLOG_AGENT=codex` before calling it, and it refuses to start an item
  whose owner does not match unless `--any-owner` is passed.
- Before editing any code, start a session for the item and work only
  inside the worktree it prints: `scripts/session.sh start <ID>`. Never
  edit files in `/root/ai-wealth-dashboard` itself, that is the shared
  tree and it stays on `main`.
- Never restart `wealth-api`, `wealth-worker`, or `wealth-frontend` from a
  worktree. UAT only changes when the integrate pass merges your branch.
- Branches are named `feature-<ID>[-slug]`. `scripts/session.sh start`
  creates the branch and the worktree for you; do not name or create them
  by hand.
- Commit inside the worktree, never the shared tree, with a trailer
  `Co-Authored-By: Codex <noreply@openai.com>`.
- Finish once the backend test suite and `npx tsc --noEmit` are both
  green: `scripts/session.sh finish <ID>`. This pushes the branch and
  marks the item in review. It refuses to run if the worktree is dirty or
  either check fails, fix that first rather than forcing it through.
- `finish` and `abandon` resolve `<ID>` to a worktree through the branch
  the board records for it, never through a name match (item H85). They
  print the worktree and branch they resolved to before doing anything,
  and refuse, listing what they found, rather than guessing: when no
  worktree is on the recorded branch, when that branch is checked out
  somewhere that is not one of `<ID>`'s own worktrees, when `<ID>`
  records no branch and more than one worktree carries its id, when the
  board cannot be read at all, or when git cannot list the shared tree's
  worktrees. If you hit one of those refusals, read it: it names the
  fix, and a refusal is always a stop, never a warning it then works
  around.
- `abandon <ID> --worktree <path>` names a worktree explicitly, which is
  the way past a refused resolution. It refuses a path that is not under
  `/root/worktrees` (normalised, so `..` does not get you out), is not a
  directory, or is not a git worktree. Otherwise it removes that
  worktree, and whether it ALSO resets `<ID>` on the board depends on
  what you named. Only if the worktree is on the branch `<ID>` records
  is the item reset the way a plain `abandon` would. If it is a stale
  duplicate, another branch, an item that records no branch, or the
  board could not be read, the item is left untouched and the command
  prints the deliberate `backlog.py todo <ID>` to run if you did want it
  reset.
- The full model, and the 2026-09-18 incident behind it (a stale
  worktree resolved first, so `finish` pushed a branch that had already
  been rejected and marked the item `review` against it), is in
  `docs/ops/BACKLOG.md` under "Resolving `<ID>` to a worktree", which is
  also where the rest of the board's state machine and the `add` /
  `review` / `reject` / `uat` / `approve` commands are documented.
- `npm run build` (Turbopack) in a worktree now works unmodified:
  `frontend/next.config.ts` widens `turbopack.root` to `/root` whenever it
  detects `frontend/node_modules` is a symlink pointing outside the
  project, which only happens in the worktree layout, so the shared tree
  and every other build environment are unaffected.
- Do not merge to `main`, do not push to `main`, do not tick the item
  done, and do not run `scripts/integrate.py` yourself. A coordinator
  session, or the integrate timer, merges the branch, rebuilds UAT, and
  closes the item out.
- If work stops for any reason (blocked on Kevin, a failing check you
  can't fix, a design decision, anything), record it on the board rather
  than leaving it silent:
  `backend/.venv/bin/python scripts/backlog.py block <ID> "<reason>"`, and
  add anything else worth keeping with
  `backend/.venv/bin/python scripts/backlog.py note <ID> "<text>"`.
- If you are reviewing someone else's item and find a defect in work
  sitting in `review`, reject it immediately rather than leaving it in
  `review` while you say so elsewhere: `review` alone is treated as
  consent to merge by any integrate pass, including one from a
  concurrent session, so a rejection that only exists in conversation can
  be overtaken by a pass that merges the very branch just rejected.
  `backend/.venv/bin/python scripts/backlog.py reject <ID> "<reason>"`
  requires a reason and keeps the item's branch so the next person can
  see which one was refused. `start` or `todo` moves it back out again.
- There is also a `cancelled` state (H80): Kevin's own call that a piece
  of work should not happen at all — obsolete, superseded, or simply not
  wanted — distinct from `rejected` (a defect, fix it) and `blocked`
  (can't proceed yet). Be precise about how this is actually gated,
  because two prior correction rounds overclaimed it: `/ops/go-live`'s
  Cancel control is the genuinely **kevin-only** path, because that page
  is gated by real account-owner auth end to end and hardcodes the actor
  to `kevin` regardless of who is signed in — but that same page's
  `ItemDetailSheet` "Move to" chips (To do, In progress, Done, Blocked)
  mostly fire straight through on a cancelled item with no refusal at
  all, since the page calls the service layer directly rather than
  through the CLI's guard; accepted for To do, In progress and Blocked,
  since it is still Kevin's own tap, and `set_state` itself still carries
  no cancelled check, so a `BoardView.tsx` drag onto those columns fires
  straight through unrefused too. Done is the one exception, closed as a
  blocking defect found in the 2026-09-18 review: dragging a cancelled
  card onto Done used to fire the done action with no confirmation,
  silently clearing `item.reason` and ticking the item complete, the
  exact transition the CLI already refused. `TodoDoc.set_done` itself now
  refuses a cancelled item with no override, the same shape
  `_refuse_if_cancelled` already used on the CLI, so that one transition
  is genuinely universal rather than CLI-only, `backend/app/routers/ops.py`
  surfaces the refusal as a 4xx with the reason rather than a 500, and
  `BoardView.tsx`'s own `isValidDropTarget` refuses Done as a drop target
  for a cancelled card client-side too, so a drag never even sends the
  request. `backend/app/services/backlog.py`'s
  `TodoDoc.set_state` refuses to set this state for any CLI `--actor`
  other than `kevin` — that is a guard against forgetting, not against
  intent: nothing stops a session typing `--actor kevin` on purpose, so
  do not treat it as a hard barrier. (A `BACKLOG_AGENT` environment check
  was tried here too and removed: it broke every Codex `finish`, since
  this file has every Codex session export `BACKLOG_AGENT=codex` and
  `scripts/session.sh finish` runs the whole suite in that same
  environment, and it bought nothing besides — `env -u BACKLOG_AGENT`
  defeats it in one token.) Either way, a Codex session must never decide
  work is unnecessary and cancel it on its own, exactly the same
  restriction a Claude session has: if you believe an item should be
  cancelled, say so with a note instead —
  `backend/.venv/bin/python scripts/backlog.py note <ID> "recommend
  cancelling: <why>"` — and let Kevin run
  `backend/.venv/bin/python scripts/backlog.py cancel <ID> "<reason>"
  --actor kevin` (or use the Cancel control on `/ops/go-live`) himself.
  On the CLI, `start`, `block`, `review`, `reject`, `uat`, `todo` and
  `done` all refuse a cancelled item outright, with NO override at all —
  not a `--force` flag, which left a board commit indistinguishable from
  an ordinary start/todo with no record a cancellation was overridden or
  why. The only way out is `scripts/backlog.py uncancel <ID> "<why>"`,
  which requires a reason (like `cancel`/`reject` do), writes a dated
  note, and moves the item to `todo` — kevin-only, the same shape and the
  same honest framing as `cancel` itself: a cancellation is Kevin's own
  input, deciding a ticket should not happen, so a Codex session must not
  be the one to undo that decision either. If you meet a cancelled item,
  leave a note recommending it be reopened
  (`backend/.venv/bin/python scripts/backlog.py note <ID> "recommend
  reopening: <why>"`) and let Kevin run `uncancel` himself, rather than
  reaching for it directly. This closed a real bug where
  `scripts/session.sh finish`/`abandon` could push a cancelled item into
  review or back to to-do without anyone deciding to, and a "reject then
  start" laundering path that
  needed no flag at all. A cancelled item is closed but never counted as
  done.
- Never commit `backend/.env` or any other key/secret file. Never edit
  files outside this repository.
- Copy rules apply to every user-facing string you write: no em dashes,
  British English. Design work has its own protocol, see "Design work"
  below: propose variants, verify them yourself, only then block for
  Kevin's choice.

The exact commands, in order:

```bash
backend/.venv/bin/python scripts/backlog.py add <section-letter> "<one sentence title>" --owner codex
scripts/session.sh start <ID>
# ...edit only inside the worktree it printed, commit there...
backend/.venv/bin/python scripts/backlog.py block <ID> "<reason>"
backend/.venv/bin/python scripts/backlog.py note <ID> "<text>"
scripts/session.sh finish <ID>
```

The service-restart commands under "Review and delivery" below describe
the coordinator's role in the shared tree, not a worktree session. Do not
run `systemctl restart` from inside a worktree under any circumstance.

## Design work

Design work is currently reassigned to Claude sessions (Kevin, 2026-09-12, after a Codex-built Settings card that did not scale). This section stays live for when it returns to Codex; the protocol below, including the skill choice, is shared with `CLAUDE.md` so both agents follow one approach.

Before any UI work, read `PRODUCT.md` and `DESIGN.md`. The north star is "The Calm Cockpit": verdicts lead, colour is information, red means genuine financial risk only, and the indigo to violet gradient belongs to Penny alone.

Never patch visuals in place, and never change a production component first. Design changes are proposed to Kevin, agreed, then built.

Pick a design skill before building variants, and name it in the item's note so a rejected round can be traced to the approach that produced it:

- `impeccable`: the primary skill for a design round on this app. Its scope covers dashboards, product UI, app shells, components, forms, settings, onboarding and empty states, which is what Sorted is. Used for the Accounts redesign.
- `design-taste-frontend`: art direction when a bolder or more distinctive look is wanted. Its scope is landing pages, portfolios and redesigns, so it suits a look-and-feel round more than a settings screen.
- `emil-design-eng`: interaction and motion polish once the layout is agreed. Used for the surface and glow system.
- `web-design-guidelines`: the final gate, an accessibility and guidelines audit run before Kevin sees anything, alongside (not instead of) the independent reviewer agent below.

A skill supplements `PRODUCT.md` and `DESIGN.md`, it never overrides them: the Calm Cockpit north star and DESIGN.md's named rules win on any conflict, including when a skill suggests something bolder or more decorative.

Propose the change as two or three coded art-direction variants under `frontend/app/design/<slug>/`, registered in `frontend/app/design/page.tsx` (the `check:design-index` gate, run by `scripts/session.sh finish`, enforces that every preview directory is indexed). Variants are real coded pages, not mockups or descriptions. Commit them inside the worktree the usual way, with this file's trailer, `Co-Authored-By: Codex <noreply@openai.com>`.

Verify your own work before Kevin sees it. `/design/*` pages are auth-exempt and deep-linkable, so screenshot them with headless Chrome and read the screenshots yourself, fixing anything clipped, unreadable or off-token. Authenticated product pages cannot be screenshotted, which is the reason previews exist. On this host, Chrome clamps `--window-size` to a 500px minimum width, so use a Puppeteer viewport override for true phone widths, and pass `--virtual-time-budget=4000` so client components have hydrated before the shot is taken.

Only then finish the session so Kevin can see it for real, never block the item asking him to choose between variants he cannot open. That was the B19 mistake: blocked "awaiting Kevin's choice of plan-picker variant" with the branch still unpushed and no working link, so Kevin was sent a preview that served main's old page. The fix (H31): finish with `scripts/session.sh finish <ID> --uat-review`, which flags the branch as a design round. The coordinator's next integrate pass merges it, rebuilds UAT with your variants on it, and lands the item in the board's `uat` state with a real link on `https://uat.wealth.auriqltd.co.uk/design` instead of `done`, no blocked state involved. (If you forget the flag, integrate still catches a branch whose diff touches nothing outside `frontend/app/design/` and lands it in `uat` anyway, but flag it when you know rather than relying on that backstop.) Kevin gets a push notification with the link and reviews it on his phone from `/ops/go-live`, tapping straight into `/design` to see the variants live, not a description of them.

Kevin's choice lands on the board as `scripts/backlog.py approve <ID> "<choice>"` (or the page's Approve control in the item's uat card), which records which variant he picked as a note and reopens the item as `in-progress` with its owner unchanged and no branch recorded. Run `scripts/session.sh start <ID>` again on that same id: it now attaches to an `in-progress` item with no branch, exactly the shape `approve` leaves it in, and opens a fresh worktree for you to fold the winner in, in the shape "fold in approved <ID> variant A". (`start` still refuses an `in-progress` item that already has a branch, meaning a session is genuinely live on it, same as it always refused `blocked`/`review`/`uat`/`rejected`/`done`.)

Where a design build changes a production component, have an independent reviewer agent audit the diff against `DESIGN.md` before Kevin sees it: authenticated pages cannot be screenshotted, so code-level review is the only gate.

A preview may hand-author markup while exploring variants, since no production component exists yet to render. Once Kevin picks and the pick is implemented, the preview for that surface must import and render the production component, supplying fixture data through its real props, the way `cover-plan-sources-scale` renders `CoverPlanSourcesCard`. A preview that still reimplements a shipped component's markup is not a gate, it cannot detect the shipped code drifting from what Kevin approved; that is how G48 shipped without the Lead row and bank-icon gating every variant showed, because `home-brief-cards` never imported `HomeBrief.tsx`. If review finds a preview that is a copy, say the visual verification is absent, do not report its screenshots as evidence. Exception: a component that fetches its own data instead of taking it as props cannot be dropped into an unauthenticated preview without mocking that fetch or refactoring the component first; when that is out of scope, say so rather than quietly rendering a fork.

Copy rules apply to every user-facing string: no em dashes, British English, and the currency minus sign stays.

## Review and delivery

- The root agent owns product intent, architecture, acceptance criteria, integration, final review, and all shared-state actions.
- Use a frontier model for planning, financial-product logic, UX judgment, security review, and final synthesis.
- Delegate only bounded, independent workstreams with explicit file scope and acceptance criteria. Use balanced coding models for normal implementation and efficient models for narrow tests, documentation, or mechanical edits.
- Preferred routing in the current Codex model family: `gpt-5.6-sol` at high/xhigh for orchestration and high-stakes review, `gpt-5.6-terra` at medium/high for implementation, and `gpt-5.6-luna` at low/medium for narrow mechanical work. Use at most the independent workstreams the task actually needs.
- Do not delegate deterministic shell work. The root agent runs searches, file inspection, builds, tests, Git operations, and service commands directly.
- After verified code changes, use the repository/deployment-supported restart path for every affected running service, then check service status and relevant health endpoints. Do not restart unrelated services. If restart requires elevated access, request it explicitly.
- On this host the supported running services are `wealth-api.service`, `wealth-frontend.service`, and `wealth-worker.service`. Restart only affected units with `systemctl restart`; verify them with `systemctl is-active`, API `GET http://127.0.0.1:8000/health`, and an HTTP 200 from the affected frontend route on `http://127.0.0.1:3030`. Backend API/service changes affect `wealth-api`; frontend production-build changes affect `wealth-frontend`; do not restart the worker unless worker-consumed code changed.
- Avoid parallel edits to the same files. Review delegated work before integration.
- For review, diagnosis, and planning, inspect and report without unrelated edits. For an explicitly requested fix or build, implement in-scope changes and verify them.

## Product-quality review

- Review UX and accessibility together with frontend and backend correctness, security, and performance.
- Financial figures must visibly reconcile. Never hide a meaningful sign, and distinguish balances, cash flows, forecasts, buffers, commitments, allocations, and card reserves.
- Prefer plain-language labels and progressive disclosure over compressed financial equations.
- Check mobile and desktop layouts, light and dark themes, loading/empty/stale/error states, keyboard behavior, screen-reader semantics, colour contrast, and tap targets.
- Keep security and performance findings tied to the feature path under review unless the user explicitly requests an application-wide audit.

## Screenshot workflow

- User-provided review images are stored in `/root/codex-images` (`~/codex-images`).
- Inspect images at original detail and compare them with the implementation.
- After completing the review, delete only the image files that were reviewed, then verify the folder state and tell the user what was removed.
