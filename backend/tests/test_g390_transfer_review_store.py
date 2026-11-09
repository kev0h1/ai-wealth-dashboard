"""G390: the transfers review candidates are computed at sync, stored per
user, and served from storage; decisions survive a recompute."""
import asyncio
import types
import re  # noqa: F401 (used by the frozen copy)

import app.routers.analytics as analytics
import app.services.transfer_review_store as store
from app.db import collections
from app.services import warmup
from test_transfer_pairs import UID, _run_confirm, _setup_pair_and_series


def _count_builds(monkeypatch):
    calls = {"n": 0}
    original = analytics._build_review_state

    async def counting(uid):
        calls["n"] += 1
        return await original(uid)

    monkeypatch.setattr(analytics, "_build_review_state", counting)
    return calls


def _doc():
    docs = store.transfer_review_store_col.docs
    return docs[0] if docs else None


def test_refresh_at_sync_builds_the_store_and_endpoints_serve_from_it(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    calls = _count_builds(monkeypatch)
    asyncio.run(store.refresh(UID))
    assert calls["n"] == 1
    doc = _doc()
    assert doc["_id"] == UID and doc["user_id"] == UID
    assert [p["pair_key"] for p in doc["state"]["pairs"]] == ["c1:d1"]
    assert [t["_id"] for t in doc["state"]["flagged"]] == ["d2"]

    # Both endpoints, even after a generic cache wipe, read storage only.
    asyncio.run(analytics.response_cache.ainvalidate(UID))
    listing = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    asyncio.run(analytics.response_cache.ainvalidate(UID))
    count = asyncio.run(analytics.get_miscategorised_count(offset=0, user={"email": UID}))
    assert calls["n"] == 1
    assert [i["ids"] for i in listing["items"]] == [["d2"]]
    assert count["review_total"] == 2


def test_store_absent_recomputes_inline_then_saves(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    calls = _count_builds(monkeypatch)
    assert _doc() is None
    first = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert calls["n"] == 1 and _doc() is not None
    asyncio.run(analytics.response_cache.ainvalidate(UID))
    second = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert calls["n"] == 1
    assert first == second


def test_response_shape_matches_the_direct_computation(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    pairs = asyncio.run(analytics._transfer_pair_suggestions(UID))
    separate = asyncio.run(analytics._separate_pair_review_items(UID))
    excluded = analytics._pair_leg_ids(pairs) | frozenset(i["id"] for i in separate)
    direct = analytics._group_miscategorised(
        asyncio.run(analytics._flagged_miscategorised(UID, exclude_ids=excluded)))[:50]
    served = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert served == {"items": direct, "separate_items": separate}
    assert asyncio.run(analytics.get_transfer_pair_suggestions({"email": UID})) == {"items": pairs}


def test_count_equals_the_list(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    listing = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    state = asyncio.run(analytics.get_review_state(UID))
    count = asyncio.run(analytics.get_miscategorised_count(offset=0, user={"email": UID}))
    shown = len(listing["items"]) + len(state["pairs"]) + len(listing["separate_items"])
    assert count["review_total"] == shown == 2


def test_decisions_survive_recompute(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    calls = _count_builds(monkeypatch)
    asyncio.run(store.refresh(UID))
    asyncio.run(analytics.dismiss_miscategorised_series({"series_key": "To Kevin Maingi"}, {"email": UID}))
    asyncio.run(analytics.dismiss_transfer_pair({"pair_key": "c1:d1"}, {"email": UID}))
    # Decisions changed the fingerprint: next read rebuilds from the same prefs.
    listing = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert calls["n"] == 2
    assert [i["ids"] for i in listing["items"]] == []
    assert {i["id"] for i in listing["separate_items"]} == {"c1", "d1"}
    # A sync marks the store stale; the recompute still honours every decision.
    asyncio.run(store.mark_stale(UID))
    asyncio.run(analytics.response_cache.ainvalidate(UID))
    again = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert calls["n"] == 3
    assert again == listing
    state = asyncio.run(analytics.get_review_state(UID))
    assert state["pairs"] == [] and state["flagged"] == []


def test_confirmed_pair_is_kept_after_sync_and_recompute(monkeypatch):
    rows = _setup_pair_and_series(monkeypatch)
    asyncio.run(store.refresh(UID))
    _run_confirm(monkeypatch, rows, "c1", "d1")
    asyncio.run(store.mark_stale(UID))
    state = asyncio.run(analytics.get_review_state(UID))
    assert state["pairs"] == []
    assert "c1" not in {t["_id"] for t in state["flagged"]}


def test_only_transaction_changes_invalidate_not_cache_wipes(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    calls = _count_builds(monkeypatch)
    asyncio.run(store.refresh(UID))
    for _ in range(3):
        asyncio.run(analytics.response_cache.ainvalidate(UID))
        asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert calls["n"] == 1
    asyncio.run(store.mark_stale(UID))
    asyncio.run(analytics.response_cache.ainvalidate(UID))
    asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert calls["n"] == 2


def test_stale_mark_during_a_build_is_not_overwritten(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    original = analytics._build_review_state

    async def build_then_sync_lands(uid):
        state = await original(uid)
        await store.mark_stale(uid)
        return state

    monkeypatch.setattr(analytics, "_build_review_state", build_then_sync_lands)
    asyncio.run(analytics.get_review_state(UID))
    assert not store.is_valid(_doc(), asyncio.run(analytics._review_inputs_fingerprint(UID)))


def test_new_transaction_count_invalidates_without_a_hook(monkeypatch):
    rows = _setup_pair_and_series(monkeypatch)
    calls = _count_builds(monkeypatch)
    asyncio.run(analytics.get_review_state(UID))
    analytics.transactions_col.docs.append({**rows[2], "_id": "d3", "amount": 51.0})
    asyncio.run(analytics.get_review_state(UID))
    assert calls["n"] == 2


def test_store_is_erased_with_the_user():
    assert "transfer_review_store_col" in collections.ERASURE_MANIFEST
    assert collections.transfer_review_store_col.name in collections.managed_collection_names()


def test_warm_user_warms_the_list_alongside_the_count(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    names = []

    async def noop(uid):
        return {"ok": True}

    async def record_list(uid):
        names.append("list")
        return await original_list(uid)

    original_list = warmup._compute_miscategorised_list
    for n in ("_compute_today", "_compute_safe_to_spend", "_compute_spend_verdict",
              "_compute_miscategorised_count", "_compute_grow", "_compute_commitments"):
        monkeypatch.setattr(warmup, n, noop)
    monkeypatch.setattr(warmup, "_compute_miscategorised_list", record_list)

    class _Bump:
        async def bump(self, uid):
            return 1

    monkeypatch.setattr(warmup, "data_version", _Bump())
    result = asyncio.run(warmup._warm_user_impl(UID)) if hasattr(warmup, "_warm_user_impl") else asyncio.run(warmup.warm_user(UID))
    assert "miscategorised_list" in result["warmed"]
    assert names == ["list"]
    assert _doc() is not None


# ── Frozen copy of the pre-G390 pair scan (O(credits x debits)) ─────────────
# Verbatim from main at 7c7b6b75; only the name differs. Its globals are bound
# to the analytics module below, so it uses the same helpers and the same
# monkeypatched collections as the optimised version.

async def _old_transfer_pair_suggestions(uid: str) -> list[dict]:
    """Candidate cross-account transfer pairs the conservative sync-time
    matcher could not confirm: a credit + a debit that look like the two legs of one
    real transfer (same amount, close dates, different accounts) but carry
    different descriptions.

    Candidates come from `transactions_col` only — the same stable-_id
    caveat that applies to the miscategorised-dismiss machinery applies here
    (other providers' collections get delete-reinserted on sync, so a stored
    _id or pair_key would go stale).
    """
    kind_map = await get_category_kinds(uid)  # ONE read per request
    identity = await user_identity(uid)  # ONE read per request — evidence gate below

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    dismissed_pairs = set(prefs.get("dismissed_transfer_pairs") or [])
    dismissed_rows = set(prefs.get("dismissed_miscategorised") or [])
    dismissed_series = set(prefs.get("dismissed_miscategorised_series") or [])
    raw_snapshots = prefs.get("separate_transfer_pair_reviews") or []
    if isinstance(raw_snapshots, dict):
        pair_snapshots = [{"pair_key": key, **value} for key, value in raw_snapshots.items() if isinstance(value, dict)]
    elif isinstance(raw_snapshots, list):
        pair_snapshots = [value for value in raw_snapshots if isinstance(value, dict)]
    else:
        pair_snapshots = []
    snapshots_by_key: dict[str, list[dict]] = defaultdict(list)
    for snapshot in pair_snapshots:
        if isinstance(snapshot.get("pair_key"), str):
            snapshots_by_key[snapshot["pair_key"]].append(snapshot)
    # Once a candidate is deliberately split into individual questions, an
    # unchanged leg cannot be quietly reused by another same-amount pair.
    # The separate queue validates bank facts, so amended rows drop out and
    # may be matched again on their new facts.
    active_separate_ids = frozenset(item["id"] for item in await _separate_pair_review_items(uid))

    learned_docs = await confirmed_transfer_pairs_col.find(
        {"user_id": uid}, {"key_a": 1, "key_b": 1}
    ).to_list(None)
    learned_pair_keys = {
        tuple(sorted((d["key_a"], d["key_b"])))
        for d in learned_docs if d.get("key_a") and d.get("key_b")
    }

    owned_accounts = {a["_id"]: a async for a in accounts_col.find(
        {"user_id": uid}, {"currency": 1, "provider": 1},
    )}
    from app.services.own_account_transfers import _pair_key

    # Manual choices win only when they mean "this leg is genuinely
    # spending" (owner device-testing fix 1a) — a custom SPEND-kind category
    # blocks the pair (the user explicitly said so, don't second-guess). A
    # custom MOVEMENT-kind category (Transfer/Savings/Debt/Investment/a
    # custom movement category) does NOT block: it agrees with the transfer
    # hypothesis and ANCHORS it, so the pair still surfaces to fix the OTHER
    # leg — confirm-transfer-pair below then leaves the movement-kind leg
    # completely untouched and writes only the other. The query can no
    # longer exclude custom_category at the source, so gating moves to
    # Python (_leg_blocks_pair below).
    txns = await transactions_col.find(
        {"user_id": uid, "transaction_type": {"$in": ["credit", "debit"]}, "is_pending": {"$ne": True}},
        {"account_id": 1, "amount": 1, "date": 1, "description": 1,
         "merchant_name": 1, "category": 1, "custom_category": 1,
         "transaction_type": 1, "currency": 1, "own_transfer_match": 1, "is_pending": 1},
    ).to_list(None)

    txns = [{**t, "currency": t.get("currency") or owned_accounts[t["account_id"]].get("currency")}
            for t in txns if t.get("account_id") in owned_accounts]

    from app.services.own_account_transfers import resolve_transfer_evidence
    txns = resolve_transfer_evidence(
        txns, {name for name in kind_map if is_non_spend(kind_map, name)},
        owned_account_ids=set(owned_accounts),
    )

    def _effective_category(t: dict):
        return t.get("custom_category") or t.get("category")

    def _leg_blocks_pair(t: dict) -> bool:
        cc = t.get("custom_category")
        return cc is not None and is_spend(kind_map, cc)

    def _debit_needs_fixing(cat) -> bool:
        return cat == "Other" or is_spend(kind_map, cat)

    def _credit_needs_fixing(cat) -> bool:
        return cat in ("Income", "Other") or is_spend(kind_map, cat)

    credits = [t for t in txns if t.get("transaction_type") == "credit" and t.get("date") is not None]
    debits  = [t for t in txns if t.get("transaction_type") == "debit" and t.get("date") is not None]

    def _day(t):
        d = t["date"]
        return d.date() if hasattr(d, "date") else d

    candidates = []  # (date_diff, amount, credit, debit, pair_key)
    for c in credits:
        if str(c["_id"]) in active_separate_ids:
            continue
        c_day = _day(c)
        for d in debits:
            if str(d["_id"]) in active_separate_ids:
                continue
            if _pair_key(c) is None or _pair_key(c) != _pair_key(d):
                continue
            if c.get("account_id") == d.get("account_id"):
                continue
            date_diff = abs((c_day - _day(d)).days)
            if date_diff > 0:  # G447: the frozen scan's date window is now the same calendar day (nothing else changed)
                continue
            # A prior "this is spending" dismissal also answers the same
            # transaction when it later becomes a pair candidate after sync.
            if (str(d["_id"]) in dismissed_rows or series_key(d) in dismissed_series):
                continue
            if _leg_blocks_pair(c) or _leg_blocks_pair(d):
                continue
            # Actionability (fix 1b) — at least one leg must still need
            # fixing: the debit's effective category is spend-kind or
            # Other, or the credit's effective category is Income, Other,
            # or spend-kind. Both legs already movement-kind -> genuinely
            # nothing to do -> skip.
            c_eff = _effective_category(c)
            d_eff = _effective_category(d)
            if not (_debit_needs_fixing(d_eff) or _credit_needs_fixing(c_eff)):
                continue
            # Evidence gate (owner review fix 2) — same amount + close dates
            # is not enough on its own; reject a coincidence like a £50
            # client-income credit paired with an unrelated £50 ATM debit.
            if not (_has_pair_evidence(c, d, identity) or _has_named_bank_transfer_reference(c, d, owned_accounts)):
                continue
            pair_key = ":".join(sorted([str(c["_id"]), str(d["_id"])]))
            if pair_key in dismissed_pairs:
                snapshots = snapshots_by_key.get(pair_key)
                # Legacy bare dismissals deliberately retain their permanent
                # behaviour. New snapshot-backed dismissals apply only while
                # both original bank records still match, so two amended
                # records can be reviewed as a fresh possible pair.
                if not snapshots or any(
                    _same_separate_review_leg(c, snapshot.get("credit") or {})
                    and _same_separate_review_leg(d, snapshot.get("debit") or {})
                    for snapshot in snapshots
                ):
                    continue
            c_key = canonical_merchant_key(c.get("merchant_name") or "", c.get("description") or "")
            d_key = canonical_merchant_key(d.get("merchant_name") or "", d.get("description") or "")
            # A learned description-pair auto-matches at the next sync — no
            # need to ask again.
            if tuple(sorted((c_key, d_key))) in learned_pair_keys:
                continue
            candidates.append((date_diff, c.get("amount") or 0, c, d, pair_key))

    # Greedy matching: nearest date-diff first (same-day beats 1-day), then
    # largest amount first, then pair_key as a final deterministic tiebreak
    # (owner review fix 5) — the Mongo find() above has no explicit sort, so
    # without this, two candidates tied on date-diff and amount could order
    # differently between requests depending on unspecified document order,
    # making the greedy match's outcome non-deterministic.
    candidates.sort(key=lambda x: (x[0], -x[1], x[4]))

    used_credits: set = set()
    used_debits: set = set()
    suggestions = []
    for date_diff, amount, c, d, pair_key in candidates:
        if c["_id"] in used_credits or d["_id"] in used_debits:
            continue
        used_credits.add(c["_id"])
        used_debits.add(d["_id"])
        suggestions.append({
            "pair_key": pair_key,
            "date_diff_days": date_diff,
            "credit": _pair_leg(c),
            "debit": _pair_leg(d),
        })

    suggestions.sort(key=lambda s: s["credit"]["amount"] or 0, reverse=True)
    return suggestions[:10]


_old_scan = types.FunctionType(
    _old_transfer_pair_suggestions.__code__, analytics.__dict__,
    "_old_transfer_pair_suggestions",
)


def _equiv_rows():
    from test_transfer_pairs import _t
    from datetime import datetime, timedelta
    base = datetime(2026, 8, 10)
    day = lambda n: base + timedelta(days=n)
    rows = []
    # Several same-amount candidates: 3 credits and 3 debits at 40.00 across accounts.
    for i in range(3):
        rows.append(_t(f"mc{i}", ttype="credit", amount=40.0, date=day(i), account_id=f"cr{i}",
                       desc="OWNER REF SHARED", category="Income"))
        rows.append(_t(f"md{i}", ttype="debit", amount=40.0, date=day(i), account_id=f"db{i}",
                       desc="OWNER REF SHARED", category="Other"))
    # Date ties: one credit, two debits equally close (same day diff), same amount.
    rows.append(_t("tc", ttype="credit", amount=12.34, date=day(10), account_id="cr0",
                   desc="TIE REF", category="Income"))
    rows.append(_t("td1", ttype="debit", amount=12.34, date=day(10), account_id="db0",
                   desc="TIE REF", category="Other"))
    rows.append(_t("td2", ttype="debit", amount=12.34, date=day(10), account_id="db1",
                   desc="TIE REF", category="Other"))
    # Cross-currency near miss: same number, different currency; and 0.01 off.
    rows.append(_t("xc", ttype="credit", amount=77.77, date=day(20), account_id="cr0",
                   desc="NEAR REF", category="Income"))
    usd = _t("xd", ttype="debit", amount=77.77, date=day(20), account_id="db0",
             desc="NEAR REF", category="Other")
    usd["currency"] = "USD"
    rows.append(usd)
    rows.append(_t("xe", ttype="debit", amount=77.78, date=day(20), account_id="db1",
                   desc="NEAR REF", category="Other"))
    # Same account both legs (never pairs) and a null amount.
    rows.append(_t("sc", ttype="credit", amount=5.5, date=day(30), account_id="cr0",
                   desc="SAME REF", category="Income"))
    rows.append(_t("sd", ttype="debit", amount=5.5, date=day(30), account_id="cr0",
                   desc="SAME REF", category="Other"))
    rows.append(_t("nc", ttype="credit", amount=None, date=day(31), account_id="cr0",
                   desc="NULL REF", category="Income"))
    rows.append(_t("nd", ttype="debit", amount=None, date=day(31), account_id="db0",
                   desc="NULL REF", category="Other"))
    return rows


def test_optimised_pair_scan_equals_frozen_old_scan(monkeypatch):
    from test_transfer_pairs import FakeCol, _fake_get_category_kinds, _fake_user_identity, EMPTY_IDENTITY
    rows = _equiv_rows()
    accounts = {r["account_id"] for r in rows}
    monkeypatch.setattr(analytics, "transactions_col", FakeCol(rows))
    monkeypatch.setattr(analytics, "accounts_col", FakeCol([
        {"_id": a, "user_id": UID, "currency": "GBP", "type": "current"} for a in accounts]))
    monkeypatch.setattr(analytics, "preferences_col", FakeCol([{"user_id": UID}]))
    monkeypatch.setattr(analytics, "confirmed_transfer_pairs_col", FakeCol([]))
    monkeypatch.setattr(analytics, "get_category_kinds", _fake_get_category_kinds)
    monkeypatch.setattr(analytics, "user_identity", _fake_user_identity(EMPTY_IDENTITY))
    old = asyncio.run(_old_scan(UID))
    new = asyncio.run(analytics._transfer_pair_suggestions(UID))
    # G442: the suggestions now lead newest first and carry their recurring
    # series; the SET of suggested pairs and their legs is what must not change.
    flat = [{k: v for k, v in item.items() if k not in ("series", "ai_reason")} for item in new]
    assert sorted(old, key=lambda i: i["pair_key"]) == sorted(flat, key=lambda i: i["pair_key"])
    assert sum(item["series"]["count"] for item in new) == len(new)  # no series in this fixture repeats
    assert len(new) >= 4, "fixtures must actually produce several suggestions"
    legs = {p["debit"]["id"] for p in new} | {p["credit"]["id"] for p in new}
    assert not ({"xd", "xe", "sc", "sd", "nc", "nd"} & legs)


def test_rule_application_marks_the_store_stale(monkeypatch):
    import app.services.categorisation as categorisation
    from test_transfer_pairs import FakeCol
    marks = []

    async def record(uid):
        marks.append(uid)

    monkeypatch.setattr(store, "mark_stale", record)
    rows = [{"_id": "r1", "user_id": UID, "merchant_name": "SQ *KANTEEN", "description": "SQ *KANTEEN",
             "merchant_key": "kanteen", "category": "Other", "custom_category": None}]
    monkeypatch.setattr(categorisation, "transactions_col", FakeCol(rows))
    assert asyncio.run(categorisation.apply_single_rule(UID, "kanteen", "Eating Out"))
    assert marks == [UID]
    marks.clear()
    assert asyncio.run(categorisation.apply_single_rule(UID, "nomatchever", "Eating Out")) == []
    assert marks == [], "no rows affected, nothing to invalidate"
