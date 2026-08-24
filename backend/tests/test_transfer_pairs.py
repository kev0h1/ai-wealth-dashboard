"""Tests for cross-account transfer-pair suggestions:

  - `analytics._transfer_pair_suggestions` — the candidate-detection +
    greedy-matching algorithm behind GET /transactions/transfer-pair-suggestions
    and the Spend banner's `pair_count`.
  - `categorisation.apply_rules_bulk`'s learned-pair pass in Pass 2 — a
    confirmed description pair (POST /transactions/confirm-transfer-pair)
    auto-matching future occurrences at the next sync.

No mongomock is available in this environment (see test_notifications.py's
own note), so collections are replaced with tiny in-memory fakes supporting
just enough of Motor's `.find()/.find_one()/.update_one()/.update_many()`
surface to drive the real code, following the same monkeypatch-the-module-
level-name pattern test_notifications.py already established.
"""
import asyncio
import re
from datetime import datetime

import app.routers.analytics as analytics
import app.services.categorisation as categorisation
from app.services.categories import CategoryKinds, BUILTIN_CATEGORY_KINDS
from app.services.categorisation import canonical_merchant_key


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
            if "$regex" in cond:
                flags = re.IGNORECASE if "i" in (cond.get("$options") or "") else 0
                if not (isinstance(val, str) and re.search(cond["$regex"], val, flags)):
                    return False
        else:
            if val != cond:
                return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

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
    """Stand-in for a Motor collection — docs are plain dicts mutated in
    place, so assertions after calling the real function under test can
    just re-inspect the same list."""

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
            new = dict(filt)
            self._apply(new, update)
            self.docs.append(new)

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


async def _fake_get_category_kinds(uid):
    return CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))


EMPTY_IDENTITY = {"name_tokens": [], "own_ids": set(), "own_map": {}}


def _fake_user_identity(identity):
    async def _inner(uid):
        return identity
    return _inner


UID = "kevin"
D0 = datetime(2026, 8, 10)
D1 = datetime(2026, 8, 11)
D2 = datetime(2026, 8, 12)


def _t(id_, *, ttype, amount, date, account_id, merchant=None, desc="",
       category="Other", custom_category=None):
    return {
        "_id": id_, "user_id": UID, "transaction_type": ttype, "amount": amount,
        "date": date, "account_id": account_id, "merchant_name": merchant,
        "description": desc, "category": category, "custom_category": custom_category,
    }


def _run_suggestions(monkeypatch, txns, *, dismissed=None, learned=None, identity=None):
    monkeypatch.setattr(analytics, "transactions_col", FakeCol(txns))
    monkeypatch.setattr(
        analytics, "preferences_col",
        FakeCol([{"user_id": UID, "dismissed_transfer_pairs": dismissed or []}]),
    )
    monkeypatch.setattr(analytics, "confirmed_transfer_pairs_col", FakeCol(learned or []))
    monkeypatch.setattr(analytics, "get_category_kinds", _fake_get_category_kinds)
    monkeypatch.setattr(analytics, "user_identity", _fake_user_identity(identity or EMPTY_IDENTITY))
    return asyncio.run(analytics._transfer_pair_suggestions(UID))


# ── _transfer_pair_suggestions ───────────────────────────────────────────────

def test_same_day_pair_is_suggested(monkeypatch):
    # Shared "pairref" token on both legs is the evidence-gate condition (b)
    # signal (fix 2) — without a shared token or own_transfer_evidence hit,
    # same-amount-close-date alone is no longer enough to suggest a pair.
    txns = [
        _t("c1", ttype="credit", amount=100.0, date=D0, account_id="accA",
           merchant="Acme Rail", desc="ACME RAIL TRANSFER IN PAIRREF", category="Income"),
        _t("d1", ttype="debit", amount=100.0, date=D0, account_id="accB",
           merchant="Beta Payments", desc="BETA PAYMENTS OUT PAIRREF", category="Shopping"),
    ]
    items = _run_suggestions(monkeypatch, txns)
    assert len(items) == 1
    item = items[0]
    assert item["date_diff_days"] == 0
    assert item["credit"]["id"] == "c1"
    assert item["debit"]["id"] == "d1"
    assert item["pair_key"] == ":".join(sorted(["c1", "d1"]))


def test_one_day_apart_pair_is_suggested(monkeypatch):
    txns = [
        _t("c1", ttype="credit", amount=50.0, date=D0, account_id="accA",
           merchant="Acme Rail", desc="ACME RAIL TRANSFER IN PAIRREF", category="Income"),
        _t("d1", ttype="debit", amount=50.0, date=D1, account_id="accB",
           merchant="Beta Payments", desc="BETA PAYMENTS OUT PAIRREF", category="Shopping"),
    ]
    items = _run_suggestions(monkeypatch, txns)
    assert len(items) == 1
    assert items[0]["date_diff_days"] == 1


def test_two_days_apart_is_rejected(monkeypatch):
    txns = [
        _t("c1", ttype="credit", amount=50.0, date=D0, account_id="accA",
           merchant="Acme Rail", desc="ACME RAIL TRANSFER IN", category="Income"),
        _t("d1", ttype="debit", amount=50.0, date=D2, account_id="accB",
           merchant="Beta Payments", desc="BETA PAYMENTS OUT", category="Shopping"),
    ]
    items = _run_suggestions(monkeypatch, txns)
    assert items == []


def test_identical_normalised_descriptions_rejected(monkeypatch):
    # Pass 2's job at sync time, not this path's.
    txns = [
        _t("c1", ttype="credit", amount=50.0, date=D0, account_id="accA",
           desc="Faster Payment Reference 123", category="Income"),
        _t("d1", ttype="debit", amount=50.0, date=D0, account_id="accB",
           desc="Faster Payment Reference 123", category="Shopping"),
    ]
    items = _run_suggestions(monkeypatch, txns)
    assert items == []


def test_both_legs_already_movement_rejected(monkeypatch):
    txns = [
        _t("c1", ttype="credit", amount=50.0, date=D0, account_id="accA",
           merchant="Acme Rail", desc="ACME RAIL TRANSFER IN", category="Transfer"),
        _t("d1", ttype="debit", amount=50.0, date=D0, account_id="accB",
           merchant="Beta Payments", desc="BETA PAYMENTS OUT", category="Savings"),
    ]
    items = _run_suggestions(monkeypatch, txns)
    assert items == []


def test_custom_category_leg_rejected(monkeypatch):
    txns = [
        _t("c1", ttype="credit", amount=50.0, date=D0, account_id="accA",
           merchant="Acme Rail", desc="ACME RAIL TRANSFER IN", category="Income",
           custom_category="MyPick"),
        _t("d1", ttype="debit", amount=50.0, date=D0, account_id="accB",
           merchant="Beta Payments", desc="BETA PAYMENTS OUT", category="Shopping"),
    ]
    items = _run_suggestions(monkeypatch, txns)
    assert items == []


def test_dismissed_pair_excluded(monkeypatch):
    txns = [
        _t("c1", ttype="credit", amount=50.0, date=D0, account_id="accA",
           merchant="Acme Rail", desc="ACME RAIL TRANSFER IN PAIRREF", category="Income"),
        _t("d1", ttype="debit", amount=50.0, date=D0, account_id="accB",
           merchant="Beta Payments", desc="BETA PAYMENTS OUT PAIRREF", category="Shopping"),
    ]
    pair_key = ":".join(sorted(["c1", "d1"]))
    items = _run_suggestions(monkeypatch, txns, dismissed=[pair_key])
    assert items == []


def test_greedy_best_match_when_one_debit_fits_two_credits(monkeypatch):
    # d1 matches both c1 (same-day) and c2 (1-day apart) on amount — the
    # nearest date-diff wins; c2 has no other counterpart, so it never
    # surfaces at all (never resurrected into a worse pairing).
    txns = [
        _t("c1", ttype="credit", amount=75.0, date=D0, account_id="accA",
           merchant="Acme Rail", desc="ACME RAIL TRANSFER IN PAIRREF", category="Income"),
        # No shared token with d1 (and no identity evidence) — even though it
        # matches on amount/date, c2 never becomes a CANDIDATE at all under
        # the evidence gate, independent of the date-diff tiebreak this test
        # is really about.
        _t("c2", ttype="credit", amount=75.0, date=D1, account_id="accC",
           merchant="Gamma Deposits", desc="GAMMA DEPOSITS IN", category="Income"),
        _t("d1", ttype="debit", amount=75.0, date=D0, account_id="accB",
           merchant="Beta Payments", desc="BETA PAYMENTS OUT PAIRREF", category="Shopping"),
    ]
    items = _run_suggestions(monkeypatch, txns)
    assert len(items) == 1
    assert items[0]["credit"]["id"] == "c1"
    assert items[0]["debit"]["id"] == "d1"


def test_learned_pair_excluded_from_suggestions(monkeypatch):
    # Will auto-match at the next sync (categorisation.py's learned pass) —
    # no need to ask again.
    c_key = canonical_merchant_key("Acme Rail", "ACME RAIL TRANSFER IN PAIRREF")
    d_key = canonical_merchant_key("Beta Payments", "BETA PAYMENTS OUT PAIRREF")
    txns = [
        _t("c1", ttype="credit", amount=50.0, date=D0, account_id="accA",
           merchant="Acme Rail", desc="ACME RAIL TRANSFER IN PAIRREF", category="Income"),
        _t("d1", ttype="debit", amount=50.0, date=D0, account_id="accB",
           merchant="Beta Payments", desc="BETA PAYMENTS OUT PAIRREF", category="Shopping"),
    ]
    items = _run_suggestions(
        monkeypatch, txns,
        learned=[{"user_id": UID, "key_a": c_key, "key_b": d_key}],
    )
    assert items == []


# ── apply_rules_bulk's learned-pair sync pass ────────────────────────────────

def _run_apply_rules_bulk(monkeypatch, txns, *, learned=None, custom_categories_docs=None):
    monkeypatch.setattr(categorisation, "transactions_col", FakeCol(txns))
    monkeypatch.setattr(categorisation, "accounts_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "user_profiles_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "merchant_categories_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "user_rules_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "confirmed_transfer_pairs_col", FakeCol(learned or []))
    monkeypatch.setattr(categorisation, "get_category_kinds", _fake_get_category_kinds)
    asyncio.run(categorisation.apply_rules_bulk(UID, structural=True))


def test_learned_pair_auto_matches_at_next_sync(monkeypatch):
    c_key = canonical_merchant_key("Acme Rail", "ACME RAIL TRANSFER IN")
    d_key = canonical_merchant_key("Beta Payments", "BETA PAYMENTS OUT")
    txns = [
        _t("c1", ttype="credit", amount=100.0, date=D0, account_id="accA",
           merchant="Acme Rail", desc="ACME RAIL TRANSFER IN", category="Income"),
        _t("d1", ttype="debit", amount=100.0, date=D0, account_id="accB",
           merchant="Beta Payments", desc="BETA PAYMENTS OUT", category="Other"),
    ]
    _run_apply_rules_bulk(
        monkeypatch, txns,
        learned=[{"_id": "pair1", "user_id": UID, "key_a": c_key, "key_b": d_key}],
    )
    by_id = {t["_id"]: t for t in txns}
    assert by_id["c1"]["category"] == "Transfer"
    assert by_id["d1"]["category"] == "Transfer"


def test_unlearned_different_description_pair_does_not_match(monkeypatch):
    txns = [
        _t("e1", ttype="credit", amount=60.0, date=D0, account_id="accA",
           merchant="Zephyr Quoll Exports", desc="ZEPHYR QUOLL EXPORTS INBOUND", category="Other"),
        _t("f1", ttype="debit", amount=60.0, date=D0, account_id="accB",
           merchant="Nimbus Ferret Holdings", desc="NIMBUS FERRET HOLDINGS OUTBOUND", category="Other"),
    ]
    # No learned pair covers these keys — the byte-identical Pass 2 match
    # doesn't fire either (descriptions differ), so nothing should stamp
    # either leg "Transfer".
    _run_apply_rules_bulk(monkeypatch, txns, learned=[])
    by_id = {t["_id"]: t for t in txns}
    assert by_id["e1"]["category"] != "Transfer"
    assert by_id["f1"]["category"] != "Transfer"


def test_custom_category_rows_skipped_by_learned_pass(monkeypatch):
    key_a = canonical_merchant_key("Custom Merchant One", "CUSTOM MERCHANT ONE PAYMENT")
    key_b = canonical_merchant_key("Custom Merchant Two", "CUSTOM MERCHANT TWO PAYMENT")
    txns = [
        # Manually categorised — must be excluded from the learned-pair
        # candidate pool entirely, same guard as the existing byte-identical
        # pass.
        _t("g1", ttype="credit", amount=50.0, date=D0, account_id="accC",
           merchant="Custom Merchant One", desc="CUSTOM MERCHANT ONE PAYMENT",
           category="Income", custom_category="ManualPick"),
        _t("h1", ttype="debit", amount=50.0, date=D0, account_id="accD",
           merchant="Custom Merchant Two", desc="CUSTOM MERCHANT TWO PAYMENT",
           category="Other"),
    ]
    _run_apply_rules_bulk(
        monkeypatch, txns,
        learned=[{"_id": "pair2", "user_id": UID, "key_a": key_a, "key_b": key_b}],
    )
    by_id = {t["_id"]: t for t in txns}
    assert by_id["g1"]["custom_category"] == "ManualPick"  # untouched
    assert by_id["h1"]["category"] != "Transfer"  # its only counterpart was filtered out


# ── Evidence gate (owner review fix 2) ───────────────────────────────────────

def test_pair_without_shared_evidence_or_identity_is_rejected(monkeypatch):
    # Reproduces the reviewer's confirmed-bad live case almost verbatim: a
    # client-income credit and an unrelated cash withdrawal, same amount,
    # same day, zero shared vocabulary, no identity data at all.
    txns = [
        _t("c1", ttype="credit", amount=50.0, date=D0, account_id="accA",
           merchant="Gondwe CC Hair", desc="GONDWE CC HAIR BGC", category="Income"),
        _t("d1", ttype="debit", amount=50.0, date=D0, account_id="accB",
           merchant=None, desc="ATM", category="Cash"),
    ]
    items = _run_suggestions(monkeypatch, txns)
    assert items == []


def test_pair_sharing_only_a_channel_code_or_month_token_is_rejected(monkeypatch):
    # Both legs mention "BGC" (a rail/channel code) and "AUG" (a month) —
    # shared vocabulary that is NOT evidence of a real transfer between two
    # specific accounts, so the gate must still reject this pair.
    txns = [
        _t("c1", ttype="credit", amount=50.0, date=D0, account_id="accA",
           merchant=None, desc="SOMEONE ELSE BGC AUG PAYMENT", category="Income"),
        _t("d1", ttype="debit", amount=50.0, date=D0, account_id="accB",
           merchant=None, desc="UNRELATED SHOP BGC AUG PURCHASE", category="Shopping"),
    ]
    items = _run_suggestions(monkeypatch, txns)
    assert items == []


def test_pair_with_name_evidence_is_suggested(monkeypatch):
    # No shared token between the two legs' texts at all — only the owner's
    # own name appearing in ONE leg's description. Under the tightened rule
    # (owner review fix 2 follow-up), one-leg evidence alone only survives
    # with a distinctive (non-round) amount — see the dedicated round-vs-
    # pence tests below for the boundary itself.
    identity = {"name_tokens": ["maingi", "kevin"], "own_ids": set(), "own_map": {}}
    txns = [
        _t("c1", ttype="credit", amount=80.55, date=D0, account_id="accA",
           merchant=None, desc="FASTER PAYMENT FROM KEVIN MAINGI", category="Income"),
        _t("d1", ttype="debit", amount=80.55, date=D0, account_id="accB",
           merchant=None, desc="OUTBOUND TRANSFER REQUEST", category="Shopping"),
    ]
    items = _run_suggestions(monkeypatch, txns, identity=identity)
    assert len(items) == 1
    assert items[0]["credit"]["id"] == "c1"
    assert items[0]["debit"]["id"] == "d1"


def test_pair_with_account_number_evidence_is_suggested(monkeypatch):
    # The credit leg's text carries a digit string matching one of the
    # user's OWN account numbers (resolving to a DIFFERENT account than the
    # one this credit landed on) — own_transfer_evidence's account branch —
    # again with zero shared vocabulary between the two legs' texts. Pence
    # amount, same reasoning as the name-evidence test above.
    identity = {
        "name_tokens": [], "own_ids": {"123456"},
        "own_map": {"123456": {"account_id": "accOther"}},
    }
    txns = [
        _t("c1", ttype="credit", amount=60.25, date=D0, account_id="accA",
           merchant=None, desc="TRANSFER REF 123456", category="Income"),
        _t("d1", ttype="debit", amount=60.25, date=D0, account_id="accB",
           merchant=None, desc="PAYMENT OUT REQUEST", category="Shopping"),
    ]
    items = _run_suggestions(monkeypatch, txns, identity=identity)
    assert len(items) == 1
    assert items[0]["credit"]["id"] == "c1"
    assert items[0]["debit"]["id"] == "d1"


def test_one_leg_evidence_round_amount_is_rejected(monkeypatch):
    # Owner review fix 2 follow-up — the exact live false positive: only the
    # CREDIT leg carries the owner's name, the debit leg is unrelated
    # spending, no shared token, and the amount is a round £20.00. One-leg
    # evidence + a round amount must not be enough.
    identity = {"name_tokens": ["maingi", "kevin"], "own_ids": set(), "own_map": {}}
    txns = [
        _t("c1", ttype="credit", amount=20.0, date=D0, account_id="accA",
           merchant=None, desc="Payment from Maingi K M", category="Income"),
        _t("d1", ttype="debit", amount=20.0, date=D0, account_id="accB",
           merchant=None, desc="GOOGLE*YOUTUBEPREMIUM LONDON", category="Subscriptions"),
    ]
    items = _run_suggestions(monkeypatch, txns, identity=identity)
    assert items == []


def test_one_leg_evidence_pence_amount_is_accepted(monkeypatch):
    # Same shape as the round-amount rejection above, but the amount now
    # carries distinctive pence — enough corroboration to accept one-leg
    # evidence.
    identity = {"name_tokens": ["maingi", "kevin"], "own_ids": set(), "own_map": {}}
    txns = [
        _t("c1", ttype="credit", amount=20.37, date=D0, account_id="accA",
           merchant=None, desc="Payment from Maingi K M", category="Income"),
        _t("d1", ttype="debit", amount=20.37, date=D0, account_id="accB",
           merchant=None, desc="GOOGLE*YOUTUBEPREMIUM LONDON", category="Subscriptions"),
    ]
    items = _run_suggestions(monkeypatch, txns, identity=identity)
    assert len(items) == 1
    assert items[0]["credit"]["id"] == "c1"
    assert items[0]["debit"]["id"] == "d1"


def test_both_legs_evidence_round_amount_is_accepted(monkeypatch):
    # Both legs independently carry the owner's name (mirrors the real
    # "MAINGI KM CREDIT BGC" / "KEVIN MAINGI CREDIT VIA MOBILE" survivors at
    # £105.00/£100.00) — both-legs evidence is strong enough to accept even
    # a round amount.
    identity = {"name_tokens": ["maingi", "kevin"], "own_ids": set(), "own_map": {}}
    txns = [
        _t("c1", ttype="credit", amount=100.0, date=D0, account_id="accA",
           merchant=None, desc="MAINGI KM CREDIT BGC", category="Income"),
        _t("d1", ttype="debit", amount=100.0, date=D0, account_id="accB",
           merchant=None, desc="KEVIN MAINGI CREDIT VIA MOBILE PYMT FP", category="Shopping"),
    ]
    items = _run_suggestions(monkeypatch, txns, identity=identity)
    assert len(items) == 1
    assert items[0]["credit"]["id"] == "c1"
    assert items[0]["debit"]["id"] == "d1"


# ── _too_generic_to_learn (owner review fix 3) ───────────────────────────────

def test_too_generic_to_learn_guard():
    assert analytics._too_generic_to_learn("atm") is True          # <6 chars
    assert analytics._too_generic_to_learn("ft") is True           # <6 chars, also a channel code
    assert analytics._too_generic_to_learn("sto") is True          # <6 chars, also a channel code
    assert analytics._too_generic_to_learn("acme rail") is False   # real merchant-like key
    assert analytics._too_generic_to_learn("wisetransfer") is False  # long single token, not a channel code


# ── Fix 1 — learned-pair sync pass requires different accounts ──────────────

def test_learned_pair_same_account_does_not_match(monkeypatch):
    # Reproduces the reviewer's repro almost verbatim: a learned pair
    # ("atm", "atm refund")-shaped key match where BOTH legs happen to sit
    # on the SAME account must never be stamped Transfer — that's not a
    # cross-account transfer at all.
    key_a = canonical_merchant_key("Acme Rail", "ACME RAIL TRANSFER IN")
    key_b = canonical_merchant_key("Beta Payments", "BETA PAYMENTS OUT")
    txns = [
        _t("c1", ttype="credit", amount=40.0, date=D0, account_id="accSAME",
           merchant="Acme Rail", desc="ACME RAIL TRANSFER IN", category="Income"),
        _t("d1", ttype="debit", amount=40.0, date=D0, account_id="accSAME",
           merchant="Beta Payments", desc="BETA PAYMENTS OUT", category="Cash"),
    ]
    _run_apply_rules_bulk(
        monkeypatch, txns,
        learned=[{"_id": "pair3", "user_id": UID, "key_a": key_a, "key_b": key_b}],
    )
    by_id = {t["_id"]: t for t in txns}
    assert by_id["c1"]["category"] != "Transfer"
    assert by_id["d1"]["category"] != "Transfer"


def test_learned_pair_matches_reverse_direction(monkeypatch):
    # The learned doc doesn't remember which leg was the credit vs. the
    # debit when it was confirmed — a credit sitting on key_b's merchant and
    # a debit sitting on key_a's merchant (the REVERSE of
    # test_learned_pair_auto_matches_at_next_sync) must match just as well.
    key_a = canonical_merchant_key("Acme Rail", "ACME RAIL TRANSFER IN")
    key_b = canonical_merchant_key("Beta Payments", "BETA PAYMENTS OUT")
    txns = [
        _t("c1", ttype="credit", amount=33.0, date=D0, account_id="accA",
           merchant="Beta Payments", desc="BETA PAYMENTS OUT", category="Income"),
        _t("d1", ttype="debit", amount=33.0, date=D0, account_id="accB",
           merchant="Acme Rail", desc="ACME RAIL TRANSFER IN", category="Other"),
    ]
    _run_apply_rules_bulk(
        monkeypatch, txns,
        learned=[{"_id": "pair4", "user_id": UID, "key_a": key_a, "key_b": key_b}],
    )
    by_id = {t["_id"]: t for t in txns}
    assert by_id["c1"]["category"] == "Transfer"
    assert by_id["d1"]["category"] == "Transfer"


# ── Fix 4 — Pass 2.5 must not overwrite a learned-pair leg ──────────────────

def test_manual_override_does_not_overwrite_learned_pair(monkeypatch):
    key_a = canonical_merchant_key("Custom Merchant One", "CUSTOM MERCHANT ONE PAYMENT")
    key_b = canonical_merchant_key("Custom Merchant Two", "CUSTOM MERCHANT TWO PAYMENT")
    txns = [
        # Seeds Pass 2.5's override_map: a manual "Cash" pick on an UNRELATED
        # row that happens to share (key_a, "debit"). custom_category != None
        # excludes it from the learned-pair pool itself (Pass 2's own guard).
        _t("manual1", ttype="debit", amount=999.0, date=D0, account_id="accManual",
           merchant="Custom Merchant One", desc="CUSTOM MERCHANT ONE PAYMENT",
           category="Other", custom_category="Cash"),
        # The actual learned-pair candidates.
        _t("cY", ttype="credit", amount=50.0, date=D0, account_id="accCredit",
           merchant="Custom Merchant Two", desc="CUSTOM MERCHANT TWO PAYMENT", category="Income"),
        _t("dX", ttype="debit", amount=50.0, date=D0, account_id="accDebit",
           merchant="Custom Merchant One", desc="CUSTOM MERCHANT ONE PAYMENT", category="Other"),
    ]
    _run_apply_rules_bulk(
        monkeypatch, txns,
        learned=[{"_id": "pair5", "user_id": UID, "key_a": key_a, "key_b": key_b}],
    )
    by_id = {t["_id"]: t for t in txns}
    # Without the fix, Pass 2.5 would see dX's (key_a, "debit") match
    # manual1's override and downgrade it back to "Cash".
    assert by_id["dX"]["category"] == "Transfer"
    assert by_id["cY"]["category"] == "Transfer"
    assert by_id["manual1"]["custom_category"] == "Cash"  # untouched


# ── Owner device-testing fix 1 — custom-category gating + actionability ─────

def test_pair_suggested_with_custom_movement_leg(monkeypatch):
    # The real £1,106 "TEST" shape reported by the owner: credit is plain
    # Income (auto), the debit already carries a MANUAL "Transfer". A custom
    # MOVEMENT-kind category must not block the pair — it anchors it, so the
    # pair still surfaces to fix the Income credit.
    txns = [
        _t("c1", ttype="credit", amount=1106.0, date=D0, account_id="accMonzo",
           merchant=None, desc="TEST", category="Income"),
        _t("d1", ttype="debit", amount=1106.0, date=D0, account_id="accBarclays",
           merchant=None, desc="K MONZO TEST STO", category="Other", custom_category="Transfer"),
    ]
    items = _run_suggestions(monkeypatch, txns)
    assert len(items) == 1
    assert items[0]["credit"]["id"] == "c1"
    assert items[0]["debit"]["id"] == "d1"
    # The leg payload's category is the EFFECTIVE category (custom wins).
    assert items[0]["debit"]["category"] == "Transfer"


def test_pair_blocked_with_custom_spend_leg(monkeypatch):
    # A custom SPEND-kind category (the user explicitly said this leg is
    # spending) still blocks the pair — unlike a custom movement category.
    txns = [
        _t("c1", ttype="credit", amount=45.0, date=D0, account_id="accA",
           merchant=None, desc="PAIRTOKEN CREDIT LEG", category="Income"),
        _t("d1", ttype="debit", amount=45.0, date=D0, account_id="accB",
           merchant=None, desc="PAIRTOKEN DEBIT LEG", category="Other",
           custom_category="Eating Out"),
    ]
    items = _run_suggestions(monkeypatch, txns)
    assert items == []


def test_credit_in_income_counts_as_actionable(monkeypatch):
    # Old actionability gate treated a plain Income credit as "already
    # non-spend" (income is a non-spend kind), so it would have been
    # rejected once the debit already looked like a transfer ("both legs
    # already movement, nothing to do"). Fix 1b redefines actionability: a
    # credit sitting in Income still needs fixing even when the debit is
    # already auto-categorised Transfer.
    txns = [
        _t("c1", ttype="credit", amount=45.0, date=D0, account_id="accA",
           merchant=None, desc="PAIRTOKEN INCOME CREDIT", category="Income"),
        _t("d1", ttype="debit", amount=45.0, date=D0, account_id="accB",
           merchant=None, desc="PAIRTOKEN ALREADY TRANSFER", category="Transfer"),
    ]
    items = _run_suggestions(monkeypatch, txns)
    assert len(items) == 1
    assert items[0]["credit"]["id"] == "c1"
    assert items[0]["debit"]["id"] == "d1"


def _run_confirm(monkeypatch, txns, credit_id, debit_id, *, accounts=None):
    monkeypatch.setattr(analytics, "transactions_col", FakeCol(txns))
    monkeypatch.setattr(analytics, "accounts_col", FakeCol(accounts or []))
    monkeypatch.setattr(analytics, "confirmed_transfer_pairs_col", FakeCol([]))
    monkeypatch.setattr(analytics, "get_category_kinds", _fake_get_category_kinds)
    return asyncio.run(analytics.confirm_transfer_pair(
        {"credit_id": credit_id, "debit_id": debit_id}, {"email": UID},
    ))


def test_confirm_leaves_custom_movement_leg_untouched_and_writes_only_other(monkeypatch):
    # Realistic STRING _ids, not ObjectIds — transactions_col's real _ids are
    # provider strings ("trn_..." ids or bare hex hashes), never Mongo
    # ObjectIds. This is deliberate, not incidental: the endpoint used to run
    # credit_id/debit_id through ObjectId(v) first and 400 whenever that
    # conversion failed, which is EVERY real id, so confirm never worked on
    # live data — and it still passed these tests only because they used
    # ObjectId-shaped fixture ids. Keep these ids string-shaped so this class
    # of bug can never pass silently again.
    c_id, d_id = "a8cbd0363a77581d9c2b41123a9f71f1", "trn_JkdbofZuJjsJMymXsGSXaufHFWgj"
    credit_txn = {
        "_id": c_id, "user_id": UID, "transaction_type": "credit", "amount": 1106.0,
        "date": D0, "account_id": "accMonzo", "merchant_name": None,
        "description": "TEST", "category": "Income", "custom_category": None,
    }
    debit_txn = {
        "_id": d_id, "user_id": UID, "transaction_type": "debit", "amount": 1106.0,
        "date": D0, "account_id": "accBarclays", "merchant_name": None,
        "description": "K MONZO TEST STO", "category": "Other", "custom_category": "Transfer",
    }
    accounts = [
        {"_id": "accMonzo", "user_id": UID, "type": "current", "subtype": "TRANSACTION"},
        {"_id": "accBarclays", "user_id": UID, "type": "current", "subtype": "TRANSACTION"},
    ]
    result = _run_confirm(monkeypatch, [credit_txn, debit_txn], c_id, d_id, accounts=accounts)

    assert result["ok"] is True
    assert result["changed"] == ["credit"]
    assert result["credit_category"] == "Transfer"
    assert result["debit_category"] == "Transfer"  # the pre-existing custom value, reported not rewritten

    assert credit_txn["category"] == "Transfer"          # written
    assert debit_txn["custom_category"] == "Transfer"    # untouched
    assert debit_txn["category"] == "Other"               # never written


def test_confirm_400_when_a_leg_has_custom_spend_category(monkeypatch):
    # Same realistic-string-id rationale as the test above.
    c_id, d_id = "b7e2f9013c4a5d8e6f0192837465ab1c", "trn_QpLmNoRsTuVwXyZaBcDeFgHiJkLm"
    credit_txn = {
        "_id": c_id, "user_id": UID, "transaction_type": "credit", "amount": 45.0,
        "date": D0, "account_id": "accA", "merchant_name": None,
        "description": "CREDIT LEG", "category": "Income", "custom_category": None,
    }
    debit_txn = {
        "_id": d_id, "user_id": UID, "transaction_type": "debit", "amount": 45.0,
        "date": D0, "account_id": "accB", "merchant_name": None,
        "description": "DEBIT LEG", "category": "Other", "custom_category": "Eating Out",
    }
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        _run_confirm(monkeypatch, [credit_txn, debit_txn], c_id, d_id)
    assert exc_info.value.status_code == 400


def test_confirm_400_for_unknown_transaction_id(monkeypatch):
    # A real regression guard for the ObjectId bug (owner device-testing fix
    # 1, critical): the endpoint must look up by the raw string _id and 404
    # when it's genuinely missing — not 400 "Invalid transaction id" just
    # because the id string isn't ObjectId-shaped. A non-existent id still
    # 404s (find_one returns None), which is the correct failure mode; the
    # bug this guards against was every REAL id 400ing before reaching the
    # find_one at all.
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        _run_confirm(monkeypatch, [], "trn_doesNotExist12345", "a8cbd0363a77581d9c2b41123a9f71f1")
    assert exc_info.value.status_code == 404


# ── Owner device-testing fix 1 — learned-pass anchors ────────────────────────

def test_learned_pass_anchor_matches_but_is_never_rewritten(monkeypatch):
    key_a = canonical_merchant_key("", "TEST")
    key_b = canonical_merchant_key("", "K MONZO TEST STO")
    txns = [
        _t("c1", ttype="credit", amount=1106.0, date=D0, account_id="accMonzo",
           merchant=None, desc="TEST", category="Income"),
        _t("d1", ttype="debit", amount=1106.0, date=D0, account_id="accBarclays",
           merchant=None, desc="K MONZO TEST STO", category="Other", custom_category="Transfer"),
    ]
    _run_apply_rules_bulk(
        monkeypatch, txns,
        learned=[{"_id": "pairTEST", "user_id": UID, "key_a": key_a, "key_b": key_b}],
    )
    by_id = {t["_id"]: t for t in txns}
    assert by_id["c1"]["category"] == "Transfer"           # rewritten via the anchor match
    assert by_id["d1"]["custom_category"] == "Transfer"    # untouched — still the user's own value
    assert by_id["d1"]["category"] == "Other"               # underlying AUTO category untouched


def test_learned_pass_spend_custom_rows_still_never_match(monkeypatch):
    key_a = canonical_merchant_key("", "SPENDANCHOR ONE")
    key_b = canonical_merchant_key("", "SPENDANCHOR TWO")
    txns = [
        # Spend-kind custom category — must NOT be treated as an anchor.
        _t("c1", ttype="credit", amount=30.0, date=D0, account_id="accA",
           merchant=None, desc="SPENDANCHOR ONE", category="Income",
           custom_category="Eating Out"),
        _t("d1", ttype="debit", amount=30.0, date=D0, account_id="accB",
           merchant=None, desc="SPENDANCHOR TWO", category="Other"),
    ]
    _run_apply_rules_bulk(
        monkeypatch, txns,
        learned=[{"_id": "pairSPEND", "user_id": UID, "key_a": key_a, "key_b": key_b}],
    )
    by_id = {t["_id"]: t for t in txns}
    assert by_id["c1"]["custom_category"] == "Eating Out"  # untouched
    assert by_id["d1"]["category"] != "Transfer"  # its only counterpart was excluded (spend, not an anchor)


# ── Owner device-testing fix 2 — one ask per transaction ─────────────────────
# Reproduced live: the −£965 "To Kevin Maingi" debit appeared BOTH as a
# pair-suggestion leg AND inside the miscategorised "To Kevin Maingi 2×"
# series in the same review sheet. The pair is the better ask (fixes both
# legs + learns the description pair), so a transaction that's currently a
# live pair leg must be excluded from the miscategorised groups/count, and
# must reappear once that pair is dismissed.

class FakeResponseCache:
    """Isolated per-test stand-in for app.services.response_cache — the real
    module is a bare process-global dict, so driving the actual cached
    router functions (get_miscategorised_count/-transactions,
    dismiss_transfer_pair) through it directly would leak state between
    tests (and even between assertions inside one test) that share UID."""

    def __init__(self):
        self._caches: dict = {}

    def get(self, name, uid, ttl=None):
        return self._caches.get(name, {}).get(uid)

    def put(self, name, uid, payload):
        self._caches.setdefault(name, {})[uid] = payload

    def invalidate(self, uid, name=None):
        if name is None:
            for cache in self._caches.values():
                cache.pop(uid, None)
            return
        prefix = name + ":"
        for cache_name, cache in list(self._caches.items()):
            if cache_name == name or cache_name.startswith(prefix):
                cache.pop(uid, None)


def _setup_pair_and_series(monkeypatch, *, dismissed_pairs=None):
    """c1/d1 is a live £965 same-day, different-account transfer-pair
    candidate (evidence: both legs' text carries the owner's name) whose
    debit leg (d1) ALSO shares a series (same description, "To Kevin
    Maingi") with an unrelated £50 debit (d2) that is NOT part of any pair.
    Mirrors the real repro almost exactly (965 pair leg + a 50 series-mate
    under the same payee)."""
    identity = {"name_tokens": ["maingi", "kevin"], "own_ids": set(), "own_map": {}}
    txns = [
        _t("c1", ttype="credit", amount=965.0, date=D0, account_id="accCredit",
           merchant=None, desc="KEVIN MAINGI CHASE BGC", category="Income"),
        _t("d1", ttype="debit", amount=965.0, date=D0, account_id="accDebit",
           merchant=None, desc="To Kevin Maingi", category="Shopping"),
        _t("d2", ttype="debit", amount=50.0, date=D1, account_id="accDebit",
           merchant=None, desc="To Kevin Maingi", category="Shopping"),
    ]
    fake_cache = FakeResponseCache()
    monkeypatch.setattr(analytics, "transactions_col", FakeCol(txns))
    monkeypatch.setattr(
        analytics, "preferences_col",
        FakeCol([{"user_id": UID, "dismissed_transfer_pairs": list(dismissed_pairs or [])}]),
    )
    monkeypatch.setattr(analytics, "confirmed_transfer_pairs_col", FakeCol([]))
    monkeypatch.setattr(analytics, "get_category_kinds", _fake_get_category_kinds)
    monkeypatch.setattr(analytics, "user_identity", _fake_user_identity(identity))
    monkeypatch.setattr(analytics, "response_cache", fake_cache)
    return txns


def test_pair_leg_absent_from_miscategorised_groups(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    result = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    items = result["items"]
    assert len(items) == 1
    assert items[0]["series_key"] == "To Kevin Maingi"
    assert items[0]["count"] == 1
    assert items[0]["ids"] == ["d2"]  # d1 (the live pair leg) excluded; d2 kept


def test_pair_leg_reappears_after_pair_dismissed(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    # Confirm it's excluded to start with (same assertion as the test above).
    before = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert before["items"][0]["ids"] == ["d2"]

    pair_key = ":".join(sorted(["c1", "d1"]))
    asyncio.run(analytics.dismiss_transfer_pair({"pair_key": pair_key}, {"email": UID}))

    after = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    after_items = after["items"]
    assert len(after_items) == 1
    assert after_items[0]["series_key"] == "To Kevin Maingi"
    assert after_items[0]["count"] == 2
    assert set(after_items[0]["ids"]) == {"d1", "d2"}  # d1 back — its pair is gone


def test_review_total_equals_filtered_series_count_plus_pair_count(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    result = asyncio.run(analytics.get_miscategorised_count(offset=0, user={"email": UID}))
    # 1 pair suggestion (c1/d1) + 1 filtered series ("To Kevin Maingi", now
    # just d2) — review_total must equal exactly what the sheet renders: the
    # pair section (1 card) plus the filtered miscategorised list (1 row).
    assert result["review_total"] == 2

    pairs = asyncio.run(analytics._transfer_pair_suggestions(UID))
    filtered_list = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert result["review_total"] == len(pairs) + len(filtered_list["items"])
