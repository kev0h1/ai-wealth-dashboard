"""G453 future correction rules retain exact scope and do not teach sync."""
import asyncio
from datetime import datetime

import app.services.categorisation as categorisation
import app.services.vendor_directory as vendor_directory
from app.services.scoped_correction_rules import (
    correction_fields,
    correction_identity,
    is_booked_payment,
    make_correction_rule,
)
from tests.test_g139_merchant_authority import FakeCol, UID, _fake_get_category_kinds, _t


def _row(row_id: str, *, custom=None, key="saving-challenge", currency="GBP", pending=False, planned=False, status=None):
    return {
        **_t(row_id, custom_category=custom, category="Other", date_=datetime(2026, 11, 10), merchant="Saving Challenge", desc="Saving Challenge"),
        "merchant_key": key,
        "currency": currency,
        "is_pending": pending,
        "planned": planned,
        "status": status,
    }


def _install(monkeypatch, rows, rules):
    monkeypatch.setattr(categorisation, "transactions_col", FakeCol(rows))
    monkeypatch.setattr(categorisation, "accounts_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "user_profiles_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "merchant_categories_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "user_rules_col", FakeCol(rules))
    monkeypatch.setattr(categorisation, "confirmed_transfer_pairs_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "preferences_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "teaching_events_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "get_category_kinds", _fake_get_category_kinds)


def test_identity_requires_booked_direction_currency_and_uses_stored_key():
    row = _row("one")
    assert correction_identity(row) == ("saving-challenge", "debit", "GBP")
    assert is_booked_payment(row)
    assert not is_booked_payment({**row, "is_pending": True})
    assert not is_booked_payment({**row, "planned": True})
    assert not is_booked_payment({**row, "status": "pending"})
    assert correction_identity({**row, "currency": ""}) is None


def test_typed_rule_applies_only_exact_booked_automatic_matches(monkeypatch):
    fields = correction_fields("Savings")
    rule = make_correction_rule(UID, ("saving-challenge", "debit", "GBP"), operation_id="op", label="Saving Challenge", fields=fields, stamp=datetime(2026, 11, 10))
    rows = [
        _row("eligible"),
        _row("protected", custom="Shopping"),
        _row("currency", currency="USD"),
        _row("pending", pending=True),
        _row("planned", planned=True),
        _row("stored-pending", status="pending"),
        _row("other-key", key="another-payee"),
    ]
    _install(monkeypatch, rows, [rule])
    asyncio.run(categorisation.apply_rules_bulk(UID, structural=False))
    by_id = {row["_id"]: row for row in rows}
    assert by_id["eligible"]["custom_category"] == "Savings"
    assert by_id["eligible"]["correction_scope"] == "rule"
    for row_id in ("protected", "currency", "pending", "planned", "stored-pending", "other-key"):
        assert by_id[row_id].get("custom_category") != "Savings"


def test_scoped_rows_do_not_become_merchant_learning_inputs(monkeypatch):
    fields = correction_fields("Savings")
    rule = make_correction_rule(UID, ("different-key", "debit", "GBP"), operation_id="op", label="Different", fields=fields, stamp=datetime(2026, 11, 10))
    scoped = _row("scoped", custom="Savings")
    scoped["correction_scope"] = "history"
    automatic = _row("automatic")
    _install(monkeypatch, [scoped, automatic], [rule])
    asyncio.run(categorisation.apply_rules_bulk(UID, structural=False))
    assert automatic["custom_category"] is None
    assert automatic["category"] != "Savings"


def test_typed_destination_fields_are_exclusive():
    set_fields, unset_fields = correction_fields("Transfer", goal_id="goal-1")
    assert set_fields == {"custom_category": "Transfer", "linked_goal_id": "goal-1"}
    assert set(unset_fields) == {"linked_offline_account_id", "card_repayment_taught", "card_repayment_rule"}
    set_fields, unset_fields = correction_fields("Debt", card_repayment=True)
    assert set_fields["card_repayment_taught"] is True
    assert set(unset_fields) == {"linked_goal_id", "linked_offline_account_id", "card_repayment_rule"}


def test_typed_rule_id_is_stable_per_exact_identity():
    fields = correction_fields("Savings")
    first = make_correction_rule(UID, ("saving-challenge", "debit", "GBP"), operation_id="one", label="Savings", fields=fields, stamp=datetime(2026, 11, 10))
    replacement = make_correction_rule(UID, ("saving-challenge", "debit", "GBP"), operation_id="two", label="Savings", fields=fields, stamp=datetime(2026, 11, 11))
    different_currency = make_correction_rule(UID, ("saving-challenge", "debit", "USD"), operation_id="two", label="Savings", fields=fields, stamp=datetime(2026, 11, 11))
    assert first["_id"] == replacement["_id"]
    assert first["_id"] != different_currency["_id"]
    assert replacement["operation_id"] == "two"


def test_typed_rules_never_become_vendor_regexes_or_corrected_keys(monkeypatch):
    """An empty typed-rule pattern must not match every vendor merchant."""
    monkeypatch.setattr(vendor_directory, "user_rules_col", FakeCol([
        {"uid": UID, "kind": "scoped-correction", "pattern": ""},
        {"uid": UID, "pattern": "proper vendor rule"},
    ]))
    patterns = asyncio.run(vendor_directory._rule_patterns(UID))
    assert [pattern.pattern for pattern in patterns] == ["proper vendor rule"]

    scoped = _row("scoped", custom="Savings")
    scoped["correction_scope"] = "history-future"
    ordinary = _row("ordinary", custom="Shopping", key="ordinary-payee")
    ordinary["merchant_name"] = "Ordinary Payee"
    ordinary["description"] = "Ordinary Payee"
    monkeypatch.setattr(vendor_directory, "transactions_col", FakeCol([scoped, ordinary]))
    corrected = asyncio.run(vendor_directory._corrected_keys(UID))
    assert categorisation.canonical_merchant_key("Ordinary Payee", "") in corrected
    assert categorisation.canonical_merchant_key("Saving Challenge", "") not in corrected
