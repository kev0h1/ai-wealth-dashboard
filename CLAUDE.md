# AI Wealth Dashboard: Claude Instructions

## Design Context

Before any UI work, read `PRODUCT.md` (strategy: users, positioning, personality,
anti-references) and `DESIGN.md` (visual system: tokens, named rules, do's/don'ts).
North Star: "The Calm Cockpit", verdicts lead, colour is information, red means
genuine risk only, the indigo→violet gradient belongs to Penny alone.

## Design work

Before any UI work, read `PRODUCT.md` and `DESIGN.md`. The north star is "The Calm Cockpit": verdicts lead, colour is information, red means genuine financial risk only, and the indigo to violet gradient belongs to Penny alone.

Never patch visuals in place, and never change a production component first. Design changes are proposed to Kevin, agreed, then built.

Propose the change as two or three coded art-direction variants under `frontend/app/design/<slug>/`, registered in `frontend/app/design/page.tsx` (the `check:design-index` gate, run by `scripts/session.sh finish`, enforces that every preview directory is indexed). Variants are real coded pages, not mockups or descriptions.

Verify your own work before Kevin sees it. `/design/*` pages are auth-exempt and deep-linkable, so screenshot them with headless Chrome and read the screenshots yourself, fixing anything clipped, unreadable or off-token. Authenticated product pages cannot be screenshotted, which is the reason previews exist. On this host, Chrome clamps `--window-size` to a 500px minimum width, so use a Puppeteer viewport override for true phone widths, and pass `--virtual-time-budget=4000` so client components have hydrated before the shot is taken.

Only then block the item for Kevin's choice, and the block reason must carry working preview links: one per variant, or one link plus the `?state=` values that select each variant. Never block an item asking Kevin to choose between variants that do not exist yet; that was the B19 mistake, blocking "awaiting Kevin's choice of plan-picker variant" without having built any variants, so Kevin was asked to choose between previews that did not exist. If you are not ready to show him something real, the item stays in progress, not blocked.

Kevin picks on his phone. His choice becomes a separate implementation item that folds the winning variant into the production component, in the shape "Implement approved <ID> variant A on ...".

Where a design build changes a production component, have an independent reviewer agent audit the diff against `DESIGN.md` before Kevin sees it: authenticated pages cannot be screenshotted, so code-level review is the only gate.

Copy rules apply to every user-facing string: no em dashes, British English, and the currency minus sign stays.

## Surface map (reindexed 2026-09-04 after the Codex design round)

`main` is the integration branch and what UAT runs from the shared tree; `release` is the production branch (Vercel and Railway). All work happens on `feature-<ID>[-slug]` branches in worktrees via `scripts/session.sh` and reaches `main` only through `scripts/integrate.py` (see the Backlog section below); `docs/mobile-porting-checkpoint` is retired and must not be committed to. `AGENTS.md` is Codex's own workflow file; it coexists with this file. UAT frontend listens on `http://127.0.0.1:3030`, API on `:8000`.

**Primary nav** (`frontend/components/BottomNav.tsx`, `Sidebar.tsx`): Home `/` · Spend `/spend?view=period` · Penny centre button → `/penny` · Upcoming `/upcoming` · Planning `/planning`. Sidebar adds Settings. Insights is retired: `/insights` redirects to `/spend/shape`, `/tax` and `/receipts` are their own routes.

- **Home** (`app/components/HomePage.tsx`): `SafeToSpendCard.tsx` is one hero figure + status word + a collapsible "Full calculation" ledger (cash forecast → set-asides → card position). It renders explicit error / degraded / unsupported states with a retry, never `null`. Balances default to hidden until server preferences resolve (`PreferencesContext.preferencesReady`, seeded from `localStorage` key `wd_hide_balances`). Home prefetches `/spend` and warms the verdict cache on idle.
- **Spend** (`app/components/SpendPage.tsx`, `SpendHeader.tsx`): segmented "This period | Patterns" control; Patterns keeps the charts only (`components/SpendTrends.tsx`). The period view ends on `components/SpendShapeCard.tsx` (the four-figure "How your pay was split" instrument, loaded on idle via `lib/moneyShape.ts`), which opens `/spend/shape` (`app/spend/shape/ShapePage.tsx`): the money-shape hero, what works for you, and the reference shapes, nothing else. Notable cards collapse behind "Review this spending". Savings insights annotate category cards as a "Penny noticed" callout keyed by the new `SavingsInsight.app_category`; tapping opens a read-only `InsightDetailCard` in the Penny sheet (no model call). The Out-vs-In gap line under the instrument header was removed.
- **Upcoming** (`/upcoming` renders `app/planning/PlanningPage.tsx`): this pay period only. Runway hero "Projected at payday / month end" with income folded in and its own "Full calculation" ledger, bills list, allocations as envelope rows, one-offs. `SetAsideSheet scope="upcoming"` hides the goal option. Hidden predictions live at `/upcoming/dismissed`. The amber bills-at-risk dot sits on this tab. Backend Penny action links (`services/companion.py`) now point at `/upcoming`; `HomeBrief.tsx` rewrites persisted `/planning` routes.
- **Planning** (`/planning` renders `app/planning/LongTermPlanningPage.tsx`): long horizon only: `PriorityPlan` ladder from `GET /grow`, whose rungs carry only done / active / locked states; the period-short state is spoken by the Planning hero line instead (`GrowPanel.tsx`, `period_gate.short`, "£X to cover before payday"), never as a ladder rung. Also `DebtPosition` buckets linking to `/cards`, and long-term goals (commitments). `/grow` and `/cards` still exist as separate routes.
- **Penny**: screen keys now include `upcoming`; `lib/pennyScreenConfig.tsx` has separate `planning` and `upcoming` configs. Tutorial flows split the same way (`TutorialContext.tsx`).
- **Backend Safe-to-Spend hardening** (`routers/analytics.py`): Kenya region returns `insufficient_data` with `calculation_status: "unsupported"`; Yapily accounts are consent-filtered (`AUTHORIZED` only); same-day events walk debit-before-income; own-account moves whose destination is already in the pool are excluded (`pooled_transfers_excluded`); if any reserve lookup fails the result is `calculation_status: "degraded"` and `safe_to_spend` is clamped to ≤ 0 (fail closed). New fields: `lowest_projected_balance`, `allocations_reserved`, `allocations_count`, `unavailable_components`. `PATCH /preferences` wipes the user's whole response cache. `spend_impact.py` reads the cached Safe-to-Spend rather than recomputing, and only computes headroom on the under-usual branch. Tests: `tests/test_safe_to_spend_hardening.py`, `tests/test_spend_performance_guards.py`.
- **Design previews** added this round but NOT yet listed in `app/design/page.tsx`: `planning-plans`, `spend-penny-flow`, `upcoming-plan`.

Open after this round (see session notes, not doctrine): dead `PlansDock` / `CommitmentCards` / `computeDebtRow` / `computeGrowRow` still defined in `PlanningPage.tsx`; duplicated fetch path in `lib/useAllTransactions.ts`; DESIGN.md still describes the retired gap line, the old four-tab nav, and the old three-tile Safe-to-Spend card.

## Backlog

`TODO.md` and the Finexer compliance doc are the board: content and workflow (state, owner, notes) live in the same markdown, git is the history, and the private page `/ops/go-live` reads and writes them live. See `docs/ops/BACKLOG.md` for the full model, including the state machine (`todo` / `in-progress` / `blocked` / `review` / `rejected` / done) and the `add`/`review`/`reject`/`todo` commands. `rejected` is what a reviewer sets the instant they find a defect in an item sitting in `review`, using `scripts/backlog.py reject <ID> "<reason>"` (or the Reject control on `/ops/go-live`), never by leaving it in `review` while the fix happens elsewhere: `review` alone reads as consent to merge to any integrate pass, including one from a concurrent session, so a rejection that only exists in conversation can and has been overtaken by a pass that merges the very branch just rejected (see docs/ops/BACKLOG.md for the exact 2026-09-10 incident this closes). `start` or `todo` moves an item back out of `rejected`. Codex agents follow this same board and branch-per-item workflow; their copy of it lives in `AGENTS.md`.

Nothing is worked off-board. If what you have been asked to do is not on the board, add it first (`backend/.venv/bin/python scripts/backlog.py add <section-letter> "<one-sentence title>" --owner claude`, or `scripts/session.sh start <new-id> --title "..."`), then start it. When you finish, block, or hand back an item, record it on the board in the same turn; the page at /ops/go-live is what Kevin reads, and it only knows what the board knows. Sessions do not edit TODO.md by hand.

Each agent only works items owned by its own model type. A Claude session only starts items marked `[owner: claude]`. Items marked `[owner: codex]` belong to Codex sessions, and items marked `[owner: kevin]` are Kevin's own; a Claude session does not start either, even when asked to clear the board. When adding an unplanned item, set `--owner claude` unless Kevin says otherwise. If Kevin asks for work on an item owned by another agent, say so and let him reassign it with `scripts/backlog.py owner <id> claude`; never reassign it silently. `scripts/session.sh start` enforces this: it reads the caller's model type from the `BACKLOG_AGENT` environment variable (defaulting to `claude`) and refuses to start an item whose owner does not match, unless `--any-owner` is passed.

Picking up a backlog item is branch-per-item, not "edit the shared tree directly": a session must run `scripts/session.sh start <ID>` **before touching any code**, then do all its work inside the worktree that command prints (never in `/root/ai-wealth-dashboard` itself), and never restart `wealth-api` / `wealth-worker` / `wealth-frontend` from that worktree; UAT only changes when an integrate pass merges the branch into `main`. Feature branches are named `feature-<ID>[-slug]` (the slug is appended only when one is given or can be derived from the item's title, e.g. `feature-A2` or `feature-A2-pin-login`); `scripts/session.sh start` derives the branch and worktree name (`/root/worktrees/feature-<ID>[-slug]`) from this convention, and `scripts/session.sh list`/`abandon` also still recognise the older `item/<ID>-<slug>` names for worktrees created before this convention. Run `scripts/session.sh finish <ID>` once tests are green to push the branch and mark the item in review; `scripts/integrate.py` (run by the coordinator session, or the `integrate.timer` unit if installed, see `docs/ops/BACKLOG.md`) is what actually merges it, rebuilds/restarts UAT, and ticks the board; it merges whatever branch is recorded on the item regardless of prefix, but warns if that branch doesn't start with `feature-<ID>` for the item's own id. The board itself (`TODO.md`, `docs/compliance/...`) is still only ever edited from the shared tree via `scripts/backlog.py`, never from inside a worktree:

```bash
scripts/session.sh start <item-id> [slug] [--title "New item title"]
scripts/session.sh finish <item-id>
scripts/session.sh abandon <item-id>

backend/.venv/bin/python scripts/backlog.py start <item-id>
backend/.venv/bin/python scripts/backlog.py block <item-id> "<reason>"
backend/.venv/bin/python scripts/backlog.py reject <item-id> "<reason>"
backend/.venv/bin/python scripts/backlog.py done <item-id> --commit <sha>
backend/.venv/bin/python scripts/backlog.py priority <item-id> p1|p2|p3
backend/.venv/bin/python scripts/backlog.py unblocks <item-id> Q5,Q6
```

Items also carry `priority` (`p1`/`p2`/`p3`, defaults to `p3` when unset) and `unblocks` (the compliance-questionnaire question ids an item is gating, e.g. `Q5,Q6`); pass an empty string to `unblocks` to clear it. `/ops/go-live` shows the reverse index on each question ("Unblocked by A1, A2") and has an owner/priority/state filter bar plus a List/Board (kanban) view, see `docs/ops/BACKLOG.md`.

Production releases: docs/ops/RELEASE.md, only via scripts/release.py.

## Scope restriction: CRITICAL

**Only run commands within `/root/ai-wealth-dashboard/`.**
Never kill, restart, or modify any process or file outside this directory.
Do not use broad pkill patterns that could match unrelated services.

## After every code change

Restart only the relevant service(s) using systemctl:

```bash
systemctl restart wealth-api        # after backend changes
systemctl restart wealth-worker     # after app/workers changes
systemctl restart wealth-frontend   # after `npm run build` in frontend/
sleep 5 && curl -s http://localhost:8000/health
```

Frontend runs `next start` on a production build; changes require
`cd frontend && npm run build` before restarting wealth-frontend.

Check logs with:
```bash
journalctl -u wealth-api -n 50
journalctl -u wealth-worker -n 50
```

Confirm health returns 200 before telling the user the change is live.

## Git: CRITICAL

**Never commit `backend/.env`, `backend/.session_secret`, or any file containing secrets, API keys, or tokens.**
If any secrets file is already tracked, remove it with `git rm --cached <file>` before committing.
Always verify `.gitignore` covers: `backend/.env`, `backend/.session_secret`,
`backend/.webhook_secret`, `backend/.token_key`, `backend/.vapid_private_key`.
