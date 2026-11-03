"""G410: Penny reads the earmark from the engine's account_eligibility fields,
one plain sentence each, a recommendation never an action. Pure test of the
shared reader; invented names and figures."""
from app.services.penny_consolidation import earmark_facts

ACCOUNTS = [
    {"id": "h", "name": "Harbour Current", "provider": "barclays"},
    {"id": "m", "name": "Meadow Current", "provider": "natwest"},
]
ELIG = {
    "h": {"spend_from_headroom": 1790.0, "earmarked_total": 210.0,
          "earmarks_out": [{"to_account_id": "m", "to_name": "Meadow Current", "amount": 210.0}]},
    "m": {"after_payments": -999.0, "low_point": -999.0, "short_after_cover": 0.0,
          "covered_by_move": {"amount": 210.0, "shortfall": 200.0, "from": [{"account_id": "h", "name": "Harbour Current", "amount": 210.0}]}},
}


def test_one_sentence_per_source_and_destination():
    facts = earmark_facts(eligibility=ELIG, accounts=ACCOUNTS, name_tokens=[])
    assert facts["earmarked"][0]["earmarked_total"]["raw"] == 210.0
    assert "£210.00 is set aside in" in facts["earmarked"][0]["sentence"]
    assert "suggested move to Meadow Current" in facts["earmarked"][0]["sentence"]
    cov = facts["covered_by_move"][0]
    assert "is short £200.00, covered by the suggested move from" in cov["sentence"]
    assert cov["short_after_cover"]["raw"] == 0.0
    for row in facts["earmarked"] + facts["covered_by_move"]:
        assert "—" not in row["sentence"] and "!" not in row["sentence"]


def test_partial_cover_says_still_short():
    elig = {**ELIG, "m": {**ELIG["m"], "short_after_cover": 61.5}}
    cov = earmark_facts(eligibility=elig, accounts=ACCOUNTS, name_tokens=[])["covered_by_move"][0]
    assert "would still be short £61.50 after the suggested move from" in cov["sentence"]


def test_nothing_when_no_move_is_live():
    plain = {"h": {"spend_from_headroom": 2000.0}, "m": {"after_payments": -200.0}}
    facts = earmark_facts(eligibility=plain, accounts=ACCOUNTS, name_tokens=[])
    assert facts == {"earmarked": [], "covered_by_move": [], "by_account": {}}
