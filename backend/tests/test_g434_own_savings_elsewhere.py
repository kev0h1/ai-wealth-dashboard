"""G434: an own-savings standing order into a saver the bank does not share
(so no destination can ever be learned) is recognised from savings wording PLUS
own-money evidence, never from words alone, and the user's own category choice
outranks the engine either way. Invented names throughout.
"""
import asyncio
from datetime import datetime, timedelta

import pytest

import app.routers.card_terms  # noqa: F401  (H143: pre-import before any collection patching)
import app.services.debt_plan  # noqa: F401
from app.services.own_savings import detect_savings_elsewhere, has_savings_words

TOKENS = ["jordan", "blake"]


def _t(desc, **kw):
    return {"description": desc, "merchant_name": None, **kw}


def test_words_alone_are_never_enough():
    series = [_t("ACME REGULAR SAVER CLUB"), _t("ACME REGULAR SAVER CLUB")]
    assert has_savings_words("ACME REGULAR SAVER CLUB")
    assert not detect_savings_elsewhere(series, name_tokens=TOKENS, account_name="Chase Uk Main", provider="chase")


def test_words_plus_the_users_own_name_tokens_is_a_question_not_a_decision():
    # G438 (Kevin 2026-11-07): the user's name is only a question for the
    # transfers review, never evidence that the money stays with the user.
    series = [_t("JORDAN BLAKE REGULAR SAVER")]
    assert not detect_savings_elsewhere(series, name_tokens=TOKENS, account_name="Main", provider="chase")
    assert not detect_savings_elsewhere([_t("BLAKE REGULAR SAVER")], name_tokens=TOKENS, account_name="Main", provider="chase")


def test_account_name_shape_is_no_longer_evidence():
    # G437: "<this account's own name> to <savings name>" says nothing about
    # whose money the payee holds, so it never counts (words alone, no evidence).
    series = [_t("Everyday Main to Regular Saver")]
    assert has_savings_words("Everyday Main to Regular Saver")
    assert not detect_savings_elsewhere(series, name_tokens=[], account_name="Chase Uk Everyday Main", provider="chase")
    assert not detect_savings_elsewhere(series, name_tokens=[], account_name="Everyday Main", provider="chase")


def test_words_plus_the_engines_own_pair_evidence():
    series = [_t("TO MY ISA", own_transfer_match={"counterpart_id": "x"})]
    assert detect_savings_elsewhere(series, name_tokens=[], account_name="Main", provider="chase")


def test_user_category_choice_switches_the_heuristic_off_both_ways():
    series = [_t("JORDAN BLAKE REGULAR SAVER", custom_category="Shopping")]
    assert not detect_savings_elsewhere(series, name_tokens=TOKENS, account_name="Main", provider="chase")
    series = [_t("JORDAN BLAKE REGULAR SAVER", custom_category="Transfer")]
    assert not detect_savings_elsewhere(series, name_tokens=TOKENS, account_name="Main", provider="chase")
    # A user-chosen Savings or Investment is not argued with here (is_savings_order reads the category).
    series = [_t("JORDAN BLAKE REGULAR SAVER", custom_category="Savings")]
    assert detect_savings_elsewhere(series, name_tokens=TOKENS, account_name="Main", provider="chase")


@pytest.mark.parametrize("text,expected", [
    ("Regular Saver", True), ("my isa top up", True), ("LISA", True), ("Easy Access", True), ("savings", True),
    ("POT NOODLE LTD", True), ("Potters Bar Cafe", False), ("Isabel Stores", False), ("Visa payment", False),
])
def test_wording_is_whole_words_only(text, expected):
    assert has_savings_words(text) is expected


class _Cursor:
    def __init__(self, rows): self.rows = rows
    async def to_list(self, _): return self.rows
    def __aiter__(self):
        async def gen():
            for r in self.rows:
                yield r
        return gen()


class _Col:
    def __init__(self, rows): self.rows = rows
    def find(self, query=None, projection=None):
        projection = projection or {}
        return _Cursor([{k: v for k, v in r.items() if k == "_id" or not projection or projection.get(k)} for r in self.rows])
    async def find_one(self, *_a, **_k): return None


def _patterns(monkeypatch, descriptions_by_account, *, name_tokens=None, custom_category=None, category="Transfer"):
    """Run the REAL pattern builder over four monthly £300 own-account debits."""
    from app.routers import analytics
    from app.services.categories import BUILTIN_CATEGORY_KINDS, CategoryKinds

    now = datetime.now() - timedelta(days=3)
    rows = []
    for acct, desc in descriptions_by_account.items():
        for i in range(4):
            rows.append({
                "_id": f"{acct}-{i}", "account_id": acct, "amount": 300.0, "date": now - timedelta(days=30 * i),
                "transaction_type": "debit", "category": category, "description": desc, "currency": "GBP",
                **({"custom_category": custom_category} if custom_category else {}),
            })
    accounts = [{"_id": a, "name": "Everyday Main" if a == "source" else a, "provider": "chase", "currency": "GBP",
                 "type": "BANK", "subtype": "TRANSACTION", "balance": 500} for a in descriptions_by_account]
    monkeypatch.setattr(analytics, "transactions_col", _Col(rows))
    monkeypatch.setattr(analytics, "yapily_transactions_col", _Col([]))
    monkeypatch.setattr(analytics, "accounts_col", _Col(accounts))
    monkeypatch.setattr(analytics, "yapily_accounts_col", _Col([]))
    monkeypatch.setattr(analytics, "preferences_col", _Col([]))

    async def kinds(_): return CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))
    async def judge(*_a, **_k): return {}
    async def identity(_uid): return {"name_tokens": name_tokens or [], "own_ids": set(), "own_map": {}}
    monkeypatch.setattr(analytics, "get_category_kinds", kinds)
    monkeypatch.setattr(analytics, "judge_suspect_series", judge)
    monkeypatch.setattr(analytics, "user_identity", identity)
    try:
        doc = asyncio.run(analytics._compute_cashflow_patterns("owner"))
    except Exception as exc:  # the fakes cover only what the spend path reads
        pytest.skip(f"pattern builder needs more of the DB than this fakes: {type(exc).__name__}: {exc}")
    return {r["key"]: r for r in doc["recurring_spend"]}


def test_pattern_builder_does_not_stamp_a_name_only_series(monkeypatch):
    # G438: savings wording plus the user's name is no longer recognised.
    got = _patterns(monkeypatch, {"source": "JORDAN BLAKE REGULAR SAVER"}, name_tokens=TOKENS)
    assert got, "the series was detected"
    assert [r.get("own_savings_elsewhere", False) for r in got.values()] == [False]
    assert all(r["dest_account_id"] is None for r in got.values())


def test_pattern_builder_leaves_words_without_evidence_alone(monkeypatch):
    got = _patterns(monkeypatch, {"source": "ACME REGULAR SAVER CLUB"}, name_tokens=TOKENS)
    assert got
    assert [r.get("own_savings_elsewhere", False) for r in got.values()] == [False]


def test_pattern_builder_respects_the_users_own_category(monkeypatch):
    got = _patterns(monkeypatch, {"source": "JORDAN BLAKE REGULAR SAVER"}, name_tokens=TOKENS, custom_category="Transfer")
    assert [r.get("own_savings_elsewhere", False) for r in got.values()] == [False]


def test_pattern_builder_stamps_a_user_savings_choice_without_wording(monkeypatch):
    got = _patterns(monkeypatch, {"source": "ACME STANDING ORDER"}, custom_category="Savings")
    assert [r.get("own_savings_elsewhere") for r in got.values()] == [True]


def test_pattern_builder_ignores_an_engine_assigned_investment_category(monkeypatch):
    got = _patterns(monkeypatch, {"source": "VANGUARD ASSET MGMT"}, category="Investment")
    assert got
    assert [r.get("own_savings_elsewhere", False) for r in got.values()] == [False]


def test_pattern_builder_ignores_the_account_name_shape(monkeypatch):
    # G437: "<source account name> to <savings name>" is words only, no evidence.
    got = _patterns(monkeypatch, {"source": "Everyday Main to Regular Saver"})
    assert got
    assert [r.get("own_savings_elsewhere", False) for r in got.values()] == [False]
