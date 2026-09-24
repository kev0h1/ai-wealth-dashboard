import asyncio
from datetime import datetime, timedelta

from app.routers.transactions import _search_query, _merge_paginate, _normalise_search_text

BASE = datetime(2026, 8, 1)


def txn(day_offset, desc="Coffee", merchant=None, merchant_key=None, category="Eating Out"):
    return {
        "description": desc,
        "merchant_name": merchant,
        "merchant_key": merchant_key,
        "category": category,
        "custom_category": None,
        "date": BASE + timedelta(days=day_offset),
    }


# --- _search_query -----------------------------------------------------

def test_search_query_user_scoped_with_no_filters():
    assert _search_query("kevin@x.com", None, None, None) == {"user_id": "kevin@x.com"}


def test_search_query_q_matches_five_fields():
    q = _search_query("kevin@x.com", "playtomic", None, None)
    or_fields = {list(c.keys())[0] for c in q["$and"][1]["$or"]}
    assert or_fields == {"description", "merchant_name", "merchant_key", "category", "custom_category"}


def test_search_query_days_adds_date_range():
    q = _search_query("kevin@x.com", None, None, 30)
    assert "date" in q and "$gte" in q["date"]


def test_search_query_category_adds_clause():
    q = _search_query("kevin@x.com", None, "Padel", None)
    assert q["$and"][1] == {"$or": [{"custom_category": "Padel"},
                                     {"custom_category": {"$in": [None, ""]}, "category": "Padel"}]}


def test_search_query_all_filters_combine():
    q = _search_query("kevin@x.com", "playtomic", "Padel", 90)
    assert len(q["$and"]) == 3


def test_search_query_from_to_adds_date_range():
    q = _search_query("kevin@x.com", None, None, None, date_from="2026-07-31", date_to="2026-08-27")
    assert q["date"]["$gte"] == datetime(2026, 7, 31)
    assert q["date"]["$lte"] == datetime(2026, 8, 27, 23, 59, 59, 999999)


def test_search_query_from_only():
    q = _search_query("kevin@x.com", None, None, None, date_from="2026-07-31")
    assert q["date"] == {"$gte": datetime(2026, 7, 31)}


def test_search_query_to_only():
    q = _search_query("kevin@x.com", None, None, None, date_to="2026-08-27")
    assert q["date"] == {"$lte": datetime(2026, 8, 27, 23, 59, 59, 999999)}


def test_search_query_from_to_overrides_days():
    q = _search_query("kevin@x.com", None, None, 30, date_from="2026-07-31", date_to="2026-08-27")
    assert q["date"]["$gte"] == datetime(2026, 7, 31)
    assert q["date"]["$lte"] == datetime(2026, 8, 27, 23, 59, 59, 999999)


def test_search_query_no_date_filters_means_all_history():
    q = _search_query("kevin@x.com", None, None, None)
    assert "date" not in q


def test_search_query_invalid_date_ignored():
    q = _search_query("kevin@x.com", None, None, None, date_from="not-a-date")
    assert "date" not in q


# --- A93: NUL byte / control-character robustness ------------------------
# GET /transactions/search 500s (pentest API-11) when `q` contains a NUL
# byte, because a `$regex` pattern with an embedded NUL fails BSON cstring
# encoding. `_search_query` must never raise for any `q`, and a query that
# normalises down to nothing behaves exactly like an absent/blank query.

def test_normalise_search_text_strips_nul_byte():
    assert _normalise_search_text("play\x00tomic") == "playtomic"


def test_normalise_search_text_strips_control_characters():
    assert _normalise_search_text("\x01\x02\x1f\x7fplay\x0btomic\x9f") == "playtomic"


def test_normalise_search_text_all_control_characters_returns_none():
    assert _normalise_search_text("\x00\x01\x02\x1f") is None


def test_normalise_search_text_caps_length():
    result = _normalise_search_text("a" * 5000)
    assert result == "a" * 200


def test_normalise_search_text_collapses_whitespace():
    assert _normalise_search_text("  play   tomic  ") == "play tomic"


def test_normalise_search_text_none_and_blank():
    assert _normalise_search_text(None) is None
    assert _normalise_search_text("") is None
    assert _normalise_search_text("   ") is None


def test_normalise_search_text_normal_query_unchanged():
    assert _normalise_search_text("playtomic") == "playtomic"


def test_search_query_nul_byte_in_q_does_not_raise():
    q = _search_query("kevin@x.com", "play\x00tomic", None, None)
    or_fields = {list(c.keys())[0] for c in q["$and"][1]["$or"]}
    assert or_fields == {"description", "merchant_name", "merchant_key", "category", "custom_category"}
    rx = q["$and"][1]["$or"][0]["description"]["$regex"]
    assert "\x00" not in rx


def test_search_query_control_characters_only_behaves_like_blank_q():
    q = _search_query("kevin@x.com", "\x00\x01\x02", None, None)
    assert q == {"user_id": "kevin@x.com"}


def test_search_query_5000_char_q_is_capped_and_does_not_raise():
    q = _search_query("kevin@x.com", "a" * 5000, None, None)
    rx = q["$and"][1]["$or"][0]["description"]["$regex"]
    assert len(rx) == 200


def test_search_query_normal_query_still_matches_five_fields():
    q = _search_query("kevin@x.com", "playtomic", None, None)
    or_fields = {list(c.keys())[0] for c in q["$and"][1]["$or"]}
    assert or_fields == {"description", "merchant_name", "merchant_key", "category", "custom_category"}
    rx = q["$and"][1]["$or"][0]["description"]["$regex"]
    assert rx == "playtomic"


def test_search_query_merchants_nul_byte_does_not_raise():
    q = _search_query("kevin@x.com", None, None, None, merchants="Play\x00tomic,Tesco")
    merchant_or = q["$and"][1]["$or"]
    rx_values = [list(c.values())[0]["$regex"] for c in merchant_or]
    assert all("\x00" not in rx for rx in rx_values)


# --- _merge_paginate -----------------------------------------------------

def test_merge_paginate_orders_across_collections_by_date():
    col_a = [txn(5), txn(1)]
    col_b = [txn(3), txn(0)]
    page1 = _merge_paginate([col_a, col_b], page=1, page_size=2)
    assert [d["date"] for d in page1] == [BASE + timedelta(days=5), BASE + timedelta(days=3)]


def test_merge_paginate_second_page_continues_global_order():
    col_a = [txn(5), txn(1)]
    col_b = [txn(3), txn(0)]
    page2 = _merge_paginate([col_a, col_b], page=2, page_size=2)
    assert [d["date"] for d in page2] == [BASE + timedelta(days=1), BASE + timedelta(days=0)]


def test_merge_paginate_empty_collections():
    assert _merge_paginate([[], []], page=1, page_size=20) == []


def test_merge_paginate_missing_date_sorts_last():
    no_date = {"description": "x", "date": None}
    result = _merge_paginate([[txn(1), no_date]], page=1, page_size=2)
    assert result[-1] is no_date


# --- A93 follow-up: resolve_movement's mine-offline branch ----------------
# Review found the same bug class reached via a different endpoint: the
# mine-offline branch of POST /transactions/{id}/resolve-movement takes
# `offline_pot_name` straight from the request body, length-caps it, and
# feeds it to re.escape/$regex with no control-character stripping — the
# identical NUL-byte crash as _search_query above.

class _FakeCol:
    """Minimal find_one/insert_one/update_one fake keyed on plain equality —
    no mongomock in this environment, same local-copy convention this
    suite's neighbours use (e.g. test_offline_account_ranking.py)."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query):
        for d in self.docs:
            if all(d.get(k) == v for k, v in query.items()):
                return d
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def update_one(self, filt, update):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filt.items()):
                d.update(update.get("$set", {}))
                return


def _resolve_movement_env(monkeypatch, txn):
    """Wires resolve_movement's collections to in-memory fakes and stubs
    out the fire-and-forget cashflow recompute it kicks off on any
    category_changed path, so the test never touches the real Mongo/worker
    machinery, only the mine-offline branch under test."""
    import asyncio as _asyncio_mod

    import app.routers.analytics as analytics_router
    import app.routers.transactions as transactions_router

    txn_col = _FakeCol([txn])
    manual_col = _FakeCol([])
    teaching_col = _FakeCol([])
    monkeypatch.setattr(transactions_router, "transactions_col", txn_col)
    monkeypatch.setattr(transactions_router, "manual_accounts_col", manual_col)
    monkeypatch.setattr(transactions_router, "teaching_events_col", teaching_col)

    async def _fake_compute_and_cache_cashflow(uid, clear_ai_cache=False):
        return None

    monkeypatch.setattr(analytics_router, "compute_and_cache_cashflow", _fake_compute_and_cache_cashflow)
    return transactions_router, manual_col


def test_resolve_movement_mine_offline_nul_byte_does_not_raise(monkeypatch):
    uid = "kevin@x.com"
    txn = {"_id": "t1", "user_id": uid, "transaction_type": "debit"}
    transactions_router, manual_col = _resolve_movement_env(monkeypatch, txn)

    result = asyncio.run(transactions_router.resolve_movement(
        "t1",
        {"resolution": "mine-offline", "offline_pot_name": "Play\x00tomic pot"},
        {"email": uid},
    ))

    assert result["offline_pot_name"] == "Playtomic pot"
    assert manual_col.docs and "\x00" not in manual_col.docs[0]["name"]


def test_resolve_movement_mine_offline_control_characters_only_falls_back_to_default(monkeypatch):
    uid = "kevin@x.com"
    txn = {"_id": "t1", "user_id": uid, "transaction_type": "debit"}
    transactions_router, manual_col = _resolve_movement_env(monkeypatch, txn)

    result = asyncio.run(transactions_router.resolve_movement(
        "t1",
        {"resolution": "mine-offline", "offline_pot_name": "\x00\x01\x02"},
        {"email": uid},
    ))

    assert result["offline_pot_name"] == "An account of mine elsewhere"
    assert manual_col.docs and manual_col.docs[0]["name"] == "An account of mine elsewhere"
