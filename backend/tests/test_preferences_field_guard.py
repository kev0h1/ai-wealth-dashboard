"""A85 (pentest A51-2026-09-20, API-08): PATCH /preferences used to have two
live-confirmed defects. (1) Mass assignment -- it accepted and stored ANY
top-level body key with no schema check, so an unadvertised field wrote
straight into the document. (2) No optimistic-concurrency check on the
ordinary write path -- a stale full-snapshot PATCH could silently clobber a
field a different, more recent write had just changed, with no conflict
signal at all.

Fix: `ALLOWED_PREFERENCE_FIELDS` (app/routers/preferences.py) is an explicit
allowlist of every top-level key this endpoint has ever legitimately been
asked to write, built from frontend/lib/api.ts's updatePreferences() call
sites and every Penny propose-tool that replays through this same endpoint
(see that set's own docstring for the full enumeration). A body key outside
it is rejected with 422 before any write. Separately, an optional
`expected_version` in the body -- the same JSON-body convention the
existing `version` counter already uses, not a header -- is checked against
the currently stored version before any write; a mismatch returns 409 with
the current version and makes no change, while an omitted `expected_version`
preserves today's last-write-wins behaviour for every existing caller.

`_FakeCol` is the fuller mutating double from tests/test_preferences_versioning.py
(applies $set/$inc/$addToSet/$pull and reports `.matched_count`, needed
because this file proves both "accepted and actually written" and "rejected
and NOT written") -- copied rather than imported, per that file's own stated
convention of no import-time coupling between test modules.
"""
import asyncio

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

import app.routers.preferences as preferences
from app.routers.preferences import ALLOWED_PREFERENCE_FIELDS
from app.services.notifications import NOTIF_DEFAULTS

UID = "user@example.com"


class _UpdateResult:
    def __init__(self, matched_count):
        self.matched_count = matched_count


class _FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _match(d, q):
        for k, v in (q or {}).items():
            if k == "$or":
                # A85 rework: _version_match_query's expected_version == 0
                # filter is {"$or": [{"version": 0}, {"version": {"$exists":
                # False}}]} -- without this branch, the fake would treat
                # "$or" as an ordinary field name, look up d.get("$or")
                # (always None), find it never equals the clause list, and
                # ALWAYS report no match. That would make every
                # expected_version=0 write look like a false conflict rather
                # than actually proving the real filter shape works, exactly
                # the "fake ignores the filter, test passes vacuously" trap
                # this rework exists to avoid.
                if not any(_FakeCol._match(d, sub) for sub in v):
                    return False
            elif isinstance(v, dict) and "$exists" in v:
                if (k in d) != v["$exists"]:
                    return False
            elif d.get(k) != v:
                return False
        return True

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if self._match(d, query):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
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


def _patch(monkeypatch, doc=None):
    fake_prefs = _FakeCol([doc] if doc is not None else [])
    monkeypatch.setattr(preferences, "preferences_col", fake_prefs)
    monkeypatch.setattr(preferences, "response_cache", _CacheSpy())
    return fake_prefs


class _RaceFakeCol(_FakeCol):
    """A85 rework: proves the version guarantee lives in update_one's
    FILTER, not in the earlier find_one pre-check -- by forcing a REAL
    interleaving between two concurrent writers rather than just calling
    update_preferences twice in sequence (which only re-exercises the fast
    pre-check and would pass even if the write-time filter were still
    unconditioned, i.e. would pass vacuously against the exact bug Kevin's
    reviewer found).

    The first two find_one calls made against this collection are treated
    as the two writers' `expected_version` pre-check reads: the FIRST one to
    arrive parks on an asyncio.Event until the SECOND one arrives, so both
    observe the identical pre-write state (version N) before either writer
    has written anything -- exactly the rendezvous the reviewer used to
    falsify the pre-fix code (see A85's 2026-09-22 rejection note). Each
    call's return value is snapshotted at the moment it actually reads, not
    re-derived after waking, since a live re-search after waking could
    return the OTHER writer's already-applied update and silently hide the
    race this class exists to create. Every find_one call after the first
    two proceeds immediately with no rendezvous, so downstream reads (the
    final result-building read, and _versioned_write's own conflict re-read
    for whichever writer loses) behave normally.
    """

    def __init__(self, docs):
        super().__init__(docs)
        self._arrived = 0
        self._release = asyncio.Event()

    async def find_one(self, query=None, projection=None):
        self._arrived += 1
        is_rendezvous_call = self._arrived <= 2
        snapshot = await super().find_one(query, projection)
        snapshot = dict(snapshot) if snapshot is not None else None
        if is_rendezvous_call:
            if self._arrived == 1:
                await self._release.wait()
            else:
                self._release.set()
        return snapshot


class _DuplicateKeyRaceFakeCol(_RaceFakeCol):
    """A85 rework, adversarial-review gap 2: layers a DuplicateKeyError
    simulation onto _RaceFakeCol's find_one rendezvous, to reproduce two
    genuinely simultaneous FIRST writes for a brand-new user (no document at
    all yet). Both writers' single find_one call inside _versioned_write
    (the "is there really no document?" check in the no-match branch) is
    what rendezvous-gates here -- both must see `current_doc is None` before
    either has written, exactly the scenario preferences_col's real unique
    index on user_id (app/main.py ~370) exists to police for two truly
    concurrent inserts. The FIRST writer's bootstrap upsert
    (update_one({"user_id": uid}, ..., upsert=True), no version key in the
    filter) proceeds normally and creates the document; the SECOND,
    identically-shaped call raises DuplicateKeyError instead of silently
    creating (or merging into) a second document, mirroring what Mongo's own
    unique index would do to the loser of that race.
    """

    def __init__(self, docs=None):
        super().__init__(docs)
        self._bootstrap_upsert_calls = 0

    async def update_one(self, filt, update, upsert=False):
        if upsert and set(filt.keys()) == {"user_id"}:
            self._bootstrap_upsert_calls += 1
            if self._bootstrap_upsert_calls == 2:
                raise DuplicateKeyError("E11000 duplicate key error collection: user_id")
        return await super().update_one(filt, update, upsert=upsert)


# ---------------------------------------------------------------------------
# Mass assignment (1)
# ---------------------------------------------------------------------------

def test_unknown_top_level_field_is_rejected_422(monkeypatch):
    fake_prefs = _patch(monkeypatch, doc=None)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(preferences.update_preferences(
            {"a51_wp4_mass_assignment_canary": "hacker-controlled"}, {"email": UID},
        ))

    assert exc_info.value.status_code == 422
    assert "a51_wp4_mass_assignment_canary" in str(exc_info.value.detail)
    # Rejected before any write reaches the collection -- no document was
    # created for a user who previously had none.
    assert fake_prefs.docs == []


def test_unknown_field_alongside_legitimate_fields_rejects_the_whole_request(monkeypatch):
    """A mixed body (one real field, one unadvertised one) must not silently
    drop the bad key and write the good one -- the whole PATCH is invalid,
    matching the live-confirmed A51 case where the canary key rode along
    with a genuine debt_target_months change and both were accepted."""
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 3, "dark_mode": False})

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(preferences.update_preferences(
            {"dark_mode": True, "is_admin": True}, {"email": UID},
        ))

    assert exc_info.value.status_code == 422
    # The pre-existing document is untouched: dark_mode did NOT flip and
    # version did NOT advance.
    assert fake_prefs.docs == [{"user_id": UID, "version": 3, "dark_mode": False}]


def test_every_allowlisted_field_is_accepted_and_written(monkeypatch):
    """One representative valid value per field in ALLOWED_PREFERENCE_FIELDS,
    each PATCHed alone against a fresh document-less user. None should raise,
    and each should produce exactly one version bump -- proving the allowlist
    itself, built from every real caller, does not accidentally exclude a
    field the app actually uses."""
    sample_values = {
        "hide_net_worth": True,
        "dark_mode": True,
        "pay_period_config": {"type": "calendar_month"},
        "income_value": 50000,
        "income_bracket": "under_100k",
        "pension_annual": 4000,
        "has_child_benefit": True,
        "home_pinned_accounts": ["acc-1"],
        "home_pinned_cards": ["card-1"],
        "recurring_categories": ["Bills"],
        "spend_widgets": ["debt_burndown"],
        "home_pinned_widget": "period_compare",
        "debt_burndown_overrides": {"card-1": {"apr": 0}},
        "cover_plan_excluded_accounts": ["acc-1"],
        "cover_plan_exclude_add": ["acc-1"],
        "cover_plan_exclude_remove": ["acc-1"],
        "debt_target_months": 24,
        "debt_tracking_start": "2026-01-01",
        "notification_prefs": {**NOTIF_DEFAULTS, "transactions": True},
    }

    # Every field this test knows a sample value for must be exactly the
    # allowlist -- if either side gains/loses a field without the other
    # being updated, fail loudly here rather than silently skipping it.
    assert set(sample_values.keys()) == ALLOWED_PREFERENCE_FIELDS

    for field, value in sample_values.items():
        _patch(monkeypatch, doc=None)
        result = asyncio.run(preferences.update_preferences({field: value}, {"email": UID}))
        assert result["version"] == 1, f"{field} did not write (version did not advance)"


# ---------------------------------------------------------------------------
# Optimistic concurrency (2)
# ---------------------------------------------------------------------------

def test_stale_expected_version_returns_409_and_makes_no_change(monkeypatch):
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 5, "dark_mode": False})

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(preferences.update_preferences(
            {"dark_mode": True, "expected_version": 4}, {"email": UID},
        ))

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["current_version"] == 5
    # No write happened: dark_mode still false, version still 5.
    assert fake_prefs.docs == [{"user_id": UID, "version": 5, "dark_mode": False}]


def test_matching_expected_version_writes_and_increments(monkeypatch):
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 5, "dark_mode": False})

    result = asyncio.run(preferences.update_preferences(
        {"dark_mode": True, "expected_version": 5}, {"email": UID},
    ))

    assert result["version"] == 6
    assert fake_prefs.docs[0]["dark_mode"] is True
    assert fake_prefs.docs[0]["version"] == 6


def test_no_expected_version_supplied_still_writes_last_write_wins(monkeypatch):
    """Every existing client today never sends expected_version at all --
    this is the exact behaviour they must keep getting: last write wins,
    no 409, matching the endpoint's behaviour before this fix."""
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 5, "dark_mode": False})

    result = asyncio.run(preferences.update_preferences(
        {"dark_mode": True}, {"email": UID},
    ))

    assert result["version"] == 6
    assert fake_prefs.docs[0]["dark_mode"] is True


def test_expected_version_zero_matches_a_document_with_no_version_field_yet(monkeypatch):
    """A legacy document that has never been $inc'd (no `version` key at
    all) reports version 0 via GET /preferences (doc.get("version", 0)) --
    expected_version=0 against that same document must be treated as a
    match, not a spurious 409."""
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "dark_mode": False})

    result = asyncio.run(preferences.update_preferences(
        {"dark_mode": True, "expected_version": 0}, {"email": UID},
    ))

    assert result["version"] == 1
    assert fake_prefs.docs[0]["dark_mode"] is True


def test_expected_version_against_a_user_with_no_document_at_all_matches_zero(monkeypatch):
    fake_prefs = _patch(monkeypatch, doc=None)

    result = asyncio.run(preferences.update_preferences(
        {"dark_mode": True, "expected_version": 0}, {"email": UID},
    ))

    assert result["version"] == 1
    assert fake_prefs.docs[0]["dark_mode"] is True


def test_non_integer_expected_version_is_rejected_422(monkeypatch):
    _patch(monkeypatch, {"user_id": UID, "version": 5})

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(preferences.update_preferences(
            {"dark_mode": True, "expected_version": "five"}, {"email": UID},
        ))

    assert exc_info.value.status_code == 422


def test_expected_version_is_never_written_into_the_document(monkeypatch):
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 5, "dark_mode": False})

    asyncio.run(preferences.update_preferences(
        {"dark_mode": True, "expected_version": 5}, {"email": UID},
    ))

    assert "expected_version" not in fake_prefs.docs[0]


# ---------------------------------------------------------------------------
# Real interleaving (A85 rework, Kevin's 2026-09-22 rejection): two writers
# both read version N, then both PATCH with expected_version=N. Only one may
# succeed; the other must get 409 with the FRESH current_version and must
# not have its field written. This is the case that falsifies the pre-fix
# code (a read-then-check with no version condition on the write filter)
# even though every sequential test above already passes against it.
# ---------------------------------------------------------------------------

def test_concurrent_writers_with_same_expected_version_only_one_succeeds(monkeypatch):
    """Ordinary-$set-path race: writer A sends dark_mode, writer B sends
    hide_net_worth, both with expected_version=5 against a real interleaving
    (see _RaceFakeCol). Exactly one writer's field must land; the other must
    be rejected by the write-time FILTER (matched_count == 0), not merely by
    the earlier pre-read -- which both writers pass, by construction, since
    they rendezvous on the SAME version before either writes."""
    fake_prefs = _RaceFakeCol([
        {"user_id": UID, "version": 5, "dark_mode": False, "hide_net_worth": False},
    ])
    monkeypatch.setattr(preferences, "preferences_col", fake_prefs)
    monkeypatch.setattr(preferences, "response_cache", _CacheSpy())

    async def run():
        return await asyncio.gather(
            preferences.update_preferences(
                {"dark_mode": True, "expected_version": 5}, {"email": UID},
            ),
            preferences.update_preferences(
                {"hide_net_worth": True, "expected_version": 5}, {"email": UID},
            ),
            return_exceptions=True,
        )

    results = asyncio.run(run())

    successes = [r for r in results if isinstance(r, dict)]
    conflicts = [r for r in results if isinstance(r, HTTPException)]
    assert len(successes) == 1, f"expected exactly one success, got: {results}"
    assert len(conflicts) == 1, f"expected exactly one 409, got: {results}"
    assert successes[0]["version"] == 6
    assert conflicts[0].status_code == 409
    assert conflicts[0].detail["current_version"] == 6

    # Exactly one version bump happened (not two -- a lost update would show
    # up here as version still 6 but BOTH fields changed), and only the
    # winning writer's field actually landed.
    final_doc = fake_prefs.docs[0]
    assert final_doc["version"] == 6
    changed_fields = [
        field for field, before in (("dark_mode", False), ("hide_net_worth", False))
        if final_doc[field] != before
    ]
    assert len(changed_fields) == 1, (
        f"expected exactly one writer's field to land, got: {final_doc}"
    )


def test_concurrent_delta_op_and_ordinary_write_with_same_expected_version_only_one_succeeds(monkeypatch):
    """Same race, but one writer goes through the delta-ops loop
    (cover_plan_exclude_add) instead of the ordinary $set path -- the delta
    loop used to have the identical missing-version-filter defect as the
    ordinary path, just less visible because G54's own docstring focuses on
    the cover-plan CAS helper, not this loop."""
    fake_prefs = _RaceFakeCol([{
        "user_id": UID, "version": 5, "dark_mode": False,
        "cover_plan_excluded_accounts": ["acc-1"],
    }])
    monkeypatch.setattr(preferences, "preferences_col", fake_prefs)
    monkeypatch.setattr(preferences, "response_cache", _CacheSpy())

    async def run():
        return await asyncio.gather(
            preferences.update_preferences(
                {"dark_mode": True, "expected_version": 5}, {"email": UID},
            ),
            preferences.update_preferences(
                {"cover_plan_exclude_add": ["acc-2"], "expected_version": 5}, {"email": UID},
            ),
            return_exceptions=True,
        )

    results = asyncio.run(run())

    successes = [r for r in results if isinstance(r, dict)]
    conflicts = [r for r in results if isinstance(r, HTTPException)]
    assert len(successes) == 1, f"expected exactly one success, got: {results}"
    assert len(conflicts) == 1, f"expected exactly one 409, got: {results}"
    assert successes[0]["version"] == 6
    assert conflicts[0].status_code == 409
    assert conflicts[0].detail["current_version"] == 6
    assert fake_prefs.docs[0]["version"] == 6


def test_concurrent_writers_against_a_legacy_no_version_document_only_one_succeeds(monkeypatch):
    """Same race, starting from a legacy document that has never been
    $inc'd (no `version` key at all) -- expected_version=0 is the only value
    that can ever match it, via _version_match_query's $or form. Proves that
    $or filter, not the pre-read, is what arbitrates the race even in the
    legacy-document case."""
    fake_prefs = _RaceFakeCol([
        {"user_id": UID, "dark_mode": False, "hide_net_worth": False},
    ])
    monkeypatch.setattr(preferences, "preferences_col", fake_prefs)
    monkeypatch.setattr(preferences, "response_cache", _CacheSpy())

    async def run():
        return await asyncio.gather(
            preferences.update_preferences(
                {"dark_mode": True, "expected_version": 0}, {"email": UID},
            ),
            preferences.update_preferences(
                {"hide_net_worth": True, "expected_version": 0}, {"email": UID},
            ),
            return_exceptions=True,
        )

    results = asyncio.run(run())

    successes = [r for r in results if isinstance(r, dict)]
    conflicts = [r for r in results if isinstance(r, HTTPException)]
    assert len(successes) == 1, f"expected exactly one success, got: {results}"
    assert len(conflicts) == 1, f"expected exactly one 409, got: {results}"
    assert successes[0]["version"] == 1
    assert conflicts[0].status_code == 409
    assert conflicts[0].detail["current_version"] == 1
    assert fake_prefs.docs[0]["version"] == 1


# ---------------------------------------------------------------------------
# Adversarial review, 2026-09-22: two gaps in _versioned_write's "no
# document at all" bootstrap branch, closed after the rework above passed
# the originally rejected defect.
# ---------------------------------------------------------------------------

def test_versioned_write_direct_call_with_bogus_expected_version_on_empty_collection_raises_409_and_creates_nothing(monkeypatch):
    """Gap 1: calling _versioned_write directly (not through the handler)
    with expected_version=99 against a user who has no document at all must
    be rejected, not treated as a first write -- proving the guard is
    inside the function itself, since the handler's own fast pre-check
    (which would ALSO reject 99 here, since it too defaults a missing
    document's version to 0) is bypassed entirely by calling the function
    directly."""
    fake_prefs = _FakeCol([])
    monkeypatch.setattr(preferences, "preferences_col", fake_prefs)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(preferences._versioned_write(
            UID, 99, {"$set": {"dark_mode": True, "user_id": UID}, "$inc": {"version": 1}},
        ))

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["current_version"] == 0
    assert fake_prefs.docs == []


def test_concurrent_bootstrap_writers_duplicate_key_error_yields_one_success_one_409_not_500(monkeypatch):
    """Gap 2: two genuinely simultaneous first writes for a brand-new user
    (see _DuplicateKeyRaceFakeCol) both reach the bootstrap branch; the
    loser's upsert raises DuplicateKeyError (simulating preferences_col's
    real unique index on user_id, app/main.py ~370). That must be caught
    and turned into a clean 409 -- an uncaught DuplicateKeyError would
    propagate out of _versioned_write as a 500."""
    fake_prefs = _DuplicateKeyRaceFakeCol([])
    monkeypatch.setattr(preferences, "preferences_col", fake_prefs)

    update_doc_a = {"$set": {"dark_mode": True, "user_id": UID}, "$inc": {"version": 1}}
    update_doc_b = {"$set": {"hide_net_worth": True, "user_id": UID}, "$inc": {"version": 1}}

    async def run():
        return await asyncio.gather(
            preferences._versioned_write(UID, 0, update_doc_a),
            preferences._versioned_write(UID, 0, update_doc_b),
            return_exceptions=True,
        )

    results = asyncio.run(run())

    # No other exception type (in particular, no uncaught DuplicateKeyError)
    # should have escaped -- every result must be either the winner's
    # returned version or the loser's clean HTTPException.
    assert all(isinstance(r, (int, HTTPException)) for r in results), (
        f"expected only ints or HTTPExceptions, got: {results}"
    )
    successes = [r for r in results if isinstance(r, int)]
    conflicts = [r for r in results if isinstance(r, HTTPException)]
    assert len(successes) == 1, f"expected exactly one success (no 500), got: {results}"
    assert len(conflicts) == 1, f"expected exactly one 409, got: {results}"
    assert successes[0] == 1
    assert conflicts[0].status_code == 409
    assert conflicts[0].detail["current_version"] == 1
    assert len(fake_prefs.docs) == 1
