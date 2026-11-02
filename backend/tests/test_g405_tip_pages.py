"""G405: page fetch and regulator figures in the shared tip research.

No network: every request goes through httpx.MockTransport, the page text is
invented, and Tavily and OpenRouter are faked. No real user data."""
import asyncio
import json
from datetime import datetime, timedelta

import httpx
import pytest

import app.routers.savings_insights as si
from app.services import tip_facts, tip_pages, tip_regulators, tip_research as tr
from tests.g315_fixtures import doc, row
from tests.test_tip_research_b48 import FakeCol

TODAY = datetime(2026, 11, 2).date()
REAL_CLIENT = httpx.AsyncClient


def run(coro):
    return asyncio.run(coro)


def client_for(handler):
    return REAL_CLIENT(transport=httpx.MockTransport(handler))


def html(body, ctype="text/html; charset=utf-8", status=200):
    return httpx.Response(status, text=body, headers={"content-type": ctype})


# ── text extraction ─────────────────────────────────────────────────────────

def test_html_to_text_strips_tags_scripts_and_collapses_whitespace():
    raw = ("<html><head><title>x</title><style>p{}</style></head><body><script>var a=1;</script>"
           "<p>Giffgaff&nbsp;SIM</p>\n\n<p>from &pound;10 a month</p><!-- c --></body></html>")
    out = tip_pages.html_to_text(raw)
    assert out == "Giffgaff SIM from £10 a month"
    assert "\n" not in out and "var a" not in out
    assert len(tip_pages.html_to_text("a " * 10000)) <= tip_pages.MAX_CHARS


# ── fetching rules ──────────────────────────────────────────────────────────

def test_only_allowlisted_hosts_are_fetched_and_at_most_three_pages():
    seen = []

    def handler(req):
        seen.append(req.url.host)
        assert "SortedTipResearch" in req.headers["user-agent"]
        return html("<p>Page text</p>")

    stats = tip_pages.new_stats()
    urls = ["https://seo-prices.example.com/x", "https://www.uswitch.com/a", "https://davidlloydmembership-price.co.uk/",
            "https://www.which.co.uk/b", "https://www.moneysupermarket.com/c", "https://www.gocompare.com/d"]
    out = run(tip_pages.fetch_pages(urls, None, stats, client_for(handler)))
    assert seen == ["www.uswitch.com", "www.which.co.uk", "www.moneysupermarket.com"]
    assert set(out) == {"uswitch.com", "which.co.uk", "moneysupermarket.com"}
    assert stats["pages_fetched"] == 3 and stats["pages_failed"] == 0


def test_non_allowlisted_host_is_never_requested():
    def handler(req):
        raise AssertionError("must not be requested")

    stats = tip_pages.new_stats()
    out = run(tip_pages.fetch_pages(["https://example.com/sim", "http://www.uswitch.com/x"], None, stats, client_for(handler)))
    assert out == {} and stats["pages_fetched"] == 0 and stats["pages_failed"] == 0


def test_provider_own_site_is_fetched_only_for_that_provider():
    seen = []

    def handler(req):
        seen.append(req.url.host)
        return html("PureGym £25 a month")

    stats = tip_pages.new_stats()
    run(tip_pages.fetch_pages(["https://www.puregym.com/memberships/"], "pure gym", stats, client_for(handler)))
    assert seen == ["www.puregym.com"]
    seen.clear()
    run(tip_pages.fetch_pages(["https://www.puregym.com/memberships/"], None, tip_pages.new_stats(), client_for(handler)))
    assert seen == []


def test_redirect_off_host_is_refused_and_counted():
    hits = []

    def handler(req):
        hits.append(str(req.url))
        if req.url.host == "www.uswitch.com":
            return httpx.Response(302, headers={"location": "https://evil.example.net/p"})
        raise AssertionError("off-host target must not be requested")

    stats = tip_pages.new_stats()
    out = run(tip_pages.fetch_pages(["https://www.uswitch.com/a"], None, stats, client_for(handler)))
    assert out == {} and stats["pages_failed"] == 1 and stats["pages_fetched"] == 0
    assert len(hits) == 1


def test_same_host_redirect_is_followed_and_http_downgrade_refused():
    def handler(req):
        if req.url.path == "/a":
            return httpx.Response(301, headers={"location": "/b"})
        return html("moved page")

    stats = tip_pages.new_stats()
    out = run(tip_pages.fetch_pages(["https://www.uswitch.com/a"], None, stats, client_for(handler)))
    assert out == {"uswitch.com": "moved page"}

    def downgrade(req):
        return httpx.Response(302, headers={"location": "http://www.uswitch.com/b"})

    stats = tip_pages.new_stats()
    assert run(tip_pages.fetch_pages(["https://www.uswitch.com/a"], None, stats, client_for(downgrade))) == {}
    assert stats["pages_failed"] == 1


def test_failed_fetches_count_and_never_raise():
    def handler(req):
        if req.url.host == "www.uswitch.com":
            return httpx.Response(500)
        if req.url.host == "www.which.co.uk":
            raise httpx.ReadTimeout("slow")
        return html("%PDF", ctype="application/pdf")

    stats = tip_pages.new_stats()
    urls = ["https://www.uswitch.com/a", "https://www.which.co.uk/b", "https://www.gocompare.com/c"]
    assert run(tip_pages.fetch_pages(urls, None, stats, client_for(handler))) == {}
    assert stats["pages_failed"] == 3 and stats["pages_fetched"] == 0


def test_body_is_byte_capped():
    big = "x " * 500_000

    def handler(req):
        return html(big)

    out = run(tip_pages.fetch_pages(["https://www.uswitch.com/a"], None, tip_pages.new_stats(), client_for(handler)))
    assert 0 < len(out["uswitch.com"]) <= tip_pages.MAX_CHARS


# ── G315 rules on page text ─────────────────────────────────────────────────

ALT = {"name": "Giffgaff", "price": 10, "product_type": "sim_only", "basis": "month",
       "source_url": "https://www.uswitch.com/mobiles/sim-only/"}
SNIPPET = "Page uswitch.com: Compare SIM only plans listed for 2026. Prices shown are monthly and var"
PAGE = ("Page uswitch.com: SIM only plans. Giffgaff 20GB SIM only plan, £10 a month. "
        "Another provider lists unlimited data at £22 a month.")
PARSED = {"typical_low": None, "typical_high": None, "alternatives": [ALT], "deal": None}
URLS = ["https://www.uswitch.com/mobiles/sim-only/"]


def test_page_listing_passes_the_g315_rules_where_the_snippet_alone_does_not():
    f, _, v = si._build_findings(PARSED, SNIPPET, URLS, "mobile", TODAY)
    assert f is None and v == "empty"  # snippet only: no price tied to the provider
    stats = {}
    both = SNIPPET + "\n\n" + PAGE
    f, _, v = si._build_findings(PARSED, both, URLS, "mobile", TODAY, snippet_text=SNIPPET, stats=stats)
    assert v is None and [a["name"] for a in f["alternatives"]] == ["Giffgaff"]
    assert f["alternatives"][0]["source_host"] == "uswitch.com"
    assert stats == {"listings_from_pages": 1}


def test_listing_in_the_snippet_is_counted_as_a_snippet_listing():
    snip = "Page uswitch.com: Giffgaff SIM only £10 a month"
    stats = {}
    f, _, _ = si._build_findings(PARSED, snip, URLS, "mobile", TODAY, snippet_text=snip, stats=stats)
    assert f["alternatives"] and stats == {"listings_from_snippets": 1}


def test_page_text_does_not_loosen_the_name_before_price_rule():
    far = ("Page uswitch.com: SIM only plans. Giffgaff is a network. " + "Lorem ipsum dolor sit amet. " * 6
           + "Prices start at £10 a month.")
    f, _, v = si._build_findings(PARSED, far, URLS, "mobile", TODAY, snippet_text="", stats={})
    assert f is None and v == "empty"
    # a price on another host's page never counts for this host
    other = "Page which.co.uk: Giffgaff SIM only £10 a month"
    f, _, v = si._build_findings(PARSED, other, URLS, "mobile", TODAY, snippet_text="", stats={})
    assert f is None


def test_regulated_category_is_never_researched_or_fetched(monkeypatch):
    def handler(req):
        raise AssertionError("no request for a regulated category")

    monkeypatch.setattr(si.httpx, "AsyncClient", lambda *a, **k: client_for(handler))

    async def no_search(*a, **k):
        raise AssertionError("no search")

    monkeypatch.setattr(si, "_tavily_search", no_search)
    fo = run(si._fetch_market_findings(tr.make_key("mortgage", None, None)))
    assert fo.findings is None and fo.failure == "error"
    # and a stored regulator figure is never composed for one
    d = doc({"typical_low": None, "typical_high": None, "alternatives": [], "deal": None, "sources": [],
             "typical_regulated": {"figure": 94.5, "source_host": "ofgem.gov.uk", "source_name": "Ofgem",
                                   "read_on": "2026-11-02"}})
    out = si._compose_tip_content("mortgage", d, [row("Mtg", 1124.44, last="2026-10-01")], None, TODAY)
    assert "Typical" not in out["body"]


# ── regulator extractors ────────────────────────────────────────────────────

OFGEM = ("Energy price cap. The price cap for a typical household paying by Direct Debit is £1,758 a year. "
         "That is about £146.50 per month for dual fuel. Other costs apply.")
OFCOM = ("Pricing trends. The average monthly spend on mobile services was £21 a month in the year to March. "
         "Broadband: the average monthly bill for broadband was £33.50 per month.")


def test_ofgem_extractor_reads_only_the_labelled_monthly_figure():
    assert tip_regulators.extract_monthly("energy", OFGEM) == 146.5
    assert tip_regulators.extract_monthly("energy", "The price cap for a typical household is £1,758 a year.") is None
    assert tip_regulators.extract_monthly("energy", "Typical household bills are £146.50 per month.") is None  # no "price cap"
    assert tip_regulators.extract_monthly("energy", "price cap typical household £10 a month") is None  # out of bounds


def test_ofcom_extractor_reads_the_figure_for_its_own_category():
    assert tip_regulators.extract_monthly("mobile", OFCOM) == 21.0
    assert tip_regulators.extract_monthly("broadband", OFCOM) == 33.5
    assert tip_regulators.extract_monthly("mobile", "Prices went up last year by £3 a month.") is None
    assert tip_regulators.extract_monthly("mobile", "The average mobile spend is £21 a year.") is None
    assert tip_regulators.extract_monthly("gym", OFCOM) is None  # no regulator


def test_two_different_qualifying_figures_are_ambiguous():
    text = ("The price cap for a typical household is £140 per month by Direct Debit. "
            "The price cap for a typical household is £150 per month by prepayment.")
    assert tip_regulators.extract_monthly("energy", text) is None


def test_fetch_typical_stores_amount_source_and_read_date_or_nothing():
    def good(req):
        assert req.url.host == "www.ofgem.gov.uk"
        return html(f"<p>{OFGEM}</p>")

    stats = tip_pages.new_stats()
    v = run(tip_regulators.fetch_typical("energy", stats, TODAY, client_for(good)))
    assert v == {"figure": 146.5, "source_host": "ofgem.gov.uk", "source_name": "Ofgem", "read_on": "2026-11-02"}
    assert stats["regulator_read"] == 1

    stats = tip_pages.new_stats()
    assert run(tip_regulators.fetch_typical("energy", stats, TODAY, client_for(lambda r: html("<p>nothing</p>")))) is None
    assert stats["regulator_failed"] == 1
    stats = tip_pages.new_stats()
    assert run(tip_regulators.fetch_typical("energy", stats, TODAY, client_for(lambda r: httpx.Response(404)))) is None
    assert stats["regulator_failed"] == 1
    stats = tip_pages.new_stats()
    assert run(tip_regulators.fetch_typical("gym", stats, TODAY, client_for(lambda r: 1 / 0))) is None
    assert stats == tip_pages.new_stats()  # no regulator, no request, no count


def test_stored_value_is_only_accepted_from_the_categorys_own_regulator():
    ok = {"figure": 146.5, "source_host": "ofgem.gov.uk", "source_name": "Ofgem", "read_on": "2026-11-02"}
    assert tip_regulators.valid_typical("energy", ok) == ok
    assert tip_regulators.valid_typical("mobile", ok) is None
    assert tip_regulators.valid_typical("energy", {**ok, "source_name": "Which?"}) is None
    assert tip_regulators.valid_typical("energy", {**ok, "read_on": "soon"}) is None
    assert tip_regulators.valid_typical("energy", {**ok, "figure": 9000}) is None


# ── the card ────────────────────────────────────────────────────────────────

def _energy_doc(**over):
    f = {"typical_low": None, "typical_high": None, "alternatives": [], "deal": None, "sources": [],
         "typical_regulated": {"figure": 146.5, "source_host": "ofgem.gov.uk", "source_name": "Ofgem",
                               "read_on": "2026-11-02"}}
    f.update(over)
    return doc(f)


def test_card_line_text_is_exactly_the_typical_style_with_source_and_date():
    out = si._compose_tip_content("energy", _energy_doc(), [row("British Gas", 303.0, recurring=False, n=3)], None, TODAY)
    assert "Typical: £146.50 a month (Ofgem, 2 Nov 2026)." in out["body"]
    assert out["body"].count("Typical") == 1
    card = {"title": out["title"], "body": out["body"], "lead_line": out["title"],
            "triggered_by": tip_facts.present_triggers("energy", [row("British Gas", 303.0, recurring=False, n=3)])}
    assert tip_facts.card_violations(card, "energy", "Energy") == []
    whole = _energy_doc()
    whole["findings"]["typical_regulated"]["figure"] = 95.0
    out = si._compose_tip_content("energy", whole, [row("British Gas", 303.0)], None, TODAY)
    assert "Typical: £95 a month (Ofgem, 2 Nov 2026)." in out["body"]


def test_no_regulator_figure_means_no_typical_line():
    f = _energy_doc()
    del f["findings"]["typical_regulated"]
    out = si._compose_tip_content("energy", f, [row("British Gas", 303.0)], None, TODAY)
    assert "Typical" not in out["body"]
    gym = _energy_doc()
    out = si._compose_tip_content("gym", gym, [row("PureGym", 25.0)], None, TODAY)
    assert out is None or "Typical" not in out["body"]


def test_typical_shape_is_policed_by_the_card_gate():
    base = {"title": "You pay about £303 a month for energy", "lead_line": "You pay about £303 a month for energy",
            "triggered_by": []}
    bad = dict(base, body="That is based on 3 payments in the last 90 days. Typical: £150 a month. Checked 1 Nov.")
    assert "typical_not_allowed" in tip_facts.card_violations(bad, "energy", "Energy")
    good = dict(base, body="Typical: £150 a month (Ofgem, 2 Nov 2026). Checked 1 Nov.")
    assert tip_facts.card_violations(good, "energy", "Energy") == []
    assert "typical_not_allowed" in tip_facts.card_violations(good, "mortgage", "Mortgage")


def test_regulator_figure_passes_the_shared_document_privacy_guard():
    tr.assert_no_user_data({"findings": {"typical_regulated": {
        "figure": 146.5, "source_host": "ofgem.gov.uk", "source_name": "Ofgem", "read_on": "2026-11-02"}}})
    with pytest.raises(ValueError):
        tr.assert_no_user_data({"findings": {"typical_regulated": {"figure": 1, "extra": 5}}})


# ── whole research, counters ────────────────────────────────────────────────

@pytest.fixture
def research(monkeypatch):
    col = FakeCol()
    monkeypatch.setattr(tr, "tip_research_col", col)
    monkeypatch.setattr(si, "OPENROUTER_API_KEY", "fake")
    requests = []
    state = {"pages": True}

    def handler(req):
        requests.append(req.url.host)
        if not state["pages"]:
            return httpx.Response(500)
        if req.url.host == "www.ofgem.gov.uk":
            return html(OFGEM)
        return html("<p>SIM only plans. Giffgaff 20GB SIM only plan, £10 a month.</p>")

    monkeypatch.setattr(si.httpx, "AsyncClient", lambda *a, **k: client_for(handler))

    async def fake_tavily(query, category_key, outcome, *, pipeline):
        return (["Page uswitch.com: Compare SIM only plans listed for 2026."],
                ["https://www.uswitch.com/mobiles/sim-only/", "https://example.com/seo"])

    class _Resp:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": json.dumps({"alternatives": [ALT]})}}]}

    async def fake_llm(body, **k):
        return _Resp()

    monkeypatch.setattr(si, "_tavily_search", fake_tavily)
    monkeypatch.setattr(si, "openrouter_chat", fake_llm)
    return col, requests, state


def test_research_reads_a_page_listing_and_stores_counters(research):
    col, requests, _ = research
    key = tr.make_key("mobile", None, None)
    res = run(tr.ensure_research(key, si._fetch_market_findings))
    assert res.state == "fetched"
    assert "example.com" not in requests and "www.uswitch.com" in requests
    f = res.doc["findings"]
    assert [a["name"] for a in f["alternatives"]] == ["Giffgaff"]
    stats = res.doc["fetch_stats"]
    assert stats["pages_fetched"] == 1 and stats["pages_failed"] == 0
    assert stats["listings_from_pages"] == 1 and stats["listings_from_snippets"] == 0
    assert "typical_regulated" not in f  # Ofcom page had no usable wording here
    assert stats["regulator_failed"] == 1
    s = run(tr.fetch_summary(14))
    assert s["runs"] == 1 and s["runs_with_listing"] == 1 and s["pages_fetched"] == 1 and s["runs_with_regulator"] == 0


def test_failed_pages_fall_back_to_the_snippet_path_and_count(research):
    col, _, state = research
    state["pages"] = False
    res = run(tr.ensure_research(tr.make_key("mobile", None, None), si._fetch_market_findings))
    assert res.doc["fetch_stats"]["pages_failed"] == 1 and res.doc["fetch_stats"]["pages_fetched"] == 0
    assert res.state == "none" and res.failure == "error"  # snippet alone ties no price: nothing usable, no raise
    assert run(tr.fetch_summary(14))["pages_failed"] == 1


def test_energy_research_stores_the_regulator_figure(research, monkeypatch):
    col, _, _ = research

    async def fake_llm(body, **k):
        class R:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"content": json.dumps({"alternatives": []})}}]}
        return R()

    monkeypatch.setattr(si, "openrouter_chat", fake_llm)
    res = run(tr.ensure_research(tr.make_key("energy", None, None), si._fetch_market_findings))
    assert res.state == "fetched"
    t = res.doc["findings"]["typical_regulated"]
    assert t["figure"] == 146.5 and t["source_name"] == "Ofgem" and len(t["read_on"]) == 10
    assert res.doc["fetch_stats"]["regulator_read"] == 1
    assert run(tr.fetch_summary(14))["runs_with_regulator"] == 1


def test_summary_ignores_runs_older_than_the_window():
    col = FakeCol([{"_id": "a", "fetch_history": [
        {"at": datetime(2026, 10, 1), "pages_fetched": 2, "has_listing": 1},
        {"at": datetime(2026, 11, 1), "pages_fetched": 1, "has_listing": 0}]}])
    import app.services.tip_research as m
    orig = m.tip_research_col
    m.tip_research_col = col
    try:
        s = run(tr.fetch_summary(14, now=datetime(2026, 11, 2)))
    finally:
        m.tip_research_col = orig
    assert s["runs"] == 1 and s["pages_fetched"] == 1
