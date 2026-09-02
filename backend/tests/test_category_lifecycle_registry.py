"""Tests for the STRUCTURAL FIX to the car_finance oscillation bug (owner
phone report 2026-09-01, verbatim: "whenever you do your fix the ones that
didn't have content now have content and the one that did didn't, what is
happening here, and should we render a card if there is no content"), AND
the SAME-DAY cost-driven reversal (owner decision 2026-09-01, verbatim:
"this pattern would mean that users would do a lot of searches which mean
tavily calls would be high, I think the app should be responsible for the
refreshes, but it should indicate an expiry on the offers... these should
come on a weekly basis") that retired the push/pull cadence split entirely.

Four things, each covered by its own section below:

1. car_finance's push/pull "dual membership" was really an EXPLICIT-vs-
   IMPLICIT restatement of the same fact. `CATEGORY_LIFECYCLE` made that a
   single, explicit, auditable registry instead of an implicit derivation.
   The reversal then collapsed every value in it to "push" — the registry
   itself (and the single-membership test) stays, in case a cadence class
   returns later, but today it classifies everything the same way.

2. Cadence (CATEGORY_LIFECYCLE) and "does this category have a real
   deal/contract/renewal date anchoring a claim's honesty"
   (`_CATEGORIES_WITHOUT_WORKFLOW_EXPIRY`) used to coincide 1:1 (every pull
   category was also a no-anchor category) and got derived from the SAME
   dict as a result. They no longer coincide — every category is push now,
   but car_finance/gym/subscriptions/groceries/eating_out still have no
   anchor — so `_CATEGORIES_WITHOUT_WORKFLOW_EXPIRY` is re-derived directly
   from CATEGORY_WORKFLOWS again, independent of CATEGORY_LIFECYCLE.

3. `_derive_insight_state` no longer branches on category at all: "fresh"
   requires real content AND `now < content_valid_until`
   (`_compute_content_valid_until`), for every category uniformly. The old
   "researched_at TTL recency ALONE, no content check" bug (the car_finance
   oscillation) is closed the same way, just without a push/pull split.

4. `isCompactPullInsight` (frontend) used to check `insight.is_new` BEFORE
   `insight.state`, unconditionally forcing a full card render whenever
   `is_new` was true — even when `state` was "quiet" (no content). That
   override is deleted; `state` alone decides compact vs. full now, and the
   backend's invariant (section 3) guarantees `state === "fresh"` never
   occurs without content, so there's nothing left for `is_new` to safely
   override. Not unit-testable from Python (see
   frontend/app/insights/InsightsPage.tsx's `isCompactPullInsight` and the
   frontend design twin at frontend/app/design/insights-live/fixtures.ts),
   but the double-refresh idempotency test below proves the BACKEND half of
   the contract this frontend fix now safely relies on: state doesn't
   oscillate — extended to cover an EXPIRY transition too, not just the
   original hollow-content case.
"""
from datetime import datetime, timedelta

import app.routers.savings_insights as savings_insights
from app.routers.savings_insights import (
    CATEGORY_LIFECYCLE,
    INSIGHT_CATEGORIES,
    CATEGORY_WORKFLOWS,
    _CATEGORIES_WITHOUT_WORKFLOW_EXPIRY,
    _derive_insight_state,
    _serialize_insight,
    _refresh_savings_insights_for_user,
    _compute_content_valid_until,
    IS_NEW_TTL,
    DEFAULT_RESEARCH_TTL,
    PROMPT_VERSION,
)


NOW = datetime(2026, 9, 1, 18, 2, 0)
UID = "kevin.maingi12@gmail.com"


class _FrozenDatetime(datetime):
    @classmethod
    def utcnow(cls):
        return NOW


def _run(coro):
    import asyncio
    return asyncio.run(coro)


# ── 1. Registry: single source of truth, now uniformly "push" ──────────────

def test_registry_classifies_every_insight_category_exactly_once():
    """The real, shipped registry: every INSIGHT_CATEGORIES key appears in
    CATEGORY_LIFECYCLE exactly once, with a value that is exactly one of
    push/pull — never both, never neither, never a typo'd third value."""
    assert set(CATEGORY_LIFECYCLE) == set(INSIGHT_CATEGORIES)
    assert set(CATEGORY_LIFECYCLE.values()) <= {"push", "pull"}


def test_every_category_is_push_after_the_2026_09_01_reversal():
    """Owner decision 2026-09-01: the pull cadence is retired outright —
    every category, without exception, is weekly-push now."""
    assert set(CATEGORY_LIFECYCLE.values()) == {"push"}
    assert all(kind == "push" for kind in CATEGORY_LIFECYCLE.values())


def _registry_is_valid(categories: set[str], lifecycle: dict[str, str]) -> bool:
    """Standalone replica of the module-level assertion's logic (not a call
    into the module — this proves the CHECK ITSELF catches the failure
    modes the task calls out, independent of whether the shipped registry
    happens to already be correct)."""
    if set(lifecycle) != categories:
        return False
    if not set(lifecycle.values()) <= {"push", "pull"}:
        return False
    return True


def test_registry_validation_fails_when_a_category_is_missing_entirely():
    cats = {"energy", "car_finance"}
    broken = {"energy": "push"}  # car_finance in neither lifecycle
    assert _registry_is_valid(cats, broken) is False


def test_registry_validation_fails_on_an_invalid_lifecycle_value():
    cats = {"energy", "car_finance"}
    broken = {"energy": "push", "car_finance": "push_and_pull"}
    assert _registry_is_valid(cats, broken) is False


def test_registry_validation_passes_the_real_shipped_registry():
    assert _registry_is_valid(set(INSIGHT_CATEGORIES), CATEGORY_LIFECYCLE) is True


# ── 2. Cadence vs. deadline-anchor: two facts that no longer coincide ──────

def test_car_finance_is_push_cadence_but_still_has_no_deadline_anchor():
    """The exact split this reversal introduced: car_finance's CADENCE is
    now push (same as every category), but it still has no real
    deal/contract/renewal date in its CATEGORY_WORKFLOWS entry (type/rate/
    outstanding/months_remaining — none of those keys is in
    `_DEADLINE_KEYS`), so it still belongs in
    `_CATEGORIES_WITHOUT_WORKFLOW_EXPIRY` for the dated-promo guardrail's
    purposes. These two facts about car_finance now DISAGREE, which is
    exactly the point: they are not the same fact any more."""
    assert CATEGORY_LIFECYCLE["car_finance"] == "push"
    assert "car_finance" in _CATEGORIES_WITHOUT_WORKFLOW_EXPIRY


def test_no_expiry_anchor_set_matches_the_five_categories_with_no_deadline_field():
    """Re-derived directly from CATEGORY_WORKFLOWS/_DEADLINE_KEYS now (not
    from CATEGORY_LIFECYCLE) — pins the actual five categories with no
    deal_end/contract_end/renewal_date workflow step, independent of
    cadence."""
    assert _CATEGORIES_WITHOUT_WORKFLOW_EXPIRY == frozenset(
        {"car_finance", "gym", "subscriptions", "groceries", "eating_out"}
    )


def test_no_expiry_anchor_set_is_computed_from_category_workflows_not_lifecycle():
    """If CATEGORY_LIFECYCLE were (wrongly) reintroduced as the source for
    this set, collapsing every value to "push" would make the set empty —
    it must not be, proving the derivation genuinely comes from
    CATEGORY_WORKFLOWS independently."""
    assert len(_CATEGORIES_WITHOUT_WORKFLOW_EXPIRY) > 0
    assert all(kind == "push" for kind in CATEGORY_LIFECYCLE.values())  # cadence is uniform...
    assert len(_CATEGORIES_WITHOUT_WORKFLOW_EXPIRY) > 0  # ...but the anchor set isn't


def test_every_category_with_a_deadline_workflow_step_is_excluded_from_the_anchor_set():
    for cat, wf in CATEGORY_WORKFLOWS.items():
        has_anchor = any(step.get("id") in ("deal_end", "contract_end", "renewal_date") for step in wf.get("steps", []))
        if has_anchor:
            assert cat not in _CATEGORIES_WITHOUT_WORKFLOW_EXPIRY, cat


# ── 3. state=fresh requires content AND an unexpired TTL, every category ───

def test_state_is_quiet_not_fresh_when_content_valid_until_is_recent_but_content_is_blank(monkeypatch):
    """THE bug: TTL recency alone used to be enough to return "fresh". A doc
    that's inside its TTL but blank must still be quiet."""
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    doc = {
        "category": "car_finance", "title": "", "body": "",
        "content_valid_until": NOW + timedelta(days=3),  # well inside the TTL
    }
    assert _derive_insight_state(doc) == "quiet"


def test_serializer_downgrades_when_serve_time_stripping_empties_a_fresh_doc(monkeypatch):
    """THE INVARIANT's second enforcement point: a doc whose STORED
    title/body pass `_has_researched_content` (so `_derive_insight_state`
    legitimately said "fresh") but whose content is entirely an unsupported
    savings claim — stripped to "" by `_strip_unsupported_savings_claims`
    inside `_serialize_insight`, using the doc's OWN `triggered_by` (as if a
    later cron pass had refreshed it to figures the stored prose no longer
    matches) — must be re-derived as `quiet`, not served as `fresh` with
    nothing in it. This is the reconstructed mechanism behind the reported
    car_finance oscillation: state said fresh, the content that justified it
    evaporated one step later in the same read."""
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    doc = {
        "_id": "x", "insight_id": "car_finance-x", "category": "car_finance",
        "title": "Refinancing could save up to £999 a month",
        "body": "Could save up to £999 a month versus your current deal.",
        "savings_estimate": None,  # derivability guard already nulled it
        "content_valid_until": NOW + timedelta(days=3),
        "pinned": False, "is_new": False, "refreshed_at": NOW,
        "triggered_by": [],  # nothing of the user's own to anchor £999 against
    }
    assert _derive_insight_state(doc) == "fresh"  # content WAS non-blank when stored
    out = _serialize_insight(doc)
    assert out["state"] == "quiet"  # ...but re-serve strips it to "", so state downgrades
    assert out["title"] == ""
    assert out["body"] == ""


def test_contentless_car_finance_with_is_new_true_still_serializes_quiet(monkeypatch):
    """The frontend twin's fixture requirement, proven server-side: a
    contentless doc with `is_new: True` must still resolve to `state:
    "quiet"` — `is_new` never elevates `state`, only (client-side) a compact
    row's "new" affordance."""
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    doc = {
        "_id": "x", "insight_id": "car_finance-x", "category": "car_finance",
        "title": "", "body": "", "savings_estimate": None,
        "content_valid_until": None, "pinned": False, "is_new": True,
        "refreshed_at": NOW, "triggered_by": [
            {"merchant_key": "m&s loans", "display_name": "M&S Loans", "monthly_amount": 428.86},
        ],
    }
    out = _serialize_insight(doc)
    assert out["state"] == "quiet"
    assert out["title"] == ""
    assert out["body"] == ""
    assert out["is_new"] is True  # still surfaced — just doesn't force a full card


def test_expired_content_valid_until_serializes_quiet_even_with_real_content(monkeypatch):
    """The reversal's own headline behaviour: a category with genuine,
    well-formed researched content still goes quiet the moment its TTL
    passes — this is the NORMAL between-refreshes state now, not an
    anomaly."""
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    doc = {
        "_id": "x", "insight_id": "gym-x", "category": "gym",
        "title": "Pure Gym's rolling monthly beats most annual contracts",
        "body": "No-contract gyms are typically cheaper for irregular attendance.",
        "savings_estimate": None, "claim_valid_until": None,
        "content_valid_until": NOW - timedelta(hours=1),  # expired
        "researched_at": NOW - DEFAULT_RESEARCH_TTL - timedelta(hours=1),
        "pinned": False, "is_new": False, "refreshed_at": NOW, "triggered_by": [],
    }
    out = _serialize_insight(doc)
    assert out["state"] == "quiet"
    assert out["title"] == ""
    assert out["expiry_line"] is None


# ── is_new time-box ──────────────────────────────────────────────────────────

def test_is_new_is_served_false_once_past_the_ttl(monkeypatch):
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    doc = {
        "_id": "x", "insight_id": "car_finance-x", "category": "car_finance",
        "title": "", "body": "", "savings_estimate": None,
        "content_valid_until": None, "pinned": False, "is_new": True,
        "refreshed_at": NOW - IS_NEW_TTL - timedelta(days=1),
        "triggered_by": [],
    }
    out = _serialize_insight(doc)
    assert out["is_new"] is False


def test_is_new_is_served_true_within_the_ttl(monkeypatch):
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    doc = {
        "_id": "x", "insight_id": "car_finance-x", "category": "car_finance",
        "title": "", "body": "", "savings_estimate": None,
        "content_valid_until": None, "pinned": False, "is_new": True,
        "refreshed_at": NOW - timedelta(days=1),
        "triggered_by": [],
    }
    out = _serialize_insight(doc)
    assert out["is_new"] is True


def test_is_new_false_with_no_anchor_timestamp_at_all_is_never_true():
    # No refreshed_at, no created_at — can't be "recent", so must not report new.
    doc = {
        "_id": "x", "insight_id": "car_finance-x", "category": "car_finance",
        "title": "", "body": "", "savings_estimate": None,
        "content_valid_until": None, "pinned": False, "is_new": True,
        "triggered_by": [],
    }
    out = _serialize_insight(doc)
    assert out["is_new"] is False


# ── 4. Oscillation regression: double refresh must be idempotent ───────────

class FakeInsightsCol:
    def __init__(self, docs):
        self.docs = {d["category"]: dict(d, _id=d["category"]) for d in docs}

    async def find_one(self, query):
        return self.docs.get(query.get("category"))

    async def update_one(self, filt, update):
        target_id = filt.get("_id")
        for d in self.docs.values():
            if d.get("_id") == target_id:
                d.update(update.get("$set", {}))
                for k in update.get("$unset", {}):
                    d.pop(k, None)
                return

    async def insert_one(self, doc):
        self.docs[doc["category"]] = doc


def _car_finance_shaped_doc():
    """Byte-for-byte the real shape confirmed live on
    kevin.maingi12@gmail.com's account (car_finance-dd836d89): contentless,
    never researched, one recurring trigger (M&S Loans)."""
    return {
        "category": "car_finance", "user_id": UID, "insight_id": "car_finance-dd836d89",
        "icon": "🚘", "label": "Car Finance", "pinned": False,
        "title": "", "body": "", "savings_estimate": None,
        "claim_valid_until": None, "researched_at": None, "content_valid_until": None,
        "content_hash": None, "is_new": False,
        "created_at": NOW - timedelta(days=27),
        "refreshed_at": NOW - timedelta(hours=12),
        "prompt_version": PROMPT_VERSION,
        "triggered_by": [
            {"merchant_key": "m&s loans", "display_name": "M&S Loans",
             "monthly_amount": 428.86, "occurrences": 3, "is_recurring": True},
        ],
    }


def _passive_pushed(category):
    """`_refresh_savings_insights_for_user` force-appends "energy" and
    "groceries" to every user's applicable list regardless of what
    `_detect_insight_categories` returns — give it an already-current doc so
    it resolves to a no-op and doesn't interfere with the car_finance-
    focused assertions."""
    return {
        "category": category, "user_id": UID, "insight_id": f"{category}-abc",
        "icon": "x", "label": category.title(), "pinned": False,
        "title": "T", "body": "B", "savings_estimate": None,
        "content_hash": "h", "is_new": False,
        "refreshed_at": NOW, "researched_at": NOW,
        "content_valid_until": NOW + DEFAULT_RESEARCH_TTL,
        "prompt_version": PROMPT_VERSION,
        "triggered_by": [],
    }


_NOT_EXPECTED = object()  # distinct from `None`, which is a legitimate "generation failed" stub return


def _setup(monkeypatch, doc, *, generated_content=_NOT_EXPECTED):
    col = FakeInsightsCol([doc, _passive_pushed("energy"), _passive_pushed("groceries")])
    monkeypatch.setattr(savings_insights, "savings_insights_col", col)
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)

    async def fake_detect(user_id):
        return ["car_finance"]

    async def fake_triggered(user_id, category_key):
        return doc["triggered_by"] if category_key == "car_finance" else []

    async def fake_verified(user_id, existing):
        return None

    async def fake_content(category_key, user_context, triggered_by):
        # Default (`_NOT_EXPECTED`): a doc that genuinely has no
        # `_regen_reason` (steady state, valid content_valid_until, no
        # material change) must never call generation at all — fails
        # loudly here if it does. Tests exercising a real regen (success OR
        # a simulated failure — pass `generated_content=None` explicitly to
        # simulate the latter) pass their own stub via `generated_content`.
        if generated_content is _NOT_EXPECTED:
            raise AssertionError(
                f"_generate_savings_insight_content unexpectedly called for {category_key}"
            )
        return generated_content

    monkeypatch.setattr(savings_insights, "_detect_insight_categories", fake_detect)
    monkeypatch.setattr(savings_insights, "_find_triggered_transactions", fake_triggered)
    monkeypatch.setattr(savings_insights, "_check_verified_saving", fake_verified)
    monkeypatch.setattr(savings_insights, "_generate_savings_insight_content", fake_content)
    return col


def test_double_refresh_pass_is_idempotent_for_a_contentless_car_finance_doc(monkeypatch):
    """The regression test for the reported oscillation, updated for the
    2026-09-01 TTL reversal: a car_finance-shaped doc with NO
    `content_valid_until` at all (the exact real shape confirmed live —
    `_car_finance_shaped_doc` predates this field) is a legacy/never-
    backfilled doc, so `_regen_reason`'s TTL branch now fires immediately
    (see the comment above that branch) — a real regen IS attempted on the
    first pass, unlike before this reversal. The idempotency property still
    holds, just one step later: once a successful regen backfills
    content_valid_until (pass 1: quiet -> fresh), a second pass with no
    material change must not flip it back to quiet (pass 2: fresh stays
    fresh) — the doc reaches a stable state and STAYS there, it doesn't
    oscillate once touched more than once."""
    col = _setup(
        monkeypatch, _car_finance_shaped_doc(),
        generated_content={
            "title": "Your PCP rate looks above the current market average",
            "body": "Typical PCP APRs for a similar vehicle are running 7.9-9.9% right now.",
            "savings_estimate": None, "claim_valid_until": None,
        },
    )

    _run(_refresh_savings_insights_for_user(UID))
    state_after_first = _serialize_insight(col.docs["car_finance"])["state"]

    _run(_refresh_savings_insights_for_user(UID))
    state_after_second = _serialize_insight(col.docs["car_finance"])["state"]

    assert state_after_first == "fresh"  # backfilled by the first real regen
    assert state_after_second == "fresh"  # ...and STAYS fresh, no oscillation
    assert col.docs["car_finance"]["content_valid_until"] is not None


def test_double_refresh_pass_is_idempotent_when_content_is_actually_fresh(monkeypatch):
    """Same idempotency property, the other direction: a doc that genuinely
    HAS current researched content must keep reporting `fresh` across
    repeated cron passes too (the fix must not overcorrect into always
    forcing quiet)."""
    doc = _car_finance_shaped_doc()
    doc.update({
        "title": "Your PCP rate looks above the current market average",
        "body": "Typical PCP APRs for a similar vehicle are running 7.9-9.9% right now.",
        "researched_at": NOW - timedelta(hours=1),
        "content_valid_until": NOW - timedelta(hours=1) + DEFAULT_RESEARCH_TTL,
    })
    col = _setup(monkeypatch, doc)

    _run(_refresh_savings_insights_for_user(UID))
    state_after_first = _serialize_insight(col.docs["car_finance"])["state"]

    _run(_refresh_savings_insights_for_user(UID))
    state_after_second = _serialize_insight(col.docs["car_finance"])["state"]

    assert state_after_first == "fresh"
    assert state_after_second == "fresh"


def test_double_refresh_pass_is_idempotent_through_an_expiry_transition(monkeypatch):
    """New for the reversal: a doc whose content_valid_until has ALREADY
    passed now triggers a real regen ATTEMPT every pass (the TTL branch of
    `_regen_reason` fires on content_valid_until, see the comment above
    it) — but if generation keeps failing (e.g. a Tavily outage), the doc
    must keep reporting `quiet` across repeated passes rather than
    oscillating: a failed attempt never partially writes content_valid_until
    (see the "generation failed" branch in
    `_refresh_savings_insights_for_user`), so nothing here can flip the
    state to a hollow "fresh"."""
    doc = _car_finance_shaped_doc()
    doc.update({
        "title": "Your PCP rate looks above the current market average",
        "body": "Typical PCP APRs for a similar vehicle are running 7.9-9.9% right now.",
        "researched_at": NOW - DEFAULT_RESEARCH_TTL - timedelta(days=1),
        "content_valid_until": NOW - timedelta(days=1),  # already expired
        "refreshed_at": NOW - timedelta(hours=1),  # inside the no-material-change window
    })
    col = _setup(monkeypatch, doc, generated_content=None)  # generation keeps failing

    _run(_refresh_savings_insights_for_user(UID))
    state_after_first = _serialize_insight(col.docs["car_finance"])["state"]

    _run(_refresh_savings_insights_for_user(UID))
    state_after_second = _serialize_insight(col.docs["car_finance"])["state"]

    assert state_after_first == "quiet"
    assert state_after_second == "quiet"
