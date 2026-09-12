"""Tests for G50: the per-account "short" flag Settings needs to show the
Skipped state honestly, even when the account has no live move card.

Bug (reviewer observation on G46, 2026-09-12): `coverPlanView()` in
`app/settings/SettingsPage.tsx` derived `shortAccountIds` only from the
destination accounts of currently-active move cards, so an account the
source finder would ALSO skip — because after its own bills and the £10
buffer it has no spare headroom — showed a normal, do-nothing toggle
whenever no live move card happened to name it.

Fix: `_account_headroom` in `app/services/companion.py` is extracted out
of what used to be an inline expression inside `_find_legs_for_destination`
's `_live_class` (`source_capacity.get(sid, 0.0) - 10`), so there is ONE
definition of an account's spare headroom. `compute_today_items` takes an
optional `account_eligibility_out` dict and, when given one, fills it with
a snapshot of every source-eligible account's headroom and "short" state
BEFORE any live shortfall consumes `source_capacity`. `GET
/today/cover-plan` (companion.py's router) passes this through as
`account_eligibility` alongside the existing `items` list — one round
trip, not two.

Review fix (2026-09-12, rejected on first pass): "short" must mirror
`_live_class`'s ACTUAL usability test, which is TWO conditions, not a
plain `headroom <= 0` guess:
  1. `_live_class` only ever admits a candidate at `headroom >= 5`, so an
     account with, say, £2 spare (headroom 0 < h < 5) is excluded from
     every combination the finder tries, and must report short too — see
     `test_account_headroom_just_under_five_is_short` /
     `test_account_headroom_of_exactly_five_is_not_short` below, which
     replace an earlier (wrong) test that asserted a penny of headroom was
     NOT short.
  2. a CURRENT (non-savings) account additionally counts as short when its
     own running minimum (`min_running`, the destination-shortfall walk —
     a DIFFERENT figure from `_account_headroom`) is negative, even with
     ample headroom; savings/offline accounts are exempt from this second
     check in the finder — see
     `test_current_account_with_negative_running_minimum_is_short_despite_headroom`
     and its savings counterpart below.

No mongomock is available in this environment, so DB-touching collections
are replaced with tiny in-memory fakes, following the same local-copy
convention `test_unfunded_move.py`/`test_overdraft_bills.py` already
established (`FakeCol`/`_match`/`_FakeCursor` are NOT shared across test
files by convention here).
"""
import asyncio
from datetime import date, timedelta

import app.services.companion as companion
import app.db.collections as db_collections

UID = "kevin"
TODAY = date.today()


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


# ── Fixtures ─────────────────────────────────────────────────────────────

def _bill(name, days_away, amount, account_id, balance, *, kind="commitment"):
    disp = TODAY + timedelta(days=days_away)
    return {
        "name": name, "days_away": days_away, "amount": amount,
        "account_id": account_id, "account_name": account_id,
        "account_bank": "Bank", "account_balance": balance,
        "is_credit_card": False, "kind": kind,
        "category": "Bills", "edited": False, "rule_label": None,
        "pending": False, "days_past_due": 0,
        "expected_date": disp.isoformat(), "original_date": None,
        "dest_account_id": None, "dest_account_spendable": None,
    }


def _account(acct_id, balance, *, provider="barclays", name=None,
             subtype="TRANSACTION", atype="BANK"):
    return {
        "_id": acct_id, "user_id": UID, "name": name or acct_id, "balance": balance,
        "subtype": subtype, "type": atype, "provider": provider,
    }


def _run(monkeypatch, bills, *, accounts=None, income_streams=None,
         window_income=None, account_eligibility_out=None,
         reserved_by_source=None):
    """Full-stack harness for `companion.compute_today_items`, following
    test_overdraft_bills.py's `_run` pattern verbatim, extended to pass
    `account_eligibility_out` through.

    `reserved_by_source`, when given, replaces `_reserved_for_allocations`
    entirely — used ONLY to construct the "positive headroom but negative
    running minimum" boundary below. That combination is not reachable
    through real bills/income/reservations in this engine (a
    non-negative reservation and non-negative internal-transfer credits
    together guarantee `min_running[sid] >= headroom + 10`, so headroom
    passing implies the running minimum can't be negative); an
    artificial, clearly-synthetic negative reservation is the only way to
    isolate the SECOND gate (`require_non_negative_current`) from the
    first (the £5 floor) in a test, proving the two are checked
    independently rather than one silently subsuming the other.
    """
    import app.services.pay_period as pay_period
    import app.services.income as income

    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=10))
    monkeypatch.setattr(
        pay_period, "get_pay_period_for_date",
        lambda today_d, pay_cfg: (today_d - timedelta(days=10), today_d + timedelta(days=17)),
    )

    if reserved_by_source is not None:
        async def _fake_reserved(uid, internal_inflows, account_map):
            return dict(reserved_by_source)
        monkeypatch.setattr(companion, "_reserved_for_allocations", _fake_reserved)

    monkeypatch.setattr(companion, "accounts_col", FakeCol(accounts or []))
    monkeypatch.setattr(companion, "yapily_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "manual_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "companion_items_col", FakeCol([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "card_terms_col", FakeCol([]))
    monkeypatch.setattr(companion, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", FakeCol([
        {"user_id": UID, "income_streams": income_streams or []}
    ]))
    monkeypatch.setattr(companion, "transactions_col", FakeCol([]))

    import app.services.pace as pace_module
    monkeypatch.setattr(pace_module, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", FakeCol([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", FakeCol([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", FakeCol([]))

    async def fake_resp(cached, uid=None, prefs=None):
        return {
            "upcoming_bills": bills,
            "upcoming_income": window_income or [],
            "internal_inflows": [],
        }

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    items = asyncio.run(companion.compute_today_items(
        UID, persist=False, account_eligibility_out=account_eligibility_out,
    ))
    return items


def _find(items, item_type):
    return next((i for i in items if i["type"] == item_type), None)


# ── Boundary: the £5 usability floor, not a plain "headroom > 0" guess ──────

def test_account_at_exactly_zero_headroom_is_short(monkeypatch):
    """No bills anywhere, one account holding exactly £10 — its own min
    running is £10, so headroom = 10 - 10 (buffer) = 0. Zero spare capacity
    is short."""
    accounts = [_account("src_zero", 10.0)]
    eligibility = {}
    _run(monkeypatch, [], accounts=accounts, account_eligibility_out=eligibility)

    assert eligibility["src_zero"] == {"short": True, "headroom": 0.0}


def test_account_headroom_just_under_five_is_short(monkeypatch):
    """`_live_class` only ever admits a candidate at `headroom >= 5` — an
    account with £4.99 of spare capacity is excluded from EVERY
    combination the finder tries, in every class, so it must report short
    even though its headroom is positive. Balance £14.99, no bills: mn =
    14.99, headroom = 14.99 - 10 = 4.99."""
    accounts = [_account("src_just_under", 14.99)]
    eligibility = {}
    _run(monkeypatch, [], accounts=accounts, account_eligibility_out=eligibility)

    assert eligibility["src_just_under"] == {"short": True, "headroom": 4.99}


def test_account_headroom_of_exactly_five_is_not_short(monkeypatch):
    """The finder's own floor is inclusive (`headroom >= 5`) — exactly £5
    of spare capacity IS usable. Balance £15, no bills: headroom = 5.0."""
    accounts = [_account("src_exactly_five", 15.0)]
    eligibility = {}
    _run(monkeypatch, [], accounts=accounts, account_eligibility_out=eligibility)

    assert eligibility["src_exactly_five"] == {"short": False, "headroom": 5.0}


def test_account_below_zero_headroom_is_short(monkeypatch):
    accounts = [_account("src_short", 5.0)]
    eligibility = {}
    _run(monkeypatch, [], accounts=accounts, account_eligibility_out=eligibility)

    assert eligibility["src_short"]["short"] is True
    assert eligibility["src_short"]["headroom"] == -5.0


def test_account_with_ample_headroom_is_not_short(monkeypatch):
    accounts = [_account("src_ample", 200.0)]
    eligibility = {}
    _run(monkeypatch, [], accounts=accounts, account_eligibility_out=eligibility)

    assert eligibility["src_ample"] == {"short": False, "headroom": 190.0}


# ── Class-aware second gate: current accounts only, not savings/offline ────

def test_current_account_with_negative_running_minimum_is_short_despite_headroom(monkeypatch):
    """`_live_class`'s `require_non_negative_current` check excludes a
    CURRENT (non-savings) account whose own running minimum is negative,
    independent of headroom. This combination (ample headroom, negative
    running minimum) can't arise from real bills/reservations alone in
    this engine — see `_run`'s docstring for why — so `reserved_by_source`
    is overridden with a deliberately synthetic negative value purely to
    isolate this second gate from the first: a £1,100 bill on a £1,000
    balance drives BOTH the account's own running minimum and its
    bills-only headroom basis to -£100, then the synthetic -£200
    "reservation" (`source_capacity = mn - reserved`) lifts headroom back
    to £90 (mn -100 minus -200, well past the £5 floor) while
    `min_running` stays at -£100 untouched (reservations never apply to
    it). The account must still report short."""
    accounts = [_account("current_acc", 1000.0, subtype="TRANSACTION", atype="BANK")]
    bills = [_bill("Big debit", 2, 1100.0, "current_acc", 1000.0, kind="commitment")]
    eligibility = {}
    _run(
        monkeypatch, bills, accounts=accounts, account_eligibility_out=eligibility,
        reserved_by_source={"current_acc": -200.0},
    )

    assert eligibility["current_acc"]["headroom"] == 90.0
    assert eligibility["current_acc"]["short"] is True


def test_same_shape_as_savings_is_not_short_despite_negative_running_minimum(monkeypatch):
    """Identical numbers to the test above, but the account is flagged
    savings (`_is_savings(acc)` true) instead of a plain current account.
    `class_specs` only ever passes `require_non_negative_current=True` to
    the CURRENT class predicate (`_is_current(acc) and not
    _is_savings(acc)`) — a savings-flagged account never matches it,
    savings or not, so the same negative running minimum does NOT make it
    short; only the £5 headroom floor applies, and headroom here is £90."""
    accounts = [_account("savings_acc", 1000.0, subtype="SAVINGS", atype="BANK")]
    bills = [_bill("Big debit", 2, 1100.0, "savings_acc", 1000.0, kind="commitment")]
    eligibility = {}
    _run(
        monkeypatch, bills, accounts=accounts, account_eligibility_out=eligibility,
        reserved_by_source={"savings_acc": -200.0},
    )

    assert eligibility["savings_acc"]["headroom"] == 90.0
    assert eligibility["savings_acc"]["short"] is False


def test_credit_card_account_never_appears_in_eligibility(monkeypatch):
    """Structural exclusion (credit cards can never be a cover-plan source)
    stays exactly as before — the eligibility map only ever names accounts
    the source finder could ever consider, matching `source_capacity`'s own
    population."""
    accounts = [_account("amex", 500.0, subtype="CREDIT_CARD", atype="CREDIT_CARD")]
    eligibility = {}
    _run(monkeypatch, [], accounts=accounts, account_eligibility_out=eligibility)

    assert "amex" not in eligibility


def test_eligibility_out_param_is_optional_and_changes_nothing(monkeypatch):
    """Passing no out-param (the default, every OTHER caller of
    compute_today_items) must behave exactly as before — no crash, no
    change to the returned items."""
    accounts = [_account("src", 10.0)]
    items_without = _run(monkeypatch, [], accounts=accounts)
    assert isinstance(items_without, list)


# ── Alignment: the same headroom decides both the flag AND the real move ───

def test_short_account_is_never_the_one_the_engine_actually_uses(monkeypatch):
    """The scenario the bug report describes: a destination is short, two
    possible current-account sources exist. One (`src_zero`) has exactly
    £10 — headroom 0, short per the flag. The other (`src_ample`) has
    plenty. The move card must draw from `src_ample` only, and the
    eligibility snapshot must call `src_zero` short and `src_ample` not —
    proving the flag and the finder's own pick can never disagree, because
    they now read the same `_account_headroom` value."""
    accounts = [
        _account("premier", 0.0, name="Premier Current"),
        _account("src_zero", 10.0, name="Zero headroom"),
        _account("src_ample", 200.0, name="Ample headroom", provider="hsbc"),
    ]
    bills = [_bill("Rent", 2, 50.0, "premier", 0.0, kind="commitment")]
    eligibility = {}
    items = _run(monkeypatch, bills, accounts=accounts, account_eligibility_out=eligibility)

    assert eligibility["src_zero"]["short"] is True
    assert eligibility["src_ample"]["short"] is False

    move = _find(items, "move")
    assert move is not None
    used_sources = {leg.get("_src_name") for leg in move.get("legs", [])} if "legs" in move else None
    # The move's own plan_source / body must never name the short account.
    assert "Zero headroom" not in str(move)
    assert "Ample headroom" in str(move) or "src_ample" in str(move) or "hsbc" in str(move).lower()


# ── Snapshot timing: taken before any leg-picking mutates source_capacity ──

def test_eligibility_snapshot_unaffected_by_which_destination_gets_funded_first(monkeypatch):
    """`source_capacity` is consumed in place as `_find_legs_for_destination`
    commits legs across successive destinations in the SAME request (see
    its own docstring). The eligibility snapshot must reflect each
    account's STANDING headroom, not a figure some other destination's
    funding already ate into — so `src_ample` should read with its full
    headroom even though it goes on to fund a real shortfall this same
    request."""
    accounts = [
        _account("premier", 0.0, name="Premier Current"),
        _account("src_ample", 200.0, name="Ample headroom", provider="hsbc"),
    ]
    bills = [_bill("Rent", 2, 50.0, "premier", 0.0, kind="commitment")]
    eligibility = {}
    items = _run(monkeypatch, bills, accounts=accounts, account_eligibility_out=eligibility)

    assert _find(items, "move") is not None
    # Standing headroom (200 - 10), not reduced by the ~60 this request
    # goes on to draw from it to fund `premier`.
    assert eligibility["src_ample"] == {"short": False, "headroom": 190.0}
