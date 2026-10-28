"""G356 step 2: nothing is "set up" until the user confirms the card."""
import pytest

from app.services import penny_reply_guards as guards

WRONG = ("Perfect. Your plan is set up: £11.48 a day, rising by 4p a day, from Fri 30 Oct 2026 until Sat 16 Jan 2027 "
         "comes to £1,030.16 in total. Which account should this money leave from?")


def test_claim_is_rewritten_when_no_proposal_exists():
    out = guards.fix_premature_setup_claims(WRONG, False)
    assert out.startswith("Your plan is ready to confirm: £11.48 a day")
    assert "Perfect" not in out and "is set up" not in out
    assert out.endswith("Which account should this money leave from?")


@pytest.mark.parametrize("said,expected", [
    ("The goal has been created.", "The goal is ready to confirm."),
    ("Done. Your plan is now set up.", "Your plan is ready to confirm."),
    ("Your savings plan is saved and the schedule runs to January.", "Your savings plan is ready to confirm and the schedule runs to January."),
    ("The plan is all set.", "The plan is ready to confirm."),
    ("I've set up your plan.", "Your plan is ready to confirm."),
    ("Great! The goal is done.", "The goal is ready to confirm."),
])
def test_other_phrasings(said, expected):
    assert guards.fix_premature_setup_claims(said, False) == expected


def test_untouched_when_a_proposal_was_created():
    assert guards.fix_premature_setup_claims(WRONG, True) == WRONG


@pytest.mark.parametrize("text", [
    "Your set-aside is already filled.",
    "Done. Your left to spend is £120.",
    "Perfect. Here is the plan.",
    "",
])
def test_unrelated_text_untouched(text):
    assert guards.fix_premature_setup_claims(text, False) == text


def test_first_letter_is_capitalised_after_stripping_filler():
    assert guards.fix_premature_setup_claims("Perfect. I've set up your plan.", False) == "Your plan is ready to confirm."
