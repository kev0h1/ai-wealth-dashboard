"""G316: the shared vendor directory and the sync-time categorisation ladder.

No network and no real database for the vendor collections: Tavily
(`_tavily_search`) and OpenRouter (`_llm_json`) are replaced with counting
fakes, and `httpx.AsyncClient` raises if anything tries to open it. Every
collection the ladder touches is an in-memory fake (scripts/inmemory_mongo.py).
"""
import asyncio
import copy
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.inmemory_mongo import InMemoryCollection as Col  # noqa: E402
from scripts import backfill_vendor_categories as bf  # noqa: E402

import app.services.categorisation as cat  # noqa: E402
import app.services.categories as categories  # noqa: E402
import app.services.tips_research_health as trh  # noqa: E402
import app.services.vendor_directory as vd  # noqa: E402

NOW = datetime(2026, 10, 22, 12, 0, 0)
KEVIN, OTHER = "user-a", "user-b"
NO_IDENTITY = {"name_tokens": [], "own_ids": set(), "own_map": {}}
KEVIN_IDENTITY = {"name_tokens": ["kevin", "maingi"], "own_ids": {"12345678"}, "own_map": {}}


def run(coro):
    return asyncio.run(coro)


class Env:
    """One test's world: fake collections, per-user vocab, and call counters."""

    def __init__(self):
        self.vendors = Col("vendors")
        self.decisions = Col("user_vendor_categories")
        self.claims = Col("vendor_claims")
        self.state = Col("worker_runs")
        self.txns = Col("transactions")
        self.rules = Col("user_rules")
        self.customs = {KEVIN: ["Golf", "Padel"], OTHER: ["Leisure"]}
        self.identity = {KEVIN: NO_IDENTITY, OTHER: NO_IDENTITY}
        self.tavily_calls: list[str] = []
        self.llm_calls: list[tuple[str, str]] = []
        self.tavily_answer = {"answer": "A members golf club and course in Solihull.",
                              "snippets": ["Golf club."], "urls": ["https://example.com/golf"]}
        self.tavily_error: vd.ProviderFailure | None = None
        self.describe = {"status": "found", "display_name": "Widney Manor Golf",
                         "description": "Members golf club and course in Solihull.",
                         "type_tags": ["golf", "sport"], "domain": "widneymanor.example.com", "confidence": "high"}
        self.match_for = {}  # uid -> category the fake model picks
        self.match_prompts: list[str] = []
        self._n = 0

    def add_txn(self, uid, description, category="Health", amount=22.0, custom=None, kind="debit", merchant=""):
        self._n += 1
        doc = {"_id": f"t{self._n}", "user_id": uid, "description": description, "merchant_name": merchant,
               "category": category, "custom_category": custom, "transaction_type": kind, "amount": amount,
               "account_id": "acc1", "date": NOW - timedelta(days=self._n)}
        self.txns.docs[doc["_id"]] = doc
        return doc["_id"]

    def cat_of(self, tid):
        return self.txns.docs[tid]["category"]


@pytest.fixture
def env(monkeypatch):
    e = Env()

    class NoNetwork:
        def __init__(self, *a, **k):
            raise AssertionError("network used in a G316 test")

    monkeypatch.setattr("httpx.AsyncClient", NoNetwork)
    for name, col in (("vendors_col", e.vendors), ("user_vendor_categories_col", e.decisions),
                      ("vendor_claims_col", e.claims), ("worker_runs_col", e.state),
                      ("transactions_col", e.txns), ("user_rules_col", e.rules)):
        monkeypatch.setattr(vd, name, col)
    monkeypatch.setattr(trh, "worker_runs_col", Col("tips_state"))
    monkeypatch.setattr(vd.cfg, "VENDOR_LADDER_ENABLED", True)
    monkeypatch.setattr(vd.cfg, "VENDOR_LOOKUP_CAP_PER_SYNC", 5)
    monkeypatch.setattr(vd.cfg, "VENDOR_LOOKUP_CAP_PER_DAY", 100)
    monkeypatch.setattr(vd.cfg, "VENDOR_MATCH_CAP_PER_SYNC", 40)
    monkeypatch.setattr(vd.cfg, "VENDOR_REFRESH_DAYS", 365)

    async def allowed(uid):
        return cat.VALID_CATEGORIES + e.customs.get(uid, [])

    async def identity(uid):
        return e.identity.get(uid, NO_IDENTITY)

    async def kinds(uid):
        return categories.CategoryKinds(dict(categories.BUILTIN_CATEGORY_KINDS))

    monkeypatch.setattr(cat, "user_allowed_categories", allowed)
    monkeypatch.setattr(cat, "user_identity", identity)
    monkeypatch.setattr(categories, "get_category_kinds", kinds)

    async def fake_tavily(query):
        e.tavily_calls.append(query)
        await asyncio.sleep(0)
        if e.tavily_error:
            raise e.tavily_error
        return copy.deepcopy(e.tavily_answer)

    async def fake_llm(model, prompt, *, user_id, pipeline, max_tokens):
        e.llm_calls.append((pipeline, model))
        if pipeline == "vendor_lookup":
            return copy.deepcopy(e.describe)
        e.match_prompts.append(prompt)
        n = prompt.count("\n") and sum(1 for ln in prompt.split("Businesses:\n")[1].splitlines() if ln.strip())
        pick = e.match_for.get(user_id)
        return {str(i + 1): {"category": pick, "reason": "Fits the description."} for i in range(n)} if pick else None

    monkeypatch.setattr(vd, "_tavily_search", fake_tavily)
    monkeypatch.setattr(vd, "_llm_json", fake_llm)
    return e


# ── Firewall: no category leaks across users ────────────────────────────────

def test_two_users_same_merchant_different_categories_never_leak(env):
    env.match_for = {KEVIN: "Golf", OTHER: "Leisure"}
    a = env.add_txn(KEVIN, "WIDNEY MANOR GOLF ON 19 OCT CPM")
    b = env.add_txn(OTHER, "WIDNEY MANOR GOLF ON 19 OCT CPM")
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    run(vd.run_vendor_ladder(OTHER, now=NOW))
    assert env.cat_of(a) == "Golf" and env.cat_of(b) == "Leisure"
    # One directory row, holding facts only: no category and no user id anywhere in it.
    assert list(env.vendors.docs) == ["widney manor golf"]
    doc = env.vendors.docs["widney manor golf"]
    assert not ({"category", "custom_category", "uid", "user_id", "reason"} & set(doc))
    # Two private decisions, each keyed by its own user.
    assert set(env.decisions.docs) == {f"{KEVIN}::widney manor golf", f"{OTHER}::widney manor golf"}
    assert env.decisions.docs[f"{KEVIN}::widney manor golf"]["category"] == "Golf"
    assert env.decisions.docs[f"{OTHER}::widney manor golf"]["category"] == "Leisure"
    # The other user was never offered Kevin's words.
    assert all("Golf," not in p.split("Their categories:")[1].split("\n")[0] for p in env.match_prompts[1:])


def test_directory_document_refuses_a_category_or_user_field():
    with pytest.raises(ValueError):
        vd.assert_directory_doc({"_id": "x", "merchant_key": "x", "category": "Golf"})
    with pytest.raises(ValueError):
        vd.assert_directory_doc({"_id": "x", "merchant_key": "x", "user_id": "u"})
    vd.assert_directory_doc({"_id": "x", "merchant_key": "x", "status": "found", "description": "d"})


# ── Privacy exclusions ──────────────────────────────────────────────────────

@pytest.mark.parametrize("key,texts,category,expected", [
    ("daniel gondwe", ["TO DANIEL GONDWE FP 12/05/26 10"], "Shopping", "person_payment"),
    ("daniel maingi", ["TO DANIEL MAINGI FP 12/05/26 10"], "Shopping", "own_name"),
    ("c c gondwe bed sheets", ["C C GONDWE BED SHEETS FP 01/06/26"], "Shopping", "person_payment"),
    ("kevin maingi coscto", ["KEVIN MAINGI COSCTO"], "Shopping", "own_name"),
    ("acme ltd 20 30 40", ["ACME LTD 20-30-40 12345678"], "Shopping", "account_digits"),
    ("acme ltd", ["ACME LTD 87654321"], "Shopping", "account_digits"),
    ("acme ltd", ["ACME LTD sort code"], "Shopping", "account_digits"),
    ("jo bloggs", ["jo@example.com"], "Shopping", "contact_detail"),
    ("monzo pot", ["INTERNAL TRANSFER"], "Transfer", "transfer"),
    ("savings", ["BANK TRANSFER TO SAVINGS"], "Shopping", "person_payment"),
])
def test_privacy_exclusion_reasons(key, texts, category, expected):
    assert vd.privacy_exclusion(key, texts, category=category, identity=KEVIN_IDENTITY) == expected


@pytest.mark.parametrize("key,text", [
    ("c c gondwe", "C C GONDWE"),
    ("j smith", "J SMITH"),
    ("daniel gondwe", "DANIEL GONDWE"),
    ("jo bloggs", "JO BLOGGS"),
    ("smith", "FASTER PAYMENTS TO J SMITH"),
    ("widney manor golf bar cafe 1 x", "WIDNEY X 1"),
])
def test_bare_payee_names_are_refused(key, text):
    assert vd.privacy_exclusion(key, [text], category="Shopping", identity=NO_IDENTITY) == "person_payment"


@pytest.mark.parametrize("key", ["pret a manger", "sainsburys local", "lidl gb", "halfords autocentre", "widney manor golf", "charles waite golf", "playtomic", "tesco stores", "the gym ltd"])
def test_business_shaped_keys_stay_allowed(key):
    assert vd.privacy_exclusion(key, [key.upper()], category="Health", identity=NO_IDENTITY) is None


@pytest.mark.parametrize("key", ["j smith", "c c gondwe", "daniel gondwe"])
def test_person_names_without_merchant_name_stay_refused(key):
    assert vd.privacy_exclusion(key, [key.upper()], category="Shopping", identity=NO_IDENTITY,
                                has_merchant_name=False) == "person_payment"


def test_a_named_provider_merchant_may_have_two_plain_words():
    assert vd.privacy_exclusion("green dragon", ["GREEN DRAGON"], category="Shopping",
                                identity=NO_IDENTITY, has_merchant_name=True) is None
    assert vd.privacy_exclusion("green dragon", ["GREEN DRAGON"], category="Shopping",
                                identity=NO_IDENTITY, has_merchant_name=False) == "person_payment"


def test_a_plain_business_is_allowed():
    assert vd.privacy_exclusion("widney manor golf", ["WIDNEY MANOR GOLF ON 19 OCT CPM"],
                                category="Health", identity=NO_IDENTITY) is None


def test_private_merchants_never_reach_tavily_the_model_or_the_directory(env):
    env.identity[KEVIN] = KEVIN_IDENTITY
    env.match_for = {KEVIN: "Golf"}
    private = [
        "TO DANIEL MAINGI FP 12/05/26 10",              # person to person
        "KEVIN MAINGI COSCTO",                          # own name
        "ACME TRADING 20-30-40 12345678",               # account and sort code digits
        "FASTER PAYMENT TO J SMITH",                    # payment wording
        "SOMEONE 07123 456789",                         # phone number
    ]
    ids = [env.add_txn(KEVIN, d, category="Shopping") for d in private]
    transfer = env.add_txn(KEVIN, "WIDNEY MANOR GOLF", category="Transfer")   # structural: never offered
    stats = run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert env.tavily_calls == [] and env.llm_calls == []
    assert env.vendors.docs == {} and env.decisions.docs == {}
    assert sum(stats["private_skipped"].values()) == len(private)
    assert [env.cat_of(i) for i in ids] == ["Shopping"] * len(private)
    assert env.cat_of(transfer) == "Transfer"


# ── Lookup once, cached, not_found cached, refresh ──────────────────────────

def test_lookup_happens_once_across_users_and_syncs(env):
    env.match_for = {KEVIN: "Golf", OTHER: "Leisure"}
    env.add_txn(KEVIN, "WIDNEY MANOR GOLF ON 19 OCT CPM")
    env.add_txn(OTHER, "WIDNEY MANOR GOLF")
    for _ in range(2):
        run(vd.run_vendor_ladder(KEVIN, now=NOW))
        run(vd.run_vendor_ladder(OTHER, now=NOW))
    assert len(env.tavily_calls) == 1
    assert [p for p, _m in env.llm_calls].count("vendor_lookup") == 1
    assert [p for p, _m in env.llm_calls].count("vendor_match") == 2   # once per user, then cached


def test_model_tiering_reasoning_only_at_the_lookup_step(env, monkeypatch):
    monkeypatch.setattr(vd.cfg, "VENDOR_REASONING_MODEL", "reasoning-model")
    monkeypatch.setattr(vd.cfg, "VENDOR_MATCH_MODEL", "cheap-model")
    env.match_for = {KEVIN: "Golf"}
    env.add_txn(KEVIN, "WIDNEY MANOR GOLF")
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert env.llm_calls == [("vendor_lookup", "reasoning-model"), ("vendor_match", "cheap-model")]


def test_not_found_is_cached_and_not_retried(env):
    env.tavily_answer = {"answer": "", "snippets": [], "urls": []}
    t = env.add_txn(KEVIN, "ZZQX HOLDINGS")
    for _ in range(3):
        run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert len(env.tavily_calls) == 1
    assert env.vendors.docs["zzqx holdings"]["status"] == "not_found"
    assert env.llm_calls == []          # nothing to write up, no model spend
    assert env.cat_of(t) == "Health"    # the keyword category stands


def test_not_a_business_is_cached_without_a_category(env):
    env.describe = {"status": "not_a_business"}
    env.add_txn(KEVIN, "SOME PERSON CAFE")
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert len(env.tavily_calls) == 1
    assert env.vendors.docs["some person cafe"]["status"] == "not_a_business"
    assert env.vendors.docs["some person cafe"]["description"] is None


def test_provider_failure_is_not_cached_as_not_found(env):
    env.tavily_error = vd.ProviderFailure("server", 500)
    env.add_txn(KEVIN, "WIDNEY MANOR GOLF")
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert env.vendors.docs == {}


def test_a_failed_write_up_rests_the_merchant_instead_of_retrying_at_once(env):
    env.describe = {"status": "banana"}
    env.add_txn(KEVIN, "WIDNEY MANOR GOLF")
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert len(env.tavily_calls) == 1 and env.vendors.docs == {}


def test_refresh_after_twelve_months_not_before(env):
    env.match_for = {KEVIN: "Golf"}
    env.add_txn(KEVIN, "WIDNEY MANOR GOLF")
    env.vendors.docs["widney manor golf"] = {
        "_id": "widney manor golf", "merchant_key": "widney manor golf", "status": "found",
        "description": "Members golf club.", "display_name": "Widney Manor Golf", "type_tags": [],
        "domain": None, "sources": [], "confidence": "high", "version": 1,
        "looked_up_at": NOW - timedelta(days=300)}
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert env.tavily_calls == []
    env.vendors.docs["widney manor golf"]["looked_up_at"] = NOW - timedelta(days=400)
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert len(env.tavily_calls) == 1
    assert env.vendors.docs["widney manor golf"]["looked_up_at"] == NOW


# ── Quota backoff and health ────────────────────────────────────────────────

def test_quota_backoff_stops_lookups_and_surfaces_on_health(env):
    env.tavily_error = vd.ProviderFailure("quota", 432)
    for d in ("WIDNEY MANOR GOLF", "STONEBRIDGE GOLF", "MERIDEN GOLF"):
        env.add_txn(KEVIN, d)
    stats = run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert len(env.tavily_calls) == 1                      # first call hit 432, the rest never sent
    assert stats["deferred"].get("backoff") == 2
    assert env.vendors.docs == {}
    state = env.state.docs[vd.STATE_DOC_ID]
    assert state["lookup_status"] == "failing" and state["last_error_code"] == "quota"
    assert state["skip_until"] > NOW
    snap = run(vd.health_snapshot(NOW))
    assert snap["backoff_active"] is True and snap["backoff_until"]
    assert snap["lookups_today"] == 1 and snap["cap_per_day"] == 100
    assert snap["last_error_code"] == "quota"
    # After the backoff window one attempt is allowed again and success clears it.
    env.tavily_error = None
    later = NOW + timedelta(hours=25)
    run(vd.run_vendor_ladder(KEVIN, now=later))
    assert len(env.tavily_calls) >= 2
    assert run(vd.health_snapshot(later))["backoff_active"] is False


def test_tips_research_backoff_also_stops_vendor_lookups(env):
    trh.worker_runs_col.docs[trh.DOC_ID] = {"_id": trh.DOC_ID, "research_status": "failing",
                                            "skip_until": NOW + timedelta(hours=5)}
    env.add_txn(KEVIN, "WIDNEY MANOR GOLF")
    stats = run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert env.tavily_calls == [] and stats["deferred"] == {"backoff": 1}


def test_health_collector_carries_the_vendor_lookups_block(env):
    from app.services.health.llm import LlmTavilyCollector

    class Usage:
        def aggregate(self, _pipe):
            class C:
                async def to_list(self, _n):
                    return []
            return C()

    async def research():
        return None

    async def go():
        c = LlmTavilyCollector(usage=Usage(), research_loader=research,
                               vendor_loader=lambda: vd.health_snapshot(NOW))
        return await c.collect()

    env.state.docs[vd.STATE_DOC_ID] = {"_id": vd.STATE_DOC_ID, "skip_until": NOW + timedelta(hours=3)}
    # Collector reads "now" itself; use a far-future skip so the backoff is live.
    env.state.docs[vd.STATE_DOC_ID]["skip_until"] = datetime(2999, 1, 1)
    out = run(go())
    block = out["values"]["vendor_lookups"]
    assert {"lookups_today", "cap_per_day", "backoff_until", "queue_depth"} <= set(block)
    assert out["status"] == "crit" and out["values"]["tavily_backoff"] == 1


# ── Caps and the in-flight claim ────────────────────────────────────────────

def test_per_sync_cap(env, monkeypatch):
    monkeypatch.setattr(vd.cfg, "VENDOR_LOOKUP_CAP_PER_SYNC", 2)
    for d in ("ALPHA GOLF", "BRAVO GOLF", "CHARLIE GOLF"):
        env.add_txn(KEVIN, d)
    stats = run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert len(env.tavily_calls) == 2 and stats["deferred"] == {"cap_sync": 1}


def test_per_day_cap_is_global_across_syncs(env, monkeypatch):
    monkeypatch.setattr(vd.cfg, "VENDOR_LOOKUP_CAP_PER_DAY", 2)
    for d in ("ALPHA GOLF", "BRAVO GOLF", "CHARLIE GOLF"):
        env.add_txn(KEVIN, d)
    s1 = run(vd.run_vendor_ladder(KEVIN, now=NOW))
    s2 = run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert len(env.tavily_calls) == 2
    assert s1["deferred"].get("cap_day") == 1 and s2["deferred"].get("cap_day") == 1
    assert run(vd.lookups_today(NOW)) == 2
    # A new UTC day has its own counter.
    run(vd.run_vendor_ladder(KEVIN, now=NOW + timedelta(days=1)))
    assert len(env.tavily_calls) == 3


def test_zero_cap_means_no_lookups(env, monkeypatch):
    monkeypatch.setattr(vd.cfg, "VENDOR_LOOKUP_CAP_PER_DAY", 0)
    env.add_txn(KEVIN, "ALPHA GOLF")
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert env.tavily_calls == []


def test_match_cap_per_sync(env, monkeypatch):
    monkeypatch.setattr(vd.cfg, "VENDOR_MATCH_CAP_PER_SYNC", 1)
    for d in ("ALPHA GOLF", "BRAVO GOLF"):
        env.add_txn(KEVIN, d)
    stats = run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert stats["deferred"].get("cap_match") == 1 and len(env.tavily_calls) == 1


def test_two_concurrent_syncs_for_one_new_merchant_trigger_one_lookup(env):
    async def go():
        return await asyncio.gather(
            vd.ensure_vendor("widney manor golf", vd.SyncBudget(), NOW),
            vd.ensure_vendor("widney manor golf", vd.SyncBudget(), NOW),
        )
    (d1, r1), (d2, r2) = run(go())
    assert len(env.tavily_calls) == 1
    assert sorted([r1 or "done", r2 or "done"]) == ["claimed", "done"]
    assert env.claims.docs.get("lookup:widney manor golf") is None   # released


def test_live_claim_blocks_and_expired_claim_is_taken_over(env):
    env.claims.docs["lookup:widney manor golf"] = {"_id": "lookup:widney manor golf", "kind": "lookup",
                                                   "expires_at": NOW + timedelta(seconds=60)}
    doc, why = run(vd.ensure_vendor("widney manor golf", vd.SyncBudget(), NOW))
    assert why == "claimed" and env.tavily_calls == []
    assert run(vd.health_snapshot(NOW))["queue_depth"] == 1
    env.claims.docs["lookup:widney manor golf"]["expires_at"] = NOW - timedelta(seconds=1)
    doc, why = run(vd.ensure_vendor("widney manor golf", vd.SyncBudget(), NOW))
    assert why is None and doc["status"] == "found" and len(env.tavily_calls) == 1


# ── Corrections and rules are never overwritten ─────────────────────────────

def test_a_corrected_merchant_and_its_rows_are_never_touched(env):
    env.match_for = {KEVIN: "Golf"}
    corrected = env.add_txn(KEVIN, "WIDNEY MANOR GOLF ON 01 OCT CPM", category="Padel", custom="Padel")
    sibling = env.add_txn(KEVIN, "WIDNEY MANOR GOLF ON 19 OCT CPM", category="Health")
    stats = run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert env.cat_of(corrected) == "Padel" and env.txns.docs[corrected]["custom_category"] == "Padel"
    assert env.cat_of(sibling) == "Health"           # the user spoke for this merchant already
    assert stats["corrected_skipped"] == 1
    assert env.tavily_calls == [] and env.decisions.docs == {}


def test_write_time_filter_protects_a_row_corrected_mid_run(env):
    env.match_for = {KEVIN: "Golf"}
    t = env.add_txn(KEVIN, "WIDNEY MANOR GOLF")

    real_match = vd.match_descriptions

    async def corrects_during_match(uid, allowed, items):
        env.txns.docs[t]["custom_category"] = "Padel"     # the user taps a correction meanwhile
        env.txns.docs[t]["category"] = "Padel"
        return await real_match(uid, allowed, items)

    run(vd.run_vendor_ladder(KEVIN, now=NOW, match_fn=corrects_during_match))
    assert env.cat_of(t) == "Padel" and env.txns.docs[t]["custom_category"] == "Padel"


def test_a_user_rule_keeps_its_merchant_out_of_the_ladder(env):
    env.rules.docs["r1"] = {"_id": "r1", "uid": KEVIN, "pattern": r"\bwidney\b", "category": "Padel"}
    t = env.add_txn(KEVIN, "WIDNEY MANOR GOLF")
    stats = run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert stats["rule_skipped"] == 1 and env.tavily_calls == [] and env.cat_of(t) == "Health"


# ── Custom-category users get the model path, others keep today's rules ─────

def test_user_without_custom_categories_keeps_todays_behaviour_exactly(env):
    env.customs[OTHER] = []
    env.match_for = {OTHER: "Leisure"}
    t = env.add_txn(OTHER, "WIDNEY MANOR GOLF ON 19 OCT CPM")
    stats = run(vd.run_vendor_ladder(OTHER, now=NOW))
    assert stats["skipped"] == "no_custom_categories" and stats["ran"] is False
    assert env.tavily_calls == [] and env.llm_calls == []
    assert env.vendors.docs == {} and env.decisions.docs == {}
    assert env.cat_of(t) == "Health"
    # The keyword rule that ends categorisation for them is unchanged.
    assert cat.rule_categorise("Widney Manor Golf", "") == "Health"
    # And the cache-only pass in apply_rules_bulk is a no-op for them.
    assert run(vd.apply_decisions_for_user(OTHER)) == 0


def test_custom_category_user_gets_description_driven_category_and_keyword_is_a_hint(env):
    env.match_for = {KEVIN: "Golf"}
    t = env.add_txn(KEVIN, "WIDNEY MANOR GOLF ON 19 OCT CPM", category="Health")
    stats = run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert env.cat_of(t) == "Golf" and stats["rows_updated"] == 1
    prompt = env.match_prompts[0]
    assert "broad keyword rule suggests: Health" in prompt
    assert "Members golf club and course in Solihull." in prompt
    assert "WIDNEY MANOR GOLF ON 19 OCT" not in prompt           # description only, never raw bank text
    assert env.decisions.docs[f"{KEVIN}::widney manor golf"]["reason"]


def test_structural_and_lender_categories_stay_final(env):
    env.match_for = {KEVIN: "Golf"}
    rows = [env.add_txn(KEVIN, "SOME MORTGAGE LENDER", category="Mortgage"),
            env.add_txn(KEVIN, "LANDLORD RENT", category="Rent"),
            env.add_txn(KEVIN, "OWN SAVINGS POT", category="Savings"),
            env.add_txn(KEVIN, "WORK SALARY", category="Income", kind="credit")]
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert [env.cat_of(i) for i in rows] == ["Mortgage", "Rent", "Savings", "Income"]
    assert env.tavily_calls == []


def test_stored_decision_applies_without_any_network(env):
    t = env.add_txn(KEVIN, "WIDNEY MANOR GOLF", category="Health")
    env.decisions.docs[f"{KEVIN}::widney manor golf"] = {
        "_id": f"{KEVIN}::widney manor golf", "user_id": KEVIN, "merchant_key": "widney manor golf",
        "category": "Golf", "reason": "r",
        "categories_hash": vd.categories_hash(cat.VALID_CATEGORIES + env.customs[KEVIN])}
    assert run(vd.apply_decisions_for_user(KEVIN)) == 1
    assert env.cat_of(t) == "Golf"


def test_a_new_custom_category_makes_the_decision_stale_so_it_is_matched_again(env):
    env.match_for = {KEVIN: "Golf"}
    env.add_txn(KEVIN, "WIDNEY MANOR GOLF")
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert [p for p, _ in env.llm_calls].count("vendor_match") == 1
    env.customs[KEVIN] = ["Golf", "Padel", "Society"]
    run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert [p for p, _ in env.llm_calls].count("vendor_match") == 2


def test_ladder_ships_off_by_default(monkeypatch):
    import importlib
    from app.core import config as config_mod
    monkeypatch.delenv("VENDOR_LADDER_ENABLED", raising=False)
    try:
        importlib.reload(config_mod)
        assert config_mod.VENDOR_LADDER_ENABLED is False
        monkeypatch.setenv("VENDOR_LADDER_ENABLED", "true")
        importlib.reload(config_mod)
        assert config_mod.VENDOR_LADDER_ENABLED is True
    finally:
        monkeypatch.delenv("VENDOR_LADDER_ENABLED", raising=False)
        importlib.reload(config_mod)


def test_kill_switch_disables_the_ladder(env, monkeypatch):
    t = env.add_txn(KEVIN, "WIDNEY MANOR GOLF")
    env.decisions.docs[f"{KEVIN}::widney manor golf"] = {
        "_id": f"{KEVIN}::widney manor golf", "user_id": KEVIN, "merchant_key": "widney manor golf",
        "category": "Golf", "reason": "r", "categories_hash": vd.categories_hash(cat.VALID_CATEGORIES + env.customs[KEVIN])}
    monkeypatch.setattr(vd.cfg, "VENDOR_LADDER_ENABLED", False)
    reads = []

    class Spy(Col):
        def find(self, *a, **k):
            reads.append(1)
            return super().find(*a, **k)

        async def find_one(self, *a, **k):
            reads.append(1)
            return await super().find_one(*a, **k)
    for n in ("txns", "decisions"):
        spy = Spy(n, list(getattr(env, n).docs.values()))
        monkeypatch.setattr(vd, {"txns": "transactions_col", "decisions": "user_vendor_categories_col"}[n], spy)
    stats = run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert stats["skipped"] == "disabled" and env.tavily_calls == [] and env.cat_of(t) == "Health"
    assert run(vd.apply_decisions_for_user(KEVIN)) == 0
    assert reads == [] and env.cat_of(t) == "Health"


def test_apply_decisions_needs_custom_categories_and_a_matching_category_set(env):
    t = env.add_txn(KEVIN, "WIDNEY MANOR GOLF", category="Health")
    doc = {"_id": f"{KEVIN}::widney manor golf", "user_id": KEVIN, "merchant_key": "widney manor golf",
           "category": "Golf", "reason": "r", "categories_hash": "stale"}
    env.decisions.docs[doc["_id"]] = doc
    assert run(vd.apply_decisions_for_user(KEVIN)) == 0 and env.cat_of(t) == "Health"   # hash differs
    doc["categories_hash"] = vd.categories_hash(cat.VALID_CATEGORIES + env.customs[KEVIN])
    env.customs[KEVIN] = []
    assert run(vd.apply_decisions_for_user(KEVIN)) == 0 and env.cat_of(t) == "Health"   # no custom categories


def test_apply_decisions_skips_corrected_merchants_and_rule_matches(env):
    h = vd.categories_hash(cat.VALID_CATEGORIES + env.customs[KEVIN])
    for k in ("widney manor golf", "alpha golf"):
        env.decisions.docs[f"{KEVIN}::{k}"] = {"_id": f"{KEVIN}::{k}", "user_id": KEVIN, "merchant_key": k,
                                               "category": "Golf", "categories_hash": h}
    a = env.add_txn(KEVIN, "WIDNEY MANOR GOLF")
    env.add_txn(KEVIN, "WIDNEY MANOR GOLF", category="Padel", custom="Padel")
    b = env.add_txn(KEVIN, "ALPHA GOLF")
    env.rules.docs["r"] = {"_id": "r", "uid": KEVIN, "pattern": "alpha", "category": "Padel"}
    assert run(vd.apply_decisions_for_user(KEVIN)) == 0
    assert env.cat_of(a) == "Health" and env.cat_of(b) == "Health"


def test_refresh_returning_not_found_keeps_the_found_entry(env):
    env.tavily_answer = {"answer": "", "snippets": [], "urls": []}
    old = NOW - timedelta(days=400)
    env.vendors.docs["widney manor golf"] = {
        "_id": "widney manor golf", "merchant_key": "widney manor golf", "status": "found",
        "description": "Members golf club.", "display_name": "Widney Manor Golf", "type_tags": [],
        "domain": None, "sources": [], "confidence": "high", "version": 1, "looked_up_at": old}
    run(vd.ensure_vendor("widney manor golf", vd.SyncBudget(), NOW))
    d = env.vendors.docs["widney manor golf"]
    assert d["status"] == "found" and d["description"] == "Members golf club." and d["looked_up_at"] == NOW


def test_rule_matching_only_a_later_row_still_beats_the_ladder(env):
    env.rules.docs["r"] = {"_id": "r", "uid": KEVIN, "pattern": "on 7 oct", "category": "Padel"}
    for i in range(7):
        env.add_txn(KEVIN, f"WIDNEY MANOR GOLF ON {i + 1} OCT")
    stats = run(vd.run_vendor_ladder(KEVIN, now=NOW))
    assert stats["merchants"] == 1 and stats["rule_skipped"] == 1 and env.tavily_calls == []


def test_repeated_write_up_failures_trigger_a_short_global_backoff(env):
    env.describe = {"status": "banana"}
    for i in range(8):
        env.add_txn(KEVIN, f"ALPHA{chr(97 + i)} GOLF")
    s = run(vd.run_vendor_ladder(KEVIN, now=NOW, budget=vd.SyncBudget(20)))
    assert len(env.tavily_calls) == 5 and s["deferred"].get("backoff") == 3
    assert run(vd.backoff_until(NOW + timedelta(minutes=30)))
    assert not run(vd.backoff_until(NOW + timedelta(minutes=61)))


# ── Display name helper ─────────────────────────────────────────────────────

def test_vendor_display_name_helper(env):
    env.vendors.docs["widney manor golf"] = {"_id": "widney manor golf", "status": "found",
                                             "display_name": "Widney Manor Golf"}
    env.vendors.docs["zzqx"] = {"_id": "zzqx", "status": "not_found", "display_name": None}
    assert run(vd.vendor_display_name("widney manor golf")) == "Widney Manor Golf"
    assert run(vd.vendor_display_name("zzqx")) is None
    assert run(vd.vendor_display_name("missing")) is None
    assert run(vd.vendor_display_name("")) is None


def test_written_descriptions_have_no_em_dashes():
    assert "—" not in vd._clean_text("Golf club — members only", 100)


# ── Backfill ────────────────────────────────────────────────────────────────

def test_backfill_dry_run_touches_nothing_and_calls_nothing(env):
    env.match_for = {KEVIN: "Golf"}
    env.add_txn(KEVIN, "WIDNEY MANOR GOLF")
    env.add_txn(KEVIN, "CORRECTED GOLF CLUB", category="Padel", custom="Padel")
    env.add_txn(KEVIN, "CORRECTED GOLF CLUB", category="Health")      # open sibling of a corrected merchant
    env.add_txn(OTHER, "WIDNEY MANOR GOLF")
    env.rules.docs["r1"] = {"_id": "r1", "uid": KEVIN, "pattern": "meriden", "category": "Golf",
                            "created_at": NOW - timedelta(days=2)}
    env.rules.docs["r2"] = {"_id": "r2", "uid": KEVIN, "pattern": "meriden", "category": "Golf",
                            "created_at": NOW - timedelta(days=1)}
    before = {n: copy.deepcopy(getattr(env, n).docs) for n in ("vendors", "decisions", "claims", "state", "txns", "rules")}
    counts = run(bf.backfill(False, transactions=env.txns, rules_col=env.rules))
    after = {n: copy.deepcopy(getattr(env, n).docs) for n in before}
    assert before == after
    assert env.tavily_calls == [] and env.llm_calls == []
    assert counts["users"] == 2 and counts["users_with_custom_categories"] == 2
    assert counts["needs_lookup"] == 2 and counts["corrected_skipped"] == 1
    assert counts["duplicate_rule_sets"] == 1 and counts["duplicate_rule_extras"] == 1
    assert counts["duplicate_rules_removed"] == 0
    assert not any(isinstance(v, str) for v in counts.values())     # counts only


def test_backfill_apply_writes_but_never_touches_corrected_rows_and_dedupes(env):
    env.match_for = {KEVIN: "Golf"}
    open_row = env.add_txn(KEVIN, "WIDNEY MANOR GOLF")
    corrected = env.add_txn(KEVIN, "CORRECTED GOLF CLUB", category="Padel", custom="Padel")
    env.rules.docs["r1"] = {"_id": "r1", "uid": KEVIN, "pattern": "meriden", "category": "Golf",
                            "created_at": NOW - timedelta(days=2)}
    env.rules.docs["r2"] = {"_id": "r2", "uid": KEVIN, "pattern": "meriden", "category": "Golf",
                            "created_at": NOW - timedelta(days=1)}
    counts = run(bf.backfill(True, transactions=env.txns, rules_col=env.rules))
    assert env.cat_of(open_row) == "Golf"
    assert env.cat_of(corrected) == "Padel" and env.txns.docs[corrected]["custom_category"] == "Padel"
    assert counts["duplicate_rules_removed"] == 1 and list(env.rules.docs) == ["r1"]
