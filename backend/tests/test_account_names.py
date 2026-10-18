"""G282: the shared display-name table (also run by the frontend check)."""
import json
from pathlib import Path

import pytest

from app.services.account_names import display_account_name
from app.services.companion import humanise_account_name

TABLE = json.loads((Path(__file__).resolve().parents[2] / "shared" / "account-name-cases.json").read_text())


@pytest.mark.parametrize("raw,expected", TABLE)
def test_display_account_name_table(raw, expected):
    assert display_account_name(raw) == expected


def test_none_is_empty():
    assert display_account_name(None) == ""


def test_humanise_strips_trailing_full_stop():
    assert humanise_account_name("THE NUMBER ONE REWARD PLATINUM.") == "The Number One Reward Platinum"
    assert humanise_account_name("NW World Mastercard") == "NW World Mastercard"
