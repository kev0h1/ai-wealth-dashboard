"""G410: the pooled Left to spend is identical with and without the earmark
(G336: an own-account move never changes the pool). Lives in its own file
because it drives the real scenario harness, which refuses to run after a test
that left fake collection handles bound (H143)."""
import json
from pathlib import Path

import app.services.companion as companion

SCEN = Path(__file__).parent / "scenarios"


def test_pooled_left_to_spend_is_identical_with_and_without_the_earmark(monkeypatch):
    """G336: an own-account move never changes the pool. Run the earmark
    scenario for real, then again with the move gate forced closed (no live
    move, so no earmark): the pooled figure is the same, the earmark is gone."""
    import test_scenarios as ts

    spec = json.loads((SCEN / "g410-earmark-suggested-move.json").read_text())
    with_move = ts._json_roundtrip(ts._run_scenario(spec, "g410-pool-a", monkeypatch))
    assert with_move["account_eligibility"]["acc-hc"]["earmarked_total"] == 200.0

    async def _closed(**_kw):
        return companion._RegularMoveCardGate({}, {}, 0)

    monkeypatch.setattr(companion, "_gate_regular_move_cards", _closed)
    without = ts._json_roundtrip(ts._run_scenario(spec, "g410-pool-b", monkeypatch))
    assert "earmarked_total" not in without["account_eligibility"]["acc-hc"]
    assert with_move["safe_to_spend"]["safe_to_spend"] == without["safe_to_spend"]["safe_to_spend"] == 1810.0
