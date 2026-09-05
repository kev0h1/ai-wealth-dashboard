"""Tests for the Insights honesty review's STRUCTURAL FIX (owner phone
report 2026-09-01, verbatim: "insights screen is still very broken... some
have data some do not and it ruins the credibility of this page"), updated
for the SAME-DAY cost-driven reversal (owner decision 2026-09-01, verbatim:
"the app should be responsible for the refreshes... a ttl on the entry")
that retired the push/pull cadence split — see CATEGORY_LIFECYCLE and
test_category_lifecycle_registry.py.

Covers:
  - `_derive_insight_state` exhaustiveness — every stored-field combination
    this module can produce maps to exactly one of the FOUR live states
    (verified, substituted, fresh, quiet — "push_stale" is retired, folded
    into "quiet" now that every category ages out the same TTL-driven way,
    see the state-machine comment above `_derive_insight_state`),
    parametrised.
  - Each live incoherence (A-D) as its own regression fixture, reproduced
    against the exact document shapes confirmed live on
    kevin.maingi12@gmail.com's account on 2026-09-01 (see the inline comment
    on each fixture for the real field values pulled from Mongo).

Incoherence E (hero copy "1 of 7 open ideas" vs "8 cards rendered") is a
frontend-only fix (InsightsPage.tsx's `heroResolvedCount` / `resolvedClause`)
— nothing here to unit test in Python; the shared `open` definition (states
fresh/quiet) IS covered below via `test_derive_insight_state_exhaustive`,
since the frontend's hero now switches on the same `state` field this
proves is well-defined.
"""
from datetime import datetime, timedelta

import pytest

import app.routers.savings_insights as savings_insights
from app.routers.savings_insights import (
    _derive_insight_state,
    _serialize_insight,
    _strip_unsupported_savings_claims,
    _refresh_savings_insights_for_user,
    _expiry_line,
    _job_for_category,
)
from app.services.categories import BUILTIN_CATEGORY_KINDS, COMMITMENT, DISCRETIONARY, MOVEMENT


NOW = datetime(2026, 9, 1, 12, 0, 0)


class _FrozenDatetime(datetime):
    @classmethod
    def utcnow(cls):
        return NOW


def _run(coro):
    import asyncio
    return asyncio.run(coro)


# ── State machine exhaustiveness ────────────────────────────────────────────

@pytest.mark.parametrize(
    "overrides,expected",
    [
        # retired — checked first, wins over everything else
        ({"retired_at": NOW}, "retired"),
        ({"retired_at": NOW, "verified_at": NOW}, "retired"),
        # verified / substituted — mutually exclusive by construction once
        # only one of the two raw fields is set
        ({"verified_at": NOW}, "verified"),
        ({"substituted_at": NOW}, "substituted"),
        # both set (incoherence A's corrupted shape) — first-write-wins
        ({"verified_at": NOW, "substituted_at": NOW - timedelta(minutes=50)}, "substituted"),
        ({"verified_at": NOW - timedelta(minutes=50), "substituted_at": NOW}, "verified"),
        ({"verified_at": NOW, "substituted_at": NOW}, "substituted"),  # tie -> <= favours substituted
        # OWNER DECISION (2026-09-01): every category ages the same way now
        # via `content_valid_until` — "mobile" (formerly push) and "gym"
        # (formerly pull) are deliberately interleaved below to prove there
        # is no longer a category-shaped branch in this function at all.
        ({"category": "mobile", "title": "T", "body": "B",
          "content_valid_until": NOW + timedelta(days=1)}, "fresh"),
        ({"category": "gym", "title": "T", "body": "B",
          "content_valid_until": NOW + timedelta(days=1)}, "fresh"),
        ({"category": "mobile", "title": "", "body": "",
          "content_valid_until": NOW + timedelta(days=1)}, "quiet"),
        ({"category": "mobile", "title": None, "body": None,
          "content_valid_until": NOW + timedelta(days=1)}, "quiet"),
        ({"category": "mobile", "title": "T", "body": "",
          "content_valid_until": NOW + timedelta(days=1)}, "quiet"),  # half-written doc
        ({"category": "mobile"}, "quiet"),  # fields entirely absent
        ({"category": "gym", "title": "T", "body": "B",
          "content_valid_until": NOW - timedelta(minutes=1)}, "quiet"),  # expired TTL
        ({"category": "mobile", "title": "T", "body": "B",
          "content_valid_until": NOW - timedelta(days=200)}, "quiet"),  # long-expired TTL
        ({"category": "gym", "title": "T", "body": "B", "content_valid_until": None}, "quiet"),
        ({"category": "gym"}, "quiet"),  # field absent entirely
        # STRUCTURAL FIX (owner phone report 2026-09-01, the car_finance
        # oscillation): TTL recency alone is NOT sufficient for "fresh" any
        # more — a doc with a live `content_valid_until` but no actual
        # title/body text (the exact confirmed live shape of the "hollow
        # full card" bug) must still be quiet, not fresh with nothing to
        # show.
        ({"category": "gym", "title": "", "body": "",
          "content_valid_until": NOW + timedelta(days=1)}, "quiet"),
        ({"category": "gym", "title": "T", "body": "",
          "content_valid_until": NOW + timedelta(days=1)}, "quiet"),
    ],
)
def test_derive_insight_state_exhaustive(monkeypatch, overrides, expected):
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    base = {"category": "mobile"}
    base.update(overrides)
    assert _derive_insight_state(base) == expected


def test_derive_insight_state_return_type_is_always_one_of_the_four_live_states(monkeypatch):
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    live_states = {"verified", "substituted", "fresh", "quiet", "retired"}
    combos = [
        {}, {"verified_at": NOW}, {"substituted_at": NOW}, {"retired_at": NOW},
        {"category": "gym"}, {"category": "gym", "content_valid_until": NOW},
        {"category": "mobile"}, {"category": "mobile", "title": "x", "body": "y",
                                  "content_valid_until": NOW + timedelta(days=1)},
    ]
    for c in combos:
        c.setdefault("category", "mobile")
        assert _derive_insight_state(c) in live_states


# ── Incoherence A: tri-state doc (verified_savings AND substituted_at) ─────

def _tri_state_eating_out_doc():
    """Byte-for-byte the confirmed live shape (kevin.maingi12@gmail.com,
    2026-09-01): `_check_verified_saving`'s early-return guard used to check
    only `verified_at`, not `substituted_at`, so a doc already resolved as
    substituted (21:10:43) got re-evaluated ~50 minutes later and additionally
    stamped verified (22:00:31)."""
    return {
        "_id": "abc", "insight_id": "eating_out-abc", "category": "eating_out",
        "title": "", "body": "", "savings_estimate": None,
        "verified_savings": 49.1, "verified_merchant": "Nandos",
        "verified_at": datetime(2026, 8, 31, 22, 0, 31),
        "substituted_at": datetime(2026, 8, 31, 21, 10, 43),
        "substituted_merchant": "Nandos", "substituted_amount": 49.1,
        "researched_at": None, "pinned": False, "is_new": False,
        "refreshed_at": NOW,
    }


def test_incoherence_a_tri_state_doc_serializes_as_substituted_only(monkeypatch):
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    out = _serialize_insight(_tri_state_eating_out_doc())
    assert out["state"] == "substituted"
    # Banked must mean verified-tier only — a doc corrupted with both
    # resolutions must show ZERO toward "banked", not the losing £49.10.
    assert out["verified_savings"] is None
    assert out["verified_merchant"] is None
    assert out["verified_tier"] is None
    assert out["verified_savings_line"] is None
    # The substituted fact-banner is what actually renders.
    assert out["substituted"] is True
    assert out["substituted_merchant"] == "Nandos"
    assert out["substituted_line"] is not None


def test_incoherence_a_repair_pass_heals_the_corrupted_doc(monkeypatch):
    """The tri-state repair at the top of `_refresh_savings_insights_for_user`'s
    per-category loop must clear the LOSING side's fields on the stored doc
    itself, not just at serve time — this is what protects the raw-query
    consumers (companion.py's Mirror win narration, analytics.py's
    value-delivered) that read `verified_savings` directly, not through
    `_serialize_insight`."""
    doc = _tri_state_eating_out_doc()
    doc["category"] = "eating_out"

    class FakeCol:
        def __init__(self, d):
            self.doc = d
            self.unset_calls = []

        async def find_one(self, query):
            return dict(self.doc)

        async def update_one(self, filt, update):
            unset = update.get("$unset", {})
            self.unset_calls.append(unset)
            for k in unset:
                self.doc.pop(k, None)
            self.doc.update(update.get("$set", {}))

    col = FakeCol(doc)
    monkeypatch.setattr(savings_insights, "savings_insights_col", col)
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)

    async def fake_detect(user_id):
        return ["eating_out"]

    async def fake_triggered(user_id, category_key):
        return []

    monkeypatch.setattr(savings_insights, "_detect_insight_categories", fake_detect)
    monkeypatch.setattr(savings_insights, "_find_triggered_transactions", fake_triggered)

    _run(_refresh_savings_insights_for_user("kevin"))

    assert "verified_savings" not in col.doc
    assert "verified_merchant" not in col.doc
    assert "verified_at" not in col.doc
    assert col.doc.get("substituted_at") is not None  # the winner survives


# ── Incoherence B: absent research_fresh -> quiet/compact ──────────────────

def test_incoherence_b_pull_category_missing_researched_at_field_entirely_is_quiet(monkeypatch):
    """The confirmed structure of the bug report's "prime suspect": a doc
    where `researched_at` is absent (not just None) must still resolve to
    "quiet" — not fall through to some other branch because a `.get()`
    returned a Python `None` that a stricter check might treat differently
    from an explicit `False`. No tri-state slip possible: `state` is a
    plain string equality check, never a boolean combination."""
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    doc = {"category": "car_finance", "title": "", "body": ""}  # no researched_at key at all
    assert _derive_insight_state(doc) == "quiet"
    out = _serialize_insight({**doc, "_id": "x", "insight_id": "car_finance-x",
                               "pinned": False, "is_new": False, "refreshed_at": NOW})
    assert out["state"] == "quiet"


def test_incoherence_b_identical_states_render_identically(monkeypatch):
    """car_finance and groceries/gym/subscriptions in the same untapped-pull
    state must serialize identically (the actual owner complaint: car_finance
    rendered as a hollow full card while its siblings rendered compact)."""
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    base = {"title": "", "body": "", "savings_estimate": None, "researched_at": None,
            "pinned": False, "is_new": False, "refreshed_at": NOW,
            "verified_savings": None, "substituted_at": None, "verified_at": None}
    siblings = ["car_finance", "groceries", "gym", "subscriptions"]
    states = {
        cat: _serialize_insight({**base, "_id": cat, "insight_id": f"{cat}-x", "category": cat})["state"]
        for cat in siblings
    }
    assert len(set(states.values())) == 1
    assert list(states.values())[0] == "quiet"


# ── Incoherence C: body claims a number the estimate guardrail rejected ────

def test_incoherence_c_energy_title_strips_the_ungrounded_figure_leaves_the_users_own(monkeypatch):
    """Confirmed live: energy's title was "You pay £160/mo, fixed deals
    could save up to £173" with `savings_estimate` correctly nulled by the
    derivability guard — but the £173 claim survived in the title anyway.
    The user's own £160 (from `triggered_by`) must survive; only the
    ungrounded £173 clause is stripped."""
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    doc = {
        "_id": "x", "insight_id": "energy-x", "category": "energy",
        "title": "You pay £160/mo, fixed deals could save up to £173",
        "body": "Fuse Energy and Octopus Energy are offering some of the cheapest fixed tariffs.",
        "savings_estimate": None, "researched_at": NOW - timedelta(hours=1),
        "content_valid_until": NOW + timedelta(days=6),
        "pinned": False, "is_new": False, "refreshed_at": NOW,
        "triggered_by": [{"merchant_key": "british gas", "display_name": "British Gas",
                           "monthly_amount": 159.7, "occurrences": 2}],
    }
    out = _serialize_insight(doc)
    assert out["state"] == "fresh"
    assert "£173" not in out["title"]
    assert "£160" in out["title"]
    assert out["savings_estimate"] is None
    assert out["savings_estimate_monthly"] is None


def test_incoherence_c_repaired_at_serve_time_without_a_regen(monkeypatch):
    """Belt-and-braces: a doc generated BEFORE this guardrail existed (no
    special marker, just the raw stored text) must be repaired on every
    serve, not require a regen to pick up the fix."""
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    doc = {
        "_id": "x", "insight_id": "energy-x", "category": "energy",
        "title": "Switching could save you up to £999 this year",
        "body": "No supporting figure anywhere else on this doc.",
        "savings_estimate": None, "researched_at": NOW - timedelta(hours=1),
        "content_valid_until": NOW + timedelta(days=6),
        "pinned": False, "is_new": False, "refreshed_at": NOW, "triggered_by": [],
    }
    out = _serialize_insight(doc)
    # The strip empties the title entirely (its only clause is the
    # unsupported claim), which downgrades state via the invariant below —
    # same as it always did; this test only pins that the ungrounded figure
    # itself never survives to the response either way.
    assert "£999" not in out["title"]


def test_strip_unsupported_savings_claims_keeps_the_users_own_figure():
    result = _strip_unsupported_savings_claims(
        "You pay £160/mo, fixed deals could save up to £173", False,
        [{"monthly_amount": 159.7}],
    )
    assert result == "You pay £160/mo."


def test_strip_unsupported_savings_claims_leaves_a_legitimate_price_statement_alone():
    # No "save"-shaped word near the £ figure — a market price statement,
    # not a savings claim, must never be touched.
    text = "Virgin Media M1 broadband from £17.99 a month"
    assert _strip_unsupported_savings_claims(text, False, []) == text


def test_strip_unsupported_savings_claims_noop_when_estimate_present():
    text = "You pay £160/mo, fixed deals could save up to £173"
    assert _strip_unsupported_savings_claims(text, True, []) == text


def test_strip_unsupported_savings_claims_protects_thousands_separator():
    # A naive comma-split would corrupt "£1,124" into "£1, 124" even when
    # nothing needs stripping — the £1,124 figure matches the user's own
    # triggered_by amount, so this must return the string byte-for-byte
    # unchanged, not just semantically equivalent.
    text = "Your £1,124 mortgage could drop with a remortgage"
    result = _strip_unsupported_savings_claims(text, False, [{"monthly_amount": 1124.44}])
    assert result == text
    assert ", 1" not in result


def test_strip_unsupported_savings_claims_returns_empty_when_everything_is_unsupported():
    result = _strip_unsupported_savings_claims("Could save up to £500 a month", False, [])
    assert result == ""


# ── Incoherence D: stored content is never blanked by a failed regen ───────

def test_incoherence_d_push_category_content_survives_a_refresh_pass_untouched(monkeypatch):
    """A failed generation attempt (`_generate_savings_insight_content`
    returning None, e.g. Tavily quota exhausted) must never blank the
    previously-stored title/body/savings_estimate — the doc simply keeps
    serving its last good content until either the next successful regen
    overwrites it, or its `content_valid_until` TTL passes and
    `_derive_insight_state` starts withholding it at SERVE time (a separate,
    read-side concern — see test_content_ttl.py). The old pull-only
    "clear stale content in storage" branch this test used to guard against
    is fully retired (owner decision 2026-09-01): expiry is now handled
    entirely by `content_valid_until`, never by mutating stored text."""
    from app.routers.savings_insights import PROMPT_VERSION

    class FakeInsightsCol:
        def __init__(self, docs):
            self.docs = {d["category"]: dict(d, _id=d["category"]) for d in docs}

        async def find_one(self, query):
            return self.docs.get(query.get("category"))

        async def update_one(self, filt, update):
            for d in self.docs.values():
                if d.get("_id") == filt.get("_id"):
                    d.update(update.get("$set", {}))
                    for k in update.get("$unset", {}):
                        d.pop(k, None)
                    return

        async def insert_one(self, doc):
            self.docs[doc["category"]] = doc

    old_mobile = {
        "category": "mobile", "user_id": "kevin", "insight_id": "mobile-x",
        "icon": "📱", "label": "Mobile", "pinned": False,
        "title": "You pay EE £57/mo", "body": "SIM-only could cut that sharply",
        "savings_estimate": "~£52/mo", "content_hash": "h", "is_new": False,
        "refreshed_at": NOW - timedelta(days=200),  # long past TTL/30-day window
        "researched_at": NOW - timedelta(days=200),
        "prompt_version": PROMPT_VERSION, "triggered_by": [],
    }
    col = FakeInsightsCol([old_mobile])
    monkeypatch.setattr(savings_insights, "savings_insights_col", col)
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)

    async def fake_detect(user_id):
        return ["mobile"]

    async def fake_triggered(user_id, category_key):
        return []

    async def fake_verified(user_id, existing):
        return None

    async def fake_content(category_key, user_context, triggered_by):
        # Simulate a generation failure (e.g. Tavily quota exhausted) — the
        # exact condition under which old content must NOT be blanked.
        return None

    monkeypatch.setattr(savings_insights, "_detect_insight_categories", fake_detect)
    monkeypatch.setattr(savings_insights, "_find_triggered_transactions", fake_triggered)
    monkeypatch.setattr(savings_insights, "_check_verified_saving", fake_verified)
    monkeypatch.setattr(savings_insights, "_generate_savings_insight_content", fake_content)

    _run(_refresh_savings_insights_for_user("kevin"))

    mobile_after = col.docs["mobile"]
    assert mobile_after["title"] == "You pay EE £57/mo"
    assert mobile_after["body"] == "SIM-only could cut that sharply"
    assert mobile_after["savings_estimate"] == "~£52/mo"


def test_incoherence_d_quiet_state_renders_when_content_genuinely_absent(monkeypatch):
    """If a category's content is ever genuinely empty (should not happen in
    steady state — see the docstring on `_derive_insight_state` — but the
    state machine must degrade honestly if it ever does), the state is
    `quiet` — a compact row, no full card — not silently treated as `fresh`
    with nothing to show. `push_stale` (a separate defensive state for this
    exact case) is retired: every category folds into the same `quiet`
    outcome now, whether the cause is "never researched" or "genuinely
    absent despite being a normally-reliable category"."""
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    doc = {"_id": "x", "insight_id": "mobile-x", "category": "mobile",
           "title": "", "body": "", "savings_estimate": None,
           "pinned": False, "is_new": False, "refreshed_at": NOW}
    out = _serialize_insight(doc)
    assert out["state"] == "quiet"
    assert out["title"] == ""
    assert out["body"] == ""


# ── Third compact regression: real title/body in storage, refreshed_at TODAY,
# but no content_valid_until ever stamped — the exact live shape confirmed on
# kevin.maingi12@gmail.com/subscriptions 2026-09-02 (a successful generation
# pass from a legacy write path wrote real content but predates the TTL
# field; see `_regen_reason`'s "ttl" branch — `not content_valid_until` fires
# unconditionally for a doc like this). OWNER RULING (2026-09-02, verbatim:
# "what's the point of these cards if there is nothing, and we shouldn't
# show the cadence of the refresh") is the trigger for this test: the
# mechanism was never a bad `state` derivation (this doc already resolves
# "quiet" correctly, asserted below) — it was Zone 2's now-deleted "Refreshes
# weekly..." fallback caption rendering as if it were furnished content on
# ANY non-fresh/non-resolved reachable branch. This test pins the
# serializer's half of that fix (content genuinely absent from the wire); the
# frontend's half (no caption text left to render at all) is pinned by the
# design twin's QUIET_RECENT_RESEARCHED fixture, byte-for-byte the same doc
# shape. ──────────────────────────────────────────────────────────────────

def test_regression_3_recent_refreshed_at_but_no_ttl_serves_as_quiet_with_no_content(monkeypatch):
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    doc = {
        "_id": "x", "insight_id": "subscriptions-x", "category": "subscriptions",
        "title": "You pay £22/mo on Netflix and Prime - try free trials first",
        "body": "Amazon Prime and Apple TV+ both offer free trials you could use "
                "before committing.",
        "savings_estimate": None,
        "researched_at": NOW - timedelta(hours=6),  # "today" by any human reading
        "refreshed_at": NOW - timedelta(hours=6),
        "content_valid_until": None,  # never stamped — the actual bug
        "claim_valid_until": None,
        "pinned": False, "is_new": False,
        "triggered_by": [{"merchant_key": "netflix.com", "display_name": "Netflix.Com",
                           "monthly_amount": 12.99, "occurrences": 2}],
    }
    out = _serialize_insight(doc)
    assert out["state"] == "quiet"
    assert out["title"] == ""
    assert out["body"] == ""
    assert out["researched_at"] is None
    assert out["expiry_line"] is None
    # The underlying doc's real, recent refreshed_at is still surfaced
    # (CompactInsightRow's "New" dot / age reasoning is separate from the
    # content-presence question this state machine governs) — but nothing
    # about it reads as researched content.
    assert out["refreshed_at"] is not None


# ── Hardened invariant: exhaustive state -> allowed anatomy enumeration ────
# (OWNER RULING 2026-09-02 item 3: "consider an assertion... enumerating
# every state -> allowed anatomy, such that a future zone-2 addition cannot
# silently count as content"). Every SavingsInsight state maps to EXACTLY one
# anatomy below; a future field added to `_serialize_insight` that leaks
# researched-content-shaped data into a state not listed as carrying it fails
# this test, not just a phone screenshot three rounds later.
_STATE_ANATOMY: dict[str, dict[str, bool]] = {
    # state: {field: must_be_present (True) / must_be_absent (False)}
    "fresh": {
        "title": True, "body": True,
        "verified_savings_line": False, "substituted_line": False,
    },
    "quiet": {
        "title": False, "body": False, "expiry_line": False,
        "verified_savings_line": False, "substituted_line": False,
    },
    "verified": {
        "title": False, "body": False, "expiry_line": False,
        "verified_savings_line": True, "substituted_line": False,
    },
    "substituted": {
        "title": False, "body": False, "expiry_line": False,
        "verified_savings_line": False, "substituted_line": True,
    },
}


@pytest.mark.parametrize("state,anatomy", list(_STATE_ANATOMY.items()))
def test_state_anatomy_invariant(monkeypatch, state, anatomy):
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)
    base = {
        "_id": "x", "insight_id": "energy-x", "category": "energy",
        "pinned": False, "is_new": False, "refreshed_at": NOW,
        "researched_at": NOW - timedelta(days=1),
        "content_valid_until": NOW + timedelta(days=6),
        "title": "A real title", "body": "A real body sentence.",
        "savings_estimate": None, "triggered_by": [],
    }
    if state == "quiet":
        base["content_valid_until"] = None
    elif state == "verified":
        base["verified_at"] = NOW
        base["verified_savings"] = 12.0
        base["verified_merchant"] = "Test Co"
    elif state == "substituted":
        base["substituted_at"] = NOW
        base["substituted_merchant"] = "Test Co"
        base["substituted_amount"] = 12.0

    out = _serialize_insight(base)
    assert out["state"] == state, f"fixture drifted: expected {state}, derived {out['state']}"
    for field, must_be_present in anatomy.items():
        value = out.get(field)
        is_present = bool(value.strip()) if isinstance(value, str) else value is not None
        if must_be_present:
            assert is_present, f"state={state} must carry {field!r}, got {value!r}"
        else:
            assert not is_present, f"state={state} must NOT carry {field!r}, got {value!r}"


# ── No cadence/scheduling wording anywhere in expiry_line (OWNER RULING
# 2026-09-02, verbatim: "we shouldn't show the cadence of the refresh" —
# internal refresh scheduling must never be narrated to the user) ─────────

_CADENCE_WORDS = ("refresh", "weekly", "cadence", "schedul")


@pytest.mark.parametrize(
    "researched_at,content_valid_until,claim_valid_until",
    [
        (NOW - timedelta(days=2), NOW + timedelta(days=5), None),
        (NOW - timedelta(days=2), NOW + timedelta(days=5), NOW + timedelta(days=5)),
        (None, NOW + timedelta(days=5), None),
        (NOW - timedelta(hours=1), None, None),
    ],
)
def test_expiry_line_never_contains_cadence_wording(researched_at, content_valid_until, claim_valid_until):
    line = _expiry_line(researched_at, content_valid_until, claim_valid_until, NOW)
    if line is not None:
        lowered = line.lower()
        for word in _CADENCE_WORDS:
            assert word not in lowered, f"expiry_line leaked cadence wording {word!r}: {line!r}"


def test_expiry_line_claim_governed_states_the_date_not_the_cadence():
    deadline = datetime(2026, 9, 7, 23, 59, 59)
    line = _expiry_line(NOW - timedelta(days=1), deadline, deadline, NOW)
    assert line == "Valid until Mon 7 Sep"


def test_expiry_line_default_ttl_states_the_age_not_the_cadence():
    researched = NOW - timedelta(days=2)
    line = _expiry_line(researched, NOW + timedelta(days=5), None, NOW)
    assert line == "Researched 2d ago"


# ── `job` field (fixed vs free) ───────────────────────────────────────────
# `_job_for_category` maps a savings-insight `category` key (e.g. "mobile",
# "gym") to the app category it represents, then resolves fixed/free through
# the SAME category-kind single source of truth (app.services.categories)
# used everywhere else, rather than a second hardcoded judgement that could
# drift from it. See `_INSIGHT_CATEGORY_TO_APP_CATEGORY` and the docstring
# on `_job_for_category` itself in app/routers/savings_insights.py.

@pytest.mark.parametrize(
    "category_key,expected",
    [
        ("mobile", "fixed"),
        ("broadband", "fixed"),
        ("energy", "fixed"),
        ("mortgage", "fixed"),
        ("car_insurance", "fixed"),
        ("home_insurance", "fixed"),
        ("life_insurance", "fixed"),
        ("council_tax", "fixed"),
        ("water", "fixed"),
        ("tv_licence", "fixed"),
        ("groceries", "fixed"),
        ("car_finance", "fixed"),   # Transport is a COMMITMENT kind
        ("gym", "free"),            # Health is a DISCRETIONARY kind
        ("subscriptions", "free"),
        ("eating_out", "free"),
    ],
)
def test_job_for_category_builtin_kinds(category_key, expected):
    assert _job_for_category(category_key, None) == expected
    # Falling back to the built-in kind table (no per-user kinds passed)
    # gives the same answer as passing it explicitly.
    assert _job_for_category(category_key, BUILTIN_CATEGORY_KINDS) == expected


def test_job_for_category_unmapped_or_unknown_key_is_none():
    # "pension" is a real LABEL_OPTIONS key but deliberately unmapped: a
    # pension/savings contribution is a MOVEMENT, not spend, so it has no
    # job at all.
    assert _job_for_category("pension", None) is None
    assert _job_for_category("not_a_real_category", None) is None


def test_job_for_category_respects_a_users_own_custom_kind_override():
    # A user who recategorised their own "Bills" as discretionary (or any
    # custom kind map) should see that reflected, not the built-in default —
    # this is the whole reason `_job_for_category` takes a kind map instead
    # of hardcoding fixed/free per insight category.
    custom_kinds = {**BUILTIN_CATEGORY_KINDS, "Bills": DISCRETIONARY}
    assert _job_for_category("mobile", custom_kinds) == "free"
    custom_kinds_movement = {**BUILTIN_CATEGORY_KINDS, "Health": MOVEMENT}
    assert _job_for_category("gym", custom_kinds_movement) is None


def test_serialize_insight_includes_job_field():
    doc = {
        "_id": "ins_1", "insight_id": "ins_1", "category": "gym", "state": "quiet",
        "refreshed_at": NOW,
    }
    result = _serialize_insight(doc)
    assert result["job"] == "free"

    doc_bills = {**doc, "category": "mobile"}
    assert _serialize_insight(doc_bills)["job"] == "fixed"

    doc_kinds_passed = {**doc, "category": "mobile"}
    custom_kinds = {**BUILTIN_CATEGORY_KINDS, "Bills": DISCRETIONARY}
    assert _serialize_insight(doc_kinds_passed, kinds=custom_kinds)["job"] == "free"


def test_serialize_insight_exposes_only_a_reliable_spend_category():
    doc = {
        "_id": "ins_1", "insight_id": "ins_1", "category": "eating_out", "state": "quiet",
        "refreshed_at": NOW,
    }
    assert _serialize_insight(doc)["app_category"] == "Eating Out"

    # Mortgage insights are merchant-scoped because the bank category is not
    # reliable; they must not be guessed onto the Bills row.
    assert _serialize_insight({**doc, "category": "mortgage"})["app_category"] is None
