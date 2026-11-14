"""G468: the read-only comparison script, exercised over a fixture database only
(wealth_test_*, via the suite's mongo_env). Invented rows."""
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

import app.db.collections as collections
import test_g447_single_review_pipeline as g447
from test_g442_ai_transfer_judgement import TOKENS, UID, _arun, _row, mongo_env

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g468_compare_windows as script  # noqa: E402

SCRIPT_SRC = (Path(__file__).resolve().parents[1] / "scripts" / "g468_compare_windows.py").read_text()


def _rows():
    fri = datetime(2026, 11, 13, 22, 27)
    return [
        # a named pair 20 hours apart: old rule asks (different London days), new rule files it
        _row("n-c", "credit", 70.0, "hsbc", fri, "HARTLEY J E HSBC"),
        _row("n-d", "debit", 70.0, "natw", fri + timedelta(hours=20), "JORDAN HARTLEY HSBC STO"),
        # a same-day named pair: both rules file it
        _row("s-c", "credit", 41.0, "hsbc", datetime(2026, 11, 2, 10), "HARTLEY J E HSBC"),
        _row("s-d", "debit", 41.0, "natw", datetime(2026, 11, 2, 12), "JORDAN HARTLEY HSBC STO"),
        # an unnamed pair 2 days apart: ask under the new rule, none under the old
        _row("u-c", "credit", 33.0, "hsbc", datetime(2026, 11, 4, 9), "NORTHWIND TEST"),
        _row("u-d", "debit", 33.0, "natw", datetime(2026, 11, 6, 9), "K NORTHWIND TEST FT"),
    ]


def test_counts_per_rule_and_the_automatic_list():
    out = script.report(_rows(), g447.BY_ID, TOKENS, set())
    assert "old (same London day): automatic=1 ask=0 none=2" in out
    assert "new (24 h auto / 3 day ask): automatic=2 ask=1 none=0" in out
    assert "[NEW: old rule would not file this]" in out
    assert "owner name on a leg" in out
    assert "Pairs filing automatically under the new rule (2)" in out


def test_old_and_new_classification_per_pair():
    old = script.classify(_rows(), g447.BY_ID, TOKENS, set(), "old")
    new = script.classify(_rows(), g447.BY_ID, TOKENS, set(), "new")
    ids = lambda res, k: sorted((c["_id"], d["_id"]) for c, d in res[k])  # noqa: E731
    assert ids(old, "automatic") == [("s-c", "s-d")]
    assert ids(new, "automatic") == [("n-c", "n-d"), ("s-c", "s-d")]
    assert ids(old, "ask") == [] and ids(new, "ask") == [("u-c", "u-d")]
    assert ("u-c", "u-d") in ids(old, "none") and ("n-c", "n-d") in ids(old, "none")
    # the module's own timing functions are restored after the comparison
    import app.services.own_account_transfers as oat
    assert oat.within_auto_window(datetime(2026, 11, 3, 23), datetime(2026, 11, 4, 1))


def test_load_reads_only_and_leaves_the_fixture_untouched(monkeypatch):
    async def run():
        async with mongo_env(monkeypatch, _rows(), accounts=g447.ACCTS) as cols:
            for attr in ("accounts_col", "transactions_col", "user_profiles_col", "confirmed_transfer_pairs_col"):
                monkeypatch.setattr(collections, attr, cols[attr[:-4]])
            assert collections.db.name.startswith("wealth_test_") or collections.db.name == "wealth_test"
            before = {n: await c.count_documents({}) for n, c in cols.items()}
            rows, accounts, tokens, learned = await script.load(UID)
            assert len(rows) == 6 and set(accounts) >= {"natw", "hsbc"} and tokens == TOKENS
            assert {n: await c.count_documents({}) for n, c in cols.items()} == before
    _arun(run())


def test_the_script_source_has_no_write_calls():
    assert not re.search(r"\.(insert_one|insert_many|update_one|update_many|replace_one|delete_one|delete_many|"
                         r"bulk_write|find_one_and_\w+|drop|drop_collection|create_index|aggregate)\(", SCRIPT_SRC)
