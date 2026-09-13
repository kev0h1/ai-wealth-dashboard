"""G61: GET /preferences used to build two different-shaped dicts depending
on whether a preferences document existed at all -- a `not doc` branch with
its own hand-written literal, and a normal branch built from `doc.get(key,
default)` calls. The two drifted: the no-document branch was missing 10
keys the normal branch always returned (income_bracket, income_value,
pension_annual, has_child_benefit, home_pinned_accounts, home_pinned_cards,
spend_widgets, home_pinned_widget, recurring_categories,
dismissed_recurring), first noticed via G58's client-side presence check on
income_bracket.

The fix collapses both branches into one: `doc = doc or {}` feeds the same
dict-building block, so every default is now derived from the SAME
`doc.get(key, default)` call regardless of whether a document exists. These
tests exist to fail again if someone reintroduces two separately-maintained
branches (e.g. by pinning literal defaults in a `not doc` shortcut instead
of letting the single block run against `{}`).

`_FakeCol` is the fuller mutating double from
tests/test_preferences_versioning.py (applies both `$set` and `$inc`) --
copied rather than imported per that file's own stated convention, so this
file has no import-time coupling to another test module's internals. This
item is GET-only, so no test here actually exercises `$inc`, but the double
is kept complete for consistency with the rest of the suite.
"""
import asyncio

import app.routers.preferences as preferences
from app.routers.analytics import DEFAULT_RECURRING_CATEGORIES

UID = "user@example.com"


class _FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _match(d, q):
        return all(d.get(k) == v for k, v in (q or {}).items())

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
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            for field, amount in (update.get("$inc") or {}).items():
                new_doc[field] = new_doc.get(field, 0) + amount
            self.docs.append(new_doc)


class _CacheSpy:
    async def ainvalidate(self, uid):
        pass


def _patch(monkeypatch, doc=None):
    fake_prefs = _FakeCol([doc] if doc is not None else [])
    monkeypatch.setattr(preferences, "preferences_col", fake_prefs)
    monkeypatch.setattr(preferences, "response_cache", _CacheSpy())
    return fake_prefs


EXPECTED_KEYS = {
    "hide_net_worth",
    "dark_mode",
    "pay_period_config",
    "region",
    "debt_target_months",
    "notification_prefs",
    "income_bracket",
    "income_value",
    "pension_annual",
    "has_child_benefit",
    "home_pinned_accounts",
    "home_pinned_cards",
    "spend_widgets",
    "home_pinned_widget",
    "debt_burndown_overrides",
    "recurring_categories",
    "dismissed_recurring",
    "cover_plan_excluded_accounts",
    "payday_buffer",
    "penny_agent_consent",
    "version",
}


def test_no_document_and_empty_document_produce_the_identical_payload(monkeypatch):
    """A user with NO document at all, and a user whose document exists but
    carries nothing but user_id (the "normal branch producing output for a
    document that does not carry any of these fields" case from the G61
    backlog item itself), must be indistinguishable to a caller -- same key
    set, same values for every key."""
    _patch(monkeypatch, doc=None)
    result_no_doc = asyncio.run(preferences.get_preferences({"email": UID}))

    _patch(monkeypatch, doc={"user_id": UID})
    result_empty_doc = asyncio.run(preferences.get_preferences({"email": UID}))

    assert set(result_no_doc.keys()) == set(result_empty_doc.keys())
    assert result_no_doc == result_empty_doc


def test_new_user_payload_has_exactly_the_expected_key_set(monkeypatch):
    """Lists every key explicitly (not derived from the source) so an
    added/removed key is caught even if both branches were to drift
    together -- e.g. a future change that adds a new preference field to the
    dict-building block but forgets it needs a sane default against `{}`.
    debt_tracking_start is deliberately excluded: it must stay absent for a
    document that doesn't carry it."""
    _patch(monkeypatch, doc=None)

    result = asyncio.run(preferences.get_preferences({"email": UID}))

    assert set(result.keys()) == EXPECTED_KEYS
    assert "debt_tracking_start" not in result


def test_new_user_gets_the_normal_branchs_own_empty_doc_defaults_for_previously_missing_keys(monkeypatch):
    """Pins the exact default for each of the 10 keys the old no-document
    branch used to omit entirely, each one taken from what the surviving
    (former "normal") branch's own doc.get(key, default) call produces when
    evaluated against doc = {}."""
    _patch(monkeypatch, doc=None)

    result = asyncio.run(preferences.get_preferences({"email": UID}))

    assert result["income_bracket"] == ""
    assert result["income_value"] == 0
    assert result["pension_annual"] == 0
    assert result["has_child_benefit"] is False
    assert result["home_pinned_accounts"] == []
    assert result["home_pinned_cards"] == []
    assert result["spend_widgets"] is None
    assert result["home_pinned_widget"] is None
    assert result["recurring_categories"] == DEFAULT_RECURRING_CATEGORIES
    assert result["dismissed_recurring"] == []


def test_existing_but_empty_document_also_reports_version_zero(monkeypatch):
    """Companion to
    test_get_preferences_reports_version_zero_for_a_user_with_no_document in
    test_preferences_versioning.py (not duplicated here): a document that
    exists but has never been PATCHed (no version field written yet) must
    report the same version 0 as a user with no document at all, since
    neither has ever gone through a $inc write. G45's ordering guarantee --
    a document's first real PATCH returns version 1, strictly greater than
    0 -- depends on both of these starting at the same floor."""
    _patch(monkeypatch, doc={"user_id": UID})

    result = asyncio.run(preferences.get_preferences({"email": UID}))

    assert result["version"] == 0
