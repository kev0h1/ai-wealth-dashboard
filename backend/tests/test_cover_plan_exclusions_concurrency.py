"""G54: cover_plan_excluded_accounts used to be written as a full-array
replacement by two independent writers -- app/settings/SettingsPage.tsx's
own toggle and Penny's set_cover_plan_exclusions proposal (replayed through
this same PATCH /preferences endpoint via app.routers.can_i.
_execute_update_preferences) -- with no compare-and-swap. The read-modify-
write shape (read the whole array, change it locally, write the WHOLE thing
back) is a classic lost update: two genuinely concurrent writers can both
read the same starting array, each compute their own modified copy, and
whichever PATCH lands second silently discards whatever the first one
changed.

The G45 test in tests/test_preferences_versioning.py
(test_two_different_callers_writing_the_same_field_advance_one_shared_version)
explicitly documents that it does NOT cover this: it runs sequentially and
Penny's payload there is a strict superset of Settings', so nothing is
actually lost even in principle -- exactly the trap this file exists to
avoid repeating. Every test below models a REAL interleaving: a read, a
yield point, then a later write, so two racing writers can both observe the
identical pre-state before either one writes -- not two sequential calls.

Fix: SettingsPage.tsx's single-account toggle now sends
cover_plan_exclude_add / cover_plan_exclude_remove (app/routers/
preferences.py, $addToSet/$pull -- atomic single-element Mongo ops that
never read the array first, so they cannot lose a concurrent change
regardless of write order). Penny's set_cover_plan_exclusions proposal
genuinely needs "set the exclusion list to EXACTLY these accounts" (not a
delta), so that shape is kept, but is now safe via a version-conditioned
compare-and-swap retry loop (_cas_set_cover_plan_excluded_accounts) instead
of a blind $set.

G77: that CAS loop was itself still buggy -- on a version conflict it
retried by resending the IDENTICAL literal target it started with, rather
than re-deriving it against the array it had just re-read, so a concurrent
delta that landed mid-retry was silently discarded by Penny's own "fixed"
write. Worse, the test that was supposed to prove the retry safe
(originally named test_cas_full_list_set_retries_past_a_concurrent_delta_
and_still_lands) asserted that exact discard as correct, rationalised in
its own comment as "intentional documented semantics" -- it passed against
both the buggy code and a genuine fix, so it could never have caught this.
Fixed by capturing the delta (added_ids/removed_ids) the caller intends
against the FIRST array _cas_set_cover_plan_excluded_accounts reads, then
re-applying that same delta onto the freshly re-read array on every retry
instead of resending the stale literal. The test below now asserts the
concurrent account is RETAINED, and is proven to fail against the pre-fix
code (see this item's commit message for both runs).

`_FakeCol` below carries the same shape as tests/test_preferences_versioning.
py and tests/test_cover_plan_exclusions_persist.py's own copies (a real
`.matched_count`-bearing update_one, $addToSet/$pull/$exists support), plus
one addition: an optional one-shot async hook that fires the FIRST time
find_one/update_one is called, used to inject a genuine yield point at an
exact spot in the production code's own await sequence -- not a bare
asyncio.sleep(0), which cannot guarantee which coroutine the event loop
resumes next.
"""
import asyncio

import app.routers.preferences as preferences

UID = "user@example.com"


class _UpdateResult:
    def __init__(self, matched_count):
        self.matched_count = matched_count


class _FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        # One-shot hooks: awaited (and then cleared) the next time the
        # corresponding method is called, letting a test run an entire
        # concurrent write to completion at a precise point inside another
        # coroutine's own await sequence.
        self.find_one_hook = None
        self.update_one_hook = None

    @staticmethod
    def _match(d, q):
        for k, v in (q or {}).items():
            if isinstance(v, dict) and "$exists" in v:
                if (k in d) != v["$exists"]:
                    return False
            elif d.get(k) != v:
                return False
        return True

    async def find_one(self, query=None, projection=None):
        if self.find_one_hook is not None:
            hook, self.find_one_hook = self.find_one_hook, None
            await hook()
        query = query or {}
        for d in self.docs:
            if self._match(d, query):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        if self.update_one_hook is not None:
            hook, self.update_one_hook = self.update_one_hook, None
            await hook()
        for d in self.docs:
            if self._match(d, filt):
                d.update(update.get("$set") or {})
                for field, amount in (update.get("$inc") or {}).items():
                    d[field] = d.get(field, 0) + amount
                for field, spec in (update.get("$addToSet") or {}).items():
                    each = spec.get("$each", [spec]) if isinstance(spec, dict) else [spec]
                    existing = d.get(field) or []
                    d[field] = existing + [v for v in each if v not in existing]
                for field, spec in (update.get("$pull") or {}).items():
                    cond = spec.get("$in", []) if isinstance(spec, dict) else [spec]
                    existing = d.get(field) or []
                    d[field] = [v for v in existing if v not in cond]
                return _UpdateResult(1)
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            new_doc.update(update.get("$setOnInsert") or {})
            for field, amount in (update.get("$inc") or {}).items():
                new_doc[field] = new_doc.get(field, 0) + amount
            for field, spec in (update.get("$addToSet") or {}).items():
                each = spec.get("$each", [spec]) if isinstance(spec, dict) else [spec]
                new_doc[field] = list(dict.fromkeys(each))
            self.docs.append(new_doc)
            return _UpdateResult(0)
        return _UpdateResult(0)


class _CacheSpy:
    async def ainvalidate(self, uid):
        pass


def _patch(monkeypatch, doc):
    fake_prefs = _FakeCol([doc])
    monkeypatch.setattr(preferences, "preferences_col", fake_prefs)
    monkeypatch.setattr(preferences, "response_cache", _CacheSpy())
    return fake_prefs


# ═════════════════════════════════════════════════════════════════════════
# 1) THE BUG, reproduced: this is a faithful copy of the exact pre-G54
#    update_preferences() body for cover_plan_excluded_accounts (dedupe/sort
#    then an unconditional `$set` of the whole array, `upsert=True`) -- see
#    this item's own commit diff. It is kept here, not in production code,
#    purely to prove the PATTERN that both real writers used to follow is
#    genuinely unsafe under a real interleaving. This test must keep passing
#    forever: it is not testing current production code, it is the
#    "red" half of the red/green pair, pinned so nobody can claim the old
#    shape "wasn't really racy".
# ═════════════════════════════════════════════════════════════════════════

async def _pre_g54_toggle_write(col, uid: str, toggle_id: str):
    """Mirrors SettingsPage.tsx's OLD runCoverToggle exactly: read the
    current array, toggle one id locally, PATCH the whole array back."""
    doc = await col.find_one({"user_id": uid})
    current = set((doc or {}).get("cover_plan_excluded_accounts") or [])
    if toggle_id in current:
        current.discard(toggle_id)
    else:
        current.add(toggle_id)
    excluded = sorted({str(x) for x in current if str(x).strip()})
    await col.update_one(
        {"user_id": uid},
        {"$set": {"cover_plan_excluded_accounts": excluded, "user_id": uid}, "$inc": {"version": 1}},
        upsert=True,
    )


def test_old_style_whole_array_replace_loses_a_concurrent_change(monkeypatch):
    """Two callers race to toggle DIFFERENT accounts on, starting from the
    same empty exclusion list -- both should end up excluded. Writer A reads
    first, then yields (a real await, not a hope-for-the-best sleep) until
    writer B has read AND fully written its own change, then A resumes and
    writes its own (now stale) computed array. Under the pre-G54 shape this
    silently discards B's change."""
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 0, "cover_plan_excluded_accounts": []})
    b_done = asyncio.Event()

    async def writer_a():
        doc = await fake_prefs.find_one({"user_id": UID})
        current = set((doc or {}).get("cover_plan_excluded_accounts") or [])
        current.add("acc-A")
        await b_done.wait()  # yield point: B fully lands before A writes
        await fake_prefs.update_one(
            {"user_id": UID},
            {"$set": {"cover_plan_excluded_accounts": sorted(current), "user_id": UID}, "$inc": {"version": 1}},
            upsert=True,
        )

    async def writer_b():
        await _pre_g54_toggle_write(fake_prefs, UID, "acc-B")
        b_done.set()

    async def run():
        await asyncio.gather(writer_a(), writer_b())

    asyncio.run(run())

    final = asyncio.run(fake_prefs.find_one({"user_id": UID}))
    excluded = set(final["cover_plan_excluded_accounts"])
    # The bug: both accounts SHOULD be excluded (two independent additions),
    # but A's blind full-array write, computed before B's change landed,
    # overwrites B's write entirely.
    assert excluded == {"acc-A"}, (
        f"expected the pre-G54 shape to lose acc-B's change, got {excluded!r}"
    )
    assert "acc-B" not in excluded


# ═════════════════════════════════════════════════════════════════════════
# 2) THE FIX: the exact same interleaving, run against the REAL, current
#    preferences.update_preferences(), with the shapes the two real callers
#    now actually send -- Settings via cover_plan_exclude_add/remove.
# ═════════════════════════════════════════════════════════════════════════

def test_new_delta_ops_two_toggles_racing_do_not_lose_either_change(monkeypatch):
    """Same scenario as the bug test above -- two callers racing to
    exclude DIFFERENT accounts from the same starting state -- but through
    the real production endpoint with the new request shape. $addToSet
    never reads the array first, so there is no stale-read window for
    either write to be computed from: both land, regardless of order."""
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 0, "cover_plan_excluded_accounts": []})

    async def run():
        await asyncio.gather(
            preferences.update_preferences({"cover_plan_exclude_add": ["acc-A"]}, {"email": UID}),
            preferences.update_preferences({"cover_plan_exclude_add": ["acc-B"]}, {"email": UID}),
        )

    asyncio.run(run())

    final = asyncio.run(fake_prefs.find_one({"user_id": UID}))
    assert set(final["cover_plan_excluded_accounts"]) == {"acc-A", "acc-B"}


def test_new_delta_add_and_remove_racing_on_different_accounts_do_not_lose_either_change(monkeypatch):
    """One caller un-excludes an account that was already excluded while
    another caller excludes a different one, at the same time -- both
    changes must land."""
    fake_prefs = _patch(
        monkeypatch,
        {"user_id": UID, "version": 2, "cover_plan_excluded_accounts": ["acc-old"]},
    )

    async def run():
        await asyncio.gather(
            preferences.update_preferences({"cover_plan_exclude_remove": ["acc-old"]}, {"email": UID}),
            preferences.update_preferences({"cover_plan_exclude_add": ["acc-new"]}, {"email": UID}),
        )

    asyncio.run(run())

    final = asyncio.run(fake_prefs.find_one({"user_id": UID}))
    assert set(final["cover_plan_excluded_accounts"]) == {"acc-new"}


# ═════════════════════════════════════════════════════════════════════════
# 3) Penny's full-list-set path genuinely needs "set to exactly this list",
#    so it keeps the whole-array shape -- but made safe with the CAS retry
#    loop. This proves the retry actually engages AND that a concurrent
#    Settings delta landing mid-race is PRESERVED, not clobbered by Penny's
#    retried write (G77: the CAS retry used to resend its original literal
#    target unchanged, silently discarding whatever landed in between).
# ═════════════════════════════════════════════════════════════════════════

def test_cas_full_list_set_retries_past_a_concurrent_delta_and_still_lands(monkeypatch):
    fake_prefs = _patch(
        monkeypatch,
        {"user_id": UID, "version": 3, "cover_plan_excluded_accounts": ["acc-old"]},
    )

    async def concurrent_settings_delta():
        # Runs to completion INSIDE the hook, i.e. strictly between Penny's
        # CAS read (version 3) and Penny's first conditional write attempt
        # (also conditioned on version 3) -- so that first attempt is
        # guaranteed to find the version has moved and must retry.
        await preferences.update_preferences(
            {"cover_plan_exclude_add": ["acc-mid-race"]}, {"email": UID},
        )

    async def run():
        fake_prefs.update_one_hook = concurrent_settings_delta
        return await preferences.update_preferences(
            {"cover_plan_excluded_accounts": ["acc-penny-target"]}, {"email": UID},
        )

    result = asyncio.run(run())

    final = asyncio.run(fake_prefs.find_one({"user_id": UID}))
    # Penny read ["acc-old"] and intended ["acc-penny-target"] -- i.e. add
    # acc-penny-target, remove acc-old. That intent must land. But the
    # concurrent Settings toggle that raced it added acc-mid-race, an
    # account Penny never saw and never asked to touch -- that must survive
    # too. Pre-G77, the retry resent the literal ["acc-penny-target"] and
    # silently dropped acc-mid-race; this is the assertion that fails
    # against that code and passes against the fix.
    assert set(final["cover_plan_excluded_accounts"]) == {"acc-mid-race", "acc-penny-target"}
    assert "acc-old" not in final["cover_plan_excluded_accounts"]
    # version: 3 (start) -> 4 (settings delta lands) -> 5 (Penny's retried,
    # successful CAS write)
    assert final["version"] == 5
    assert result["version"] == 5


def test_cas_full_list_set_gives_up_cleanly_after_exhausting_retries(monkeypatch):
    """If every single retry attempt loses the race (an adversarial,
    never-ending collision), the endpoint must fail loudly (409) rather
    than silently dropping the write or looping forever."""
    from fastapi import HTTPException
    import pytest

    fake_prefs = _patch(
        monkeypatch,
        {"user_id": UID, "version": 0, "cover_plan_excluded_accounts": []},
    )
    calls = {"n": 0}

    async def always_bump_version_first():
        calls["n"] += 1
        # Bump the version out from under Penny's CAS loop every single
        # time it's about to write, forever.
        doc = await fake_prefs.find_one({"user_id": UID})
        await fake_prefs.update_one(
            {"user_id": UID, "version": doc.get("version", 0)},
            {"$set": {"user_id": UID}, "$inc": {"version": 1}},
        )
        fake_prefs.update_one_hook = always_bump_version_first

    fake_prefs.update_one_hook = always_bump_version_first

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(preferences.update_preferences(
            {"cover_plan_excluded_accounts": ["x"]}, {"email": UID},
        ))
    assert exc_info.value.status_code == 409
    assert calls["n"] == preferences._COVER_PLAN_CAS_MAX_ATTEMPTS


# ═════════════════════════════════════════════════════════════════════════
# 4) Ordinary single toggles (no race) still work in both directions, and
#    toggling something already in the state is idempotent.
# ═════════════════════════════════════════════════════════════════════════

def test_single_add_toggle_excludes_an_account(monkeypatch):
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 0, "cover_plan_excluded_accounts": []})

    asyncio.run(preferences.update_preferences({"cover_plan_exclude_add": ["acc-1"]}, {"email": UID}))

    final = asyncio.run(fake_prefs.find_one({"user_id": UID}))
    assert final["cover_plan_excluded_accounts"] == ["acc-1"]


def test_single_remove_toggle_un_excludes_an_account(monkeypatch):
    fake_prefs = _patch(
        monkeypatch, {"user_id": UID, "version": 0, "cover_plan_excluded_accounts": ["acc-1", "acc-2"]},
    )

    asyncio.run(preferences.update_preferences({"cover_plan_exclude_remove": ["acc-1"]}, {"email": UID}))

    final = asyncio.run(fake_prefs.find_one({"user_id": UID}))
    assert final["cover_plan_excluded_accounts"] == ["acc-2"]


def test_adding_an_already_excluded_account_is_idempotent(monkeypatch):
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 0, "cover_plan_excluded_accounts": ["acc-1"]})

    asyncio.run(preferences.update_preferences({"cover_plan_exclude_add": ["acc-1"]}, {"email": UID}))

    final = asyncio.run(fake_prefs.find_one({"user_id": UID}))
    assert final["cover_plan_excluded_accounts"] == ["acc-1"]


def test_removing_an_account_that_is_not_excluded_is_idempotent(monkeypatch):
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 0, "cover_plan_excluded_accounts": ["acc-1"]})

    asyncio.run(preferences.update_preferences({"cover_plan_exclude_remove": ["acc-9-not-there"]}, {"email": UID}))

    final = asyncio.run(fake_prefs.find_one({"user_id": UID}))
    assert final["cover_plan_excluded_accounts"] == ["acc-1"]
