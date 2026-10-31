"""G377's conservative own-account transfer reconciliation contracts."""
from datetime import datetime, timedelta

import asyncio

from app.services.own_account_transfers import (
    build_match_metadata, reconcile_own_account_transfers,
    resolve_transfer_evidence, select_unique_pairs,
)


NOW = datetime(2026, 10, 31, 12)
ACCOUNTS = {
    "hsbc": {"_id": "hsbc", "account_number": "12345678", "type": "current"},
    "natwest": {"_id": "natwest", "account_number": "87654321", "type": "current"},
    "saver": {"_id": "saver", "account_number": "23456789", "type": "savings"},
}
TOKENS = ["kevin", "maingi"]


def row(id_, direction, account, amount=150.98, *, text="", days=0, currency="GBP", category="Income", custom=None):
    return {"_id": id_, "user_id": "kevin", "transaction_type": direction,
            "account_id": account, "amount": amount, "currency": currency,
            "date": NOW + timedelta(days=days), "description": text,
            "merchant_name": None, "category": category, "custom_category": custom}


def pairs(rows, learned=None):
    return select_unique_pairs(rows, ACCOUNTS, TOKENS, learned or set())


def test_compact_owner_initials_with_transfer_narrative_pair():
    credit = row("credit", "credit", "natwest", text="FROM A/C MAINGI KM VIA MOBILE XFER")
    debit = row("debit", "debit", "hsbc", text="TO MAINGI KM MOBILE TRANSFER", category="Other")
    assert pairs([credit, debit]) == [(credit, debit)]


def test_specific_other_account_number_is_strong_evidence_without_name():
    credit = row("credit", "credit", "natwest", text="BANK TRANSFER")
    debit = row("debit", "debit", "hsbc", text="TO 87654321")
    assert pairs([credit, debit]) == [(credit, debit)]


def test_sort_code_or_amount_and_date_alone_never_forms_pair():
    credit = row("salary", "credit", "natwest", amount=50, text="SALARY ACME")
    debit = row("atm", "debit", "hsbc", amount=50, text="ATM WITHDRAWAL 112233")
    assert pairs([credit, debit]) == []


def test_same_account_refund_and_foreign_currency_never_form_pair():
    same = [row("refund", "credit", "hsbc", text="TO 12345678"), row("purchase", "debit", "hsbc", text="TO 12345678")]
    fx = [row("credit", "credit", "natwest", text="TO 12345678", currency="GBP"), row("debit", "debit", "hsbc", text="TO 87654321", currency="EUR")]
    assert pairs(same) == []
    assert pairs(fx) == []


def test_zero_nan_infinite_and_unknown_currency_values_never_form_pair():
    for amount in (0, "NaN", "Infinity"):
        credit = row("credit", "credit", "natwest", amount=amount, text="TO 12345678")
        debit = row("debit", "debit", "hsbc", amount=amount, text="TO 87654321")
        assert pairs([credit, debit]) == []
    unknown = [
        row("credit", "credit", "natwest", text="TO 12345678", currency=""),
        row("debit", "debit", "hsbc", text="TO 87654321", currency=""),
    ]
    assert pairs(unknown) == []


def test_five_day_window_is_inclusive_six_days_is_not():
    credit = row("credit", "credit", "natwest", text="TO 12345678")
    at_five = row("five", "debit", "hsbc", text="TO 87654321", days=5)
    at_six = row("six", "debit", "hsbc", text="TO 87654321", days=6)
    assert pairs([credit, at_five]) == [(credit, at_five)]
    assert pairs([credit, at_six]) == []


def test_ambiguous_duplicate_counterparts_never_auto_choose():
    credit = row("credit", "credit", "natwest", text="TO 12345678")
    debit_one = row("debit-one", "debit", "hsbc", text="TO 87654321")
    debit_two = row("debit-two", "debit", "saver", text="TO 87654321")
    assert pairs([credit, debit_one, debit_two]) == []


def test_custom_movement_can_anchor_but_every_other_manual_choice_blocks():
    credit = row("credit", "credit", "natwest", text="unhelpful", custom="Investment")
    debit = row("debit", "debit", "hsbc", text="MOBILE TRANSFER", category="Other")
    assert pairs([credit, debit]) == [(credit, debit)]
    manual_income = row("manual", "credit", "natwest", text="TO 12345678", custom="Income")
    assert pairs([manual_income, debit]) == []


def test_declared_custom_movement_category_can_anchor_a_pair():
    credit = row("credit", "credit", "natwest", text="unhelpful", custom="House fund")
    debit = row("debit", "debit", "hsbc", text="BANK TRANSFER", category="Other")
    assert select_unique_pairs([credit, debit], ACCOUNTS, TOKENS, set(), movement_categories={"House fund"}) == [(credit, debit)]


def test_learned_private_description_pair_is_evidence():
    credit = row("credit", "credit", "natwest", text="PAYMENT FROM KEV")
    debit = row("debit", "debit", "hsbc", text="HSBC TO NATWEST")
    from app.services.own_account_transfers import canonical_merchant_key
    learned = {tuple(sorted((canonical_merchant_key("", credit["description"]), canonical_merchant_key("", debit["description"]))))}
    assert pairs([credit, debit], learned) == [(credit, debit)]


class _Cursor:
    def __init__(self, rows): self.rows = rows
    async def to_list(self, _): return list(self.rows)


class _Result:
    def __init__(self, changed): self.modified_count = changed


class _Collection:
    def __init__(self, rows): self.rows = rows
    def find(self, query, _projection=None):
        def matches(row):
            for key, expected in query.items():
                actual = row.get(key)
                if isinstance(expected, dict):
                    if "$in" in expected and actual not in expected["$in"]: return False
                    if "$gte" in expected and actual < expected["$gte"]: return False
                    if "$ne" in expected and actual == expected["$ne"]: return False
                elif actual != expected:
                    return False
            return True
        return _Cursor([row for row in self.rows if matches(row)])
    async def find_one(self, query, _projection=None):
        return next((row for row in self.rows if all(row.get(key) == val for key, val in query.items())), None)
    async def update_one(self, query, update):
        for current in self.rows:
            if all(current.get(key) == val for key, val in query.items()):
                before = dict(current)
                current.update(update.get("$set") or {})
                for key in update.get("$unset") or {}:
                    current.pop(key, None)
                return _Result(before != current)
        return _Result(False)


def test_reconcile_stamps_auto_rows_and_keeps_a_user_anchor():
    credit = row("credit", "credit", "saver", text="unhelpful", custom="Savings")
    debit = row("debit", "debit", "hsbc", text="BANK TRANSFER", category="Other")
    other_user = {**row("other", "debit", "hsbc", text="BANK TRANSFER"), "user_id": "someone-else"}
    stale = []
    async def mark(uid, *, reason): stale.append((uid, reason))
    async def run():
        collections = {
            "transaction_collection": _Collection([credit, debit, other_user]),
            "account_collection": _Collection([{**value, "user_id": "kevin"} for value in ACCOUNTS.values()]),
            "pair_collection": _Collection([]),
            "profile_collection": _Collection([{ "_id": "kevin", "name_tokens": TOKENS }]),
            "mark_stale_fn": mark,
            "movement_categories": {"Savings", "Investment", "Debt", "Transfer"},
        }
        first = await reconcile_own_account_transfers("kevin", **collections)
        second = await reconcile_own_account_transfers("kevin", **collections)
        return first, second
    first, second = asyncio.run(run())
    assert (first, second) == (1, 0)
    assert credit["custom_category"] == "Savings"
    assert debit["category"] == "Savings"
    assert debit["own_transfer_match"]["counterpart_id"] == "credit"
    assert other_user.get("own_transfer_match") is None
    assert stale == [("kevin", "own_account_transfer_reconciled")]


def _service_collections(rows, accounts, *, name_tokens=TOKENS):
    async def mark(_uid, *, reason):
        assert reason == "own_account_transfer_reconciled"
    return {
        "transaction_collection": _Collection(rows),
        "account_collection": _Collection(accounts),
        "pair_collection": _Collection([]),
        "profile_collection": _Collection([{ "_id": "kevin", "name_tokens": name_tokens }]),
        "mark_stale_fn": mark,
        "movement_categories": {"Savings", "Investment", "Debt", "Transfer", "House fund"},
    }


def test_reconcile_hydrates_missing_currency_from_accounts_and_skips_pending():
    now = datetime.utcnow()
    accounts = [{**value, "user_id": "kevin", "currency": "GBP"} for value in ACCOUNTS.values()]
    credit = row("credit", "credit", "natwest", text="TO 12345678")
    debit = row("debit", "debit", "hsbc", text="TO 87654321", category="Other")
    credit["date"] = debit["date"] = now
    credit.pop("currency"); debit.pop("currency")
    pending = row("pending", "debit", "hsbc", text="TO 87654321", category="Other")
    pending["date"] = now; pending["is_pending"] = True
    pending.pop("currency")
    async def run():
        collections = _service_collections([credit, debit, pending], accounts)
        return await reconcile_own_account_transfers("kevin", **collections)
    assert asyncio.run(run()) == 2
    assert credit["category"] == "Transfer"
    assert debit["category"] == "Transfer"
    assert pending["category"] == "Other"


def test_recent_history_is_rematched_after_second_account_arrives_but_old_history_is_not():
    now = datetime.utcnow()
    accounts = [{**ACCOUNTS["hsbc"], "user_id": "kevin", "currency": "GBP"}]
    credit = row("credit", "credit", "natwest", text="TO 12345678")
    debit = row("debit", "debit", "hsbc", text="TO 87654321", category="Other")
    credit["date"] = debit["date"] = now - timedelta(days=30)
    stale_credit = row("stale-credit", "credit", "natwest", text="TO 12345678")
    stale_debit = row("stale-debit", "debit", "hsbc", text="TO 87654321", category="Other")
    stale_credit["date"] = stale_debit["date"] = now - timedelta(days=91)
    async def run():
        collections = _service_collections([credit, debit, stale_credit, stale_debit], accounts)
        assert await reconcile_own_account_transfers("kevin", **collections) == 0
        accounts.append({**ACCOUNTS["natwest"], "user_id": "kevin", "currency": "GBP"})
        return await reconcile_own_account_transfers("kevin", **collections)
    assert asyncio.run(run()) == 2
    assert credit["category"] == debit["category"] == "Transfer"
    assert stale_credit["category"] == "Income"
    assert stale_debit["category"] == "Other"


def test_reclassified_eight_day_own_transfers_leave_no_income_series_but_salary_does():
    from app.routers.analytics import _detect_recurring
    now = datetime.utcnow()
    accounts = [{**value, "user_id": "kevin", "currency": "GBP"} for value in ACCOUNTS.values()]
    rows = []
    for index in range(3):
        credit = row(f"transfer-credit-{index}", "credit", "natwest", text="TO 12345678")
        debit = row(f"transfer-debit-{index}", "debit", "hsbc", text="TO 87654321", category="Other")
        credit["date"] = debit["date"] = now - timedelta(days=index * 8)
        rows.extend([credit, debit])
    salary = [
        row("salary-one", "credit", "natwest", amount=2000, text="ACME PAYROLL"),
        row("salary-two", "credit", "natwest", amount=2000, text="ACME PAYROLL", days=8),
    ]
    for item in salary: item["date"] = now - timedelta(days=14 - salary.index(item) * 7)
    async def run():
        collections = _service_collections(rows + salary, accounts)
        return await reconcile_own_account_transfers("kevin", **collections)
    assert asyncio.run(run()) == 6
    income = [item for item in rows + salary if item["category"] == "Income"]
    assert {item["_id"] for item in income} == {"salary-one", "salary-two"}
    assert _detect_recurring([item for item in rows if item["category"] == "Income"], is_income=True) == []


def _matched_rows():
    credit = row("credit", "credit", "natwest", text="TO 12345678", category="Income")
    debit = row("debit", "debit", "hsbc", text="TO 87654321", category="Other")
    credit["own_transfer_match"] = build_match_metadata(credit, debit, "Transfer")
    debit["own_transfer_match"] = build_match_metadata(debit, credit, "Transfer")
    credit["category"] = debit["category"] = "Transfer"
    return credit, debit


def test_evidence_resolver_restores_valid_target_after_generic_provider_reset():
    credit, debit = _matched_rows()
    credit["category"] = "Income"
    debit["category"] = "Other"
    resolved = {item["_id"]: item for item in resolve_transfer_evidence([credit, debit], {"Transfer", "Savings", "Investment", "Debt"})}
    assert resolved["credit"]["category"] == "Transfer"
    assert resolved["debit"]["category"] == "Transfer"
    assert resolved["credit"]["own_transfer_match"] == credit["own_transfer_match"]


def test_evidence_resolver_unwinds_when_counterpart_is_edited_or_gone():
    credit, debit = _matched_rows()
    debit["custom_category"] = "Shopping"
    edited = {item["_id"]: item for item in resolve_transfer_evidence([credit, debit], {"Transfer", "Savings", "Investment", "Debt"})}
    assert edited["credit"]["category"] == "Income"
    assert "own_transfer_match" not in edited["credit"]
    assert edited["debit"]["custom_category"] == "Shopping"
    assert "own_transfer_match" not in edited["debit"]

    credit, _ = _matched_rows()
    gone = resolve_transfer_evidence([credit], {"Transfer", "Savings", "Investment", "Debt"})[0]
    assert gone["category"] == "Income"
    assert "own_transfer_match" not in gone


def test_evidence_resolver_unwinds_when_a_matched_account_is_no_longer_owned():
    credit, debit = _matched_rows()
    resolved = {item["_id"]: item for item in resolve_transfer_evidence(
        [credit, debit], {"Transfer", "Savings", "Investment", "Debt"}, owned_account_ids={"hsbc"},
    )}
    assert resolved["credit"]["category"] == "Income"
    assert resolved["debit"]["category"] == "Other"
    assert "own_transfer_match" not in resolved["credit"]


def test_evidence_resolver_unwinds_for_changed_amount_currency_or_pending_counterpart():
    for field, value in (("amount", 151), ("currency", "EUR"), ("is_pending", True)):
        credit, debit = _matched_rows()
        debit[field] = value
        resolved = {item["_id"]: item for item in resolve_transfer_evidence([credit, debit], {"Transfer", "Savings", "Investment", "Debt"})}
        assert resolved["credit"]["category"] == "Income"
        assert "own_transfer_match" not in resolved["credit"]


def test_source_signature_excludes_automatic_category_but_keeps_user_choice():
    credit, debit = _matched_rows()
    credit["category"] = "Income"  # provider reset is not source evidence
    valid = resolve_transfer_evidence([credit, debit], {"Transfer", "Savings", "Investment", "Debt"})[0]
    assert valid["category"] == "Transfer"
    credit, debit = _matched_rows()
    credit["custom_category"] = "Income"
    manual = resolve_transfer_evidence([credit, debit], {"Transfer", "Savings", "Investment", "Debt"})[0]
    assert manual["custom_category"] == "Income"
    assert manual["category"] == "Transfer"  # reader never overwrites it


def test_reconcile_unsets_stale_marker_but_leaves_outside_ninety_days_alone():
    now = datetime.utcnow()
    accounts = [{**value, "user_id": "kevin", "currency": "GBP"} for value in ACCOUNTS.values()]
    credit, debit = _matched_rows()
    credit["date"] = debit["date"] = now
    debit["is_pending"] = True
    old_credit, old_debit = _matched_rows()
    old_credit["date"] = old_debit["date"] = now - timedelta(days=91)
    async def run():
        return await reconcile_own_account_transfers("kevin", **_service_collections([credit, debit, old_credit, old_debit], accounts))
    assert asyncio.run(run()) == 2
    assert credit["category"] == "Income"
    assert "own_transfer_match" not in credit
    assert old_credit["category"] == "Transfer"
    assert old_credit.get("own_transfer_match")


def test_reconcile_unwinds_recent_markers_after_an_account_is_removed():
    now = datetime.utcnow()
    credit, debit = _matched_rows()
    credit["date"] = debit["date"] = now
    accounts = [{**ACCOUNTS["hsbc"], "user_id": "kevin", "currency": "GBP"}]
    async def run():
        return await reconcile_own_account_transfers("kevin", **_service_collections([credit, debit], accounts))
    assert asyncio.run(run()) == 2
    assert credit["category"] == "Income"
    assert debit["category"] == "Other"
    assert not credit.get("own_transfer_match")
    assert not debit.get("own_transfer_match")


def test_confirmed_generic_pair_survives_reconcile_without_learning_descriptions():
    now = datetime.utcnow()
    accounts = [{**value, "user_id": "kevin", "currency": "GBP"} for value in ACCOUNTS.values()]
    credit = row("credit", "credit", "natwest", text="BANK ENTRY ALPHA", category="Income")
    debit = row("debit", "debit", "hsbc", text="BANK ENTRY BETA", category="Other")
    credit["date"] = debit["date"] = now
    credit["own_transfer_match"] = build_match_metadata(credit, debit, "Transfer", confirmed=True)
    debit["own_transfer_match"] = build_match_metadata(debit, credit, "Transfer", confirmed=True)
    # A later generic bank category reset does not alter source evidence.
    credit["category"] = "Income"
    debit["category"] = "Other"
    async def run():
        return await reconcile_own_account_transfers("kevin", **_service_collections([credit, debit], accounts))
    assert asyncio.run(run()) == 2
    assert credit["category"] == debit["category"] == "Transfer"
    assert credit["own_transfer_match"]["confirmed"] is True
    assert debit["own_transfer_match"]["confirmed"] is True



def test_partial_or_stale_confirmation_cannot_suppress_income_or_survive_sync():
    for damage in ("missing", "version", "source_signature", "counterpart_signature"):
        credit = row("credit", "credit", "natwest", text="BANK ENTRY ALPHA", category="Income")
        debit = row("debit", "debit", "hsbc", text="BANK ENTRY BETA", category="Other")
        credit["own_transfer_match"] = build_match_metadata(credit, debit, "Transfer", confirmed=True)
        debit["own_transfer_match"] = build_match_metadata(debit, credit, "Transfer", confirmed=True)
        credit["category"] = debit["category"] = "Transfer"
        if damage == "missing":
            debit.pop("own_transfer_match")
        else:
            debit["own_transfer_match"][damage] = "stale"
        assert pairs([credit, debit]) == []
        resolved = resolve_transfer_evidence([credit, debit], {"Transfer"})
        assert resolved[0]["category"] == "Income"
        assert not resolved[0].get("own_transfer_match")


def test_confirmed_custom_movement_anchor_needs_no_reciprocal_machine_marker():
    credit = row("credit", "credit", "natwest", text="BANK ENTRY ALPHA", category="Income")
    debit = row("debit", "debit", "hsbc", text="BANK ENTRY BETA", category="Other", custom="Savings")
    credit["own_transfer_match"] = build_match_metadata(credit, debit, "Transfer", confirmed=True)
    credit["category"] = "Transfer"
    assert pairs([credit, debit]) == [(credit, debit)]
    assert resolve_transfer_evidence([credit, debit], {"Transfer", "Savings"})[0]["category"] == "Transfer"
    debit["custom_category"] = "Shopping"
    assert pairs([credit, debit]) == []
    assert resolve_transfer_evidence([credit, debit], {"Transfer", "Savings"})[0]["category"] == "Income"


def test_confirmation_does_not_follow_changed_source_or_a_different_counterpart():
    credit = row("credit", "credit", "natwest", text="BANK ENTRY ALPHA", category="Income")
    debit = row("debit", "debit", "hsbc", text="BANK ENTRY BETA", category="Other")
    credit["own_transfer_match"] = build_match_metadata(credit, debit, "Transfer", confirmed=True)
    assert build_match_metadata(credit, debit, "Transfer")["confirmed"]
    assert not build_match_metadata(credit, {**debit, "_id": "other"}, "Transfer")["confirmed"]
    assert not build_match_metadata({**credit, "amount": 151}, debit, "Transfer")["confirmed"]
