# AI Wealth Dashboard — Claude Instructions

## Design Context

Before any UI work, read `PRODUCT.md` (strategy: users, positioning, personality,
anti-references) and `DESIGN.md` (visual system: tokens, named rules, do's/don'ts).
North Star: "The Calm Cockpit" — verdicts lead, colour is information, red means
genuine risk only, the indigo→violet gradient belongs to Penny alone.

## Surface map (reindexed 2026-09-04 after the Codex design round)

Working tree on `docs/mobile-porting-checkpoint` carries this round uncommitted. `AGENTS.md` is Codex's own workflow file; it coexists with this file. UAT frontend listens on `http://127.0.0.1:3030`, API on `:8000`.

**Primary nav** (`frontend/components/BottomNav.tsx`, `Sidebar.tsx`): Home `/` · Spend `/spend?view=period` · Penny centre button → `/penny` · Upcoming `/upcoming` · Planning `/planning`. Sidebar adds Settings. Insights is retired: `/insights` redirects to `/spend/shape`, `/tax` and `/receipts` are their own routes.

- **Home** (`app/components/HomePage.tsx`): `SafeToSpendCard.tsx` is one hero figure + status word + a collapsible "Full calculation" ledger (cash forecast → set-asides → card position). It renders explicit error / degraded / unsupported states with a retry, never `null`. Balances default to hidden until server preferences resolve (`PreferencesContext.preferencesReady`, seeded from `localStorage` key `wd_hide_balances`). Home prefetches `/spend` and warms the verdict cache on idle.
- **Spend** (`app/components/SpendPage.tsx`, `SpendHeader.tsx`): segmented "This period | Patterns" control; Patterns keeps the charts only (`components/SpendTrends.tsx`). The period view ends on `components/SpendShapeCard.tsx` (the four-figure "How your pay was split" instrument, loaded on idle via `lib/moneyShape.ts`), which opens `/spend/shape` (`app/spend/shape/ShapePage.tsx`): the money-shape hero, what works for you, and the reference shapes, nothing else. Notable cards collapse behind "Review this spending". Savings insights annotate category cards as a "Penny noticed" callout keyed by the new `SavingsInsight.app_category`; tapping opens a read-only `InsightDetailCard` in the Penny sheet (no model call). The Out-vs-In gap line under the instrument header was removed.
- **Upcoming** (`/upcoming` renders `app/planning/PlanningPage.tsx`): this pay period only. Runway hero "Projected at payday / month end" with income folded in and its own "Full calculation" ledger, bills list, allocations as envelope rows, one-offs. `SetAsideSheet scope="upcoming"` hides the goal option. Hidden predictions live at `/upcoming/dismissed`. The amber bills-at-risk dot sits on this tab. Backend Penny action links (`services/companion.py`) now point at `/upcoming`; `HomeBrief.tsx` rewrites persisted `/planning` routes.
- **Planning** (`/planning` renders `app/planning/LongTermPlanningPage.tsx`): long horizon only: `PriorityPlan` ladder from `GET /grow` (with a "Cover this pay period" rung when the period gate is short), `DebtPosition` buckets linking to `/cards`, and long-term goals (commitments). `/grow` and `/cards` still exist as separate routes.
- **Penny**: screen keys now include `upcoming`; `lib/pennyScreenConfig.tsx` has separate `planning` and `upcoming` configs. Tutorial flows split the same way (`TutorialContext.tsx`).
- **Backend Safe-to-Spend hardening** (`routers/analytics.py`): Kenya region returns `insufficient_data` with `calculation_status: "unsupported"`; Yapily accounts are consent-filtered (`AUTHORIZED` only); same-day events walk debit-before-income; own-account moves whose destination is already in the pool are excluded (`pooled_transfers_excluded`); if any reserve lookup fails the result is `calculation_status: "degraded"` and `safe_to_spend` is clamped to ≤ 0 (fail closed). New fields: `lowest_projected_balance`, `allocations_reserved`, `allocations_count`, `unavailable_components`. `PATCH /preferences` wipes the user's whole response cache. `spend_impact.py` reads the cached Safe-to-Spend rather than recomputing, and only computes headroom on the under-usual branch. Tests: `tests/test_safe_to_spend_hardening.py`, `tests/test_spend_performance_guards.py`.
- **Design previews** added this round but NOT yet listed in `app/design/page.tsx`: `planning-plans`, `spend-penny-flow`, `upcoming-plan`.

Open after this round (see session notes, not doctrine): dead `PlansDock` / `CommitmentCards` / `computeDebtRow` / `computeGrowRow` still defined in `PlanningPage.tsx`; duplicated fetch path in `lib/useAllTransactions.ts`; DESIGN.md still describes the retired gap line, the old four-tab nav, and the old three-tile Safe-to-Spend card.

## Backlog

`TODO.md` and the Finexer compliance doc are the board: content and workflow (state, owner, notes) live in the same markdown, git is the history, and the private page `/ops/go-live` reads and writes them live. See `docs/ops/BACKLOG.md` for the full model, including the state machine (`todo` / `in-progress` / `blocked` / `review` / done) and the `add`/`review`/`todo` commands.

Nothing is worked off-board. If what you have been asked to do is not on the board, add it first (`backend/.venv/bin/python scripts/backlog.py add <section-letter> "<one-sentence title>" --owner claude`, or `scripts/session.sh start <new-id> --title "..."`), then start it. When you finish, block, or hand back an item, record it on the board in the same turn; the page at /ops/go-live is what Kevin reads, and it only knows what the board knows. Sessions do not edit TODO.md by hand.

Picking up a backlog item is branch-per-item, not "edit the shared tree directly": a session must run `scripts/session.sh start <ID>` **before touching any code**, then do all its work inside the worktree that command prints (never in `/root/ai-wealth-dashboard` itself), and never restart `wealth-api` / `wealth-worker` / `wealth-frontend` from that worktree — UAT only changes when an integrate pass merges the branch into `main`. Run `scripts/session.sh finish <ID>` once tests are green to push the branch and mark the item in review; `scripts/integrate.py` (run by the coordinator session, or the `integrate.timer` unit if installed — see `docs/ops/BACKLOG.md`) is what actually merges it, rebuilds/restarts UAT, and ticks the board. The board itself (`TODO.md`, `docs/compliance/...`) is still only ever edited from the shared tree via `scripts/backlog.py` — never from inside a worktree:

```bash
scripts/session.sh start <item-id> [slug] [--title "New item title"]
scripts/session.sh finish <item-id>
scripts/session.sh abandon <item-id>

backend/.venv/bin/python scripts/backlog.py start <item-id>
backend/.venv/bin/python scripts/backlog.py block <item-id> "<reason>"
backend/.venv/bin/python scripts/backlog.py done <item-id> --commit <sha>
backend/.venv/bin/python scripts/backlog.py priority <item-id> p1|p2|p3
backend/.venv/bin/python scripts/backlog.py unblocks <item-id> Q5,Q6
```

Items also carry `priority` (`p1`/`p2`/`p3`, defaults to `p3` when unset) and `unblocks` (the compliance-questionnaire question ids an item is gating, e.g. `Q5,Q6`); pass an empty string to `unblocks` to clear it. `/ops/go-live` shows the reverse index on each question ("Unblocked by A1, A2") and has an owner/priority/state filter bar plus a List/Board (kanban) view — see `docs/ops/BACKLOG.md`.

## Scope restriction — CRITICAL

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

Frontend runs `next start` on a production build — changes require
`cd frontend && npm run build` before restarting wealth-frontend.

Check logs with:
```bash
journalctl -u wealth-api -n 50
journalctl -u wealth-worker -n 50
```

Confirm health returns 200 before telling the user the change is live.

## Git — CRITICAL

**Never commit `backend/.env`, `backend/.session_secret`, or any file containing secrets, API keys, or tokens.**
If any secrets file is already tracked, remove it with `git rm --cached <file>` before committing.
Always verify `.gitignore` covers: `backend/.env`, `backend/.session_secret`,
`backend/.webhook_secret`, `backend/.token_key`, `backend/.vapid_private_key`.
