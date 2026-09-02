"""Tests for `_refresh_savings_insights_for_user` (backend/app/routers/
savings_insights.py) — the event-driven regen loop.

Bug fixed here: a blanket "skip anything refreshed <7 days ago" early
`continue` ran BEFORE `_regen_reason` was ever consulted, so it silently
suppressed `_regen_reason`'s own decision — including `prompt_upgraded`,
which exists specifically to force a regen when PROMPT_VERSION is bumped
(e.g. 5->6, to invalidate insights carrying corrupt trigger evidence from
the pre-fix substring-matching bug covered in
test_savings_insight_triggers.py). Fix: `_regen_reason` is now the sole
decider. The one branch that legitimately needs an age floor — `spend_changed`,
since ordinary weekly grocery/fuel spend swings can cross the 20%/£10
threshold in both directions inside days — keeps a narrow, local floor
applied only to that reason, not a blanket guard ahead of every branch.

These tests exercise "mobile" — every category is weekly-push now (owner
decision 2026-09-01 retired the old push/pull cadence split, see
CATEGORY_LIFECYCLE in savings_insights.py), so which specific category is
under test no longer matters for this file's purpose; mobile is kept simply
because it's the category these fixtures were originally built against.

No mongomock is available in this environment (see test_verified_saving.py's
own note), so `savings_insights_col` is replaced with a tiny in-memory fake,
and the collaborators `_refresh_savings_insights_for_user` fans out to
(`_detect_insight_categories`, `_find_triggered_transactions`,
`_check_verified_saving`, `_generate_savings_insight_content`) are replaced
with async stubs — the same monkeypatch-the-module-level-name pattern
already established in test_verified_saving.py / test_savings_insight_triggers.py.
"""
import asyncio
from datetime import datetime, timedelta

import app.routers.savings_insights as savings_insights
from app.routers.savings_insights import (
    _refresh_savings_insights_for_user,
    PROMPT_VERSION,
)


UID = "kevin"
NOW = datetime(2026, 8, 27, 12, 0, 0)


class _FrozenDatetime(datetime):
    @classmethod
    def utcnow(cls):
        return NOW


def _run(coro):
    return asyncio.run(coro)


class FakeInsightsCol:
    """Stand-in for the `savings_insights_col` Motor collection — only the
    `find_one`/`update_one`/`insert_one` surface `_refresh_savings_insights_for_user`
    actually calls. Docs are keyed by category (one per category, like a real
    single-user document set), `_id` == category so `update_one`'s `{"_id": ...}`
    filter can find its target without reimplementing a real query engine."""

    def __init__(self, docs):
        self.docs = {d["category"]: dict(d, _id=d["category"]) for d in docs}
        self.updates: list[tuple[str, dict]] = []  # (category, $set) audit trail
        self.inserts: list[dict] = []

    async def find_one(self, query):
        cat = query.get("category")
        return self.docs.get(cat)

    async def update_one(self, filt, update):
        target_id = filt.get("_id")
        for cat, d in self.docs.items():
            if d.get("_id") == target_id:
                d.update(update["$set"])
                self.updates.append((cat, update["$set"]))
                return

    async def insert_one(self, doc):
        self.docs[doc["category"]] = doc
        self.inserts.append(doc)


_UNSET_TTL = object()


def _existing_mobile(*, refreshed_at, prompt_version, triggered_by, content_valid_until=_UNSET_TTL):
    """`content_valid_until` defaults to comfortably in the future — OWNER
    DECISION (2026-09-01): `_regen_reason`'s TTL check now runs on
    `content_valid_until`, not a separate `refreshed_at` window (see
    test_content_ttl.py), so any fixture meant to exercise a DIFFERENT
    regen reason (prompt_upgraded, spend_changed, deadline_window) needs a
    still-valid content_valid_until or the TTL branch fires first and masks
    what the test is actually trying to isolate. Pass an explicit value to
    test the TTL branch itself."""
    return {
        "category": "mobile", "user_id": UID, "insight_id": "mobile-abc",
        "icon": "📱", "label": "Mobile", "pinned": False,
        "title": "Old title", "body": "Old body", "savings_estimate": "£20/mo",
        "content_hash": "old-hash", "is_new": False,
        "refreshed_at": refreshed_at, "prompt_version": prompt_version,
        "triggered_by": triggered_by,
        "content_valid_until": (NOW + timedelta(days=6)) if content_valid_until is _UNSET_TTL else content_valid_until,
    }


def _passive_doc(category, *, triggered_by):
    """energy/groceries always get force-appended to the applicable list by
    `_refresh_savings_insights_for_user` itself; give them an already-current,
    already-matching doc (and, for groceries, a fresh `researched_at` — it's
    a PULL category under Package C, so without one it would be treated as
    stale and cleared by the new pull-category branch) so they resolve to a
    no-op and don't interfere with the "mobile"-focused assertions below."""
    return {
        "category": category, "user_id": UID, "insight_id": f"{category}-abc",
        "icon": "x", "label": category.title(), "pinned": False,
        "title": "T", "body": "B", "savings_estimate": None,
        "content_hash": "h", "is_new": False,
        "refreshed_at": NOW, "researched_at": NOW, "prompt_version": PROMPT_VERSION,
        "triggered_by": triggered_by,
    }


_UNSET = object()  # sentinel distinguishing "use the default stub content" from "return None"


def _setup(monkeypatch, *, mobile_doc, mobile_triggered_by, generated_content=_UNSET, no_mobile_doc=False):
    """Wires the fakes/stubs. `_detect_insight_categories` returns just
    "mobile" (energy/groceries get force-appended by the function under test
    regardless, so they're pre-seeded as harmless no-ops via `_passive_doc`).
    `_find_triggered_transactions` returns `mobile_triggered_by` for "mobile"
    and an empty list (matching the passive docs) for energy/groceries.
    `_check_verified_saving` always reports "not verified" — that closure
    path is covered by test_verified_saving.py, not here.

    `generated_content`: pass `None` explicitly to simulate a generation
    failure (e.g. Tavily quota exhausted) — `_generate_savings_insight_content`
    then returns `None` itself, exactly as it does in production. Leave
    unset to get the default successful-generation stub content.

    `no_mobile_doc`: when True, no "mobile" document is pre-seeded —
    exercises the brand-new-document path.
    """
    seed = [_passive_doc("energy", triggered_by=[]), _passive_doc("groceries", triggered_by=[])]
    if not no_mobile_doc:
        seed.insert(0, mobile_doc)
    col = FakeInsightsCol(seed)
    monkeypatch.setattr(savings_insights, "savings_insights_col", col)
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)

    async def fake_detect(user_id):
        return ["mobile"]

    async def fake_triggered(user_id, category_key):
        return mobile_triggered_by if category_key == "mobile" else []

    async def fake_verified(user_id, existing):
        return None

    calls = {"content": 0}

    async def fake_content(category_key, user_context, triggered_by):
        calls["content"] += 1
        if generated_content is _UNSET:
            return {"title": "New title", "body": "New body", "savings_estimate": "£30/mo"}
        return generated_content

    monkeypatch.setattr(savings_insights, "_detect_insight_categories", fake_detect)
    monkeypatch.setattr(savings_insights, "_find_triggered_transactions", fake_triggered)
    monkeypatch.setattr(savings_insights, "_check_verified_saving", fake_verified)
    monkeypatch.setattr(savings_insights, "_generate_savings_insight_content", fake_content)

    return col, calls


# ── The bug: prompt_upgraded must fire regardless of age ───────────────────

def test_stale_prompt_version_regenerates_even_when_refreshed_2_days_ago(monkeypatch):
    # Same triggered_by before/after (no spend change) — the ONLY reason
    # this should regenerate is prompt_upgraded. Under the old code, the
    # age<7 early-continue ran before _regen_reason was ever consulted and
    # would have swallowed this entirely.
    triggered_by = [{"merchant_key": "ee", "monthly_amount": 25.0, "display_name": "EE"}]
    mobile_doc = _existing_mobile(
        refreshed_at=NOW - timedelta(days=2),
        prompt_version=PROMPT_VERSION - 1,
        triggered_by=triggered_by,
    )
    col, calls = _setup(monkeypatch, mobile_doc=mobile_doc, mobile_triggered_by=triggered_by)

    _run(_refresh_savings_insights_for_user(UID))

    assert calls["content"] == 1, "prompt_upgraded must trigger a real regen, not be age-suppressed"
    mobile = col.docs["mobile"]
    assert mobile["prompt_version"] == PROMPT_VERSION
    assert mobile["title"] == "New title"
    assert mobile["refreshed_at"] == NOW
    assert mobile["researched_at"] == NOW, "a real content regen must also stamp researched_at"


# ── No material change: skip the LLM, but keep triggered_by fresh ──────────

def test_no_material_change_skips_regen_but_still_refreshes_triggered_by(monkeypatch):
    old_triggered = [{"merchant_key": "ee", "monthly_amount": 25.0, "display_name": "EE", "occurrences": 1}]
    # Same total monthly_amount (25.0) — no spend_changed/spend_appeared —
    # but a different `occurrences` count, so we can prove the stored
    # triggered_by list is actually replaced, not just left alone because
    # nothing happened to look at.
    new_triggered = [{"merchant_key": "ee", "monthly_amount": 25.0, "display_name": "EE", "occurrences": 2}]
    mobile_doc = _existing_mobile(
        refreshed_at=NOW - timedelta(days=2),
        prompt_version=PROMPT_VERSION,
        triggered_by=old_triggered,
    )
    col, calls = _setup(monkeypatch, mobile_doc=mobile_doc, mobile_triggered_by=new_triggered)

    _run(_refresh_savings_insights_for_user(UID))

    assert calls["content"] == 0, "nothing material changed — must not pay for an LLM call"
    mobile = col.docs["mobile"]
    assert mobile["title"] == "Old title"  # untouched — no regen happened
    assert mobile["triggered_by"] == new_triggered  # but evidence still refreshed
    assert mobile["is_new"] is False
    # refreshed_at must NOT be bumped by the no-op path — only a real regen
    # (or first-write) advances it, otherwise a stale insight could look
    # artificially fresh forever without ever having been rewritten.
    assert mobile["refreshed_at"] == NOW - timedelta(days=2)


# ── spend_changed keeps a minimum-age floor ─────────────────────────────────

def test_spend_changed_is_suppressed_below_the_seven_day_floor(monkeypatch):
    old_triggered = [{"merchant_key": "ee", "monthly_amount": 25.0, "display_name": "EE"}]
    # +£20/mo and +80% — comfortably past the 20%/£10 spend_changed threshold.
    new_triggered = [{"merchant_key": "ee", "monthly_amount": 45.0, "display_name": "EE"}]
    mobile_doc = _existing_mobile(
        refreshed_at=NOW - timedelta(days=2),  # below the 7-day floor
        prompt_version=PROMPT_VERSION,
        triggered_by=old_triggered,
    )
    col, calls = _setup(monkeypatch, mobile_doc=mobile_doc, mobile_triggered_by=new_triggered)

    _run(_refresh_savings_insights_for_user(UID))

    assert calls["content"] == 0, "spend_changed inside the 7-day floor must not spend an LLM call"
    mobile = col.docs["mobile"]
    assert mobile["title"] == "Old title"
    assert mobile["triggered_by"] == new_triggered  # evidence still kept current


def test_spend_changed_fires_once_the_seven_day_floor_has_passed(monkeypatch):
    old_triggered = [{"merchant_key": "ee", "monthly_amount": 25.0, "display_name": "EE"}]
    new_triggered = [{"merchant_key": "ee", "monthly_amount": 45.0, "display_name": "EE"}]
    mobile_doc = _existing_mobile(
        refreshed_at=NOW - timedelta(days=7),  # at the floor — must be allowed through
        prompt_version=PROMPT_VERSION,
        triggered_by=old_triggered,
    )
    col, calls = _setup(monkeypatch, mobile_doc=mobile_doc, mobile_triggered_by=new_triggered)

    _run(_refresh_savings_insights_for_user(UID))

    assert calls["content"] == 1, "a genuine spend swing must still regen once past the floor"
    mobile = col.docs["mobile"]
    assert mobile["title"] == "New title"
    assert mobile["refreshed_at"] == NOW


# ── Generation failure (e.g. Tavily quota exhausted) must not strand stale
# ── evidence, but also must not fake a successful regen ────────────────────

def test_generation_failure_refreshes_triggered_by_but_not_refreshed_at_or_version(monkeypatch):
    # prompt_upgraded forces `reason` to fire regardless of age, so a real
    # attempt is made — but _generate_savings_insight_content comes back
    # empty (Tavily HTTP 432 in production). The stored triggered_by is
    # stale/corrupt (old substring-matching bug); the freshly computed one
    # is correct and free, so it must still be persisted even though the
    # copy could not be regenerated. refreshed_at/prompt_version must stay
    # put so `reason` keeps firing on the next pass instead of going quiet
    # for 30 days on a failed attempt.
    old_triggered = [{"merchant_key": "ee", "monthly_amount": 25.0, "display_name": "EE"}]
    new_triggered = [{"merchant_key": "ee", "monthly_amount": 25.0, "display_name": "EE", "occurrences": 3}]
    mobile_doc = _existing_mobile(
        refreshed_at=NOW - timedelta(days=2),
        prompt_version=PROMPT_VERSION - 1,
        triggered_by=old_triggered,
    )
    col, calls = _setup(
        monkeypatch, mobile_doc=mobile_doc, mobile_triggered_by=new_triggered, generated_content=None,
    )

    _run(_refresh_savings_insights_for_user(UID))

    assert calls["content"] == 1, "a real generation attempt must still be made"
    mobile = col.docs["mobile"]
    assert mobile["triggered_by"] == new_triggered, "fresh evidence must replace the stale/corrupt list"
    assert mobile["is_new"] is False
    assert mobile["title"] == "Old title", "copy must not change — generation failed"
    assert mobile["refreshed_at"] == NOW - timedelta(days=2), "a failed attempt must not reset the TTL clock"
    assert mobile["prompt_version"] == PROMPT_VERSION - 1, "reason must keep firing next pass until generation succeeds"


def test_generation_failure_with_no_existing_doc_inserts_nothing(monkeypatch):
    # Brand-new document, no prior state to preserve or correct — a failed
    # generation attempt simply has nothing to write.
    triggered_by = [{"merchant_key": "ee", "monthly_amount": 25.0, "display_name": "EE"}]
    col, calls = _setup(
        monkeypatch, mobile_doc=None, mobile_triggered_by=triggered_by,
        generated_content=None, no_mobile_doc=True,
    )

    _run(_refresh_savings_insights_for_user(UID))

    assert calls["content"] == 1
    assert "mobile" not in col.docs
    assert col.inserts == []
