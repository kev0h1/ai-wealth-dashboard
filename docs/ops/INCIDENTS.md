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
