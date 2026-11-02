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


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """No test in this file can reach a network, whatever the code under test does."""
    import socket

    def blocked(*a, **k):
        raise OSError("network blocked in test")

    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)


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
    assert out == "x. Giffgaff SIM from £10 a month"  # the page title leads the text
    assert "\n" not in out and "var a" not in out
    assert len(tip_pages.html_to_text("a " * 10000)) <= tip_pages.MAX_CHARS


# ── fetching rules ──────────────────────────────────────────────────────────

def test_only_allowlisted_hosts_are_fetched_and_at_most_three_pages():
    seen = []

    def handler(req):
        seen.append(req.url.host)
        assert "SortedTipResearch" in req.headers["user-agent"]
        return html("<p>Page text. Plans from £10 a month.</p>")

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
        return html("Moved page. Giffgaff £10 a month.")

    stats = tip_pages.new_stats()
    out = run(tip_pages.fetch_pages(["https://www.uswitch.com/a"], None, stats, client_for(handler)))
    assert out == {"uswitch.com": "Moved page. Giffgaff £10 a month."}

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


def test_body_is_byte_capped_and_text_is_prefiltered_to_price_sentences():
    big = ("Home about us. " * 30000) + "Intro line. Giffgaff SIM only, £10 a month. " + ("Footer text. " * 30000)

    def handler(req):
        return html(big)

    out = run(tip_pages.fetch_pages(["https://www.uswitch.com/a"], None, tip_pages.new_stats(), client_for(handler)))
    # the price sits beyond the 400 KB cap here, so nothing usable is kept
    assert out == {}
    near = "Home about us. " * 100 + "Intro line. Giffgaff SIM only, £10 a month. " + "Footer text. " * 5000
    out = run(tip_pages.fetch_pages(["https://www.uswitch.com/a"], None, tip_pages.new_stats(), client_for(lambda r: html(near))))
    assert out["uswitch.com"] == "Intro line. Giffgaff SIM only, £10 a month."
    assert len(out["uswitch.com"]) <= tip_pages.PAGE_TEXT_CHARS


def test_price_sentences_keep_lead_in_cap_the_total_and_cut_long_menus():
    text = "Menu. Plans. Gym A is £20 a month. More. Other. Gym B is £30 a month."
    assert tip_pages.price_sentences(text) == "Plans. Gym A is £20 a month. Other. Gym B is £30 a month."
    many = " ".join(f"Item {i}. Cost {i} is £{i} a month." for i in range(500))
    assert len(tip_pages.price_sentences(many)) <= tip_pages.PAGE_TEXT_CHARS
    menu = "Nav " * 300 + "£25 a month " + "Nav " * 300
    assert len(tip_pages.price_sentences(menu)) <= 400 and "£25" in tip_pages.price_sentences(menu)


def test_userinfo_url_is_refused_as_a_first_url_and_never_requested():
    def handler(req):
        raise AssertionError("must not be requested")

    stats = tip_pages.new_stats()
    urls = ["https://ofgem.gov.uk:x@evil.com/", "https://www.uswitch.com@evil.com/p", "https://www.uswitch.com:8443/p",
            "https://user:pw@www.which.co.uk/p"]
    assert run(tip_pages.fetch_pages(urls, None, stats, client_for(handler))) == {}
    assert tip_facts.host_of("https://ofgem.gov.uk:x@evil.com/") == ""
    assert tip_facts.allowed_source_name("https://ofgem.gov.uk:x@evil.com/") is None
    assert tip_pages.safe_https_host("https://ofgem.gov.uk:x@evil.com/") is None
    assert tip_pages.safe_https_host("https://www.Ofgem.gov.uk:443/a") == "ofgem.gov.uk"
    assert si._clean_sources(["https://ofgem.gov.uk:x@evil.com/"]) == []


def test_userinfo_redirect_location_is_refused_and_counted():
    hits = []

    def handler(req):
        hits.append(req.url.host)
        if req.url.host == "www.uswitch.com":
            return httpx.Response(302, headers={"location": "https://uswitch.com:x@evil.com/p"})
        raise AssertionError("evil host must not be requested")

    stats = tip_pages.new_stats()
    assert run(tip_pages.fetch_pages(["https://www.uswitch.com/a"], None, stats, client_for(handler))) == {}
    assert stats["pages_failed"] == 1 and hits == ["www.uswitch.com"]


def _stream_handler(chunks, headers, state):
    async def body():
        yield b"Giffgaff SIM only, \xc2\xa310 a month. "
        for _ in range(chunks):
            state["sent"] += 1
            yield b"x" * 8000 + b" "

    def handler(req):
        return httpx.Response(200, content=body(), headers=headers)

    return handler


def test_streamed_body_stops_at_the_byte_cap():
    state = {"sent": 0}
    handler = _stream_handler(100, {"content-type": "text/html"}, state)
    stats = tip_pages.new_stats()
    out = run(tip_pages.fetch_pages(["https://www.uswitch.com/a"], None, stats, client_for(handler)))
    assert state["sent"] < 100  # reading stopped at the cap, not after the whole 800 KB
    assert tip_pages.MAX_BYTES // 8001 - 2 <= state["sent"] <= tip_pages.MAX_BYTES // 8001 + 3
    assert out["uswitch.com"].startswith("Giffgaff SIM only, £10 a month.")
    assert stats["pages_fetched"] == 1


def test_streamed_gzip_body_is_refused_before_any_chunk_is_read():
    state = {"sent": 0}
    handler = _stream_handler(100, {"content-type": "text/html", "content-encoding": "gzip"}, state)
    stats = tip_pages.new_stats()
    assert run(tip_pages.fetch_pages(["https://www.uswitch.com/a"], None, stats, client_for(handler))) == {}
    assert state["sent"] == 0 and stats["pages_failed"] == 1


def test_compressed_body_is_refused_and_request_asks_for_identity():
    seen = {}

    def handler(req):
        seen["ae"] = req.headers.get("accept-encoding")
        return httpx.Response(200, content=b"x", headers={"content-type": "text/html", "content-encoding": "gzip"})

    stats = tip_pages.new_stats()
    assert run(tip_pages.fetch_pages(["https://www.uswitch.com/a"], None, stats, client_for(handler))) == {}
    assert seen["ae"] == "identity" and stats["pages_failed"] == 1


def test_total_deadline_bounds_a_slow_page(monkeypatch):
    monkeypatch.setattr(tip_pages, "TOTAL_DEADLINE", 0.05)

    async def slow(req):
        await asyncio.sleep(1)
        return html("£1")

    stats = tip_pages.new_stats()
    assert run(tip_pages.fetch_pages(["https://www.uswitch.com/a"], None, stats, client_for(slow))) == {}
    assert stats["pages_failed"] == 1


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


def test_a_list_of_providers_before_a_price_yields_no_listing():
    text = "Page uswitch.com: Octopus, EDF, British Gas deals from £146 a month on tariffs"
    for nm, ptype, cat in (("EDF", "energy_tariff", "energy"), ("British Gas", "energy_tariff", "energy"),
                           ("Octopus", "energy_tariff", "energy")):
        p = {"alternatives": [{"name": nm, "price": 146, "product_type": ptype, "basis": "month",
                               "source_url": "https://www.uswitch.com/e/"}]}
        f, _, v = si._build_findings(p, text, URLS, cat, TODAY)
        assert f is None, nm
    for text in ("Page uswitch.com: Octopus and EDF from £146 a month", "Page uswitch.com: EDF & Octopus from £146 a month",
                 "Page uswitch.com: Octopus or EDF from £146 a month"):
        p = {"alternatives": [{"name": "EDF", "price": 146, "product_type": "energy_tariff", "basis": "month",
                               "source_url": "https://www.uswitch.com/e/"}]}
        assert si._build_findings(p, text, URLS, "energy", TODAY)[0] is None
    one = "Page uswitch.com: EDF standard variable tariff from £146 a month"
    p = {"alternatives": [{"name": "EDF", "price": 146, "product_type": "energy_tariff", "basis": "month",
                           "source_url": "https://www.uswitch.com/e/"}]}
    assert si._build_findings(p, one, URLS, "energy", TODAY)[0]["alternatives"][0]["name"] == "EDF"


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
             "typical_regulated": REG})
    out = si._compose_tip_content("mortgage", d, [row("Mtg", 1124.44, last="2026-10-01")], None, TODAY)
    assert "Typical" not in out["body"]


# ── regulator extractor (Ofgem price cap press release) ─────────────────────

REG = {"figure_annual": 1723.0, "period_start": "2026-10-01", "source_host": "ofgem.gov.uk", "source_name": "Ofgem",
       "source_url": "https://www.ofgem.gov.uk/press-release/price-cap-rise-example", "read_on": "2026-11-02"}
PRESS = ("Ofgem announces the price cap for October to December 2026. The current price cap for a typical household "
         "paying by direct debit for gas and electricity is £1,663 a year. From 1 October to 31 December 2026 it will "
         "rise by £60 per year (or £5 per month) to £1,723. Other costs apply.")
OCT, SEP = datetime(2026, 11, 2).date(), datetime(2026, 9, 15).date()


def test_august_style_release_read_in_november_gives_the_new_level_and_period():
    assert tip_regulators.extract_annual("energy", PRESS, OCT) == (1723.0, datetime(2026, 10, 1).date())
    assert tip_regulators.current_period(OCT) == (datetime(2026, 10, 1).date(), datetime(2026, 12, 31).date())
    assert tip_regulators.current_period(datetime(2026, 2, 3).date()) == (datetime(2026, 1, 1).date(), datetime(2026, 3, 31).date())
    assert tip_regulators.current_period(datetime(2026, 5, 3).date())[1] == datetime(2026, 6, 30).date()
    assert tip_regulators.current_period(datetime(2026, 8, 3).date())[1] == datetime(2026, 9, 30).date()


REAL = ("<html><head><title>Energy price cap will rise by 4% from October 2026</title></head><body><p>"
        "The current price cap for a typical household paying by direct debit for gas and electricity is £1,663. "
        "Based on the energy use of a typical domestic household, from October, the price cap will rise by £60 per "
        "year (or £5 per month) to £1,723.</p></body></html>")


def test_verbatim_real_wording_gives_the_new_level_not_the_outgoing_cap():
    text = tip_pages.html_to_text(REAL, limit=10000)
    assert tip_regulators.extract_annual("energy", text, OCT) == (1723.0, datetime(2026, 10, 1).date())
    assert tip_regulators.extract_annual("energy", text, SEP) is None
    assert tip_regulators.monthly_for(1723.0) == 144


def test_a_rise_page_whose_to_sentence_fails_the_window_gives_none_not_the_is_figure():
    page = ("October 2026. The price cap for a typical household paying by direct debit is £1,663 a year. "
            + "Filler words about energy markets and wholesale costs. " * 8
            + "The price cap will rise by £60 per year to £1,723.")
    assert tip_regulators.extract_annual("energy", page, OCT) is None
    no_rise = page.split("Filler")[0]
    assert tip_regulators.extract_annual("energy", no_rise, OCT)[0] == 1663.0


def test_is_set_to_rise_wording_counts_with_or_without_will():
    ok = ("October 2026. The price cap for a typical household paying by direct debit is £1,663 a year. "
          "The cap is set to rise by £60 per year to £1,723.")
    assert tip_regulators.extract_annual("energy", ok, OCT) == (1723.0, datetime(2026, 10, 1).date())
    for phrase in ("Rising by £60 per year to", "The cap is set to fall by £60 per year to", "Bills go up by £60 to",
                   "It increases by £60 to", "The level changes to"):
        page = ("October 2026. The price cap for a typical household paying by direct debit is £1,663 a year. "
                + phrase + " £1,723.")
        got = tip_regulators.extract_annual("energy", page, OCT)
        assert got is not None and got[0] == 1723.0, phrase
    far = ("October 2026. The price cap for a typical household paying by direct debit is £1,663 a year. "
           + "Filler words about energy markets and wholesale costs. " * 8
           + "The cap is set to rise by £60 per year to £1,723.")
    assert tip_regulators.extract_annual("energy", far, OCT) is None
    far2 = far.replace("is set to rise", "is rising").replace("rise by", "by")
    assert tip_regulators.extract_annual("energy", far2, OCT) is None


def test_period_not_current_gives_none():
    assert tip_regulators.extract_annual("energy", PRESS, SEP) is None  # same page read in September: future release
    older = PRESS.replace("October to December 2026", "July 2026").replace("1 October to 31 December 2026", "1 July to 30 September 2026")
    assert tip_regulators.extract_annual("energy", older, OCT) is None  # older release naming July 2026
    assert tip_regulators.extract_annual("energy", older, datetime(2026, 8, 1).date()) == (1723.0, datetime(2026, 7, 1).date())


def test_period_may_be_named_by_the_title_or_the_day_pair():
    html_page = f"<html><head><title>Price cap October 2026</title></head><body><p>{PRESS.replace('October to December 2026', 'the quarter').replace('1 October to 31 December 2026', 'then')}</p></body></html>"
    assert tip_pages.html_to_text(html_page, limit=10000).startswith("Price cap October 2026.")
    only = "The price cap for a typical household paying by direct debit is £1,663 a year from 1 October until 31 December."
    assert tip_regulators.extract_annual("energy", only, OCT) == (1663.0, datetime(2026, 10, 1).date())


def test_current_period_page_with_only_an_is_sentence_gives_that_figure():
    only = "October 2026. The price cap for a typical household paying by direct debit is £1,663 a year."
    assert tip_regulators.extract_annual("energy", only, OCT)[0] == 1663.0


def test_ofgem_extractor_is_none_when_wording_is_absent_or_ambiguous():
    assert tip_regulators.extract_annual("energy", "October 2026. The price cap is £1,663 a year.", OCT) is None
    assert tip_regulators.extract_annual("energy", "October 2026. A typical household pays by direct debit £1,663 a year.", OCT) is None
    assert tip_regulators.extract_annual("energy", "October 2026 price cap typical household direct debit £50 a year", OCT) is None
    assert tip_regulators.extract_annual("energy", "October 2026 price cap typical household direct debit £9,000 a year", OCT) is None
    two = ("October 2026. The price cap for a typical household paying by direct debit is £1,663 a year. "
           "The price cap for a typical household paying by direct debit is £1,723 a year.")
    assert tip_regulators.extract_annual("energy", two, OCT) is None
    two_to = ("October 2026. The price cap for a typical household paying by direct debit will rise to £1,723 a year. "
              "The price cap for a typical household paying by direct debit will fall to £1,650 a year.")
    assert tip_regulators.extract_annual("energy", two_to, OCT) is None
    assert tip_regulators.extract_annual("mobile", PRESS, OCT) is None and tip_regulators.extract_annual("broadband", PRESS, OCT) is None
    assert set(tip_regulators.REGULATORS) == {"energy"}


def test_fetch_typical_searches_once_picks_ofgem_urls_and_stores_source():
    queries, hosts = [], []

    async def search(q):
        queries.append(q)
        return ([], ["https://example.com/seo", "https://www.ofgem.gov.uk/press-release/a", "https://www.uswitch.com/e/"])

    def handler(req):
        hosts.append(req.url.host)
        return html(f"<p>{PRESS}</p>")

    stats = tip_pages.new_stats()
    v = run(tip_regulators.fetch_typical("energy", stats, TODAY, search, client_for(handler)))
    assert queries == ['site:ofgem.gov.uk "price cap" "typical household"'] and hosts == ["www.ofgem.gov.uk"]
    assert v == {"figure_annual": 1723.0, "period_start": "2026-10-01", "source_host": "ofgem.gov.uk", "source_name": "Ofgem",
                 "source_url": "https://www.ofgem.gov.uk/press-release/a", "read_on": "2026-11-02"}
    assert stats["regulator_read"] == 1


def test_fetch_typical_returns_none_and_counts_on_every_failure():
    async def one_url(q):
        return ([], ["https://www.ofgem.gov.uk/press-release/a"])

    async def none_search(q):
        return None

    async def boom(q):
        raise RuntimeError("x")

    for search, handler in ((one_url, lambda r: html("<p>nothing</p>")), (one_url, lambda r: httpx.Response(404)),
                            (none_search, lambda r: 1 / 0), (boom, lambda r: 1 / 0)):
        stats = tip_pages.new_stats()
        assert run(tip_regulators.fetch_typical("energy", stats, TODAY, search, client_for(handler))) is None
        assert stats["regulator_failed"] == 1 and stats["regulator_read"] == 0
    stats = tip_pages.new_stats()

    async def never(q):
        raise AssertionError("no search without a regulator")

    assert run(tip_regulators.fetch_typical("gym", stats, TODAY, never)) is None
    assert stats == tip_pages.new_stats()


def test_stored_value_is_only_accepted_from_the_categorys_own_regulator():
    assert tip_regulators.valid_typical("energy", REG) == REG
    assert tip_regulators.valid_typical("energy", REG, OCT) == REG
    assert tip_regulators.valid_typical("energy", REG, datetime(2027, 1, 5).date()) is None  # period moved on
    assert tip_regulators.valid_typical("energy", {**REG, "period_start": "later"}) is None
    assert tip_regulators.valid_typical("mobile", REG) is None
    assert tip_regulators.valid_typical("energy", {**REG, "source_name": "Which?"}) is None
    assert tip_regulators.valid_typical("energy", {**REG, "read_on": "soon"}) is None
    assert tip_regulators.valid_typical("energy", {**REG, "figure_annual": 90000}) is None
    assert tip_regulators.valid_typical("energy", {**REG, "source_url": "https://evil.com/x"}) is None
    assert tip_regulators.valid_typical("energy", {**REG, "source_url": "https://ofgem.gov.uk:x@evil.com/"}) is None


# ── the card ────────────────────────────────────────────────────────────────

def _energy_doc(**over):
    f = {"typical_low": None, "typical_high": None, "alternatives": [], "deal": None, "sources": [],
         "typical_regulated": dict(REG)}
    f.update(over)
    return doc(f)


def test_card_line_text_is_exactly_the_typical_style_with_source_and_date():
    rows = [row("British Gas", 303.0, recurring=False, n=3)]
    out = si._compose_tip_content("energy", _energy_doc(), rows, None, TODAY)
    assert "Typical: £144 a month (Ofgem price cap £1,723 a year from 1 October 2026, read 2 Nov 2026)." in out["body"]
    assert out["body"].count("Typical") == 1
    card = {"title": out["title"], "body": out["body"], "lead_line": out["title"],
            "triggered_by": tip_facts.present_triggers("energy", rows)}
    assert tip_facts.card_violations(card, "energy", "Energy") == []
    assert tip_regulators.monthly_for(1663.0) == 139 and tip_regulators.monthly_for(1758.0) == 147


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
    bad2 = dict(base, body="Typical: £150 a month (Ofgem, 2 Nov 2026). Checked 1 Nov.")
    assert "typical_not_allowed" in tip_facts.card_violations(bad2, "energy", "Energy")
    assert "typical_not_allowed" in tip_facts.card_violations(bad, "energy", "Energy")
    good = dict(base, body="Typical: £144 a month (Ofgem price cap £1,723 a year from 1 October 2026, read 2 Nov 2026). Checked 1 Nov.")
    assert tip_facts.card_violations(good, "energy", "Energy") == []
    assert "typical_not_allowed" in tip_facts.card_violations(good, "mortgage", "Mortgage")


def test_regulator_figure_passes_the_shared_document_privacy_guard():
    tr.assert_no_user_data({"findings": {"typical_regulated": dict(REG)}})
    with pytest.raises(ValueError):
        tr.assert_no_user_data({"findings": {"typical_regulated": {"figure_annual": 1, "extra": 5}}})
    with pytest.raises(ValueError):
        tr.assert_no_user_data({"findings": {"typical_regulated": {**REG, "source_url": "https://www.ofgem.gov.uk/a?x=1"}}})


# ── whole research, counters ────────────────────────────────────────────────

@pytest.fixture
def research(monkeypatch):
    col = FakeCol()
    monkeypatch.setattr(tr, "tip_research_col", col)
    monkeypatch.setattr(si, "OPENROUTER_API_KEY", "fake")
    requests = []
    searches = []
    state = {"pages": True, "searches": searches}

    def handler(req):
        requests.append(req.url.host)
        if not state["pages"]:
            return httpx.Response(500)
        if req.url.host == "www.ofgem.gov.uk":
            return html(f"<p>{PRESS}</p>")
        return html("<p>SIM only plans. Giffgaff 20GB SIM only plan, £10 a month.</p>")

    monkeypatch.setattr(si.httpx, "AsyncClient", lambda *a, **k: client_for(handler))

    async def fake_tavily(query, category_key, outcome, *, pipeline):
        searches.append(query)
        if query.startswith("site:ofgem.gov.uk"):
            return ([], ["https://www.ofgem.gov.uk/press-release/a"])
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
    assert "typical_regulated" not in f
    assert stats["regulator_failed"] == 0 and stats["regulator_read"] == 0  # mobile has no regulator
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
    col, _, state = research

    async def fake_llm(body, **k):
        class R:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"content": json.dumps({"alternatives": []})}}]}
        return R()

    monkeypatch.setattr(si, "openrouter_chat", fake_llm)
    monkeypatch.setattr(si.timeutil, "user_today", lambda: OCT)
    res = run(tr.ensure_research(tr.make_key("energy", None, None), si._fetch_market_findings))
    assert res.state == "fetched"
    t = res.doc["findings"]["typical_regulated"]
    assert t["figure_annual"] == 1723.0 and t["period_start"] == "2026-10-01" and t["source_name"] == "Ofgem" and len(t["read_on"]) == 10
    assert t["source_url"] == "https://www.ofgem.gov.uk/press-release/a"
    assert sum(q.startswith("site:ofgem.gov.uk") for q in state["searches"]) == 1
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
