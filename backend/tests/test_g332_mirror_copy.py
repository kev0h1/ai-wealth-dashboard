"""G332: factual Signature copy and its first-load cache refresh."""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest

from app.services import behaviour
from app.services.categories import BUILTIN_CATEGORY_KINDS


class _Cursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, _length):
        return deepcopy(self.documents)


class _Collection:
    def __init__(self, documents):
        self.documents = documents

    def find(self, *_args, **_kwargs):
        return _Cursor(self.documents)


class _SpendingContext:
    def is_own_move(self, _transaction_id):
        return False

    def is_card_repayment(self, _transaction_id):
        return False


def _transactions(count: int, span_days: int) -> list[dict]:
    """Eligible optional-spend transactions distributed across the window."""
    last_day = datetime.now(timezone.utc).date()
    return [
        {
            "_id": str(index),
            "user_id": "u",
            "date": datetime.combine(
                last_day - timedelta(days=span_days - round(index * span_days / (count - 1))),
                datetime.min.time(),
            ),
            "amount": -10,
            "category": "Eating Out",
            "transaction_type": "debit",
        }
        for index in range(count)
    ]


async def _signature(monkeypatch, *, count: int, span_days: int) -> dict:
    monkeypatch.setattr(behaviour, "transactions_col", _Collection(_transactions(count, span_days)))
    monkeypatch.setattr(behaviour, "accounts_col", _Collection([]))

    async def category_kinds(_uid):
        return BUILTIN_CATEGORY_KINDS

    async def spending_context(*_args, **_kwargs):
        return _SpendingContext()

    monkeypatch.setattr(behaviour, "get_category_kinds", category_kinds)
    monkeypatch.setattr(behaviour, "build_spending_context", spending_context)
    portrait = await behaviour.compute_portrait("u")
    return next(trait for trait in portrait["traits"] if trait["id"] == "signature_pleasure")


@pytest.mark.parametrize(
    ("count", "span_days", "expected_frequency"),
    [
        (5, 150, "about once a month"),
        (11, 60, "about 6 times a month"),
    ],
)
def test_signature_frequency_is_natural_and_factual(monkeypatch, count, span_days, expected_frequency):
    trait = asyncio.run(_signature(monkeypatch, count=count, span_days=span_days))

    assert trait["evidence"][1] == f"£{count * 10:.0f} total · {expected_frequency}"
    assert trait["narrative"] == "Eating Out is your most frequent category for optional spending."


@pytest.mark.parametrize("choice", ["keep", "change"])
def test_mirror_initial_reload_refreshes_copy_and_preserves_choice(monkeypatch, choice):
    import app.routers.behaviour as router

    fresh = datetime.now(timezone.utc).isoformat()
    stored = {
        "_id": "u",
        "status": "ok",
        "computed_at": fresh,
        "portrait_version": router.PORTRAIT_VERSION - 1,
        "traits": [{"id": "signature_pleasure", "choice": choice}],
    }
    written = []

    class _PortraitCollection:
        async def find_one(self, *_args, **_kwargs):
            return deepcopy(stored)

        async def replace_one(self, _filter, document, **_kwargs):
            written.append(document)

    async def compute(_uid):
        return {
            "status": "ok",
            "computed_at": fresh,
            "portrait_version": router.PORTRAIT_VERSION,
            "traits": [{
                "id": "signature_pleasure",
                "choice": None,
                "narrative": "Eating Out is your most frequent category for optional spending.",
                "evidence": ["11 eating out transactions in the window", "£110 total · about 6 times a month"],
            }],
        }

    monkeypatch.setattr(router, "behaviour_portrait_col", _PortraitCollection())
    monkeypatch.setattr(router, "compute_portrait", compute)
    result = asyncio.run(router.get_mirror(refresh=False, user={"email": "u"}))

    assert result["traits"][0]["choice"] == choice
    assert result["traits"][0]["narrative"] == "Eating Out is your most frequent category for optional spending."
    assert result["traits"][0]["evidence"][1].endswith("about 6 times a month")
    assert written[0]["traits"][0]["choice"] == choice


def test_mirror_serves_a_fresh_version_matched_cache_without_recomputing(monkeypatch):
    import app.routers.behaviour as router

    cached = {
        "_id": "u",
        "status": "ok",
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "portrait_version": router.PORTRAIT_VERSION,
        "traits": [{"id": "signature_pleasure", "choice": "change"}],
    }

    class _PortraitCollection:
        async def find_one(self, *_args, **_kwargs):
            return deepcopy(cached)

    async def should_not_compute(_uid):
        raise AssertionError("a fresh, version-matched portrait must be served from cache")

    monkeypatch.setattr(router, "behaviour_portrait_col", _PortraitCollection())
    monkeypatch.setattr(router, "compute_portrait", should_not_compute)

    result = asyncio.run(router.get_mirror(refresh=False, user={"email": "u"}))

    assert result["traits"][0]["choice"] == "change"
