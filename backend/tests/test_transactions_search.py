from datetime import datetime, timedelta

from app.routers.transactions import _search_query, _merge_paginate

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
