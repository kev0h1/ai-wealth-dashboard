"""G413: a decision saved under the old merged bare issuer key still applies to
the per-card PAN-tail series it was split into, and only to those."""
import asyncio

import app.core.timeutil as timeutil
import app.routers.analytics as analytics
from app.routers.analytics import _build_cashflow_response
from app.services.own_account_transfers import (
    IssuerFallbackDict, IssuerFallbackSet, bare_issuer_label, pan_repayment_series_key, saved_key_applies, series_key,
)
from app.services.recurring_judge import apply_verdicts
from tests.test_pending_observed import FakeCol, UID, _cached, _fake_get_category_kinds, _freeze, _pattern


def test_bare_label_is_recognised_only_for_issuer_tail_keys():
    assert bare_issuer_label("American Express 20001") == "American Express"
    assert bare_issuer_label("NatWest 12345") == "NatWest"
    for key in ("Tesco 20001", "American Express", "American Express 2000", "American Express 200012",
                "American Express 64f1a2b3c4d5e6f708192a3b", None, ""):
        assert bare_issuer_label(key) is None


def test_a_dismissal_saved_under_the_bare_key_hides_both_card_series():
    dismissed = IssuerFallbackSet(["American Express", "Tesco"])
    series = [{"key": "American Express 20001"}, {"key": "American Express 20002"},
              {"key": "Tesco 20001"}, {"key": "Gym"}]
    kept = [r["key"] for r in series if r["key"] not in dismissed]
    assert kept == ["Tesco 20001", "Gym"], "a non-issuer key gets no fallback"
    assert "American Express" in dismissed and "Nothing" not in dismissed


def test_a_judge_override_saved_under_the_bare_key_keeps_a_vetoed_tail_series():
    verdicts = {"American Express 20001": {"recurring": False}, "Tesco 20001": {"recurring": False}}
    series = [{"key": "American Express 20001"}, {"key": "Tesco 20001"}]
    kept, vetoed = apply_verdicts(series, verdicts, IssuerFallbackSet(["American Express", "Tesco"]))
    assert [s["key"] for s in kept] == ["American Express 20001"]
    assert [v["key"] for v in vetoed] == ["Tesco 20001"]


def test_a_rule_saved_under_the_bare_key_applies_to_a_tail_series_and_exact_keys_win():
    rules = IssuerFallbackDict({"American Express": {"label": "old"}})
    assert rules.get("American Express 20001") == {"label": "old"}
    assert rules.get("Tesco 20001") is None and rules.get("Tesco 20001", {}) == {}
    rules["American Express 20002"] = {"label": "own"}
    assert rules.get("American Express 20002") == {"label": "own"}


def test_saved_key_applies_helper():
    assert saved_key_applies("American Express", "American Express 20001")
    assert saved_key_applies("Gym", "Gym")
    assert not saved_key_applies("Gym", "Gym 20001") and not saved_key_applies(None, "American Express 20001")


def _run_with_overrides(monkeypatch, patterns, overrides):
    monkeypatch.setattr(analytics, "transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "pending_transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "upcoming_overrides_col", FakeCol(overrides))
    monkeypatch.setattr(analytics, "upcoming_rules_col", FakeCol([]))
    monkeypatch.setattr(analytics, "planned_expenses_col", FakeCol([]))
    monkeypatch.setattr(analytics, "get_category_kinds", _fake_get_category_kinds)
    return asyncio.run(_build_cashflow_response(_cached(patterns), uid=UID, prefs={}))


def test_an_occurrence_skip_saved_under_the_bare_key_applies_to_a_tail_series(monkeypatch):
    _freeze(monkeypatch)
    today = timeutil.user_today().isoformat()
    skip = {"uid": UID, "key": "American Express", "scope": "one", "date": today, "skip": True}
    skip_other = {"uid": UID, "key": "Severn", "scope": "one", "date": today, "skip": True}
    patterns = [_pattern(key="American Express 20001", category="Debt"), _pattern(key="Severn 20001")]
    resp = _run_with_overrides(monkeypatch, patterns, [skip, skip_other])
    assert [b["name"] for b in resp["upcoming_bills"]] == ["Severn 20001"]


def test_a_credit_with_an_issuer_and_a_card_number_keeps_its_base_key():
    credit = {"description": "AMERICAN EXPRESS 3799-111111-20001", "merchant_name": "American Express",
              "transaction_type": "credit"}
    assert pan_repayment_series_key(credit) is None
    assert series_key(credit) == "American Express"
    debit = {**credit, "transaction_type": "debit"}
    assert series_key(debit) == "American Express 20001"
    assert series_key({k: v for k, v in debit.items() if k != "transaction_type"}) == "American Express 20001"
