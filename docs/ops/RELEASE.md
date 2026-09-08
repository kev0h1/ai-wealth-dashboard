# Production release runbook

`scripts/release.py` is the only tool that touches production. Nobody
runs `railway up`, `vercel deploy`, a manual `git push` to `release`, or
sets a Railway/Vercel variable by hand: every one of those actions goes
through this script, so there is exactly one place that knows the full
precondition list and exactly one place that ever pushes to `release`.

## a) What production is

- **Vercel**: project `ai-wealth-dashboard`, production branch `release`.
  `frontend/next.config.ts`'s `/api/*` rewrite proxies to `BACKEND_URL`
  (the Railway **web** service's public URL), so the deployed app is
  same-origin with no CORS.
- **Railway**: project `gleaming-miracle`, two services,
  `ai-wealth-dashboard` (the API, `backend/Dockerfile`) and `worker` (the
  arq sync + crons process, same image, overridden start command). Both
  **must also be set to deploy from `release`**, a one-time change in
  each service's own dashboard (see the prerequisite below), because
  Railway has no separate "production branch" setting the way Vercel
  does, it deploys whatever branch its Source setting names.
- **Atlas**: MongoDB M0, shared between UAT and production today (see
  `DEPLOY.md`); **Redis**: the Railway Redis plugin, referenced by both
  services via `${{Redis.REDIS_URL}}`.

**Until both Railway services are switched to `release`, every push to
`main`, including every backlog integrate and every board commit,
rebuilds and restarts the production backend.** This is the exact
condition H17 exists to close; `scripts/release.py check` reports it as a
RED "Railway service deploys from main" item for as long as it's true.

## b) One-time prerequisites (Kevin)

1. **Railway branch switch, both services.** For `ai-wealth-dashboard`
   and again for `worker`: open the service in the Railway dashboard,
   Settings, Source, change Branch from `main` to `release`, save. Do
   this for both services, `scripts/release.py check` fails red on
   either one left on `main`.
2. **DNS for `api.wealth.auriqltd.co.uk`** (A18, currently unresolved):
   either add the A/CNAME record, or explicitly accept that production
   stays reachable only through the Vercel `/api/*` rewrite (the app
   works either way; the direct API host is only used by Capacitor
   mobile builds' `API_PUBLIC_URL`). `check` reports this AMBER, not RED,
   because the rewrite path already works.
3. **Railway and Vercel CLIs logged in on this VPS.** Both already are as
   of this writing (`railway status`, and `vercel link` from a scratch
   directory such as `/tmp/vlink`, work without a further login prompt).
   If either CLI ever needs re-authenticating, that's an interactive
   step outside this script.

## c) The release procedure

Three commands, always from `/root/ai-wealth-dashboard` on `main`, never
from a worktree (a real `deploy` refuses outside the shared tree; `check`
and `deploy --dry-run` accept `--allow-worktree` for read-only use from a
worktree, which is how this item's own author verified them):

```bash
backend/.venv/bin/python scripts/release.py check
```

Prints a red/amber/green table covering: the shared tree is on `main`,
clean, and matches `origin/main`; `scripts/env_drift.py` reports no
missing required production variable; each Railway service's deploy
branch (RED if either is still `main`); the current Vercel production
deployment's age; DNS for `api.wealth.auriqltd.co.uk` (AMBER if absent,
A18); a baseline `GET /api/health` against `https://wealth.auriqltd.co.uk`
right now; `origin/release` being an ancestor of `origin/main` (RED, and
refused, if it has diverged, this tool never force-pushes); and the MCP
connector flag being absent from both Railway and Vercel production
(RED if either has it set, per A17/F7). Exit code 1 if anything is red.

```bash
backend/.venv/bin/python scripts/release.py sync-vars NAME[,NAME...] [--from backend/.env]
```

Run this when `check`'s env-drift row lists missing required production
variables. For each name, reads the value from `--from` (default
`backend/.env`), except `APNS_AUTH_KEY` and `FCM_SERVICE_ACCOUNT_JSON`,
which are read from the gitignored files `backend/.apns_auth_key.p8` and
`backend/.fcm_service_account.json` instead (UAT falls back to those
files; Railway has no persistent filesystem, so production needs the
literal contents as the env var). Sets each name on **both** Railway
services with `railway variable set NAME=VALUE --service <service>
--skip-deploys`, value passed as one argv element, never through a shell
string, never printed. `--value NAME=VALUE` sets a fresh literal value
instead of reading one (for a value that has no UAT equivalent yet);
`--generate NAME` creates a 32-byte urlsafe token and sets that, used for
`BOT_SECRET` so production gets its own secret rather than reusing UAT's.
Prints only the names set and which services, never a value.

```bash
backend/.venv/bin/python scripts/release.py deploy
```

Runs `check` again and aborts on any red item. Records the pre-release
`origin/release` sha and each Railway service's current deployment id,
then fast-forwards production with `git push origin main:release`
(refused unless `origin/release` is an ancestor of `origin/main`, this
tool never force-pushes here, that's what `rollback` is for). Polls, up
to 15 minutes: Vercel until `vercel ls --prod` shows a Ready production
deployment newer than the push, Railway until both services' latest
deployment is `SUCCESS` at the released sha (if a service still deploys
from `main`, `deploy` treats the current `SUCCESS` deployment already at
that sha as done rather than waiting forever). Then runs smoke checks
(`/api/health` 200, `/api/subscription` 401, `/api/mcp` 404 or reports
the actual code, `/api/accounts` 401, the homepage 200 with a `<title>`,
`/terms` and `/privacy` 200), tags the released sha `release-YYYYMMDD-HHMM`,
pushes the tag, and prints a summary: tag, sha, previous release sha, the
Vercel deployment, the Railway deployment ids, and the smoke-check table.
`--dry-run` runs every precondition and prints what it would do, without
pushing, polling, or tagging anything, that's the mode this item's own
author ran for real.

## d) Rollback

```bash
backend/.venv/bin/python scripts/release.py rollback <tag-or-sha>
```

`<tag-or-sha>` must be either a `release-YYYYMMDD-HHMM` tag this tool
created, or a sha that is an ancestor of `main`, anything else is
refused. Force-with-lease pushes `release` back to that sha
(`git push --force-with-lease origin <sha>:release`, never a bare force),
then runs the same Vercel/Railway poll and smoke checks as `deploy`. Not
run as part of a normal release; use it when a `deploy` has gone out and
needs undoing.

## e) The prompt

The exact instructions to hand a session that's asked to run a
production release:

```
Deploy Sorted to production. Follow docs/ops/RELEASE.md exactly and use only scripts/release.py for every production action.

1. From /root/ai-wealth-dashboard on main, run `backend/.venv/bin/python scripts/release.py check`. If anything is red, stop and report it; do not try to work around a red item.
2. If the check lists production variables as missing, set them with `backend/.venv/bin/python scripts/release.py sync-vars <names>` from backend/.env (use `--generate BOT_SECRET` for the bot secret so production gets its own). Never print a value.
3. Run `backend/.venv/bin/python scripts/release.py deploy`. Wait for it to finish; it pushes release, waits for Vercel and Railway, runs the smoke checks and tags the release.
4. If deploy fails after the push, run `backend/.venv/bin/python scripts/release.py rollback <previous release sha printed by deploy>` and report.
5. Report: the release tag and sha, the previous release sha, the Vercel and Railway deployment ids, the smoke-check table, and any amber items from the check.

Do not run railway up, vercel deploy, git push to release, or set variables by any other means. Do not restart UAT services. Do not print secrets.
```
