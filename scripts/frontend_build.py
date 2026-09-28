#!/usr/bin/env python3
"""Atomic UAT frontend build: build in a scratch mirror of frontend/, verify
the result, swap it into `frontend/.next` with one rename, keep the previous
build for one step back. See docs/ops/BACKLOG.md "Integrate" and backlog
item H51.

Run from the shared tree with its venv:

    backend/.venv/bin/python scripts/frontend_build.py            # build, swap, restart wealth-frontend
    backend/.venv/bin/python scripts/frontend_build.py --revert   # swap the previous build back, restart
    backend/.venv/bin/python scripts/frontend_build.py --status   # show live / previous build ids

Why this exists (H51, 2026-09-17 outage): `scripts/integrate.py` used to run
`npm run build` straight into `frontend/.next`, the directory the live
`next start` (systemd `wealth-frontend`) serves from. A build that was
interrupted partway left `.next` with manifests but no `BUILD_ID`: the
running server kept serving its in-memory manifest, whose content-hashed
chunks no longer existed on disk, so `/` hydrated nothing and rendered
blank, and the restart that was meant to fix it could not boot at all
because `next start` refuses to start without `BUILD_ID`.

How it works now:

  1. Take a non-blocking lock on `frontend/.next-build.lock`. A second
     build while one is running fails loudly with FrontendBuildError; it
     never queues, because a queued build would silently rebuild and swap
     a tree that may have moved on underneath it.
  2. Mirror `frontend/` (source, public/, .env.local; not node_modules,
     .git or any .next*) into `<repo>/.frontend-staging/` with rsync,
     symlink its node_modules to the real one, and point its `.next/cache`
     at the stable `frontend/.next-cache` so Turbopack's persistent build
     cache stays warm even though every build starts from a fresh mirror.
     The mirror sits next to `frontend/` (not inside it) because
     tsconfig's `@wealth/shared` paths and the `../shared` workspace link
     resolve relative to the project directory. This is the same approach
     `frontend/scripts/build-mobile.sh` already uses for the same reason.
  3. Run `npm run build` in the mirror. It writes a completely ordinary
     `.next` there: default distDir, no config override, so nothing keyed
     to the name `.next` (tsconfig's `.next/types/**` include, the
     generated next-env.d.ts, Next's own tsconfig defaults) sees anything
     unusual, and nothing it writes lands in the shared tree. The build
     tag is precomputed from the shared tree's git and passed in as
     NEXT_PUBLIC_BUILD_TAG, because the mirror has no .git for
     next.config.ts to read (again as build-mobile.sh does). The build
     runs in its own process group; if this script is interrupted (SIGINT
     or SIGTERM), the group is killed so no orphaned `next build` keeps
     writing.
  4. Verify the mirror's `.next`: `BUILD_ID` is present and non-empty,
     and every file the build itself lists in `required-server-files.json`
     (what `next start` needs) exists. A build that fails or does not
     verify is discarded with the mirror; `frontend/.next` is never
     touched.
  5. Swap: delete the old `frontend/.next-prev`, exchange the mirror's
     `.next` with `frontend/.next` atomically via renameat2(RENAME_EXCHANGE)
     (Linux, glibc 2.28+, ext4 and other mainstream filesystems; the two
     are on the same filesystem by construction), and rename what used to
     be live to `frontend/.next-prev`. Without RENAME_EXCHANGE the fallback
     is two plain renames, which leaves `.next` absent for a few
     microseconds and is still never a half-built directory. Either way
     the live `.next` is only ever a complete, verified build. The mirror
     is then removed.
  6. The caller restarts `wealth-frontend`. Until it does, the still
     running server reads the new files through the old path, which is
     exactly the mixed state the restart ends; restart immediately.

`--revert` exchanges `.next` and `.next-prev` under the same lock, so a
build that succeeded but turned out to be bad can be backed out without
rebuilding. It is one step: reverting twice puts the bad build back.

`next start` and a moved build directory: `next start` locates the build
through the runtime next.config.ts `distDir` (default `.next`) under its
working directory and reads everything from disk; it consults the
build-time serialised config in `required-server-files.json` for one
experimental flag only, and nothing in the emitted server chunks or the
manifests `next start` reads carries the build directory's absolute path
(checked on a real build: zero occurrences under `.next/server`). A
`.next` built in the mirror and renamed under `frontend/` is therefore a
valid target, which is what this script relies on and what the H51 scratch
`next start` runs proved. The `.next/standalone` tree the build also emits
(H52) is not used by `next start` and is not required by the verification
here.
"""
from __future__ import annotations

import argparse
import ctypes
import datetime as _dt
import errno
import fcntl
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator, Optional

REPO_ROOT = Path("/root/ai-wealth-dashboard")
FRONTEND_DIR = REPO_ROOT / "frontend"

LIVE_NAME = ".next"
PREVIOUS_NAME = ".next-prev"
CACHE_NAME = ".next-cache"
LOCK_NAME = ".next-build.lock"
REVERT_TMP_NAME = ".next-revert-tmp"
# Sibling of frontend/, see step 2 in the module docstring.
STAGING_NAME = ".frontend-staging"

# 30 minutes, not integrate.py's old 900s: on 2026-09-27, with the host at a
# load average of 41 on 6 cores and 700MB free, a cold build spent 13
# minutes in the type-check step alone and was cut off by a 900s timeout
# while "Finalizing page optimization". A timeout now costs a rolled-back
# merge and a blocked item (never a broken site), so err on the long side.
BUILD_TIMEOUT_S = 1800
# Files `next start` reads before it will serve anything, beyond the
# `files` list inside required-server-files.json (which is checked too).
BASELINE_REQUIRED = (
    "BUILD_ID",
    "required-server-files.json",
    "routes-manifest.json",
    "prerender-manifest.json",
    "build-manifest.json",
    "app-path-routes-manifest.json",
    "server/app-paths-manifest.json",
    "server/pages-manifest.json",
    "server/middleware-manifest.json",
    "static",
)
# What the mirror leaves out of frontend/. Everything else (app/, lib/,
# public/, package.json, next.config.ts, tsconfig.json, .env.local, ...)
# is copied.
# No trailing slashes: an rsync pattern ending in "/" matches directories
# only, and in a scripts/session.sh worktree frontend/node_modules is a
# symlink (to the shared tree's), which would otherwise be copied as a link
# and collide with the one prepare_staging creates.
MIRROR_EXCLUDES = ("node_modules", ".git", ".next*", ".mobile-build", "out", "*.tsbuildinfo")

FRONTEND_SERVICE = "wealth-frontend"
FRONTEND_HEALTH_URL = "http://127.0.0.1:3030/"
HEALTH_TIMEOUT_S = 60
HEALTH_INTERVAL_S = 2

AT_FDCWD = -100
RENAME_EXCHANGE = 2


class FrontendBuildError(RuntimeError):
    """A build, verification, swap or lock failure. The live `.next` is
    untouched whenever this is raised from build_and_swap."""


class BuildInterrupted(FrontendBuildError):
    """Raised from the SIGTERM handler installed for the duration of the
    build, so a `kill <pid>` of this script unwinds through the same
    cleanup as Ctrl-C (Python's default SIGTERM disposition would exit
    without running `finally`, orphaning `next build` mid-write)."""


@dataclass(frozen=True)
class BuildResult:
    build_id: str
    previous_build_id: Optional[str]
    live_dir: Path
    previous_dir: Path


def staging_dir(frontend_dir: Path) -> Path:
    return frontend_dir.parent / STAGING_NAME


def staging_next(frontend_dir: Path) -> Path:
    return staging_dir(frontend_dir) / LIVE_NAME


# --- lock -------------------------------------------------------------------


@contextmanager
def build_lock(frontend_dir: Path) -> Iterator[None]:
    """Non-blocking exclusive lock on frontend/.next-build.lock. Held for
    the whole mirror-build-verify-swap (or revert). Never waits: a
    concurrent build is an error the caller must see, not a queue."""
    lock_path = frontend_dir / LOCK_NAME
    lock_path.touch(exist_ok=True)
    with open(lock_path, "a+") as fh:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise FrontendBuildError(
                f"another frontend build is already in progress (lock {lock_path} is held); "
                "refusing to queue behind it, re-run once it has finished"
            ) from None
        try:
            yield
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


# --- filesystem helpers -----------------------------------------------------


def _managed(path: Path, frontend_dir: Path) -> bool:
    """The only paths this script ever deletes or renames over: its own
    directories directly under frontend/, and the mirror directly under
    frontend/'s parent."""
    if path.parent == frontend_dir and path.name in (LIVE_NAME, PREVIOUS_NAME, REVERT_TMP_NAME):
        return True
    return path.parent == frontend_dir.parent and path.name == STAGING_NAME


def _safe_rmtree(path: Path, frontend_dir: Path) -> None:
    """Delete `path` only if _managed says it is ours. Anything else is a
    programming error, never a deletion."""
    if not _managed(path, frontend_dir):
        raise FrontendBuildError(f"refusing to delete {path}: not a managed build directory for {frontend_dir}")
    if path.is_symlink():
        path.unlink()
        return
    if path.exists():
        shutil.rmtree(path)


def _renameat2_exchange(a: Path, b: Path) -> bool:
    """Atomically exchange two paths. Returns False (having done nothing)
    when the libc or the filesystem does not support RENAME_EXCHANGE, so
    the caller can fall back to plain renames."""
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        fn = libc.renameat2
    except (OSError, AttributeError):
        return False
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    rc = fn(AT_FDCWD, os.fsencode(str(a)), AT_FDCWD, os.fsencode(str(b)), RENAME_EXCHANGE)
    if rc == 0:
        return True
    err = ctypes.get_errno()
    if err in (errno.EINVAL, errno.ENOSYS, errno.EOPNOTSUPP, errno.ENOTSUP, errno.EXDEV):
        return False
    raise OSError(err, os.strerror(err), str(a), None, str(b))


def read_build_id(dist_dir: Path) -> Optional[str]:
    try:
        value = (dist_dir / "BUILD_ID").read_text().strip()
    except OSError:
        return None
    return value or None


def verify_build_dir(dist_dir: Path) -> str:
    """Return the build id of a complete build at `dist_dir`, or raise
    FrontendBuildError naming the first thing missing."""
    if not dist_dir.is_dir():
        raise FrontendBuildError(f"{dist_dir} is not a directory")
    build_id = read_build_id(dist_dir)
    if not build_id:
        raise FrontendBuildError(f"{dist_dir}/BUILD_ID is missing or empty: the build did not finish")
    for rel in BASELINE_REQUIRED:
        if not (dist_dir / rel).exists():
            raise FrontendBuildError(f"{dist_dir}/{rel} is missing: the build did not finish")
    manifest_path = dist_dir / "required-server-files.json"
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, ValueError) as exc:
        raise FrontendBuildError(f"{manifest_path} is unreadable: {exc}") from None
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise FrontendBuildError(f"{manifest_path} lists no required files: the build did not finish")
    for rel in files:
        # Entries are relative to the project dir and start with the
        # distDir name (".next/..."); strip that first component and look
        # inside dist_dir itself, so the check is valid wherever the
        # directory currently lives.
        parts = Path(rel).parts
        inner = Path(*parts[1:]) if len(parts) > 1 else Path(rel)
        if not (dist_dir / inner).exists():
            raise FrontendBuildError(f"{dist_dir}/{inner} is listed in required-server-files.json but missing")
    return build_id


# --- build ------------------------------------------------------------------


def _kill_process_group(proc: subprocess.Popen) -> None:
    """Stop the build we started (and only it: the child is the leader of
    its own session, so its pgid is its own verified pid)."""
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + 10
    while proc.poll() is None and time.monotonic() < deadline:
        time.sleep(0.2)
    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()


@contextmanager
def _sigterm_raises() -> Iterator[None]:
    if threading.current_thread() is not threading.main_thread():
        yield
        return

    def handler(signum, frame):  # noqa: ARG001
        raise BuildInterrupted("frontend build interrupted by SIGTERM; live .next untouched")

    previous = signal.signal(signal.SIGTERM, handler)
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, previous)


def build_tag(frontend_dir: Path, now: Optional[_dt.datetime] = None) -> str:
    """The same string frontend/next.config.ts's resolveBuildTag derives
    ("build YYYY-MM-DD <sha7>", "#<n>" appended when BUILD_NUMBER is set),
    computed here from the real checkout because the mirror has no .git.
    An explicit NEXT_PUBLIC_BUILD_TAG in the environment wins, as it does
    in next.config.ts."""
    explicit = os.environ.get("NEXT_PUBLIC_BUILD_TAG")
    if explicit:
        return explicit
    date = (now or _dt.datetime.now(_dt.timezone.utc)).strftime("%Y-%m-%d")
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=frontend_dir,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=15,
        )
        sha = proc.stdout.strip()[:7] if proc.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        sha = ""
    number = os.environ.get("BUILD_NUMBER")
    return f"build {date} {sha or 'nogit'}{f' #{number}' if number else ''}"


def run_next_build(mirror: Path, frontend_dir: Path, timeout: int = BUILD_TIMEOUT_S) -> tuple[int, str]:
    """`npm run build` inside the mirror. Returns (returncode, output). If
    this process is interrupted (SIGINT, SIGTERM, or any other exception),
    the build's process group is killed before the exception propagates,
    so no orphaned `next build` keeps writing into the mirror."""
    env = dict(os.environ)
    env["NEXT_PUBLIC_BUILD_TAG"] = build_tag(frontend_dir)
    with _sigterm_raises():
        proc = subprocess.Popen(
            ["npm", "run", "build"],
            cwd=mirror,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )
        try:
            out, _ = proc.communicate(timeout=timeout)
            return proc.returncode, out
        except subprocess.TimeoutExpired:
            _kill_process_group(proc)
            out, _ = proc.communicate()
            return 124, (out or "") + f"\n[timed out after {timeout}s running npm run build]"
        except BaseException:
            _kill_process_group(proc)
            raise


def _seed_cache_from_live(frontend_dir: Path, cache: Path, log: Callable[[str], None]) -> None:
    """One-off, best effort: the first time the stable cache directory is
    created, copy the Turbopack cache out of the live `.next/cache` (a real
    directory from the in-place-build era) so the first atomic build is
    warm rather than cold. Read-only on the live tree; any failure is
    logged and ignored, a cold build is the only consequence."""
    source = frontend_dir / LIVE_NAME / "cache" / "turbopack"
    target = cache / "turbopack"
    if target.exists() or source.is_symlink() or not source.is_dir():
        return
    try:
        shutil.copytree(source, target, symlinks=True)
        log(f"seeded {target} from {source} (one-off; the live cache is not modified)")
    except Exception as exc:  # noqa: BLE001 - a missed warm cache is not a build failure
        log(f"warning: could not seed {target} from {source}: {exc}; building cold")
        shutil.rmtree(target, ignore_errors=True)


def prepare_staging(frontend_dir: Path, log: Callable[[str], None] = print) -> Path:
    """Create the mirror (step 2). Returns the mirror directory; the build
    output will be at <mirror>/.next."""
    mirror = staging_dir(frontend_dir)
    _safe_rmtree(mirror, frontend_dir)
    mirror.mkdir()
    cmd = ["rsync", "-a"]
    for pattern in MIRROR_EXCLUDES:
        cmd += ["--exclude", pattern]
    cmd += [f"{frontend_dir}/", f"{mirror}/"]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=300)
    if proc.returncode != 0:
        _safe_rmtree(mirror, frontend_dir)
        raise FrontendBuildError(f"could not mirror {frontend_dir} into {mirror}:\n{proc.stdout}")
    link = mirror / "node_modules"
    if link.is_symlink():
        link.unlink()
    link.symlink_to(frontend_dir / "node_modules", target_is_directory=True)
    cache = frontend_dir / CACHE_NAME
    if not cache.exists():
        cache.mkdir()
        _seed_cache_from_live(frontend_dir, cache, log)
    # Turbopack keeps its persistent build cache under <distDir>/cache;
    # linking it to the stable directory keeps warm builds warm even though
    # the mirror is fresh every time. `next build`'s own clean step skips
    # anything named cache, so it is never deleted by Next.
    out = mirror / LIVE_NAME
    out.mkdir()
    (out / "cache").symlink_to(cache, target_is_directory=True)
    return mirror


def swap_in(built: Path, frontend_dir: Path) -> tuple[Path, Optional[str]]:
    """Make `built` (a verified .next inside the mirror) the live `.next`,
    keeping the old live build at `.next-prev`. Returns (live_dir,
    previous_build_id)."""
    live = frontend_dir / LIVE_NAME
    previous = frontend_dir / PREVIOUS_NAME
    _safe_rmtree(previous, frontend_dir)
    if not live.exists() and not live.is_symlink():
        os.rename(built, live)
        return live, None
    previous_build_id = read_build_id(live)
    if _renameat2_exchange(built, live):
        # live is now the new build; `built` holds the old one.
        os.rename(built, previous)
    else:
        os.rename(live, previous)
        os.rename(built, live)
    return live, previous_build_id


def build_and_swap(
    frontend_dir: Path = FRONTEND_DIR,
    run_build: Callable[[Path, Path], tuple[int, str]] = run_next_build,
    log: Callable[[str], None] = print,
) -> BuildResult:
    """Mirror, build, verify, swap. Raises FrontendBuildError on any
    failure, and the live `.next` is untouched in that case. The caller
    restarts the service afterwards (see the module docstring, step 6)."""
    frontend_dir = Path(frontend_dir).resolve()
    with build_lock(frontend_dir):
        try:
            mirror = prepare_staging(frontend_dir, log)
        except OSError as exc:
            _safe_rmtree(staging_dir(frontend_dir), frontend_dir)
            raise FrontendBuildError(f"could not prepare the build mirror; live .next untouched: {exc}") from None
        built = mirror / LIVE_NAME
        log(f"building frontend in mirror {mirror} (output {built})")
        started = time.monotonic()
        try:
            rc, out = run_build(mirror, frontend_dir)
        except BaseException:
            _safe_rmtree(mirror, frontend_dir)
            raise
        if rc != 0:
            _safe_rmtree(mirror, frontend_dir)
            raise FrontendBuildError(f"frontend build failed (exit {rc}); live .next untouched:\n{out}")
        try:
            build_id = verify_build_dir(built)
        except FrontendBuildError as exc:
            _safe_rmtree(mirror, frontend_dir)
            raise FrontendBuildError(f"frontend build did not verify; live .next untouched: {exc}") from None
        log(f"frontend build {build_id} verified in {time.monotonic() - started:.0f}s, swapping into {frontend_dir / LIVE_NAME}")
        live, previous_build_id = swap_in(built, frontend_dir)
        landed = read_build_id(live)
        if landed != build_id:
            raise FrontendBuildError(
                f"after the swap {live}/BUILD_ID is {landed!r}, expected {build_id!r}; investigate before restarting"
            )
        _safe_rmtree(mirror, frontend_dir)
        log(
            f"frontend build {build_id} is live at {live}; previous build "
            f"{previous_build_id or 'none'} kept at {frontend_dir / PREVIOUS_NAME}"
        )
        return BuildResult(build_id, previous_build_id, live, frontend_dir / PREVIOUS_NAME)


def revert(frontend_dir: Path = FRONTEND_DIR, log: Callable[[str], None] = print) -> BuildResult:
    """Exchange `.next` and `.next-prev` so the previous build is live
    again. One step only: a second revert puts the reverted build back."""
    frontend_dir = Path(frontend_dir).resolve()
    with build_lock(frontend_dir):
        live = frontend_dir / LIVE_NAME
        previous = frontend_dir / PREVIOUS_NAME
        target_id = verify_build_dir(previous) if previous.exists() else None
        if not target_id:
            raise FrontendBuildError(f"no previous build to revert to at {previous}")
        current_id = read_build_id(live)
        if not live.exists():
            os.rename(previous, live)
        elif not _renameat2_exchange(previous, live):
            tmp = frontend_dir / REVERT_TMP_NAME
            _safe_rmtree(tmp, frontend_dir)
            os.rename(live, tmp)
            os.rename(previous, live)
            os.rename(tmp, previous)
        landed = read_build_id(live)
        if landed != target_id:
            raise FrontendBuildError(f"after the revert {live}/BUILD_ID is {landed!r}, expected {target_id!r}")
        log(f"reverted: build {target_id} is live at {live}; build {current_id or 'none'} kept at {previous}")
        return BuildResult(target_id, current_id, live, previous)


def status(frontend_dir: Path = FRONTEND_DIR) -> dict[str, Optional[str]]:
    frontend_dir = Path(frontend_dir).resolve()
    return {
        "live": read_build_id(frontend_dir / LIVE_NAME),
        "previous": read_build_id(frontend_dir / PREVIOUS_NAME),
        "staging": read_build_id(staging_next(frontend_dir)),
    }


# --- service restart (CLI only; integrate.py does its own) --------------------


def _http_ok(url: str) -> bool:
    try:
        proc = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", url],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=10,
        )
    except subprocess.TimeoutExpired:
        return False
    return proc.returncode == 0 and proc.stdout.strip() == "200"


def restart_frontend_service(log: Callable[[str], None] = print) -> None:
    proc = subprocess.run(
        ["systemctl", "restart", FRONTEND_SERVICE],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=60,
    )
    if proc.returncode != 0:
        raise FrontendBuildError(f"systemctl restart {FRONTEND_SERVICE} failed:\n{proc.stdout}")
    start = time.monotonic()
    while True:
        if _http_ok(FRONTEND_HEALTH_URL):
            log(f"{FRONTEND_SERVICE} restarted, {FRONTEND_HEALTH_URL} is 200 after {time.monotonic() - start:.1f}s")
            return
        if time.monotonic() - start >= HEALTH_TIMEOUT_S:
            raise FrontendBuildError(
                f"{FRONTEND_SERVICE} restarted but {FRONTEND_HEALTH_URL} did not return 200 within "
                f"{HEALTH_TIMEOUT_S}s; consider `scripts/frontend_build.py --revert`"
            )
        time.sleep(HEALTH_INTERVAL_S)


# --- CLI --------------------------------------------------------------------


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build the frontend in a scratch mirror, verify it, swap it into frontend/.next atomically, restart wealth-frontend."
    )
    parser.add_argument("--revert", action="store_true", help="Swap the previous build (.next-prev) back into .next instead of building.")
    parser.add_argument("--status", action="store_true", help="Print the live / previous / staging build ids and exit.")
    parser.add_argument(
        "--frontend-dir", type=Path, default=FRONTEND_DIR, metavar="DIR",
        help="Frontend directory to operate on (testing only; the live service is never restarted for a non-default dir).",
    )
    parser.add_argument("--no-restart", action="store_true", help="Do not restart wealth-frontend after the swap (testing only).")
    parser.add_argument("--timeout", type=int, default=BUILD_TIMEOUT_S, metavar="SECONDS", help=f"Build timeout (default {BUILD_TIMEOUT_S}).")
    args = parser.parse_args(argv)

    frontend_dir: Path = args.frontend_dir.resolve()
    if args.status:
        for key, value in status(frontend_dir).items():
            print(f"{key}: {value or '-'}")
        return 0

    is_live_tree = frontend_dir == FRONTEND_DIR.resolve()
    do_restart = not args.no_restart
    if do_restart and not is_live_tree:
        print(
            f"error: --frontend-dir {frontend_dir} is not the live tree; pass --no-restart "
            "(the live wealth-frontend service is only ever restarted for the real frontend/)",
            file=sys.stderr,
        )
        return 2

    try:
        if args.revert:
            result = revert(frontend_dir)
        else:
            result = build_and_swap(
                frontend_dir, run_build=lambda mirror, fd: run_next_build(mirror, fd, timeout=args.timeout)
            )
        if do_restart:
            restart_frontend_service()
    except FrontendBuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"live build: {result.build_id}; previous build: {result.previous_build_id or '-'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
