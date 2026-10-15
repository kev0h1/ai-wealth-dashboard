"""G267 source-only set-asides and transfer-only goal fill candidates."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.routers.allocations as allocations
import app.services.plan_fulfilment as fulfilment
from tests.test_allocations import USER, FakeCol, _account, _create, _setup, _txn
from tests.test_g176_account_plan_sources import _accounts
from tests.test_plan_fulfilment import UID, _Txns, _credit, _debit, _suggest


def _eligible_sources():
    return {key: value for key, value in _accounts().items() if key in {"current", "saving"}}


def _manual(amount=120, recurrence="every_period", source="current"):
    return asyncio.run(allocations.create_allocation({
        "name": "Buffer", "amount_per_period": amount, "tracking_mode": "manual",
        "source_account_id": source, "recurrence": recurrence,
    }, USER))


class _ManualRaceCol(FakeCol):
    def __init__(self):
        super().__init__()
        self.race = False
        self.last_filter = None

    async def update_one(self, query, update):
        self.last_filter = query
        if self.race:
            return SimpleNamespace(matched_count=0)
        return await super().update_one(query, update)


def test_manual_requires_an_owned_eligible_source_and_persists_no_sink(monkeypatch):
    _setup(monkeypatch, accounts=[_account("current"), _account("saving")])
    monkeypatch.setattr(allocations, "owned_account_map", lambda _uid: _async(_eligible_sources()))
    with pytest.raises(HTTPException):
        _manual(source=None)
    with pytest.raises(HTTPException):
        _manual(source="foreign")
    with pytest.raises(HTTPException):
        _manual(source="card")
    created = _manual()
    assert created["tracking_mode"] == "manual"
    assert (created["fill_account_id"], created["match_type"], created["match_value"], created["fill_display_name"]) == (
        "", "description_contains", "", "",
    )


def test_manual_reserves_full_current_period_and_once_resets_without_fill_queries(monkeypatch):
    _setup(monkeypatch, accounts=[_account("current"), _account("saving")])
    monkeypatch.setattr(allocations, "owned_account_map", lambda _uid: _async(_eligible_sources()))
    created = _manual(amount=120, recurrence="once")
    assert created["filled_this_period"] == 0 and created["remaining"] == 120
    doc = allocations.allocations_col.docs[0]
    async def no_fill(*_args):
        raise AssertionError("manual set-asides must not query fills")
    monkeypatch.setattr(allocations, "filled_this_period", no_fill)
    still_current = asyncio.run(allocations._serialise(doc, created_period_start(), created_period_end()))
    assert still_current["filled_this_period"] == 0 and still_current["remaining"] == 120
    doc["created_period_end"] = doc["created_period_end"].replace(year=2020)
    out = asyncio.run(allocations._serialise(doc, created_period_start(), created_period_end()))
    assert out["completed"] is True and out["remaining"] == 0


def test_manual_transition_clears_payment_fields_and_payment_transition_revalidates(monkeypatch):
    _setup(monkeypatch, accounts=[_account("current"), _account("saving")])
    monkeypatch.setattr(allocations, "owned_account_map", lambda _uid: _async(_eligible_sources()))
    tracked = _create(account="saving")
    manual = asyncio.run(allocations.update_allocation(
        tracked["id"], {"tracking_mode": "manual", "source_account_id": "current"}, USER,
    ))
    assert manual["fill_account_id"] == manual["match_value"] == ""
    with pytest.raises(HTTPException):
        asyncio.run(allocations.update_allocation(manual["id"], {"tracking_mode": "existing_payment"}, USER))
    restored = asyncio.run(allocations.update_allocation(manual["id"], {
        "tracking_mode": "existing_payment", "fill_account_id": "saving",
        "match_type": "description_contains", "match_value": "Rainy day",
        "fill_display_name": "Rainy day",
    }, USER))
    assert restored["tracking_mode"] == "existing_payment" and restored["fill_account_id"] == "saving"


def test_manual_pending_pause_resume_and_period_override_keep_a_source_only_reservation(monkeypatch):
    _setup(monkeypatch, accounts=[_account("current"), _account("saving")])
    monkeypatch.setattr(allocations, "owned_account_map", lambda _uid: _async(_eligible_sources()))
    created = _manual(amount=120)
    paused = asyncio.run(allocations.update_allocation(created["id"], {"active": False}, USER))
    assert paused["active"] is False and paused["filled_this_period"] == 0
    resumed = asyncio.run(allocations.update_allocation(created["id"], {"active": True}, USER))
    assert resumed["active"] is True and resumed["remaining"] == 120
    overridden = asyncio.run(allocations.set_period_override(created["id"], {"amount": 75}, USER))
    assert overridden["period_amount"] == overridden["remaining"] == 75
    pending = asyncio.run(allocations.update_allocation(created["id"], {"effective_from": "2030-01-01"}, USER))
    assert pending["pending"] is True and pending["remaining"] == 0


def test_manual_update_without_a_source_uses_a_source_snapshot_and_refuses_a_race(monkeypatch):
    _setup(monkeypatch, accounts=[_account("current"), _account("saving")])
    col = _ManualRaceCol()
    monkeypatch.setattr(allocations, "allocations_col", col)
    monkeypatch.setattr(allocations, "owned_account_map", lambda _uid: _async(_eligible_sources()))
    created = _manual()
    col.race = True
    with pytest.raises(HTTPException) as exc:
        asyncio.run(allocations.update_allocation(created["id"], {"name": "Edited"}, USER))
    assert exc.value.status_code == 409
    assert col.last_filter["source_account_id"] == "current"


def test_default_payment_tracking_still_matches_its_credit_and_manual_plan_has_no_sink(monkeypatch):
    _setup(monkeypatch, accounts=[_account("current"), _account("saving")], txns=[
        _txn("saving", 30, "credit", merchant_name="Saving Challenge (2026)"),
    ])
    monkeypatch.setattr(allocations, "owned_account_map", lambda _uid: _async(_eligible_sources()))
    tracked = _create(account="saving", amount=100)
    assert tracked["tracking_mode"] == "existing_payment"
    assert tracked["filled_this_period"] == 30 and tracked["remaining"] == 70
    manual = _manual(amount=90)
    monkeypatch.setattr(allocations, "commitments_col", FakeCol([]))
    rows = asyncio.run(allocations.list_account_plans(USER))["items"]
    row = next(item for item in rows if item["record_id"] == manual["id"])
    assert row["destination"] == "Kept in paying account"
    assert row["destination_account_ids"] == []
    assert row["source_account_id"] == "current"
    assert row["remaining"] == 90 and row["filled_amount"] == 0


def test_goal_candidates_exclude_purchases_and_rank_selected_pot_transfer(monkeypatch):
    selected = _suggest([
        _debit(80, "To selected pot", offset=-2, category="Transfer"), _credit(80, offset=-2, account="saving", category="Transfer"),
        _debit(80, "Netflix", offset=-1),
    ])
    assert len(selected["items"]) == 1
    assert selected["items"][0]["is_transfer"] is True
    assert selected["items"][0]["matched_pot_ids"] == ["saving"]
    assert selected["suggestion"] is not None


def test_goal_candidates_do_not_invent_a_transfer_from_an_unpaired_or_unrelated_amount():
    assert _suggest([_debit(80, "Netflix", offset=-2), _credit(80, offset=-2, account="saving")])["items"] == []
    assert _suggest([_debit(80, "Delivery to home", offset=-2), _credit(80, offset=-2, account="saving")])["items"] == []
    assert _suggest([_debit(80, "To selected pot", offset=-2, category="Transfer")])["items"] == []


def test_goal_candidate_selected_pot_is_ranked_before_a_newer_alternate_transfer(monkeypatch):
    accounts = {**_accounts(), "alt": {
        "_id": "alt", "type": "bank", "subtype": "SAVINGS_ACCOUNT", "currency": "GBP",
    }}
    docs = [
        _debit(80, "To selected", offset=-5, category="Transfer"),
        _credit(80, offset=-5, account="saving", category="Transfer"),
        _debit(40, "To alternate", offset=-1, category="Transfer"),
        _credit(40, offset=-1, account="alt", category="Transfer"),
    ]
    monkeypatch.setattr(fulfilment, "transactions_col", _Txns(docs))
    monkeypatch.setattr(fulfilment, "yapily_transactions_col", _Txns())
    items = asyncio.run(fulfilment.fill_candidates(UID, "current", ["saving", "alt"], accounts))["items"]
    assert items[0]["matched_pot_ids"] == ["saving"]
    assert items[1]["matched_pot_ids"] == ["alt"]


def _async(value):
    async def resolve():
        return value
    return resolve()


def created_period_start():
    from tests.test_allocations import PERIOD_START
    return PERIOD_START


def created_period_end():
    from tests.test_allocations import PERIOD_END
    return PERIOD_END
