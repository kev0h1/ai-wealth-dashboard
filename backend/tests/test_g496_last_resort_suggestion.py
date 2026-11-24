"""G496: the read-only last-resort suggestion when no source can cover a gap."""
import json
from pathlib import Path

from app.services.last_resort import build_last_resort
from tests.test_scenarios import _json_roundtrip, _moves, _run_scenario

SLUG = "g496-no-source-last-resort-names-goals-on-the-short-account"
SCEN = Path(__file__).parent / "scenarios"


def _plan(pid, name, remaining, source="acc-a", kind="goal", **kw):
    return {"id": f"{kind}:{pid}", "record_id": pid, "kind": kind, "name": name,
            "remaining": remaining, "source_account_id": source, "active": True, **kw}


def test_options_largest_first_and_frees_capped_at_gap():
    lr = build_last_resort("acc-a", 100.0, [_plan("1", "Holiday", 60), _plan("2", "Daily", 336.56)])
    assert [o["name"] for o in lr["options"]] == ["Daily", "Holiday"]
    assert [o["frees"] for o in lr["options"]] == [100.0, 60.0]
    assert [o["covers_gap"] for o in lr["options"]] == [True, False]
    assert lr["total_frees"] == 100.0 and lr["covers_gap"] is True


def test_set_aside_kind_and_total_when_plans_do_not_cover_gap():
    lr = build_last_resort("acc-a", 100.0, [_plan("9", "Rainy day", 30, kind="allocation")])
    assert lr["options"][0]["kind"] == "set_aside"
    assert lr["total_frees"] == 30.0 and lr["covers_gap"] is False
    assert "free up to £30" in lr["sentence"] and "—" not in lr["sentence"]


def test_absent_when_nothing_eligible():
    plans = [
        _plan("1", "Other account", 50, source="acc-b"),
        _plan("2", "Inactive", 50, active=False),
        _plan("3", "Card plan", 50, plan_kind="card_repayment"),
        _plan("4", "Nothing left", 0),
    ]
    assert build_last_resort("acc-a", 100.0, plans) is None
    assert build_last_resort("acc-a", 0.0, [_plan("1", "G", 50)]) is None


def test_scenario_names_goals_on_each_short_account_and_moves_nothing(monkeypatch):
    snap = _json_roundtrip(_run_scenario(json.loads((SCEN / f"{SLUG}.json").read_text()), SLUG, monkeypatch))
    assert _moves(snap) == []
    hs = snap["account_eligibility"]["acc-hs"]["last_resort"]
    assert [(o["name"], o["frees"]) for o in hs["options"]] == [("Holiday Fund", 60.0), ("Car Fund", 25.0)]
    ns = [i for i in snap["items"] if i["type"] == "move" and i.get("last_resort")]
    assert len(ns) == 1 and ns[0]["last_resort"] == hs


def test_not_emitted_when_a_source_covers_the_gap(monkeypatch):
    slug = "g414-plan-and-payment-shortfalls-covered"
    snap = _json_roundtrip(_run_scenario(json.loads((SCEN / f"{slug}.json").read_text()), slug, monkeypatch))
    assert all("last_resort" not in e for e in snap["account_eligibility"].values())
    assert all("last_resort" not in i for i in snap["items"])
