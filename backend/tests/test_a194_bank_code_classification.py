"""A194 phase 2: the bank code leads classification. DD is never an own
transfer (a card repayment only when its issuer matches a card on file); the
transfer rails are candidates only, with the G438/G440 name, pair and timing
rules still deciding; an absent code keeps today's behaviour. Invented data."""
from datetime import datetime

from test_g440_transfer_timing import ACCOUNTS, IDENTITY, KINDS, _pair, _classify
from test_g403_card_repayment_link import BANK, NOW, acct, link, row
from app.services.spending import find_own_move_ids, find_pending_transfer_ids
import app.routers.analytics as analytics


def _coded(pair, code):
    credit, debit = pair
    return {**credit, "bank_code": code if code != "DD" else "CR"}, {**debit, "bank_code": code}


def test_dd_with_a_name_and_a_pair_is_never_automatic_own():
    credit, debit = _coded(_pair(1885.0, "barclays", "hsbc", datetime(2026, 11, 3), datetime(2026, 11, 3)), "DD")
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [] and own == set() and pending == set()  # stays in Spend, never asked as own
    assert analytics._has_pair_evidence(credit, debit, IDENTITY) is False


def test_dd_from_an_issuer_matching_a_card_is_a_card_repayment():
    card = acct("nw", "natwest", "card", "9999")
    debit = {**row("d", "debit", "bank", 45.1, "NATWEST CARD"), "bank_code": "DD"}
    credit = row("c", "credit", "nw", 45.1, "CREDIT")  # no payment-received wording
    assert link([debit, credit], [BANK, card]) == [(credit, debit)]
    # without the bank code the same rows do not link (G403 route 3 is not loosened)
    plain = {k: v for k, v in debit.items() if k != "bank_code"}
    assert link([plain, credit], [BANK, card]) == []
    # a DD that names no issuer on file is not linked either
    other = {**debit, "description": "SOME UTILITY"}
    assert link([other, credit], [BANK, card]) == []


def test_fp_pair_with_a_name_within_24_hours_is_automatic():
    credit, debit = _coded(_pair(1885.0, "barclays", "hsbc", datetime(2026, 11, 3, 22, 10), datetime(2026, 11, 4, 20, 0)), "FP")
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [(credit, debit)] and own == {"d1"} and pending == set()
    from app.services.own_account_transfers import is_transfer_rail_candidate
    assert is_transfer_rail_candidate(debit)


def test_rail_code_alone_is_never_evidence():
    credit, debit = _coded(_pair(110.0, "hsbc", "barclays", datetime(2026, 11, 3), datetime(2026, 11, 3),
                                 debit_text="SHOP 1", credit_text="CREDIT"), "FP")
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [] and own == set()


def test_absent_code_keeps_the_same_behaviour():
    pair = _pair(1885.0, "barclays", "hsbc", datetime(2026, 11, 3), datetime(2026, 11, 3))
    def shape(result):
        return [[x["_id"] for x in p] for p in result[0]], result[1], result[2]

    plain = shape(_classify(*pair))
    coded_none = shape(_classify(*({**r, "bank_code": None} for r in pair)))
    assert plain == coded_none
    from app.services.own_account_transfers import is_transfer_rail_candidate
    assert plain[1] == {"d1"} and not is_transfer_rail_candidate(pair[1])


def test_cr_with_the_users_name_still_asks_three_days_apart():
    credit, debit = _coded(_pair(110.0, "hsbc", "barclays", datetime(2026, 11, 3, 9, 30), datetime(2026, 11, 6, 8, 0)), "FP")
    credit = {**credit, "bank_code": "CR"}
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [] and own == set() and pending == {"d1"}


# ── user answers override the bank code, both ways ────────────────────────────

def _dd_pair_rows():
    credit, debit = _pair(1885.0, "barclays", "hsbc", datetime(2026, 11, 3), datetime(2026, 11, 3))
    return {**credit, "bank_code": "CR"}, {**debit, "bank_code": "DD"}


def test_dd_linked_by_the_user_to_a_goal_or_account_is_an_own_move():
    for link_key, value in (("linked_goal_id", "g1"), ("linked_offline_account_id", "o1")):
        _credit, debit = _dd_pair_rows()
        debit = {**debit, link_key: value}
        assert find_own_move_ids([debit], KINDS, IDENTITY) == {"d1"}


def test_dd_with_a_user_custom_movement_category_is_respected():
    credit, debit = _dd_pair_rows()
    plain_dd = debit
    debit = {**debit, "custom_category": "Savings"}
    # a movement answer is never pulled back into Spend, and never asked again
    assert find_pending_transfer_ids([debit, credit], KINDS, IDENTITY) == set()
    from app.services.own_account_transfers import select_unique_pairs
    # a learned (user-confirmed) description pair is not blocked by the DD code
    from app.services.categorisation import canonical_merchant_key
    learned = {tuple(sorted((canonical_merchant_key("", credit["description"]), canonical_merchant_key("", debit["description"]))))}
    got = select_unique_pairs([credit, {**debit, "custom_category": None}], ACCOUNTS, [], learned)
    assert [(c["_id"], d["_id"]) for c, d in got] == [("c1", "d1")]
    # without any user answer the same DD pair is not selected
    assert select_unique_pairs([credit, plain_dd], ACCOUNTS, IDENTITY["name_tokens"], set()) == []


def test_dd_with_a_user_link_is_askable_evidence_not_blocked():
    credit, debit = _dd_pair_rows()
    assert analytics._has_pair_evidence(credit, {**debit, "linked_goal_id": "g1"}, IDENTITY) is True
    assert analytics._has_pair_evidence(credit, debit, IDENTITY) is False


# ── stale machine stamps ──────────────────────────────────────────────────────

def _reconcile(rows, accounts):
    import asyncio
    from app.services.own_account_transfers import reconcile_own_account_transfers

    class Cur:
        def __init__(s, r): s.r = r
        async def to_list(s, _): return list(s.r)

    class Col:
        def __init__(s, r): s.rows = r
        def find(s, q, _p=None):
            def ok(r):
                for k, v in q.items():
                    a = r.get(k)
                    if isinstance(v, dict):
                        if "$in" in v and a not in v["$in"]: return False
                        if "$gte" in v and a < v["$gte"]: return False
                        if "$ne" in v and a == v["$ne"]: return False
                        if "$exists" in v and (k in r) != v["$exists"]: return False
                    elif a != v: return False
                return True
            return Cur([r for r in s.rows if ok(r)])
        async def find_one(s, q, _p=None):
            return next((r for r in s.rows if all(r.get(k) == v for k, v in q.items())), None)
        async def update_one(s, q, u):
            for r in s.rows:
                if all(r.get(k) == v for k, v in q.items()):
                    before = dict(r)
                    r.update(u.get("$set") or {})
                    for k in u.get("$unset") or {}: r.pop(k, None)
                    return type("R", (), {"modified_count": int(before != r)})()
            return type("R", (), {"modified_count": 0})()

    async def mark(_u, *, reason): pass
    kw = {"transaction_collection": Col(rows), "account_collection": Col(list(accounts.values())),
          "pair_collection": Col([]),
          "profile_collection": Col([{"_id": "kevin", "name_tokens": IDENTITY["name_tokens"]}]),
          "preference_collection": Col([]), "mark_stale_fn": mark,
          "movement_categories": {"Savings", "Investment", "Debt", "Transfer"}}
    return asyncio.run(reconcile_own_account_transfers("kevin", **kw))


def _stamped_dd_pair(confirmed):
    from app.services.own_account_transfers import build_match_metadata
    now = datetime.utcnow()
    credit, debit = _dd_pair_rows()
    credit, debit = {**credit, "date": now, "user_id": "kevin"}, {**debit, "date": now, "user_id": "kevin"}
    accounts = {k: {**v, "user_id": "kevin", "currency": "GBP"} for k, v in ACCOUNTS.items()}
    credit["own_transfer_match"] = build_match_metadata(credit, debit, "Transfer", confirmed=confirmed)
    debit["own_transfer_match"] = build_match_metadata(debit, credit, "Transfer", confirmed=confirmed)
    credit["category"] = debit["category"] = "Transfer"
    return credit, debit, accounts


def test_reconcile_clears_a_stale_machine_stamp_on_a_dd_row():
    credit, debit, accounts = _stamped_dd_pair(confirmed=False)
    _reconcile([credit, debit], accounts)
    assert "own_transfer_match" not in debit and "own_transfer_match" not in credit
    assert debit["category"] == "Other"  # the pre-match category is restored


def test_reconcile_keeps_a_user_confirmed_stamp_on_a_dd_row():
    credit, debit, accounts = _stamped_dd_pair(confirmed=True)
    _reconcile([credit, debit], accounts)
    assert debit["own_transfer_match"]["confirmed"] and credit["own_transfer_match"]["confirmed"]
    assert debit["category"] == "Transfer"


# ── two cards, and ingestion ──────────────────────────────────────────────────

def test_dd_from_an_issuer_with_two_cards_on_file_does_not_link():
    c1, c2 = acct("c1", "natwest", "card", "1111"), acct("c2", "natwest", "card", "2222")
    debit = {**row("d", "debit", "bank", 70, "NATWEST CARD"), "bank_code": "DD"}
    credit = row("c", "credit", "c1", 70, "CREDIT")
    assert link([debit, credit], [BANK, c1, c2]) == []


def _ingest(txn, monkeypatch):
    import asyncio
    import app.services.finexer_sync as fs
    import app.services.own_account_transfers as oat
    from test_a183_counterparty import FakeAccounts, FakeTxns, OWN, UID
    store = FakeTxns()
    monkeypatch.setattr(fs, "transactions_col", store)
    monkeypatch.setattr(oat, "accounts_col", FakeAccounts(OWN))
    identity = {"name_tokens": [], "own_ids": set(), "own_map": {},
                "own_keys": {("300000", "11112222"): {"sav"}, ("200000", "12345678"): {"cur"}}}
    asyncio.run(fs._upsert_finexer_walk([txn], "cur", UID, identity, {"changed": False}))
    return store.docs[txn["id"]]


def test_ingestion_dd_never_sets_transfer_from_own_account_text_or_counterparty(monkeypatch):
    base = {"timestamp": "2026-11-05T09:30:00Z", "description": "FROM 30-00-00 11112222"}
    plain_credit = _ingest({**base, "id": "k1", "amount": 50}, monkeypatch)
    assert plain_credit["category"] == "Transfer"  # text match works without the code
    dd_credit = _ingest({**base, "id": "k2", "amount": 50, "metadata": {"bank_code": "DD"}}, monkeypatch)
    assert dd_credit["category"] != "Transfer" and dd_credit["bank_code"] == "DD"
    party = {"party_sort_code": "30-00-00", "party_number": "11112222", "description": "ACME", "timestamp": base["timestamp"]}
    plain_debit = _ingest({**party, "id": "k3", "amount": -50}, monkeypatch)
    assert plain_debit["category"] in ("Savings", "Transfer", "Debt")
    dd_debit = _ingest({**party, "id": "k4", "amount": -50, "metadata": {"bank_code": "DD"}}, monkeypatch)
    assert dd_debit["category"] not in ("Savings", "Transfer", "Debt")
    assert "custom_category" not in dd_debit or dd_debit["custom_category"] is None
