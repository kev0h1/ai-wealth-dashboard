"""Tests for evidence-gone retirement (Insights honesty review follow-up,
2026-09-01 census).

Bug: a push-category insight (e.g. "broadband") whose `triggered_by` had
recomputed to `[]` — zero ISP-shaped transactions anywhere in the 90-day
window — kept rendering 12-day-old researched prose ("Virgin Media M1
broadband from £17.99...") with no deterministic grounding left under it.
Nothing in the existing regen-reason ladder (`_regen_reason`) treated an
empty `triggered_by` as anything other than a large `spend_changed` swing,
which regenerates NEW ungrounded prose rather than retiring the claim.

Fix (backend/app/routers/savings_insights.py):
  - `_evidence_is_gone`: true when `triggered_by` is empty AND, belt-and-
    braces, an independent re-derivation of the category's own trigger
    spend (`_category_trigger_spend_total`) is also ~zero.
  - `_refresh_savings_insights_for_user` stamps `retired_at`/
    `retire_reason: "evidence_gone"` on an existing, unresolved doc when
    `_evidence_is_gone` fires, and `continue`s (no regen/research spend).
  - Resurrection: once `triggered_by` is non-empty again, `retired_at`/
    `retire_reason` are cleared (`$unset`) and the normal lifecycle resumes.
  - A doc already resolved to `verified_at`/`substituted_at` is a closed
    historical fact and is never retired for evidence going quiet later.
  - Every consumer that reads `savings_insights_col` directly (GET
    /savings-insights, GET /savings-insights/spotlight, GET /value-delivered,
    penny_tools._exec_get_insights) now excludes `retired_at` docs.
    (POST /savings-insights/{id}/research, the fifth consumer this fix
    originally covered, is itself retired — see the owner decision above
    CATEGORY_LIFECYCLE in savings_insights.py and
    test_research_endpoint_retired.py — so it's dropped from this file too.)

No mongomock is available in this environment, so `savings_insights_col` /
`preferences_col` are replaced with tiny in-memory fakes supporting the
Motor subset actually used, following the same monkeypatch-the-module-
level-name convention already established by test_refresh_savings_insights.py.
`FakeCol` here is NOT shared across test files, by this suite's own
convention.
"""
import asyncio
from datetime import datetime, timedelta

import app.routers.savings_insights as savings_insights
from app.routers.savings_insights import (
    _refresh_savings_insights_for_user,
    _evidence_is_gone,
    get_savings_insights,
    get_spotlight_insight,
    PROMPT_VERSION,
)


UID = "kevin"
NOW = datetime(2026, 8, 28, 12, 0, 0)
USER = {"email": UID}


class _FrozenDatetime(datetime):
    @classmethod
    def utcnow(cls):
        return NOW


def _run(coro):
    return asyncio.run(coro)


# ── Generic fake-Mongo plumbing ──────────────────────────────────────────

def _match(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$exists" in cond and (key in doc) != cond["$exists"]:
                return False
            if "$gt" in cond and not (val is not None and val > cond["$gt"]):
                return False
            if "$ne" in cond and val == cond["$ne"]:
                return False
        else:
            if val != cond:
                return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    async def to_list(self, n):
        return list(self._docs)


class FakeInsightsCol:
    """Stand-in for `savings_insights_col` — `find`/`find_one`/`update_one`
    only, matching queries via `_match` (including `$exists`, used by every
    new retired_at-exclusion filter this fix adds)."""

    def __init__(self, docs):
        self.docs = [dict(d) for d in docs]
        for d in self.docs:
            d.setdefault("_id", d.get("insight_id") or d["category"])

    def find(self, query=None, projection=None):
        query = query or {}
        return _FakeCursor([d for d in self.docs if _match(d, query)])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if _match(d, query):
                return d
        return None

    async def update_one(self, filt, update):
        for d in self.docs:
            if _match(d, filt):
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                for k in (update.get("$unset") or {}):
                    d.pop(k, None)
                return

    async def insert_one(self, doc):
        doc = dict(doc)
        doc.setdefault("_id", doc.get("insight_id") or doc["category"])
        self.docs.append(doc)


class FakePreferencesCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query=None):
        query = query or {}
        for d in self.docs:
            if _match(d, query):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                d.update(update.get("$set") or {})
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)


# ── Doc builders ─────────────────────────────────────────────────────────

def _broadband_doc(**overrides):
    base = {
        "category": "broadband", "user_id": UID, "insight_id": "broadband-abc",
        "icon": "📡", "label": "Broadband", "pinned": False,
        "title": "Switch to Virgin Media", "body": "Virgin Media M1 broadband from £17.99...",
        "savings_estimate": "~£5/mo", "content_hash": "old-hash", "is_new": False,
        "refreshed_at": NOW - timedelta(days=12), "researched_at": NOW - timedelta(days=12),
        # OWNER DECISION (2026-09-01): content only serves while
        # content_valid_until is in the future — see test_content_ttl.py.
        # This fixture represents an ACTIVE, normally-researched broadband
        # card (a push/structured category, historically always "fresh"
        # regardless of researched_at's age) — comfortably inside the 7-day
        # default TTL from "now", independent of how stale researched_at
        # itself looks. Tests exercising the quiet/contentless path already
        # override title/body (and usually researched_at) explicitly.
        "content_valid_until": NOW + timedelta(days=6),
        "prompt_version": PROMPT_VERSION,
        "triggered_by": [{"merchant_key": "virgin media", "monthly_amount": 17.99, "display_name": "Virgin Media"}],
    }
    base.update(overrides)
    return base


def _passive_doc(category, *, triggered_by):
    """energy/groceries are always force-appended to the applicable list by
    `_refresh_savings_insights_for_user` — give them an already-current,
    already-matching, evidenced doc so they resolve to a no-op and never
    reach the evidence-gone check at all (mirrors
    test_refresh_savings_insights.py's own `_passive_doc`)."""
    return {
        "category": category, "user_id": UID, "insight_id": f"{category}-abc",
        "icon": "x", "label": category.title(), "pinned": False,
        "title": "T", "body": "B", "savings_estimate": None,
        "content_hash": "h", "is_new": False,
        "refreshed_at": NOW, "researched_at": NOW, "prompt_version": PROMPT_VERSION,
        "triggered_by": triggered_by,
    }


# ── Refresh-loop setup ───────────────────────────────────────────────────

def _setup_refresh(monkeypatch, *, applicable, docs, triggered_by_map, spend_map=None,
                    generated_content=None, verified_map=None):
    """`applicable`: categories `_detect_insight_categories` reports (energy/
    groceries get force-appended by the function under test regardless, so
    they're pre-seeded here as evidenced no-ops).
    `triggered_by_map`: {category: triggered_by list} for `_find_triggered_transactions`.
    `spend_map`: {category: float} for the belt-and-braces
    `_category_trigger_spend_total` — defaults to 0.0 (confirms the empty
    triggered_by) for any category not listed.
    `verified_map`: {category: dict|None} for `_check_verified_saving`.
    """
    seed = list(docs) + [
        _passive_doc("energy", triggered_by=[{"merchant_key": "octopus", "monthly_amount": 40.0}]),
        _passive_doc("groceries", triggered_by=[{"merchant_key": "tesco", "monthly_amount": 200.0}]),
    ]
    col = FakeInsightsCol(seed)
    monkeypatch.setattr(savings_insights, "savings_insights_col", col)
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)

    calls = {"content": 0, "spend_check": []}

    async def fake_detect(user_id):
        return list(applicable)

    async def fake_triggered(user_id, category_key):
        return triggered_by_map.get(category_key, [])

    async def fake_verified(user_id, existing):
        return (verified_map or {}).get(existing.get("category"))

    async def fake_spend_total(user_id, category_key):
        calls["spend_check"].append(category_key)
        return (spend_map or {}).get(category_key, 0.0)

    async def fake_content(category_key, user_id, user_context, triggered_by):
        calls["content"] += 1
        if generated_content is None:
            return {"title": "New title", "body": "New body", "savings_estimate": "~£10/mo"}
        return generated_content

    monkeypatch.setattr(savings_insights, "_detect_insight_categories", fake_detect)
    monkeypatch.setattr(savings_insights, "_find_triggered_transactions", fake_triggered)
    monkeypatch.setattr(savings_insights, "_check_verified_saving", fake_verified)
    monkeypatch.setattr(savings_insights, "_category_trigger_spend_total", fake_spend_total)
    monkeypatch.setattr(savings_insights, "_generate_savings_insight_content", fake_content)

    return col, calls


# ── _evidence_is_gone unit tests ─────────────────────────────────────────

def test_evidence_is_gone_false_when_triggered_by_present(monkeypatch):
    # Short-circuits before even consulting the belt-and-braces check.
    result = _run(_evidence_is_gone(UID, "broadband", [{"merchant_key": "bt", "monthly_amount": 30.0}]))
    assert result is False


def test_evidence_is_gone_true_when_both_signals_agree_empty(monkeypatch):
    async def fake_spend_total(user_id, category_key):
        return 0.0
    monkeypatch.setattr(savings_insights, "_category_trigger_spend_total", fake_spend_total)
    assert _run(_evidence_is_gone(UID, "broadband", [])) is True


def test_evidence_is_gone_false_when_belt_and_braces_disagrees(monkeypatch):
    # triggered_by is empty but the independent re-derivation finds real
    # matching spend — the two signals disagree, so this must NOT claim
    # evidence is gone (favour a possibly-buggy `_find_triggered_transactions`
    # over silently retiring a card that may still have real grounding).
    async def fake_spend_total(user_id, category_key):
        return 45.0
    monkeypatch.setattr(savings_insights, "_category_trigger_spend_total", fake_spend_total)
    assert _run(_evidence_is_gone(UID, "broadband", [])) is False


# ── Refresh loop: retirement ─────────────────────────────────────────────

def test_evidence_gone_retires_the_insight_and_skips_regen(monkeypatch):
    doc = _broadband_doc()
    col, calls = _setup_refresh(
        monkeypatch, applicable=["broadband"], docs=[doc],
        triggered_by_map={"broadband": []},   # recomputed to empty — the reported bug
        spend_map={"broadband": 0.0},         # belt-and-braces confirms it
    )

    _run(_refresh_savings_insights_for_user(UID))

    saved = next(d for d in col.docs if d["category"] == "broadband")
    assert saved["retired_at"] == NOW
    assert saved["retire_reason"] == "evidence_gone"
    assert saved["triggered_by"] == []
    assert saved["is_new"] is False
    # Stale title/body/estimate are left in the doc (history is kept — the
    # task's own requirement) but nothing was regenerated for them.
    assert saved["title"] == "Switch to Virgin Media"
    assert calls["content"] == 0, "must not spend an LLM/Tavily call researching a category with no evidence"


def test_already_retired_doc_is_left_alone_and_not_re_stamped(monkeypatch):
    # A second refresh pass while still evidence-less: idempotent, and the
    # original retirement timestamp is preserved (not re-stamped every pass).
    original_retired_at = NOW - timedelta(days=3)
    doc = _broadband_doc(retired_at=original_retired_at, retire_reason="evidence_gone", triggered_by=[])
    col, calls = _setup_refresh(
        monkeypatch, applicable=["broadband"], docs=[doc],
        triggered_by_map={"broadband": []},
        spend_map={"broadband": 0.0},
    )

    _run(_refresh_savings_insights_for_user(UID))

    saved = next(d for d in col.docs if d["category"] == "broadband")
    assert saved["retired_at"] == original_retired_at, "retirement timestamp is history, not re-stamped"
    assert calls["content"] == 0


def test_belt_and_braces_guard_prevents_retirement_on_ambiguous_signal(monkeypatch):
    # triggered_by came back empty, but the independent spend re-derivation
    # disagrees — must NOT retire. Falls through to the normal regen-reason
    # ladder instead (a large spend swing => spend_changed, past the 7-day
    # floor here, so a real (ungrounded, pre-existing-behaviour) regen fires
    # — the point of this test is only that retirement did NOT happen).
    doc = _broadband_doc(refreshed_at=NOW - timedelta(days=10))
    col, calls = _setup_refresh(
        monkeypatch, applicable=["broadband"], docs=[doc],
        triggered_by_map={"broadband": []},
        spend_map={"broadband": 45.0},   # disagrees with the empty triggered_by
    )

    _run(_refresh_savings_insights_for_user(UID))

    saved = next(d for d in col.docs if d["category"] == "broadband")
    assert "retired_at" not in saved
    assert "retire_reason" not in saved


# ── Refresh loop: resurrection ───────────────────────────────────────────

def test_evidence_returning_resurrects_and_regenerates(monkeypatch):
    doc = _broadband_doc(
        retired_at=NOW - timedelta(days=5), retire_reason="evidence_gone",
        triggered_by=[], title="", body="", savings_estimate=None, researched_at=None,
    )
    new_evidence = [{"merchant_key": "virgin media", "monthly_amount": 24.99, "display_name": "Virgin Media"}]
    col, calls = _setup_refresh(
        monkeypatch, applicable=["broadband"], docs=[doc],
        triggered_by_map={"broadband": new_evidence},
        generated_content={"title": "You pay Virgin Media £25/mo", "body": "Switch and save.",
                            "savings_estimate": "~£8/mo"},
    )

    _run(_refresh_savings_insights_for_user(UID))

    saved = next(d for d in col.docs if d["category"] == "broadband")
    assert "retired_at" not in saved, "resurrection must clear retired_at"
    assert "retire_reason" not in saved
    assert calls["content"] == 1, "spend_appeared (old_total 0 -> new_total > 0) must trigger a real regen"
    assert saved["title"] == "You pay Virgin Media £25/mo"
    assert saved["triggered_by"] == new_evidence


# ── Refresh loop: pull categories with real evidence are unaffected ──────

def test_pull_category_with_evidence_is_never_retired_for_content_emptiness(monkeypatch):
    # "gym" is a PULL category (Package C) — its title/body are legitimately
    # empty until the user taps "Find me alternatives" (research is PULL).
    # That's content-emptiness, not evidence-emptiness: triggered_by is
    # non-empty here, so the evidence-gone check must never even run.
    gym_doc = {
        "category": "gym", "user_id": UID, "insight_id": "gym-abc",
        "icon": "💪", "label": "Gym", "pinned": False,
        "title": "", "body": "", "savings_estimate": None,
        "content_hash": None, "is_new": False,
        "refreshed_at": NOW - timedelta(days=20), "researched_at": None,
        "prompt_version": PROMPT_VERSION,
        "triggered_by": [{"merchant_key": "pure gym", "monthly_amount": 24.99, "display_name": "Pure Gym"}],
    }
    col, calls = _setup_refresh(
        monkeypatch, applicable=["gym"], docs=[gym_doc],
        triggered_by_map={"gym": gym_doc["triggered_by"]},
        spend_map={"gym": 0.0},  # would confirm evidence-gone IF triggered_by were empty — it isn't
    )

    _run(_refresh_savings_insights_for_user(UID))

    saved = next(d for d in col.docs if d["category"] == "gym")
    assert "retired_at" not in saved
    assert "gym" not in calls["spend_check"], "belt-and-braces must never even run when triggered_by is non-empty"


# ── Refresh loop: a resolved (verified/substituted) doc is never retired ──

def test_verified_saving_doc_is_never_retired_when_evidence_later_rolls_off(monkeypatch):
    # The merchant genuinely stopped and was verified weeks ago; its old
    # transactions have since aged past the 90-day window, so triggered_by
    # now recomputes to empty. That must not retire an already-earned,
    # historical win.
    doc = _broadband_doc(
        verified_savings=17.99, verified_merchant="Virgin Media", verified_at=NOW - timedelta(days=50),
        triggered_by=[],
    )
    col, calls = _setup_refresh(
        monkeypatch, applicable=["broadband"], docs=[doc],
        triggered_by_map={"broadband": []},
        spend_map={"broadband": 0.0},
        verified_map={"broadband": None},  # _check_verified_saving itself no-ops (already resolved)
    )

    _run(_refresh_savings_insights_for_user(UID))

    saved = next(d for d in col.docs if d["category"] == "broadband")
    assert "retired_at" not in saved
    assert saved["verified_savings"] == 17.99


# ── GET /savings-insights excludes retired ───────────────────────────────

def _setup_get_endpoint(monkeypatch, docs):
    col = FakeInsightsCol(docs)
    monkeypatch.setattr(savings_insights, "savings_insights_col", col)
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    # GET /savings-insights now resolves each insight's `job` field via a
    # real per-user kind lookup (app.services.categories.get_category_kinds,
    # ONE DB read per request) — no mongomock here, so stub it out with the
    # built-in kind table rather than hitting Mongo for real.
    async def fake_get_category_kinds(uid):
        from app.services.categories import BUILTIN_CATEGORY_KINDS
        return dict(BUILTIN_CATEGORY_KINDS)
    monkeypatch.setattr(savings_insights, "get_category_kinds", fake_get_category_kinds)
    return col


def test_get_savings_insights_excludes_retired_broadband_but_keeps_others(monkeypatch):
    retired_broadband = _broadband_doc(
        retired_at=NOW - timedelta(days=1), retire_reason="evidence_gone", triggered_by=[],
    )
    other_docs = [
        {
            "category": cat, "user_id": UID, "insight_id": f"{cat}-id",
            "icon": "x", "label": cat.title(), "pinned": False,
            "title": "T", "body": "B", "savings_estimate": None,
            "refreshed_at": NOW, "prompt_version": PROMPT_VERSION,
            "triggered_by": [{"merchant_key": cat, "monthly_amount": 10.0, "display_name": cat}],
        }
        for cat in ["energy", "mortgage", "car_finance", "car_insurance", "mobile", "groceries", "eating_out", "gym"]
    ]
    _setup_get_endpoint(monkeypatch, [retired_broadband] + other_docs)

    result = _run(get_savings_insights(user=USER, _sub=None))

    categories = {r["category"] for r in result}
    assert "broadband" not in categories
    assert categories == {"energy", "mortgage", "car_finance", "car_insurance", "mobile", "groceries", "eating_out", "gym"}
    assert len(result) == 8


def test_get_savings_insights_serves_active_broadband_when_not_retired(monkeypatch):
    active_broadband = _broadband_doc()  # no retired_at
    _setup_get_endpoint(monkeypatch, [active_broadband])

    result = _run(get_savings_insights(user=USER, _sub=None))

    assert len(result) == 1
    assert result[0]["category"] == "broadband"


# ── GET /savings-insights/spotlight excludes retired ─────────────────────

def test_spotlight_never_features_a_retired_insight(monkeypatch):
    retired_broadband = _broadband_doc(
        retired_at=NOW - timedelta(days=1), retire_reason="evidence_gone", triggered_by=[],
        spotlight_retired=False,  # never dismissed from spotlight — only evidence-gone would hide it
    )
    _setup_get_endpoint(monkeypatch, [retired_broadband])
    monkeypatch.setattr(savings_insights, "preferences_col", FakePreferencesCol([]))

    result = _run(get_spotlight_insight(user=USER, _sub=None))

    assert result is None


def test_spotlight_features_an_active_insight_normally(monkeypatch):
    active = _broadband_doc(spotlight_retired=False)
    _setup_get_endpoint(monkeypatch, [active])
    monkeypatch.setattr(savings_insights, "preferences_col", FakePreferencesCol([]))

    result = _run(get_spotlight_insight(user=USER, _sub=None))

    assert result is not None
    assert result["category"] == "broadband"


# ── GET /value-delivered and Penny's insights tool exclude retired ───────

def test_value_delivered_excludes_a_retired_insights_estimate(monkeypatch):
    import app.routers.analytics as analytics

    class _AnalyticsCursor:
        def __init__(self, docs):
            self._docs = docs

        async def to_list(self, n):
            return list(self._docs)

    class _AnalyticsFakeCol:
        def __init__(self, docs):
            self.docs = docs

        def find(self, query=None, projection=None):
            query = query or {}
            return _AnalyticsCursor([d for d in self.docs if _match(d, query)])

    retired_broadband = {
        "user_id": UID, "title": "Switch broadband", "category": "broadband",
        "savings_estimate": "~£5/mo", "user_context": {"contract_end": "March 2027"},
        "retired_at": NOW - timedelta(days=1),
    }
    active_mobile = {
        "user_id": UID, "title": "Switch mobile", "category": "mobile",
        "savings_estimate": "~£10/mo", "user_context": {"contract_end": "Dec 2026"},
    }
    monkeypatch.setattr(analytics, "savings_insights_col", _AnalyticsFakeCol([retired_broadband, active_mobile]))

    result = _run(analytics.get_value_delivered(user=USER))

    assert result["total_monthly_saving"] == 10.0, "the retired broadband estimate must not count"
    assert result["insights_acted_on"] == 1
    assert len(result["breakdown"]) == 1
    assert result["breakdown"][0]["title"] == "Switch mobile"


def test_penny_insights_tool_excludes_a_retired_insight(monkeypatch):
    import app.services.penny_tools as penny_tools
    import app.routers.analytics as analytics_router_module

    retired_broadband = _broadband_doc(
        retired_at=NOW - timedelta(days=1), retire_reason="evidence_gone", triggered_by=[],
    )
    col = FakeInsightsCol([retired_broadband])
    monkeypatch.setattr(penny_tools, "savings_insights_col", col)

    # `_exec_get_insights` also inline-imports and calls
    # `app.routers.analytics.get_value_delivered` for the value_delivered
    # section — stub it directly (per test_penny_tools.py's own established
    # convention for this "fresh import at call time" pattern) so this test
    # only exercises the insights-list filtering, not a second, unmocked
    # DB-touching endpoint.
    async def fake_value_delivered(user):
        return {"insights_acted_on": 0, "total_monthly_saving": 0.0,
                "verified_monthly_saving": 0.0, "breakdown": []}
    monkeypatch.setattr(analytics_router_module, "get_value_delivered", fake_value_delivered)

    result = _run(penny_tools._exec_get_insights(UID))

    assert result["insights"] == []
