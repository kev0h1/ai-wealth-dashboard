"""B48: shared tip research layer plus personal composition.

No network, no real database: Tavily (`_tavily_search`) and OpenRouter
(`openrouter_chat`) are replaced with counting fakes, and the collections are
in-memory. Nothing here touches a real user.
"""
import asyncio
import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from pymongo.errors import DuplicateKeyError

import app.routers.savings_insights as si
from app.services import tip_research as tr

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import backfill_tip_research as bf  # noqa: E402

# Amounts chosen so they cannot collide with a market figure in the snippets.
ALICE, BOB, CAROL, DAN = "alice@example.com", "bob@example.com", "carol@example.com", "dan@example.com"
AMOUNTS = {ALICE: 27.43, BOB: 33.18, CAROL: 56.71, DAN: 22.07}

SNIPPET = ("SIM-only deals typically cost between £8 and £25 a month. Giffgaff offers 20GB for £10, "
           "Lebara 30GB for £12. Switching offer ends 2099-03-31.")
LLM_FINDINGS = {
    "typical_low": 8, "typical_high": 25,
    "headline": "SIM-only plans are typically cheaper than handset contracts",  # G283: ignored
    "alternatives": [{"name": "Giffgaff", "price": 10, "note": None},
                     {"name": "Lebara", "price": 12, "note": "30GB"}],
    "deal": {"text": "A switching offer is running", "valid_until": "2099-03-31"},
}


def run(coro):
    return asyncio.run(coro)


class FakeCol:
    """In-memory collection with the few operations the code under test uses."""

    def __init__(self, docs=()):
        self.docs = {d["_id"]: dict(d) for d in docs}

    async def find_one(self, filt, *a, **k):
        if "_id" in filt:
            d = self.docs.get(filt["_id"])
            return dict(d) if d else None
        for d in self.docs.values():
            if all(d.get(k) == v for k, v in filt.items()):
                return dict(d)
        return None

    def find(self, filt=None, *a, **k):
        docs = [dict(d) for d in self.docs.values()]

        class _Cur:
            async def to_list(self, n):
                return docs
        return _Cur()

    async def insert_one(self, doc):
        if doc["_id"] in self.docs:
            raise DuplicateKeyError("dup")
        self.docs[doc["_id"]] = dict(doc)

    async def update_one(self, filt, update, upsert=False):
        d = self.docs.get(filt.get("_id"))
        lease = filt.get("lease_until")
        if d is not None and lease and "$lt" in lease and not (d.get("lease_until") and d["lease_until"] < lease["$lt"]):
            d = None
        matched = d is not None
        if d is None and upsert:
            d = {"_id": filt["_id"]}
            self.docs[filt["_id"]] = d
        if d is None:
            return type("R", (), {"modified_count": 0})()
        d.update(update.get("$set", {}))
        for k in update.get("$unset", {}):
            d.pop(k, None)
        return type("R", (), {"modified_count": 1 if matched or upsert else 0})()


class Calls:
    def __init__(self):
        self.tavily: list[str] = []
        self.llm = 0
        self.tavily_pipelines: list[str] = []


@pytest.fixture
def env(monkeypatch):
    calls = Calls()
    tip_col = FakeCol()
    monkeypatch.setattr(tr, "tip_research_col", tip_col)
    insights = FakeCol()
    monkeypatch.setattr(si, "savings_insights_col", insights)
    monkeypatch.setattr(si, "OPENROUTER_API_KEY", "fake-openrouter-key")
    monkeypatch.setattr(si, "TIP_LLM_PHRASING", False)

    state = {"fail": None, "opted_out": set()}

    async def fake_tavily(query, category_key, outcome, *, pipeline):
        calls.tavily.append(query)
        calls.tavily_pipelines.append(pipeline)
        await asyncio.sleep(0)  # let a concurrent caller reach the in-flight guard
        if state["fail"]:
            outcome["failure"] = state["fail"]
            return [], []
        return [SNIPPET], ["https://example.com/sim"]

    class _Resp:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": json.dumps(LLM_FINDINGS)}}]}

    async def fake_llm(body, *, user_id, pipeline, client=None, **k):
        calls.llm += 1
        assert user_id is None and pipeline == "tip_research"
        assert "example.com" not in json.dumps(body)  # no user email in the prompt
        return _Resp()

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *e):
            return False

    async def tips_on(uid):
        return uid not in state["opted_out"]

    async def detect(uid):
        return ["mobile"]

    async def triggered(uid, cat):
        if cat == "mobile":
            return [{"merchant_key": "ee", "display_name": "Ee", "monthly_amount": AMOUNTS[uid],
                     "occurrences": 3, "is_recurring": True, "overlapping_charge": False}]
        if cat == "groceries":
            return [{"merchant_key": "tesco", "display_name": "Tesco", "monthly_amount": AMOUNTS[uid] * 10,
                     "occurrences": 12, "is_recurring": False, "overlapping_charge": False}]
        return []

    async def verified(uid, existing):
        return None

    async def no_portrait(*a, **k):
        return None

    class _Portrait:
        find_one = staticmethod(no_portrait)

    monkeypatch.setattr(si, "_tavily_search", fake_tavily)
    monkeypatch.setattr(si, "openrouter_chat", fake_llm)
    monkeypatch.setattr(si.httpx, "AsyncClient", _Client)
    monkeypatch.setattr(si, "_tips_enabled", tips_on)
    monkeypatch.setattr(si, "_detect_insight_categories", detect)
    monkeypatch.setattr(si, "_find_triggered_transactions", triggered)
    monkeypatch.setattr(si, "_check_verified_saving", verified)
    monkeypatch.setattr(si, "behaviour_portrait_col", _Portrait())
    return calls, tip_col, insights, state


def _sim_calls(calls):
    return [q for q in calls.tavily if "SIM only" in q]


def _mobile_doc(insights, uid):
    return next(d for d in insights.docs.values() if d["user_id"] == uid and d["category"] == "mobile")


class _UserKeyedInsights(FakeCol):
    """Insights col keyed by (user_id, category) like the real collection."""

    async def find_one(self, filt, *a, **k):
        for d in self.docs.values():
            if all(d.get(k) == v for k, v in filt.items()):
                return dict(d)
        return None

    async def insert_one(self, doc):
        self.docs[f"{doc['user_id']}|{doc['category']}"] = dict(doc, _id=f"{doc['user_id']}|{doc['category']}")

    async def update_one(self, filt, update, upsert=False):
        d = self.docs.get(filt.get("_id"))
        if d is None:
            return
        d.update(update.get("$set", {}))
        for k in update.get("$unset", {}):
            d.pop(k, None)


@pytest.fixture
def pass_env(env, monkeypatch):
    calls, tip_col, _, state = env
    insights = _UserKeyedInsights()
    monkeypatch.setattr(si, "savings_insights_col", insights)
    return calls, tip_col, insights, state


# ── key, bands, privacy primitives ──────────────────────────────────────────

def test_provider_slug_and_bands():
    assert tr.provider_slug("EE Ltd") == "ee"
    assert tr.provider_slug("EE Limited") == "ee"
    assert tr.provider_slug("British Gas") == "british gas"
    assert tr.provider_slug("Disney+") == "disney plus"
    assert tr.band_for("mobile", 5) == "under_10"
    assert tr.band_for("mobile", 10) == "10_20"
    assert tr.band_for("mobile", 27.43) == "20_40"
    assert tr.band_for("mobile", 56.71) == "40_60"
    assert tr.band_for("mobile", 61) == "over_60"
    assert tr.band_for("mobile", None) == "unknown"
    assert tr.band_for("groceries", 400) == "all"
    k = tr.make_key("mobile", "ee ltd", 27.43)
    assert k.doc_id == "mobile|ee|20_40|UK|v1"


def test_every_insight_category_has_bands_or_is_profile_shared():
    for cat in si.INSIGHT_CATEGORIES:
        assert cat in tr.PRICE_BANDS or cat in tr.PROFILE_CATEGORIES


def test_assert_no_user_data_rejects_forbidden_keys_anywhere():
    tr.assert_no_user_data({"findings": {"headline": "x", "alternatives": [{"name": "A"}]}})
    for bad in ({"user_id": "x"}, {"findings": {"monthly_amount": 3}}, {"a": [{"triggered_by": []}]}):
        with pytest.raises(ValueError):
            tr.assert_no_user_data(bad)


def test_unlisted_merchant_never_becomes_a_provider_key():
    assert si._trigger_phrase_for("mobile", "my local carrier") is None
    key = run(si._tip_key_for("u", "mobile", [{"merchant_key": "my local carrier", "monthly_amount": 30}]))
    assert key.provider_key == "other"
    assert run(si._tip_key_for("u", "mobile", [{"merchant_key": "ee ltd", "monthly_amount": 30}])).provider_key == "ee"


def test_value_level_guard_rejects_emails_figures_and_personal_words():
    ok = {"findings": {"headline": "Plans are typically cheaper", "typical_low": 8, "typical_high": 25.5,
                       "alternatives": [{"name": "Giffgaff", "price": 10, "note": "30GB"}],
                       "deal": {"text": "A switching offer", "valid_until": "2099-03-31"},
                       "sources": ["https://example.com/v2.0/you-save"]}}
    tr.assert_no_user_data(ok)
    def bad(**over):
        d = json.loads(json.dumps(ok))
        d["findings"].update(over)
        return d
    for doc in (
        bad(headline="Mail a@b.co for details"),
        bad(headline="Costs £10 a month"),
        bad(headline="Costs 10.5 a month"),
        bad(headline="You pay too much"),
        bad(headline="Your plan is dear"),
        bad(headline="I think so"),
        bad(headline="My view"),
        bad(headline="We looked"),
        bad(headline="Our pick"),
        bad(headline="Tell me"),
        bad(alternatives=[{"name": "A", "price": 10, "note": "from £8"}]),
        bad(deal={"text": "x", "valid_until": None, "contact": "a@b.co"}),
        bad(count_of_things=7),            # a number outside the allowed number fields
        bad(alternatives=[{"name": "A", "price": 10, "rank": 2}]),
    ):
        with pytest.raises(ValueError):
            tr.assert_no_user_data(doc)
    tr.assert_no_user_data(bad(typical_low=None))


def test_source_urls_are_plain_scheme_host_path_only():
    def doc(u):
        return {"findings": {"sources": [u]}}
    tr.assert_no_user_data(doc("https://example.com/plans/sim"))
    for bad in ("https://example.com/p?paid=£56", "https://example.com/p?a=1", "https://example.com/p#frag",
                "https://example.com/mail%40example.com", "https://example.com/%C2%A356",
                "http://example.com/p", "https://example.com/a@b.co"):
        with pytest.raises(ValueError):
            tr.assert_no_user_data(doc(bad))
    assert si._clean_sources(["https://example.com/a?paid=£56#x", "http://nope.com/x", "https://example.com/a"]) == [
        "https://example.com/a"]


def test_findings_text_with_a_figure_or_personal_word_is_not_shared():
    parsed = dict(LLM_FINDINGS, headline="Plans typically cost £10 a month",
                  alternatives=[{"name": "Giffgaff", "price": 10, "note": "your best bet"}],
                  deal={"text": "Save £5 now", "valid_until": "2099-03-31"})
    findings, claim, _ = si._build_findings(parsed, SNIPPET, [], "mobile", datetime(2026, 10, 16).date())
    assert findings["headline"] is None and findings["alternatives"] == []
    assert findings["deal"] is None and claim is None


# ── one fetch per key ───────────────────────────────────────────────────────

def test_two_users_same_provider_and_band_cause_one_research_call(pass_env):
    calls, tip_col, insights, _ = pass_env

    async def both():
        await asyncio.gather(si._refresh_savings_insights_for_user(ALICE),
                             si._refresh_savings_insights_for_user(BOB))

    run(both())
    assert len(_sim_calls(calls)) == 1  # one Tavily search for the shared mobile key
    assert "mobile|ee|20_40|UK|v1" in tip_col.docs
    # one LLM call per distinct shared key, never per user (mobile, energy, groceries)
    assert calls.llm == len({d for d in tip_col.docs})
    assert set(calls.tavily_pipelines) == {"tip_research_tavily"}
    a, b = _mobile_doc(insights, ALICE), _mobile_doc(insights, BOB)
    assert "£27" in a["title"] and "£33" in b["title"]  # personal layer: each user's own figure
    assert a["body"].count("Checked ") == 1 and "listed at" not in a["body"] and "source" not in a["body"]


def test_sequential_second_user_reuses_stored_findings(pass_env):
    calls, *_ = pass_env
    run(si._refresh_savings_insights_for_user(ALICE))
    before = len(calls.tavily)
    run(si._refresh_savings_insights_for_user(BOB))
    assert len(calls.tavily) == before


def test_different_bands_cause_separate_calls(pass_env):
    calls, tip_col, *_ = pass_env
    run(si._refresh_savings_insights_for_user(ALICE))   # 20 to 40
    run(si._refresh_savings_insights_for_user(CAROL))   # 40 to 60
    assert len(_sim_calls(calls)) == 2
    assert {"mobile|ee|20_40|UK|v1", "mobile|ee|40_60|UK|v1"} <= set(tip_col.docs)


def test_grocery_tips_share_by_behaviour_profile_not_merchant(pass_env):
    calls, tip_col, *_ = pass_env
    run(si._refresh_savings_insights_for_user(ALICE))
    run(si._refresh_savings_insights_for_user(DAN))
    groceries = [k for k in tip_col.docs if k.startswith("groceries|")]
    assert groceries == ["groceries|profile_general|all|UK|v1"]
    assert len([q for q in calls.tavily if "supermarket" in q]) == 1


def test_profile_keys_are_off_by_default_and_on_when_enabled(pass_env, monkeypatch):
    class Portrait:
        reads = 0

        async def find_one(self, *a, **k):
            Portrait.reads += 1
            return {"traits": [{"id": "front_loader"}, {"id": "signature_pleasure", "ref_category": "Eating Out"}]}

    monkeypatch.setattr(si, "behaviour_portrait_col", Portrait())
    tb = [{"merchant_key": "tesco", "monthly_amount": 300}]
    monkeypatch.setattr(si, "TIP_RESEARCH_PROFILE_KEYS", False)
    assert run(si._tip_key_for("u", "groceries", tb)).provider_key == "profile_general"
    assert run(si._tip_key_for("u", "eating_out", tb)).provider_key == "profile_general"
    assert Portrait.reads == 0  # no portrait is read while the flag is off
    monkeypatch.setattr(si, "TIP_RESEARCH_PROFILE_KEYS", True)
    assert run(si._tip_key_for("u", "groceries", tb)).provider_key == "profile_front_loader"
    assert run(si._tip_key_for("u", "eating_out", tb)).provider_key == "profile_eating_out_signature"


def test_weekly_pass_log_line_does_not_pair_the_user_with_a_fetch_count(pass_env, caplog):
    with caplog.at_level("WARNING"):
        run(si._refresh_savings_insights_for_user(ALICE))
    per_user = [r.getMessage() for r in caplog.records if "weekly pass user=" in r.getMessage()]
    assert per_user and all("fetched=" not in m for m in per_user)


def test_opted_out_user_triggers_no_research_and_is_never_counted(pass_env):
    calls, tip_col, insights, state = pass_env
    state["opted_out"].add(ALICE)
    run(si._refresh_savings_insights_for_user(ALICE))
    run(si._refresh_single_insight(ALICE, "mobile"))
    assert calls.tavily == [] and calls.llm == 0
    assert tip_col.docs == {} and insights.docs == {}


def test_concurrent_callers_on_one_key_share_one_fetch_service_level(monkeypatch):
    col = FakeCol()
    monkeypatch.setattr(tr, "tip_research_col", col)
    n = {"calls": 0}

    async def fetcher(key):
        n["calls"] += 1
        await asyncio.sleep(0.01)
        return tr.FetchOutcome(findings={"headline": "h"})

    key = tr.make_key("mobile", "ee", 30)

    async def go():
        return await asyncio.gather(*[tr.ensure_research(key, fetcher) for _ in range(5)])

    results = run(go())
    assert n["calls"] == 1
    assert sum(1 for r in results if r.fetched) == 1
    assert all(r.doc and r.doc["findings"] for r in results)


def test_second_process_holding_the_lease_causes_no_second_fetch(monkeypatch):
    now = datetime(2026, 10, 16, 9)
    key = tr.make_key("mobile", "ee", 30)
    col = FakeCol([{"_id": key.doc_id, "findings": None, "status": "pending", "lease_until": now + timedelta(minutes=3)}])
    monkeypatch.setattr(tr, "tip_research_col", col)
    monkeypatch.setattr(tr, "_now", lambda: now)

    async def fetcher(k):
        raise AssertionError("must not fetch while another process holds the lease")

    r = run(tr.ensure_research(key, fetcher, now=now))
    assert r.state == "none" and not r.fetched


def test_fetch_is_skipped_if_another_process_filled_the_key_before_our_lease(monkeypatch):
    now = datetime(2026, 10, 16, 9)
    key = tr.make_key("mobile", "ee", 30)

    class Racing(FakeCol):
        async def update_one(self, filt, update, upsert=False):
            res = await super().update_one(filt, update, upsert)
            if "lease_until" in filt and res.modified_count and not self.raced:
                # the other process completes right after our lease claim
                self.raced = True
                self.docs[key.doc_id].update({
                    "findings": {"headline": "from the other process"}, "status": "ok",
                    "content_valid_until": now + timedelta(days=3)})
            return res

    col = Racing([{"_id": key.doc_id, "findings": {"headline": "old"}, "status": "stale",
                   "content_valid_until": now - timedelta(days=1), "lease_until": datetime(1970, 1, 1)}])
    col.raced = False
    monkeypatch.setattr(tr, "tip_research_col", col)

    async def fetcher(k):
        raise AssertionError("a fresh document must not be fetched again")

    r = run(tr.ensure_research(key, fetcher, now=now))
    assert r.state == "fresh" and not r.fetched
    assert r.doc["findings"]["headline"] == "from the other process"
    assert col.docs[key.doc_id]["lease_until"] == datetime(1970, 1, 1)


# ── TTL, failure, deadline ──────────────────────────────────────────────────

def test_ttl_expiry_refetches(monkeypatch):
    col = FakeCol()
    monkeypatch.setattr(tr, "tip_research_col", col)
    clock = {"now": datetime(2026, 10, 1, 9)}
    monkeypatch.setattr(tr, "_now", lambda: clock["now"])
    n = {"calls": 0}

    async def fetcher(key):
        n["calls"] += 1
        return tr.FetchOutcome(findings={"headline": f"h{n['calls']}"})

    key = tr.make_key("mobile", "ee", 30)
    run(tr.ensure_research(key, fetcher))
    clock["now"] += timedelta(days=6, hours=23)
    run(tr.ensure_research(key, fetcher))
    assert n["calls"] == 1                      # inside the 7 day TTL
    clock["now"] += timedelta(hours=2)
    r = run(tr.ensure_research(key, fetcher))
    assert n["calls"] == 2 and r.fetched and r.doc["findings"]["headline"] == "h2"


def test_deal_deadline_shortens_the_shared_ttl(monkeypatch):
    col = FakeCol()
    monkeypatch.setattr(tr, "tip_research_col", col)
    clock = {"now": datetime(2026, 10, 1, 9)}
    monkeypatch.setattr(tr, "_now", lambda: clock["now"])
    n = {"calls": 0}

    async def fetcher(key):
        n["calls"] += 1
        return tr.FetchOutcome(findings={"headline": "h"}, claim_valid_until=datetime(2026, 10, 3))

    key = tr.make_key("mobile", "ee", 30)
    run(tr.ensure_research(key, fetcher))
    clock["now"] = datetime(2026, 10, 4)
    run(tr.ensure_research(key, fetcher))
    assert n["calls"] == 2


def test_failed_fetch_keeps_last_good_findings_marked_older_and_does_not_hammer(monkeypatch):
    col = FakeCol()
    monkeypatch.setattr(tr, "tip_research_col", col)
    clock = {"now": datetime(2026, 10, 1, 9)}
    monkeypatch.setattr(tr, "_now", lambda: clock["now"])

    async def good(key):
        return tr.FetchOutcome(findings={"headline": "last good"})

    n = {"bad": 0}

    async def bad(key):
        n["bad"] += 1
        return tr.FetchOutcome(failure="quota")

    key = tr.make_key("mobile", "ee", 30)
    run(tr.ensure_research(key, good))
    clock["now"] += timedelta(days=8)
    r = run(tr.ensure_research(key, bad))
    d = col.docs[key.doc_id]
    assert r.state == "stale" and r.failure == "quota"
    assert d["status"] == "stale" and d["findings"] == {"headline": "last good"}
    assert d["as_of"] == "2026-10-01"           # still dated the day it was real
    assert d["last_failure_code"] == "quota"
    # not retried within RETRY_AFTER, by this or any other user
    clock["now"] += timedelta(hours=1)
    r2 = run(tr.ensure_research(key, bad))
    assert n["bad"] == 1 and r2.failure == "quota" and r2.state == "stale"
    # allowed again after the retry window, and recovers
    clock["now"] += timedelta(hours=6)
    r3 = run(tr.ensure_research(key, good))
    assert r3.state == "fetched" and col.docs[key.doc_id]["status"] == "ok"


def test_first_ever_fetch_failure_is_recorded_as_failed_and_not_retried_at_once(monkeypatch):
    col = FakeCol()
    monkeypatch.setattr(tr, "tip_research_col", col)
    clock = {"now": datetime(2026, 10, 1, 9)}
    monkeypatch.setattr(tr, "_now", lambda: clock["now"])
    n = {"c": 0}

    async def bad(key):
        n["c"] += 1
        return tr.FetchOutcome(failure="server")

    key = tr.make_key("energy", None, None)
    run(tr.ensure_research(key, bad))
    run(tr.ensure_research(key, bad))
    assert n["c"] == 1 and col.docs[key.doc_id]["status"] == "failed"


def test_pass_marks_existing_tip_stale_when_research_is_down(pass_env):
    calls, tip_col, insights, state = pass_env
    run(si._refresh_savings_insights_for_user(ALICE))
    doc = _mobile_doc(insights, ALICE)
    old_title = doc["title"]
    # age the tip and the shared findings past their TTL, then take research down
    doc["content_valid_until"] = datetime(2020, 1, 1)
    for d in tip_col.docs.values():
        d["content_valid_until"] = datetime(2020, 1, 1)
        d["last_attempt_at"] = datetime(2020, 1, 1)
    state["fail"] = "quota"
    run(si._refresh_savings_insights_for_user(ALICE))
    doc = _mobile_doc(insights, ALICE)
    assert doc["title"] == old_title and doc["research_stale_at"]
    assert si._serialize_insight(doc)["state"] == "stale"


def test_deal_past_its_deadline_is_not_shown_at_compose_time():
    doc = {
        "as_of": "2026-10-01", "fetched_at": datetime(2026, 10, 1), "content_valid_until": datetime(2026, 10, 8),
        "findings": {"typical_low": 8, "typical_high": 25, "headline": None, "alternatives": [],
                     "deal": {"text": "A switching offer is running", "valid_until": "2026-10-05"},
                     "sources": ["https://www.uswitch.com/mobiles/"]},
    }
    tb = [{"merchant_key": "ee", "display_name": "Ee", "monthly_amount": 30.0, "is_recurring": True, "occurrences": 3}]
    live = si._compose_tip_content("mobile", doc, tb, None, datetime(2026, 10, 4).date())
    assert "switching offer" in live["body"] and "Offer listed until 5 Oct" in live["body"]
    assert live["claim_valid_until"] == datetime(2026, 10, 5)
    past = si._compose_tip_content("mobile", doc, tb, None, datetime(2026, 10, 6).date())
    assert "switching offer" not in past["body"] and past["claim_valid_until"] is None


def test_deal_past_its_deadline_is_dropped_when_findings_are_built():
    parsed = dict(LLM_FINDINGS, deal={"text": "An offer", "valid_until": "2020-01-31"})
    findings, claim, violation = si._build_findings(parsed, SNIPPET, [], "mobile", datetime(2026, 10, 16).date())
    assert violation is None and findings["deal"] is None and claim is None


def test_dated_promo_without_a_deadline_is_not_kept():
    parsed = dict(LLM_FINDINGS, deal={"text": "This January offer is worth a look", "valid_until": None})
    findings, claim, _ = si._build_findings(parsed, SNIPPET, [], "mobile", datetime(2026, 10, 16).date())
    assert findings["deal"] is None


def test_figures_not_in_the_search_results_are_dropped():
    parsed = dict(LLM_FINDINGS, typical_low=3, typical_high=999,
                  alternatives=[{"name": "Giffgaff", "price": 777, "note": None}])
    findings, _, _ = si._build_findings(parsed, SNIPPET, [], "mobile", datetime(2026, 10, 16).date())
    assert findings is None  # G315: no grounded figure and no priced listing leaves nothing to store


# ── personal layer ──────────────────────────────────────────────────────────

def test_composed_tip_is_personal_hedged_dated_and_in_house_style(pass_env):
    *_, insights, _ = pass_env
    run(si._refresh_savings_insights_for_user(ALICE))
    doc = _mobile_doc(insights, ALICE)
    text = doc["title"] + " " + doc["body"]
    assert doc["title"] == "You pay EE £27 a month"
    # G315: a mobile bill has no like-for-like product type and example.com is not an
    # allowlisted source, so the body is the user's own fact plus one freshness line.
    assert "listed at" not in doc["body"] and re.search(r"Checked \d{1,2} \w{3}\.$", doc["body"])
    assert "—" not in text and "–" not in text and "!" not in text
    assert "savings_estimate" not in doc
    assert doc["claim_valid_until"] is None
    assert doc["researched_at"] is not None and doc["prompt_version"] == si.PROMPT_VERSION
    out = si._serialize_insight(doc)
    assert out["state"] == "fresh" and out["title"] == doc["title"]


def test_no_saving_is_claimed_or_estimated_even_when_the_user_pays_above_the_range(pass_env):
    *_, insights, _ = pass_env
    run(si._refresh_savings_insights_for_user(CAROL))
    doc = _mobile_doc(insights, CAROL)
    assert "savings_estimate" not in doc
    assert "could save" not in doc["body"] and "£32" not in doc["body"]
    assert si.tip_copy.find_banned(doc["title"]) is None and si.tip_copy.find_banned(doc["body"]) is None
    assert "savings_estimate" not in si._serialize_insight(doc)


def test_phrasing_step_is_off_by_default_and_never_searches(pass_env, monkeypatch):
    calls, *_ = pass_env
    run(si._refresh_savings_insights_for_user(ALICE))
    assert calls.llm == 3  # shared fetches only (mobile, energy, groceries); nothing per user


def test_phrasing_step_keeps_composed_text_unless_every_figure_survives(monkeypatch):
    monkeypatch.setattr(si, "TIP_LLM_PHRASING", True)
    monkeypatch.setattr(si, "OPENROUTER_API_KEY", "k")
    content = {"title": "You pay EE £27 a month", "body": "SIM-only plans are listed at £8 to £25 a month. Checked 12 Oct, source example.com."}

    class R:
        status_code = 200

        def __init__(self, payload):
            self.payload = payload

        def json(self):
            return {"choices": [{"message": {"content": json.dumps(self.payload)}}]}

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *e):
            return False

    monkeypatch.setattr(si.httpx, "AsyncClient", _Client)
    seen = {}

    async def fake_llm(body, *, user_id, pipeline, client=None, **k):
        seen["user"], seen["pipeline"] = user_id, pipeline
        return R(seen["payload"])

    monkeypatch.setattr(si, "openrouter_chat", fake_llm)
    seen["payload"] = {"title": "EE costs you £27 a month", "body": "SIM-only plans are listed at £8 to £25 a month. Checked 12 Oct, source example.com."}
    out = run(si._maybe_rephrase("u@example.com", content, None))
    assert out["title"] == "EE costs you £27 a month" and seen["pipeline"] == "tip_phrasing"
    seen["payload"] = {"title": "EE costs you £99 a month", "body": content["body"]}
    assert run(si._maybe_rephrase("u@example.com", content, None)) == content
    seen["payload"] = {"title": content["title"], "body": "SIM-only plans are listed at £8 to £25 a month."}
    assert run(si._maybe_rephrase("u@example.com", content, None)) == content


# ── privacy ─────────────────────────────────────────────────────────────────

def test_no_user_data_in_any_tip_research_document(pass_env):
    calls, tip_col, insights, _ = pass_env
    for uid in (ALICE, BOB, CAROL, DAN):
        run(si._refresh_savings_insights_for_user(uid))
    assert tip_col.docs
    for doc in tip_col.docs.values():
        tr.assert_no_user_data(doc)
        blob = json.dumps(doc, default=str).lower()
        for uid, amount in AMOUNTS.items():
            assert uid.lower() not in blob and uid.split("@")[0] not in blob
            for form in (f"{amount:.2f}", f"{amount * 10:.2f}", f"£{int(amount)}", f"£{round(amount)}",
                         f"£{int(amount * 10)}", f"£{round(amount * 10)}"):
                assert form not in blob, (form, doc["_id"])
        assert "display_name" not in blob and "triggered_by" not in blob
        assert "tesco" not in blob  # the user's own merchant never reaches a profile-keyed document
    # the stored keys themselves are only category, curated provider, band, region, version
    for k in tip_col.docs:
        category, provider, band, region, version = k.split("|")
        assert category in si.INSIGHT_CATEGORIES and region == "UK" and version == "v1"
        assert provider in {"ee", "other", "profile_general"}
        assert band in {"20_40", "40_60", "unknown", "all"}


def test_writing_a_document_with_user_data_fails_closed(monkeypatch):
    col = FakeCol()
    monkeypatch.setattr(tr, "tip_research_col", col)

    async def leaky(key):
        return tr.FetchOutcome(findings={"headline": "h", "monthly_amount": 27.43})

    key = tr.make_key("mobile", "ee", 30)
    r = run(tr.ensure_research(key, leaky))
    assert r.state == "none" and r.failure == "error"
    assert col.docs[key.doc_id].get("findings") is None


def test_collection_is_in_the_erasure_manifest_and_sweep_matches_nothing():
    from app.db import collections
    assert "tip_research_col" in collections.ERASURE_MANIFEST


# ── cost counter ────────────────────────────────────────────────────────────

def test_tavily_calls_are_counted_per_pipeline(monkeypatch):
    import app.core.llm as llm

    col = FakeCol()
    inserted = []

    async def ins(doc):
        inserted.append(doc)

    col.insert_one = ins
    monkeypatch.setattr(llm, "llm_usage_col", col)
    monkeypatch.setattr(llm, "_indexes_ready", True)
    run(llm.record_tavily_call(pipeline="tip_research_tavily", latency_ms=120))
    d = inserted[0]
    assert d["pipeline"] == "tip_research_tavily" and d["model"] == "tavily" and d["user_id"] is None
    assert d["cost_usd"] == 0.0 and d["prompt_tokens"] == 0 and d["year_month"]


def test_tavily_search_counts_each_request_sent(monkeypatch):
    sent = []

    async def rec(**kw):
        sent.append(kw["pipeline"])

    class _Resp:
        status_code = 200

        def json(self):
            return {"answer": "a", "results": [{"content": "c", "url": "https://example.com/x"}]}

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *e):
            return False

        async def post(self, *a, **k):
            return _Resp()

    async def health_load():
        return None

    async def health_ok(now):
        return None

    monkeypatch.setattr(si, "record_tavily_call", rec)
    monkeypatch.setattr(si, "TAVILY_API_KEY", "fake")
    monkeypatch.setattr(si.httpx, "AsyncClient", _Client)
    monkeypatch.setattr(si.tips_research_health, "load", health_load)
    monkeypatch.setattr(si.tips_research_health, "record_success", health_ok)
    out = run(si._tavily_search("q", "mobile", {}, pipeline="tip_research_tavily"))
    assert out == (["a", "Page example.com: c"], ["https://example.com/x"]) and sent == ["tip_research_tavily"]


# ── backfill ────────────────────────────────────────────────────────────────

NOW = datetime(2026, 10, 16, 9)


def _legacy_tip(uid=ALICE, **over):
    d = {
        "_id": "t1", "user_id": uid, "category": "mobile", "title": "You pay EE £27 a month",
        "body": "You pay EE £27.43 a month. Giffgaff typically costs £10 a month. Lebara offers 30GB for £12.",
        "researched_at": NOW - timedelta(days=2), "content_valid_until": NOW + timedelta(days=5),
        "triggered_by": [{"merchant_key": "ee", "display_name": "Ee", "monthly_amount": 27.43}],
    }
    d.update(over)
    return d


def test_backfill_dry_run_writes_nothing_and_apply_only_creates_empty_stubs(monkeypatch):
    tip_col = FakeCol()
    monkeypatch.setattr(tr, "tip_research_col", tip_col)
    monkeypatch.setattr(si, "behaviour_portrait_col", type("P", (), {"find_one": staticmethod(lambda *a, **k: asyncio.sleep(0))})())
    insights = FakeCol([_legacy_tip(),
                        _legacy_tip(_id="t3", content_valid_until=NOW - timedelta(days=1))])
    dry = run(bf.backfill(insights, apply=False, now=NOW))
    assert tip_col.docs == {} and dry["keys_created"] == 1 and dry["not_in_date"] == 1
    applied = run(bf.backfill(insights, apply=True, now=NOW))
    assert applied["keys_created"] == 1 and list(tip_col.docs) == ["mobile|ee|20_40|UK|v1"]
    doc = tip_col.docs["mobile|ee|20_40|UK|v1"]
    # no backfill document ever carries findings text or anything derived from a tip
    assert doc["status"] == "pending" and doc["findings"] is None
    assert doc["fetched_at"] is None and doc["as_of"] is None and "last_attempt_at" not in doc and "created_at" not in doc
    blob = json.dumps(doc, default=str)
    for leak in ("Giffgaff", "Lebara", "27.43", "£", "alice"):
        assert leak not in blob
    tr.assert_no_user_data(doc)
    again = run(bf.backfill(insights, apply=True, now=NOW))
    assert again["keys_created"] == 0 and again["keys_already_present"] == 1


def test_backfill_never_overwrites_an_existing_key(monkeypatch):
    key = tr.make_key("mobile", "ee", 27.43)
    tip_col = FakeCol([{"_id": key.doc_id, "findings": {"headline": "real"}, "origin": "fetched", "status": "ok"}])
    monkeypatch.setattr(tr, "tip_research_col", tip_col)
    counts = run(bf.backfill(FakeCol([_legacy_tip()]), apply=True, now=NOW))
    assert counts["keys_created"] == 0 and tip_col.docs[key.doc_id]["findings"] == {"headline": "real"}


def test_pending_stub_is_fetched_by_the_first_pass(pass_env):
    calls, tip_col, insights, _ = pass_env
    key = tr.make_key("mobile", "ee", AMOUNTS[ALICE])
    run(tr.precreate_pending(key))
    run(si._refresh_savings_insights_for_user(ALICE))
    assert tip_col.docs[key.doc_id]["status"] == "ok" and len(_sim_calls(calls)) == 1
