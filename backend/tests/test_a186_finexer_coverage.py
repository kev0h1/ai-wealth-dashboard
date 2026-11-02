"""A186: advisory Finexer coverage map, balance-only accounts, health exclusion.

Finexer is mocked at the client level and Mongo collections are the in-memory
fakes from test_a176_bank_sync; no database is touched.
"""
import asyncio
from datetime import datetime, timedelta

import app.services.finexer_sync as fs
import app.services.finexer_webhooks as fxw
from app.services import finexer_coverage as cov
from tests.test_a176_bank_sync import (  # noqa: F401  (autouse fixture is imported too)
    CONSENT, IDLE, NOW, UID, Client, Col, Resp, _quiet, _wire_sync,
)


def test_map_lookups():
    assert cov.supported_kinds("monzo") == {"current"}
    assert cov.supported_kinds("amex") == {"card"}
    assert cov.supported_kinds("hoares") == {"savings", "card"}
    assert cov.supported_kinds("nationwide") == {"current", "savings", "card"}
    assert cov.supported_kinds("MONZO") == {"current"}
    assert cov.supported_kinds("not_a_bank") == frozenset()
    assert cov.supported_kinds(None) == frozenset()
    assert len(cov.COVERAGE) == 60


def test_kind_exclusion_and_unknowns():
    ok, why = cov.is_balance_only("amex", {"class": "current", "identification": {"sort_code": "112233"}})
    assert ok and "does not appear to share current account transactions" in why
    assert cov.is_balance_only("amex", {"class": "credit_card"}) == (False, "")
    ok, why = cov.is_balance_only("monzo", {"class": "savings", "identification": {"account_number": "12345678"}})
    assert ok and "savings account" in why
    assert cov.is_balance_only("unknown_bank", {"class": "savings"}) == (False, "")
    # Unrecognised class never decides; loans and mortgages never decide.
    assert cov.is_balance_only("amex", {"class": "wibble"}) == (False, "")
    assert cov.is_balance_only("amex", {"class": "loan"}) == (False, "")


def test_pot_detection():
    pot = {"class": "current", "identification": {}}
    ok, why = cov.is_balance_only("monzo", pot)
    assert ok and why == "Monzo does not share pot transactions through Open Banking."
    assert cov.is_balance_only("monzo", {"class": "current", "identification": {"sort_code": "040004", "account_number": "12345678"}}) == (False, "")
    assert cov.is_balance_only("revolut", pot)[0] and cov.is_balance_only("starling", pot)[0]
    assert cov.is_balance_only("halifax", pot) == (False, "")
    for _p in ("monzo", "revolut", "starling"):
        assert "—" not in cov.is_balance_only(_p, pot)[1]


class PotClient(Client):
    def __init__(self, booked_for_pot=None, **kw):
        super().__init__(**kw)
        self.booked_for_pot = booked_for_pot or []

    async def get(self, url, params=None):
        if url == "/bank_accounts":
            return Resp(200, {"data": [
                {"id": "acc1", "class": "current", "provider": "monzo",
                 "identification": {"sort_code": "040004", "account_number": "12345678"}},
                {"id": "pot1", "class": "current", "provider": "monzo", "identification": {}},
            ]})
        if url == "/bank_accounts/pot1/balance":
            return Resp(200, {"data": [{"type": "actual", "current": 250.0}]})
        if url.startswith("/bank_accounts/pot1/transactions"):
            return Resp(200, {"data": self.booked_for_pot})
        return await super().get(url, params)


def test_pot_skips_syncs_but_keeps_balance_and_rows(monkeypatch):
    accts = Col([])
    _wire_sync(monkeypatch, accts)
    c = PotClient(post_responses=[Resp(200, {**IDLE, "auto_sync_interval": 6})],
                  booked_for_pot=[{"id": "t1"}], booked=[])
    monkeypatch.setattr(fs, "_client", lambda: c)
    fetched, new = asyncio.run(fs.sync_finexer_consent(CONSENT, UID, request_bank_sync=True))
    assert sorted(fetched) == ["acc1", "pot1"]
    assert new == 1, "rows that return for a balance-only account are still stored"
    assert all("pot1" not in u for u, _ in c.posts), "no setter or bank sync POST for the pot"
    assert any("acc1" in u for u, _ in c.posts)
    pot = next(d for d in accts.docs if d["_id"] == "pot1")
    cur = next(d for d in accts.docs if d["_id"] == "acc1")
    assert pot["balance"] == 250.0
    assert pot["balance_only"] is True
    assert pot["balance_only_reason"] == "Monzo does not share pot transactions through Open Banking."
    for k in ("bank_sync_requested_at", "bank_auto_sync_hours", "bank_synced_to"):
        assert k not in pot
    assert cur["balance_only"] is False and cur["balance_only_reason"] is None


def test_corrected_map_heals_the_flag(monkeypatch):
    accts = Col([{"_id": "pot1", "balance_only": True, "balance_only_reason": "stale"}])
    _wire_sync(monkeypatch, accts)
    monkeypatch.setattr(fs, "is_balance_only", lambda code, acc: (False, ""))
    c = PotClient(booked=[])
    monkeypatch.setattr(fs, "_client", lambda: c)
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    pot = next(d for d in accts.docs if d["_id"] == "pot1")
    assert pot["balance_only"] is False and pot["balance_only_reason"] is None


def _health(monkeypatch, consents, accounts):
    import app.db.collections as colls
    monkeypatch.setattr(colls, "finexer_consents_col", Col(consents))
    monkeypatch.setattr(colls, "accounts_col", Col(accounts))
    return asyncio.run(fxw._compute_sync_health(NOW))


def test_health_excludes_balance_only_accounts(monkeypatch):
    old = NOW - timedelta(hours=40)
    out = _health(
        monkeypatch,
        [{"_id": "c1", "status": "authorized"}, {"_id": "c2", "status": "authorized"},
         {"_id": "c3", "status": "authorized"}],
        [
            # c1: only a pot, with an ancient time: no alert, not "without data".
            {"_id": "p1", "connection_id": "c1", "source": "finexer", "balance_only": True, "bank_synced_to": old},
            # c2: pot plus a fresh current account.
            {"_id": "p2", "connection_id": "c2", "source": "finexer", "balance_only": True},
            {"_id": "a2", "connection_id": "c2", "source": "finexer", "bank_synced_to": NOW - timedelta(hours=1)},
            # c3: a normal account that has never reported: still without data.
            {"_id": "a3", "connection_id": "c3", "source": "finexer", "balance_only": False},
        ],
    )
    assert out["alert"] is False and out["consents_stale"] == 0
    assert out["consents_without_bank_data"] == 1
    assert out["authorized_consents"] == 3
    assert len(out["consents"]) == 2


def test_health_still_alerts_on_a_stale_syncing_account(monkeypatch):
    out = _health(
        monkeypatch,
        [{"_id": "c1", "status": "authorized"}],
        [{"_id": "a1", "connection_id": "c1", "source": "finexer", "bank_synced_to": NOW - timedelta(hours=40)},
         {"_id": "p1", "connection_id": "c1", "source": "finexer", "balance_only": True}],
    )
    assert out["alert"] is True and out["consents_stale"] == 1
