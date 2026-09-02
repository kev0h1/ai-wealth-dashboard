"""Unit tests for `HOME_ITEM_SUPPRESSION_REGISTRY` / `_home_item_suppressed`
in app.services.companion — the Home dedup review's B1 decision (owner,
2026-08-31): the standing `Coming Up` strip (UpcomingBillsStrip, live
/cashflow data) now owns the "heavy week ahead" fact, so the `rhythm:cliff`
companion card (a front_loader-trait historical-average version of the same
fact, which could disagree with Coming Up's live numbers) must never emit
on Home again.

The registry generalises the existing `_suppress_moves` precedent (section
5b, payday window: the Payday Plan card replaces the per-destination move
cards) into a declarative lookup table future authors extend instead of
hand-rolling a new local suppression flag. These tests exist so that
removing the `rhythm:cliff` entry — resurrecting the duplicate-voice bug —
is a conscious, test-breaking edit rather than a silent regression.

No mongomock is available in this environment, so DB-touching collections
are replaced with tiny in-memory fakes, following the same local-copy
convention `test_unfunded_move.py` / `test_internal_inflows.py` already
established for this file's neighbours (`FakeCol` / `_match` / `_FakeCursor`
are NOT shared across test files by convention here).
"""
import asyncio
from datetime import date, timedelta

import app.services.companion as companion
import app.db.collections as db_collections

UID = "kevin"


# ── Generic fake-Mongo plumbing (subset matcher + collection) ───────────────

def _match(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        if key == "$or":
            if not any(_match(doc, sub) for sub in cond):
                return False
            continue
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and val not in cond["$in"]:
                return False
            if "$ne" in cond and val == cond["$ne"]:
                return False
            if "$exists" in cond and (key in doc) != cond["$exists"]:
                return False
        else:
            if val != cond:
                return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    async def to_list(self, n):
        return list(self._docs)

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _ModifiedResult:
    def __init__(self, n):
        self.modified_count = n


class FakeCol:
    """Stand-in for a Motor collection — enough of `.find()`/`.find_one()`/
    `.update_one()`/`.update_many()` to drive the real code under test."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        return _FakeCursor([d for d in self.docs if _match(d, query)])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if _match(d, query):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                return
        if upsert:
            new_doc = dict(filt)
            self._apply(new_doc, update)
            self.docs.append(new_doc)

    async def update_many(self, filt, update):
        n = 0
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                n += 1
        return _ModifiedResult(n)

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


def _account(acct_id, balance, provider="barclays", name=None):
    return {
        "_id": acct_id, "user_id": UID, "name": name or acct_id, "balance": balance,
        "subtype": "TRANSACTION", "type": "BANK", "provider": provider,
    }


class _FixedDate(date):
    """A `date` subclass whose `.today()` always returns a chosen calendar
    day, so the front_loader window check (`0 < days_to_month_end <= 3`)
    is deterministic regardless of when this suite actually runs. Patched
    in for the module-level `date` name `companion.py` imports
    (`from datetime import date`), so every `date.today()` call inside
    compute_today_items — not just the rhythm section's — sees the same
    fixed "now"."""

    _fixed: date = date(2026, 8, 29)  # 3 days before 1 Sep -> inside the window

    @classmethod
    def today(cls):
        return cls._fixed


def _portrait(traits: list[dict], **extra) -> dict:
    return {"_id": UID, "status": "ok", "traits": traits, **extra}


def _front_loader_trait(choice=None) -> dict:
    return {
        "id": "front_loader",
        "title": "The Front-Loader",
        "narrative": "You tend to spend heavily in the first week of each month.",
        "evidence": ["62% of your spending lands in the first 7 days of the month",
                     "£300 average early-month spend"],
        "kind": "structure",
        "choice": choice,
    }


def _run(monkeypatch, *, accounts=None, portrait_docs=None, companion_items=None):
    """Full-stack harness: patches every collection compute_today_items
    touches and calls it for real, following test_unfunded_move.py's `_run`
    pattern (trimmed to what the rhythm section needs — no bills/income are
    required to reach it)."""
    import app.services.pay_period as pay_period
    import app.services.income as income

    monkeypatch.setattr(companion, "date", _FixedDate)
    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=10))
    monkeypatch.setattr(
        pay_period, "get_pay_period_for_date",
        lambda today_d, pay_cfg: (today_d - timedelta(days=10), today_d + timedelta(days=17)),
    )

    monkeypatch.setattr(companion, "accounts_col", FakeCol(accounts or []))
    monkeypatch.setattr(companion, "yapily_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "manual_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "companion_items_col", FakeCol(companion_items or []))
    monkeypatch.setattr(companion, "behaviour_portrait_col", FakeCol(portrait_docs or []))
    monkeypatch.setattr(db_collections, "savings_insights_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "card_terms_col", FakeCol([]))
    monkeypatch.setattr(companion, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", FakeCol([{"user_id": UID, "income_streams": []}]))
    monkeypatch.setattr(companion, "transactions_col", FakeCol([]))

    # app.services.pace has its own module-level collection references (see
    # test_unfunded_move.py's `_run` for the exact same note) — patch those
    # too so this suite never touches the real database.
    import app.services.pace as pace_module
    monkeypatch.setattr(pace_module, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", FakeCol([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", FakeCol([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", FakeCol([]))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": [], "upcoming_income": [], "internal_inflows": []}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    items = asyncio.run(companion.compute_today_items(UID, persist=True))
    return items


def _find(items, item_id_prefix):
    return next((i for i in items if str(i.get("id", "")).startswith(item_id_prefix)), None)


# ── Registry structure — a conscious edit is required to remove coverage ───

def test_registry_has_rhythm_cliff_entry_owned_by_coming_up():
    """The registry entry itself is the contract: rhythm:cliff is owned by
    Coming Up, with a non-empty rationale. Deleting this entry (reviving the
    duplicate-voice bug) must fail this test, not slip through silently."""
    assert "rhythm:cliff" in companion.HOME_ITEM_SUPPRESSION_REGISTRY
    entry = companion.HOME_ITEM_SUPPRESSION_REGISTRY["rhythm:cliff"]
    assert entry["owner"] == "coming_up"
    assert isinstance(entry.get("rationale"), str) and len(entry["rationale"]) > 20


def test_home_item_suppressed_is_scoped_to_rhythm_cliff_only():
    """Only rhythm:cliff is suppressed — sibling rhythm items (rhythm:switch,
    the pace rhythm-checkpoint item) and unrelated kinds must NOT be caught
    by an overly broad registry entry."""
    assert companion._home_item_suppressed("rhythm:cliff") is True
    for other_kind in ("rhythm:switch", "rhythm:checkpoint", "celebrate:streak", "move", "payday_plan"):
        assert companion._home_item_suppressed(other_kind) is False


# ── End-to-end: the front_loader card never emits, other traits untouched ──

def test_rhythm_cliff_never_emitted_when_front_loader_trait_active_in_window(monkeypatch):
    """Exact former-repro scenario: front_loader trait present (not kept),
    today sits inside the 3-day pre-month-end window. Before this change
    this fired `rhythm:cliff:<year_month>`; the registry must now suppress
    it outright — Coming Up owns this fact from live data instead."""
    accounts = [_account("barclays", 500.0)]
    portrait_docs = [_portrait([_front_loader_trait(choice=None)])]
    items = _run(monkeypatch, accounts=accounts, portrait_docs=portrait_docs)
    assert _find(items, "rhythm:cliff") is None
    # front_loader was the ONLY trait present, so no other rhythm item was
    # ever a candidate here — confirms the whole rhythm section came back
    # empty rather than something else masking a bug.
    assert not [i for i in items if i.get("type") == "rhythm"]


def test_front_loader_kept_trait_still_suppressed_pre_registry_consent_gate(monkeypatch):
    """Belt-and-braces: the existing "keep" consent gate (unrelated to the
    registry) still independently blocks the card too, so a future change
    that accidentally reverses evaluation order still can't resurrect it."""
    accounts = [_account("barclays", 500.0)]
    portrait_docs = [_portrait([_front_loader_trait(choice="keep")])]
    items = _run(monkeypatch, accounts=accounts, portrait_docs=portrait_docs)
    assert _find(items, "rhythm:cliff") is None
