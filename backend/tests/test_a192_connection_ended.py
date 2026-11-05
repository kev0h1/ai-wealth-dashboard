"""A192 (Kevin 2026-11-05): an account whose bank connection is revoked or
expired (status "expired", the A189 marker) is left out of every pool, source
and income credit. One helper, `counted_accounts.is_excluded`, answers it."""
import asyncio

from app.routers.analytics import _account_pool_kind, _split_balances
from app.services import counted_accounts as ca
from app.services.account_walk import POOLED_POLICY, pooled_seed
from app.services.penny_consolidation import classify_sources


def _acc(aid="a", status="connected", flag=None, balance=500.0, **extra):
    doc = {"_id": aid, "id": aid, "name": f"Acc {aid}", "type": "bank", "subtype": "TRANSACTION",
           "balance": balance, "currency": "GBP", "status": status, **extra}
    if flag is not None:
        doc["include_in_safe_to_spend"] = flag
    return doc


def test_helper_rules():
    assert ca.connection_ended(_acc(status="expired"))
    assert not ca.connection_ended(_acc())
    assert not ca.connection_ended(None)
    assert ca.is_excluded(_acc(status="expired"))
    assert ca.is_excluded(_acc(flag=False))
    assert not ca.is_excluded(_acc())
    assert ca.is_counted(_acc(flag=True))
    # An offline or manual account never carries a status, so it is unaffected.
    assert not ca.is_excluded({"_id": "m", "name": "Cash", "balance": 10.0})
    # The user's own flag is still its own question.
    assert ca.user_excluded(_acc(flag=False)) and not ca.user_excluded(_acc(status="expired"))


def test_pool_leaves_out_the_expired_balance():
    live, gone = _acc("live", balance=300.0), _acc("gone", status="expired", balance=5000.0)
    assert _account_pool_kind(gone) is None
    assert _account_pool_kind(live) == "spendable"
    assert _split_balances([live, gone]) == (300.0, 0.0)
    assert pooled_seed([live, gone], POOLED_POLICY) == 300.0


def test_expired_savings_is_left_out_of_the_savings_pool():
    gone = _acc("s", status="expired", balance=900.0, subtype="SAVINGS")
    assert _split_balances([gone]) == (0.0, 0.0)


def test_expired_account_is_never_a_spend_from_or_move_source():
    live, gone = _acc("live"), _acc("gone", status="expired")
    elig = {k: {"headroom": 400.0, "account_headroom_raw": 400.0, "spend_from_headroom": 400.0,
                "is_current_account": True} for k in ("live", "gone")}
    sources, skipped = classify_sources(
        target_id=None, eligibility=elig, accounts=[live, gone], include_savings=False,
        pot_ids=set(), name_tokens=[], spending=True,
    )
    assert [s["account_id"] for s in sources] == ["live"]
    assert [(s["account_id"], s["reason"]) for s in skipped] == [("gone", "excluded")]


def test_excluded_ids_include_ended_accounts_and_drop_their_items():
    class _Col:
        def __init__(self, docs):
            self.docs = docs

        def find(self, query, proj=None):
            wanted_status = query.get("status")
            ors = query.get("$or")

            def match(d):
                if wanted_status is not None:
                    return d.get("status") == wanted_status
                if ors:
                    return any(
                        ("status" in o and d.get("status") == o["status"])
                        or (ca.FLAG in o and d.get(ca.FLAG) is False)
                        for o in ors
                    )
                return True

            rows = [d for d in self.docs if match(d)]

            async def gen():
                for r in rows:
                    yield r
            return gen()

    cols = (_Col([_acc("live"), _acc("gone", status="expired")]), _Col([_acc("user-off", flag=False)]), _Col([]))
    orig = ca._COLLECTIONS
    ca._COLLECTIONS = cols
    try:
        assert asyncio.run(ca.excluded_account_ids("u")) == {"gone", "user-off"}
        assert asyncio.run(ca.ended_account_ids("u")) == {"gone"}
    finally:
        ca._COLLECTIONS = orig
    resp = {
        "upcoming_bills": [{"account_id": "live"}, {"account_id": "gone"}],
        "upcoming_income": [{"account_id": "gone"}],
        "internal_inflows": [{"account_id": "gone"}],
    }
    ca.drop_excluded_items(resp, {"gone"})
    assert resp["upcoming_bills"] == [{"account_id": "live"}]
    assert resp["upcoming_income"] == [] and resp["internal_inflows"] == []


def test_account_api_row_says_not_counted_when_connection_ended():
    from app.core.models import Account

    base = dict(id="x", name="X", type="bank", balance=1.0, currency="GBP", provider="p")
    for status, flag, counted in (("expired", True, False), ("connected", False, False), ("connected", True, True)):
        row = Account(**base, status=status, include_in_safe_to_spend=flag)
        assert row.counted_in_left_to_spend is counted
        assert row.model_dump()["counted_in_left_to_spend"] is counted
