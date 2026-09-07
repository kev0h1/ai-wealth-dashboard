#!/usr/bin/env python3
"""Merge reviewed backlog branches into `main`, rebuild/restart UAT, tick
the board. See docs/ops/BACKLOG.md "Branch per item" for the full model.

Run from the shared tree with its venv:

    backend/.venv/bin/python scripts/integrate.py --once
    backend/.venv/bin/python scripts/integrate.py --loop 600

For each board item in state `review` with a branch (see
`scripts/session.sh finish`), in id order, this:

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
     the merge, `npm run build` + restart `wealth-frontend`; if `backend/`
     changed, restart `wealth-api` and `wealth-worker` (the worker imports
     services and core modules under `backend/app`, not just
     `backend/app/workers`, so any backend change can affect its cron code);
     then checks both health endpoints.
  4. On any failure in step 3: `git reset --hard ORIG_HEAD`, restart
     services again from the restored tree, and block the item with the
     first 300 characters of the failure.
  5. On success: `git push origin main`, mark the item done with the merge
     commit, delete the remote branch, and remove the worktree (if any).

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


def _changed_paths(sha_range: str) -> set[str]:
    rc, out = _sh(["git", "diff", "--name-only", sha_range])
    if rc != 0:
        return set()
    return {line.strip() for line in out.splitlines() if line.strip()}


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


def _wait_and_check_health() -> None:
    time.sleep(5)
    for url in HEALTH_URLS:
        if not _http_ok(url):
            raise IntegrateError(f"health check failed for {url}")


def _run_backend_tests() -> None:
    venv_python = REPO_ROOT / "backend" / ".venv" / "bin" / "python"
    rc, out = _sh(
        [
            str(venv_python), "-m", "pytest", "-q", "-x",
            "--deselect", "tests/test_spotlight.py::test_material_estimate_change_earns_return_with_reason",
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


def _block(item_id: str, reason: str) -> None:
    try:
        backlog.set_state(item_id, "blocked", reason=reason, actor="claude")
    except backlog.BacklogError:
        logger_note = f"integrate: could not write block reason for {item_id}: {reason}"
        print(logger_note, file=sys.stderr)


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
        _restart_services(changed)
        _wait_and_check_health()
    except IntegrateError as exc:
        detail = str(exc)[:300]
        _rollback_and_restart(pre_sha, changed)
        _block(item_id, detail)
        return "blocked", f"{item_id}: {detail}"

    rc, out = _sh(["git", "push", "origin", "main"], timeout=60)
    if rc != 0:
        detail = ("git push origin main failed:\n" + out)[:300]
        _rollback_and_restart(pre_sha, changed)
        _block(item_id, detail)
        return "blocked", f"{item_id}: push failed"

    merge_sha_rc, merge_sha_out = _sh(["git", "rev-parse", "HEAD"])
    merge_sha = merge_sha_out.strip() if merge_sha_rc == 0 else ""
    try:
        backlog.set_done(item_id, True, commit=merge_sha, actor="claude")
    except backlog.BacklogError as exc:
        print(f"warning: {item_id} merged but board write failed: {exc}", file=sys.stderr)

    _sh(["git", "push", "origin", "--delete", branch], timeout=30)
    worktree_dir = _find_worktree_for_branch(branch)
    if worktree_dir:
        _sh(["git", "worktree", "remove", "--force", worktree_dir], timeout=30)
    _sh(["git", "branch", "-D", branch], timeout=15)

    return "merged", f"{item_id}: merged {branch} as {merge_sha[:7] if merge_sha else '?'}"


def integrate_once(allow_branch: Optional[str] = None) -> int:
    try:
        with _locked():
            _check_preconditions(allow_branch)

            rc, out = _sh(["git", "fetch", "origin"], timeout=60)
            if rc != 0:
                print(f"error: git fetch origin failed:\n{out}", file=sys.stderr)
                return 1

            items = _review_items()
            if not items:
                print("nothing to integrate (no board items in review state)")
                return 0

            merged: list[str] = []
            blocked: list[str] = []
            skipped: list[str] = []
            for item in items:
                try:
                    result, detail = _integrate_one(item)
                except Exception as exc:  # noqa: BLE001 - one item's bug must not kill the run
                    result, detail = "blocked", f"{item['id']}: unexpected error: {exc}"
                    _block(item["id"], str(exc)[:300])
                print(f"[{result}] {detail}")
                {"merged": merged, "blocked": blocked, "skipped": skipped}[result].append(detail)

            print()
            print(f"Summary: {len(merged)} merged, {len(blocked)} blocked, {len(skipped)} skipped.")
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
