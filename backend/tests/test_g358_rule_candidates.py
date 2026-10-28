"""G358: "file all matching" must be honest.

A rule's candidate set is every row with no manual category or only a GENERIC
one (None, "", "Other", "Uncategorised"); a SPECIFIC manual category is never
overridden. Applying the rule makes its category the effective one, and the
card's `matches_past` equals what Always will change. Synthetic data only.
"""
import asyncio

import app.routers.categories as categories_router
import app.routers.transactions as transactions_router
import app.services.categorisation as categorisation
from app.services import response_cache
from app.services.categories import GENERIC_MANUAL_CATEGORIES

from tests.test_g139_merchant_authority import FakeCol as _BaseCol


class FakeCol(_BaseCol):
    async def insert_one(self, doc):
        self.docs.append(dict(doc))

UID = "g358@example.com"


def _rows():
    def row(i, custom, cat="Other", name="SQ *KANTEEN"):
        return {"_id": i, "user_id": UID, "merchant_name": name, "description": name,
                "merchant_key": "kanteen", "category": cat, "custom_category": custom}
    return [
        row("none", None),
        row("empty", ""),
        row("other", "Other"),
        row("uncat", "Uncategorised"),
        row("travel", "Travel"),
        row("already", None, cat="Eating Out"),
        row("elsewhere", None, name="TESCO"),
    ]


def _install(monkeypatch):
    col = FakeCol(_rows())
    monkeypatch.setattr(categorisation, "transactions_col", col)
    return col


def _effective(d):
    return d.get("custom_category") or d.get("category")


def test_generic_list_is_one_definition():
    assert set(GENERIC_MANUAL_CATEGORIES) == {"Other", "Uncategorised"}


def test_candidates_include_generic_and_exclude_specific(monkeypatch):
    _install(monkeypatch)
    import re
    got = asyncio.run(categorisation._rule_match_candidates(
        UID, re.compile("kanteen", re.I), "Eating Out"))
    ids = {m["id"] for m in got}
    assert ids == {"none", "empty", "other", "uncat"}
    prev = {m["id"]: m["previous_category"] for m in got}
    assert prev["other"] == "Other" and prev["uncat"] == "Uncategorised"


def test_apply_makes_rule_category_effective(monkeypatch):
    col = _install(monkeypatch)
    affected = asyncio.run(categorisation.apply_single_rule(UID, "kanteen", "Eating Out"))
    assert len(affected) == 4
    by_id = {d["_id"]: d for d in col.docs}
    for i in ("none", "empty", "other", "uncat"):
        assert _effective(by_id[i]) == "Eating Out"
    assert _effective(by_id["travel"]) == "Travel"
    assert _effective(by_id["elsewhere"]) == "Other"


def test_count_matches_what_apply_changes(monkeypatch):
    col = _install(monkeypatch)
    n = asyncio.run(categorisation.count_rule_matches(UID, "kanteen", "Eating Out"))
    affected = asyncio.run(categorisation.apply_single_rule(UID, "kanteen", "Eating Out"))
    assert n == len(affected) == 4
    assert col  # fixture used


def test_matches_past_equals_candidate_count(monkeypatch):
    col = _install(monkeypatch)
    # the primary row the user just filed, plus the fixture rows
    col.docs.append({"_id": "primary", "user_id": UID, "merchant_name": "SQ *KANTEEN",
                     "description": "SQ *KANTEEN", "merchant_key": "kanteen",
                     "category": "Other", "custom_category": None})

    async def _noop(*a, **k):
        return None

    async def _vocab(uid):
        return set()

    monkeypatch.setattr(transactions_router, "transactions_col", col)
    monkeypatch.setattr(transactions_router, "teaching_events_col", FakeCol())
    monkeypatch.setattr(transactions_router, "cache_merchant", _noop)
    monkeypatch.setattr(transactions_router, "user_allowed_categories", _vocab)
    monkeypatch.setattr(response_cache, "ainvalidate", _noop)
    import app.services.derived_caches as derived_caches
    import app.routers.analytics as analytics
    monkeypatch.setattr(derived_caches, "mark_stale", _noop)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", _noop)

    res = asyncio.run(transactions_router.update_transaction(
        "primary", {"category": "Eating Out"}, user={"email": UID}))
    assert res["rule_suggestion"] is not None
    expected = len(asyncio.run(categorisation._rule_match_candidates(
        UID, __import__("re").compile(res["rule_suggestion"]["pattern"], 2), "Eating Out",
        exclude_id="primary")))
    assert res["matches_past"] == expected == 4
    assert res["matches_past_total"] == 7  # every merchant_key row, incl. the specific-Travel one
    assert res["affected_ids"] == ["primary"]


def test_add_rule_invalidates_cache_and_returns_ids(monkeypatch):
    col = _install(monkeypatch)
    calls = []

    async def _inval(uid):
        calls.append(uid)

    async def _noop(*a, **k):
        return None

    async def _custom(uid):
        return []

    monkeypatch.setattr(response_cache, "ainvalidate", _inval)
    monkeypatch.setattr(categories_router, "user_rules_col", FakeCol())
    monkeypatch.setattr(categories_router, "_custom_for", _custom)
    monkeypatch.setattr(categories_router, "apply_rules_bulk", _noop)
    monkeypatch.setattr(categories_router.data_version, "bump", _noop)

    async def run():
        res = await categories_router.add_rule(
            {"description": "Kanteen", "pattern": "kanteen", "category": "Eating Out"},
            user={"email": UID})
        await asyncio.sleep(0)
        return res

    res = asyncio.run(run())
    assert calls == [UID]
    assert sorted(res["affected_ids"]) == ["empty", "none", "other", "uncat"]
    assert [a["id"] for a in res["affected"]] == res["affected_ids"]
    assert col
