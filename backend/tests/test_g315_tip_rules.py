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
    f, _, _ = si._build_findings(
        parsed, "Page which.co.uk: PureGym is £25 a month. Between £25 and £80. Page example.com: from £30.", urls, "gym", TODAY)
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


def test_unknown_long_descriptor_is_not_cut_by_length():
    name, generic = tip_facts.clean_merchant("Fancy Local Cafe Birmingham Cen", "eating_out", "Eating Out")
    assert not generic and name == "Fancy Local Cafe Birmingham Cen"


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
    assert compose("gym")["body"].endswith("Checked 16 Oct, source Which?")
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


# ── review round 1 ──────────────────────────────────────────────────────────

# H1: the saved deadline sentence must never trip the banned list

@pytest.mark.parametrize("cat", ["energy", "mortgage"])
def test_deal_end_context_still_produces_a_served_tip(cat):
    _, rows, findings = CASES[cat]
    c = si._compose_tip_content(cat, doc(findings), rows, {"deal_end": "March 2027"}, TODAY)
    assert "You noted your fixed term ends March 2027." in c["body"]
    assert tip_copy.find_banned(c["title"] + " " + c["body"]) is None
    out = serialized(cat, c)
    assert out["state"] == "fresh" and "fixed term ends" in out["body"]


@pytest.mark.parametrize("cat", ["energy", "mortgage"])
def test_deal_end_context_survives_the_content_path(monkeypatch, cat):
    async def ensure(key, fetch, allow_fetch=True):
        from types import SimpleNamespace
        return SimpleNamespace(state="fresh", doc=doc(CASES[cat][2]), fetched=False, failure=None)
    monkeypatch.setattr(si.tip_research, "ensure_research", ensure)
    out = run(si._tip_content_for(cat, "u@example.com", {"deal_end": "March 2027"}, CASES[cat][1]))
    assert out and "fixed term ends March 2027" in out["body"]


def test_material_change_reason_is_clean():
    d = {"deadline_at": datetime.utcnow() + timedelta(days=20)}  # naive-ok: test fixture
    r = si._material_change_reason(d)
    assert r and tip_copy.find_banned(r) is None and "fixed term" in r


def test_every_shown_string_goes_through_the_serve_gate():
    c = compose("gym")
    out = serialized("gym", c, _return_reason="You could save by switching")
    assert out["return_reason"] is None
    assert tip_copy.first_banned(tip_copy.serialized_tip_texts(out)) is None


# M1: findings need the G315 marker

def test_old_shape_findings_with_an_allowlisted_source_compose_nothing_market():
    old = {"typical_low": 25, "typical_high": 80, "sources": ["https://www.which.co.uk/reviews/gyms"],
           "deal": {"text": "A listed offer", "valid_until": None},
           "alternatives": [alt("PureGym", 25, "gym_membership", "which.co.uk")]}
    d = {"as_of": "2026-10-16", "fetched_at": datetime(2026, 10, 16), "content_valid_until": datetime(2026, 10, 23),
         "findings": old}  # no findings_schema
    c = si._compose_tip_content("gym", d, CASES["gym"][1], None, TODAY)
    for bad in ("listed at", "Also listed", "Offer listed", "A listed offer", "source"):
        assert bad not in c["body"], c["body"]
    d["findings"] = {**old, "findings_schema": "g315-2"}
    assert "Also listed: PureGym £25 a month." in si._compose_tip_content("gym", d, CASES["gym"][1], None, TODAY)["body"]


def test_build_findings_writes_the_marker():
    f, _, _ = si._build_findings({"typical_low": 25, "typical_high": 80}, "Page which.co.uk: from £25 to £80 a month",
                                 ["https://www.which.co.uk/x"], "gym", TODAY)
    assert f["findings_schema"] == "g315-2"
    tip_research.assert_no_user_data({"findings": f})


# M2

@pytest.mark.parametrize("name", ["Hussle day pass", "ClassPass", "PureGym day pass", "Gym pass seller", "Hussle"])
def test_pass_sellers_are_resellers(name):
    assert not tip_facts.is_like_for_like(GYM_FACT, {**GOOD, "name": name})


def test_subscriptions_have_no_like_for_like_type():
    assert "subscriptions" not in tip_facts.PRODUCT_TYPE
    assert tip_facts.user_product_type("subscriptions") is None
    assert not tip_facts.is_like_for_like(
        {"category": "subscriptions", "product_type": "streaming_subscription", "period": "month"},
        alt("Disney+", 5, "streaming_subscription", "which.co.uk"))
    c = compose("subscriptions")
    assert "Also listed" not in c["body"] and "listed at" not in c["body"]


def test_deal_line_needs_the_same_product_match():
    f = {"typical_low": None, "typical_high": None, "alternatives": [], "findings_schema": "g315-2",
         "sources": ["https://www.which.co.uk/x"], "deal": {"text": "A listed offer", "valid_until": None}}
    no_match = si._compose_tip_content("energy", doc(f), CASES["energy"][1], None, TODAY)
    assert "A listed offer" not in no_match["body"]
    match = si._compose_tip_content("gym", doc(f), CASES["gym"][1], None, TODAY)
    assert "A listed offer." in match["body"]


def test_alternative_price_must_come_from_its_own_host_snippet():
    urls = ["https://www.which.co.uk/a", "https://www.uswitch.com/b"]
    parsed = {"alternatives": [
        {"name": "PureGym", "price": 25, "product_type": "gym_membership", "basis": "month", "source_url": "which.co.uk"},
        {"name": "Gym Group", "price": 19, "product_type": "gym_membership", "basis": "month", "source_url": "which.co.uk"},
        {"name": "Anytime", "price": 31, "product_type": "gym_membership", "basis": "month", "source_url": "uswitch.com"},
    ]}
    text = "Page which.co.uk: PureGym costs £25 a month.\n\nPage uswitch.com: Gym Group costs £19 a month. Anytime £31 a month."
    f, _, _ = si._build_findings(parsed, text, urls, "gym", TODAY)
    # Gym Group's £19 is only in the uswitch snippet, not the which.co.uk one it cites
    assert [a["name"] for a in f["alternatives"]] == ["PureGym", "Anytime"]
    only_other = {"alternatives": [parsed["alternatives"][1]]}
    f2, _, _ = si._build_findings({**only_other, "typical_low": 19, "typical_high": 31}, text, urls, "gym", TODAY)
    assert not f2 or f2["alternatives"] == []


# M3

def test_regulated_category_with_two_payees_names_nobody():
    rows = [row("Halifax", 700.0, last="2026-10-01"), row("Nationwide", 500.0, last="2026-10-03")]
    c = si._compose_tip_content("mortgage", doc({}), rows, None, TODAY)
    assert c["title"] == "You pay about £1,200 a month on your mortgage"
    assert "Halifax" not in c["title"] + c["body"] and "Nationwide" not in c["title"] + c["body"]
    assert "latest" not in c["body"] and c["body"].startswith("That is based on")
    assert tip_facts.card_violations({"title": c["title"], "body": c["body"], "lead_line": c["title"]}, "mortgage") == []


def test_two_unknown_lenders_are_not_merged_into_one():
    rows = tip_facts.present_triggers("mortgage", [row("Mtg", 600.0, key="mtg"), row("Mort", 500.0, key="mort")], "Mortgage")
    assert len(rows) == 2
    assert tip_facts.headline_for("mortgage", "Mortgage", rows).startswith("You pay about £1,100 a month on your mortgage")


# L1

def test_no_details_workflow_for_a_regulated_category():
    for cat in ("mortgage", "car_finance", "car_insurance"):
        assert serialized(cat, compose(cat))["has_workflow"] is False
    assert serialized("gym", compose("gym"))["has_workflow"] is True


# L2

@pytest.mark.parametrize("cat,label", [("gift_cards", "Gift Cards"), ("refund", "Refund"), ("cardio", "Cardio"),
                                       ("fundraising", "Fundraising")])
def test_ordinary_words_are_not_regulated(cat, label):
    assert not tip_facts.is_regulated_category(cat, label)


@pytest.mark.parametrize("label", ["Overdraft", "BNPL", "Klarna", "Clearpay", "Debt", "Credit Card", "Pension"])
def test_added_regulated_words(label):
    assert tip_facts.is_regulated_category("custom", label)


# L3

def test_ambiguous_brand_inside_another_payee_is_not_rebranded():
    assert tip_facts.clean_merchant("Three Rivers Cafe", "mobile", "Mobile")[0] != "Three"
    assert tip_facts.clean_merchant("Leon Smith", "eating_out", "Eating Out")[0] != "Leon"
    assert tip_facts.clean_merchant("Admiral Road Garage", "car_insurance", "Car Insurance")[1] is True
    assert tip_facts.clean_merchant("Three Mobile Ltd", "mobile", "Mobile")[0] == "Three"
    assert tip_facts.clean_merchant("Leon", "eating_out", "Eating Out")[0] == "Leon"


def test_brand_is_scoped_to_the_tips_own_category():
    assert tip_facts.clean_merchant("Tesco Bank Loans", "mortgage", "Mortgage")[1] is True
    assert tip_facts.clean_merchant("Aldi", "gym", "Gym")[0] == "Aldi"  # not rebranded by another category


@pytest.mark.parametrize("raw", ["Marks and Spencer Simply Food", "Almond Branch National Trust",
                                 "Five Guys Burgers and Shakes"])
def test_whole_names_are_left_exactly_as_given(raw):
    assert tip_facts.clean_merchant(raw, "eating_out", "Eating Out")[0] == raw


def test_only_fragments_banks_were_seen_to_cut_are_completed():
    cm = lambda r, c="eating_out", l="Eating Out": tip_facts.clean_merchant(r, c, l)[0]
    assert cm("The Good Life Eatery Birming") == "The Good Life Eatery Birmingham"
    assert cm("Some Cafe Castle Bromw") == "Some Cafe Castle Bromwich"
    assert cm("Corner Shop S/Mkts") == "Corner Shop Supermarkets"
    assert cm("Fancy Local Cafe Xyzcen") == "Fancy Local Cafe Xyzcen"  # unseen fragment: untouched
    assert tip_facts.clean_merchant("David Lloyd Leisur", "gym", "Gym")[0] == "David Lloyd"


def test_evidence_rows_are_checked_for_truncated_names():
    card = {"title": "t", "body": "b", "triggered_by": [{"display_name": "David Lloyd Leisur"}]}
    assert "raw_merchant_name" in tip_facts.card_violations(card, "gym")
    card["triggered_by"] = [{"display_name": "Mtg"}]
    assert "raw_merchant_name" in tip_facts.card_violations(card, "mortgage")


# L4 and regeneration script

def test_gym_has_no_compare_chips_in_the_card():
    src = open("../frontend/components/InsightCard.tsx", encoding="utf-8").read()
    assert "hussle" not in src.lower() and "classpass" not in src.lower()


def test_review_renderer_has_no_hardcoded_account_name():
    src = open("tests/g315_review_render.py", encoding="utf-8").read()
    assert "Premier" not in src and "PRIMARY_EMAIL" in src
    assert "Premier" not in open("../docs/copy/tips-review-2026-10.md", encoding="utf-8").read()


def test_regen_script_counts_hidden_tips_and_defaults_to_dry_run():
    import importlib.util
    spec = importlib.util.spec_from_file_location("regen_tips", "scripts/regen_tips.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    class Col:
        async def find(self, *a, **k):
            return self
        def find(self, *a, **k):
            class C:
                async def to_list(self, n):
                    return [{"user_id": "a", "prompt_version": 8}, {"user_id": "a", "prompt_version": 9},
                            {"user_id": "b", "prompt_version": None}, {"user_id": "c", "prompt_version": 9}]
            return C()
    assert run(m.collect(Col())) == {"a": 1, "b": 1}
    src = open("scripts/regen_tips.py", encoding="utf-8").read()
    assert "--apply" in src and "dry-run" in src


def test_provider_name_must_sit_before_its_own_price_in_the_host_snippet():
    text = "Page which.co.uk: PureGym from £25 a month. Premium clubs £117 a month."
    urls = ["https://www.which.co.uk/a"]
    parsed = {"typical_low": 25, "typical_high": 117, "alternatives": [
        {"name": n, "price": p, "product_type": "gym_membership", "basis": "month", "source_url": "which.co.uk"}
        for n, p in (("Gymbox", 25), ("PureGym", 117), ("PureGym", 25))]}
    f, _, _ = si._build_findings(parsed, text, urls, "gym", TODAY)
    assert [(a["name"], a["price"]) for a in f["alternatives"]] == [("PureGym", 25.0)]


def test_serve_and_content_gates_receive_the_evidence_rows():
    import inspect
    src = inspect.getsource(si)
    assert src.count('"triggered_by": presented}') == 1
    assert 'tip_facts.present_triggers(category_key, triggered_by, label)}' in src


# ── sentence joins ──────────────────────────────────────────────────────────

def test_sentence_helper_adds_a_full_stop_only_when_missing():
    assert tip_facts.sentence("You pay about £22 a month for subscriptions") == "You pay about £22 a month for subscriptions."
    assert tip_facts.sentence("Already ends.") == "Already ends."
    assert tip_facts.sentence("") == ""


def test_subscriptions_own_fact_body_reads_with_full_stops():
    c = compose("subscriptions")
    assert c is not None
    joined = tip_facts.sentence(c["title"]) + " " + c["body"]
    assert re.search(r"a month for subscriptions\. That is based on \d+ payments", joined)


def test_gate_catches_a_missing_full_stop_between_sentences():
    c = compose("subscriptions")
    card = serialized("subscriptions", c)
    assert "missing_full_stop" not in tip_facts.card_violations(card, "subscriptions")
    bad = dict(card, body=card["body"].replace("days. Checked", "days Checked"))
    assert "days Checked" in bad["body"]
    assert "missing_full_stop" in tip_facts.card_violations(bad, "subscriptions", "Subscriptions")
