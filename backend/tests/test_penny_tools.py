"""Unit tests for the four new tools, the `explain(topic)` registry, and the
enrichment pass added to the existing catalog (screen-by-screen question
inventory, docs/penny/question-inventory/, catalog expanded 13 -> 17 tools,
see PENNY_TOOLS.md). Mirrors test_penny_agent.py's own conventions: engine
calls imported at module level into app.services.penny_tools are
monkeypatched on THAT module's namespace; calls made via an inline
`from app.routers.X import Y` (the existing `get_accounts`/`get_goals`-style
pattern, see the IMPORT RULE in penny_tools.py's own docstring) are
monkeypatched on the ORIGINAL router module instead, since the import
happens fresh at call time and picks up whatever the module attribute
currently is.

All tools remain read-only: no test here calls an update/insert/delete on
any fake collection.
"""
import asyncio
from datetime import datetime, timezone

import app.db.collections as db_collections_module
import app.services.companion as companion_module
import app.services.penny_tools as penny_tools_module
from app.core.models import Account
from app.services.penny_tools import execute_tool


# ── shared fakes ─────────────────────────────────────────────────────────

class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d

    async def to_list(self, n):
        return list(self._docs)


class _FakeCollection:
    def __init__(self, docs):
        self._docs = docs

    def find(self, query=None, proj=None):
        return _FakeCursor(self._docs)

    async def find_one(self, query=None, proj=None):
        return self._docs[0] if self._docs else None


def _account(id="acc1", name="Halifax Current", type="bank", subtype=None,
             balance=100.0, provider="Halifax", status="connected", manual=False):
    return Account(id=id, name=name, type=type, subtype=subtype, balance=balance,
                   provider=provider, status=status, manual=manual)


# ── 1. get_today_brief ───────────────────────────────────────────────────

def test_get_today_brief_shapes_a_move_item(monkeypatch):
    async def fake_today_items(uid, payday_preview=False, persist=True):
        assert persist is False
        assert payday_preview is False
        return [{
            "id": "move:acc2",
            "type": "move",
            "headline": "Move £150 to Halifax",
            "body": "It's £150 short.",
            "action": {"label": "See what's due ›", "route": "/upcoming"},
            "estimated": False,
            "moves": [{
                "headline": "Move £150 from Monzo",
                "amount": 150,
                "move_map": {
                    "from": {"account_id": "acc1", "name": "Monzo", "provider": "Monzo",
                              "balance": 400.0, "safe_note": "Covers its own bills"},
                    "to": {"account_id": "acc2", "name": "Halifax", "provider": "Halifax",
                            "balance": 0.0, "incoming": "£150 Council Tax expected Friday"},
                },
            }],
            "plan_dest": {
                "account_id": "acc2", "name": "Halifax", "provider": "Halifax",
                "balance": 0.0, "needs_total": 150, "needs_by": "Friday",
                "bills": [{"label": "Council Tax", "amount": 150}], "is_overdraft": False,
            },
            "covered": True,
            "amount": 150,
            "sources_safe": True,
            "assumed_incomes": [],
            "move_map": {
                "from": {"account_id": "acc1", "name": "Monzo", "provider": "Monzo",
                          "balance": 400.0, "safe_note": "Covers its own bills"},
                "to": {"account_id": "acc2", "name": "Halifax", "provider": "Halifax",
                        "balance": 0.0, "incoming": "£150 Council Tax expected Friday"},
            },
            "income_note": None,
        }]

    monkeypatch.setattr(penny_tools_module, "compute_today_items", fake_today_items)

    result = asyncio.run(execute_tool("kevin", "get_today_brief", {}))
    item = result["items"][0]
    assert item["type"] == "move"
    assert item["plan_dest"]["name"] == "Halifax"
    assert item["plan_dest"]["needs_total"]["raw"] == 150
    assert item["plan_dest"]["bills"][0]["label"] == "Council Tax"
    assert item["moves"][0]["from"]["name"] == "Monzo"
    assert item["moves"][0]["amount"]["raw"] == 150
    assert item["covered"] is True
    assert item["sources_safe"] is True
    # income_note explicitly None on the source item -> never carried onto the shaped item
    assert "income_note" not in item


def test_get_today_brief_falls_back_to_payday_preview_when_not_live(monkeypatch):
    calls = []

    async def fake_today_items(uid, payday_preview=False, persist=True):
        assert persist is False
        calls.append(payday_preview)
        if payday_preview:
            return [{
                "id": "payday_plan:preview",
                "type": "payday_plan",
                "headline": "Payday plan: split £2,000 across 2 accounts",
                "body": "£2,000 distributed.",
                "total": 2000,
                "trimmed": False,
                "covered": True,
                "preview": True,
                "salary": {"account_id": "acc1", "name": "Monzo", "provider": "Monzo",
                            "amount": 2000, "stays": 400},
                "dests": [{"account_id": "acc2", "name": "Halifax", "provider": "Halifax",
                            "balance": 0.0, "bills_total": 800, "bill_count": 2,
                            "spend_typical": 500, "buffer": 300, "target": 1600,
                            "move": 1600, "usual": 1500}],
                "estimated": False,
                "action": {"label": "See what's due ›", "route": "/upcoming"},
            }]
        return []  # nothing live on Home right now

    monkeypatch.setattr(penny_tools_module, "compute_today_items", fake_today_items)

    result = asyncio.run(execute_tool("kevin", "get_today_brief", {}))
    assert calls == [False, True]
    assert result["items"] == []
    assert result["payday_plan"]["total"]["raw"] == 2000
    assert result["payday_plan"]["preview"] is True
    assert result["payday_plan"]["salary"]["name"] == "Monzo"
    assert result["payday_plan"]["dests"][0]["move"]["raw"] == 1600


def test_get_today_brief_insufficient_data_when_nothing_at_all(monkeypatch):
    async def fake_today_items(uid, payday_preview=False, persist=True):
        assert persist is False
        return []

    monkeypatch.setattr(penny_tools_module, "compute_today_items", fake_today_items)

    result = asyncio.run(execute_tool("kevin", "get_today_brief", {}))
    assert result == {"insufficient_data": True, "reason": "no cashflow data yet"}


# ── 1b. get_today_brief -- persist=False audit fix (HIGH) ─────────────────
# compute_today_items is NOT a zero-side-effect read: besides upserting item
# state on companion_items_col throughout, it stamps two ONE-TIME "burn"
# markers the instant a celebration is computed (celebrated_at on a
# savings_insights_col doc, last_streak_celebrated on behaviour_portrait_col)
# so the REAL Home page never re-shows the same celebration. This harness
# runs the REAL compute_today_items end to end (not mocked, unlike the
# shape tests above), following test_internal_inflows.py's own proven
# pattern for faking every collection that function touches, plus a spy
# that records every write call so a persist=False run can assert zero of
# them fired anywhere.

def _mongo_match(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and val not in cond["$in"]:
                return False
            if "$ne" in cond and val == cond["$ne"]:
                return False
            if "$gt" in cond and not (val is not None and val > cond["$gt"]):
                return False
            if "$exists" in cond and (key in doc) != cond["$exists"]:
                return False
        elif val != cond:
            return False
    return True


class _SpyCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *a, **kw):
        return self

    def limit(self, *a, **kw):
        return self

    async def to_list(self, n):
        return list(self._docs)

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _SpyCol:
    """Stand-in Motor collection: real enough find/find_one/update_one to
    drive compute_today_items end to end, but every WRITE call (update_one/
    insert_one/replace_one/delete_one) is recorded in `write_calls` first --
    the whole point of this fake, so a test can assert on the call count
    rather than trust the gating by inspection alone."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.write_calls: list[str] = []

    def find(self, query=None, projection=None):
        return _SpyCursor([d for d in self.docs if _mongo_match(d, query or {})])

    async def find_one(self, query=None, projection=None):
        for d in self.docs:
            if _mongo_match(d, query or {}):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        self.write_calls.append("update_one")
        for d in self.docs:
            if _mongo_match(d, filt):
                self._apply(d, update)
                return
        if upsert:
            new_doc = dict(filt)
            self._apply(new_doc, update)
            self.docs.append(new_doc)

    async def insert_one(self, doc):
        self.write_calls.append("insert_one")
        self.docs.append(doc)

    async def replace_one(self, filt, doc, upsert=False):
        self.write_calls.append("replace_one")
        self.docs = [d for d in self.docs if not _mongo_match(d, filt)]
        self.docs.append(doc)

    async def delete_one(self, filt):
        self.write_calls.append("delete_one")
        self.docs = [d for d in self.docs if not _mongo_match(d, filt)]

    @staticmethod
    def _apply(d, update):
        for k, v in (update.get("$set") or {}).items():
            d[k] = v
        for k, v in (update.get("$setOnInsert") or {}).items():
            d.setdefault(k, v)
        for k, v in (update.get("$addToSet") or {}).items():
            d.setdefault(k, [])
            if v not in d[k]:
                d[k].append(v)
        for k, v in (update.get("$inc") or {}).items():
            d[k] = d.get(k, 0) + v


def _patch_today_items_collections(monkeypatch, uid, savings_insight_docs):
    """Same collections test_internal_inflows.py's own
    `_run_compute_today_items` harness fakes, swapped for spies so writes
    are countable. `savings_insights_col`/`card_terms_col`/`commitments_col`
    are imported LOCALLY inside compute_today_items on every call (from
    app.db.collections), so they must be patched at that source module,
    never on `companion_module` itself."""
    companion_items = _SpyCol([])
    behaviour_portrait = _SpyCol([])
    savings_insights = _SpyCol(savings_insight_docs)

    monkeypatch.setattr(companion_module, "cashflow_cache_col", _SpyCol([{"_id": uid}]))
    monkeypatch.setattr(companion_module, "preferences_col", _SpyCol([{"user_id": uid}]))
    monkeypatch.setattr(companion_module, "accounts_col", _SpyCol([]))
    monkeypatch.setattr(companion_module, "yapily_accounts_col", _SpyCol([]))
    monkeypatch.setattr(companion_module, "manual_accounts_col", _SpyCol([]))
    monkeypatch.setattr(companion_module, "companion_items_col", companion_items)
    monkeypatch.setattr(companion_module, "behaviour_portrait_col", behaviour_portrait)
    monkeypatch.setattr(db_collections_module, "savings_insights_col", savings_insights)
    monkeypatch.setattr(db_collections_module, "card_terms_col", _SpyCol([]))
    monkeypatch.setattr(db_collections_module, "commitments_col", _SpyCol([]))
    # app.services.pace imports its OWN module-level cashflow_cache_col /
    # transactions_col / yapily_transactions_col / preferences_col (from
    # app.db.collections, at import time), read/written by
    # compute_today_items's rhythm-checkpoint pass via
    # pace._read_cached_baseline / _write_cached_baseline. Patching only
    # companion_module's names left this write path pointed at the REAL
    # database (root cause of the "kevin" fixture doc found polluting the
    # live cashflow_cache collection, 2026-08-28) — patch pace's own
    # references too so this suite never touches Mongo.
    import app.services.pace as pace_module
    monkeypatch.setattr(pace_module, "cashflow_cache_col", _SpyCol([{"_id": uid}]))
    monkeypatch.setattr(pace_module, "preferences_col", _SpyCol([{"user_id": uid}]))
    monkeypatch.setattr(pace_module, "transactions_col", _SpyCol([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", _SpyCol([]))

    import app.services.pay_period as pay_period_module
    import app.services.income as income_module

    from datetime import timedelta as _timedelta

    monkeypatch.setattr(income_module, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period_module, "_next_payday", lambda today_d, pay_cfg: today_d + _timedelta(days=10))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": [], "upcoming_income": [], "internal_inflows": []}

    monkeypatch.setattr(companion_module, "_build_cashflow_response", fake_resp)
    return companion_items, behaviour_portrait, savings_insights


def _verified_saving_doc():
    """A savings insight whose triggering merchant has gone silent long
    enough to be a verified saving, not yet celebrated and not lapsed --
    exactly the shape that stamps `celebrated_at` (the one-time burn write)
    the first time it's ever seen."""
    return {
        "_id": "insight1", "insight_id": "insight1", "user_id": "kevin",
        "verified_savings": 12.0, "verified_merchant": "Gymbox",
        "celebration_lapsed": False,
    }


def test_get_today_brief_via_real_engine_makes_zero_writes(monkeypatch):
    companion_items, behaviour_portrait, savings_insights = _patch_today_items_collections(
        monkeypatch, "kevin", [_verified_saving_doc()],
    )

    result = asyncio.run(execute_tool("kevin", "get_today_brief", {}))

    # The one-time surprise is still SEEN (the whole point of the fix: a
    # persist=False call must not consume it unseen) ...
    assert any(i["type"] == "celebration" for i in result["items"])
    # ... but genuinely nothing was written anywhere in the call chain.
    assert companion_items.write_calls == []
    assert behaviour_portrait.write_calls == []
    assert savings_insights.write_calls == []


def test_compute_today_items_persist_true_still_writes(monkeypatch):
    """Guard against persist accidentally defaulting to off: the exact same
    fixture, called with persist=True (the default GET /today itself
    relies on), must still stamp celebrated_at for real."""
    companion_items, behaviour_portrait, savings_insights = _patch_today_items_collections(
        monkeypatch, "kevin", [_verified_saving_doc()],
    )

    items = asyncio.run(companion_module.compute_today_items("kevin", persist=True))

    assert any(i["type"] == "celebration" for i in items)
    assert savings_insights.write_calls == ["update_one"]
    assert savings_insights.docs[0]["celebrated_at"] is not None


# ── 2. get_recurring_payments ────────────────────────────────────────────

def test_get_recurring_payments_shapes_series_with_cadence_and_account(monkeypatch):
    async def fake_load_cache(uid):
        return {
            "recurring_spend": [
                {"key": "Netflix", "avg_amount": 15.99, "avg_interval": 30.4,
                 "next_date": "2026-09-15", "account_name": "Monzo", "account_bank": "Monzo"},
            ],
        }

    monkeypatch.setattr(penny_tools_module, "_load_cashflow_cache", fake_load_cache)

    async def fake_build_response(cached, uid=None):
        return {
            "upcoming_bills": [{
                "name": "Netflix", "kind": "discretionary", "pending": False,
                "edited": False, "days_past_due": 0, "rule_label": None,
            }],
        }

    monkeypatch.setattr(penny_tools_module, "_build_cashflow_response", fake_build_response)

    result = asyncio.run(execute_tool("kevin", "get_recurring_payments", {}))
    series = result["series"][0]
    assert series["name"] == "Netflix"
    assert series["cadence"] == "monthly"
    assert series["typical_amount"]["raw"] == 15.99
    assert series["next_expected_date"] == "2026-09-15"
    assert series["account_name"] == "Monzo"
    assert series["kind"] == "discretionary"
    assert series["pending"] is False


def test_get_recurring_payments_insufficient_data_no_accounts(monkeypatch):
    async def fake_load_cache(uid):
        return None

    monkeypatch.setattr(penny_tools_module, "_load_cashflow_cache", fake_load_cache)

    result = asyncio.run(execute_tool("kevin", "get_recurring_payments", {}))
    assert result == {"insufficient_data": True, "reason": "no account data connected yet"}


def test_cadence_label_matches_detectors_own_bands():
    assert penny_tools_module._cadence_label(7) == "weekly"
    assert penny_tools_module._cadence_label(14) == "fortnightly"
    assert penny_tools_module._cadence_label(30.4) == "monthly"
    assert penny_tools_module._cadence_label(None) == "irregular"
    assert "45" in penny_tools_module._cadence_label(45)


# ── 3. get_account_activity ──────────────────────────────────────────────

def test_get_account_activity_single_account_splits_spend_vs_movement(monkeypatch):
    import app.routers.accounts as accounts_router_module

    accs = [_account(id="acc1", name="Halifax Current", balance=250.0)]

    async def fake_get_accounts(user):
        return accs

    monkeypatch.setattr(accounts_router_module, "get_accounts", fake_get_accounts)

    async def fake_region(uid):
        return "UK"

    monkeypatch.setattr(penny_tools_module, "get_user_region", fake_region)

    async def fake_kind_map(uid):
        return {"Groceries": "discretionary", "Savings": "movement"}

    monkeypatch.setattr(penny_tools_module, "get_category_kinds", fake_kind_map)

    async def fake_rows(uid, account_id, start, end, home_currency):
        assert account_id == "acc1"
        assert home_currency == "GBP"
        return [
            {"amount": 40.0, "transaction_type": "debit", "category": "Groceries",
             "merchant_name": "Tesco", "date": datetime(2026, 8, 20)},
            {"amount": 100.0, "transaction_type": "debit", "category": "Savings",
             "merchant_name": "To Savings Pot", "date": datetime(2026, 8, 21)},
            {"amount": 500.0, "transaction_type": "credit", "category": "Income",
             "merchant_name": "Employer", "date": datetime(2026, 8, 15)},
        ]

    monkeypatch.setattr(penny_tools_module, "_account_activity_rows", fake_rows)

    result = asyncio.run(execute_tool("kevin", "get_account_activity", {"account_id_or_name": "Halifax"}))
    assert result["name"] == "Halifax Current"
    assert result["money_in"]["raw"] == 500.0
    assert result["money_out"]["raw"] == 140.0
    assert result["money_out_spend"]["raw"] == 40.0
    assert result["money_out_movement"]["raw"] == 100.0
    assert result["net"]["raw"] == 360.0
    # Ranked largest-first by absolute amount, server-side -- the £500
    # credit outranks the £100 movement debit.
    assert result["top_transactions"][0]["description"] == "Employer"
    assert result["top_transactions"][1]["description"] == "To Savings Pot"


def test_get_account_activity_no_account_given_summarises_every_account(monkeypatch):
    import app.routers.accounts as accounts_router_module

    accs = [_account(id="acc1", name="Halifax"), _account(id="acc2", name="Monzo")]

    async def fake_get_accounts(user):
        return accs

    monkeypatch.setattr(accounts_router_module, "get_accounts", fake_get_accounts)

    async def fake_region(uid):
        return "UK"

    monkeypatch.setattr(penny_tools_module, "get_user_region", fake_region)

    async def fake_kind_map(uid):
        return {}

    monkeypatch.setattr(penny_tools_module, "get_category_kinds", fake_kind_map)

    async def fake_rows(uid, account_id, start, end, home_currency):
        return []

    monkeypatch.setattr(penny_tools_module, "_account_activity_rows", fake_rows)

    result = asyncio.run(execute_tool("kevin", "get_account_activity", {}))
    assert len(result["accounts"]) == 2
    assert result["days"] == 30


def test_get_account_activity_unknown_account_name_returns_error(monkeypatch):
    import app.routers.accounts as accounts_router_module

    async def fake_get_accounts(user):
        return [_account(id="acc1", name="Halifax")]

    monkeypatch.setattr(accounts_router_module, "get_accounts", fake_get_accounts)

    result = asyncio.run(execute_tool("kevin", "get_account_activity", {"account_id_or_name": "Barclays"}))
    assert "error" in result
    assert "Halifax" in result["available"]


# Audit fix, 2026-08-27 (MEDIUM): two accounts sharing a name used to
# silently resolve to whichever came first -- the model (and the user
# behind it) could be shown one account's activity while believing it was
# the other. A name that matches more than one account must now return an
# explicit `ambiguous` result instead of guessing.

def test_get_account_activity_duplicate_name_returns_ambiguous(monkeypatch):
    import app.routers.accounts as accounts_router_module

    accs = [
        _account(id="acc1", name="Savings", provider="Halifax", balance=500.0),
        _account(id="acc2", name="Savings", provider="Monzo", balance=250.0),
    ]

    async def fake_get_accounts(user):
        return accs

    monkeypatch.setattr(accounts_router_module, "get_accounts", fake_get_accounts)

    result = asyncio.run(execute_tool("kevin", "get_account_activity", {"account_id_or_name": "Savings"}))
    assert result["ambiguous"] is True
    assert "matches" not in result or len(result["matches"]) == 2
    ids = {m["id"] for m in result["matches"]}
    assert ids == {"acc1", "acc2"}
    providers = {m["provider"] for m in result["matches"]}
    assert providers == {"Halifax", "Monzo"}
    assert result["matches"][0]["balance_formatted"].startswith("£")
    # No activity computed for either candidate -- the tool must ask, not guess.
    assert "money_in" not in result
    assert "accounts" not in result


def test_get_account_activity_unique_name_still_resolves(monkeypatch):
    import app.routers.accounts as accounts_router_module

    accs = [
        _account(id="acc1", name="Savings", provider="Halifax", balance=500.0),
        _account(id="acc2", name="Current", provider="Monzo", balance=250.0),
    ]

    async def fake_get_accounts(user):
        return accs

    monkeypatch.setattr(accounts_router_module, "get_accounts", fake_get_accounts)

    async def fake_region(uid):
        return "UK"

    monkeypatch.setattr(penny_tools_module, "get_user_region", fake_region)

    async def fake_kind_map(uid):
        return {}

    monkeypatch.setattr(penny_tools_module, "get_category_kinds", fake_kind_map)

    async def fake_rows(uid, account_id, start, end, home_currency):
        return []

    monkeypatch.setattr(penny_tools_module, "_account_activity_rows", fake_rows)

    result = asyncio.run(execute_tool("kevin", "get_account_activity", {"account_id_or_name": "Savings"}))
    assert "ambiguous" not in result
    assert result["name"] == "Savings"
    assert result["account_id"] == "acc1"


def test_get_account_activity_id_always_resolves_even_with_duplicate_names(monkeypatch):
    import app.routers.accounts as accounts_router_module

    accs = [
        _account(id="acc1", name="Savings", provider="Halifax", balance=500.0),
        _account(id="acc2", name="Savings", provider="Monzo", balance=250.0),
    ]

    async def fake_get_accounts(user):
        return accs

    monkeypatch.setattr(accounts_router_module, "get_accounts", fake_get_accounts)

    async def fake_region(uid):
        return "UK"

    monkeypatch.setattr(penny_tools_module, "get_user_region", fake_region)

    async def fake_kind_map(uid):
        return {}

    monkeypatch.setattr(penny_tools_module, "get_category_kinds", fake_kind_map)

    async def fake_rows(uid, account_id, start, end, home_currency):
        assert account_id == "acc2"
        return []

    monkeypatch.setattr(penny_tools_module, "_account_activity_rows", fake_rows)

    result = asyncio.run(execute_tool("kevin", "get_account_activity", {"account_id_or_name": "acc2"}))
    assert "ambiguous" not in result
    assert result["account_id"] == "acc2"
    assert result["name"] == "Savings"


# Regression, 2026-08-30: owner's live phone bug — "what was the first
# transaction for the savings challenge this period" was refused outright.
# Root cause traced to app.services.penny_tools' account-name resolver: a
# Monzo pot literally named "Saving Challenge (2026)" was never findable by
# the everyday way a user types it, "savings challenge" (extra 's'), so
# plain substring matching came back empty and the whole question fell
# through to the deterministic can_i.py refusal. See `_name_matches`' own
# docstring for the fix (word-level, plural/singular-tolerant fallback).

def test_name_matches_tolerates_the_savings_challenge_plural_singular_gap():
    from app.services.penny_tools import _name_matches

    # The exact bug: the pot is named singular ("Saving Challenge"), the
    # user naturally said plural ("savings challenge").
    assert _name_matches("savings challenge", "Saving Challenge (2026)") is True
    # Exact-phrasing path still works unchanged (fast path, no fallback needed).
    assert _name_matches("Saving Challenge", "Saving Challenge (2026)") is True
    # Still no false positive against an unrelated name.
    assert _name_matches("savings challenge", "Halifax Current") is False
    # Short words are never singularised (would corrupt real short names).
    assert _name_matches("isa", "Halifax ISA") is True


def test_get_account_activity_resolves_pot_by_the_plural_phrasing_a_user_types(monkeypatch):
    import app.routers.accounts as accounts_router_module

    accs = [_account(id="pot1", name="Saving Challenge (2026)", provider="Monzo", balance=1015.09)]

    async def fake_get_accounts(user):
        return accs

    monkeypatch.setattr(accounts_router_module, "get_accounts", fake_get_accounts)

    async def fake_region(uid):
        return "UK"

    monkeypatch.setattr(penny_tools_module, "get_user_region", fake_region)

    async def fake_kind_map(uid):
        return {}

    monkeypatch.setattr(penny_tools_module, "get_category_kinds", fake_kind_map)

    async def fake_rows(uid, account_id, start, end, home_currency):
        assert account_id == "pot1"
        return []

    monkeypatch.setattr(penny_tools_module, "_account_activity_rows", fake_rows)

    # "savings challenge" -- the natural plural phrasing from the live bug,
    # not the pot's actual singular name.
    result = asyncio.run(
        execute_tool("kevin", "get_account_activity", {"account_id_or_name": "savings challenge"})
    )
    assert "ambiguous" not in result
    assert "error" not in result
    assert result["account_id"] == "pot1"


def test_get_account_activity_date_from_takes_priority_over_days(monkeypatch):
    """Audit fix, 2026-08-30: a 'this period' question must be answerable by
    an explicit date_from (get_spend_verdict's own period.start), not only
    the approximate relative `days` window -- a `days` window wide enough to
    reach into the PREVIOUS pay period would otherwise let a stray older
    transaction masquerade as the current period's 'first' one."""
    import app.routers.accounts as accounts_router_module

    accs = [_account(id="pot1", name="Saving Challenge (2026)", provider="Monzo", balance=1015.09)]

    async def fake_get_accounts(user):
        return accs

    monkeypatch.setattr(accounts_router_module, "get_accounts", fake_get_accounts)

    async def fake_region(uid):
        return "UK"

    monkeypatch.setattr(penny_tools_module, "get_user_region", fake_region)

    async def fake_kind_map(uid):
        return {}

    monkeypatch.setattr(penny_tools_module, "get_category_kinds", fake_kind_map)

    seen = {}

    async def fake_rows(uid, account_id, start, end, home_currency):
        seen["start"] = start
        return []

    monkeypatch.setattr(penny_tools_module, "_account_activity_rows", fake_rows)

    asyncio.run(execute_tool(
        "kevin", "get_account_activity",
        {"account_id_or_name": "pot1", "days": 30, "date_from": "2026-08-28"},
    ))
    # date_from wins outright over the much wider `days=30` window.
    assert seen["start"] == datetime(2026, 8, 28)


def test_get_account_activity_first_transaction_survives_beyond_top_n(monkeypatch):
    """Audit fix, 2026-08-30: top_transactions is ranked by SIZE (largest
    first), capped at 5. A daily series whose amount rises over time (the
    owner's own savings-challenge pot, 4p more each day) would silently
    drop its EARLIEST, smallest-amount row from top_transactions once the
    window holds more than 5 -- first_transaction/last_transaction must stay
    chronologically correct regardless of how many rows exist."""
    import app.routers.accounts as accounts_router_module

    accs = [_account(id="pot1", name="Saving Challenge (2026)", provider="Monzo", balance=1015.09)]

    async def fake_get_accounts(user):
        return accs

    monkeypatch.setattr(accounts_router_module, "get_accounts", fake_get_accounts)

    async def fake_region(uid):
        return "UK"

    monkeypatch.setattr(penny_tools_module, "get_user_region", fake_region)

    async def fake_kind_map(uid):
        return {}

    monkeypatch.setattr(penny_tools_module, "get_category_kinds", fake_kind_map)

    # 8 daily credits, rising 4p a day -- the earliest (28 Aug, £8.96) is
    # the SMALLEST amount, so it never makes the top-5-by-size cut.
    rows = [
        {"amount": 8.96 + 0.04 * i, "transaction_type": "credit", "category": "Transfer",
         "merchant_name": "Saving Challenge (2026)", "date": datetime(2026, 8, 28 + i) if 28 + i <= 31
         else datetime(2026, 9, 28 + i - 31)}
        for i in range(8)
    ]

    async def fake_rows(uid, account_id, start, end, home_currency):
        return rows

    monkeypatch.setattr(penny_tools_module, "_account_activity_rows", fake_rows)

    result = asyncio.run(execute_tool("kevin", "get_account_activity", {"account_id_or_name": "pot1"}))
    assert len(result["top_transactions"]) == 5
    # The earliest (smallest) row is excluded from top_transactions...
    assert all(t["amount"]["raw"] != 8.96 for t in result["top_transactions"])
    # ...but first_transaction still names it exactly, and at 2dp precision
    # (not the whole-pound headline rounding -- the pence ARE the answer for
    # a daily series like this one).
    assert result["first_transaction"]["amount"]["raw"] == 8.96
    assert result["first_transaction"]["amount"]["formatted"] == "£8.96"
    assert result["first_transaction"]["date"] == "2026-08-28T00:00:00"
    last_amount = round(8.96 + 0.04 * 7, 2)
    assert result["last_transaction"]["amount"]["raw"] == last_amount


def test_get_accounts_exposes_id_for_disambiguation(monkeypatch):
    import app.routers.accounts as accounts_router_module

    accs = [_account(id="acc1", name="Savings", provider="Halifax", balance=500.0)]

    async def fake_get_accounts(user):
        return accs

    monkeypatch.setattr(accounts_router_module, "get_accounts", fake_get_accounts)
    monkeypatch.setattr(penny_tools_module, "preferences_col", _FakeCollection([{}]))

    async def fake_last_sync(uid):
        return None

    monkeypatch.setattr(penny_tools_module, "last_bank_sync", fake_last_sync)

    result = asyncio.run(execute_tool("kevin", "get_accounts", {}))
    assert result["accounts"][0]["id"] == "acc1"


# ── 4. get_mirror ─────────────────────────────────────────────────────────

def test_get_mirror_returns_traits_and_active_aims(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "behaviour_portrait_col", _FakeCollection([]))  # cache miss

    async def fake_compute_portrait(uid):
        return {
            "status": "ok",
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "window_days": 180,
            "traits": [{
                "id": "signature_pleasure", "title": "Your Signature: Eating Out",
                "narrative": "You spend more here than most categories.",
                "evidence": ["£300 across 12 payments"],
                "kind": "pleasure", "choice": None, "ref_category": "Eating Out",
            }],
        }

    monkeypatch.setattr(penny_tools_module, "_compute_portrait", fake_compute_portrait)

    async def fake_list_active(uid):
        return [{"id": "cp1", "ref": "Eating Out", "aim_amount": 200.0,
                  "spent_so_far": 140.0, "days_left": 5, "on_track": True}]

    monkeypatch.setattr(penny_tools_module, "_list_active_checkpoints", fake_list_active)

    result = asyncio.run(execute_tool("kevin", "get_mirror", {}))
    assert result["window_days"] == 180
    assert result["traits"][0]["title"] == "Your Signature: Eating Out"
    assert result["traits"][0]["kind"] == "pleasure"
    aim = result["active_aims"][0]
    assert aim["category"] == "Eating Out"
    assert aim["aim_amount"]["raw"] == 200.0
    assert aim["on_track"] is True


def test_get_mirror_merges_persisted_choice_onto_fresh_recompute_without_writing_back(monkeypatch):
    old_cached = {
        "_id": "kevin", "status": "ok", "computed_at": "2026-01-01T00:00:00+00:00",
        "window_days": 180,
        "traits": [{"id": "signature_pleasure", "title": "x", "narrative": "x",
                     "evidence": [], "kind": "pleasure", "choice": "keep"}],
    }
    monkeypatch.setattr(penny_tools_module, "behaviour_portrait_col", _FakeCollection([old_cached]))

    async def fake_compute_portrait(uid):
        return {
            "status": "ok", "computed_at": datetime.now(timezone.utc).isoformat(), "window_days": 180,
            "traits": [{"id": "signature_pleasure", "title": "x", "narrative": "x",
                         "evidence": [], "kind": "pleasure", "choice": None}],
        }

    monkeypatch.setattr(penny_tools_module, "_compute_portrait", fake_compute_portrait)

    async def fake_list_active(uid):
        return []

    monkeypatch.setattr(penny_tools_module, "_list_active_checkpoints", fake_list_active)

    result = asyncio.run(execute_tool("kevin", "get_mirror", {}))
    # The stale cache's own computed_at is > 7 days old, so a fresh compute
    # runs, but the persisted "keep" choice is still merged onto it -- and
    # nothing gets written back (no replace_one/update_one exists on
    # _FakeCollection at all, so a write attempt would raise).
    assert result["traits"][0]["choice"] == "keep"


def test_get_mirror_insufficient_data(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "behaviour_portrait_col", _FakeCollection([]))

    async def fake_compute_portrait(uid):
        return {"status": "insufficient_data"}

    monkeypatch.setattr(penny_tools_module, "_compute_portrait", fake_compute_portrait)

    result = asyncio.run(execute_tool("kevin", "get_mirror", {}))
    assert result["insufficient_data"] is True


# ── 5. explain(topic) ─────────────────────────────────────────────────────

_TERM_KEYS = [
    "moved", "carried_vs_float", "aim", "reserved", "dormant",
    "unplaced", "usual_pace", "one_off_vs_new_normal", "demonstrated_movement",
    "buffer", "pay_period", "red_amber_doctrine", "offset_shadow", "pinned_dismissal",
]
_NUMBER_KEYS = [
    "safe_to_spend_free", "planning_runway", "grow_surplus_monthly", "spend_out",
    "spend_majority_header", "over_time_chart", "month_end_cash", "moved_total",
]
_ACTION_KEYS = [
    "change_bill", "stop_prediction", "skip_occurrence", "set_cancel_aim",
    "recategorise_and_rule", "review_transfers", "confirm_payday", "set_pay_period",
    "reconnect_bank", "add_card_rates", "pin_account", "add_offline_account",
    "plan_oneoff_vs_commitment",
]


def test_explain_returns_real_entries_for_at_least_five_term_keys():
    for key in _TERM_KEYS[:5]:
        result = asyncio.run(execute_tool("kevin", "explain", {"topic": key}))
        assert result["topic"] == key
        assert len(result["text"]) > 20
        assert "—" not in result["text"] and "–" not in result["text"]  # no em/en-dashes


def test_explain_returns_real_entries_for_at_least_four_number_keys():
    for key in _NUMBER_KEYS[:4]:
        result = asyncio.run(execute_tool("kevin", "explain", {"topic": key}))
        assert result["topic"] == key
        assert len(result["text"]) > 20


def test_explain_returns_real_entries_for_at_least_three_action_keys():
    for key in _ACTION_KEYS[:3]:
        result = asyncio.run(execute_tool("kevin", "explain", {"topic": key}))
        assert result["topic"] == key
        assert len(result["text"]) > 20


def test_explain_all_registered_keys_are_non_empty_and_dash_free():
    for key in set(_TERM_KEYS + _NUMBER_KEYS + _ACTION_KEYS):
        result = asyncio.run(execute_tool("kevin", "explain", {"topic": key}))
        assert "error" not in result, f"missing explain entry for {key!r}"
        assert "—" not in result["text"] and "–" not in result["text"], f"{key!r} has a dash"


def test_explain_page_and_topic_copy_still_reachable_after_rename():
    home = asyncio.run(execute_tool("kevin", "explain", {"topic": "home"}))
    assert "Safe to Spend" in home["text"]
    isa = asyncio.run(execute_tool("kevin", "explain", {"topic": "isa_capability"}))
    assert "ISA" in isa["text"]


def test_explain_unknown_topic_returns_valid_keys_list():
    result = asyncio.run(execute_tool("kevin", "explain", {"topic": "not_a_real_topic"}))
    assert "error" in result
    assert "moved" in result["available_topics"]
    assert "safe_to_spend_free" in result["available_topics"]
    assert "change_bill" in result["available_topics"]
    assert "home" in result["available_topics"]


def test_explain_missing_topic_also_returns_valid_keys_list():
    result = asyncio.run(execute_tool("kevin", "explain", {}))
    assert "error" in result
    assert len(result["available_topics"]) > 30


# ── 5b. explain(topic) — money-basics registry (2026-08-27) ─────────────
# The retired "Money basics" rotating Home card's 19 curated explainers
# (app/content/money_basics.py's MONEY_BASICS), now grounding a new `explain`
# category instead of a UI rotation. `_BASICS_COPY` is built BY IMPORTING
# MONEY_BASICS rather than copy-pasting its prose, so this also doubles as a
# smoke test that the import wiring holds.
_BASICS_KEYS = [
    "isa-allowance", "cash-vs-ss-isa", "lisa", "personal-savings-allowance",
    "emergency-fund", "high-interest-debt-first", "pension-match",
    "pension-tax-relief", "compound-interest", "investment-fees",
    "diversification", "dividend-allowance", "cgt-allowance",
    "tax-year-dates", "premium-bonds", "marriage-allowance",
    "conscious-spending-plan", "fifty-thirty-twenty", "pay-yourself-first",
]


def test_explain_conscious_spending_plan_returns_text():
    """The three reference explainers added alongside the money-shape work
    (2026-09-02): Ramit Sethi's Conscious Spending Plan, the 50/30/20 rule,
    and pay-yourself-first. All reference-only, no advice."""
    result = asyncio.run(execute_tool("kevin", "explain", {"topic": "conscious-spending-plan"}))
    assert result["topic"] == "conscious-spending-plan"
    assert len(result["text"]) > 20
    assert "Insights" in result["text"]  # ties back to the app's own shape, not a grade
    assert "—" not in result["text"] and "–" not in result["text"]


def test_explain_returns_real_entries_for_at_least_three_basics_keys():
    for key in _BASICS_KEYS[:3]:
        result = asyncio.run(execute_tool("kevin", "explain", {"topic": key}))
        assert result["topic"] == key
        assert len(result["text"]) > 20
        assert "—" not in result["text"] and "–" not in result["text"]  # no em/en-dashes


def test_explain_all_basics_keys_are_registered_and_dash_free():
    for key in _BASICS_KEYS:
        result = asyncio.run(execute_tool("kevin", "explain", {"topic": key}))
        assert "error" not in result, f"missing explain entry for {key!r}"
        assert "—" not in result["text"] and "–" not in result["text"], f"{key!r} has a dash"


def test_explain_unknown_topic_still_includes_basics_keys_in_valid_list():
    result = asyncio.run(execute_tool("kevin", "explain", {"topic": "not_a_real_topic"}))
    assert "error" in result
    assert "lisa" in result["available_topics"]
    assert "isa-allowance" in result["available_topics"]


def test_money_basics_content_has_no_em_or_en_dash():
    """Regression guard for the house-style scrub of money_basics.py: an
    em-dash or en-dash in prose reads as AI-generated (house rule), and a
    dash between numeric tokens should already have been normalised to a
    plain hyphen ('3-6 months', not '3–6 months')."""
    from app.content.money_basics import MONEY_BASICS

    for card in MONEY_BASICS:
        for field in ("title", "body", "takeaway"):
            text = card[field]
            assert "—" not in text, f"{card['id']}.{field} has an em-dash: {text!r}"
            assert "–" not in text, f"{card['id']}.{field} has an en-dash: {text!r}"


# ── 6. Enrichment — debt / bills / insights ──────────────────────────────

def test_get_debt_position_enrichment_fields_present(monkeypatch):
    async def fake_plan(uid):
        return {
            "status": "ok",
            "totals": {"debt": 3000.0, "debt_free_month": "2027-03", "monthly_interest_now": 45.0,
                        "potential_monthly_interest": 60.0, "verdict": "Clearing steadily"},
            "cards": [{
                "name": "Amex", "debt": 3000.0, "payoff_month": "2027-03",
                "monthly_interest_now": 45.0, "potential_monthly_interest": 60.0,
                "classification": "carried_interest",
                "classification_evidence": ["interest charges observed, about £45/month"],
                "usage": "carry", "usage_conflict": False,
                "movement": {"monthly": 250.0, "basis": "median_of_closed_periods", "periods_used": 3},
                "rate_schedule": [{"from": "Aug 2026", "until": None, "apr_pct": 24.9,
                                     "source": "standard", "kind": None}],
            }],
            "scenario_b": {"months_sooner": 2, "interest_saved": 80.0,
                             "debt_free_month": "2027-01", "note": None},
            "extra_to_clear": {"amount": 50, "debt_free_month": "2026-12", "horizon_months": 60},
            "refinance_options": [{
                "source_name": "Amex", "destination_name": "Barclaycard",
                "transferable": 3000.0, "fee": 90.0, "interest_saved": 300.0,
                "net_saving": 210.0, "window_months": 18, "break_even_weeks": 4,
            }],
        }

    monkeypatch.setattr(penny_tools_module, "get_debt_plan_cached", fake_plan)

    result = asyncio.run(execute_tool("kevin", "get_debt_position", {}))
    card = result["cards"][0]
    assert card["classification"] == "carried_interest"
    assert card["classification_evidence"]
    assert card["movement"]["basis"] == "median_of_closed_periods"
    assert card["movement"]["periods_used"] == 3
    assert card["rate_schedule"][0]["apr_pct"] == 24.9
    assert card["usage"] == "carry"
    assert result["scenario_b"]["months_sooner"] == 2
    assert result["extra_to_clear"]["amount"]["raw"] == 50
    assert result["transfer_routes"][0]["net_saving"]["raw"] == 210.0


def test_get_upcoming_bills_enrichment_fields_present(monkeypatch):
    async def fake_load_cache(uid):
        return {"recurring_spend": []}

    monkeypatch.setattr(penny_tools_module, "_load_cashflow_cache", fake_load_cache)

    async def fake_build_response(cached, uid=None):
        return {
            "upcoming_bills": [{
                "name": "Council Tax", "amount": 150.0, "expected_date": "2026-09-01",
                "days_away": 4, "kind": "commitment", "account_name": "Halifax",
                "account_bank": "Halifax", "account_balance": 400.0, "pending": True,
                "days_past_due": 6, "original_date": "2026-08-26", "edited": True,
                "rule_label": "Monthly on the 1st",
            }],
            "upcoming_income": [],
        }

    monkeypatch.setattr(penny_tools_module, "_build_cashflow_response", fake_build_response)

    result = asyncio.run(execute_tool("kevin", "get_upcoming_bills", {}))
    bill = result["upcoming_bills"][0]
    assert bill["account_name"] == "Halifax"
    assert bill["account_bank"] == "Halifax"
    assert bill["account_balance"]["raw"] == 400.0
    assert bill["pending"] is True
    assert bill["days_past_due"] == 6
    assert bill["original_date"] == "2026-08-26"
    assert bill["edited"] is True
    assert bill["rule_label"] == "Monthly on the 1st"


def test_get_upcoming_bills_passes_through_movement_destination_fields(monkeypatch):
    # B2: penny_chips.py's home_payday_due chip names a card-repayment/self-
    # transfer movement using its destination, so the tool must forward the
    # four destination fields `_build_cashflow_response` puts on a MOVEMENT
    # occurrence, and default them to None for a bill with no destination
    # (e.g. an ordinary commitment/discretionary bill) rather than KeyError.
    async def fake_load_cache(uid):
        return {"recurring_spend": []}

    monkeypatch.setattr(penny_tools_module, "_load_cashflow_cache", fake_load_cache)

    async def fake_build_response(cached, uid=None):
        return {
            "upcoming_bills": [
                {
                    "name": "AMERICAN EXPRESS 3766-824849-32000", "amount": 100.0,
                    "expected_date": "2026-09-01", "days_away": 4, "kind": "movement",
                    "card_dest_account_name": "American Express", "card_dest_account_bank": "Amex",
                },
                {
                    "name": "KEVIN MAINGI CREDIT VIA MOBILE - PY", "amount": 50.0,
                    "expected_date": "2026-09-02", "days_away": 5, "kind": "movement",
                    "dest_account_name": "Monzo Savings", "dest_account_bank": "Monzo",
                },
                {
                    "name": "Council Tax", "amount": 150.0,
                    "expected_date": "2026-09-01", "days_away": 4, "kind": "commitment",
                },
            ],
            "upcoming_income": [],
        }

    monkeypatch.setattr(penny_tools_module, "_build_cashflow_response", fake_build_response)

    result = asyncio.run(execute_tool("kevin", "get_upcoming_bills", {}))
    card_bill, transfer_bill, ordinary_bill = result["upcoming_bills"]
    assert card_bill["card_dest_account_name"] == "American Express"
    assert card_bill["card_dest_account_bank"] == "Amex"
    assert card_bill["dest_account_name"] is None
    assert transfer_bill["dest_account_name"] == "Monzo Savings"
    assert transfer_bill["dest_account_bank"] == "Monzo"
    assert transfer_bill["card_dest_account_name"] is None
    assert ordinary_bill["dest_account_name"] is None
    assert ordinary_bill["dest_account_bank"] is None
    assert ordinary_bill["card_dest_account_name"] is None
    assert ordinary_bill["card_dest_account_bank"] is None


def test_get_insights_enrichment_fields_present(monkeypatch):
    docs = [{
        # category: energy is a structured (push) category — _serialize_insight
        # (which _exec_get_insights now routes title/body/savings_estimate
        # through, Insights honesty review Package C) always requires this
        # field, and every real stored doc always has one.
        "category": "energy", "insight_id": "energy-abc", "_id": "energy-abc",
        "title": "EDF crept up", "body": "Your EDF bill has risen.",
        "savings_estimate": "£12/mo", "pinned": False, "verified_savings": None,
        "triggered_by": [{"display_name": "EDF", "monthly_amount": 60.0, "occurrences": 3}],
        "verified_merchant": None, "deadline_at": None, "is_new": True,
        "_return_reason": None,
    }]
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCollection(docs))

    import app.routers.analytics as analytics_router_module

    async def fake_value_delivered(user):
        return {
            "insights_acted_on": 2, "total_monthly_saving": 22.0, "verified_monthly_saving": 10.0,
            "breakdown": [{"title": "Stopped paying Gymbox", "monthly_saving": 10.0, "estimate_label": "verified"}],
        }

    monkeypatch.setattr(analytics_router_module, "get_value_delivered", fake_value_delivered)

    result = asyncio.run(execute_tool("kevin", "get_insights", {}))
    insight = result["insights"][0]
    assert insight["triggered_by"][0]["merchant"] == "EDF"
    assert insight["triggered_by"][0]["monthly_amount"] == 60.0
    assert insight["is_new"] is True
    assert result["value_delivered"]["insights_acted_on"] == 2
    assert result["value_delivered"]["breakdown"][0]["estimate_label"] == "verified"


def test_get_accounts_enrichment_fields_present(monkeypatch):
    import app.routers.accounts as accounts_router_module

    accs = [
        _account(id="acc1", name="Halifax", type="bank", subtype="credit_card", balance=0.0),
        _account(id="acc2", name="Cash ISA", type="bank", subtype="savings", balance=0.0),
    ]

    async def fake_get_accounts(user):
        return accs

    monkeypatch.setattr(accounts_router_module, "get_accounts", fake_get_accounts)
    monkeypatch.setattr(penny_tools_module, "preferences_col",
                         _FakeCollection([{"home_pinned_accounts": ["acc1"]}]))

    async def fake_last_sync(uid):
        return datetime(2026, 8, 27, 8, 0, 0)

    monkeypatch.setattr(penny_tools_module, "last_bank_sync", fake_last_sync)

    result = asyncio.run(execute_tool("kevin", "get_accounts", {}))
    rows = {r["name"]: r for r in result["accounts"]}
    assert rows["Halifax"]["kind"] == "Credit"
    assert rows["Halifax"]["dormant"] is False  # £0 credit card = paid off, not dormant
    assert rows["Halifax"]["pinned"] is True
    assert rows["Cash ISA"]["kind"] == "Savings"
    assert rows["Cash ISA"]["dormant"] is True  # £0 non-credit account = dormant
    assert rows["Cash ISA"]["pinned"] is False
    assert "last_synced" in result


def test_get_goals_enrichment_fields_present(monkeypatch):
    import app.routers.commitments as commitments_router_module

    async def fake_list_commitments(user):
        return {"items": [{
            "id": "c1", "name": "Japan trip", "status": "active", "amount": 3000.0,
            "target_date": "2027-06", "progress": 900.0, "per_period_slice": 250.0,
            "periods_left": 8, "on_track": True, "feasibility": "surplus",
            "feasibility_note": "This fits comfortably in your surplus.",
            "pace_note": {"text": "Japan is running behind pace", "link": "spend"},
            "shared_pot_goals": ["Emergency fund"],
            "funding_pots": [{"name": "Travel pot", "contributing_balance": 900.0, "count_existing": True}],
        }]}

    monkeypatch.setattr(commitments_router_module, "list_commitments", fake_list_commitments)

    result = asyncio.run(execute_tool("kevin", "get_goals", {}))
    goal = result["goals"][0]
    assert goal["per_period_slice"]["raw"] == 250.0
    assert goal["periods_left"] == 8
    assert goal["on_track"] is True
    assert goal["feasibility"] == "surplus"
    assert goal["pace_note"] == "Japan is running behind pace"
    assert goal["shared_pot_goals"] == ["Emergency fund"]
    assert goal["funding_pots"][0]["contributing_balance"]["raw"] == 900.0


def test_get_spend_verdict_enrichment_fields_present(monkeypatch):
    async def fake_verdict(uid, offset=0):
        return {
            "period": {"start": "2026-08-01", "end": "2026-08-28", "days_elapsed": 23,
                        "days_left": 5, "closed": False},
            "state": "normal",
            "reading": "Bills is running above your usual pace.",
            "moved_total": 500.0,
            "unresolved_total": 40.0,
            "unresolved_material": False,
            "unresolved": {
                "payments_count": 2, "weight": "routine", "ask_worthy": False,
                "largest": {"display_name": "Finexer", "amount": 25.0, "date": "2026-08-20"},
            },
            "quiet_flags": [{"category": "Subscriptions", "spent": 40.0, "multiple": 1.6, "excess": 15.0}],
            "moved": [{"kind": "pots", "label": "To your pots", "amount": 500.0, "payments_count": 1}],
            "notables": [{"category": "Bills", "spent": 340.0, "multiple": 2.1,
                            "cause": [{"name": "British Gas", "amount": 200.0}],
                            "consequence_line": {"text": "Bills alone accounts for most of that."}}],
        }

    monkeypatch.setattr(penny_tools_module, "compute_spend_verdict", fake_verdict)

    result = asyncio.run(execute_tool("kevin", "get_spend_verdict", {}))
    assert result["period"]["closed"] is False
    assert result["period"]["days_left"] == 5
    assert result["unresolved"]["count"] == 2
    assert result["unresolved"]["materiality"] == "routine"
    assert result["unresolved"]["largest"]["display_name"] == "Finexer"
    assert result["quiet_flags"][0]["category"] == "Subscriptions"
    assert result["moved"][0]["label"] == "To your pots"
    assert result["notables"][0]["cause"][0]["name"] == "British Gas"
    assert result["notables"][0]["consequence_line"] == "Bills alone accounts for most of that."


# ── 8. calculate ──────────────────────────────────────────────────────────
# The engine-level whitelist/bounds correctness and safety live in
# test_safe_calc.py; these only prove the tool-layer dispatch and the
# echoed-expression contract (PENNY_TOOLS.md's `calculate` row: "the
# echoed `expression`, so a reply or a proposal's consequence line can show
# its working").

def test_calculate_dispatches_and_echoes_expression_on_success():
    result = asyncio.run(execute_tool(
        "kevin", "calculate", {"expression": "series_sum(8.96, 0.04, 27)"},
    ))
    assert result["expression"] == "series_sum(8.96, 0.04, 27)"
    assert result["ok"] is True
    assert round(result["result"], 2) == 255.96
    assert result["error"] is None


def test_calculate_echoes_expression_on_rejection_too():
    result = asyncio.run(execute_tool(
        "kevin", "calculate", {"expression": "__import__('os')"},
    ))
    assert result["expression"] == "__import__('os')"
    assert result["ok"] is False
    assert result["result"] is None
    assert result["error"]


def test_calculate_missing_expression_does_not_raise():
    result = asyncio.run(execute_tool("kevin", "calculate", {}))
    assert result["ok"] is False
    assert result["error"]


# ── 7. read-only guard ────────────────────────────────────────────────────

def test_all_new_tools_never_call_a_write_method_on_a_fake_collection():
    """`_FakeCollection` above defines only find/find_one -- any write call
    (update_one/insert_one/replace_one/delete_one) would raise
    AttributeError, so every test above passing already proves this; this
    test just documents the guard explicitly for the read-only claim."""
    assert not hasattr(_FakeCollection([]), "update_one")
    assert not hasattr(_FakeCollection([]), "replace_one")
    assert not hasattr(_FakeCollection([]), "insert_one")
