"""G418: a tip is shown only when it carries something beyond the user's own figure.

One server predicate (tip_facts.carries_beyond_own_figure, read by
savings_insights._has_researched_content) decides it, so every surface and every
count reads the same answer. Invented figures only; no network, no database."""
from datetime import datetime, timedelta

import pytest

import app.routers.savings_insights as si
from app.services import tip_facts
from tests.g315_fixtures import CASES, doc, row
from tests.test_g405_tip_pages import REG

TODAY = datetime(2026, 10, 21).date()
NOW = datetime.utcnow()  # naive-ok: test fixture timestamp matching the stored convention


def _stored(cat, content, **over):
    _, rows, _ = CASES.get(cat, (None, [row("Octopus Energy", 303.0, recurring=False)], None))
    d = {"_id": f"x-{cat}", "insight_id": f"{cat}-x", "category": cat, "pinned": False, "is_new": False,
         "refreshed_at": NOW, "researched_at": NOW - timedelta(days=1),
         "content_valid_until": NOW + timedelta(days=5), "triggered_by": rows,
         "prompt_version": si.PROMPT_VERSION, "title": content["title"], "body": content["body"]}
    d.update(over)
    return d


def _compose(cat, findings, context=None):
    _, rows, _ = CASES[cat]
    return si._compose_tip_content(cat, doc(findings), rows, context, TODAY)


def test_own_fact_only_tip_is_hidden_and_not_counted():
    own = _compose("groceries", {"typical_low": None, "typical_high": None, "alternatives": [], "deal": None, "sources": []})
    assert own and not tip_facts.carries_beyond_own_figure(own["body"])
    served = si._serialize_insight(_stored("groceries", own))
    assert served["state"] == "quiet" and served["title"] == "" and served["body"] == ""
    # the count a surface shows is the number of fresh or stale tips in the served list
    real = _compose("gym", CASES["gym"][2])
    served_all = [si._serialize_insight(_stored("groceries", own)), si._serialize_insight(_stored("gym", real))]
    assert [s["state"] for s in served_all].count("fresh") == 1


def test_own_fact_only_tip_never_wins_the_home_spotlight():
    own = _compose("groceries", {"typical_low": None, "typical_high": None, "alternatives": [], "deal": None, "sources": []})
    real = _compose("gym", CASES["gym"][2])
    docs = [_stored("groceries", own), _stored("gym", real)]
    assert [d["category"] for d in si._spotlight_candidates(docs)] == ["gym"]


def test_regulator_typical_line_keeps_the_tip():
    f = {"typical_low": None, "typical_high": None, "alternatives": [], "deal": None, "sources": [], "typical_regulated": dict(REG)}
    out = si._compose_tip_content("energy", doc(f), [row("British Gas", 303.0, recurring=False)], None, TODAY)
    assert "Typical: " in out["body"]
    assert si._serialize_insight(_stored("energy", out))["state"] == "fresh"


def test_like_for_like_also_listed_line_keeps_the_tip():
    out = _compose("gym", CASES["gym"][2])
    assert "Also listed: " in out["body"]
    assert si._serialize_insight(_stored("gym", out))["state"] == "fresh"


def test_dated_provider_price_change_keeps_the_tip():
    f = dict(CASES["gym"][2], alternatives=[], typical_low=None, typical_high=None,
             deal={"text": "David Lloyd lists a new joining fee", "valid_until": "2026-11-30"})
    out = _compose("gym", f)
    assert "Offer listed until 30 Nov." in out["body"]
    assert si._serialize_insight(_stored("gym", out))["state"] == "fresh"


def test_undated_deal_alone_does_not_keep_the_tip():
    f = dict(CASES["gym"][2], alternatives=[], typical_low=None, typical_high=None,
             deal={"text": "David Lloyd lists a new joining fee", "valid_until": None})
    out = _compose("gym", f)
    assert out and not tip_facts.carries_beyond_own_figure(out["body"])
    assert si._serialize_insight(_stored("gym", out))["state"] == "quiet"


def test_contract_ending_fact_keeps_a_regulated_tip():
    out = _compose("mortgage", CASES["mortgage"][2], context={"contract_end": "1 Dec 2026"})
    assert "You noted your " in out["body"]
    assert si._serialize_insight(_stored("mortgage", out))["state"] == "fresh"


def test_a_range_alone_is_not_a_real_line():
    f = dict(CASES["gym"][2], alternatives=[], deal=None)
    out = _compose("gym", f)
    assert "listed at" in out["body"] and not tip_facts.carries_beyond_own_figure(out["body"])


@pytest.mark.parametrize("body,expected", [
    ("That is based on 3 payments in the last 90 days. Checked 16 Oct.", False),
    ("", False), (None, False),
    ("Typical: £144 a month (Ofgem price cap). Checked 2 Nov.", True),
    ("Also listed: PureGym £25 a month. Checked 16 Oct.", True),
    ("Lists a fee. Offer listed until 30 Nov. Checked 16 Oct.", True),
    ("You noted your contract ends 1 Dec. Checked 16 Oct.", True),
])
def test_predicate(body, expected):
    assert tip_facts.carries_beyond_own_figure(body) is expected


def test_counts_script_refuses_without_mongo_db():
    import os
    import subprocess
    import sys
    from pathlib import Path
    script = Path(__file__).resolve().parents[1] / "scripts" / "tips_real_count.py"
    env = {k: v for k, v in os.environ.items() if k != "MONGO_DB"}
    done = subprocess.run([sys.executable, str(script), "someone"], env=env, capture_output=True, text=True, timeout=60)
    assert done.returncode == 2 and "MONGO_DB" in done.stderr and done.stdout == ""
