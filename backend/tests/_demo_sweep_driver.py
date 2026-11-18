"""H157 test aid: seed the C43 demo account for each day in a range with the
clock pinned to that day, and print the computed figures as JSON lines.

Run only by tests/test_demo_seeder.py, in a subprocess, against the
wealth_test_* database the test run already uses. The seeder imports
SEEDER from a path argument so the red proof can point it at a /tmp copy.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def _load(path: str):
    spec = importlib.util.spec_from_file_location("seed_demo_account_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


_PIN: dict = {"day": None}
_REAL_DATETIME = datetime
_REAL_DATE = date


class _InstMeta(type):
    """isinstance(real_datetime_from_mongo, FakeDatetime) must stay True."""

    def __instancecheck__(cls, inst):
        return isinstance(inst, cls._real)


def _pinned_noon():
    d = _PIN["day"]
    return _REAL_DATETIME(d.year, d.month, d.day, 12, 0)


class FakeDatetime(_REAL_DATETIME, metaclass=_InstMeta):
    _real = _REAL_DATETIME

    @classmethod
    def now(cls, tz=None):
        n = _pinned_noon()
        if tz is None:
            return cls(n.year, n.month, n.day, 12)
        from app.core import timeutil
        return cls.fromtimestamp(n.replace(tzinfo=timeutil.LONDON).timestamp(), tz)

    @classmethod
    def utcnow(cls):
        n = _pinned_noon()
        return cls(n.year, n.month, n.day, 12)

    @classmethod
    def today(cls):
        return cls.now()


class FakeDate(_REAL_DATE, metaclass=_InstMeta):
    _real = _REAL_DATE

    @classmethod
    def today(cls):
        d = _PIN["day"]
        return cls(d.year, d.month, d.day)


def install_clock() -> None:
    """Pin datetime.now()/utcnow()/today() and date.today() to _PIN["day"] across
    the app, so the whole recompute sees the pinned day, not the real one."""
    import datetime as dtmod
    dtmod.datetime = FakeDatetime
    dtmod.date = FakeDate
    for name, mod in list(sys.modules.items()):
        if not (name.startswith("app") or name.startswith("scripts") or name.startswith("seed_demo")):
            continue
        for attr, val in list(vars(mod).items()):
            if val is _REAL_DATETIME:
                setattr(mod, attr, FakeDatetime)
            elif val is _REAL_DATE:
                setattr(mod, attr, FakeDate)


async def _warm_imports(seeder) -> None:
    """Import every module a seed touches before the clock is pinned, so the
    pin reaches their `from datetime import ...` names too."""
    from app.routers import analytics  # noqa: F401
    from app.services import data_version, response_cache, warmup  # noqa: F401
    from app.services import subscription_admin  # noqa: F401
    from app.routers import profile  # noqa: F401
    from app.services import categorisation  # noqa: F401


async def _run(seeder, start: date, days: int) -> None:
    from app.core import config, timeutil
    from app.db import collections as dbc
    from app.db.guard import TEST_DB_NAME_RE

    assert TEST_DB_NAME_RE.match(config.MONGO_DB), "sweep only runs against a wealth_test_* database"
    _PIN["day"] = start
    await _warm_imports(seeder)
    install_clock()
    for i in range(days):
        day = start + timedelta(days=i)
        _PIN["day"] = day
        timeutil.user_today = lambda d=day: d
        timeutil.user_now = lambda d=day: datetime(d.year, d.month, d.day, 12, 0, tzinfo=timeutil.LONDON)
        await seeder.seed(today=day)
        uid = config.DEMO_LOGIN_EMAIL
        sts = (await dbc.response_cache_col.find_one({"user_id": uid, "name": "safe_to_spend"}))["payload"]
        today_doc = (await dbc.response_cache_col.find_one({"user_id": uid, "name": "today"}))["payload"]
        elig = today_doc.get("account_eligibility") or {}
        moves = [x for x in today_doc.get("items", []) if x.get("type") == "move"]
        covers = {k: v.get("covered_by_move") for k, v in elig.items() if v.get("covered_by_move")}
        print(json.dumps({
            "day": day.isoformat(),
            "safe_to_spend": sts.get("safe_to_spend"),
            "state": sts.get("state"),
            "status": sts.get("calculation_status"),
            "moves": len(moves),
            "cover_sources": [f.get("account_id") for c in covers.values() for f in c.get("from", [])],
            "short": sorted(k for k, v in elig.items() if v.get("short")),
            "accounts": await dbc.accounts_col.count_documents({"user_id": uid}),
            "goals": await dbc.commitments_col.count_documents({"user_id": uid, "status": "active"}),
            "plans": await dbc.allocations_col.count_documents({"user_id": uid, "active": True}),
        }), flush=True)


def main() -> int:
    seeder_path, start, days = sys.argv[1], date.fromisoformat(sys.argv[2]), int(sys.argv[3])
    asyncio.run(_run(_load(seeder_path), start, days))
    return 0


if __name__ == "__main__":
    sys.exit(main())
