"""G315: tips are factual, consistent and never advisory (Kevin, 2026-10-21).
One group of tests per rule (a) to (f), plus the rendered-card gate and the
cache invalidation. No network, no real database, no OpenRouter or Tavily."""
import asyncio
import re
from datetime import datetime, timedelta

import pytest

import app.routers.savings_insights as si
from app.services import tip_copy, tip_facts, tip_research
from tests.g315_fixtures import CASES, alt, doc, row

TODAY = datetime(2026, 10, 21).date()
NOW = datetime.utcnow()  # naive-ok: test fixture timestamp matching the stored convention
AMOUNT_RE = re.compile(r"£[\d,]+(?:\.\d+)?")


def run(coro):
    return asyncio.run(coro)


def compose(cat):
    _, rows, findings = CASES[cat]
    return si._compose_tip_content(cat, doc(findings), rows, None, TODAY)


def serialized(cat, content, **over):
    _, rows, _ = CASES[cat]
    d = {"_id": "x", "insight_id": f"{cat}-x", "category": cat, "pinned": False, "is_new": False,
         "refreshed_at": NOW, "researched_at": NOW - timedelta(days=1),
         "content_valid_until": NOW + timedelta(days=5), "triggered_by": rows,
         "prompt_version": si.PROMPT_VERSION, "title": content["title"], "body": content["body"]}
    d.update(over)
    return si._serialize_insight(d)


# ── (a) regulated categories ────────────────────────────────────────────────

@pytest.mark.parametrize("cat", ["mortgage", "car_finance", "car_insurance", "insurance", "credit_card",
                                 "balance_transfer", "pension", "investment", "loan"])
def test_regulated_categories_are_regulated(cat):
    assert tip_facts.is_regulated_category(cat)


@pytest.mark.parametrize("cat,label", [
    ("remortgage_help", None), ("home_loan", None), ("something", "Life Insurance"),
    ("x", "Stocks and shares ISA"), ("savings_pot", "Pension top up"), ("y", "Balance transfer card"),
])
def test_unknown_category_whose_name_matches_a_regulated_word_fails_closed(cat, label):
    assert tip_facts.is_regulated_category(cat, label)


@pytest.mark.parametrize("cat", ["mobile", "broadband", "energy", "groceries", "eating_out", "gym", "subscriptions"])
def test_known_unregulated_categories_are_not(cat):
    assert not tip_facts.is_regulated_category(cat)


@pytest.mark.parametrize("cat", ["mortgage", "car_finance", "car_insurance"])
def test_regulated_research_query_is_never_sent(cat):
    assert tip_facts.safe_research_query(cat, cat, "best cheapest mortgage deals switch and save money") is None


def test_pitch_words_are_stripped_from_every_other_query():
    q = tip_facts.safe_research_query("mobile", "Mobile", "best cheapest SIM only deals switch save money 2026")
    assert q and not re.search(r"best|cheap|switch|save|deal", q, re.I) and "SIM" in q


@pytest.mark.parametrize("cat", ["mortgage", "car_finance", "car_insurance"])
def test_regulated_tip_is_the_users_own_fact_only(cat):
    c = compose(cat)
    text = c["title"] + " " + c["body"]
    assert "Also listed" not in text and "listed at" not in text and "source" not in text
    assert "Offer" not in text and "£1,000" not in text and "Yorkshire" not in text
    assert tip_facts.card_violations({"title": c["title"], "body": c["body"], "lead_line": c["title"]}, cat) == []


def test_mortgage_tip_wording_is_the_own_fact_with_the_exact_payment():
    c = compose("mortgage")
    assert c["title"] == "You paid your mortgage lender £1,124.44 on 1 Oct"
    assert c["body"] == "That was the latest of 3 payments in the last 90 days. Checked 16 Oct."
    assert "Mtg" not in c["title"] + c["body"]


def test_regulated_category_is_never_researched_in_the_content_path(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("research must not run for a regulated category")
    monkeypatch.setattr(si.tip_research, "ensure_research", boom)
    out = run(si._tip_content_for("mortgage", "u@example.com", None, CASES["mortgage"][1]))
    assert out and out["title"].startswith("You paid ") and "Also listed" not in out["body"]


def test_regulated_fetch_is_refused_even_if_called_directly(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("no search for a regulated category")
    monkeypatch.setattr(si, "_tavily_search", boom)
    out = run(si._fetch_market_findings(tip_research.make_key("mortgage", None, 1100)))
    assert out.findings is None and out.failure == "error"


def test_regulated_tip_with_no_figure_is_no_tip():
    assert si._compose_tip_content("mortgage", doc({}), [], None, TODAY) is None


def test_stored_regulated_body_with_market_text_is_withheld_at_serve_time():
    out = serialized("mortgage", {"title": "x", "body": "Also listed: Yorkshire BS £1,167 a month. Checked 16 Oct."})
    assert out["state"] == "quiet" and out["body"] == ""


# ── (b) like for like ───────────────────────────────────────────────────────

GYM_FACT = {"category": "gym", "product_type": "gym_membership", "period": "month", "merchant": "David Lloyd"}
GOOD = alt("PureGym", 25, "gym_membership", "which.co.uk")


def test_like_for_like_accepts_the_matching_listing():
    assert tip_facts.is_like_for_like(GYM_FACT, GOOD)


@pytest.mark.parametrize("override", [
    {"price": None}, {"price": 0}, {"price": True}, {"product_type": "sim_only"}, {"product_type": None},
    {"basis": "year"}, {"basis": None}, {"name": "David Lloyd via Groupon"}, {"name": "PureGym voucher"},
    {"name": "Best Gym"}, {"source_host": "davidlloydmembership-price.co.uk"}, {"source_host": "example.com"},
    {"source_host": ""}, {"name": "David Lloyd"},
])
def test_like_for_like_fails_closed(override):
    assert not tip_facts.is_like_for_like(GYM_FACT, {**GOOD, **override})


@pytest.mark.parametrize("fact", [
    {**GYM_FACT, "product_type": None}, {**GYM_FACT, "period": "year"}, {**GYM_FACT, "category": "groceries"},
    {**GYM_FACT, "category": "mortgage"}, {**GYM_FACT, "category": "eating_out"}, {}, {"category": None},
])
def test_like_for_like_needs_a_like_user_fact(fact):
    assert not tip_facts.is_like_for_like(fact, GOOD)


def test_like_for_like_never_raises_on_garbage():
    assert not tip_facts.is_like_for_like(None, None)
    assert not tip_facts.is_like_for_like(GYM_FACT, "PureGym")


def test_mobile_bill_gets_no_sim_only_listing_unless_the_user_said_so():
    c = compose("mobile")
    assert "Also listed" not in c["body"] and "listed at" not in c["body"] and "source" not in c["body"]
    _, rows, findings = CASES["mobile"]
    said = si._compose_tip_content("mobile", doc(findings), rows, {"plan_type": "SIM only"}, TODAY)
    assert "Also listed: Three Mobile £7 a month." in said["body"]
    assert "VOXI" not in said["body"] and "SMARTY" not in said["body"]


def test_gym_keeps_only_the_like_for_like_named_source_listing():
    c = compose("gym")
    assert "Also listed: PureGym £25 a month." in c["body"]
    assert "Groupon" not in c["body"] and "price.co.uk" not in c["body"]
    assert c["body"].endswith("Checked 16 Oct, source Which?")


def test_groceries_and_eating_out_never_list_alternatives():
    for cat in ("groceries", "eating_out"):
        c = compose(cat)
        assert "Also listed" not in c["body"] and "listed" not in c["body"] and "Offer" not in c["body"]
        assert "source" not in c["body"]


def test_findings_drop_product_types_without_prices_resellers_and_unlisted_sources():
    urls = ["https://www.which.co.uk/reviews/gyms", "https://davidlloydmembership-price.co.uk/x", "https://example.com/p"]
    parsed = {"typical_low": 25, "typical_high": 80, "alternatives": [
        {"name": "PureGym", "price": 25, "product_type": "gym_membership", "basis": "month", "source_url": "which.co.uk"},
        {"name": "Gym Group", "price": None, "product_type": "gym_membership", "basis": "month", "source_url": "which.co.uk"},
        {"name": "David Lloyd via Groupon", "price": 60, "product_type": "gym_membership", "basis": "month", "source_url": "davidlloydmembership-price.co.uk"},
        {"name": "Anytime", "price": 30, "product_type": "sim_only", "basis": "month", "source_url": "which.co.uk"},
        {"name": "Fitness First", "price": 30, "product_type": "gym_membership", "basis": "year", "source_url": "which.co.uk"},
        {"name": "Bannatyne", "price": 30, "product_type": "gym_membership", "basis": "month", "source_url": "example.com"},
        {"name": "Nuffield", "price": 30, "product_type": "gym_membership", "basis": "month", "source_url": "notreturned.which.co.uk"},
    ]}
    f, _, _ = si._build_findings(parsed, "PureGym is £25 a month. Prices from £30. Between £25 and £80.", urls, "gym", TODAY)
    assert [a["name"] for a in f["alternatives"]] == ["PureGym"]
    assert f["sources"] == ["https://www.which.co.uk/reviews/gyms"]


def test_research_asks_for_no_alternatives_in_a_category_without_a_product_type():
    for cat in ("groceries", "eating_out", "mortgage", "car_finance"):
        assert "empty list" in si._alternatives_instruction(cat)
    assert "sim_only" in si._alternatives_instruction("mobile")


# ── (c) one figure per card ─────────────────────────────────────────────────

def _amounts(text):
    return {m.replace(",", "") for m in AMOUNT_RE.findall(text)}


def _without_market(body):
    body = re.sub(r"Also listed:.*?(?:\. |$)", "", body)
    return re.sub(r"[A-Za-z\- ]+ are listed at £[\d,]+ to £[\d,]+ a month\. ", "", body)


@pytest.mark.parametrize("cat", list(CASES))
def test_headline_body_and_lead_share_one_amount_for_every_fixture(cat):
    c = compose(cat)
    assert c is not None
    out = serialized(cat, c)
    assert out["title"] == out["lead_line"] == c["title"]
    head = _amounts(out["title"])
    assert len(head) <= 1
    assert _amounts(_without_market(out["body"])) <= head, (out["title"], out["body"])
    assert "across" not in out["title"] + out["body"]


def test_stale_stored_title_cannot_disagree_with_the_lead_line():
    c = compose("mobile")
    out = serialized("mobile", {"title": "You pay about £999 a month for mobile", "body": c["body"]})
    assert out["title"] == out["lead_line"] == "You pay about £61 a month for mobile"


def test_plain_sentences_replace_across_n_places():
    assert compose("mobile")["title"] == "You pay about £61 a month for mobile"
    assert compose("groceries")["title"] == "You spend about £208 a month on groceries"
    assert compose("broadband")["title"] == "You pay BT £38 a month"


# ── (d) merchant names ──────────────────────────────────────────────────────

def test_same_brand_merges_once_and_names_are_clean():
    rows = tip_facts.present_triggers("groceries", CASES["groceries"][1], "Groceries")
    names = [r["display_name"] for r in rows]
    assert names.count("Sainsbury's") == 1 and "Tesco" in names and "Aldi" in names
    assert next(r for r in rows if r["display_name"] == "Sainsbury's")["monthly_amount"] == 170.0
    assert next(r for r in rows if r["display_name"] == "Sainsbury's")["occurrences"] == 12
    blob = " ".join(names)
    assert "Birmin" not in blob and "S/Mkts" not in blob


def test_david_lloyd_is_one_row_and_never_truncated():
    rows = tip_facts.present_triggers("gym", CASES["gym"][1], "Gym")
    assert [r["display_name"] for r in rows] == ["David Lloyd"]
    c = compose("gym")
    assert "Leisur" not in c["title"] + c["body"]


@pytest.mark.parametrize("raw", ["Mtg", "MTG 1234", "Mortg", "Mort"])
def test_unknown_lender_reads_your_mortgage_lender_never_an_abbreviation(raw):
    name, generic = tip_facts.clean_merchant(raw, "mortgage", "Mortgage")
    assert generic and name == "your mortgage lender"


def test_known_lender_reads_its_own_name_and_unknown_car_finance_provider_is_generic():
    assert tip_facts.clean_merchant("Nationwide Bs", "mortgage", "Mortgage")[0] == "Nationwide"
    assert tip_facts.clean_merchant("M&S Loans", "car_finance", "Car Finance")[0] == "M&S Loans"
    assert tip_facts.clean_merchant("Xyz Ltd", "car_finance", "Car Finance")[0] == "your car finance provider"


def test_unknown_long_descriptor_loses_its_dangling_word():
    name, generic = tip_facts.clean_merchant("Fancy Local Cafe Birmingham Cen", "eating_out", "Eating Out")
    assert not generic and not name.endswith("Cen")


def test_serializer_returns_cleaned_merged_rows():
    c = compose("groceries")
    out = serialized("groceries", c)
    assert [t["display_name"] for t in out["triggered_by"]].count("Sainsbury's") == 1


def test_triggered_rows_carry_the_last_payment(monkeypatch):
    # the finder adds last_date and last_amount from the user's own transactions
    import inspect
    assert "last_date" in inspect.getsource(si._find_triggered_transactions)


# ── (e) sources ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("src,name", [
    ("https://www.moneysupermarket.com/broadband/", "MoneySuperMarket"),
    ("https://www.which.co.uk/reviews", "Which?"),
    ("https://www.moneysavingexpert.com/utilities/", "MoneySavingExpert"),
    ("https://www.ofcom.org.uk/x", "Ofcom"),
    ("https://www.ofgem.gov.uk/x", "Ofgem"), ("https://www.fca.org.uk/x", "FCA"),
    ("https://www.uswitch.com/mobiles/", "Uswitch"), ("https://www.gocompare.com/x", "GoCompare"),
])
def test_allowlisted_sources_show_their_names(src, name):
    assert tip_facts.allowed_source_name(src) == name


@pytest.mark.parametrize("src", [
    "https://davidlloydmembership-price.co.uk/", "https://procalculator.site/gym", "https://best-price.co.uk",
    "https://example.com", "https://gym-calculator.site", "https://random-blog.xyz", "", "not a url",
    "https://evilmoneysupermarket.com",
])
def test_seo_and_unlisted_sources_are_refused(src):
    assert tip_facts.allowed_source_name(src) is None


def test_provider_own_site_is_allowed_by_its_name_only():
    assert tip_facts.allowed_source_name("https://www.davidlloyd.co.uk/", "David Lloyd") == "David Lloyd"
    assert tip_facts.allowed_source_name("https://www.puregym.com/", "PureGym") == "PureGym"
    assert tip_facts.allowed_source_name("https://www.davidlloyd.co.uk/", "PureGym") is None


def test_source_names_never_contain_a_bare_domain_or_a_split_one():
    c = compose("energy")
    assert "Checked 16 Oct, source Ofgem and Uswitch." in c["body"]
    for cat in CASES:
        body = compose(cat)["body"]
        assert not re.search(r"\b[a-z0-9-]+\.(com|co\.uk)\b", body), body
        assert tip_facts.card_violations({"title": "t", "body": body}, cat) == []


def test_domain_spacing_is_a_gate_violation_and_the_frontend_splitter_is_fixed():
    assert "domain_spacing" in tip_facts.card_violations(
        {"title": "t", "body": "Checked 16 Oct, source moneysupermarket. com."}, "broadband")
    src = open("../frontend/components/InsightCard.tsx", encoding="utf-8").read()
    assert "(\\d)\\.(\\d)" not in src.split("function InsightBody")[1].split("return (")[0]
    assert "[A-Za-z0-9]" in src.split("function InsightBody")[1].split("return (")[0]


# ── (f) one freshness line ──────────────────────────────────────────────────

@pytest.mark.parametrize("cat", list(CASES))
def test_exactly_one_freshness_line(cat):
    c = compose(cat)
    out = serialized(cat, c)
    assert len(re.findall(r"Checked \d{1,2} \w{3}", out["body"])) == 1
    assert out["expiry_line"] is None
    assert "Researched" not in out["body"] and "Valid until" not in out["body"]


def test_expiry_line_survives_only_for_a_body_without_a_checked_line():
    out = si._serialize_insight({
        "_id": "x", "insight_id": "gym-x", "category": "gym", "pinned": False, "is_new": False,
        "refreshed_at": NOW, "researched_at": NOW - timedelta(days=2),
        "content_valid_until": NOW + timedelta(days=5), "triggered_by": [row("PureGym", 25.0)],
        "prompt_version": si.PROMPT_VERSION, "title": "t", "body": "You pay PureGym £25 a month."})
    assert out["expiry_line"] == "Researched 2d ago"


# ── the rendered-card gate ──────────────────────────────────────────────────

@pytest.mark.parametrize("word", ["best", "cheaper", "cheapest", "switch", "switching", "save", "saving",
                                  "deal", "deals", "could", "should", "recommend", "worth"])
def test_gate_bans_every_g315_word_in_rendered_text(word):
    assert tip_copy.find_banned(f"The {word} option") is not None
    v = tip_facts.card_violations({"title": "You pay EE £56 a month", "body": f"A {word} one. Checked 16 Oct."}, "mobile")
    assert any(x.startswith("banned_phrase") for x in v)


def test_gate_flags_each_structural_rule():
    base = {"title": "You pay EE £56 a month", "lead_line": "You pay EE £56 a month"}
    assert "across_n_places" in tip_facts.card_violations({**base, "body": "~£61 across 2 places. Checked 16 Oct."}, "mobile")
    assert "raw_merchant_name" in tip_facts.card_violations({**base, "body": "You paid Mtg. Checked 16 Oct."}, "mobile")
    assert "two_freshness_lines" in tip_facts.card_violations({**base, "body": "Checked 16 Oct.", "expiry_line": "Researched 5d ago"}, "mobile")
    assert "also_listed_not_like_for_like" in tip_facts.card_violations(
        {**base, "body": "Also listed: PCP, HP. Checked 16 Oct."}, "gym")
    assert "also_listed_not_like_for_like" in tip_facts.card_violations(
        {**base, "body": "Also listed: David Lloyd via Groupon £60 a month. Checked 16 Oct."}, "gym")
    assert "also_listed_not_allowed" in tip_facts.card_violations(
        {**base, "body": "Also listed: Aldi £162 a month. Checked 16 Oct."}, "groceries")
    assert "headline_mismatch" in tip_facts.card_violations({**base, "title": "You pay EE £57 a month", "body": "x"}, "mobile")
    assert "punctuation" in tip_facts.card_violations({**base, "body": "Good — really"}, "mobile")


@pytest.mark.parametrize("cat", list(CASES))
def test_every_composed_fixture_passes_the_gate(cat):
    c = compose(cat)
    assert c is not None
    assert tip_facts.card_violations({"title": c["title"], "body": c["body"], "lead_line": c["title"]}, cat) == []
    out = serialized(cat, c)
    assert tip_facts.card_violations(out, cat) == []
    assert out["state"] == "fresh"


# ── cache invalidation ──────────────────────────────────────────────────────

def test_prompt_version_was_bumped_and_old_tips_are_not_served():
    assert si.PROMPT_VERSION >= 9 == si.MIN_SERVE_PROMPT_VERSION
    c = compose("gym")
    old = serialized("gym", c, prompt_version=8)
    assert old["state"] == "quiet" and old["title"] == "" and old["body"] == "" and old["expiry_line"] is None
    assert serialized("gym", c)["state"] == "fresh"
    assert serialized("gym", c, prompt_version=None)["state"] == "quiet"


def test_old_stored_tip_is_regenerated_on_the_next_pass():
    assert si._regen_reason({"refreshed_at": NOW, "prompt_version": 8}, [], NOW) == "prompt_upgraded"


def test_old_shared_findings_cannot_surface_a_market_line():
    # Findings fetched before G315 carry no product type, basis or source host per
    # alternative, so nothing in them can pass like for like. No refetch is needed.
    old = {"typical_low": 5, "typical_high": 14, "deal": None, "sources": ["https://davidlloydmembership-price.co.uk/"],
           "alternatives": [{"name": "PureGym", "price": 25, "note": None}]}
    c = si._compose_tip_content("gym", doc(old), CASES["gym"][1], None, TODAY)
    assert "Also listed" not in c["body"] and "listed at" not in c["body"] and "source" not in c["body"]
