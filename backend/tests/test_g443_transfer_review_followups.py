"""G443 (Kevin 2026-11-09): follow-ups from the prod transfers review after G442.

Built from the exact SHAPES of the rows on the board note (cases a to e), with
invented names, amounts and tails. The model is ALWAYS mocked
(`own_transfer_judge._call_model`); nothing here reaches OpenRouter. Judge and
reconcile tests run against the suite's disposable Mongo database through the
G442 harness (per-test client, every module handle repointed).

  a  vendor purchases are pruned before the model and before the review
  b  a card repayment is filed as Debt, not asked, not sent
  c  the HSBC to NatWest pair (91 days old) is judged, reaches the model, is filed
  d  a reason that says neither leg fits becomes not_transfer; the CPM card
     purchase never reaches the model
  e  first occurrences of a filed series are filed; a middle-of-history orphan is asked
  v  the prompt version re-judges old verdicts; counts reach the health reader
"""
import json
from datetime import datetime, timedelta

import pytest

import app.routers.analytics as analytics
import app.services.categorisation as categorisation
import app.services.own_account_transfers as oat
import app.services.own_transfer_judge as judge
import app.services.transfer_pruning as pruning
from app.services.spending import find_pending_transfer_ids

from test_g442_ai_transfer_judgement import (  # noqa: F401  (the G442 harness, reused)
    KINDS, TOKENS, UID, _arun, _async, _row, _series_rows, _stamped, mongo_env, SERIES,
)

NOW = datetime.utcnow()  # naive-ok: Mongo booked dates are naive UTC; ages below are relative to now

# Accounts shaped like the review rows. Revolut and Starling hold the incoming legs.
ACCTS = [
    {"_id": "natw", "user_id": UID, "name": "Main", "provider": "NatWest", "type": "current", "currency": "GBP"},
    {"_id": "barc", "user_id": UID, "name": "Everyday", "provider": "Barclays", "type": "current", "currency": "GBP"},
    {"_id": "hsbc", "user_id": UID, "name": "Advance", "provider": "HSBC", "type": "current", "currency": "GBP"},
    {"_id": "revo", "user_id": UID, "name": "Revolut Spend", "provider": "Revolut", "type": "current", "currency": "GBP"},
    {"_id": "star", "user_id": UID, "name": "Starling Joint", "provider": "Starling", "type": "current", "currency": "GBP"},
    {"_id": "monz", "user_id": UID, "name": "Monzo Main", "provider": "Monzo", "type": "current", "currency": "GBP"},
    {"_id": "chcc", "user_id": UID, "name": "Chase Credit Card", "provider": "Chase", "type": "credit_card", "currency": "GBP"},
    {"_id": "ncc1", "user_id": UID, "name": "NatWest Mastercard 7788", "provider": "NatWest", "type": "credit_card", "currency": "GBP"},
    {"_id": "ncc2", "user_id": UID, "name": "NatWest Platinum 5566", "provider": "NatWest", "type": "credit_card", "currency": "GBP"},
]
BY_ID = {a["_id"]: a for a in ACCTS}


def _pairs(rows, learned=None):
    return oat.ai_candidate_pairs(rows, BY_ID, TOKENS, learned or set(), movement_categories={"Transfer"})


def _ids(pairs):
    return {(c["_id"], d["_id"]) for c, d in pairs}


class ScriptedModel:
    """Answers each pair by a rule over its payload; records every prompt."""

    def __init__(self, rule):
        self.rule = rule
        self.calls: list[str] = []

    async def __call__(self, prompt, uid, n_pairs):
        self.calls.append(prompt)
        items = [json.loads(line) for line in prompt.split("Pairs:\n", 1)[1].splitlines()]
        return json.dumps({str(i["n"]): dict(zip(("verdict", "reason"), self.rule(i))) for i in items}), "ok"

    @property
    def sent(self):
        return "\n".join(self.calls)


# ── (a) vendor purchases pruned ─────────────────────────────────────────────

D0 = datetime(2026, 10, 29, 9, 0)


def test_the_four_vendor_purchase_shapes_are_pruned_before_the_model():
    rows = [
        # Chase card purchase against a Revolut credit "Payment from <name>"
        _row("a1-d", "debit", 20.0, "chcc", D0, "THATCHED HOUSE", category="Eating Out"),
        _row("a1-c", "credit", 20.0, "revo", D0 + timedelta(days=1), "Payment from Hartley J E"),
        # NatWest EE LIMITED (bank named the merchant) against Barclays "<name> Sent from Revolut BGC"
        _row("a2-d", "debit", 20.0, "natw", D0, "EE LIMITED", merchant_name="EE Limited", category="Mobile"),
        _row("a2-c", "credit", 20.0, "barc", D0 + timedelta(days=2), "Jordan Hartley Sent from Revolut BGC"),
        # the same EE debit one month on, against a Starling credit with just the name
        _row("a3-d", "debit", 21.0, "natw", D0, "EE LIMITED", category="Bills"),
        _row("a3-c", "credit", 21.0, "star", D0 + timedelta(days=2), "Jordan Hartley"),
        # Monzo card spend "Byond Card" against NatWest "HARTLEY J E MAIN FP"
        _row("a4-d", "debit", 22.0, "monz", D0, "Byond Card", merchant_name="Byond"),
        _row("a4-c", "credit", 22.0, "natw", D0 + timedelta(days=2), "HARTLEY J E MAIN FP 10/08/26"),
        # control: a real pair still reaches the model
        _row("ok-d", "debit", 23.0, "barc", D0, "JORDAN HARTLEY HSBC STO"),
        _row("ok-c", "credit", 23.0, "hsbc", D0 + timedelta(days=2), "HARTLEY J E HSBC"),
    ]
    assert _ids(_pairs(rows)) == {("ok-c", "ok-d")}
    legs = {"a1-d": (rows[1], rows[0]), "a2-d": (rows[3], rows[2]), "a3-d": (rows[5], rows[4]), "a4-d": (rows[7], rows[6])}
    reasons = {k: pruning.pair_pruned_reason(c, d, BY_ID) for k, (c, d) in legs.items()}
    assert reasons == {"a1-d": "card_purchase", "a2-d": "business", "a3-d": "business", "a4-d": "business"}


def test_a_card_purchase_marker_prunes_a_debit_by_whole_token_only():
    barclays_cpm = _row("c-d", "debit", 5.0, "barc", D0, "RENEWAL ON 23 AUG CPM")
    credit = _row("c-c", "credit", 5.0, "hsbc", D0 + timedelta(days=1), "Jordan Hartley Sent from Revolut")
    assert pruning.pair_pruned_reason(credit, barclays_cpm, BY_ID) == "card_purchase"
    # the marker alone prunes it: the credit names no one
    plain_credit = _row("p-c", "credit", 5.0, "hsbc", D0 + timedelta(days=1), "Jordan Hartley")
    assert pruning.pair_pruned_reason(plain_credit, barclays_cpm, BY_ID) == "card_purchase"
    # whole tokens only: CPMX or a word that merely contains the letters is no marker
    assert not pruning.is_card_purchase_text("DEPOT CPMX LTD")
    assert not pruning.is_card_purchase_text("JORDAN HARTLEY HSBC STO")
    # other markers the codebase already knows, and a bank code for card spend
    for text in ("COSTA ON 16 JUL CLP", "KFC ON 25 MAY CNP", "VANGUARD ON 28 FEB BCC"):
        assert pruning.is_card_purchase_text(text)
    assert pruning.pair_pruned_reason(plain_credit, _row("pos", "debit", 5.0, "barc", D0, "SHOP", bank_code="POS"), BY_ID) == "card_purchase"
    # a transfer rail is never read as business by the merchant or category tests
    sto = _row("sto", "debit", 5.0, "barc", D0, "RENT", merchant_name="Landlord", category="Rent", bank_code="STO")
    assert pruning.pair_pruned_reason(plain_credit, sto, BY_ID) is None


def test_cpm_pair_never_reaches_the_model_and_is_not_asked(monkeypatch):
    rows = [_row("c-d", "debit", 5.0, "barc", D0, "RENEWAL ON 23 AUG CPM"),
            _row("c-c", "credit", 5.0, "hsbc", D0 + timedelta(days=1), "Jordan Hartley"),  # names no institution: only CPM prunes it
            _row("ok-d", "debit", 23.0, "barc", D0, "JORDAN HARTLEY HSBC STO"),
            _row("ok-c", "credit", 23.0, "hsbc", D0 + timedelta(days=2), "HARTLEY J E HSBC")]
    model = ScriptedModel(lambda i: ("same_transfer", "Standing order out names the other bank."))
    monkeypatch.setattr(judge, "_call_model", model)

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS) as cols:
            await judge.judge_user(UID)
            sent_pairs = model.sent.split("Pairs:\n", 1)[1]
            assert "RENEWAL" not in sent_pairs and "CPM" not in sent_pairs and "JORDAN HARTLEY HSBC STO" in sent_pairs
            assert await cols["own_transfer_judgements"].count_documents({"ids": ["c-c", "c-d"]}) == 0
            identity = await categorisation.user_identity(UID)
            monkeypatch.setattr(analytics, "user_identity", lambda uid: _async(identity))
            assert [i["debit"]["id"] for i in await analytics._transfer_pair_suggestions(UID)] == []
    _arun(run())


def test_third_institution_prunes_but_the_receiving_or_sending_bank_never_does():
    barc_debit = _row("d", "debit", 20.0, "barc", D0, "JORDAN HARTLEY STO")
    natw_debit = _row("d2", "debit", 20.0, "natw", D0, "JORDAN HARTLEY STO")
    # "Sent from Revolut" on a Barclays credit, money left NatWest: Revolut is neither leg's bank
    sent = _row("c1", "credit", 20.0, "barc", D0, "Jordan Hartley Sent from Revolut BGC")
    assert pruning.pair_pruned_reason(sent, natw_debit, BY_ID) == "third_institution"
    # the named bank is the debit's bank (the sender): never pruned
    assert pruning.pair_pruned_reason(_row("c2", "credit", 20.0, "barc", D0, "From NatWest J Hartley"), natw_debit, BY_ID) is None
    # the named bank is the credit's own bank (the receiver): never pruned (the HSBC to NatWest pair)
    own = _row("c3", "credit", 20.0, "natw", D0, "HARTLEY J E NATWEST FP 10/08/26 1106")
    assert pruning.pair_pruned_reason(own, _row("d3", "debit", 20.0, "hsbc", D0, "Jordan Hartley Natwest"), BY_ID) is None
    # nothing named: never pruned
    assert pruning.pair_pruned_reason(_row("c4", "credit", 20.0, "barc", D0, "Jordan Hartley"), natw_debit, BY_ID) is None
    # an unknown debit bank cannot be "different": never pruned
    unknown = {**BY_ID, "natw": {**BY_ID["natw"], "provider": "Obscure Credit Union", "name": "Savings"}}
    assert pruning.pair_pruned_reason(sent, natw_debit, unknown) is None
    # whole words only
    assert pruning.institutions_named("PURCHASE REVOLUTIONARY") == frozenset()
    assert pruning.institutions_named("Sent from Revolut") == frozenset({"revolut"})
    del barc_debit


def test_the_users_answer_beats_every_prune():
    d = _row("d", "debit", 5.0, "barc", D0, "RENEWAL ON 23 AUG CPM", custom_category="Transfer")
    c = _row("c", "credit", 5.0, "hsbc", D0, "Jordan Hartley Sent from Revolut")
    assert pruning.pair_pruned_reason(c, d, BY_ID) is None
    linked = _row("d2", "debit", 5.0, "barc", D0, "SHOP CPM", linked_goal_id="g1")
    assert pruning.pair_pruned_reason(c, linked, BY_ID) is None
    # and a learned pair (the user confirmed it once) is never pruned by the builder
    d3 = _row("d3", "debit", 20.0, "natw", D0, "EE LIMITED", merchant_name="EE Limited", category="Mobile")
    c3 = _row("c3", "credit", 20.0, "barc", D0 + timedelta(days=2), "Jordan Hartley")
    keys = tuple(sorted((categorisation.canonical_merchant_key("", "Jordan Hartley"),
                         categorisation.canonical_merchant_key("EE Limited", "EE LIMITED"))))
    assert _pairs([d3, c3]) == []
    detailed = oat.select_unique_pairs_detailed([d3, c3], BY_ID, TOKENS, {keys}, movement_categories={"Transfer"})
    assert [(c["_id"], d["_id"]) for c, d, _ in detailed] == [("c3", "d3")]


def test_the_prune_is_the_same_in_the_review_gate_and_in_spend():
    """G438: a pair that leaves Spend must be one the review asks. A pruned pair is
    neither, so it stays in Spend as spend, in the review gate and in the Spend scan."""
    meta = {k: {f: v.get(f) for f in ("provider", "name", "type")} for k, v in BY_ID.items()}
    identity = {"name_tokens": TOKENS, "own_ids": set(), "own_map": {}, "account_meta": meta}
    d = _row("d", "debit", 20.0, "natw", D0, "EE LIMITED", merchant_name="EE Limited", category="Mobile")
    # two days apart and named: on origin/main this is a pending pair the review asks and Spend leaves out
    c = _row("c", "credit", 20.0, "barc", D0 + timedelta(days=2), "Jordan Hartley Sent from Revolut BGC")
    assert analytics._has_pair_evidence(c, d, identity) is False
    assert find_pending_transfer_ids([c, d], KINDS, identity) == set()
    # the same legs with no bank facts against them are still asked (control)
    d2 = {**d, "merchant_name": None, "category": "Other", "description": "JORDAN HARTLEY HSBC STO"}
    c2 = {**c, "account_id": "hsbc", "description": "HARTLEY J E HSBC"}
    assert analytics._has_pair_evidence(c2, d2, identity) is True


# ── (b) card repayment ──────────────────────────────────────────────────────

def _repay_rows(tail="7788", when=None, text="NATWEST"):
    when = when or datetime(2026, 7, 31)
    return [_row("r-d", "debit", 61.78, "natw", when, text, category="Other"),
            _row("r-c", "credit", 61.78, "ncc1", when, f"DIRECT DEBIT PAYMENT {tail}", category="Income")]


def test_same_bank_card_repayment_is_filed_as_debt_not_asked_not_sent(monkeypatch):
    rows = _repay_rows()
    assert _pairs(rows) == [], "a card repayment is never a model candidate"
    detailed = oat.select_unique_pairs_detailed(rows, BY_ID, TOKENS, set(), movement_categories={"Transfer"})
    assert [(c["_id"], d["_id"], i) for c, d, i in detailed] == [("r-c", "r-d", "natwest")]
    # two NatWest cards: the credit prints THIS card's tail (read from its name, no number stored) and
    # the same credit printing the OTHER card's tail is that card's payment, never linked to this one
    assert oat.select_unique_pairs_detailed(_repay_rows(tail="5566"), BY_ID, TOKENS, set(), movement_categories={"Transfer"}) == []
    # a tail that is nobody's, or no tail at all, with two cards of the issuer: ambiguous, never linked
    for ambiguous in (_repay_rows(tail="9999"), [_row("r-d", "debit", 61.78, "natw", datetime(2026, 7, 31), "NATWEST"),
                                                 _row("r-c", "credit", 61.78, "ncc1", datetime(2026, 7, 31), "DIRECT DEBIT PAYMENT")]):
        assert oat.select_unique_pairs_detailed(ambiguous, BY_ID, TOKENS, set(), movement_categories={"Transfer"}) == []

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS) as cols:
            model = ScriptedModel(lambda i: ("same_transfer", "never called"))
            monkeypatch.setattr(judge, "_call_model", model)
            await judge.judge_user(UID)
            assert model.calls == []
            await oat.reconcile_own_account_transfers(UID)
            debit = await cols["transactions"].find_one({"_id": "r-d"})
            credit = await cols["transactions"].find_one({"_id": "r-c"})
            assert debit["category"] == "Debt" and credit["category"] == "Transfer"
            assert debit["own_transfer_match"]["card_repayment"] == {"issuer": "natwest", "card_account_id": "ncc1"}
            identity = await categorisation.user_identity(UID)
            monkeypatch.setattr(analytics, "user_identity", lambda uid: _async(identity))
            assert await analytics._transfer_pair_suggestions(UID) == []
    _arun(run())


def test_the_card_repayment_respects_the_users_answers_and_other_cards():
    # a user's own category on the debit stands
    rows = _repay_rows()
    rows[0]["custom_category"] = "Groceries"
    assert oat.select_unique_pairs_detailed(rows, BY_ID, TOKENS, set(), movement_categories={"Transfer"}) == []
    # a second same-amount debit from a non-card account makes the money ambiguous
    rows = _repay_rows() + [_row("x-d", "debit", 61.78, "barc", datetime(2026, 7, 31), "SOMETHING")]
    assert oat.select_unique_pairs_detailed(rows, BY_ID, TOKENS, set(), movement_categories={"Transfer"}) == []
    # a debit that does not name the bank is not THIS rule (no bank evidence). G381 (Kevin 2026-10-31) adds the
    # card account type route: a card credit with payment wording, this card's own tail and ONE debit of the
    # amount is that card's repayment even when the debit names nobody (see test_g381_card_repayment_rule.py),
    # so the negative case here is a credit WITHOUT payment wording.
    no_wording = _repay_rows(text="TRANSFER")
    no_wording[1]["description"] = "CARD CREDIT 7788"
    assert oat.select_unique_pairs_detailed(no_wording, BY_ID, TOKENS, set(), movement_categories={"Transfer"}) == []
    assert [i for _, _, i in oat.select_unique_pairs_detailed(_repay_rows(text="TRANSFER"), BY_ID, TOKENS, set(), movement_categories={"Transfer"})] == ["natwest"]


# ── (c) the HSBC to NatWest pair ────────────────────────────────────────────

def test_the_hsbc_to_natwest_pair_is_judged_even_past_ninety_days_and_filed(monkeypatch):
    day = (NOW - timedelta(days=91)).replace(hour=0, minute=0, second=0, microsecond=0)
    rows = [_row("h-d", "debit", 40.0, "hsbc", day, "Jordan Hartley Natwest"),
            _row("h-c", "credit", 40.0, "natw", day, "HARTLEY J E NATWEST FP 10/08/26 1106")]
    model = ScriptedModel(lambda i: ("same_transfer", "Debit names NatWest and the credit is the NatWest faster payment."))
    monkeypatch.setattr(judge, "_call_model", model)

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS) as cols:
            todo, _ = await judge._candidates(UID)
            assert [(c["_id"], d["_id"]) for c, d in todo] == [("h-c", "h-d")], "a 91 day old pair is a candidate"
            result = await judge.judge_user(UID)
            assert result["judged"] == 1 and len(model.calls) == 1
            assert "NATWEST FP" in model.calls[0]
            await oat.reconcile_own_account_transfers(UID)
            stamped = await _stamped(cols)
            assert stamped["h-d"]["own_transfer_match"]["source"] == "ai" and stamped["h-c"]["category"] == "Transfer"
    _arun(run())


def test_naming_the_receiving_bank_is_not_penalised_by_the_prompt():
    prompt = judge.build_prompt([{"n": 1}])
    assert "names a different bank from the other record" not in prompt
    assert "Naming either account's own bank is normal" in prompt
    assert "third institution" in prompt


# ── (d) the model's reason decides ──────────────────────────────────────────

def test_an_unclear_whose_reason_says_neither_fits_is_not_transfer():
    ok = judge.parse_response(json.dumps({"1": {"verdict": "unclear",
                                               "reason": "The debit is a renewal at a merchant and the credit came from Revolut, so neither leg is this transfer."}}), [1])
    assert ok[1]["verdict"] == "not_transfer" and ok[1]["fallback"] is False
    for phrase in ("The two payments are unrelated.", "Nothing links the two records.", "They are separate payments.",
                   "Neither record fits a transfer between these accounts."):
        out = judge.parse_response(json.dumps({"1": {"verdict": "unclear", "reason": phrase}}), [1])
        assert out[1]["verdict"] == "not_transfer", phrase
    # thin evidence stays unclear, and so does a bank name nobody can read
    for phrase in ("Neither record names the other bank, so the evidence is thin.", "The credit names Revolut, which is not on file."):
        out = judge.parse_response(json.dumps({"1": {"verdict": "unclear", "reason": phrase}}), [1])
        assert out[1]["verdict"] == "unclear", phrase
    # a same_transfer is never downgraded by the phrase check
    same = judge.parse_response(json.dumps({"1": {"verdict": "same_transfer", "reason": "Neither leg is a purchase, the standing order fits."}}), [1])
    assert same[1]["verdict"] == "same_transfer"
    assert "never unclear" in judge.RULES and "Every answer carries a reason" in judge.RULES


def test_an_unclear_without_a_reason_is_asked_with_a_fallback_line(monkeypatch):
    out = judge.parse_response(json.dumps({"1": {"verdict": "unclear"}}), [1])
    assert out[1]["verdict"] == "unclear" and out[1]["reason"] == oat.UNCLEAR_FALLBACK_REASON == "Sorted could not decide."
    assert "—" not in oat.UNCLEAR_FALLBACK_REASON

    rows = [_row("u-d", "debit", 30.0, "barc", D0, "JORDAN HARTLEY STO"),
            _row("u-c", "credit", 30.0, "hsbc", D0 + timedelta(days=2), "JORDAN HARTLEY BGC")]

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS) as cols:
            # an older stored unclear that carries no reason still shows the fallback line
            await cols["own_transfer_judgements"].insert_one(
                {"_id": f"{UID}::u-c:u-d", "user_id": UID, "kind": "pair", "ids": ["u-c", "u-d"],
                 "verdict": "unclear", "reason": None, "signature": "x", "series_sig": "y"})
            identity = await categorisation.user_identity(UID)
            monkeypatch.setattr(analytics, "user_identity", lambda uid: _async(identity))
            items = await analytics._transfer_pair_suggestions(UID)
            assert len(items) == 1 and items[0]["ai_reason"] == "Sorted could not decide."
    _arun(run())


def test_a_not_transfer_from_the_reason_check_leaves_the_pair_unasked(monkeypatch):
    rows = [_row("n-d", "debit", 5.0, "barc", D0, "SOME RENEWAL ON 23 AUG"),
            _row("n-c", "credit", 5.0, "hsbc", D0 + timedelta(days=1), "JORDAN HARTLEY")]
    model = ScriptedModel(lambda i: ("unclear", "The debit is a renewal at a merchant, so neither leg fits this transfer."))
    monkeypatch.setattr(judge, "_call_model", model)

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS) as cols:
            await judge.judge_user(UID)
            doc = await cols["own_transfer_judgements"].find_one({"kind": "pair"})
            assert doc["verdict"] == "not_transfer"
            identity = await categorisation.user_identity(UID)
            monkeypatch.setattr(analytics, "user_identity", lambda uid: _async(identity))
            assert await analytics._transfer_pair_suggestions(UID) == []
    _arun(run())


# ── (e) first occurrences of a filed series ─────────────────────────────────

def _series_history(month_range):
    return _series_rows(month_range, series={"hsbc": SERIES["hsbc"]})


def _first_leg(id_, when, **extra):
    return _row(id_, "debit", 1885.0, "barc", when, "JORDAN HARTLEY HSBC STO 31/07/26", **extra)


def test_first_occurrence_of_a_filed_series_is_filed_and_a_middle_orphan_is_asked(monkeypatch):
    base = _series_history([1, 2, 3])  # months 1 to 3 pair up and are filed by the model
    # hsbc's earliest row is the month 1 credit; barc's month 0 debit has its credit before that
    start = datetime(2026, 8, 31) + timedelta(days=30)
    first = _first_leg("first-d", start - timedelta(days=30))
    # a same-description leg in the MIDDLE of history, where its credit should exist
    orphan = _first_leg("mid-d", start + timedelta(days=45))
    model = ScriptedModel(lambda i: ("same_transfer", "Standing order out names the other bank."))
    monkeypatch.setattr(judge, "_call_model", model)

    async def run():
        async with mongo_env(monkeypatch, base + [first, orphan]) as cols:
            await judge.judge_user(UID)
            await oat.reconcile_own_account_transfers(UID)
            stamped = await _stamped(cols)
            f = stamped["first-d"]
            assert f["own_transfer_match"]["series_single"] is True and f["category"] == "Transfer"
            assert "counterpart_id" not in f["own_transfer_match"]
            assert "mid-d" not in stamped, "an orphan in the middle of history is still a question"
            assert (await cols["transactions"].find_one({"_id": "mid-d"}))["category"] == "Other"
            # idempotent, and the pair rows are untouched
            assert await oat.reconcile_own_account_transfers(UID) == 0
            # readers keep the stamped category (the marker has no counterpart row to check)
            rows = await cols["transactions"].find({}).to_list(None)
            resolved = {r["_id"]: r for r in oat.resolve_transfer_evidence(rows, {"Transfer"})}
            assert resolved["first-d"]["category"] == "Transfer" and "own_transfer_match" in resolved["first-d"]
            # the review does not ask about it
            identity = await categorisation.user_identity(UID)
            monkeypatch.setattr(analytics, "user_identity", lambda uid: _async(identity))
            assert all(i["debit"]["id"] != "first-d" for i in await analytics._transfer_pair_suggestions(UID))
    _arun(run())


def test_series_singles_follow_the_users_answers_and_need_a_filed_series(monkeypatch):
    start = datetime(2026, 8, 31) + timedelta(days=30)
    base = _series_history([1, 2, 3])
    answered = _first_leg("ans-d", start - timedelta(days=30), custom_category="Groceries")
    dismissed = _first_leg("dis-d", start - timedelta(days=31))
    other_series = _row("oth-d", "debit", 77.0, "barc", start - timedelta(days=30), "JORDAN HARTLEY HSBC STO")
    model = ScriptedModel(lambda i: ("same_transfer", "Standing order out names the other bank."))
    monkeypatch.setattr(judge, "_call_model", model)

    async def run():
        async with mongo_env(monkeypatch, base + [answered, dismissed, other_series]) as cols:
            await cols["preferences"].update_one({"user_id": UID}, {"$set": {"dismissed_miscategorised": ["dis-d"]}})
            await judge.judge_user(UID)
            await oat.reconcile_own_account_transfers(UID)
            stamped = await _stamped(cols)
            assert not ({"ans-d", "dis-d", "oth-d"} & set(stamped))
    _arun(run())


def test_series_single_legs_pure_rule_near_start_only():
    first_b = datetime(2026, 10, 1)
    b_rows = [_row("b0", "credit", 7.0, "hsbc", first_b, "OTHER THING")]
    ev = [{"account_id": "barc", "other_account_id": "hsbc", "transaction_type": "debit",
           "pair_key": ("GBP", oat._pair_key(_row("t", "debit", 50.0, "barc", first_b, "x"))[1]),
           "text_key": oat.transfer_text_key(None, "MONTHLY STO"), "category": "Transfer"}]
    near = _row("near", "debit", 50.0, "barc", first_b - timedelta(days=20), "MONTHLY STO 11/09/26")
    edge = _row("edge", "debit", 50.0, "barc", first_b + timedelta(days=oat.SERIES_SINGLE_MARGIN_DAYS - 1), "MONTHLY STO")
    late = _row("late", "debit", 50.0, "barc", first_b + timedelta(days=oat.SERIES_SINGLE_MARGIN_DAYS + 1), "MONTHLY STO")
    got = oat.series_single_legs(ev, {"barc": [near, edge, late], "hsbc": b_rows})
    assert [r["_id"] for r, _ in got] == ["near", "edge"]
    # a possible counterpart inside the ask window hands the leg to the pair rules
    counterpart = _row("cp", "credit", 50.0, "hsbc", first_b, "ANYTHING")
    assert [r["_id"] for r, _ in oat.series_single_legs(ev, {"barc": [edge], "hsbc": [counterpart]})] == []
    # a direct debit is never filed here
    dd = _row("dd", "debit", 50.0, "barc", first_b - timedelta(days=20), "MONTHLY STO", bank_code="DD")
    assert oat.series_single_legs(ev, {"barc": [dd], "hsbc": b_rows}) == []


# ── (v) cache version and counts ────────────────────────────────────────────

def _unclear_pair_rows():
    return [_row("u-d", "debit", 30.0, "barc", D0, "JORDAN HARTLEY STO"),
            _row("u-c", "credit", 30.0, "hsbc", D0 + timedelta(days=2), "JORDAN HARTLEY BGC")]


def test_a_verdict_from_an_older_prompt_is_judged_once_more_and_counts_against_the_cap(monkeypatch):
    model = ScriptedModel(lambda i: ("unclear", "The evidence is thin."))
    monkeypatch.setattr(judge, "_call_model", model)

    async def run():
        async with mongo_env(monkeypatch, _unclear_pair_rows(), accounts=ACCTS) as cols:
            await judge.judge_user(UID)
            doc = await cols["own_transfer_judgements"].find_one({"kind": "pair"})
            assert doc["prompt_version"] == judge.PROMPT_VERSION
            assert len(model.calls) == 1
            await judge.judge_user(UID)
            assert len(model.calls) == 1, "same version: the cache holds"
            sent_before = await judge.pairs_sent_this_month(UID)
            # stamp it as the G442 prompt's verdict (no stamp = version 1)
            await cols["own_transfer_judgements"].update_one({"_id": doc["_id"]}, {"$unset": {"prompt_version": ""}})
            again = await judge.judge_user(UID)
            assert again["judged"] == 1 and len(model.calls) == 2, "stale verdict rejudged"
            assert (await cols["own_transfer_judgements"].find_one({"_id": doc["_id"]}))["prompt_version"] == judge.PROMPT_VERSION
            assert await judge.pairs_sent_this_month(UID) == sent_before + 1
    _arun(run())


def test_stale_same_transfer_and_user_answers_are_never_discarded(monkeypatch):
    model = ScriptedModel(lambda i: ("same_transfer", "Standing order out names the other bank."))
    monkeypatch.setattr(judge, "_call_model", model)

    async def run():
        async with mongo_env(monkeypatch, _series_rows([0], series={"hsbc": SERIES["hsbc"]}) + _unclear_pair_rows(), accounts=ACCTS + [
                {"_id": "barc2", "user_id": UID, "name": "x", "provider": "Barclays", "type": "current", "currency": "GBP"}]) as cols:
            await judge.judge_user(UID)
            calls = len(model.calls)
            docs = await cols["own_transfer_judgements"].find({"kind": "pair"}).to_list(None)
            for d in docs:
                await cols["own_transfer_judgements"].update_one({"_id": d["_id"]}, {"$unset": {"prompt_version": ""}})
            # a stale same_transfer stays (already filed, only the user undoes it)
            await judge.judge_user(UID)
            assert len(model.calls) == calls
            # an undo marker and its overridden verdicts are the user's, never judged again
            listed = await judge.list_auto_filed(UID)
            await judge.undo_series(UID, listed[0]["series_key"])
            await cols["own_transfer_judgements"].update_many({"kind": "pair"}, {"$unset": {"prompt_version": ""}})
            await judge.judge_user(UID)
            assert len(model.calls) == calls
            overridden = await cols["own_transfer_judgements"].find({"user_override": True}).to_list(None)
            assert overridden and await cols["own_transfer_judgements"].count_documents({"kind": "undo"}) == 1
    _arun(run())


def test_an_old_backfill_marker_runs_the_backfill_once_more(monkeypatch):
    model = ScriptedModel(lambda i: ("unclear", "The evidence is thin."))
    monkeypatch.setattr(judge, "_call_model", model)

    async def run():
        async with mongo_env(monkeypatch, _unclear_pair_rows(), accounts=ACCTS) as cols:
            await cols["own_transfer_judgements"].insert_one({"_id": f"{UID}::backfill", "user_id": UID, "kind": "backfill"})
            assert await judge.backfill_done(UID) is False, "no stamp is version 1: not done for this prompt"
            await judge.run_for_user(UID)
            assert await judge.backfill_done(UID) is True
            doc = await cols["own_transfer_judgements"].find_one({"_id": f"{UID}::backfill"})
            assert doc["prompt_version"] == judge.PROMPT_VERSION
    _arun(run())


def test_run_counts_reach_the_health_reader_as_counts_only(monkeypatch):
    rows = _unclear_pair_rows() + [
        _row("w-d", "debit", 31.0, "barc", D0, "JORDAN HARTLEY STO"), _row("w-c", "credit", 31.0, "hsbc", D0 + timedelta(days=2), "JORDAN HARTLEY BGC"),
        _row("x-d", "debit", 32.0, "barc", D0, "JORDAN HARTLEY STO"), _row("x-c", "credit", 32.0, "hsbc", D0 + timedelta(days=2), "JORDAN HARTLEY BGC")]
    model = ScriptedModel(lambda i: ("unclear", "The evidence is thin."))
    monkeypatch.setattr(judge, "_call_model", model)

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS) as cols:
            monkeypatch.setenv("OWN_TRANSFER_JUDGE_MONTHLY_PAIR_CAP", "2")
            result = await judge.judge_user(UID)
            assert result["judged"] == 2 and result["skipped_cap"] == 1
            health = await judge.last_run_health()
            assert health["ok"] and health["candidates"] == 3 and health["judged"] == 2 and health["skipped_cap"] == 1
            assert health["prompt_version"] == judge.PROMPT_VERSION and health["runs"] == 1 and health["last_run_at"]
            assert not ({"user_id", "ids", "description", "reason"} & set(health)), "aggregate counts only"
            # next run: the cap is spent
            again = await judge.judge_user(UID)
            assert again["status"] == "capped"
            assert (await judge.last_run_health())["capped_users"] == 1
    _arun(run())


def test_the_ops_health_route_carries_the_judge_counts():
    import inspect
    import app.routers.ops as ops
    source = inspect.getsource(ops.ops_health)
    assert "last_run_health" in source and '"transfer_judge"' in source


def test_hedged_reasons_stay_unclear_and_a_plain_finding_still_downgrades():
    for hedged in ("Not clearly unrelated, the evidence is thin.",
                   "Cannot say whether the payments are related or unrelated.",
                   "Could be a separate payment to a different payee, or a transfer."):
        out = judge.parse_response(json.dumps({"1": {"verdict": "unclear", "reason": hedged}}), [1])
        assert out[1]["verdict"] == "unclear", hedged
    out = judge.parse_response(json.dumps({"1": {"verdict": "unclear", "reason": "Neither record fits this transfer."}}), [1])
    assert out[1]["verdict"] == "not_transfer"


def test_a_credit_naming_a_bank_is_not_pruned_when_its_own_account_has_no_known_bank():
    unknown = {**BY_ID, "barc": {**BY_ID["barc"], "provider": "Obscure Credit Union", "name": "Savings"}}
    debit = _row("d", "debit", 20.0, "natw", D0, "JORDAN HARTLEY STO")
    credit = _row("c", "credit", 20.0, "barc", D0, "Jordan Hartley Sent from Revolut BGC")
    assert pruning.pair_pruned_reason(credit, debit, BY_ID) == "third_institution"
    assert pruning.pair_pruned_reason(credit, debit, unknown) is None


def test_nwb_and_bank_name_variants_map_to_their_institution():
    assert pruning.institutions_named("Sent from NWB") == frozenset({"natwest"})
    assert pruning.account_institutions({"provider": "HSBC UK"}) == frozenset({"hsbc"})
    assert pruning.account_institutions({"provider": "Monzo Bank"}) == frozenset({"monzo"})
    assert pruning.account_institutions({"provider": "RBS"}) == frozenset({"natwest"})


def test_the_review_gate_ignores_pairs_older_than_the_history_window(monkeypatch):
    old = NOW - timedelta(days=oat.HISTORY_DAYS + 5)
    recent = NOW - timedelta(days=20)
    rows = []
    for tag, day in (("old", old), ("new", recent)):
        rows += [_row(f"{tag}-d", "debit", 41.0, "barc", day, "JORDAN HARTLEY HSBC STO"),
                 _row(f"{tag}-c", "credit", 41.0, "hsbc", day + timedelta(days=2), "HARTLEY J E HSBC")]

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS):
            identity = await categorisation.user_identity(UID)
            monkeypatch.setattr(analytics, "user_identity", lambda uid: _async(identity))
            items = await analytics._transfer_pair_suggestions(UID)
            assert [i["debit"]["id"] for i in items] == ["new-d"]
    _arun(run())
