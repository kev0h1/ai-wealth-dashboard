# Incidents

Short records of things that went wrong, what was done, and the rule that
came out of it. Newest first.

## 2026-09-28: the real UAT database `wealth` was dropped by a review probe (H96)

**Impact.** The UAT Mongo database `wealth` was dropped at 08:55:45 BST.
Restored from the 03:15 backup; everything written between 03:15 and 08:55
is gone (four or five account records and their synced transactions, plus any
tester activity). `response_cache` came back empty (its entries had
TTL-expired) and regenerates on demand.

**Sequence.**
1. H90 introduced per-run test databases (`wealth_test_<epoch>_<hex>`) and a
   guard in `backend/tests/conftest.py`, `_looks_like_a_test_database`,
   refusing any other database name.
2. The independent reviewer for H90 wanted to prove the guard's regression
   coverage. It mutated the guard to accept the literal name `wealth`, then
   ran `MONGO_DB=wealth pytest` against the real database to see whether
   anything refused.
3. Nothing did: the guard had no unit test, and the same mutated guard also
   gated the session-end teardown, which called `drop_database` on whatever
   name the guard accepted.
4. mongod logged `dropDatabase wealth` at 08:55:45. The running `wealth-api`
   and `wealth-worker` recreated an empty shell (indexes, cron tasks).

**Recovery.** `mongorestore --drop --nsInclude='wealth.*'` from
`backups/wealth_20260928_031502.archive.gz` (written by
`scripts/backup_mongo.sh`): 6156 documents, 71 collections, 0 failed,
about 09:20. Services stayed healthy, no restart needed.

**Root causes.** (1) The guard shipped with no unit test. (2) One check was
the only check on a destructive path, and it lived in a file a reviewer was
free to edit. (3) A brief allowed a guard to be probed by running the guarded
path against the protected resource. (4) Backups are daily, so the loss
window is up to 24 hours (a cadence decision, tracked on H96).

**What changed (H95's branch closes the engineering half of H96).**
- A second, independent guard in application code: `backend/app/db/guard.py`.
  A database may only be dropped if its name matches
  `^wealth_test_[A-Za-z0-9_]+$`, unless `ALLOW_DROP_PROD_DB=1` is set **and**
  the name is passed twice. The refusal is a static error that does not echo
  the name. The app's own Mongo client refuses `drop_database` through it, and
  the test session's teardown and stale sweep drop through
  `guarded_drop_database`.
- `scripts/check_db_guard.py`, run by `scripts/session.sh finish`, pins a hash
  of every guard function in both places and fails the finish if either was
  edited or removed, or if a raw `drop_database` / `drop_collection` appears
  in app code or the conftest. Re-pinning on a deliberate change is explicit,
  in the same commit, and needs Kevin's agreement for any weakening.
- Unit tests (`backend/tests/test_db_guard.py`) call the guard functions
  directly with fake names and prove the check script fails on a mutated copy
  in a temp directory.

**Rule: probe guards by direct call only.** To test a safety guard, call the
guard function with fake inputs, or mutate a copy under `/tmp` and call it
there. Never mutate a guard in the tree, and never run the suite, a script
or any destructive path against a real database to see whether it refuses.
Never set `MONGO_DB=wealth`. Reviewer and builder briefs carry this rule.

## H117: /dev/null replaced by a regular file (2026-10-15)

**Symptom.** About 23:24 BST on 2026-10-15, during the G278 integrate test
phase, /dev/null on the UAT VPS became a regular file. Kevin restored it on
2026-10-16.

**Restore (run as root, outside any worktree).**

    rm -f /dev/null && mknod -m 666 /dev/null c 1 3

**Root cause: not found in the repo.** The mechanism is certain, the culprit
is not. Anything that renames or recreates a path onto /dev/null (temp file
plus `os.replace`/`mv`, `sed -i`, `npm`'s write-file-atomic, `cp -f`, an
`rm` followed by a `> /dev/null` redirect, which recreates a plain file)
turns the device node into a regular file. Ruled out, with evidence:
- No code in `scripts/`, `backend/`, `frontend/scripts`, `codemagic.yaml`
  or `docs/ops` assigns "/dev/null" or `os.devnull` to a write target; every
  hit is a `>/dev/null`, `curl -o /dev/null`, or `subprocess.DEVNULL`.
- The full backend suite (4892 tests, the integrate test phase's own
  command) ran under `strace -f -P /dev/null` for unlink, rename, mknod,
  link, symlink, truncate and chmod: zero such syscalls on /dev/null.
- The G278 diff (reparse script, `pdf.py`, tests) writes nothing outside
  temp paths; `npm ci` ran in that pass (package.json changed) and
  `frontend_build.py` only renames build directories under `_managed()`.
- The strace evidence covers the backend suite only. It does not cover
  `npm ci`, `frontend_build.py` or `session.sh`, which were not traced.
- The 23:24 time came with the report, not from a trace. If it was a file
  mtime or ctime on the replacement file, any later `> /dev/null` redirect
  would have overwritten it, so it is a lower bound at best. Nothing on the
  host was kept from before Kevin's restore.

Candidates outside the repo (unverified): a root shell `mv X /dev/null` or
`sed -i` on /dev/null run by an agent; a tar or rsync extraction with
overwrite from a tree that contains `dev/null`; a Docker bind mount of
/dev/null; an npm logs-dir or similar tool writing to it.

**Recommended watch (Kevin's root-level call).** `auditctl -w /dev -p wa`.
Watch the directory, not the file, because the replacement swaps the inode
and a watch on the old inode would go blind. The audit log then names the
process that did it.

**Fix (defence in depth).**
- `backend/app/core/safe_write.py`: `refuse_special_target` and
  `atomic_write_text` refuse a target that is a device, socket, fifo or
  resolves to `os.devnull`. The board's `_atomic_write`
  (`backend/app/services/backlog.py`) now uses it.
- The same check, inlined, in `backend/fuel_finder_collector.py`
  (`_atomic_write`, ships alone to the droplet) and before the `mv` in
  `scripts/refresh_fuel_cache.sh`.

**Guard.** `backend/tests/test_h117_devnull_guard.py` reproduces the clobber
on a scratch sentinel under `tmp_path` (never the real /dev/null), asserts
each guarded helper leaves the sentinel's inode and type unchanged, and scans
the repo: any Python `os.replace`/`os.rename`/`shutil.move`/Path rename must
sit in a file using the guard (or be the allowlisted directory-only
`frontend_build.py`), no write-target variable may default to /dev/null, and
every shell `mv` needs a regular-file check.
