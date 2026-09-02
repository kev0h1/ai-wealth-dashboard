"""Unit tests for app.services.recurring_judge — the LLM scrutiny pass that
reviews trusted-category recurring series which would otherwise have FAILED
the generic evidence gate (see gate_failure_reason's docstring and the
comment block above DEFAULT_RECURRING_CATEGORIES in analytics.py).

Real case this closes: HSBC "COMP BAL XFR" — 4 one-off balance transfers
(GBP641.32, GBP1362.69 same day 28 May; GBP1574.05 10 Jul; GBP996.07 27 Jul;
gaps 0/43/17 days) on a credit-card account, waved through as a phantom
GBP1,310.94 bill purely because "Transfer" is a trusted category.

Mirrors test_penny_agent.py's httpx mocking convention: `httpx` is a true
singleton module, so `monkeypatch.setattr(recurring_judge_module.httpx,
"AsyncClient", Fake)` patches the same attribute the module's `import httpx`
sees.
"""
import asyncio
import json
from datetime import datetime, timedelta

import app.services.recurring_judge as recurring_judge_module
from app.services.recurring_judge import (
    apply_verdicts,
    gate_failure_reason,
    is_suspect,
    judge_suspect_series,
)
from app.routers.analytics import _detect_recurring, DEFAULT_RECURRING_CATEGORIES

TRUSTED = set(DEFAULT_RECURRING_CATEGORIES)
BASE = datetime(2026, 5, 28)  # matches the real case's first BT date


def txn(merchant, day_offset, amount, category="Transfer", account_id="acc-hsbc-cc"):
    return {
        "merchant_name": merchant,
        "description": merchant,
        "amount": amount,
        "date": BASE + timedelta(days=day_offset),
        "category": category,
        "custom_category": None,
        "account_id": account_id,
    }


def today_at(day_offset):
    return (BASE + timedelta(days=day_offset)).date()


def comp_bal_xfr_txns():
    # 28 May: two same-day transfers of different amounts; 10 Jul (=43d
    # later); 27 Jul (=17d after that) — exactly the real, irregular case.
    return [
        txn("COMP BAL XFR", 0, 641.32),
        txn("COMP BAL XFR", 0, 1362.69),
        txn("COMP BAL XFR", 43, 1574.05),
        txn("COMP BAL XFR", 60, 996.07),
    ]


def detect_comp_bal_xfr():
    results = _detect_recurring(comp_bal_xfr_txns(), trusted_categories=TRUSTED, today=today_at(65))
    assert len(results) == 1, "fixture must produce exactly one series"
    return results[0]


ACCOUNT_MAP = {
    "acc-hsbc-cc": {
        "name": "HSBC Credit Card",
        "balance": -6353.0,
        "provider": "HSBC",
        "is_credit_card": True,
        "is_spendable": False,
    }
}


# ── Suspect selection ────────────────────────────────────────────────────

def test_comp_bal_xfr_shape_is_selected_as_suspect():
    series = detect_comp_bal_xfr()
    assert series["category"] == "Transfer"
    assert series["trusted_bypass_reason"] is not None
    assert is_suspect(series)


def test_trusted_tier_series_passing_generic_gates_is_not_suspect():
    # Same category, but a genuinely regular monthly cadence and stable
    # amount — mirrors test_recurring.py's "K MONZO TEST STO" case, extended
    # to 3 occurrences so it also clears the generic gate outright.
    txns = [
        txn("K MONZO TEST STO", 0, 1106.0),
        txn("K MONZO TEST STO", 30, 1106.0),
        txn("K MONZO TEST STO", 60, 1106.0),
    ]
    results = _detect_recurring(txns, trusted_categories=TRUSTED, today=today_at(63))
    assert len(results) == 1
    series = results[0]
    assert series["trusted_bypass_reason"] is None
    assert not is_suspect(series)


def test_non_trusted_series_is_not_suspect():
    # Already had to clear the generic gate to exist at all (3+ occurrences,
    # regular interval, stable amount) — trusted_bypass_reason is never set
    # for a non-trusted-tier acceptance.
    txns = [
        txn("Everyday Gym", 0, 24.99, category="Software"),
        txn("Everyday Gym", 30, 24.99, category="Software"),
        txn("Everyday Gym", 60, 24.99, category="Software"),
    ]
    results = _detect_recurring(txns, trusted_categories=TRUSTED, today=today_at(63))
    assert len(results) == 1
    series = results[0]
    assert series["trusted_bypass_reason"] is None
    assert not is_suspect(series)


def test_gate_failure_reason_matches_generic_thresholds():
    # Direct coverage of the shared helper analytics.py's trusted-tier
    # bypass also calls, so the two paths can never drift apart.
    items = [{"amount": -10}, {"amount": -10}]  # only 2 occurrences
    assert gate_failure_reason(items, [30.0], 30.0) == "fewer than 3 occurrences"

    items3_irregular = [{"amount": -10}, {"amount": -10}, {"amount": -10}]
    assert gate_failure_reason(items3_irregular, [5.0, 40.0], 22.5) == "irregular intervals between occurrences"

    items3_amounts = [{"amount": -10}, {"amount": -10}, {"amount": -40}]
    assert "amounts vary" in gate_failure_reason(items3_amounts, [30.0, 30.0], 30.0)

    items3_clean = [{"amount": -10}, {"amount": -10}, {"amount": -10}]
    assert gate_failure_reason(items3_clean, [30.0, 30.0], 30.0) is None


# ── Veto application ─────────────────────────────────────────────────────

def test_apply_verdicts_removes_vetoed_and_tracks_reason():
    series_list = [
        {"key": "COMP BAL XFR", "category": "Transfer"},
        {"key": "EE LIMITED", "category": "Bills"},
    ]
    verdicts = {
        "COMP BAL XFR": {
            "recurring": False, "confidence": 0.85,
            "reason": "These are one-off balance transfers, not a regular bill.",
            "judged_at": datetime(2026, 8, 28, 9, 0),
        }
    }
    kept, vetoed = apply_verdicts(series_list, verdicts)
    assert [s["key"] for s in kept] == ["EE LIMITED"]
    assert len(vetoed) == 1
    assert vetoed[0]["key"] == "COMP BAL XFR"
    assert vetoed[0]["reason"] == "These are one-off balance transfers, not a regular bill."
    assert vetoed[0]["vetoed_at"] == datetime(2026, 8, 28, 9, 0)


def test_apply_verdicts_recurring_true_verdict_keeps_series():
    series_list = [{"key": "A", "category": "Transfer"}]
    verdicts = {"A": {"recurring": True, "confidence": 0.7, "reason": "Regular monthly pattern.", "judged_at": datetime.now()}}
    kept, vetoed = apply_verdicts(series_list, verdicts)
    assert [s["key"] for s in kept] == ["A"]
    assert vetoed == []


def test_apply_verdicts_no_verdict_leaves_series_unaffected():
    series_list = [{"key": "A", "category": "Transfer"}, {"key": "B", "category": "Bills"}]
    kept, vetoed = apply_verdicts(series_list, {})
    assert [s["key"] for s in kept] == ["A", "B"]
    assert vetoed == []


# ── Cache + LLM plumbing ─────────────────────────────────────────────────

class _FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


def _verdict_response(recurring: bool, reason="test reason", confidence=0.9):
    content = json.dumps({"recurring": recurring, "confidence": confidence, "reason": reason})
    return _FakeResponse(payload={"choices": [{"message": {"content": content}}]})


class _ScriptedAsyncClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls: list[dict] = []

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, headers=None, json=None):
        self.calls.append(json)
        idx = len(self.calls) - 1
        item = self._responses[idx] if idx < len(self._responses) else self._responses[-1]
        if isinstance(item, Exception):
            raise item
        return item


class _FakeJudgeCol:
    """In-memory stand-in for recurring_judge_col — find_one/update_one only,
    which is all the module ever calls."""

    def __init__(self):
        self.docs: dict[str, dict] = {}

    async def find_one(self, query):
        return self.docs.get(query["_id"])

    async def update_one(self, query, update, upsert=False):
        self.docs[query["_id"]] = dict(update["$set"])


def _patch_key(monkeypatch, key="test-key"):
    monkeypatch.setattr(recurring_judge_module, "OPENROUTER_API_KEY", key)


def test_cache_hit_on_unchanged_evidence_does_not_reinvoke_llm(monkeypatch):
    _patch_key(monkeypatch)
    col = _FakeJudgeCol()
    monkeypatch.setattr(recurring_judge_module, "recurring_judge_col", col)
    client = _ScriptedAsyncClient([_verdict_response(False, "One-off balance transfers.")])
    monkeypatch.setattr(recurring_judge_module.httpx, "AsyncClient", client)

    series = detect_comp_bal_xfr()

    verdicts1 = asyncio.run(judge_suspect_series("kevin", [series], ACCOUNT_MAP))
    assert verdicts1["COMP BAL XFR"]["recurring"] is False
    assert len(client.calls) == 1

    # Second call, identical evidence (same series dict, re-detected fresh
    # to prove it's the CONTENT that matters, not object identity).
    series_again = detect_comp_bal_xfr()
    verdicts2 = asyncio.run(judge_suspect_series("kevin", [series_again], ACCOUNT_MAP))
    assert verdicts2["COMP BAL XFR"]["recurring"] is False
    assert len(client.calls) == 1, "cache hit must not re-invoke the LLM"


def test_new_occurrence_invalidates_cache_and_rejudges(monkeypatch):
    _patch_key(monkeypatch)
    col = _FakeJudgeCol()
    monkeypatch.setattr(recurring_judge_module, "recurring_judge_col", col)
    client = _ScriptedAsyncClient([
        _verdict_response(False, "One-off balance transfers."),
        _verdict_response(False, "Still irregular even with a 5th transfer."),
    ])
    monkeypatch.setattr(recurring_judge_module.httpx, "AsyncClient", client)

    series = detect_comp_bal_xfr()
    asyncio.run(judge_suspect_series("kevin", [series], ACCOUNT_MAP))
    assert len(client.calls) == 1

    # A brand new 5th occurrence changes occurrence count, last_date, and
    # the amounts hash all at once — the cache signature must move.
    txns5 = comp_bal_xfr_txns() + [txn("COMP BAL XFR", 90, 1200.00)]
    results5 = _detect_recurring(txns5, trusted_categories=TRUSTED, today=today_at(95))
    assert len(results5) == 1
    series5 = results5[0]
    assert is_suspect(series5)

    asyncio.run(judge_suspect_series("kevin", [series5], ACCOUNT_MAP))
    assert len(client.calls) == 2, "a new occurrence must trigger a fresh judgement"


def test_non_suspect_series_never_reaches_the_llm(monkeypatch):
    # NOTE: a trusted-tier series with only 2 occurrences DOES count as
    # suspect ("fewer than 3 occurrences" is itself one of the generic-gate
    # failure reasons, per the task spec) — so this test deliberately uses a
    # trusted-tier series with 3+ occurrences on a clean, regular cadence
    # and stable amount, which passes the generic gate outright and must
    # never reach the LLM.
    _patch_key(monkeypatch)
    col = _FakeJudgeCol()
    monkeypatch.setattr(recurring_judge_module, "recurring_judge_col", col)
    client = _ScriptedAsyncClient([_verdict_response(False)])
    monkeypatch.setattr(recurring_judge_module.httpx, "AsyncClient", client)

    txns = [
        txn("K MONZO TEST STO", 0, 1106.0),
        txn("K MONZO TEST STO", 30, 1106.0),
        txn("K MONZO TEST STO", 60, 1106.0),
    ]
    results = _detect_recurring(txns, trusted_categories=TRUSTED, today=today_at(63))
    assert len(results) == 1
    assert not is_suspect(results[0])

    verdicts = asyncio.run(judge_suspect_series("kevin", results, ACCOUNT_MAP))
    assert verdicts == {}
    assert client.calls == []


def test_judgements_capped_at_ten_per_refresh(monkeypatch):
    _patch_key(monkeypatch)
    col = _FakeJudgeCol()
    monkeypatch.setattr(recurring_judge_module, "recurring_judge_col", col)
    client = _ScriptedAsyncClient([_verdict_response(False)])
    monkeypatch.setattr(recurring_judge_module.httpx, "AsyncClient", client)

    series_list = []
    for i in range(15):
        txns = [
            txn(f"MERCH {i}", 0, 100 + i, category="Transfer", account_id="acc-hsbc-cc"),
            txn(f"MERCH {i}", 0, 250 + i, category="Transfer", account_id="acc-hsbc-cc"),
            txn(f"MERCH {i}", 43, 400 + i, category="Transfer", account_id="acc-hsbc-cc"),
            txn(f"MERCH {i}", 60, 500 + i, category="Transfer", account_id="acc-hsbc-cc"),
        ]
        results = _detect_recurring(txns, trusted_categories=TRUSTED, today=today_at(65))
        assert len(results) == 1 and is_suspect(results[0])
        series_list.append(results[0])

    asyncio.run(judge_suspect_series("kevin", series_list, ACCOUNT_MAP))
    assert len(client.calls) == recurring_judge_module.MAX_JUDGEMENTS_PER_REFRESH


# ── Fail-open ─────────────────────────────────────────────────────────────

def test_fail_open_on_llm_exception_matches_judge_disabled(monkeypatch):
    series = detect_comp_bal_xfr()
    kept_disabled, vetoed_disabled = apply_verdicts([series], {})  # judge never even called

    # Errored path: API key present, but the HTTP call raises.
    _patch_key(monkeypatch)
    monkeypatch.setattr(recurring_judge_module, "recurring_judge_col", _FakeJudgeCol())
    monkeypatch.setattr(recurring_judge_module.httpx, "AsyncClient", _ScriptedAsyncClient([ConnectionError("boom")]))
    verdicts = asyncio.run(judge_suspect_series("kevin", [series], ACCOUNT_MAP))
    kept_errored, vetoed_errored = apply_verdicts([series], verdicts)

    assert kept_errored == kept_disabled == [series]
    assert vetoed_errored == vetoed_disabled == []


def test_fail_open_when_no_api_key(monkeypatch):
    series = detect_comp_bal_xfr()
    kept_disabled, vetoed_disabled = apply_verdicts([series], {})

    monkeypatch.setattr(recurring_judge_module, "OPENROUTER_API_KEY", "")
    monkeypatch.setattr(recurring_judge_module, "recurring_judge_col", _FakeJudgeCol())
    verdicts = asyncio.run(judge_suspect_series("kevin", [series], ACCOUNT_MAP))
    kept, vetoed = apply_verdicts([series], verdicts)

    assert kept == kept_disabled == [series]
    assert vetoed == vetoed_disabled == []


def test_fail_open_on_non_200_response(monkeypatch):
    _patch_key(monkeypatch)
    monkeypatch.setattr(recurring_judge_module, "recurring_judge_col", _FakeJudgeCol())
    monkeypatch.setattr(recurring_judge_module.httpx, "AsyncClient", _ScriptedAsyncClient([_FakeResponse(status_code=500, payload={})]))

    series = detect_comp_bal_xfr()
    verdicts = asyncio.run(judge_suspect_series("kevin", [series], ACCOUNT_MAP))
    kept, vetoed = apply_verdicts([series], verdicts)
    assert kept == [series]
    assert vetoed == []


def test_fail_open_on_unparseable_json(monkeypatch):
    _patch_key(monkeypatch)
    monkeypatch.setattr(recurring_judge_module, "recurring_judge_col", _FakeJudgeCol())
    bad_payload = _FakeResponse(payload={"choices": [{"message": {"content": "not json at all"}}]})
    monkeypatch.setattr(recurring_judge_module.httpx, "AsyncClient", _ScriptedAsyncClient([bad_payload]))

    series = detect_comp_bal_xfr()
    verdicts = asyncio.run(judge_suspect_series("kevin", [series], ACCOUNT_MAP))
    kept, vetoed = apply_verdicts([series], verdicts)
    assert kept == [series]
    assert vetoed == []
