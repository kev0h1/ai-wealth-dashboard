"""G254: synthetic world for Kevin's DigitalOcean thread, shared by the golden
sequence test and scripts/penny_thread_live_eval.py. No real data: one
synthetic user with DIGITALOCEAN.COM rows posted in USD with no fx fields (the
shape synced rows really have), a Tesco row, and another user's identically
named row that must never be returned."""
from datetime import date, datetime

from tests.test_penny_category_routing import _Col as _BaseCol, _FakeTx

UID = "g254-golden-user"
OTHER = "g254-golden-other"
TODAY = date(2026, 10, 10)
ALL_DO = ["do-1", "do-2", "do-3", "do-4"]


class Col(_BaseCol):
    def distinct(self, field, query=None):
        from tests.test_penny_category_routing import _match

        async def _go():
            return sorted({d[field] for d in self._docs if d.get(field) is not None and _match(d, query or {})})
        return _go()


def rows():
    def do(i, m, d, amt):
        return {"_id": f"do-{i}", "id": f"do-{i}", "user_id": UID, "transaction_type": "debit", "amount": amt,
                "currency": "USD", "date": datetime(2026, m, d), "description": "DIGITALOCEAN.COM",
                "merchant_name": None, "merchant_key": "digitalocean.com", "category": "Bills", "account_id": "acc-1"}
    return [
        do(1, 6, 1, 14.40), do(2, 7, 1, 4.80), do(3, 8, 1, 4.80), do(4, 9, 1, 9.60),
        {"_id": "tesco-1", "id": "tesco-1", "user_id": UID, "transaction_type": "debit", "amount": 31.2,
         "currency": "GBP", "date": datetime(2026, 6, 2), "description": "TESCO STORES", "merchant_name": "Tesco",
         "merchant_key": "tesco", "category": "Groceries", "account_id": "acc-2"},
        {"_id": "other-1", "id": "other-1", "user_id": OTHER, "transaction_type": "debit", "amount": 14.40,
         "currency": "USD", "date": datetime(2026, 6, 1), "description": "DIGITALOCEAN.COM", "merchant_name": None,
         "merchant_key": "digitalocean.com", "category": "Bills", "account_id": "acc-x"},
    ]


def install(penny_tools_module, setter):
    """Point penny_tools at the fixture. `setter(obj, name, value)` is
    monkeypatch.setattr, or a plain setattr for the live script."""
    cs = (Col(rows()), Col([]), Col([]))
    setter(penny_tools_module, "_SEARCH_COLLECTIONS", cs)
    setter(penny_tools_module, "_doc_to_tx", _FakeTx.from_doc)

    async def no_category(uid, text):
        return None, []

    setter(penny_tools_module, "_resolve_user_category", no_category)
    setter(penny_tools_module.timeutil, "user_today", lambda: TODAY)


# Kevin's exact five questions, with the tool call a correct model makes for each.
THREAD = [
    dict(q="Digital Ocean", args={"merchants": "Digital Ocean"}, expect_ids=ALL_DO),
    dict(q="DigitalOcean LLC", args={"merchants": "DigitalOcean LLC"}, expect_ids=ALL_DO),
    dict(q="$14.40 for the first of june", args={"amount": 14.4, "date_from": "2026-06-01", "date_to": "2026-06-01"},
         expect_ids=["do-1"]),
    dict(q="do they have fx rates on all these transactions", args={"transaction_ids": "last_result"},
         expect_ids=["do-1"], honest_no_rate=True),
    dict(q="DIGITALOCEAN.COM is there an fx rate on these transactions", args={"merchants": "DIGITALOCEAN.COM"},
         expect_ids=ALL_DO, honest_no_rate=True),
]
