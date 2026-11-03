"""G412: a genuine failure to load dated card payments fails closed (degraded,
Left to spend at most 0, the component named), unlike an unusable dated rule
which falls back to learned behaviour (see the card-bill-dated-* scenarios).
Invented scenario data only, run on the guarded wealth_test_* database."""
import asyncio
import json
from datetime import date, datetime

from app.core import timeutil
from app.db.guard import make_guarded_client_class
from tests.test_scenarios import (
    LONDON, SCEN_DIR, _freeze_clock, _rebind_collections, _seed, _uid,
)


def test_statement_bill_load_failure_degrades_and_clamps_left_to_spend(monkeypatch):
    from app.core.config import MONGO_URI
    from app.routers import analytics
    from app.services import card_statements

    spec = json.loads((SCEN_DIR / "card-bill-dated-statement.json").read_text())
    uid = _uid("g412-load-failure")
    today_d = date.fromisoformat(spec["today"])
    fixed_now = datetime(today_d.year, today_d.month, today_d.day, 9, 0, tzinfo=LONDON)
    monkeypatch.setattr(timeutil, "user_now", lambda: fixed_now)
    monkeypatch.setattr(timeutil, "user_today", lambda: today_d)

    async def boom(*_args, **_kwargs):
        raise RuntimeError("temporary read failure")

    monkeypatch.setattr(card_statements, "load_statement_bills", boom)

    async def go():
        client = make_guarded_client_class()(MONGO_URI, maxPoolSize=5, serverSelectionTimeoutMS=8000)
        restore = _rebind_collections(client)
        unfreeze = _freeze_clock(fixed_now)
        try:
            await _seed(spec, uid)
            return await analytics.compute_safe_to_spend(uid)
        finally:
            unfreeze()
            restore()
            client.close()

    sts = asyncio.run(go())

    assert sts["calculation_status"] == "degraded"
    assert "card_statement_bills" in sts["unavailable_components"]
    assert sts["safe_to_spend"] <= 0
