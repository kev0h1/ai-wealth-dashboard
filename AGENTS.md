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

Before any UI work, read `PRODUCT.md` and `DESIGN.md`. The north star is "The Calm Cockpit": verdicts lead, colour is information, red means genuine financial risk only, and the indigo to violet gradient belongs to Penny alone.

Never patch visuals in place, and never change a production component first. Design changes are proposed to Kevin, agreed, then built.

Propose the change as two or three coded art-direction variants under `frontend/app/design/<slug>/`, registered in `frontend/app/design/page.tsx` (the `check:design-index` gate, run by `scripts/session.sh finish`, enforces that every preview directory is indexed). Variants are real coded pages, not mockups or descriptions. Commit them inside the worktree the usual way, with this file's trailer, `Co-Authored-By: Codex <noreply@openai.com>`.

Verify your own work before Kevin sees it. `/design/*` pages are auth-exempt and deep-linkable, so screenshot them with headless Chrome and read the screenshots yourself, fixing anything clipped, unreadable or off-token. Authenticated product pages cannot be screenshotted, which is the reason previews exist. On this host, Chrome clamps `--window-size` to a 500px minimum width, so use a Puppeteer viewport override for true phone widths, and pass `--virtual-time-budget=4000` so client components have hydrated before the shot is taken.

Only then finish the session so Kevin can see it for real, never block the item asking him to choose between variants he cannot open. That was the B19 mistake: blocked "awaiting Kevin's choice of plan-picker variant" with the branch still unpushed and no working link, so Kevin was sent a preview that served main's old page. The fix (H31): finish with `scripts/session.sh finish <ID> --uat-review`, which flags the branch as a design round. The coordinator's next integrate pass merges it, rebuilds UAT with your variants on it, and lands the item in the board's `uat` state with a real link on `https://uat.wealth.auriqltd.co.uk/design` instead of `done`, no blocked state involved. (If you forget the flag, integrate still catches a branch whose diff touches nothing outside `frontend/app/design/` and lands it in `uat` anyway, but flag it when you know rather than relying on that backstop.) Kevin gets a push notification with the link and reviews it on his phone from `/ops/go-live`, tapping straight into `/design` to see the variants live, not a description of them.

Kevin's choice lands on the board as `scripts/backlog.py approve <ID> "<choice>"` (or the page's Approve control in the item's uat card), which records which variant he picked as a note and reopens the item as `in-progress` with its owner unchanged and no branch recorded. Run `scripts/session.sh start <ID>` again on that same id: it now attaches to an `in-progress` item with no branch, exactly the shape `approve` leaves it in, and opens a fresh worktree for you to fold the winner in, in the shape "fold in approved <ID> variant A". (`start` still refuses an `in-progress` item that already has a branch, meaning a session is genuinely live on it, same as it always refused `blocked`/`review`/`uat`/`rejected`/`done`.)

Where a design build changes a production component, have an independent reviewer agent audit the diff against `DESIGN.md` before Kevin sees it: authenticated pages cannot be screenshotted, so code-level review is the only gate.

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
