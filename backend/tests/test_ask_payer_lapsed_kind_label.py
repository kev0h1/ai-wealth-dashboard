"""G157 review fix (blocker 3, independent review of a165200d):
`AskGenericCard` hardcoded "Card detail" as its kind label, written for
the card-terms ask -- the only ask type that used this card before
`ask:payer_lapsed` (a lapsed confirmed income stream, see
app/services/income_payer.py's `is_lapsed`) started rendering through it
too, showing the wrong label above "Has your pay changed?".

The fix adds `kind_label` to the ask item itself (backend-decided, per
item type) rather than hardcoding it client-side; this test proves the
backend item actually carries the right value. Companion-harness style,
following the same full-collection-fake pattern as
tests/test_confirmed_salary_alias.py (this file's sibling).
"""
import asyncio
from datetime import timedelta

import app.db.collections as db_collections
import app.services.companion as companion
import app.services.pace as pace_module
from app.routers.analytics import PATTERNS_VERSION

UID = "ask-payer-lapsed-user"
ACCT_ID = "acc-current"
STREAM_KEY = "9942 GOLDMAN SACHS"


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d

    async def to_list(self, n):
        return list(self._docs)

    def sort(self, *a, **kw):
        return self

    def limit(self, *a, **kw):
        return self


class _Col:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        return _Cursor(list(self.docs))

    async def find_one(self, query=None, projection=None):
        return self.docs[0] if self.docs else None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if d.get("_id") == filt.get("_id"):
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                return
        if upsert:
            new_doc = dict(filt)
            for k, v in (update.get("$set") or {}).items():
                new_doc[k] = v
            self.docs.append(new_doc)


def _account(balance):
    return {
        "_id": ACCT_ID, "name": "Premier Current Account", "balance": balance,
        "subtype": "TRANSACTION", "type": "TRANSACTION", "provider": "Barclays",
        "currency": "GBP",
    }


def _run(monkeypatch, *, lapsed_income_entry, days_to_pay=5, accounts=None):
    monkeypatch.setattr(companion, "cashflow_cache_col", _Col([{
        "_id": UID,
        "patterns_version": PATTERNS_VERSION,
        "recurring_income": [lapsed_income_entry],
    }]))
    monkeypatch.setattr(companion, "preferences_col", _Col([{
        "user_id": UID,
        "income_streams": [{
            "key": STREAM_KEY, "status": "confirmed",
            "schedule": {"type": "day_of_month", "day": 28},
            "avg_amount": 4798.08,
        }],
    }]))
    monkeypatch.setattr(companion, "accounts_col", _Col(accounts if accounts is not None else [_account(1000.0)]))
    monkeypatch.setattr(companion, "yapily_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "manual_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "companion_items_col", _Col([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", _Col([]))
    monkeypatch.setattr(companion, "transactions_col", _Col([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", _Col([]))
    monkeypatch.setattr(db_collections, "card_terms_col", _Col([]))
    monkeypatch.setattr(db_collections, "commitments_col", _Col([]))
    monkeypatch.setattr(pace_module, "cashflow_cache_col", _Col([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", _Col([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", _Col([]))

    import app.services.pay_period as pay_period
    import app.services.income as income_mod

    # Non-None: skips the unrelated `ask:payday` item entirely (a confirmed
    # payday already exists), so this test isolates `ask:payer_lapsed`.
    monkeypatch.setattr(income_mod, "get_confirmed_payday", lambda prefs, today_d: (today_d, {}))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=days_to_pay))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": [], "upcoming_income": [], "internal_inflows": []}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    return asyncio.run(companion.compute_today_items(UID, payday_preview=True, persist=False))


def test_ask_payer_lapsed_carries_the_right_kind_label(monkeypatch):
    lapsed_entry = {
        "key": STREAM_KEY,
        "source": "confirmed",
        "lapsed": True,
        "missed_cycles": 2.1,
        "avg_amount": 4798.08,
        "account_id": ACCT_ID,
        "next_date": "2026-09-28",
    }
    items = _run(monkeypatch, lapsed_income_entry=lapsed_entry)

    lapsed_asks = [i for i in items if i["type"] == "ask" and i["id"].startswith("ask:payer_lapsed:")]
    assert len(lapsed_asks) == 1
    item = lapsed_asks[0]
    assert item["headline"] == "Has your pay changed?"
    # The actual regression this item closes: the right label, not the
    # card-terms ask's hardcoded "Card detail".
    assert item["kind_label"] == "Your pay"
    assert item["kind_label"] != "Card detail"


def test_non_lapsed_confirmed_stream_does_not_raise_the_ask(monkeypatch):
    """Regression guard alongside the kind_label test above: a confirmed
    stream that has NOT lapsed must never raise ask:payer_lapsed at all --
    the kind_label plumbing only matters once the ask actually fires."""
    non_lapsed_entry = {
        "key": STREAM_KEY, "source": "confirmed", "lapsed": False,
        "missed_cycles": 0.0, "avg_amount": 4798.08, "account_id": ACCT_ID,
        "next_date": "2026-09-28",
    }
    items = _run(monkeypatch, lapsed_income_entry=non_lapsed_entry)
    assert not any(i["id"].startswith("ask:payer_lapsed:") for i in items)


def test_card_terms_ask_carries_its_own_kind_label_when_it_fires(monkeypatch):
    """The pre-existing card-terms ask now sets `kind_label` explicitly too
    (rather than relying solely on the frontend's hardcoded fallback),
    proven here with a credit card account carrying a live balance and no
    stored terms -- the ask's own eligibility gate."""
    non_lapsed_entry = {
        "key": STREAM_KEY, "source": "confirmed", "lapsed": False,
        "missed_cycles": 0.0, "avg_amount": 4798.08, "account_id": ACCT_ID,
        "next_date": "2026-09-28",
    }
    items = _run(monkeypatch, lapsed_income_entry=non_lapsed_entry, accounts=[
        _account(1000.0),
        {
            "_id": "acc-card", "name": "Barclaycard", "balance": -450.0,
            "subtype": "CREDIT_CARD", "type": "CREDIT_CARD", "provider": "Barclays",
            "currency": "GBP",
        },
    ])
    card_asks = [i for i in items if i["id"] == "ask:card_terms"]
    assert len(card_asks) == 1
    assert card_asks[0]["kind_label"] == "Card detail"


# ── G157 review fix (independent review of f431d576): the "your pay seems ──
# ── to land somewhere new" ask account_changed_from_usual data was for ──────

NEW_ACCT_ID = "acc-new-destination"


def _two_accounts():
    return [
        _account(1000.0),
        {
            "_id": NEW_ACCT_ID, "name": "Monzo Current Account", "balance": 500.0,
            "subtype": "TRANSACTION", "type": "TRANSACTION", "provider": "Monzo",
            "currency": "GBP",
        },
    ]


def test_ask_payer_account_moved_fires_on_a_genuine_move_naming_accounts_not_numbers(monkeypatch):
    moved_entry = {
        "key": STREAM_KEY,
        "source": "confirmed",
        "lapsed": False,
        "missed_cycles": 0.0,
        "avg_amount": 4798.08,
        "account_id": NEW_ACCT_ID,
        "usual_account_id": ACCT_ID,
        "account_changed_from_usual": True,
        "next_date": "2026-09-28",
    }
    items = _run(monkeypatch, lapsed_income_entry=moved_entry, accounts=_two_accounts())

    moved_asks = [i for i in items if i["id"].startswith("ask:payer_account_moved:")]
    assert len(moved_asks) == 1
    item = moved_asks[0]
    assert item["headline"] == "Your pay seems to land somewhere new"
    assert item["kind_label"] == "Your pay"
    # Display names only -- the two real account names appear in the body...
    assert "Premier Current Account" in item["body"]
    assert "Monzo Current Account" in item["body"]
    # ...and nothing that looks like an account number/sort code anywhere in
    # the item at all.
    import json
    blob = json.dumps(item)
    assert not any(fragment in blob for fragment in ["12702436", "185008", "sort", "acc-current", "acc-new-destination"])
    # Never also the lapsed ask for the same stream.
    assert not any(i["id"].startswith("ask:payer_lapsed:") for i in items)


def test_ask_payer_account_moved_does_not_fire_without_the_flag(monkeypatch):
    not_moved_entry = {
        "key": STREAM_KEY,
        "source": "confirmed",
        "lapsed": False,
        "missed_cycles": 0.0,
        "avg_amount": 4798.08,
        "account_id": ACCT_ID,
        "usual_account_id": None,
        "account_changed_from_usual": False,
        "next_date": "2026-09-28",
    }
    items = _run(monkeypatch, lapsed_income_entry=not_moved_entry, accounts=_two_accounts())
    assert not any(i["id"].startswith("ask:payer_account_moved:") for i in items)


def test_ask_payer_account_moved_absent_flag_also_does_not_fire(monkeypatch):
    """Regression guard: an entry that simply omits the field entirely
    (e.g. a detected, non-synthesised series, which never carries it) must
    not fire either -- not just an explicit False."""
    no_flag_entry = {
        "key": STREAM_KEY, "source": "confirmed", "lapsed": False,
        "missed_cycles": 0.0, "avg_amount": 4798.08, "account_id": ACCT_ID,
        "next_date": "2026-09-28",
    }
    items = _run(monkeypatch, lapsed_income_entry=no_flag_entry, accounts=_two_accounts())
    assert not any(i["id"].startswith("ask:payer_account_moved:") for i in items)


def test_ask_payer_account_moved_takes_precedence_over_lapsed_for_the_same_stream(monkeypatch):
    """A stream can genuinely be BOTH lapsed (missed cycles) and moved
    (the one credit that did attach landed somewhere new) -- the moved ask
    must win; a moved salary is still landing, just somewhere new, not
    something that stopped."""
    moved_and_lapsed_entry = {
        "key": STREAM_KEY,
        "source": "confirmed",
        "lapsed": True,
        "missed_cycles": 2.4,
        "avg_amount": 4798.08,
        "account_id": NEW_ACCT_ID,
        "usual_account_id": ACCT_ID,
        "account_changed_from_usual": True,
        "next_date": "2026-09-28",
    }
    items = _run(monkeypatch, lapsed_income_entry=moved_and_lapsed_entry, accounts=_two_accounts())

    moved_asks = [i for i in items if i["id"].startswith("ask:payer_account_moved:")]
    lapsed_asks = [i for i in items if i["id"].startswith("ask:payer_lapsed:")]
    assert len(moved_asks) == 1
    assert lapsed_asks == []
