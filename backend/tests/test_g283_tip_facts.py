"""G283: tips state facts only. No saving is claimed or estimated, nothing is
recommended, and no product is named as the best option (Kevin, 2026-10-17).

No network and no real database: the shared research layer is a fake, the
collections are in-memory, and Tavily and OpenRouter are never called.
"""
import asyncio
import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

import app.routers.analytics as analytics
import app.routers.savings_insights as si
import app.services.penny_tools as penny_tools
from app.services import tip_copy

TODAY = datetime(2026, 10, 17).date()
SNIPPET = ("SIM-only deals cost between £8 and £25 a month. Giffgaff offers 20GB for £10, "
           "Lebara 30GB for £12. Offer ends 2099-03-31.")


def run(coro):
    return asyncio.run(coro)


# ── the banned-phrase list ──────────────────────────────────────────────────

@pytest.mark.parametrize("text", [
    "You could save £5", "That would save you money", "Saved £10 a month", "Saving £4 a month",
    "Your savings are up", "Cut your bill", "Cutting costs", "A cheaper plan", "The cheapest plan",
    "You could switch", "You should check", "We recommend this", "A recommended option",
    "The best deal", "Worth switching today", "Switch to Lebara", "SWITCHING TO a new plan",
])
def test_banned_phrases_are_found(text):
    assert tip_copy.find_banned(text) is not None


@pytest.mark.parametrize("text", [
    "You pay EE £56 a month.",
    "SIM-only plans are listed at £5 a month at Asda Mobile and Lebara. Checked 14 Oct, source uswitch.com.",
    "Savings",                       # the category name
    "Your savings account pays 4%",  # the account type
    "Checked 14 Oct, source moneysavingexpert.com.",  # a host is not a word
    "Offer listed until 31 Oct.",
])
def test_clean_text_passes(text):
    assert tip_copy.find_banned(text) is None


def test_banned_phrase_inside_the_allowed_phrase_still_fails():
    assert tip_copy.find_banned("Savings could rise") == "could"


# ── shared findings builder ────────────────────────────────────────────────

def _parsed(**over):
    p = {"typical_low": 8, "typical_high": 25,
         "alternatives": [{"name": "Giffgaff", "price": 10, "note": None},
                          {"name": "Lebara", "price": 12, "note": None}],
         "deal": {"text": "A switching offer is running", "valid_until": "2099-03-31"}}
    p.update(over)
    return p


def test_headline_from_the_model_is_never_kept():
    f, _, _ = si._build_findings(_parsed(headline="Could be cheaper"), SNIPPET, ["https://example.com/x"], "mobile", TODAY)
    assert f["headline"] is None


def test_deal_text_with_promo_wording_is_dropped():
    f, claim, _ = si._build_findings(
        _parsed(deal={"text": "Save £10 on Giffgaff", "valid_until": "2099-03-31"}), SNIPPET, [], "mobile", TODAY,
    )
    assert f["deal"] is None and claim is None


def test_alternative_note_and_name_with_banned_words_are_dropped():
    f, _, _ = si._build_findings(_parsed(alternatives=[
        {"name": "Giffgaff", "price": 10, "note": "best value plan"},
        {"name": "Best Mobile", "price": 12, "note": None},
    ]), SNIPPET, [], "mobile", TODAY)
    assert [a["name"] for a in f["alternatives"]] == ["Giffgaff"]
    assert f["alternatives"][0]["note"] is None


# ── composition reads as facts, with a source and a date ───────────────────

def _doc(**findings):
    base = {"typical_low": 5, "typical_high": 14, "headline": "Could be cheaper", "deal": None,
            "alternatives": [{"name": "Asda Mobile", "price": 5, "note": None},
                             {"name": "Lebara", "price": 6, "note": None}],
            "sources": ["https://www.uswitch.com/mobiles/sim-only/"]}
    base.update(findings)
    return {"as_of": "2026-10-14", "fetched_at": datetime(2026, 10, 14),
            "content_valid_until": datetime(2026, 10, 21), "findings": base}


CASES = {
    "mobile": [{"merchant_key": "ee", "display_name": "Ee", "monthly_amount": 56.0, "occurrences": 3, "is_recurring": True}],
    "energy": [{"merchant_key": "octopus", "display_name": "Octopus Energy", "monthly_amount": 130.0, "occurrences": 3, "is_recurring": True}],
    "broadband": [{"merchant_key": "bt", "display_name": "Bt", "monthly_amount": 38.0, "occurrences": 3, "is_recurring": True}],
    "car_insurance": [{"merchant_key": "admiral", "display_name": "Admiral", "monthly_amount": 70.0, "occurrences": 3, "is_recurring": True}],
    "groceries": [{"merchant_key": "tesco", "display_name": "Tesco", "monthly_amount": 400.0, "occurrences": 12, "is_recurring": False}],
    "eating_out": [{"merchant_key": "nandos", "display_name": "Nandos", "monthly_amount": 60.0, "occurrences": 5, "is_recurring": False}],
}


@pytest.mark.parametrize("category", list(CASES))
def test_composed_tip_reads_as_facts_with_source_and_date(category):
    c = si._compose_tip_content(category, _doc(), CASES[category], None, TODAY)
    assert c is not None
    text = c["title"] + " " + c["body"]
    assert tip_copy.find_banned(text) is None, text
    assert "savings_estimate" not in c
    assert "Checked 14 Oct, source uswitch.com." in c["body"]
    assert "Also listed: Asda Mobile £5 a month, Lebara £6 a month." in c["body"]
    assert "—" not in text and "–" not in text and "!" not in text


def test_mobile_tip_wording():
    c = si._compose_tip_content("mobile", _doc(), CASES["mobile"], None, TODAY)
    assert c["title"] == "You pay EE £56 a month"
    assert c["body"] == (
        "SIM-only plans are listed at £5 to £14 a month. "
        "Also listed: Asda Mobile £5 a month, Lebara £6 a month. "
        "Checked 14 Oct, source uswitch.com."
    )


def test_deal_line_is_a_dated_fact_not_a_call_to_action():
    doc = _doc(deal={"text": "Octopus lists a 12 month fixed tariff", "valid_until": "2026-10-31"})
    c = si._compose_tip_content("energy", doc, CASES["energy"], None, TODAY)
    assert "Octopus lists a 12 month fixed tariff. Offer listed until 31 Oct." in c["body"]


def test_no_trigger_tip_title_is_a_listing_not_a_pitch():
    c = si._compose_tip_content("energy", _doc(), [], None, TODAY)
    assert c["title"] == "Listed prices for energy"


# ── gate in the content path: a tip tripping the list is dropped ───────────

def _fresh(monkeypatch, doc):
    async def ensure(key, fetch, allow_fetch=True):
        return SimpleNamespace(state="fresh", doc=doc, fetched=False, failure=None)
    monkeypatch.setattr(si.tip_research, "ensure_research", ensure)


def test_clean_tip_passes_the_content_gate(monkeypatch):
    _fresh(monkeypatch, _doc())
    out = run(si._tip_content_for("mobile", "u@example.com", None, CASES["mobile"]))
    assert out and out["title"] == "You pay EE £56 a month"


def test_composed_tip_with_a_banned_phrase_is_dropped_with_a_static_code(monkeypatch):
    _fresh(monkeypatch, _doc())
    monkeypatch.setattr(si, "_compose_tip_content", lambda *a, **k: {
        "title": "You pay EE £56 a month", "body": "Switching could save about £40 a month.",
        "claim_valid_until": None, "researched_at": None, "content_valid_until": None,
    })
    outcome: dict = {}
    tok = si._RESEARCH_OUTCOME.set(outcome)
    try:
        out = run(si._tip_content_for("mobile", "u@example.com", None, CASES["mobile"]))
    finally:
        si._RESEARCH_OUTCOME.reset(tok)
    assert out is None
    assert outcome["copy_rejected"] == tip_copy.BANNED_FAILURE_CODE == "banned_phrase"


def test_deal_text_stored_in_findings_with_a_banned_phrase_never_reaches_a_tip(monkeypatch):
    # A shared doc written before this gate existed still carries promo wording.
    doc = _doc(deal={"text": "Save 20% for a year", "valid_until": None})
    _fresh(monkeypatch, doc)
    outcome: dict = {}
    tok = si._RESEARCH_OUTCOME.set(outcome)
    try:
        out = run(si._tip_content_for("mobile", "u@example.com", None, CASES["mobile"]))
    finally:
        si._RESEARCH_OUTCOME.reset(tok)
    assert out is None and outcome["copy_rejected"] == "banned_phrase"


def test_phrasing_step_rejects_a_reword_that_adds_a_banned_phrase(monkeypatch):
    monkeypatch.setattr(si, "TIP_LLM_PHRASING", True)
    monkeypatch.setattr(si, "OPENROUTER_API_KEY", "k")
    content = {"title": "You pay EE £56 a month",
               "body": "SIM-only plans are listed at £5 to £14 a month. Checked 14 Oct, source uswitch.com."}

    class R:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": json.dumps({
                "title": content["title"],
                "body": "You could do better at £5 to £14 a month. Checked 14 Oct, source uswitch.com."})}}]}

    class C:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *e):
            return False

    async def llm(*a, **k):
        return R()

    monkeypatch.setattr(si.httpx, "AsyncClient", C)
    monkeypatch.setattr(si, "openrouter_chat", llm)
    assert run(si._maybe_rephrase("u@example.com", content, None)) == content


# ── serve time and Penny output ────────────────────────────────────────────

NOW = datetime.utcnow()


def _stored(**over):
    d = {"_id": "x", "insight_id": "mobile-x", "category": "mobile", "pinned": False,
         "is_new": False, "refreshed_at": NOW, "researched_at": NOW - timedelta(days=1),
         "content_valid_until": NOW + timedelta(days=5), "triggered_by": [],
         "title": "You pay EE £56 a month", "body": "SIM-only plans are listed at £5 to £14 a month. Checked 14 Oct."}
    d.update(over)
    return d


def test_serializer_scans_clean_for_every_user_visible_string():
    out = si._serialize_insight(_stored())
    assert tip_copy.first_banned(tip_copy.serialized_tip_texts(out)) is None


@pytest.mark.parametrize("field", ["title", "body"])
def test_serializer_withholds_a_stored_tip_with_a_banned_phrase(field):
    out = si._serialize_insight(_stored(**{field: "Switching to Lebara could be cheaper"}))
    assert out["state"] == "quiet" and out["title"] == "" and out["body"] == ""


def test_verified_savings_never_surfaces_in_the_serializer():
    d = _stored(title="", body="", verified_savings=1931.0, verified_merchant="Mortgage Co",
                verified_at=NOW, savings_estimate="~£99/mo")
    blob = json.dumps(si._serialize_insight(d), default=str)
    for key in ("verified_savings", "verified_monthly_saving", "savings_estimate", "1931", "£99"):
        assert key not in blob


class _Col:
    def __init__(self, docs):
        self.docs = docs

    def find(self, *a, **k):
        docs = self.docs

        class _Cur:
            async def to_list(self, n):
                return [dict(d) for d in docs]
        return _Cur()


def test_penny_get_insights_output_has_no_saving_and_passes_the_list(monkeypatch):
    docs = [_stored(verified_savings=40.0, savings_estimate="~£50/mo"),
            _stored(_id="y", insight_id="energy-y", category="energy",
                    title="You pay Octopus Energy £130 a month",
                    body="Energy tariffs are listed at £90 to £140 a month. Checked 14 Oct, source uswitch.com.")]
    monkeypatch.setattr(penny_tools, "savings_insights_col", _Col(docs))
    out = run(penny_tools._exec_get_insights("u@example.com"))
    blob = json.dumps(out, default=str)
    for key in ("verified_savings", "verified_monthly_saving", "value_delivered", "estimated_saving",
                "savings_estimate", "£50", "£40"):
        assert key not in blob
    for row in out["insights"]:
        assert tip_copy.find_banned(row["title"]) is None and tip_copy.find_banned(row["summary"]) is None


def test_get_insights_tool_description_forbids_claims():
    desc = next(t["function"]["description"] for t in penny_tools.TOOL_SCHEMAS if t["function"]["name"] == "get_insights")
    assert "never claim or estimate a saving" in desc.lower().replace("\n", " ")


def test_value_delivered_endpoint_is_gone():
    assert "/value-delivered" not in [getattr(r, "path", "") for r in analytics.router.routes]
    assert not hasattr(analytics, "get_value_delivered")


def test_old_estimate_machinery_is_gone():
    for name in ("_savings_estimate_monthly", "_strip_unsupported_savings_claims", "_savings_estimate_is_derivable",
                 "_verified_saving_sentence", "_verified_copy_tier", "_generate_savings_insight_content"):
        assert not hasattr(si, name), name
