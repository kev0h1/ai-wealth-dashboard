#!/usr/bin/env python3
"""Merge reviewed backlog branches into `main`, rebuild/restart UAT, tick
the board. See docs/ops/BACKLOG.md "Branch per item" for the full model.

Run from the shared tree with its venv:

    backend/.venv/bin/python scripts/integrate.py --once
    backend/.venv/bin/python scripts/integrate.py --loop 600

For each board item in state `review` with a branch (see
`scripts/session.sh finish`), in id order, this:

An item a reviewer has marked `rejected` (`scripts/backlog.py reject <id>
"<reason>"`) is never a merge candidate: `_review_items()` only ever
selects items in state `review`, and a rejected item's state is
`rejected`, not `review`. Each pass still prints one `[skipped-rejected]`
line per rejected item and counts them in the summary, so a rejection
that keeps a branch out of a merge is visible in the run's own output
rather than a silent absence (see H25 — before this, a rejection that
only existed in conversation was invisible to a concurrent integrate
pass, which merged the rejected branch anyway).

  1. Warns (but does not block) if the recorded branch doesn't start with
     `feature-<ID>` for that item's id — branches are named
     `feature-<ID>[-slug]`, but a branch is merged regardless of its
     prefix (older sessions may still record `item/<ID>-<slug>`).
  2. `git merge --no-ff origin/<branch>`. On conflict: abort the merge and
     block the item with a reason instead of touching main further.
  3. Reinstalls dependencies if the merge changed a lockfile (`pip install`
     into the shared venv if `backend/requirements.txt` changed, `npm ci` in
     `frontend/` if `frontend/package-lock.json` or `package.json` changed),
     then runs the backend test suite. If `frontend/` or `shared/` changed in
     the merge, also runs `npm run -s check:design-index` and
     `npm run -s check:legal-content` (the same gate `scripts/session.sh
     finish` runs - see H23), then `npm run build` + restart
     `wealth-frontend`; if `backend/` changed, restart `wealth-api` and
     `wealth-worker` (the worker imports services and core modules under
     `backend/app`, not just `backend/app/workers`, so any backend change
     can affect its cron code); then checks both health endpoints.
  4. On any failure in step 3: `git reset --hard ORIG_HEAD`, restart
     services again from the restored tree, and block the item. The full
     failure output is logged at error level and recorded as a board note
     (up to ~1,500 characters); the `[state: blocked: ...]` tag itself only
     ever gets a single sanitised line, capped at 200 characters (see H27).
  5. On success: `git push origin main`. If the item is a design round —
     flagged explicitly via `scripts/session.sh finish <ID> --uat-review`
     (recorded on the board as the item's `uat_review` flag) or, as a
     backstop, if the merge's own diff touches only
     `frontend/app/design/` — mark it `uat` with a preview link instead of
     `done`, and push Kevin a notification through the existing FCM/APNs
     path (`app.services.notifications.notify_uat_ready`). Otherwise mark
     it done with the merge commit. Either way: delete the remote branch
     and remove the worktree (if any) — see H31.

An item already in `uat` is never a merge candidate either, for the same
reason a `rejected` one isn't: `_review_items()` only ever selects items
in state `review`.

Never runs two passes concurrently (a lock file under the repo root gates
that) and refuses outright unless the shared tree is on `main` and clean
apart from untracked files — `--allow-branch <name>` is a narrow escape
hatch for testing this script itself without a real `main` checkout.
"""
from __future__ import annotations

import argparse
import fcntl
import re
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

REPO_ROOT = Path("/root/ai-wealth-dashboard")
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services import backlog  # noqa: E402

LOCK_PATH = REPO_ROOT / ".integrate.lock"
GIT_TIMEOUT = 30
HEALTH_URLS = ["http://localhost:8000/health", "http://127.0.0.1:3030/"]
# A restart under concurrent build load can take a while to come back up
# (see F14, 2026-09-10: a single poll 5s after restart hit a non-200 because
# another integrate pass was restarting services at the same moment, and a
# perfectly good merge got reverted and blocked). Poll up to
# HEALTH_CHECK_TIMEOUT_S, sleeping HEALTH_CHECK_INTERVAL_S between attempts,
# before treating the service as genuinely down.
HEALTH_CHECK_TIMEOUT_S = 60
HEALTH_CHECK_INTERVAL_S = 2


class IntegrateError(RuntimeError):
    """Raised for a precondition failure that should stop the whole run
    (not on main, dirty tree, lock already held)."""


def _sh(cmd: list[str], cwd: Path = REPO_ROOT, timeout: int = GIT_TIMEOUT) -> tuple[int, str]:
    """Run a command, returning (returncode, combined stdout+stderr). Never
    raises for a non-zero exit — callers decide what that means."""
    try:
        proc = subprocess.run(
            cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout
        )
        return proc.returncode, proc.stdout
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
        return 124, out + f"\n[timed out after {timeout}s running {' '.join(cmd)}]"


def _id_sort_key(item_id: str) -> tuple[str, int]:
    m = re.match(r"^([A-Za-z]+)(\d+)$", item_id)
    if not m:
        return (item_id, 0)
    return (m.group(1), int(m.group(2)))


@contextmanager
def _locked() -> Iterator[None]:
    LOCK_PATH.touch(exist_ok=True)
    with open(LOCK_PATH, "a+") as fh:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise IntegrateError("another integrate run is already in progress (lock held)") from None
        try:
            yield
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


def _current_branch() -> str:
    rc, out = _sh(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if rc != 0:
        raise IntegrateError(f"git rev-parse --abbrev-ref HEAD failed:\n{out}")
    return out.strip()


def _tree_dirty_tracked_lines() -> list[str]:
    rc, out = _sh(["git", "status", "--porcelain"])
    if rc != 0:
        raise IntegrateError(f"git status failed:\n{out}")
    return [line for line in out.splitlines() if not line.startswith("??")]


def _check_preconditions(allow_branch: Optional[str]) -> None:
    branch = _current_branch()
    if branch != "main" and branch != allow_branch:
        raise IntegrateError(
            f"shared tree is on branch {branch!r}, not main "
            f"(pass --allow-branch {branch} to run this as a test, never for a real integrate)"
        )
    dirty = _tree_dirty_tracked_lines()
    if dirty:
        raise IntegrateError("shared tree has uncommitted tracked changes:\n" + "\n".join(dirty))


def _review_items() -> list[dict]:
    snapshot = backlog.load()
    items = [i for i in snapshot.items() if i.get("state") == "review" and i.get("branch")]
    items.sort(key=lambda i: _id_sort_key(i["id"]))
    return items


def _rejected_items() -> list[dict]:
    """Items a reviewer has rejected (see H25: a reviewer's rejection has
    to land on the board immediately, because `review` alone is treated as
    consent to merge by any pass, including one from a concurrent
    session). `_review_items()` above already excludes these outright — a
    rejected item's state is `rejected`, not `review` — so this is purely
    for visibility: `integrate_once` prints one of these per rejected item
    so a skip-because-rejected never reads as a silent absence."""
    snapshot = backlog.load()
    items = [i for i in snapshot.items() if i.get("state") == "rejected"]
    items.sort(key=lambda i: _id_sort_key(i["id"]))
    return items


def _changed_paths(sha_range: str) -> set[str]:
    rc, out = _sh(["git", "diff", "--name-only", sha_range])
    if rc != 0:
        return set()
    return {line.strip() for line in out.splitlines() if line.strip()}


# H31: a design round (new preview variants under frontend/app/design/ for
# Kevin to pick from, nothing else) lands in `uat` instead of `done` so it
# rebuilds UAT with a real, working preview and notifies Kevin, rather than
# the old deadlock where AGENTS.md required a working preview link before
# blocking, but the branch that would have produced it was still sitting
# unmerged (see B19). This is decided two ways: explicitly, by
# `scripts/session.sh finish <ID> --uat-review` (recorded on the board as
# the item's `uat_review` flag while it sits in `review`), or, as a
# backstop when that flag was forgotten, by DESIGN_ROUND_DIFF below over
# the merge's own changed paths.
_DESIGN_ROUND_PREFIX = "frontend/app/design/"


def _is_design_round_diff(changed: set[str]) -> bool:
    """True only when every changed path is under frontend/app/design/ — a
    branch that touches so much as one file outside that tree (a
    production component, a shared lib, a test) is never just a design
    round by this heuristic, however small the rest of the diff is; see
    AGENTS.md "Design work", which already forbids touching a production
    component from one of these branches, so a diff confined to
    frontend/app/design/ is never anything else. An empty diff (e.g. a
    merge that only touched board metadata) does not count — there is
    nothing to preview."""
    if not changed:
        return False
    return all(p.startswith(_DESIGN_ROUND_PREFIX) for p in changed)


def _design_round_preview_link() -> str:
    """The link `scripts/integrate.py` stores on a `uat` item it lands
    automatically: the public design-preview index, which lists every
    registered preview directory (the `check:design-index` gate, run
    below by `_run_frontend_checks`, guarantees every one this merge added
    is registered there). Pointing at the index rather than guessing a
    single slug is deliberate — a round can add more than one variant
    directory, and the index is always correct regardless of how many."""
    return f"https://{backlog.PUBLIC_UAT_HOST}/design"


def _notify_uat_ready(item_id: str, title: str, link: str) -> None:
    """Best-effort push to Kevin that `item_id` landed in uat, through the
    existing FCM/APNs/webpush path in app.services.notifications (see
    notify_uat_ready there for the preference gate and the owner-only
    targeting). Never allowed to fail the integrate run — a push failure
    here is logged and swallowed, same discipline as every other
    non-critical step in this script."""
    import asyncio

    from app.services.notifications import notify_uat_ready

    asyncio.run(notify_uat_ready(item_id, title, link))


def _http_ok(url: str) -> bool:
    rc, out = _sh(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", url], timeout=10)
    return rc == 0 and out.strip() == "200"


def _systemctl_restart(service: str) -> None:
    rc, out = _sh(["systemctl", "restart", service], timeout=60)
    if rc != 0:
        raise IntegrateError(f"systemctl restart {service} failed:\n{out}")


def _install_dependencies(changed: set[str]) -> None:
    """Reinstall dependencies before building/testing when the merge bumped
    a lockfile, so the shared venv / node_modules never run stale against
    the merged code (see docs/ops/BACKLOG.md "Integrate")."""
    if "backend/requirements.txt" in changed:
        print("installing backend dependencies (backend/requirements.txt changed)")
        venv_pip = REPO_ROOT / "backend" / ".venv" / "bin" / "pip"
        rc, out = _sh(
            [str(venv_pip), "install", "-q", "-r", "requirements.txt"],
            cwd=REPO_ROOT / "backend",
            timeout=900,
        )
        if rc != 0:
            raise IntegrateError(f"pip install -r requirements.txt failed:\n{out}")
    if "frontend/package-lock.json" in changed or "frontend/package.json" in changed:
        print("installing frontend dependencies (frontend/package-lock.json or package.json changed)")
        rc, out = _sh(["npm", "ci"], cwd=REPO_ROOT / "frontend", timeout=900)
        if rc != 0:
            raise IntegrateError(f"npm ci failed:\n{out}")


def _restart_services(changed: set[str]) -> None:
    frontend_or_shared = any(p == "frontend" or p.startswith("frontend/") or p == "shared" or p.startswith("shared/") for p in changed)
    backend_changed = any(p == "backend" or p.startswith("backend/") for p in changed)

    if frontend_or_shared:
        rc, out = _sh(["npm", "run", "build"], cwd=REPO_ROOT / "frontend", timeout=900)
        if rc != 0:
            raise IntegrateError(f"frontend build failed:\n{out}")
        _systemctl_restart("wealth-frontend")
    if backend_changed:
        _systemctl_restart("wealth-api")
        # wealth-worker imports services and core modules under backend/app
        # (retention, penny_tools, sync services, ...), not just
        # backend/app/workers/ itself, so any backend change can affect the
        # cron code it runs — restart it on every backend change, not just
        # a workers/ one, so cron never runs stale.
        _systemctl_restart("wealth-worker")


def _wait_for_http_ok(
    url: str,
    timeout: float = HEALTH_CHECK_TIMEOUT_S,
    interval: float = HEALTH_CHECK_INTERVAL_S,
) -> tuple[bool, float]:
    """Poll `url` until it returns 200 or `timeout` seconds have elapsed,
    sleeping `interval` seconds between attempts. Returns (ok, elapsed) so
    the caller can report how long it actually waited either way -
    distinguishing "never came up" from "one unlucky poll" is the whole
    point of retrying (see the HEALTH_CHECK_* comment above)."""
    start = time.monotonic()
    attempt = 0
    while True:
        attempt += 1
        if _http_ok(url):
            elapsed = time.monotonic() - start
            if attempt > 1:
                print(f"health check for {url} succeeded on attempt {attempt} after {elapsed:.1f}s")
            return True, elapsed
        elapsed = time.monotonic() - start
        if elapsed >= timeout:
            return False, elapsed
        print(
            f"health check for {url} not ready yet (attempt {attempt}, {elapsed:.1f}s elapsed), "
            f"retrying in {interval}s"
        )
        time.sleep(interval)


def _wait_and_check_health() -> None:
    for url in HEALTH_URLS:
        ok, elapsed = _wait_for_http_ok(url)
        if not ok:
            raise IntegrateError(
                f"health check failed for {url} after retrying for {elapsed:.1f}s "
                f"(timeout {HEALTH_CHECK_TIMEOUT_S}s, interval {HEALTH_CHECK_INTERVAL_S}s)"
            )


def _run_frontend_checks(changed: set[str]) -> None:
    """Run the same gate `scripts/session.sh finish` runs before a branch
    touching frontend/ or shared/ reaches main: the design preview index
    check and the legal-content marker/renumbering check (H23). Before H23
    neither check ran here, only in `finish` - so a merge could still reach
    main with a broken preview index or a broken privacy.md/terms.md
    contract if review bypassed or predated that gate (see F14,
    2026-09-10, which shipped a broken Section 6 cross-reference into the
    connector-off privacy policy render)."""
    frontend_or_shared = any(
        p == "frontend" or p.startswith("frontend/") or p == "shared" or p.startswith("shared/")
        for p in changed
    )
    if not frontend_or_shared:
        return
    print("checking design preview index (frontend/ or shared/ changed)")
    rc, out = _sh(["npm", "run", "-s", "check:design-index"], cwd=REPO_ROOT / "frontend", timeout=60)
    if rc != 0:
        raise IntegrateError(f"check:design-index failed:\n{out}")
    print("checking legal content marker/renumbering contract (frontend/ or shared/ changed)")
    rc, out = _sh(["npm", "run", "-s", "check:legal-content"], cwd=REPO_ROOT / "frontend", timeout=60)
    if rc != 0:
        raise IntegrateError(f"check:legal-content failed:\n{out}")


def _run_backend_tests() -> None:
    venv_python = REPO_ROOT / "backend" / ".venv" / "bin" / "python"
    rc, out = _sh(
        [
            str(venv_python), "-m", "pytest", "-q", "-x",
            "tests",
        ],
        cwd=REPO_ROOT / "backend",
        timeout=600,
    )
    if rc != 0:
        raise IntegrateError(f"backend test suite failed:\n{out}")


def _find_worktree_for_branch(branch: str) -> Optional[str]:
    rc, out = _sh(["git", "worktree", "list", "--porcelain"])
    if rc != 0:
        return None
    path: Optional[str] = None
    for line in out.splitlines():
        if line.startswith("worktree "):
            path = line.split(" ", 1)[1]
        elif line.startswith("branch ") and line.split(" ", 1)[1] == f"refs/heads/{branch}":
            return path
    return None


def _one_line_reason(text: str, cap: int = 200) -> str:
    """Collapse a possibly multi-line block reason (e.g. raw command
    output) to a single line safe for the `[state: blocked: ...]` tag:
    first non-empty line, whitespace collapsed, no `[`/`]`, capped to
    `cap` characters with an ellipsis. Thin wrapper over
    `backlog.one_line_reason` so `TodoDoc.set_state` (which sanitises
    independently — defence in depth) and this script never drift apart.
    See H27: a raw multi-line command-output reason written straight into
    the state tag corrupted the G29/G32 item lines on 2026-09-10 and
    caused a merge conflict between two coordinator sessions."""
    return backlog.one_line_reason(text, cap=cap)


def _block(item_id: str, reason: str) -> None:
    """Block `item_id` with `reason`, which may be many lines of raw
    command output. The full text is logged at error level (captured by
    journald when this runs under integrate.timer, or the terminal when
    run by hand) and, best-effort, recorded as a board note (capped at
    ~1,500 characters) — only a single sanitised line ever reaches the
    `[state: blocked: ...]` tag itself, see `_one_line_reason`."""
    full_text = reason or ""
    if full_text.strip():
        print(f"error: {item_id} blocked, full detail follows:\n{full_text}", file=sys.stderr)
    one_line = _one_line_reason(full_text)
    try:
        backlog.set_state(item_id, "blocked", reason=one_line, actor="claude")
    except backlog.BacklogError:
        logger_note = f"integrate: could not write block reason for {item_id}: {one_line}"
        print(logger_note, file=sys.stderr)
        return
    if full_text.strip():
        try:
            backlog.add_note(item_id, full_text.strip()[:1500], actor="claude")
        except backlog.BacklogError as exc:
            print(f"warning: could not add detail note for {item_id}: {exc}", file=sys.stderr)


def _rollback_and_restart(pre_sha: str, changed: set[str]) -> None:
    _sh(["git", "reset", "--hard", "ORIG_HEAD"])
    # The reset above restores requirements.txt / package-lock.json to their
    # pre-merge contents, but does not touch a venv or node_modules that
    # _install_dependencies may have already updated for the merged
    # versions — reinstall against the reverted tree so they match the
    # restored lockfiles again before restarting services.
    try:
        _install_dependencies(changed)
        _restart_services(changed)
        _wait_and_check_health()
    except IntegrateError as exc:
        print(f"warning: service restore after rollback also failed: {exc}", file=sys.stderr)


def _warn_if_branch_name_unexpected(item_id: str, branch: str) -> None:
    """Branches are named feature-<ID>[-slug] (see docs/ops/BACKLOG.md
    "Branch per item"). Older sessions may still send in item/<ID>-<slug>
    branches; either way integrate merges whatever branch is recorded on
    the item, it just warns here when the name doesn't match what that
    item's id would produce, since that's usually a copy-paste mistake
    (the wrong item's branch) rather than a naming-convention holdout."""
    expected = f"feature-{item_id}"
    if branch == expected or branch.startswith(f"{expected}-"):
        return
    print(
        f"warning: {item_id} has branch {branch!r}, which doesn't start with "
        f"{expected!r}; merging it anyway, but double-check this is the right branch",
        file=sys.stderr,
    )


def _integrate_one(item: dict) -> tuple[str, str]:
    """Returns (result, detail): result is 'merged', 'blocked', or 'skipped'."""
    item_id = item["id"]
    branch = item["branch"]
    title = item["title"]

    _warn_if_branch_name_unexpected(item_id, branch)

    rc, _ = _sh(["git", "rev-parse", "--verify", f"origin/{branch}"])
    if rc != 0:
        reason = f"branch origin/{branch} not found on remote"
        _block(item_id, reason)
        return "blocked", f"{item_id}: {reason}"

    pre_sha_rc, pre_sha_out = _sh(["git", "rev-parse", "HEAD"])
    if pre_sha_rc != 0:
        return "skipped", f"{item_id}: could not read current HEAD, skipping"
    pre_sha = pre_sha_out.strip()

    rc, out = _sh(["git", "merge", "--no-ff", f"origin/{branch}", "-m", f"integrate: {item_id} {title} ({branch})"])
    if rc != 0:
        _sh(["git", "merge", "--abort"])
        reason = "integration conflict with main; rebase the branch"
        _block(item_id, reason)
        return "blocked", f"{item_id}: merge conflict with {branch}"

    changed = _changed_paths(f"{pre_sha}..HEAD")

    try:
        _install_dependencies(changed)
        _run_backend_tests()
        _run_frontend_checks(changed)
        _restart_services(changed)
        _wait_and_check_health()
    except IntegrateError as exc:
        full_text = str(exc)
        _rollback_and_restart(pre_sha, changed)
        _block(item_id, full_text)
        return "blocked", f"{item_id}: {_one_line_reason(full_text)}"

    rc, out = _sh(["git", "push", "origin", "main"], timeout=60)
    if rc != 0:
        full_text = "git push origin main failed:\n" + out
        _rollback_and_restart(pre_sha, changed)
        _block(item_id, full_text)
        return "blocked", f"{item_id}: push failed"

    merge_sha_rc, merge_sha_out = _sh(["git", "rev-parse", "HEAD"])
    merge_sha = merge_sha_out.strip() if merge_sha_rc == 0 else ""

    # H31: a design round (flagged explicitly via `--uat-review`, or caught
    # by the backstop heuristic when that flag was forgotten) lands in
    # `uat` instead of `done` — the code is merged and UAT is rebuilt with
    # it either way, the only difference is that this is not the finished
    # implementation, just variants waiting on Kevin's choice.
    is_design_round = bool(item.get("uat_review")) or _is_design_round_diff(changed)
    if is_design_round:
        preview_link = _design_round_preview_link()
        try:
            backlog.set_uat(item_id, preview_link, actor="claude")
            landed_detail = f"landed in uat, preview {preview_link}"
        except backlog.BacklogError as exc:
            print(f"warning: {item_id} merged but board write failed: {exc}", file=sys.stderr)
            landed_detail = "landed in uat, board write failed"
        try:
            _notify_uat_ready(item_id, title, preview_link)
        except Exception as exc:  # noqa: BLE001 - a push failure must never fail the integrate run
            print(f"warning: could not notify Kevin for {item_id}: {exc}", file=sys.stderr)
    else:
        try:
            backlog.set_done(item_id, True, commit=merge_sha, actor="claude")
        except backlog.BacklogError as exc:
            print(f"warning: {item_id} merged but board write failed: {exc}", file=sys.stderr)
        landed_detail = "done"

    _sh(["git", "push", "origin", "--delete", branch], timeout=30)
    worktree_dir = _find_worktree_for_branch(branch)
    if worktree_dir:
        _sh(["git", "worktree", "remove", "--force", worktree_dir], timeout=30)
    _sh(["git", "branch", "-D", branch], timeout=15)

    return "merged", f"{item_id}: merged {branch} as {merge_sha[:7] if merge_sha else '?'} ({landed_detail})"


def integrate_once(allow_branch: Optional[str] = None) -> int:
    try:
        with _locked():
            _check_preconditions(allow_branch)

            rc, out = _sh(["git", "fetch", "origin"], timeout=60)
            if rc != 0:
                print(f"error: git fetch origin failed:\n{out}", file=sys.stderr)
                return 1

            items = _review_items()
            rejected = _rejected_items()
            for item in rejected:
                branch_note = f", branch {item['branch']}" if item.get("branch") else ""
                print(
                    f"[skipped-rejected] {item['id']}: rejected "
                    f"({item.get('reason') or 'no reason recorded'}){branch_note}, not eligible for merge"
                )

            if not items:
                if rejected:
                    print(
                        f"nothing to integrate (no board items in review state; "
                        f"{len(rejected)} item(s) rejected, not eligible)"
                    )
                else:
                    print("nothing to integrate (no board items in review state)")
                return 0

            merged: list[str] = []
            blocked: list[str] = []
            skipped: list[str] = []
            for item in items:
                try:
                    result, detail = _integrate_one(item)
                except Exception as exc:  # noqa: BLE001 - one item's bug must not kill the run
                    full_text = str(exc)
                    result = "blocked"
                    detail = f"{item['id']}: unexpected error: {_one_line_reason(full_text)}"
                    _block(item["id"], f"unexpected error: {full_text}")
                print(f"[{result}] {detail}")
                {"merged": merged, "blocked": blocked, "skipped": skipped}[result].append(detail)

            print()
            print(
                f"Summary: {len(merged)} merged, {len(blocked)} blocked, {len(skipped)} skipped, "
                f"{len(rejected)} rejected (not eligible for merge)."
            )
            return 0
    except IntegrateError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Merge reviewed backlog branches into main, rebuild/restart UAT, tick the board."
    )
    parser.add_argument("--once", action="store_true", help="Run a single pass (the default).")
    parser.add_argument("--loop", type=int, metavar="SECONDS", help="Run repeatedly, sleeping SECONDS between passes.")
    parser.add_argument(
        "--allow-branch",
        metavar="NAME",
        help="Also accept this branch as if it were main. Testing only — never use in a real integrate.",
    )
    args = parser.parse_args(argv)

    if args.loop:
        while True:
            integrate_once(allow_branch=args.allow_branch)
            time.sleep(args.loop)
    return integrate_once(allow_branch=args.allow_branch)


if __name__ == "__main__":
    raise SystemExit(main())
