# Host budget (the UAT VPS)

One VPS runs UAT (`wealth-api`, `wealth-worker`, `wealth-frontend`, mongod)
and every agent session. Closing the gap between what it has and what we ask
of it is why these rules exist (H95, H99).

## The budget

- 12 GB RAM, **no swap**. Anything over budget is OOM-killed, not slowed.
- Baseline before any agent work: UAT services and mongod are modest
  (a few hundred MB each). Resident Claude sessions are the big item, 300 MB
  to 1 GB each; 20+ of them (many days old) have held 6 to 9 GB.
- A `next build` peaks around 1.5 GB (it also reserves ~36 GB of virtual
  address space, which is harmless without swap but looks alarming in `ps`).
- The backend test suite uses about 1 GB.
- Thresholds enforced in code (available memory, from `/proc/meminfo`):
  - 2500 MB to start a frontend build (`scripts/frontend_build.py`, also
    waited for by `scripts/integrate.py`). Override with
    `FRONTEND_BUILD_MIN_AVAILABLE_MB` or `--min-available-mb`.
  - 1500 MB to run the backend suite or the frontend checks
    (`scripts/session.sh finish`, and integrate before its suite).

## Rules

1. **One build at a time** across all sessions. `frontend_build.py` holds a
   non-blocking lock on `frontend/.next-build.lock`; a second build fails
   loudly instead of queuing.
2. **At most three agents at once**, and only one of them building or running
   the full suite.
3. Check before launching anything heavy:
   `backend/.venv/bin/python scripts/host_memory.py` (available MB and the
   largest processes) or `--require <MB>` (exit 1 with a reason).
4. Commit after every logical step, so a kill loses one step, not a task.
5. Never set `NODE_OPTIONS` tricks to squeeze a build under the line; wait
   for memory instead.

## Finding and closing stale sessions

```bash
backend/.venv/bin/python scripts/host_memory.py --stale-sessions 48
```

Lists Claude session processes older than 48 hours with pid, age and RSS.
It **never kills anything**. Agents must not close sessions either: they are
other people's (or Kevin's) work. Kevin reviews the list and closes idle
sessions from the terminal that owns them, or with `kill <pid>` once he has
confirmed the pid is not the session he is typing in. The listing excludes
only its own process, so check the ages against what you know is live.

## Reading a failed build

`frontend_build.py` reports an out-of-memory kill explicitly:

- `refusing to build: X MB available, need Y MB` (the gate, nothing started)
- `build killed, out of memory (X MB available at start; ...)` (exit 137 /
  SIGKILL, a trailing `Killed` line, or an "Out of memory" kernel line)

Integrate puts that text verbatim in the item's block reason. Neither is a
code fault: free memory and re-run, do not "fix" the branch.

## Incidents

- **2026-09-28, session killed (H95).** Seven agents ran builds and suites in
  parallel on a box with ~800 MB free. The kernel OOM-killed a `next build`
  at 07:09 and the agent session itself at 07:13, losing every agent's
  uncommitted work (H51 lost a 612-line module twice, G159 lost its review
  fixes). Fix: the rules above, the memory gate, the stale-session lister.
- **2026-09-29, empty build failures (H99).** Four `next build` processes
  were OOM-killed between 12:00 and 12:17 while 23 Claude processes held
  8.6 GB. Integrate reported "frontend build failed:" with an empty body
  and wrongly blocked D7, A121 and G157. A121's own worktree built cleanly.
  Fix: OOM detection and reporting in `frontend_build.py`, verbatim
  surfacing in `integrate.py`, memory gates before builds and suites.

## Re-pinning the database guard hashes

`scripts/check_db_guard.py --print-hashes` is the only route to re-pin the
guard hashes after a deliberate change to a database-drop guard, and the
re-pin must land in the same commit as that change (and any weakening needs
Kevin's agreement), see `docs/ops/INCIDENTS.md`.

## Finexer consent reconciliation (A156)

Before A157 revokes silently did nothing, and before A106 a failed revoke lost
its record, so Finexer may hold authorized consents we no longer know about.
`backend/scripts/finexer_reconcile_consents.py` lists every consent
(`GET /consents`, following `paging.next`) and compares it with the local
`finexer_consents` collection. UAT and production share one Finexer account, so
a customer unknown to the database being checked is reported as "other
environment" and never touched; each environment's run only acts on its own
users.

1. Dry run (default, read-only GETs): `cd backend && .venv/bin/python scripts/finexer_reconcile_consents.py --env-file .env`.
   Production: add `--mongo-uri <production Atlas URI> --db wealth`.
2. Review `/tmp/finexer-reconcile-<date>.json`: orphans (authorized at Finexer,
   no local doc), stale local, matched, other environment (count only), pending
   (ages; Finexer auto-cancels after 7 days). Users appear as sha256 hashes.
3. Apply only after Kevin says so: add `--apply --yes [--limit N]`. Orphans are
   revoked through `revoke_finexer_consent` (rate limited, failures leave an A106
   marker, each confirmed by a GET); stale local docs are flipped to revoked and
   stale local pending docs to canceled. Nothing is cancelled at Finexer. The
   production run needs the production Mongo URI with write access for the local
   flips and is run by Kevin or the coordinator.
4. Repeat monthly until the A106 pending count (admin sync stats) stays at 0.
