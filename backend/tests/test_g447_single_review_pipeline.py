"""G447 (Kevin 2026-11-09): the transfers review has ONE pipeline.

After G443 the stored review still held seven pairs the judge had marked
not_transfer (or that bank facts rule out). Built here from the exact SHAPES of
those rows with invented names, amounts and ids: a merchant leg and an own-looking
leg on the same day, the own-looking credit categorised as a transfer or savings
move. The model is never called; verdicts are inserted as stored judgements.

  a  the seven shapes never reach the stored review, and Spend keeps them
  b  a pair with no verdict yet is the G442 fallback only
  c  the timing rule: same London day between current accounts; a card repayment
     keeps its few days; a learned series matches on any date (nearest first)
  d  the stored review is rebuilt when verdicts, rules, learned pairs or answers change
  e  the G438 invariant: whatever Spend leaves out, the review asks about
"""
import asyncio
import json
from datetime import datetime, timedelta

import app.routers.analytics as analytics
import app.services.categorisation as categorisation
import app.services.own_account_transfers as oat
import app.services.own_transfer_judge as judge
import app.services.transfer_review_store as review_store
from app.services.spending import SpendingContext, find_own_move_ids, find_pending_transfer_ids, is_spending

import test_g442_ai_transfer_judgement as g442
from test_g442_ai_transfer_judgement import KINDS, TOKENS, UID, _arun, _row, mongo_env

REAL_REFRESH = review_store.refresh  # mongo_env replaces it with a no-op; the rebuild tests put it back

D0 = datetime(2026, 10, 29)  # date-only, the shape banks send

ACCTS = [
    {"_id": "natw", "user_id": UID, "name": "Main", "provider": "NatWest", "type": "current", "currency": "GBP"},
    {"_id": "barc", "user_id": UID, "name": "Everyday", "provider": "Barclays", "type": "current", "currency": "GBP"},
    {"_id": "hsbc", "user_id": UID, "name": "Advance", "provider": "HSBC", "type": "current", "currency": "GBP"},
    {"_id": "star", "user_id": UID, "name": "Starling Joint", "provider": "Starling", "type": "current", "currency": "GBP"},
    {"_id": "pot-h", "user_id": UID, "name": "Holiday", "provider": "Starling", "type": "savings", "currency": "GBP"},
    {"_id": "pot-s", "user_id": UID, "name": "Saving Challenge (2026)", "provider": "Starling", "type": "savings", "currency": "GBP"},
    {"_id": "pot-t", "user_id": UID, "name": "Transport Pot", "provider": "Starling", "type": "savings", "currency": "GBP"},
    {"_id": "ncc1", "user_id": UID, "name": "NatWest Mastercard 7788", "provider": "NatWest", "type": "credit_card", "currency": "GBP"},
]
BY_ID = {a["_id"]: a for a in ACCTS}

# (key, amount, debit row, credit row, verdict). The debit is the merchant side.
SHAPES = {
    "ee": (31.0,
           dict(account="natw", text="EE LIMITED", merchant="EE Limited", category="Bills"),
           dict(account="star", text="STARLING", category="Transfer"), "not_transfer"),
    "gs": (47.5,
           dict(account="natw", text="Goldman Sachs", merchant="Goldman Sachs", category="Other"),
           dict(account="pot-h", text="Holiday", category="Savings"), "not_transfer"),
    "byond": (22.4,
              dict(account="star", text="Byond Card", merchant="Byond", category="Shopping"),
              dict(account="natw", text="HARTLEY J E MAIN FP", category="Transfer"), "not_transfer"),
    "lyca": (12.0,
             dict(account="barc", text="Lycamobile ON 09 MAY BCC", category="Other"),
             dict(account="hsbc", text="HARTLEY J E HSBC", category="Transfer"), None),
    "uber": (18.6,
             dict(account="pot-t", text="Uber from Transport Pot", category="Transport"),
             dict(account="natw", text="JORDAN HARTLEY BGC", category="Transfer"), "not_transfer"),
    "hurst": (9.99,
              dict(account="natw", text="Hurst Lane Post Of ON 11 APR CPM", category="Other"),
              dict(account="pot-s", text="Saving Challenge (2026)", category="Savings"), None),
    "nob": (65.0,
            dict(account="natw", text="Nobility Healt", merchant="Nobility Health", category="Health"),
            dict(account="star", text="STARLING", category="Transfer"), "not_transfer"),
}


def _shape_rows(day=D0):
    rows, verdicts = [], []
    for key, (amount, d, c, verdict) in SHAPES.items():
        rows.append(_row(f"{key}-d", "debit", amount, d["account"], day, d["text"], category=d["category"],
                         merchant_name=d.get("merchant")))
        rows.append(_row(f"{key}-c", "credit", amount, c["account"], day, c["text"], category=c["category"]))
        if verdict:
            ids = sorted((f"{key}-c", f"{key}-d"))
            verdicts.append({"_id": f"{UID}::{':'.join(ids)}", "user_id": UID, "kind": "pair", "ids": ids,
                             "verdict": verdict, "reason": "Different counterparties.",
                             "series_sig": f"sig-{key}", "prompt_version": judge.PROMPT_VERSION})
    return rows, verdicts


def _legs(state):
    out = set()
    for p in state["pairs"]:
        out |= {p["credit"]["id"], p["debit"]["id"]}
        out |= {x for s in p.get("series", {}).get("pairs", []) for x in (s["credit_id"], s["debit_id"])}
    return out | {t["_id"] for t in state["flagged"]}


ALL_SHAPE_IDS = {f"{k}-{leg}" for k in SHAPES for leg in "dc"}


# ── a: the seven shapes ─────────────────────────────────────────────────────

def test_none_of_the_seven_shapes_reaches_the_stored_review_and_spend_keeps_them(monkeypatch):
    rows, verdicts = _shape_rows()

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS) as cols:
            await cols["own_transfer_judgements"].insert_many(verdicts)
            state = await analytics._build_review_state(UID)
            assert _legs(state) & ALL_SHAPE_IDS == set(), _legs(state) & ALL_SHAPE_IDS
            # nothing is hidden and unasked: Spend still counts every merchant debit
            identity = await categorisation.user_identity(UID)
            docs = [dict(r) for r in rows]
            assert find_pending_transfer_ids(docs, KINDS, identity) & {f"{k}-d" for k in SHAPES} == set()
            ctx = SpendingContext.from_docs(docs, KINDS, identity)
            assert all(is_spending(r, ctx) for r in docs if r["_id"].endswith("-d"))
    _arun(run())


def test_a_not_transfer_verdict_beats_a_credit_that_claims_a_move():
    """The cause on main: _has_pair_evidence returned True for a credit categorised as a
    transfer BEFORE it read the model's verdict, so a not_transfer pair stayed in the review."""
    d = _row("d", "debit", 31.0, "natw", D0, "EE LIMITED", merchant_name="EE Limited", category="Bills")
    c = _row("c", "credit", 31.0, "star", D0, "STARLING", category="Transfer")
    meta = {k: {f: v.get(f) for f in ("provider", "name", "type")} for k, v in BY_ID.items()}
    base = {"name_tokens": TOKENS, "own_ids": set(), "own_map": {}, "account_meta": meta}
    ids = frozenset(("c", "d"))
    verdict = {ids: {"verdict": "not_transfer", "reason": "x"}}
    assert analytics._has_pair_evidence(c, d, {**base, "ai_pairs": verdict, "ai_blocked": frozenset({ids})}, True) is False
    # unjudged, the credit's own claim still asks it (the G442 fallback)
    assert analytics._has_pair_evidence(c, d, base, True) is True
    # unclear is asked with the model's reason, whatever else
    unclear = {ids: {"verdict": "unclear", "reason": "y"}}
    assert analytics._has_pair_evidence(c, d, {**base, "ai_pairs": unclear, "ai_blocked": frozenset({ids})}, True) is True


def test_a_bank_labelled_transfer_reference_never_overrides_not_transfer(monkeypatch):
    accounts = {"src": {"provider": "NatWest"}}
    credit = {"_id": "c", "description": "FROM BALTFRNATWES"}
    debit = {"_id": "d", "account_id": "src", "description": "TO CHASE BANK FT"}
    assert analytics._has_named_bank_transfer_reference(credit, debit, accounts)  # evidence on its own...
    # ...but the review gate in _transfer_pair_suggestions reads the verdict first (covered end to end below)
    assert oat.ai_verdict_for({"ai_pairs": {frozenset(("c", "d")): {"verdict": "not_transfer"}}}, credit, debit) == "not_transfer"
    assert oat.ai_verdict_for({}, credit, debit) is None


def test_the_review_reads_the_shared_pair_builder_only():
    import inspect
    src = inspect.getsource(analytics._transfer_pair_suggestions)
    assert "_same_amount_pairs(" in src
    assert "debits_by_key" not in src and "ASK_PAIR_DAYS" not in src  # the second, older scan is gone
    assert "pair_pruned_reason" not in src  # pruning lives in the builder and the gate, once


def test_every_pair_the_review_offers_is_one_the_builder_yields(monkeypatch):
    """No second path can produce a pair: the review's output is a subset of the builder's."""
    rows = [_row("a-d", "debit", 41.0, "natw", D0, "JORDAN HARTLEY HSBC STO"),
            _row("a-c", "credit", 41.0, "hsbc", D0, "HARTLEY J E HSBC"),
            _row("b-d", "debit", 42.0, "natw", D0, "PAIRREF OUT"),
            _row("b-c", "credit", 42.0, "hsbc", D0 + timedelta(days=1), "PAIRREF IN", category="Transfer")]

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS):
            identity = await categorisation.user_identity(UID)
            monkeypatch.setattr(analytics, "user_identity", lambda uid: g442._async(identity))
            offered = {(i["credit"]["id"], i["debit"]["id"]) for i in await analytics._transfer_pair_suggestions(UID)}
            built = {(c["_id"], d["_id"]) for c, d, _ in oat._same_amount_pairs(
                [dict(r) for r in rows], BY_ID, {"Transfer"}, consumed=set(), exclude_ids=frozenset())}
            assert offered == {("a-c", "a-d")} and offered <= built
    _arun(run())


# ── b: genuinely unjudged ───────────────────────────────────────────────────

def test_the_unjudged_shapes_with_bank_facts_are_pruned_and_the_rest_fall_back(monkeypatch):
    rows, _ = _shape_rows()

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS):
            state = await analytics._build_review_state(UID)
            legs = _legs(state)
            # a card purchase marker (Lycamobile BCC, Hurst Lane CPM) is ruled out before any model
            assert legs & {"lyca-d", "lyca-c", "hurst-d", "hurst-c"} == set()
            # with no verdict yet, a credit that says it is a move is the G442 fallback: asked
            assert {"ee-d", "ee-c"} <= legs
    _arun(run())


# ── c: timing ───────────────────────────────────────────────────────────────

def _named(day_c, day_d):
    return (_row("c", "credit", 80.0, "hsbc", day_c, "HARTLEY J E HSBC"),
            _row("d", "debit", 80.0, "natw", day_d, "JORDAN HARTLEY HSBC STO"))


def test_same_day_current_to_current_is_a_candidate_and_next_day_is_not():
    c, d = _named(D0 + timedelta(hours=4), D0)
    got = oat.ai_candidate_pairs([c, d], BY_ID, TOKENS, set(), movement_categories={"Transfer"})
    assert [(x["_id"], y["_id"]) for x, y in got] == [("c", "d")]
    assert [(x["_id"], y["_id"]) for x, y, _ in oat._same_amount_pairs(
        [c, d], BY_ID, {"Transfer"}, consumed=set(), exclude_ids=frozenset())] == [("c", "d")]
    c2, d2 = _named(D0 + timedelta(days=1), D0)
    assert oat.ai_candidate_pairs([c2, d2], BY_ID, TOKENS, set(), movement_categories={"Transfer"}) == []
    assert list(oat._same_amount_pairs([c2, d2], BY_ID, {"Transfer"}, consumed=set(), exclude_ids=frozenset())) == []
    assert oat.select_unique_pairs([c2, d2], BY_ID, TOKENS, set(), movement_categories={"Transfer"}) == []


def test_the_london_calendar_day_decides_not_the_utc_day():
    # BST: 23:30 UTC on 28 Oct is 00:30 on the 29th in London; 22:00 UTC on the 29th is the 29th
    assert oat.same_calendar_day(datetime(2026, 10, 24, 23, 30), datetime(2026, 10, 25, 12, 0)) is True  # BST
    assert oat.same_calendar_day(datetime(2026, 10, 24, 22, 30), datetime(2026, 10, 25, 12, 0)) is False
    # GMT: UTC date is the London date
    assert oat.same_calendar_day(datetime(2026, 11, 3, 23, 30), datetime(2026, 11, 4, 0, 5)) is False
    # a date-only leg (midnight) is the bank's own date in both seasons
    assert oat.same_calendar_day(datetime(2026, 7, 14), datetime(2026, 7, 14, 21, 0)) is True
    assert oat.same_calendar_day(datetime(2026, 12, 14), datetime(2026, 12, 14, 21, 0)) is True


def test_a_card_repayment_two_days_apart_is_still_matched_and_not_asked(monkeypatch):
    rows = [_row("r-d", "debit", 61.78, "natw", datetime(2026, 7, 29), "NATWEST", category="Other"),
            _row("r-c", "credit", 61.78, "ncc1", datetime(2026, 7, 31), "DIRECT DEBIT PAYMENT 7788", category="Income")]
    detailed = oat.select_unique_pairs_detailed(rows, BY_ID, TOKENS, set(), movement_categories={"Transfer"})
    assert [(c["_id"], d["_id"], i) for c, d, i in detailed] == [("r-c", "r-d", "natwest")]
    # the same two days between two CURRENT accounts is no pair
    cur = [_row("x-d", "debit", 61.78, "natw", datetime(2026, 7, 29), "JORDAN HARTLEY HSBC STO"),
           _row("x-c", "credit", 61.78, "hsbc", datetime(2026, 7, 31), "HARTLEY J E HSBC")]
    assert oat.select_unique_pairs_detailed(cur, BY_ID, TOKENS, set(), movement_categories={"Transfer"}) == []
    # Spend: a card account partner may span the repayment window, a current one may not
    assert oat.pair_timing_ok(rows[1], rows[0], BY_ID)
    assert not oat.pair_timing_ok(cur[1], cur[0], BY_ID)
    far = {**rows[1], "date": datetime(2026, 8, 5)}
    assert not oat.pair_timing_ok(far, rows[0], BY_ID)


def test_a_learned_series_matches_on_any_date_nearest_first_one_to_one():
    start = datetime(2026, 6, 1)
    rows = []
    for m in range(4):  # a monthly standing order whose credit lands a few days after the debit
        rows.append(_row(f"d{m}", "debit", 150.0, "natw", start + timedelta(days=30 * m), "JORDAN HARTLEY HSBC STO"))
        rows.append(_row(f"c{m}", "credit", 150.0, "hsbc", start + timedelta(days=30 * m + (7 if m % 2 else 0)), "HARTLEY J E HSBC"))
    key = tuple(sorted((categorisation.canonical_merchant_key("", "HARTLEY J E HSBC"),
                        categorisation.canonical_merchant_key("", "JORDAN HARTLEY HSBC STO"))))
    # no learned pair: only the same-day months pair, and the seven day ones do not
    plain = oat.select_unique_pairs(rows, BY_ID, TOKENS, set(), movement_categories={"Transfer"})
    assert sorted((c["_id"], d["_id"]) for c, d in plain) == [("c0", "d0"), ("c2", "d2")]
    learned = oat.select_unique_pairs(rows, BY_ID, TOKENS, {key}, movement_categories={"Transfer"})
    assert sorted((c["_id"], d["_id"]) for c, d in learned) == [(f"c{m}", f"d{m}") for m in range(4)]
    # and a single credit weeks after its debit still matches once the pair is learned
    lone = [_row("ld", "debit", 99.0, "natw", start, "JORDAN HARTLEY HSBC STO"),
            _row("lc", "credit", 99.0, "hsbc", start + timedelta(days=40), "HARTLEY J E HSBC")]
    assert [(c["_id"], d["_id"]) for c, d in oat.select_unique_pairs(lone, BY_ID, TOKENS, {key}, movement_categories={"Transfer"})] == [("lc", "ld")]
    assert oat.select_unique_pairs(lone, BY_ID, TOKENS, set(), movement_categories={"Transfer"}) == []


def test_series_singles_and_the_judge_window_still_work():
    # G443: the single leg of a filed series near the start of history
    first_b = datetime(2026, 10, 1)
    ev = [{"account_id": "natw", "other_account_id": "hsbc", "transaction_type": "debit",
           "pair_key": ("GBP", oat._pair_key(_row("t", "debit", 50.0, "natw", first_b, "x"))[1]),
           "text_key": oat.transfer_text_key(None, "MONTHLY STO"), "category": "Transfer"}]
    near = _row("near", "debit", 50.0, "natw", first_b - timedelta(days=20), "MONTHLY STO 11/09/26")
    b_rows = [_row("b0", "credit", 7.0, "hsbc", first_b, "OTHER THING")]
    assert [r["_id"] for r, _ in oat.series_single_legs(ev, {"natw": [near], "hsbc": b_rows})] == ["near"]
    # G442: the judge's candidates are the same-day builder output, unique legs only
    c, d = _named(D0, D0)
    assert len(oat.ai_candidate_pairs([c, d], BY_ID, TOKENS, set(), movement_categories={"Transfer"})) == 1


# ── e: the invariant under the new rules ────────────────────────────────────

def test_nothing_is_hidden_and_unasked_for_same_day_and_next_day_pairs(monkeypatch):
    cases = [(D0, D0), (D0 + timedelta(days=1), D0), (D0 + timedelta(days=3), D0)]
    for c_at, d_at in cases:
        for credit_cat in ("Transfer", "Income"):
            c = _row("c", "credit", 55.5, "hsbc", c_at, "HARTLEY J E HSBC", category=credit_cat)
            d = _row("d", "debit", 55.5, "natw", d_at, "JORDAN HARTLEY HSBC STO")
            meta = {k: {f: v.get(f) for f in ("provider", "name", "type")} for k, v in BY_ID.items()}
            identity = {"name_tokens": TOKENS, "own_ids": set(), "own_map": {}, "own_keys": {},
                        "account_names": {k: v["name"] for k, v in BY_ID.items()}, "account_meta": meta}
            pending = find_pending_transfer_ids([c, d], KINDS, identity)
            own = find_own_move_ids([c, d], KINDS, identity)
            if c_at != d_at:  # the next day: no pair, so nothing leaves Spend
                assert pending == set() and own == set()
                continue
            for leg_id in pending:
                assert analytics._has_pair_evidence(c, d, identity, credit_cat == "Transfer"), (credit_cat, leg_id)


# ── d: rebuild on change (H145) ─────────────────────────────────────────────

def _pair_rows():
    return [_row("p-d", "debit", 41.0, "natw", D0, "JORDAN HARTLEY HSBC STO"),
            _row("p-c", "credit", 41.0, "hsbc", D0, "HARTLEY J E HSBC")]


async def _stored(cols):
    return await cols["transfer_review_store"].find_one({"_id": UID})


def test_the_fingerprint_carries_rules_prompt_learned_source_and_verdicts(monkeypatch):
    async def run():
        async with mongo_env(monkeypatch, _pair_rows(), accounts=ACCTS) as cols:
            base = await analytics._review_inputs_fingerprint(UID)
            assert await analytics._review_inputs_fingerprint(UID) == base
            monkeypatch.setattr(oat, "REVIEW_RULES_VERSION", oat.REVIEW_RULES_VERSION + 1)
            assert await analytics._review_inputs_fingerprint(UID) != base  # a rule change
            monkeypatch.setattr(oat, "REVIEW_RULES_VERSION", oat.REVIEW_RULES_VERSION - 1)
            monkeypatch.setattr(judge, "PROMPT_VERSION", judge.PROMPT_VERSION + 1)
            assert await analytics._review_inputs_fingerprint(UID) != base  # a prompt change
            monkeypatch.setattr(judge, "PROMPT_VERSION", judge.PROMPT_VERSION - 1)
            await cols["confirmed_transfer_pairs"].insert_one({"user_id": UID, "key_a": "aaaa bb", "key_b": "cccc dd"})
            with_user = await analytics._review_inputs_fingerprint(UID)
            assert with_user != base  # a learned pair
            await cols["confirmed_transfer_pairs"].update_one({"key_a": "aaaa bb"}, {"$set": {"source": "ai"}})
            assert await analytics._review_inputs_fingerprint(UID) != with_user  # the same pair, now the model's
    _arun(run())


def test_the_store_is_rebuilt_after_a_verdict_changes(monkeypatch):
    async def run():
        async with mongo_env(monkeypatch, _pair_rows(), accounts=ACCTS) as cols:
            monkeypatch.setattr(review_store, "refresh", REAL_REFRESH)
            await review_store.refresh(UID)
            before = await _stored(cols)
            assert [p["debit"]["id"] for p in before["state"]["pairs"]] == ["p-d"]
            await cols["own_transfer_judgements"].insert_one({
                "_id": f"{UID}::p-c:p-d", "user_id": UID, "kind": "pair", "ids": ["p-c", "p-d"],
                "verdict": "not_transfer", "reason": "Different counterparties.", "series_sig": "s",
                "prompt_version": judge.PROMPT_VERSION})
            await judge._after_verdicts(UID, filed=False)  # what a judge run does when it stores verdicts
            after = await _stored(cols)
            assert after["fingerprint"] != before["fingerprint"] and after["state"]["pairs"] == []
            assert review_store.is_valid(after, await analytics._review_inputs_fingerprint(UID))
    _arun(run())


def test_the_store_is_rebuilt_after_a_confirm_and_after_a_dismissal(monkeypatch):
    async def run():
        async with mongo_env(monkeypatch, _pair_rows() + [
                _row("q-d", "debit", 77.0, "natw", D0, "JORDAN HARTLEY HSBC STO 2"),
                _row("q-c", "credit", 77.0, "hsbc", D0, "HARTLEY J E HSBC 2")], accounts=ACCTS) as cols:
            monkeypatch.setattr(review_store, "refresh", REAL_REFRESH)
            await review_store.refresh(UID)
            assert len((await _stored(cols))["state"]["pairs"]) == 2
            # a dismissal starts the background rebuild; wait for it, no screen read involved
            await analytics.dismiss_transfer_pair({"pair_key": "p-c:p-d"}, {"email": UID})
            task = review_store._inflight.get(UID)
            if task is not None:
                await task
            doc = await _stored(cols)
            assert [p["debit"]["id"] for p in doc["state"]["pairs"]] == ["q-d"]
            assert review_store.is_valid(doc, await analytics._review_inputs_fingerprint(UID))
            # a confirm does the same
            async def _noop(*a, **k):
                return None
            import app.services.derived_caches as derived_caches
            monkeypatch.setattr(derived_caches, "defer_transfer_review_recompute", _noop)
            monkeypatch.setattr(analytics.response_cache, "ainvalidate", _noop)
            await analytics.confirm_transfer_pair({"credit_id": "q-c", "debit_id": "q-d", "defer_recompute": True}, {"email": UID})
            task = review_store._inflight.get(UID)
            if task is not None:
                await task
            doc = await _stored(cols)
            assert doc["state"]["pairs"] == []
            assert review_store.is_valid(doc, await analytics._review_inputs_fingerprint(UID))
    _arun(run())


def test_a_rule_change_after_deploy_is_rebuilt_by_the_worker_refresh(monkeypatch):
    async def run():
        async with mongo_env(monkeypatch, _pair_rows(), accounts=ACCTS) as cols:
            monkeypatch.setattr(review_store, "refresh", REAL_REFRESH)
            await review_store.refresh(UID)
            first = await _stored(cols)
            built = {"n": 0}
            real = analytics._build_review_state

            async def counting(uid):
                built["n"] += 1
                return await real(uid)

            monkeypatch.setattr(analytics, "_build_review_state", counting)
            assert await review_store.refresh_all() == 1 and built["n"] == 0  # nothing changed: one fingerprint read
            monkeypatch.setattr(oat, "REVIEW_RULES_VERSION", oat.REVIEW_RULES_VERSION + 1)  # the deploy
            assert await review_store.refresh_all() == 1 and built["n"] == 1
            assert (await _stored(cols))["fingerprint"] != first["fingerprint"]
    _arun(run())


def test_the_worker_starts_the_store_refresh_at_startup():
    import inspect
    import app.workers.sync_worker as worker
    assert "_review_store_refresh_on_startup" in inspect.getsource(worker._on_startup)


# ── user answers beat a stale verdict; card purchase prune on lone debits ───

def test_a_user_set_transfer_category_beats_a_stale_not_transfer_verdict(monkeypatch):
    meta = {k: {f: v.get(f) for f in ("provider", "name", "type")} for k, v in BY_ID.items()}
    ids = frozenset(("c", "d"))
    ident = {"name_tokens": TOKENS, "own_ids": set(), "own_map": {}, "own_keys": {},
             "account_names": {k: v["name"] for k, v in BY_ID.items()}, "account_meta": meta,
             "ai_pairs": {ids: {"verdict": "not_transfer", "reason": "x"}}, "ai_blocked": frozenset({ids})}
    d = _row("d", "debit", 31.0, "natw", D0, "EE LIMITED", merchant_name="EE Limited", category="Bills")
    engine = _row("c", "credit", 31.0, "star", D0, "STARLING", category="Transfer")  # the engine's guess
    assert analytics._has_pair_evidence(engine, d, ident, True) is False
    user = {**engine, "custom_category": "Transfer"}  # the user then sets it
    assert analytics._has_pair_evidence(user, d, ident, True) is True
    # Spend reads the same answer: an "Other" debit pairs with the user's credit despite the verdict,
    # and whatever leaves Spend is askable
    other = {**d, "category": "Other"}
    pending = find_pending_transfer_ids([dict(user), dict(other)], KINDS, ident)
    own = find_own_move_ids([dict(user), dict(other)], KINDS, ident)
    assert pending | own, "the user's answer makes it a pair again"
    if pending:
        assert analytics._has_pair_evidence(user, other, ident, True)

    async def run():
        async with mongo_env(monkeypatch, [dict(d), dict(user)], accounts=ACCTS) as cols:
            await cols["own_transfer_judgements"].insert_one({
                "_id": f"{UID}::c:d", "user_id": UID, "kind": "pair", "ids": ["c", "d"], "verdict": "not_transfer",
                "reason": "x", "series_sig": "s", "prompt_version": judge.PROMPT_VERSION})
            state = await analytics._build_review_state(UID)
            assert [p["debit"]["id"] for p in state["pairs"]] == ["d"]
    _arun(run())


def test_a_lone_debit_with_owner_text_and_a_card_marker_is_not_asked(monkeypatch):
    from test_g438_transfer_classification import _review_fakes, IDENTITY
    from test_transfer_pairs import _t, UID as FAKE_UID
    plain = _t("d1", ttype="debit", amount=40.0, date=D0, account_id="main", desc="To Jordan Blake", category="Other")
    card = _t("d2", ttype="debit", amount=41.0, date=D0, account_id="main", desc="To Jordan Blake ON 09 MAY CPM", category="Other")
    _review_fakes(monkeypatch, [plain, card], IDENTITY)
    flagged = asyncio.run(analytics._flagged_miscategorised(FAKE_UID))
    assert [t["_id"] for t in flagged] == ["d1"]  # the control is asked, the card purchase is not
