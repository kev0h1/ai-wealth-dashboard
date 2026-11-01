"""A183 part 1: Finexer's counterparty fields (party_name, party_sort_code,
party_number, category_group) are stored normalised and identify transfers
between the user's own accounts without guessing. Mocked rows only."""
import asyncio
from datetime import datetime

import app.services.finexer_sync as fs
import app.services.own_account_transfers as oat

UID = "u-a183"
NOW = datetime(2026, 10, 31, 12)


class FakeTxns:
    def __init__(self):
        self.docs = {}

    async def find_one_and_update(self, flt, update, upsert=False, projection=None, return_document=None):
        before = self.docs.get(flt["_id"])
        doc = dict(before or {})
        doc.update(update["$set"])
        if before is None:
            doc.update(update.get("$setOnInsert") or {})
        self.docs[flt["_id"]] = doc
        return dict(before) if before else None


class FakeAccounts:
    def __init__(self, docs):
        self.docs = docs

    def find(self, flt, projection=None):
        rows = [d for d in self.docs if d.get("user_id") == flt.get("user_id")]

        class Cur:
            async def to_list(self, n):
                return rows
        return Cur()


OWN = [
    {"_id": "cur", "user_id": UID, "sort_code": "20-00-00", "account_number": "12345678", "subtype": "TRANSACTION", "type": "bank"},
    {"_id": "card", "user_id": UID, "sort_code": "112233", "account_number": "87654321", "subtype": "CREDIT_CARD", "type": "credit_card"},
    {"_id": "sav", "user_id": UID, "sort_code": "30-00-00", "account_number": "11112222", "subtype": "SAVINGS", "type": "bank"},
]


def _run(txns, account_id="cur", accounts=OWN, monkeypatch=None):
    store = FakeTxns()
    monkeypatch.setattr(fs, "transactions_col", store)
    monkeypatch.setattr(oat, "accounts_col", FakeAccounts(accounts))

    async def go():
        return await fs._upsert_finexer_walk(txns, account_id, UID, None, {"changed": False})

    asyncio.run(go())
    return store.docs


def base(id_, amount, **extra):
    return {"id": id_, "amount": amount, "date": "2026-10-30T10:00:00Z", "description": "ACME LTD", **extra}


def test_normalisers_accept_formatting_and_reject_wrong_lengths():
    assert oat.normalise_sort_code("20-00-00") == "200000"
    assert oat.normalise_sort_code(" 20 00 00 ") == "200000"
    assert oat.normalise_sort_code("2000") is None
    assert oat.normalise_account_number("1234 5678") == "12345678"
    assert oat.normalise_account_number("GB29NWBK60161331926819") is None
    assert oat.normalise_account_number("1234567") is None


def test_party_fields_are_stored_normalised_with_category_group(monkeypatch):
    docs = _run([base("t1", -20, party_name="  Some  Shop ", party_sort_code="04-00-04",
                      party_number="1234 5678", category_group="shopping")], monkeypatch=monkeypatch)
    row = docs["t1"]
    assert (row["party_name"], row["party_sort_code"], row["party_number"]) == ("Some Shop", "040004", "12345678")
    assert row["category_group"] == "shopping"


def test_party_fields_read_from_nested_metadata(monkeypatch):
    docs = _run([base("t1", -20, metadata={"party_name": "X", "party_sort_code": "040004", "party_number": "12345678"})],
                monkeypatch=monkeypatch)
    assert docs["t1"]["party_number"] == "12345678"


def test_absent_or_malformed_party_fields_are_not_stored(monkeypatch):
    docs = _run([base("t1", -20, party_sort_code="12", party_number="abc")], monkeypatch=monkeypatch)
    assert "party_sort_code" not in docs["t1"] and "party_number" not in docs["t1"]
    assert "category_group" not in docs["t1"]


def test_credit_from_own_account_is_transfer_not_income(monkeypatch):
    docs = _run([base("t1", 50, party_sort_code="30-00-00", party_number="11112222")], monkeypatch=monkeypatch)
    assert docs["t1"]["category"] == "Transfer"


def test_debit_to_own_card_is_debt_and_debit_to_savings_is_savings(monkeypatch):
    docs = _run([
        base("t1", -75, party_sort_code="112233", party_number="87654321"),
        base("t2", -10, party_sort_code="300000", party_number="11112222"),
    ], monkeypatch=monkeypatch)
    assert docs["t1"]["category"] == "Debt"
    assert docs["t2"]["category"] == "Savings"


def test_card_side_credit_is_transfer(monkeypatch):
    docs = _run([base("t1", 75, party_sort_code="200000", party_number="12345678")], account_id="card", monkeypatch=monkeypatch)
    assert docs["t1"]["category"] == "Transfer"


def test_counterparty_that_is_the_same_account_or_unknown_is_not_own(monkeypatch):
    docs = _run([
        base("t1", 50, party_sort_code="200000", party_number="12345678"),   # this account itself
        base("t2", 50, party_sort_code="999999", party_number="99999999"),   # not the user's
        base("t3", 50, party_sort_code="300000"),                            # sort code alone never matches
    ], monkeypatch=monkeypatch)
    assert docs["t1"]["category"] == "Income"
    assert docs["t2"]["category"] == "Income"
    assert docs["t3"]["category"] == "Income"


def test_pairing_uses_counterparty_as_strong_evidence_without_narrative():
    accounts = {a["_id"]: a for a in OWN}
    credit = {"_id": "c", "user_id": UID, "transaction_type": "credit", "account_id": "sav", "amount": 30, "currency": "GBP",
              "date": NOW, "description": "PAYMENT", "merchant_name": None, "category": "Income", "custom_category": None,
              "party_sort_code": "200000", "party_number": "12345678"}
    debit = {**credit, "_id": "d", "transaction_type": "debit", "account_id": "cur", "category": None,
             "party_sort_code": None, "party_number": None}
    assert oat.select_unique_pairs([credit, debit], accounts, [], set()) == [(credit, debit)]


def test_pairing_without_counterparty_or_narrative_does_not_pair():
    accounts = {a["_id"]: a for a in OWN}
    credit = {"_id": "c", "user_id": UID, "transaction_type": "credit", "account_id": "sav", "amount": 30, "currency": "GBP",
              "date": NOW, "description": "PAYMENT", "merchant_name": None, "category": "Income", "custom_category": None}
    debit = {**credit, "_id": "d", "transaction_type": "debit", "account_id": "cur"}
    assert oat.select_unique_pairs([credit, debit], accounts, [], set()) == []


def test_walking_account_with_a_duplicate_identification_never_labels_its_own_rows(monkeypatch):
    accounts = OWN + [{"_id": "cur-dup", "user_id": UID, "sort_code": "200000", "account_number": "12345678",
                       "subtype": "TRANSACTION", "type": "bank"}]
    docs = _run([base("t1", 50, party_sort_code="200000", party_number="12345678")], account_id="cur-dup",
                accounts=accounts, monkeypatch=monkeypatch)
    assert docs["t1"]["category"] == "Income"
    docs = _run([base("t2", 50, party_sort_code="200000", party_number="12345678")], account_id="cur",
                accounts=accounts, monkeypatch=monkeypatch)
    assert docs["t2"]["category"] == "Income"


def test_shared_identification_with_different_kinds_falls_back_to_plain_transfer(monkeypatch):
    accounts = OWN + [{"_id": "sav-twin", "user_id": UID, "sort_code": "112233", "account_number": "87654321",
                       "subtype": "SAVINGS", "type": "bank"}]
    docs = _run([base("t1", -75, party_sort_code="112233", party_number="87654321")], accounts=accounts, monkeypatch=monkeypatch)
    assert docs["t1"]["category"] == "Transfer"


def test_shared_identification_with_the_same_kind_keeps_the_refined_kind(monkeypatch):
    accounts = OWN + [{"_id": "card2", "user_id": UID, "sort_code": "112233", "account_number": "87654321",
                       "subtype": "CREDIT_CARD", "type": "credit_card"}]
    docs = _run([base("t1", -75, party_sort_code="112233", party_number="87654321")], accounts=accounts, monkeypatch=monkeypatch)
    assert docs["t1"]["category"] == "Debt"
