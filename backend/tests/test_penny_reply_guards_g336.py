"""G336: the pure reply guards, the planner's user exclusions and the
unchanged-left-to-spend sentence (offline, no model, no DB)."""
import pytest

from app.services import penny_consolidation as pc
from app.services import penny_reply_guards as g
from test_penny_consolidation_g334 import _acc, _elig, kevin

RESULT = {
    "summary": "You could move up to £200.00 into your Barclays account: £146.00 from NatWest and £54.00 from Starling.",
    "total": {"raw": 200.0}, "pool": {"raw": 236.0}, "requested": None, "shortfall": {"raw": 0.0},
    "target": {"own_headroom": {"raw": 40.0}},
    "legs": [{"amount": {"raw": 146.0}, "keeps": {"raw": 25.0}}, {"amount": {"raw": 54.0}, "keeps": {"raw": 0.0}}],
}


def test_extract_amounts_handles_commas_pence_and_minus():
    assert g.extract_amounts("£1,234.50 and −£5 and £146.") == [1234.5, 5.0, 146.0]
    assert g.extract_amounts("no money here") == []


def test_figures_the_tool_returned_pass():
    reply = "£146 from NatWest and £54.00 from Starling is £200 in total, from a pool of £236. Barclays keeps £40."
    assert g.guard_consolidation_reply(reply, [RESULT]) == (reply, 0)


@pytest.mark.parametrize("bad", ["£414", "£650", "Your balances total £1,594.00"])
def test_stray_figure_replaces_reply_with_summary(bad):
    out, stray = g.guard_consolidation_reply(f"You can move £200 and {bad} sits elsewhere.", [RESULT])
    assert out == RESULT["summary"] and stray >= 1


def test_no_summary_means_reply_stands():
    reply = "£414 from somewhere"
    assert g.guard_consolidation_reply(reply, [{"error": "x"}]) == (reply, 0)
    assert g.guard_consolidation_reply(reply, []) == (reply, 0)


def test_rise_claim_sentence_replaced_rest_kept():
    reply = "You could move £200 into Barclays. Your left to spend would rise from £236 to £650 if you move it. Starling keeps £5."
    out, changed = g.fix_unchanged_claim(reply)
    assert changed
    assert "£650" not in out and "would rise" not in out
    assert g.UNCHANGED_SENTENCE in out and out.count(g.UNCHANGED_SENTENCE) == 1
    assert out.startswith("You could move £200 into Barclays.") and out.endswith("Starling keeps £5.")


@pytest.mark.parametrize("claim", [
    "Left to spend goes up when you transfer it.",
    "Your safe to spend would fall after the move.",
    "Moving it will increase your left-to-spend.",
])
def test_other_phrasings_of_the_claim(claim):
    out, changed = g.fix_unchanged_claim("Here is the move. " + claim)
    assert changed and g.UNCHANGED_SENTENCE in out


def test_no_false_positive_without_a_move_or_without_the_claim():
    assert g.fix_unchanged_claim("Your left to spend will increase when your pay lands.") == (
        "Your left to spend will increase when your pay lands.", False)
    reply = f"You could move £200. {g.UNCHANGED_SENTENCE}"
    assert g.fix_unchanged_claim(reply) == (reply, False)


def test_existing_true_sentence_is_not_duplicated():
    reply = f"{g.UNCHANGED_SENTENCE} Your left to spend would rise if you move it."
    out, changed = g.fix_unchanged_claim(reply)
    assert changed and out.count(g.UNCHANGED_SENTENCE) == 1


def test_planner_skips_user_exclusions_and_says_so():
    plan = kevin(excluded_ids={"star"})
    assert [l["name"] for l in plan["legs"]] == ["NatWest Select"]
    reasons = {s["account_id"]: s["reason"] for s in plan["skipped"]}
    assert reasons["star"] == "excluded_by_user"
    assert "Starling Personal left out as you asked" in plan["summary"]
    assert plan["left_to_spend_unchanged"] is True


def test_summary_ends_with_unchanged_sentence_when_legs_exist():
    plan = kevin()
    assert plan["summary"].endswith("Moving money between your own accounts does not change your left to spend.")
    assert plan["left_to_spend_unchanged"] is True
    none = kevin(eligibility={})
    assert not none["legs"] and not none["summary"].endswith(pc.UNCHANGED_SENTENCE)


def test_resolve_excluded_ids_by_name_bank_and_id():
    accounts = [_acc("a", "Barclays Savings", "ob-barclays", subtype="SAVINGS"), _acc("b", "NatWest Select", "ob-natwest"),
                _acc("c", "Saving Challenge", "ob-monzo", subtype="SAVINGS")]
    assert pc.resolve_excluded_ids(["savings"], accounts, []) == ({"a", "c"}, [])
    assert pc.resolve_excluded_ids(["natwest", "c"], accounts, []) == ({"b", "c"}, [])
    assert pc.resolve_excluded_ids(None, accounts, []) == (set(), [])
    assert pc.resolve_excluded_ids("", accounts, []) == (set(), [])
    assert pc.resolve_excluded_ids(["natwest", "Halifax"], accounts, []) == ({"b"}, ["Halifax"])


def test_schema_has_exclusion_array():
    props = pc.PLAN_CONSOLIDATION_SCHEMA["function"]["parameters"]["properties"]
    assert props["exclude_account_ids_or_names"]["type"] == "array"


def test_get_safe_to_spend_description_and_spend_from(monkeypatch):
    import asyncio
    from app.services import penny_tools
    desc = next(t for t in penny_tools.TOOL_SCHEMAS if t["function"]["name"] == "get_safe_to_spend")["function"]["description"]
    assert "never changes safe_to_spend" in desc

    async def today(uid):
        return {"account_eligibility": {"nat": _elig(146, 171), "star": _elig(54), "hsbc": _elig(0), "monzo": _elig(1594)}}

    async def accs(uid):
        return [_acc("nat", "NatWest Select", "ob-natwest"), _acc("star", "Starling Personal", "ob-starling"),
                _acc("hsbc", "HSBC Maingi", "ob-hsbc"), _acc("monzo", "Saving Challenge", "ob-monzo", subtype="SAVINGS"),
                _acc("amex", "Amex", "ob-amex", subtype="CREDIT_CARD", typ="credit_card")]

    async def pots(uid):
        return {"monzo"}

    async def tokens(uid):
        return []

    import app.services.notifications as notifications
    monkeypatch.setattr(pc, "_load_today", today)
    monkeypatch.setattr(pc, "_load_accounts", accs)
    monkeypatch.setattr(pc, "_load_pot_ids", pots)
    monkeypatch.setattr(notifications, "_user_name_tokens", tokens)
    out = asyncio.run(pc.spend_from_extras("u"))
    assert out["own_account_moves_change_total"] is False
    assert [(s["name"], s["amount"]["raw"], s["held_back"]["raw"]) for s in out["spend_from"]] == [
        ("NatWest Select", 146.0, 25.0), ("Starling Personal", 54.0, 0.0)]
    assert all("keeps" not in e for e in out["spend_from"])
    assert {(e["name"], e["reason"]) for e in out["excluded"]} == {("Saving Challenge", "set_aside_pot"), ("Amex", "credit_card")}


def test_spend_from_extras_never_raises(monkeypatch):
    import asyncio

    async def boom(uid):
        raise RuntimeError("x")

    monkeypatch.setattr(pc, "_load_today", boom)
    assert asyncio.run(pc.spend_from_extras("u")) == {"own_account_moves_change_total": False}


def test_move_word_must_be_in_the_same_sentence():
    reply = "Your left to spend falls by £60 on Friday when rent leaves. Moving £200 into Barclays works."
    assert g.fix_unchanged_claim(reply) == (reply, False)
    reply2 = "Your left to spend rose by £60 last week. You could transfer £200 into Barclays."
    assert g.fix_unchanged_claim(reply2) == (reply2, False)


@pytest.mark.parametrize("verb", ["fell", "fallen", "rose", "risen", "dropped", "climbed", "jumped", "jumps"])
def test_wider_direction_verbs_with_a_move_in_the_sentence(verb):
    out, changed = g.fix_unchanged_claim(f"Here is the plan. Your left to spend {verb} after you move the money.")
    assert changed and g.UNCHANGED_SENTENCE in out and verb not in out


def test_figures_from_other_tool_results_and_the_floor_are_allowed():
    sts = {"safe_to_spend": {"raw": 236.0, "formatted": "£236"}, "spend_from": [{"held_back": {"raw": 12.5}}]}
    reply = "Left to spend is £236. £146 from NatWest and £54 from Starling gives £200. Keep at least £5."
    assert g.guard_consolidation_reply(reply, [RESULT], [sts, RESULT]) == (reply, 0)
    out, stray = g.guard_consolidation_reply("Your balances are £414 in all.", [RESULT], [sts, RESULT])
    assert out == RESULT["summary"] and stray == 1
    assert g.guard_consolidation_reply("Held back £12.50.", [RESULT], [sts, RESULT])[1] == 0


def test_unmatched_exclusion_is_reported_in_the_plan_and_summary():
    plan = kevin(unmatched_exclusions=["Halifax"])
    assert plan["unmatched_exclusions"] == ["Halifax"]
    assert "I could not match Halifax to one of your accounts." in plan["summary"]
    assert plan["summary"].endswith(pc.UNCHANGED_SENTENCE)
    assert "—" not in plan["summary"]
    assert kevin()["unmatched_exclusions"] == []
    assert "could not match" not in kevin()["summary"]


def test_move_plan_validator_accepts_unmatched_exclusions():
    from app.services import penny_move_plan as mp
    block = {"kind": "move_plan", "target": {"name": "Barclays", "bank": None, "provider": None},
             "legs": [{"name": "NatWest", "bank": None, "provider": None, "amount": 10, "keeps": 0}],
             "total": 10, "pool": None, "requested": None, "shortfall": 0, "summary": "s", "skipped": [],
             "unmatched_exclusions": ["Halifax"]}
    assert mp.validate_move_plan(block)["unmatched_exclusions"] == ["Halifax"]
    assert mp.validate_or_none({**block, "unmatched_exclusions": "x"}) is None
    assert mp.validate_or_none({**block, "unmatched_exclusions": ["<b>"]}) is None
    del block["unmatched_exclusions"]
    assert "unmatched_exclusions" not in mp.validate_move_plan(block)
