"""G355 step 2: an account is found by bank, product word, nickname or kind, and
nothing listed back to the user is ever a raw (possibly holder) name."""
import asyncio

import pytest

import app.routers.accounts as accounts_module
import app.services.notifications as notifications_module
from app.core.models import Account
from app.services.penny_tools import _resolve_account_for_propose

UID = "g355-match"
HOLDER = "Kevin Mbithi Maingi"

ACCOUNTS = [
    Account(id="bar", name="Premier Current Account", type="transaction", subtype="TRANSACTION", balance=900.0, provider="ob-barclays"),
    Account(id="mon", name=HOLDER, type="transaction", subtype="TRANSACTION", balance=120.0, provider="monzo"),
    Account(id="pot", name="Saving Challenge (2026)", type="savings", subtype="SAVINGS_ACCOUNT", balance=10.0, provider="monzo"),
    Account(id="exc", name="Excess", type="savings", subtype="SAVINGS_ACCOUNT", balance=0.0, provider="ob-hsbc"),
    Account(id="amex", name="Amex Gold", type="credit", subtype="CREDIT_CARD", balance=-50.0, provider="amex"),
    Account(id="cash", name="Wallet", type="cash", balance=20.0, provider="manual", manual=True),
]


@pytest.fixture(autouse=True)
def world(monkeypatch):
    async def accounts(user):
        return list(ACCOUNTS)

    async def tokens(uid):
        return ["kevin", "mbithi", "maingi"]

    monkeypatch.setattr(accounts_module, "get_accounts", accounts)
    monkeypatch.setattr(notifications_module, "_user_name_tokens", tokens)


def resolve(ref):
    return asyncio.run(_resolve_account_for_propose(UID, ref))


@pytest.mark.parametrize("ref,account_id", [
    ("My Monzo current account", "mon"),
    ("monzo current", "mon"),
    ("the Monzo everyday account please", "mon"),
    ("Barclays Premier", "bar"),
    ("Premier Current Account", "bar"),
    ("barclays current", "bar"),
    ("Kevin Mbithi Maingi", "mon"),  # a holder name typed by the user still resolves
    ("kevin", "mon"),
    ("savings challenge", "pot"),  # the 2026-08-30 nickname fix still holds
    ("my Monzo pot", "pot"),
    ("hsbc savings", "exc"),
    ("my amex card", "amex"),
    ("Amex Gold", "amex"),
    ("cash", "cash"),
    ("mon", "mon"),  # an id wins
])
def test_resolves_to_one_account(ref, account_id):
    res = resolve(ref)
    assert res.get("account") is not None, res
    assert res["account"].id == account_id


def test_bank_alone_is_ambiguous_with_safe_labels():
    res = resolve("Monzo")
    assert res["ambiguous"] is True
    assert {m["id"] for m in res["matches"]} == {"mon", "pot"}
    names = [m["name"] for m in res["matches"]]
    assert "your Monzo account, current" in names
    assert any("Saving Challenge (2026), savings" in n for n in names)
    assert "Maingi" not in " ".join(names) and "Kevin" not in " ".join(names)


def test_unknown_reference_lists_safe_labels_only():
    res = resolve("Nationwide flex")
    assert res["error"].startswith("no account matching")
    joined = " | ".join(res["available"])
    assert "Barclays Premier Current Account, current" in res["available"]
    assert "your Monzo account, current" in res["available"]
    assert "Maingi" not in joined and "Kevin" not in joined and "Mbithi" not in joined
    assert len(res["available"]) <= 8 and "available_more" not in res


def test_available_is_capped_at_eight(monkeypatch):
    many = [Account(id=f"x{i}", name=f"Pot {i}", type="savings", balance=0.0, provider="monzo") for i in range(12)]

    async def accounts(user):
        return many

    monkeypatch.setattr(accounts_module, "get_accounts", accounts)
    res = resolve("Nationwide")
    assert len(res["available"]) == 8 and res["available_more"] == 4


def test_empty_reference_is_no_account():
    assert resolve("") == {"account": None}
    assert resolve("my account")["error"].startswith("no account matching")
