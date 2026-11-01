"""A181: Finexer's account class and type are stored raw and every class maps
through one function. Finexer is mocked; no network, no DB."""
import pytest

from tests.test_a176_bank_sync import Resp, IDLE
from tests.test_a179_account_refresh import (  # noqa: F401  (fixtures)
    TwoAccountClient, _quiet, recomputes, _finexer_world, _call,
)
from app.routers.analytics import _account_pool_kind
from app.services.account_kinds import (
    finexer_account_kind, is_credit_card_account, is_current_account,
    is_debt_account, is_savings_account,
)


def _client(klass, acc_type="personal", current=100.0, available=100.0, overdraft=None):
    class C(TwoAccountClient):
        async def get(self, url, params=None):
            if url == "/bank_accounts":
                row = {"id": "acc1", "provider": "barclays"}
                if klass is not None:
                    row["class"] = klass
                if acc_type is not None:
                    row["type"] = acc_type
                return Resp(200, {"data": [row]})
            if url.endswith("/balance"):
                entry = {"type": "actual", "current": current, "available": available}
                if overdraft is not None:
                    entry["overdraft"] = overdraft
                return Resp(200, {"data": [entry]})
            return await super().get(url, params)
    return C(post_responses=[Resp(200, IDLE)])


def _doc(accts):
    return next(x for x in accts.docs if x["_id"] == "acc1")


# class -> (stored type, stored subtype, class_unknown stored)
MAPPING = {
    "credit_card": ("credit_card", "CREDIT_CARD", False),
    "charge_card": ("credit_card", "CREDIT_CARD", False),
    "savings": ("bank", "SAVINGS", False),
    "current": ("bank", "TRANSACTION", False),
    "emoney": ("bank", "TRANSACTION", False),
    "prepaid": ("bank", "TRANSACTION", False),
    "loan": ("debt", "LOAN", False),
    "mortgage": ("debt", "MORTGAGE", False),
    "something_new": ("bank", "TRANSACTION", True),
}


@pytest.mark.parametrize("klass", list(MAPPING))
def test_sync_stores_class_type_and_mapping(monkeypatch, recomputes, klass):
    accts, _ = _finexer_world(monkeypatch, client=_client(klass, "business"))
    _call("acc1")
    d = _doc(accts)
    typ, sub, unknown = MAPPING[klass]
    assert (d["type"], d["subtype"]) == (typ, sub)
    assert d["finexer_class"] == klass
    assert d["finexer_type"] == "business"
    assert d.get("class_unknown", False) is unknown


def test_missing_class_is_unknown_current(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, client=_client(None, None))
    _call("acc1")
    d = _doc(accts)
    assert d["subtype"] == "TRANSACTION" and d["class_unknown"] is True
    assert d["finexer_class"] is None and d["finexer_type"] is None


def test_known_class_clears_a_stale_unknown_flag(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, client=_client("something_new"))
    _call("acc1")
    assert _doc(accts)["class_unknown"] is True
    accts2, _ = _finexer_world(monkeypatch, client=_client("current"))
    accts2.docs.append({"_id": "acc1", "class_unknown": True})
    _call("acc1")
    assert "class_unknown" not in _doc(accts2)


def test_both_card_classes_are_cards_never_pool(monkeypatch):
    for klass in ("credit_card", "charge_card"):
        k = finexer_account_kind(klass)
        acc = {"type": k["type"], "subtype": k["subtype"], "currency": "GBP"}
        assert is_credit_card_account(acc)
        assert _account_pool_kind(acc) is None
        assert not is_current_account(acc) and not is_savings_account(acc)


def test_debt_accounts_are_never_cash_or_sources():
    for klass in ("loan", "mortgage"):
        k = finexer_account_kind(klass)
        acc = {"type": k["type"], "subtype": k["subtype"], "currency": "GBP"}
        assert is_debt_account(acc)
        assert _account_pool_kind(acc) is None
        assert not is_credit_card_account(acc)
        assert not is_current_account(acc) and not is_savings_account(acc)


def test_current_style_and_savings_keep_their_pools():
    for klass, pool in (("current", "spendable"), ("emoney", "spendable"), ("savings", "savings")):
        k = finexer_account_kind(klass)
        assert _account_pool_kind({"type": k["type"], "subtype": k["subtype"], "currency": "GBP"}) == pool


def test_truelayer_and_manual_classification_unchanged():
    tl_current = {"type": "bank", "subtype": "TRANSACTION", "currency": "GBP"}
    tl_savings = {"type": "bank", "subtype": "SAVINGS", "currency": "GBP"}
    tl_card = {"type": "credit_card", "subtype": "CREDIT_CARD", "currency": "GBP"}
    assert _account_pool_kind(tl_current) == "spendable"
    assert _account_pool_kind(tl_savings) == "savings"
    assert _account_pool_kind(tl_card) is None
    assert not is_debt_account(tl_current) and not is_debt_account(tl_savings) and not is_debt_account(tl_card)
    assert not is_debt_account({"type": "bank"})


# ---- part 2: business accounts default to not counted, at first import only


class _InsertCol:
    """Applies $set and $setOnInsert the way Mongo does, and $unset on update."""

    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    async def find_one(self, q=None, projection=None):
        q = q or {}
        return next((dict(d) for d in self.docs if all(d.get(k) == v for k, v in q.items() if not isinstance(v, dict))), None)

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if d.get("_id") == filt.get("_id"):
                d.update(update.get("$set") or {})
                for k in (update.get("$unset") or {}):
                    d.pop(k, None)
                return
        if upsert:
            nd = dict(update.get("$setOnInsert") or {})
            nd.update(update.get("$set") or {})
            self.docs.append(nd)


def _business_run(monkeypatch, klass, acc_type, existing=None):
    import app.services.finexer_sync as fs
    accts, _ = _finexer_world(monkeypatch, client=_client(klass, acc_type))
    col = _InsertCol(existing)
    monkeypatch.setattr(fs, "accounts_col", col)
    _call("acc1")
    return _doc(col)


def test_business_current_defaults_to_not_counted(monkeypatch, recomputes):
    assert _business_run(monkeypatch, "current", "business")["include_in_safe_to_spend"] is False


def test_business_savings_defaults_to_not_counted(monkeypatch, recomputes):
    assert _business_run(monkeypatch, "savings", "business")["include_in_safe_to_spend"] is False


def test_personal_and_unknown_type_leave_the_flag_absent(monkeypatch, recomputes):
    assert "include_in_safe_to_spend" not in _business_run(monkeypatch, "current", "personal")
    assert "include_in_safe_to_spend" not in _business_run(monkeypatch, "current", "unknown")


def test_existing_user_choice_is_never_flipped(monkeypatch, recomputes):
    d = _business_run(monkeypatch, "current", "business",
                      existing=[{"_id": "acc1", "include_in_safe_to_spend": True}])
    assert d["include_in_safe_to_spend"] is True
    d = _business_run(monkeypatch, "current", "business", existing=[{"_id": "acc1"}])
    assert "include_in_safe_to_spend" not in d


def test_business_card_has_no_flag_set(monkeypatch, recomputes):
    assert "include_in_safe_to_spend" not in _business_run(monkeypatch, "charge_card", "business")


# ---- part 3: card balance sign for both card classes


def test_card_balance_rule_is_minus_abs():
    from app.services.finexer_sync import card_balance_from_finexer as f
    assert f(123.45, 1000.0, None) == -123.45
    assert f(-123.45, -5.0, {"limit": 1000, "type": "credit"}) == -123.45
    assert f(0, None, None) == 0
    assert f(None, None, None) == 0
    assert f("bad", None, None) == 0


@pytest.mark.parametrize("klass", ["credit_card", "charge_card"])
@pytest.mark.parametrize("raw", [250.0, -250.0])
def test_both_card_classes_store_owed_as_negative(monkeypatch, recomputes, klass, raw):
    accts, _ = _finexer_world(monkeypatch, client=_client(klass, "business", current=raw, available=900.0))
    _call("acc1")
    d = _doc(accts)
    assert d["balance"] == -250.0
    assert d["card_current_sign"] == ("positive" if raw > 0 else "negative")


def test_charge_card_raw_sign_is_logged(monkeypatch, recomputes, caplog):
    import logging
    _finexer_world(monkeypatch, client=_client("charge_card", "business", current=250.0))
    with caplog.at_level(logging.INFO, logger="app.services.finexer_sync"):
        _call("acc1")
    line = next(r.getMessage() for r in caplog.records if "card balance shape" in r.getMessage())
    assert "class=charge_card" in line and "raw_current_sign=positive" in line and "250" not in line


@pytest.mark.parametrize("klass", ["current", "emoney", "loan", "mortgage"])
def test_non_card_balance_sign_untouched(monkeypatch, recomputes, klass):
    accts, _ = _finexer_world(monkeypatch, client=_client(klass, current=-80.0, available=0))
    _call("acc1")
    assert _doc(accts)["balance"] == -80.0


# ---- part 4: card credit limit


@pytest.mark.parametrize("klass", ["credit_card", "charge_card"])
def test_card_credit_limit_is_stored(monkeypatch, recomputes, klass):
    accts, _ = _finexer_world(monkeypatch, client=_client(
        klass, current=300.0, overdraft={"limit": 5000, "type": "credit"}))
    _call("acc1")
    assert _doc(accts)["credit_limit"] == 5000.0


def test_card_without_a_credit_overdraft_stores_no_limit(monkeypatch, recomputes):
    for od in (None, {"limit": 800, "type": "arranged"}, {"limit": 0, "type": "credit"},
               {"limit": "n/a", "type": "credit"}):
        accts, _ = _finexer_world(monkeypatch, client=_client("credit_card", overdraft=od))
        _call("acc1")
        assert "credit_limit" not in _doc(accts)


def test_credit_limit_cleared_when_the_bank_stops_reporting_it(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, client=_client("credit_card", overdraft=None))
    accts.docs.append({"_id": "acc1", "credit_limit": 4000.0})
    _call("acc1")
    assert "credit_limit" not in _doc(accts)


def test_credit_limit_not_stored_on_a_current_account(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, client=_client(
        "current", overdraft={"limit": 5000, "type": "credit"}))
    _call("acc1")
    assert "credit_limit" not in _doc(accts)


def test_accounts_api_model_exposes_credit_limit_as_optional():
    from app.core.models import Account
    base = dict(id="a", name="n", type="credit_card", balance=-1.0, provider="p")
    assert Account(**base, credit_limit=5000.0).model_dump()["credit_limit"] == 5000.0
    assert Account(**base).model_dump()["credit_limit"] is None


# ---- part 5: available and overdraft


def test_available_is_stored_where_returned(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, client=_client("current", current=120.0, available=620.0,
                                                          overdraft={"limit": 500, "type": "arranged"}))
    _call("acc1")
    d = _doc(accts)
    assert d["balance"] == 120.0 and d["available"] == 620.0
    assert d["overdraft_limit"] == 500.0 and d["overdraft_type"] == "arranged"


def test_overdraft_without_a_type_stores_the_limit_only(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, client=_client("current", overdraft={"limit": 250}))
    _call("acc1")
    d = _doc(accts)
    assert d["overdraft_limit"] == 250.0 and "overdraft_type" not in d


def test_credit_type_overdraft_on_a_current_account_is_not_an_overdraft(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, client=_client("current", overdraft={"limit": 500, "type": "credit"}))
    _call("acc1")
    assert "overdraft_limit" not in _doc(accts)


def test_overdraft_cleared_when_the_bank_drops_it(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, client=_client("current", overdraft=None))
    accts.docs.append({"_id": "acc1", "overdraft_limit": 500.0, "overdraft_type": "arranged"})
    _call("acc1")
    d = _doc(accts)
    assert "overdraft_limit" not in d and "overdraft_type" not in d


def test_card_stores_no_overdraft_limit(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, client=_client("credit_card", overdraft={"limit": 500, "type": "arranged"}))
    _call("acc1")
    assert "overdraft_limit" not in _doc(accts)


def test_accounts_api_model_exposes_available_and_overdraft():
    from app.core.models import Account
    base = dict(id="a", name="n", type="bank", balance=120.0, provider="p")
    dumped = Account(**base, available=620.0, overdraft_limit=500.0, overdraft_type="arranged").model_dump()
    assert (dumped["available"], dumped["overdraft_limit"], dumped["overdraft_type"]) == (620.0, 500.0, "arranged")
    assert Account(**base).model_dump()["overdraft_limit"] is None


def test_left_to_spend_pool_uses_balance_never_available_or_overdraft():
    from app.routers.analytics import _live_pool_balances
    acc = {"_id": "a", "type": "bank", "subtype": "TRANSACTION", "currency": "GBP", "balance": 120.0,
           "available": 620.0, "overdraft_limit": 500.0}
    assert _live_pool_balances([acc])["spendable_balance"] == 120.0


# ---- review fixes: debt balance sign, card_debt, net worth


def test_debt_balance_rule_is_minus_abs():
    from app.services.finexer_sync import debt_balance_from_finexer as f
    assert f(9000.0) == -9000.0 and f(-9000.0) == -9000.0 and f(None) == 0 and f("x") == 0


@pytest.mark.parametrize("klass", ["loan", "mortgage"])
@pytest.mark.parametrize("raw", [9000.0, -9000.0])
def test_debt_stored_negative_with_raw_sign_kept(monkeypatch, recomputes, klass, raw):
    accts, _ = _finexer_world(monkeypatch, client=_client(klass, current=raw))
    _call("acc1")
    d = _doc(accts)
    assert d["balance"] == -9000.0
    assert d["debt_current_sign"] == ("positive" if raw > 0 else "negative")


def test_positive_reporting_loan_does_not_inflate_net_worth_and_shows_as_owed():
    # Stored value after the sync rule, summed the way KPIs sum net worth.
    from app.services.finexer_sync import debt_balance_from_finexer as f
    balances = [1000.0, f(9000.0)]
    assert sum(balances) == -8000.0
    assert f(9000.0) < 0  # the Owed lens filters balance < 0 (lib/accountsEstate.ts)


def test_debt_is_kept_out_of_card_debt():
    import inspect
    import app.routers.analytics as an
    src = inspect.getsource(an)
    i = src.index("card_debt_total = 0.0")
    assert "is_debt_account(acc)" in src[i:i + 600]
