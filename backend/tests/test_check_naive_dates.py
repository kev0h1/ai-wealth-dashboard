"""Tests for scripts/check_naive_dates.py's ALLOWLIST matching (`_collect_hits`
/ `_check_file`), specifically the two loopholes an independent review of
H82 found and reproduced on 2026-09-28 in the sibling
backend/tests/test_no_raw_exception_leak.py ALLOWLIST, which copied this
script's (file, exact source text) keying design and inherited both bugs:

1. The `count` comparison used to be an upper bound (`len(linenos) <=
   allowed_count`), so a REDUCTION in the number of real occurrences below
   a stale `count` passed silently instead of failing. That is not
   theoretical here: running the fixed comparison against this repository's
   own backend/app immediately found exactly this drift in
   app/services/companion.py's "created_at": datetime.utcnow(), entry
   (count said 4, only 3 occurrences remained), fixed as part of the same
   change that added this test file.

2. A bare `# naive-ok:` (or one with only whitespace after the colon) used
   to suppress a hit exactly like a real reason would.

Loaded the same way scripts/check_pentest_evidence.py's own test file
(test_check_pentest_evidence.py) loads that script: nothing here scans this
repository's real backend/app (except the one pinned regression test at the
bottom, which asserts the actual CLI is clean right now).
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "check_naive_dates.py"


def _load_check_module():
    spec = importlib.util.spec_from_file_location("check_naive_dates_script_under_test", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


check_naive_dates = _load_check_module()


def test_exact_count_match_passes():
    text = (
        "def one():\n"
        "    return datetime.now(timezone.utc)\n"
        "\n"
        "def two():\n"
        "    return datetime.now(timezone.utc)\n"
    )
    hits_by_text, bad_pragmas = check_naive_dates._collect_hits(text)
    assert not bad_pragmas
    allowed_here = {
        "return datetime.now(timezone.utc)": {"reason": "test fixture", "count": 2},
    }
    assert check_naive_dates._check_file("fake.py", hits_by_text, allowed_here) == []


def test_reduction_below_declared_count_is_flagged():
    """H82 follow-up: an ALLOWLIST entry whose declared `count` is HIGHER
    than the number of matching occurrences actually left in the file must
    fail, not pass silently. Before this fix, `len(linenos) <=
    allowed_count` accepted any undercount -- so fixing or removing one of
    two identically-texted sites left a budget of one that a later,
    unrelated, un-triaged site could quietly reuse without ever being
    reviewed, because it would just look like it fit under the same old
    count."""
    text = "def one():\n    return datetime.now(timezone.utc)\n"
    hits_by_text, bad_pragmas = check_naive_dates._collect_hits(text)
    assert not bad_pragmas

    allowed_here = {
        "return datetime.now(timezone.utc)": {
            "reason": "was two sites sharing this reason; one was fixed since",
            "count": 2,  # stale -- only 1 occurrence remains
        },
    }
    failures = check_naive_dates._check_file("fake.py", hits_by_text, allowed_here)
    assert len(failures) == 1
    assert "count must be updated" in failures[0]
    assert "1 occurrence" in failures[0]


def test_overcount_new_untriaged_copy_is_flagged():
    text = (
        "def one():\n"
        "    return datetime.now(timezone.utc)\n"
        "\n"
        "def two():\n"
        "    return datetime.now(timezone.utc)\n"
        "\n"
        "def three():\n"
        "    return datetime.now(timezone.utc)\n"
    )
    hits_by_text, bad_pragmas = check_naive_dates._collect_hits(text)
    assert not bad_pragmas

    allowed_here = {
        "return datetime.now(timezone.utc)": {"reason": "test fixture", "count": 2},
    }
    failures = check_naive_dates._check_file("fake.py", hits_by_text, allowed_here)
    assert len(failures) == 1
    assert "count must be updated" in failures[0]
    assert "3 occurrence" in failures[0]


def test_unallowlisted_naive_call_is_a_new_violation():
    text = "def one():\n    return date.today()\n"
    hits_by_text, bad_pragmas = check_naive_dates._collect_hits(text)
    assert not bad_pragmas
    failures = check_naive_dates._check_file("fake.py", hits_by_text, {})
    assert failures == ["fake.py:2: return date.today()"]


def test_reasoned_pragma_suppresses_the_hit():
    text = (
        "def one():\n"
        "    return date.today()  # naive-ok: test fixture, one-off\n"
    )
    hits_by_text, bad_pragmas = check_naive_dates._collect_hits(text)
    assert hits_by_text == {}
    assert bad_pragmas == []


def test_bare_naive_ok_pragma_is_flagged():
    """A '# naive-ok:' with no reason at all must not silently suppress a
    genuine naive-datetime call -- it must be reported as its own failure,
    never matched against ALLOWLIST."""
    text = "def one():\n    return date.today()  # naive-ok:\n"
    hits_by_text, bad_pragmas = check_naive_dates._collect_hits(text)
    assert hits_by_text == {}  # never entered the ALLOWLIST-matching path
    assert bad_pragmas == [(2, "return date.today()  # naive-ok:")]


def test_whitespace_only_naive_ok_pragma_is_flagged():
    text = "def one():\n    return date.today()  # naive-ok:    \n"
    hits_by_text, bad_pragmas = check_naive_dates._collect_hits(text)
    assert hits_by_text == {}
    assert len(bad_pragmas) == 1
    assert bad_pragmas[0][0] == 2


def test_too_short_naive_ok_reason_is_flagged():
    text = "def one():\n    return date.today()  # naive-ok: ok\n"
    hits_by_text, bad_pragmas = check_naive_dates._collect_hits(text)
    assert hits_by_text == {}
    assert len(bad_pragmas) == 1


def test_real_reason_pragma_is_not_flagged_as_bad():
    text = "def one():\n    return date.today()  # naive-ok: lookback window\n"
    hits_by_text, bad_pragmas = check_naive_dates._collect_hits(text)
    assert hits_by_text == {}
    assert bad_pragmas == []


def test_this_repositorys_own_backend_app_is_clean():
    """Pinned regression test: the actual CLI, run against this
    repository's real backend/app, must exit 0. This is what would have
    caught the app/services/companion.py count=4-vs-3 drift (fixed
    alongside this test file) the moment the exact-match fix landed."""
    rc = check_naive_dates.main()
    assert rc == 0
