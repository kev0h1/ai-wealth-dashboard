"""G243: the routing corpus is well-formed (offline, no model)."""
import asyncio

import penny_arithmetic_corpus as g241
import penny_routing_corpus as corpus
from app.services import penny_tools


def test_required_tools_exist_and_one_first_tool_each():
    names = {t["function"]["name"] for t in penny_tools.TOOL_SCHEMAS}
    ids = set()
    for c in corpus.ROUTING_CASES:
        assert c["id"] not in ids
        ids.add(c["id"])
        assert c["first"] in names and set(c["required"]) <= names
        assert c["first"] in c["required"]


def test_combined_set_is_about_thirty_questions():
    # G245/G246 added 5 rows (2 growth, 3 simulator replacements) to the G241 corpus.
    assert 28 <= len(g241.CASES) + len(corpus.ROUTING_CASES) <= 41


def test_padel_fixture_is_eleven_payments_totalling_225():
    fake = corpus.fake_execute_factory(penny_tools.execute_tool, g241.FIXTURES, g241.VERDICT_BY_OFFSET, True)
    res = asyncio.run(fake("u", "get_category_spend", {"category": "padel", "months": 1}))
    assert res["last_n_months"]["spent"]["raw"] == 225.0 and res["last_n_months"]["payments_count"] == 11
    pre = asyncio.run(corpus.fake_execute_factory(penny_tools.execute_tool, g241.FIXTURES, g241.VERDICT_BY_OFFSET, False)(
        "u", "search_transactions", {"q": "Padel"}))
    assert pre["matched_count"] == 0 and pre["match_kind"] == "text"
    post = asyncio.run(fake("u", "search_transactions", {"q": "Padel"}))
    assert post["match_kind"] == "category" and post["matched_count"] == 11


def test_affordability_fixture_arithmetic():
    fake = corpus.fake_execute_factory(penny_tools.execute_tool, g241.FIXTURES, g241.VERDICT_BY_OFFSET, True)
    res = asyncio.run(fake("u", "check_affordability", {"amount": 60}))
    assert res["remaining_after"]["raw"] == 352
