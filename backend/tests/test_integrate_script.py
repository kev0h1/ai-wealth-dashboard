"""Tests for scripts/integrate.py's dependency-reinstall and
service-restart logic.

Everything here loads the script as a module and monkeypatches `_sh` (and
`_systemctl_restart` where relevant) so no test ever runs a real git, npm,
pip, or systemctl command.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "integrate.py"


def _load_integrate_module():
    spec = importlib.util.spec_from_file_location("integrate_script_under_test", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


integrate = _load_integrate_module()


def test_install_dependencies_pip_when_requirements_changed(monkeypatch):
    calls: list[tuple] = []

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        calls.append((cmd, cwd, timeout))
        return 0, ""

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    integrate._install_dependencies({"backend/requirements.txt"})

    assert len(calls) == 1
    cmd, cwd, timeout = calls[0]
    assert cmd == [
        str(integrate.REPO_ROOT / "backend" / ".venv" / "bin" / "pip"),
        "install",
        "-q",
        "-r",
        "requirements.txt",
    ]
    assert cwd == integrate.REPO_ROOT / "backend"
    assert timeout == 900


def test_install_dependencies_npm_ci_when_package_lock_changed(monkeypatch):
    calls: list[tuple] = []

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        calls.append((cmd, cwd, timeout))
        return 0, ""

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    integrate._install_dependencies({"frontend/package-lock.json"})

    assert calls == [(["npm", "ci"], integrate.REPO_ROOT / "frontend", 900)]


def test_install_dependencies_npm_ci_when_package_json_changed(monkeypatch):
    calls: list[tuple] = []

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        calls.append((cmd, cwd, timeout))
        return 0, ""

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    integrate._install_dependencies({"frontend/package.json"})

    assert calls == [(["npm", "ci"], integrate.REPO_ROOT / "frontend", 900)]


def test_install_dependencies_noop_when_unrelated_change(monkeypatch):
    calls: list[tuple] = []

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        calls.append((cmd, cwd, timeout))
        return 0, ""

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    integrate._install_dependencies({"backend/app/services/x.py"})

    assert calls == []


def test_install_dependencies_pip_failure_raises(monkeypatch):
    monkeypatch.setattr(integrate, "_sh", lambda *a, **k: (1, "boom"))

    with pytest.raises(integrate.IntegrateError):
        integrate._install_dependencies({"backend/requirements.txt"})


def test_install_dependencies_npm_ci_failure_raises(monkeypatch):
    monkeypatch.setattr(integrate, "_sh", lambda *a, **k: (1, "boom"))

    with pytest.raises(integrate.IntegrateError):
        integrate._install_dependencies({"frontend/package-lock.json"})


def test_restart_services_backend_change_restarts_api_and_worker(monkeypatch):
    restarted: list[str] = []
    monkeypatch.setattr(integrate, "_systemctl_restart", lambda service: restarted.append(service))
    monkeypatch.setattr(integrate, "_sh", lambda *a, **k: (0, ""))

    integrate._restart_services({"backend/app/services/x.py"})

    assert restarted == ["wealth-api", "wealth-worker"]


def test_restart_services_frontend_only_change_restarts_neither_backend_service(monkeypatch):
    restarted: list[str] = []
    monkeypatch.setattr(integrate, "_systemctl_restart", lambda service: restarted.append(service))
    monkeypatch.setattr(integrate, "_sh", lambda *a, **k: (0, ""))

    integrate._restart_services({"frontend/components/Foo.tsx"})

    assert "wealth-api" not in restarted
    assert "wealth-worker" not in restarted
    assert restarted == ["wealth-frontend"]


# --- frontend gate checks (H23) -------------------------------------------
#
# scripts/session.sh finish already ran check:design-index and (H23)
# check:legal-content before pushing a branch for review, but integrate.py
# itself never re-ran them, so a merge could still land a broken privacy.md
# renumbering on main if review was skipped or predated the gate (F14,
# 2026-09-10). These tests exercise _run_frontend_checks directly with a
# fake _sh so no real npm command runs.


def test_run_frontend_checks_noop_when_frontend_and_shared_untouched(monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(integrate, "_sh", lambda *a, **k: calls.append((a, k)) or (0, ""))

    integrate._run_frontend_checks({"backend/app/services/x.py"})

    assert calls == []


def test_run_frontend_checks_runs_design_index_then_legal_content_when_frontend_changed(monkeypatch):
    calls: list[list[str]] = []

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        calls.append(cmd)
        return 0, ""

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    integrate._run_frontend_checks({"frontend/components/Foo.tsx"})

    assert calls == [
        ["npm", "run", "-s", "check:design-index"],
        ["npm", "run", "-s", "check:legal-content"],
    ]


def test_run_frontend_checks_runs_when_shared_changed(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(integrate, "_sh", lambda cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT: (calls.append(cmd), (0, ""))[1])

    integrate._run_frontend_checks({"shared/types.ts"})

    assert len(calls) == 2


def test_run_frontend_checks_raises_and_stops_on_design_index_failure(monkeypatch):
    calls: list[list[str]] = []

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        calls.append(cmd)
        return (1, "design index broken") if cmd[-1] == "check:design-index" else (0, "")

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    with pytest.raises(integrate.IntegrateError, match="check:design-index failed"):
        integrate._run_frontend_checks({"frontend/app/page.tsx"})

    # stopped after the failing check, never ran check:legal-content
    assert calls == [["npm", "run", "-s", "check:design-index"]]


def test_run_frontend_checks_raises_on_legal_content_failure(monkeypatch):
    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        return (1, "marker contract broken") if cmd[-1] == "check:legal-content" else (0, "")

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    with pytest.raises(integrate.IntegrateError, match="check:legal-content failed"):
        integrate._run_frontend_checks({"frontend/content/privacy.md"})


# --- health check retry (H24) --------------------------------------------
#
# A restart under concurrent build load can take a while to come back up
# (F14, 2026-09-10: a single poll 5s after restart hit a non-200 because
# another integrate pass was restarting services at the same moment, and a
# perfectly good merge got reverted and blocked). These tests exercise the
# retry helper directly, with real but tiny timeout/interval values so they
# stay fast without needing to fake the clock.


def test_wait_for_http_ok_succeeds_immediately_when_healthy(monkeypatch):
    monkeypatch.setattr(integrate, "_http_ok", lambda url: True)

    ok, elapsed = integrate._wait_for_http_ok("http://example.invalid/health", timeout=1, interval=0.01)

    assert ok is True
    assert elapsed >= 0


def test_wait_for_http_ok_retries_then_succeeds(monkeypatch):
    attempts = {"n": 0}

    def fake_http_ok(url):
        attempts["n"] += 1
        return attempts["n"] >= 3  # fails twice, succeeds on the third poll

    sleeps: list[float] = []
    monkeypatch.setattr(integrate, "_http_ok", fake_http_ok)
    monkeypatch.setattr(integrate.time, "sleep", lambda s: sleeps.append(s))

    ok, elapsed = integrate._wait_for_http_ok("http://example.invalid/health", timeout=1, interval=0.01)

    assert ok is True
    assert attempts["n"] == 3
    assert sleeps == [0.01, 0.01]  # slept between the two failed attempts, not after success


def test_wait_for_http_ok_gives_up_after_timeout(monkeypatch):
    monkeypatch.setattr(integrate, "_http_ok", lambda url: False)
    monkeypatch.setattr(integrate.time, "sleep", lambda s: None)

    ok, elapsed = integrate._wait_for_http_ok("http://example.invalid/health", timeout=0.05, interval=0.01)

    assert ok is False


def test_wait_and_check_health_raises_with_wait_duration_on_failure(monkeypatch):
    monkeypatch.setattr(integrate, "_wait_for_http_ok", lambda url: (False, 61.2))

    with pytest.raises(integrate.IntegrateError) as exc_info:
        integrate._wait_and_check_health()

    message = str(exc_info.value)
    assert integrate.HEALTH_URLS[0] in message
    assert "61.2" in message
    assert "retrying for" in message
    assert str(integrate.HEALTH_CHECK_TIMEOUT_S) in message


def test_wait_and_check_health_passes_when_all_urls_ok(monkeypatch):
    checked: list[str] = []

    def fake_wait(url):
        checked.append(url)
        return True, 0.0

    monkeypatch.setattr(integrate, "_wait_for_http_ok", fake_wait)

    integrate._wait_and_check_health()  # must not raise

    assert checked == integrate.HEALTH_URLS


# ---------------------------------------------------------------------
# _one_line_reason / _block (H27 — block reasons must never embed raw
# multi-line command output into the TODO.md state tag)
# ---------------------------------------------------------------------


def test_one_line_reason_takes_first_non_empty_line_and_strips_brackets():
    text = "\n  frontend build failed: [next] error TS2345\nsome second line\nthird line\n"
    assert integrate._one_line_reason(text) == "frontend build failed: next error TS2345"


def test_one_line_reason_collapses_internal_whitespace():
    text = "git   push\torigin\nmain   failed"
    assert integrate._one_line_reason(text) == "git push origin"


def test_one_line_reason_caps_length_with_ellipsis():
    text = "x" * 2000
    result = integrate._one_line_reason(text, cap=200)
    assert len(result) == 200
    assert result.endswith("...")
    assert result[:197] == "x" * 197


def test_one_line_reason_empty_text_returns_empty_string():
    assert integrate._one_line_reason("") == ""
    assert integrate._one_line_reason("   \n   \n") == ""


# Real `pytest -x` output captured against a synthetic suite of 8 files
# (5 passing tests each) where the 8th file's last test fails — the exact
# shape described in H46: per-file progress lines with a `[ N%]` marker,
# then a FAILURES section, a short test summary, and the final result
# line. This is what a real failing backend-suite run under integrate.py
# actually produces (reproduced on this VPS with pytest 9.1.1; captured
# verbatim, not hand-written).
REAL_PYTEST_FAILURE_OUTPUT = (
    "../../../../tmp/h46_demo/test_file1.py .....                             [ 12%]\n"
    "../../../../tmp/h46_demo/test_file2.py .....                             [ 24%]\n"
    "../../../../tmp/h46_demo/test_file3.py .....                             [ 36%]\n"
    "../../../../tmp/h46_demo/test_file4.py .....                             [ 48%]\n"
    "../../../../tmp/h46_demo/test_file5.py .....                             [ 60%]\n"
    "../../../../tmp/h46_demo/test_file6.py .....                             [ 73%]\n"
    "../../../../tmp/h46_demo/test_file7.py .....                             [ 85%]\n"
    "../../../../tmp/h46_demo/test_file8.py .....F\n"
    "\n"
    "=================================== FAILURES ===================================\n"
    "__________________________________ test_fail ___________________________________\n"
    "\n"
    "    def test_fail():\n"
    "        got = {\"status\": \"error\", \"code\": 17}\n"
    ">       assert got[\"status\"] == \"ok\", f\"unexpected status payload: {got}\"\n"
    "E       AssertionError: unexpected status payload: {'status': 'error', 'code': 17}\n"
    "E       assert 'error' == 'ok'\n"
    "\n"
    "/tmp/h46_demo/test_file8.py:8: AssertionError\n"
    "=========================== short test summary info ============================\n"
    "FAILED ../../../../tmp/h46_demo/test_file8.py::test_fail - AssertionError: un...\n"
    "!!!!!!!!!!!!!!!!!!!!!!!!!! stopping after 1 failures !!!!!!!!!!!!!!!!!!!!!!!!!!!\n"
    "1 failed, 40 passed in 0.20s\n"
)


def test_extract_diagnostic_tail_drops_progress_dots_keeps_failures_section():
    # H46: the old behaviour (raw_output[:1500]) would have kept exactly
    # the per-file progress lines and none of the FAILURES/assertion
    # detail for a large enough suite. Starting at the FAILURES marker
    # drops the noise and keeps everything that actually explains the
    # failure.
    result = integrate._extract_diagnostic_tail(REAL_PYTEST_FAILURE_OUTPUT)
    assert result.startswith("FAILURES")
    assert "[ 12%]" not in result
    assert "test_file1.py" not in result
    assert "AssertionError: unexpected status payload" in result
    assert "FAILED ../../../../tmp/h46_demo/test_file8.py::test_fail" in result
    assert "1 failed, 40 passed in 0.20s" in result.rstrip()


def test_extract_diagnostic_tail_falls_back_to_raw_tail_without_a_marker():
    # git/npm errors don't have a pytest section marker at all — fall back
    # to the last max_chars characters, on the theory that a build tool's
    # actual error is printed last, not first.
    body = "\n".join(f"npm warn deprecated pkg{i}@1.0.0" for i in range(100))
    output = body + "\nnpm ERR! could not resolve dependency graph"
    result = integrate._extract_diagnostic_tail(output, max_chars=80)
    assert result.endswith("npm ERR! could not resolve dependency graph")
    assert len(result) <= 80
    assert "pkg0@1.0.0" not in result


def test_extract_diagnostic_tail_short_text_is_returned_unchanged():
    assert integrate._extract_diagnostic_tail("git push origin main failed: connection refused") == (
        "git push origin main failed: connection refused"
    )


def test_extract_diagnostic_tail_empty_text_returns_empty_string():
    assert integrate._extract_diagnostic_tail("") == ""
    assert integrate._extract_diagnostic_tail("   \n   \n") == ""


def test_extract_diagnostic_tail_respects_max_chars_even_within_a_section():
    huge_failure = "=================================== FAILURES ===================================\n" + (
        "E       " + ("x" * 3000) + "\n"
    )
    result = integrate._extract_diagnostic_tail(huge_failure, max_chars=500)
    assert len(result) == 500
    # kept the *end* of the section (closest to the actual final assertion
    # line a human would look at first), not the marker itself.
    assert result.endswith("x" * 100)


def test_block_writes_single_sanitised_line_logs_full_text_and_adds_note(monkeypatch, capsys):
    set_state_calls: list[tuple] = []
    add_note_calls: list[tuple] = []

    def fake_set_state(item_id, state, reason=None, branch=None, actor="claude"):
        set_state_calls.append((item_id, state, reason, actor))
        return {"id": item_id}, True

    def fake_add_note(item_id, text, actor="claude"):
        add_note_calls.append((item_id, text, actor))
        return {"id": item_id}, True

    monkeypatch.setattr(integrate.backlog, "set_state", fake_set_state)
    monkeypatch.setattr(integrate.backlog, "add_note", fake_add_note)

    raw_output = "frontend build failed:\n" + "\n".join(f"error line {i}: [module]" for i in range(50))
    integrate._block("H99", raw_output)

    assert len(set_state_calls) == 1
    item_id, state, reason, actor = set_state_calls[0]
    assert item_id == "H99"
    assert state == "blocked"
    assert actor == "claude"
    # single line: no embedded newlines, no stray brackets that would
    # break the `[state: blocked: ...]` tag.
    assert "\n" not in reason
    assert "[" not in reason and "]" not in reason
    assert reason.startswith("frontend build failed:")
    assert len(reason) <= 200

    # the diagnostic tail is recorded as a board note — no pytest section
    # marker in this text and it's under the cap, so the tail is the full
    # text unchanged (see _extract_diagnostic_tail tests below for the
    # marker-based and truncating cases).
    assert len(add_note_calls) == 1
    note_item_id, note_text, note_actor = add_note_calls[0]
    assert note_item_id == "H99"
    assert note_actor == "claude"
    assert note_text == raw_output.strip()

    # the full text was also logged (at error level, to stderr) before
    # being truncated for the board.
    captured = capsys.readouterr()
    assert "error line 49" in captured.err


def test_block_skips_note_when_reason_is_empty(monkeypatch):
    add_note_calls: list[tuple] = []

    monkeypatch.setattr(integrate.backlog, "set_state", lambda *a, **k: ({}, True))
    monkeypatch.setattr(integrate.backlog, "add_note", lambda *a, **k: add_note_calls.append((a, k)))

    integrate._block("H99", "")

    assert add_note_calls == []


def test_block_swallows_backlog_error_from_set_state(monkeypatch, capsys):
    def raising_set_state(*a, **k):
        raise integrate.backlog.BacklogError("H99 is not a known backlog item.")

    add_note_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_state", raising_set_state)
    monkeypatch.setattr(integrate.backlog, "add_note", lambda *a, **k: add_note_calls.append((a, k)))

    integrate._block("H99", "some reason")  # must not raise

    # never falls through to add_note once the state write itself failed.
    assert add_note_calls == []
    captured = capsys.readouterr()
    assert "could not write block reason for H99" in captured.err


def test_block_real_pytest_failure_round_trips_through_the_real_board(tmp_path, monkeypatch):
    """End-to-end: `_block` fed the real captured pytest -x failure output
    (REAL_PYTEST_FAILURE_OUTPUT), through the *real* backlog.py TodoDoc
    (not mocked) writing to a throwaway board file — proving the whole
    pipeline (integrate.py's tail extraction + backlog.py's cap/newline
    sanitisation) leaves the board readable and parseable, which is what
    H46 actually promises. Git is mocked (no real commit/push), but the
    file-level TodoDoc read/write/reparse logic is untouched."""
    from app.services import backlog as real_backlog
    from unittest.mock import MagicMock

    todo_path = tmp_path / "TODO.md"
    todo_path.write_text(
        "# Backlog fixture\n\n## H. Section H heading\n\n"
        "- [ ] **H99. Some item.** [owner: claude] [state: in-progress] Some text.\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(real_backlog.subprocess, "run", MagicMock(return_value=MagicMock(returncode=0)))
    # integrate.backlog IS real_backlog already (it's imported once and
    # cached in sys.modules); capture the real functions *before*
    # patching them onto the module below, otherwise the wrappers would
    # call themselves.
    original_set_state = real_backlog.set_state
    original_add_note = real_backlog.add_note

    def fake_set_state(item_id, state, reason=None, branch=None, actor="claude"):
        return original_set_state(
            item_id, state, reason=reason, branch=branch, actor=actor,
            todo_path=todo_path, repo_root=tmp_path,
        )

    def fake_add_note(item_id, text, actor="claude"):
        return original_add_note(item_id, text, actor=actor, todo_path=todo_path, repo_root=tmp_path)

    monkeypatch.setattr(integrate.backlog, "set_state", fake_set_state)
    monkeypatch.setattr(integrate.backlog, "add_note", fake_add_note)

    integrate._block("H99", "backend test suite failed:\n" + REAL_PYTEST_FAILURE_OUTPUT)

    # The board must still parse cleanly, on one line per item/note.
    raw = todo_path.read_text(encoding="utf-8")
    doc = real_backlog.TodoDoc.parse(raw)
    item = doc.items["H99"]
    assert item.state == "blocked"
    # the [state: blocked: ...] tag itself is a single sanitised line.
    assert "\n" not in item.reason
    assert "[" not in item.reason and "]" not in item.reason
    assert len(item.reason) <= 200

    assert len(item.notes) == 1
    note = item.notes[0]
    # the note is readable: it carries the actual failure, not dot-flood.
    assert "AssertionError: unexpected status payload" in note.text
    assert "FAILED ../../../../tmp/h46_demo/test_file8.py::test_fail" in note.text
    assert "[ 12%]" not in note.text
    assert len(note.text) <= real_backlog.NOTE_CAP

    # the item line and the note line are each exactly one physical line
    # in the file — this is the actual corruption H46 is about: a raw
    # multi-line reason/note breaking the one-line-per-item/note format
    # that the whole board parser depends on.
    lines = raw.splitlines()
    item_lines = [ln for ln in lines if ln.startswith("- [ ] **H99.") or ln.startswith("- [x] **H99.")]
    assert len(item_lines) == 1
    note_lines = [ln for ln in lines if ln.startswith("  - note (")]
    assert len(note_lines) == 1

    print(f"item line: {item_lines[0]!r}")
    print(f"note line: {note_lines[0]!r}")


# ---------------------------------------------------------------------
# H31 — a design round lands in `uat` instead of `done`: the backstop diff
# heuristic, the review-candidate exclusion (uat is never picked up
# again, same protection `rejected` already has), and _integrate_one's own
# branch decision between set_uat and set_done.
# ---------------------------------------------------------------------


def _fake_sh_with_backstop_git_state(*, ls_tree_output: str = "", diff_name_status: str = ""):
    """Answers the two extra git calls the tightened backstop (H41) makes
    on top of the plain diff: `git ls-tree -r --name-only <sha> -- <path>`
    (`_slug_is_new`, telling a brand new preview directory from an edit to
    an existing one) and `git diff --name-status <range>`
    (`_has_multi_variant_edit`, telling an added/modified VariantX.tsx
    from a deleted one). Every ls-tree/diff --name-status call in a given
    test gets the same canned output, which is fine since these tests each
    only ever deal with one slug."""

    def fake_sh(cmd, cwd=None, timeout=None):
        if cmd[:2] == ["git", "ls-tree"]:
            return 0, ls_tree_output
        if cmd[:3] == ["git", "diff", "--name-status"]:
            return 0, diff_name_status
        return 0, ""

    return fake_sh


def test_is_design_round_diff_true_when_every_path_under_frontend_design(monkeypatch):
    # ls-tree returns nothing for "plan-picker" -> the slug did not exist
    # at the pre-merge sha, signal (a): a brand new preview directory.
    monkeypatch.setattr(integrate, "_sh", _fake_sh_with_backstop_git_state(ls_tree_output=""))
    changed = {
        "frontend/app/design/plan-picker/page.tsx",
        "frontend/app/design/plan-picker/VariantA.tsx",
        "frontend/app/design/page.tsx",  # the index itself, still under the tree
    }
    assert integrate._is_design_round_diff(changed, "deadbeef") is True


def test_is_design_round_diff_false_when_a_production_component_is_also_touched():
    changed = {
        "frontend/app/design/plan-picker/page.tsx",
        "frontend/app/components/HomePage.tsx",  # one file outside the tree is enough
    }
    # No _sh monkeypatch needed: the confined-to-prefix check fails and
    # short-circuits before either backstop signal is ever evaluated.
    assert integrate._is_design_round_diff(changed, "deadbeef") is False


def test_is_design_round_diff_false_for_backend_only_change():
    assert integrate._is_design_round_diff({"backend/app/services/x.py"}, "deadbeef") is False


def test_is_design_round_diff_false_for_empty_diff():
    assert integrate._is_design_round_diff(set(), "deadbeef") is False


# --- H41: the backstop used to fire on any diff confined to
# frontend/app/design/, full stop, which is right for a variants round but
# also misfiled on preview TOOLING that lives under the same tree: H40
# edited an existing preview's internal states to make every branch
# reachable from a URL, and H43 (three times) converted a hand-authored
# preview to render its shipped production component and deleted previews
# that no longer gated anything. None of those has anything for Kevin to
# choose between. The tightened rule requires either a brand new preview
# directory (signal a) or two or more live VariantX.tsx files touched
# together (signal b) — see the module comment above _DESIGN_ROUND_PREFIX
# in scripts/integrate.py. -----------------------------------------------


def test_is_design_round_diff_false_for_edit_to_existing_single_file_preview(monkeypatch):
    """H40 shape: an edit to CoverPlanSourcesScaleClient.tsx, the one file
    an already-existing preview is built from, to make every named state
    reachable — a reachability fix, not a round with a new choice. This
    would pass under the old loose rule (every path confined to
    frontend/app/design/, nothing else asked), so it is a genuine
    regression check for H41, not a restatement of the old behaviour."""
    monkeypatch.setattr(
        integrate,
        "_sh",
        _fake_sh_with_backstop_git_state(
            ls_tree_output=(
                "frontend/app/design/cover-plan-sources-scale/CoverPlanSourcesScaleClient.tsx\n"
                "frontend/app/design/cover-plan-sources-scale/page.tsx\n"
            ),
            diff_name_status="M\tfrontend/app/design/cover-plan-sources-scale/CoverPlanSourcesScaleClient.tsx\n",
        ),
    )
    changed = {"frontend/app/design/cover-plan-sources-scale/CoverPlanSourcesScaleClient.tsx"}

    result = integrate._is_design_round_diff(changed, "deadbeef")

    print("H40-shape edit to an existing single-file preview -> is_design_round_diff:", result)
    assert result is False


def test_is_design_round_diff_false_for_deletion_of_existing_preview_variants(monkeypatch):
    """H43 shape: a whole VariantA/B/C.tsx set deleted because the preview
    no longer gated anything. The directory already existed and every
    touched file is gone, never added or modified, so neither backstop
    signal may fire however many variant-named files the deletion
    spans."""
    monkeypatch.setattr(
        integrate,
        "_sh",
        _fake_sh_with_backstop_git_state(
            ls_tree_output=(
                "frontend/app/design/account-rows/VariantA.tsx\n"
                "frontend/app/design/account-rows/VariantB.tsx\n"
                "frontend/app/design/account-rows/VariantC.tsx\n"
                "frontend/app/design/account-rows/page.tsx\n"
            ),
            diff_name_status=(
                "D\tfrontend/app/design/account-rows/VariantA.tsx\n"
                "D\tfrontend/app/design/account-rows/VariantB.tsx\n"
                "D\tfrontend/app/design/account-rows/VariantC.tsx\n"
                "D\tfrontend/app/design/account-rows/page.tsx\n"
            ),
        ),
    )
    changed = {
        "frontend/app/design/account-rows/VariantA.tsx",
        "frontend/app/design/account-rows/VariantB.tsx",
        "frontend/app/design/account-rows/VariantC.tsx",
        "frontend/app/design/account-rows/page.tsx",
    }

    result = integrate._is_design_round_diff(changed, "deadbeef")

    print("H43-shape deletion of a whole variant set -> is_design_round_diff:", result)
    assert result is False


def test_is_design_round_diff_true_for_mixed_diff_editing_existing_variant_files(monkeypatch):
    """G53 shape: not every genuine round adds a new directory. G53
    restacked a shared primitive and re-touched VariantA/B/C.tsx together
    inside the already-existing spend-period-round/ directory, with no new
    file anywhere, and correctly needed to land in uat so Kevin could see
    the restack applied to all three choices he was comparing. Two or more
    live (added-or-modified, not deleted) VariantX.tsx files touched
    together in one slug is still a real choice being revisited — this is
    a mixed diff (some files match the variant pattern, some don't; some
    slugs old, no slug new) and must still come out True."""
    monkeypatch.setattr(
        integrate,
        "_sh",
        _fake_sh_with_backstop_git_state(
            ls_tree_output=(
                "frontend/app/design/spend-period-round/VariantA.tsx\n"
                "frontend/app/design/spend-period-round/VariantB.tsx\n"
                "frontend/app/design/spend-period-round/VariantC.tsx\n"
                "frontend/app/design/spend-period-round/primitives.tsx\n"
                "frontend/app/design/spend-period-round/SpendPeriodRoundClient.tsx\n"
                "frontend/app/design/spend-period-round/page.tsx\n"
            ),
            diff_name_status=(
                "M\tfrontend/app/design/spend-period-round/VariantA.tsx\n"
                "M\tfrontend/app/design/spend-period-round/VariantB.tsx\n"
                "M\tfrontend/app/design/spend-period-round/VariantC.tsx\n"
                "M\tfrontend/app/design/spend-period-round/primitives.tsx\n"
                "M\tfrontend/app/design/spend-period-round/SpendPeriodRoundClient.tsx\n"
            ),
        ),
    )
    changed = {
        "frontend/app/design/spend-period-round/VariantA.tsx",
        "frontend/app/design/spend-period-round/VariantB.tsx",
        "frontend/app/design/spend-period-round/VariantC.tsx",
        "frontend/app/design/spend-period-round/primitives.tsx",
        "frontend/app/design/spend-period-round/SpendPeriodRoundClient.tsx",
    }

    result = integrate._is_design_round_diff(changed, "deadbeef")

    print("G53-shape refinement touching existing VariantA/B/C together -> is_design_round_diff:", result)
    assert result is True


def test_design_round_preview_falls_back_to_index_when_no_slug_can_be_derived():
    link, detail = integrate._design_round_preview(set())
    assert link == "https://uat.wealth.auriqltd.co.uk/design"
    assert link.startswith("https://" + integrate.backlog.PUBLIC_UAT_HOST)
    assert detail is None


def test_notify_uat_ready_delegates_to_notifications_service_no_real_transport(monkeypatch):
    """Proves the notification path without ever touching a real
    APNs/FCM/webpush transport: app.services.notifications.notify_uat_ready
    itself is replaced with a fake coroutine, so nothing downstream of it
    (send_push_to_user, the actual HTTP calls) ever runs. No real push is
    sent by this test."""
    import app.services.notifications as notifications_module

    calls: list[tuple] = []

    async def fake_notify_uat_ready(item_id, title, link):
        calls.append((item_id, title, link))
        return {"apns": {}, "fcm": {}, "webpush": {}}

    monkeypatch.setattr(notifications_module, "notify_uat_ready", fake_notify_uat_ready)

    integrate._notify_uat_ready("H31", "UAT review swimlane", "https://uat.wealth.auriqltd.co.uk/design")

    assert calls == [("H31", "UAT review swimlane", "https://uat.wealth.auriqltd.co.uk/design")]


def test_notify_uat_ready_folds_detail_into_the_body_title_text(monkeypatch):
    """H34: a multi-slug round's extra preview links (`detail`) must reach
    the push body too, not just the board note — folded into the title
    text passed to notify_uat_ready rather than a new parameter on it, so
    that shared service function (other callers may exist) stays
    untouched."""
    import app.services.notifications as notifications_module

    calls: list[tuple] = []

    async def fake_notify_uat_ready(item_id, title, link):
        calls.append((item_id, title, link))
        return {"apns": {}, "fcm": {}, "webpush": {}}

    monkeypatch.setattr(notifications_module, "notify_uat_ready", fake_notify_uat_ready)

    integrate._notify_uat_ready(
        "G51",
        "Two preview rounds",
        "https://uat.wealth.auriqltd.co.uk/design/another-round",
        detail="Also: https://uat.wealth.auriqltd.co.uk/design/plan-picker",
    )

    assert len(calls) == 1
    item_id, title, link = calls[0]
    assert item_id == "G51"
    assert "Two preview rounds" in title
    assert "Also: https://uat.wealth.auriqltd.co.uk/design/plan-picker" in title
    assert link == "https://uat.wealth.auriqltd.co.uk/design/another-round"


# ---------------------------------------------------------------------
# H34 — the uat state records the real preview the merged diff added
# instead of always pointing at the bare design index: _design_round_slugs
# derives the touched preview directories from the diff,
# _design_round_example_query best-effort-reads a worked ?state= query for
# a single one out of frontend/app/design/page.tsx's ROUTES table, and
# _design_round_preview ties both together with curl verification against
# the just-rebuilt local UAT, falling back to the plain index on anything
# that doesn't check out.
# ---------------------------------------------------------------------


def test_design_round_slugs_single_directory():
    changed = {
        "frontend/app/design/plan-picker/page.tsx",
        "frontend/app/design/plan-picker/VariantA.tsx",
    }
    assert integrate._design_round_slugs(changed) == ["plan-picker"]


def test_design_round_slugs_multiple_directories_sorted_by_path():
    changed = {
        "frontend/app/design/plan-picker/page.tsx",
        "frontend/app/design/another-round/page.tsx",
    }
    assert integrate._design_round_slugs(changed) == ["another-round", "plan-picker"]


def test_design_round_slugs_none_for_bare_index_files_and_empty_diff():
    # page.tsx directly under frontend/app/design/ is the index itself,
    # not a preview directory — it has no path segment after the prefix.
    assert integrate._design_round_slugs({"frontend/app/design/page.tsx"}) == []
    assert integrate._design_round_slugs(set()) == []


def test_design_round_example_query_reads_first_state_value_for_slug(tmp_path, monkeypatch):
    design_dir = tmp_path / "frontend" / "app" / "design"
    design_dir.mkdir(parents=True)
    (design_dir / "page.tsx").write_text(
        "const ROUTES: PreviewRoute[] = [\n"
        "  {\n"
        '    slug: "plan-picker",\n'
        '    name: "plan-picker",\n'
        '    description: "test fixture",\n'
        "    states: [\n"
        '      { label: "Few accounts", value: "few" },\n'
        '      { label: "Many accounts", value: "many" },\n'
        "    ],\n"
        "  },\n"
        "];\n"
    )
    monkeypatch.setattr(integrate, "REPO_ROOT", tmp_path)

    assert integrate._design_round_example_query("plan-picker") == "mode=dark&state=few"


def test_design_round_example_query_none_for_unknown_slug_or_missing_file(tmp_path, monkeypatch):
    design_dir = tmp_path / "frontend" / "app" / "design"
    design_dir.mkdir(parents=True)
    (design_dir / "page.tsx").write_text("const ROUTES: PreviewRoute[] = [];\n")
    monkeypatch.setattr(integrate, "REPO_ROOT", tmp_path)

    assert integrate._design_round_example_query("plan-picker") is None  # not in an empty table

    monkeypatch.setattr(integrate, "REPO_ROOT", tmp_path / "does-not-exist")
    assert integrate._design_round_example_query("plan-picker") is None  # file missing entirely


def test_design_round_preview_single_directory_records_verified_slug_link(monkeypatch):
    """A single design directory in the diff, with no worked example query
    derivable (kept out of scope of this test) -> the bare slug link, once
    it curl-verifies against local UAT."""
    monkeypatch.setattr(integrate, "_design_round_example_query", lambda slug: None)
    monkeypatch.setattr(integrate, "_http_ok", lambda url: url == "http://127.0.0.1:3030/design/plan-picker")

    link, detail = integrate._design_round_preview({"frontend/app/design/plan-picker/page.tsx"})

    assert link == "https://uat.wealth.auriqltd.co.uk/design/plan-picker"
    assert detail is None


def test_design_round_preview_single_directory_prefers_worked_example_query(monkeypatch):
    monkeypatch.setattr(integrate, "_design_round_example_query", lambda slug: "mode=dark&state=few")
    monkeypatch.setattr(
        integrate,
        "_http_ok",
        lambda url: url == "http://127.0.0.1:3030/design/plan-picker?mode=dark&state=few",
    )

    link, detail = integrate._design_round_preview({"frontend/app/design/plan-picker/page.tsx"})

    assert link == "https://uat.wealth.auriqltd.co.uk/design/plan-picker?mode=dark&state=few"
    assert detail is None


def test_design_round_preview_single_directory_falls_back_to_index_when_link_does_not_resolve(monkeypatch):
    """The derived slug link is wrong/dead (404, still building, etc.) —
    a bare, correct index link beats a broken, specific-looking one."""
    monkeypatch.setattr(integrate, "_design_round_example_query", lambda slug: None)
    monkeypatch.setattr(integrate, "_http_ok", lambda url: False)

    link, detail = integrate._design_round_preview({"frontend/app/design/plan-picker/page.tsx"})

    assert link == "https://uat.wealth.auriqltd.co.uk/design"
    assert detail is None


def test_design_round_preview_several_directories_records_first_plus_detail(monkeypatch):
    """More than one preview directory in the round: the board's `link`
    field only ever holds one URL, so the first (path-sorted) verified
    slug link is recorded there, and every other verified one is returned
    as `detail` for the caller to keep as a note and fold into the push
    body — see H34."""
    monkeypatch.setattr(integrate, "_http_ok", lambda url: True)

    changed = {
        "frontend/app/design/another-round/page.tsx",
        "frontend/app/design/plan-picker/page.tsx",
    }
    link, detail = integrate._design_round_preview(changed)

    assert link == "https://uat.wealth.auriqltd.co.uk/design/another-round"
    assert detail == "Also: https://uat.wealth.auriqltd.co.uk/design/plan-picker"


def test_design_round_preview_several_directories_falls_back_to_index_when_none_resolve(monkeypatch):
    monkeypatch.setattr(integrate, "_http_ok", lambda url: False)

    changed = {
        "frontend/app/design/another-round/page.tsx",
        "frontend/app/design/plan-picker/page.tsx",
    }
    link, detail = integrate._design_round_preview(changed)

    assert link == "https://uat.wealth.auriqltd.co.uk/design"
    assert detail is None


def test_design_round_preview_none_when_diff_has_no_preview_directory():
    link, detail = integrate._design_round_preview({"frontend/app/design/page.tsx"})
    assert link == "https://uat.wealth.auriqltd.co.uk/design"
    assert detail is None


def test_review_items_excludes_uat_and_rejected_only_review_is_a_candidate(monkeypatch):
    """Exercises integrate.py's own candidate-selection function
    (_review_items) directly against a synthetic board snapshot containing
    one `review` item, one `uat` item and one `rejected` item — only the
    `review` item must come back. This is the real safety property H31
    depends on: an item that already landed in `uat` must never be picked
    up as a merge candidate again."""

    class _FakeTodo:
        def items(self):
            return {
                "H1": {"id": "H1", "state": "review", "branch": "feature-H1-thing", "title": "Review candidate"},
                "H2": {"id": "H2", "state": "uat", "branch": "feature-H2-thing", "link": "https://uat.wealth.auriqltd.co.uk/design", "title": "Landed in uat"},
                "H3": {"id": "H3", "state": "rejected", "branch": "feature-H3-thing", "reason": "nope", "title": "Rejected"},
            }

    class _FakeSnapshot:
        def items(self):
            return list(_FakeTodo().items().values())

    monkeypatch.setattr(integrate.backlog, "load", lambda: _FakeSnapshot())

    candidates = integrate._review_items()

    print("synthetic board: H1=review, H2=uat, H3=rejected")
    print("candidates returned by _review_items():", candidates)

    assert [c["id"] for c in candidates] == ["H1"]
    assert all(c["state"] == "review" for c in candidates)


def test_review_items_excludes_cancelled_even_with_a_branch(monkeypatch):
    """H80: a cancelled item, even one that retains a branch from a live
    worktree it was cancelled out of (see backend/app/services/backlog.py
    set_cancelled), must never be picked up as a merge candidate —
    `_review_items()` only ever selects items in state `review`, exactly
    the same safety property the existing uat/rejected test above proves,
    exercised separately here because "even with a branch recorded" is the
    exact shape Part 4 of H80 calls out (a cancelled in-progress/review
    item keeps its branch purely so it stays visible, not so integrate can
    find it)."""

    class _FakeSnapshot:
        def items(self):
            return [
                {"id": "H1", "state": "review", "branch": "feature-H1-thing", "title": "Review candidate"},
                {
                    "id": "H4",
                    "state": "cancelled",
                    "branch": "feature-H4-thing",
                    "reason": "superseded",
                    "title": "Cancelled, but keeps its branch visible",
                },
            ]

    monkeypatch.setattr(integrate.backlog, "load", lambda: _FakeSnapshot())

    candidates = integrate._review_items()

    print("synthetic board: H1=review (branch attached), H4=cancelled (also has a branch attached)")
    print("candidates returned by _review_items():", candidates)

    assert [c["id"] for c in candidates] == ["H1"]
    assert all(c["state"] == "review" for c in candidates)


def test_cancelled_items_returns_only_cancelled_state_sorted_by_id(monkeypatch):
    """H80 correction round (LOW): mirrors the existing rejected-items
    shape -- `_cancelled_items()` exists purely for visibility
    ([skipped-cancelled] lines + the summary count), so a skip caused by a
    cancellation never reads as a silent absence, the same fix H25 made
    for rejected."""

    class _FakeSnapshot:
        def items(self):
            return [
                {"id": "H9", "state": "cancelled", "reason": "superseded", "branch": "feature-H9-thing"},
                {"id": "H2", "state": "cancelled", "reason": "not wanted"},
                {"id": "H1", "state": "review", "branch": "feature-H1-thing"},
                {"id": "H3", "state": "rejected", "reason": "wrong approach"},
            ]

    monkeypatch.setattr(integrate.backlog, "load", lambda: _FakeSnapshot())

    cancelled = integrate._cancelled_items()

    assert [c["id"] for c in cancelled] == ["H2", "H9"]
    assert all(c["state"] == "cancelled" for c in cancelled)


def _fake_sh_factory(extra=None):
    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        if extra is not None:
            handled = extra(cmd)
            if handled is not None:
                return handled
        if cmd[:2] == ["git", "rev-parse"]:
            return 0, "deadbeef1234567890deadbeef1234567890dead"
        return 0, ""

    return fake_sh


def _patch_integrate_one_plumbing(monkeypatch, changed_paths):
    """Stubs out every side-effecting step _integrate_one takes around the
    merge itself (dependency install, tests, frontend gate, restarts,
    health check, worktree/branch cleanup) so only the uat-vs-done landing
    decision under test actually does anything observable."""
    monkeypatch.setattr(integrate, "_sh", _fake_sh_factory())
    monkeypatch.setattr(integrate, "_changed_paths", lambda sha_range: changed_paths)
    monkeypatch.setattr(integrate, "_install_dependencies", lambda changed: None)
    monkeypatch.setattr(integrate, "_run_backend_tests", lambda: None)
    monkeypatch.setattr(integrate, "_run_frontend_checks", lambda changed: None)
    monkeypatch.setattr(integrate, "_restart_services", lambda changed: None)
    monkeypatch.setattr(integrate, "_wait_and_check_health", lambda: None)
    monkeypatch.setattr(integrate, "_find_worktree_for_branch", lambda branch: None)


def test_integrate_one_lands_in_uat_when_uat_review_flag_is_set(monkeypatch):
    """H41 review finding: this test used to pass for the wrong reason.
    The generic fake shell returns empty output for the (previously
    unconditional) `git ls-tree` call, which `_slug_is_new` reads as "this
    slug is new", so the heuristic coincidentally agreed with the flag
    even though it was still being evaluated (and its result discarded)
    on every flagged merge. Record every call to `_is_design_round_diff`
    instead of faking its git calls, and assert the list stays empty: a
    raise-based stub would not have caught the regression either, since
    `_integrate_one` already wraps that call in a broad except and the
    flag being True made the final result look right regardless of
    whether the heuristic actually ran or blew up. Only "was it called at
    all" tells old and new code apart here."""
    _patch_integrate_one_plumbing(monkeypatch, {"frontend/app/design/plan-picker/page.tsx"})

    heuristic_calls: list[tuple] = []

    def record_call(changed, pre_sha):
        heuristic_calls.append((changed, pre_sha))
        return True

    monkeypatch.setattr(integrate, "_is_design_round_diff", record_call)

    uat_calls: list[tuple] = []
    done_calls: list[tuple] = []
    notify_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_uat", lambda item_id, link, actor="claude": (uat_calls.append((item_id, link, actor)), ({}, True))[1])
    monkeypatch.setattr(integrate.backlog, "set_done", lambda *a, **k: (done_calls.append((a, k)), ({}, True))[1])
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link, detail=None: notify_calls.append((item_id, title, link)))

    item = {"id": "H31", "branch": "feature-H31-thing", "title": "UAT review swimlane", "uat_review": True}
    result, detail = integrate._integrate_one(item)

    print("uat_review flag set, heuristic calls recorded ->", result, detail, "heuristic_calls:", heuristic_calls)

    assert heuristic_calls == []  # the flag must skip the heuristic entirely, not just outrank its result
    assert result == "merged"
    assert "landed in uat" in detail
    assert len(uat_calls) == 1
    assert uat_calls[0][0] == "H31"
    assert uat_calls[0][1] == "https://uat.wealth.auriqltd.co.uk/design"
    assert done_calls == []  # never marked plain done
    assert len(notify_calls) == 1
    assert notify_calls[0] == ("H31", "UAT review swimlane", "https://uat.wealth.auriqltd.co.uk/design")


def test_integrate_one_lands_in_uat_via_backstop_heuristic_when_flag_missing(monkeypatch):
    """The flag was forgotten (uat_review absent/False), but the merge's
    own diff touches nothing outside frontend/app/design/ — the backstop
    heuristic must still catch it."""
    _patch_integrate_one_plumbing(
        monkeypatch, {"frontend/app/design/plan-picker/page.tsx", "frontend/app/design/page.tsx"}
    )

    uat_calls: list[tuple] = []
    done_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_uat", lambda item_id, link, actor="claude": (uat_calls.append((item_id, link, actor)), ({}, True))[1])
    monkeypatch.setattr(integrate.backlog, "set_done", lambda *a, **k: (done_calls.append((a, k)), ({}, True))[1])
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link, detail=None: None)

    item = {"id": "B19", "branch": "feature-B19-thing", "title": "Plan-picker variants", "uat_review": False}
    result, detail = integrate._integrate_one(item)

    print("uat_review flag missing, diff is design-round-only (backstop) -> result:", result, detail)

    assert result == "merged"
    assert "landed in uat" in detail
    assert len(uat_calls) == 1
    assert done_calls == []


def test_integrate_one_lands_in_done_for_a_normal_merge_not_a_design_round(monkeypatch):
    """Neither the flag nor the backstop applies (the diff touches a real
    component, not just frontend/app/design/) -> the ordinary done path,
    unchanged from before H31."""
    _patch_integrate_one_plumbing(monkeypatch, {"backend/app/routers/analytics.py"})

    uat_calls: list[tuple] = []
    done_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_uat", lambda item_id, link, actor="claude": (uat_calls.append((item_id, link, actor)), ({}, True))[1])
    monkeypatch.setattr(integrate.backlog, "set_done", lambda *a, **k: (done_calls.append((a, k)), ({}, True))[1])
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link, detail=None: None)

    item = {"id": "G1", "branch": "feature-G1-thing", "title": "Fix a real bug", "uat_review": False}
    result, detail = integrate._integrate_one(item)

    print("normal merge, diff touches a backend file -> result:", result, detail)

    assert result == "merged"
    assert detail.endswith("(done)")
    assert uat_calls == []
    assert len(done_calls) == 1


def test_integrate_one_design_round_diff_with_a_production_file_also_touched_is_not_uat(monkeypatch):
    """A diff that touches frontend/app/design/ AND a production component
    is not a design round by the backstop heuristic (and the flag is
    missing here too) -> ordinary done path."""
    _patch_integrate_one_plumbing(
        monkeypatch, {"frontend/app/design/plan-picker/page.tsx", "frontend/components/HomePage.tsx"}
    )

    uat_calls: list[tuple] = []
    done_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_uat", lambda item_id, link, actor="claude": (uat_calls.append((item_id, link, actor)), ({}, True))[1])
    monkeypatch.setattr(integrate.backlog, "set_done", lambda *a, **k: (done_calls.append((a, k)), ({}, True))[1])
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link, detail=None: None)

    item = {"id": "G2", "branch": "feature-G2-thing", "title": "Also touches production", "uat_review": False}
    result, detail = integrate._integrate_one(item)

    print("design-round diff PLUS a production file -> result:", result, detail)

    assert result == "merged"
    assert uat_calls == []
    assert len(done_calls) == 1


# --- H41 end-to-end: the tightened backstop wired through the full
# _integrate_one landing decision, not just the standalone
# _is_design_round_diff unit above. Covers the four shapes the item asks
# for directly: a newly added preview directory, an edit to an existing
# one, a deletion, and a mixed diff — with the flag left unset (False) in
# every case so only the heuristic itself is under test. ------------------


def _fake_sh_with_backstop_state(*, ls_tree_output: str = "", diff_name_status: str = ""):
    """`_patch_integrate_one_plumbing` already installs `_fake_sh_factory()`
    for `_sh`; this layers the two extra git calls the tightened backstop
    makes (see `_fake_sh_with_backstop_git_state` above the standalone
    `_is_design_round_diff` tests) on top of that same base, so
    `_integrate_one`'s other `_sh` calls (rev-parse, merge, push, curl for
    the preview-link derivation) keep working exactly as they do in every
    other `_integrate_one` test."""
    base = _fake_sh_factory()

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        if cmd[:2] == ["git", "ls-tree"]:
            return 0, ls_tree_output
        if cmd[:3] == ["git", "diff", "--name-status"]:
            return 0, diff_name_status
        return base(cmd, cwd=cwd, timeout=timeout)

    return fake_sh


def test_integrate_one_backstop_lands_uat_for_newly_added_preview_directory(monkeypatch):
    """G48/G51/G57 shape: every file for a never-before-seen slug lands in
    one merge. ls-tree at the pre-merge sha comes back empty for that
    slug -> genuinely new -> uat, flag still unset."""
    changed = {
        "frontend/app/design/new-round/page.tsx",
        "frontend/app/design/new-round/NewRoundClient.tsx",
    }
    _patch_integrate_one_plumbing(monkeypatch, changed)
    monkeypatch.setattr(integrate, "_sh", _fake_sh_with_backstop_state(ls_tree_output=""))

    uat_calls: list[tuple] = []
    done_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_uat", lambda item_id, link, actor="claude": (uat_calls.append((item_id, link)), ({}, True))[1])
    monkeypatch.setattr(integrate.backlog, "set_done", lambda *a, **k: (done_calls.append((a, k)), ({}, True))[1])
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link, detail=None: None)

    item = {"id": "G90", "branch": "feature-G90-thing", "title": "New round", "uat_review": False}
    result, detail = integrate._integrate_one(item)

    print("newly added preview directory, flag unset -> result:", result, detail)

    assert result == "merged"
    assert "landed in uat" in detail
    assert len(uat_calls) == 1
    assert done_calls == []


def test_integrate_one_backstop_lands_done_for_edit_to_existing_preview_states(monkeypatch):
    """H40 shape and the item's core regression case: editing
    CoverPlanSourcesScaleClient.tsx, the single file an already-existing
    preview is built from, to make every named state reachable from a URL.
    Nothing new for Kevin to choose between, so this must land done, not
    uat. This is the exact case the old loose rule (every path confined to
    frontend/app/design/, nothing else asked) got wrong four times; this
    test fails under that rule and passes under the tightened one."""
    changed = {"frontend/app/design/cover-plan-sources-scale/CoverPlanSourcesScaleClient.tsx"}
    _patch_integrate_one_plumbing(monkeypatch, changed)
    monkeypatch.setattr(
        integrate,
        "_sh",
        _fake_sh_with_backstop_state(
            ls_tree_output=(
                "frontend/app/design/cover-plan-sources-scale/CoverPlanSourcesScaleClient.tsx\n"
                "frontend/app/design/cover-plan-sources-scale/page.tsx\n"
            ),
            diff_name_status="M\tfrontend/app/design/cover-plan-sources-scale/CoverPlanSourcesScaleClient.tsx\n",
        ),
    )

    uat_calls: list[tuple] = []
    done_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_uat", lambda item_id, link, actor="claude": (uat_calls.append((item_id, link)), ({}, True))[1])
    monkeypatch.setattr(integrate.backlog, "set_done", lambda *a, **k: (done_calls.append((a, k)), ({}, True))[1])
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link, detail=None: None)

    item = {"id": "H40", "branch": "feature-H40-thing", "title": "Reachable preview states", "uat_review": False}
    result, detail = integrate._integrate_one(item)

    print("edit to an existing single-file preview, flag unset -> result:", result, detail)

    assert result == "merged"
    assert detail.endswith("(done)")
    assert uat_calls == []
    assert len(done_calls) == 1


def test_integrate_one_backstop_lands_done_for_deletion_of_existing_preview_variants(monkeypatch):
    """H43 shape: a whole VariantA/B/C.tsx set deleted because the preview
    no longer gated anything. Removing choices is not creating one, and
    the directory already existed, so this must land done."""
    changed = {
        "frontend/app/design/account-rows/VariantA.tsx",
        "frontend/app/design/account-rows/VariantB.tsx",
        "frontend/app/design/account-rows/VariantC.tsx",
        "frontend/app/design/account-rows/page.tsx",
    }
    _patch_integrate_one_plumbing(monkeypatch, changed)
    monkeypatch.setattr(
        integrate,
        "_sh",
        _fake_sh_with_backstop_state(
            ls_tree_output=(
                "frontend/app/design/account-rows/VariantA.tsx\n"
                "frontend/app/design/account-rows/VariantB.tsx\n"
                "frontend/app/design/account-rows/VariantC.tsx\n"
                "frontend/app/design/account-rows/page.tsx\n"
            ),
            diff_name_status=(
                "D\tfrontend/app/design/account-rows/VariantA.tsx\n"
                "D\tfrontend/app/design/account-rows/VariantB.tsx\n"
                "D\tfrontend/app/design/account-rows/VariantC.tsx\n"
                "D\tfrontend/app/design/account-rows/page.tsx\n"
            ),
        ),
    )

    uat_calls: list[tuple] = []
    done_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_uat", lambda item_id, link, actor="claude": (uat_calls.append((item_id, link)), ({}, True))[1])
    monkeypatch.setattr(integrate.backlog, "set_done", lambda *a, **k: (done_calls.append((a, k)), ({}, True))[1])
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link, detail=None: None)

    item = {"id": "H43", "branch": "feature-H43-thing", "title": "Delete dead previews", "uat_review": False}
    result, detail = integrate._integrate_one(item)

    print("deletion of an existing variant set, flag unset -> result:", result, detail)

    assert result == "merged"
    assert detail.endswith("(done)")
    assert uat_calls == []
    assert len(done_calls) == 1


def test_integrate_one_backstop_lands_uat_for_mixed_diff_editing_existing_variant_files(monkeypatch):
    """G53 shape: no new directory, but a shared primitive plus
    VariantA/B/C.tsx all edited together inside the already-existing
    spend-period-round/ round Kevin was actively comparing. A mixed diff
    (some touched files match the variant pattern, some don't) must still
    land uat."""
    changed = {
        "frontend/app/design/spend-period-round/VariantA.tsx",
        "frontend/app/design/spend-period-round/VariantB.tsx",
        "frontend/app/design/spend-period-round/VariantC.tsx",
        "frontend/app/design/spend-period-round/primitives.tsx",
        "frontend/app/design/spend-period-round/SpendPeriodRoundClient.tsx",
    }
    _patch_integrate_one_plumbing(monkeypatch, changed)
    monkeypatch.setattr(
        integrate,
        "_sh",
        _fake_sh_with_backstop_state(
            ls_tree_output=(
                "frontend/app/design/spend-period-round/VariantA.tsx\n"
                "frontend/app/design/spend-period-round/VariantB.tsx\n"
                "frontend/app/design/spend-period-round/VariantC.tsx\n"
                "frontend/app/design/spend-period-round/primitives.tsx\n"
                "frontend/app/design/spend-period-round/SpendPeriodRoundClient.tsx\n"
                "frontend/app/design/spend-period-round/page.tsx\n"
            ),
            diff_name_status=(
                "M\tfrontend/app/design/spend-period-round/VariantA.tsx\n"
                "M\tfrontend/app/design/spend-period-round/VariantB.tsx\n"
                "M\tfrontend/app/design/spend-period-round/VariantC.tsx\n"
                "M\tfrontend/app/design/spend-period-round/primitives.tsx\n"
                "M\tfrontend/app/design/spend-period-round/SpendPeriodRoundClient.tsx\n"
            ),
        ),
    )

    uat_calls: list[tuple] = []
    done_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_uat", lambda item_id, link, actor="claude": (uat_calls.append((item_id, link)), ({}, True))[1])
    monkeypatch.setattr(integrate.backlog, "set_done", lambda *a, **k: (done_calls.append((a, k)), ({}, True))[1])
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link, detail=None: None)

    item = {"id": "G53", "branch": "feature-G53-thing", "title": "Spend period round refinement", "uat_review": False}
    result, detail = integrate._integrate_one(item)

    print("mixed diff re-touching existing VariantA/B/C together, flag unset -> result:", result, detail)

    assert result == "merged"
    assert "landed in uat" in detail
    assert len(uat_calls) == 1
    assert done_calls == []


# --- H37: a merge conflict must never tell the owning session to rebase a
# branch that's already pushed to origin. By the time an item is in review
# its branch is on the remote, so rebasing rewrites published commits and
# the follow-up push is rejected as non-fast-forward; CLAUDE.md forbids
# force-pushing to work around that. The block reason must say to merge
# origin/main into the branch instead, and pin the exact wording so it
# cannot silently drift back to "rebase". -----------------------------------


def test_integrate_one_blocks_with_merge_not_rebase_reason_on_conflict(monkeypatch):
    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        if cmd[:2] == ["git", "rev-parse"]:
            return 0, "deadbeef1234567890deadbeef1234567890dead"
        if cmd[:3] == ["git", "merge", "--no-ff"]:
            return 1, "CONFLICT (content): Merge conflict in frontend/app/design/page.tsx"
        return 0, ""

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    set_state_calls: list[tuple] = []

    def fake_set_state(item_id, state, reason=None, branch=None, actor="claude"):
        set_state_calls.append((item_id, state, reason, actor))
        return {}, True

    monkeypatch.setattr(integrate.backlog, "set_state", fake_set_state)
    monkeypatch.setattr(integrate.backlog, "add_note", lambda *a, **k: None)

    item = {"id": "H99", "branch": "feature-H99-thing", "title": "Some item", "uat_review": False}
    result, detail = integrate._integrate_one(item)

    print("merge conflict on H99 -> result:", result, detail)

    assert result == "blocked"
    assert len(set_state_calls) == 1
    item_id, state, reason, actor = set_state_calls[0]
    assert item_id == "H99"
    assert state == "blocked"
    assert reason == (
        "conflict with main; merge origin/main into the branch (do not "
        "rebase, it is already pushed) and re-run session.sh finish"
    )


# --- H34 end-to-end: _integrate_one wires the derived link (and, for a
# multi-directory round, the extra detail) into both the board and the
# notification, without ever being able to abort a merge that already
# succeeded. ---------------------------------------------------------------


def _fake_sh_with_curl_success(url_predicate):
    """Like `_fake_sh_factory()`, but any `curl` invocation returns 200 for
    a URL matching `url_predicate` and 404 otherwise — lets a test decide
    which candidate preview link "resolves" without ever making a real
    network call."""
    base = _fake_sh_factory()

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        if cmd and cmd[0] == "curl":
            url = cmd[-1]
            return (0, "200") if url_predicate(url) else (0, "404")
        return base(cmd, cwd=cwd, timeout=timeout)

    return fake_sh


def test_integrate_one_records_verified_single_slug_link(monkeypatch):
    _patch_integrate_one_plumbing(monkeypatch, {"frontend/app/design/plan-picker/page.tsx"})
    monkeypatch.setattr(integrate, "_sh", _fake_sh_with_curl_success(lambda url: "/design/plan-picker" in url))
    monkeypatch.setattr(integrate, "_design_round_example_query", lambda slug: None)

    uat_calls: list[tuple] = []
    note_calls: list[tuple] = []
    notify_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_uat", lambda item_id, link, actor="claude": (uat_calls.append((item_id, link)), ({}, True))[1])
    monkeypatch.setattr(integrate.backlog, "set_done", lambda *a, **k: ({}, True))
    monkeypatch.setattr(integrate.backlog, "add_note", lambda item_id, text, actor="claude": (note_calls.append((item_id, text)), ({}, True))[1])
    monkeypatch.setattr(
        integrate, "_notify_uat_ready", lambda item_id, title, link, detail=None: notify_calls.append((item_id, title, link, detail))
    )

    item = {"id": "H34", "branch": "feature-H34-thing", "title": "Single preview round", "uat_review": True}
    result, detail = integrate._integrate_one(item)

    print("single design directory in the diff -> result:", result, detail)

    assert result == "merged"
    assert uat_calls == [("H34", "https://uat.wealth.auriqltd.co.uk/design/plan-picker")]
    assert note_calls == []  # nothing extra to record for a single-slug round
    assert notify_calls == [("H34", "Single preview round", "https://uat.wealth.auriqltd.co.uk/design/plan-picker", None)]


def test_integrate_one_records_first_slug_and_notes_the_rest_for_several_directories(monkeypatch):
    changed = {
        "frontend/app/design/another-round/page.tsx",
        "frontend/app/design/plan-picker/page.tsx",
    }
    _patch_integrate_one_plumbing(monkeypatch, changed)
    monkeypatch.setattr(
        integrate,
        "_sh",
        _fake_sh_with_curl_success(lambda url: "/design/plan-picker" in url or "/design/another-round" in url),
    )

    uat_calls: list[tuple] = []
    note_calls: list[tuple] = []
    notify_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_uat", lambda item_id, link, actor="claude": (uat_calls.append((item_id, link)), ({}, True))[1])
    monkeypatch.setattr(integrate.backlog, "set_done", lambda *a, **k: ({}, True))
    monkeypatch.setattr(integrate.backlog, "add_note", lambda item_id, text, actor="claude": (note_calls.append((item_id, text)), ({}, True))[1])
    monkeypatch.setattr(
        integrate, "_notify_uat_ready", lambda item_id, title, link, detail=None: notify_calls.append((item_id, title, link, detail))
    )

    item = {"id": "H34", "branch": "feature-H34-thing", "title": "Two preview rounds", "uat_review": True}
    result, detail = integrate._integrate_one(item)

    print("two design directories in the diff -> result:", result, detail)

    assert result == "merged"
    # path-sorted: "another-round" precedes "plan-picker"
    assert uat_calls == [("H34", "https://uat.wealth.auriqltd.co.uk/design/another-round")]
    assert len(note_calls) == 1
    assert note_calls[0][0] == "H34"
    assert "https://uat.wealth.auriqltd.co.uk/design/plan-picker" in note_calls[0][1]
    assert len(notify_calls) == 1
    notified_detail = notify_calls[0][3]
    assert notified_detail is not None
    assert "https://uat.wealth.auriqltd.co.uk/design/plan-picker" in notified_detail


def test_integrate_one_records_index_link_when_no_slug_can_be_derived(monkeypatch):
    """Only the index file itself changed under frontend/app/design/ (e.g.
    a merge that only re-shuffled ROUTES) — no preview directory to point
    at, so the generic index link is recorded, exactly like before H34,
    and the board/notification still land it rather than nothing."""
    _patch_integrate_one_plumbing(monkeypatch, {"frontend/app/design/page.tsx"})
    monkeypatch.setattr(integrate, "_sh", _fake_sh_with_curl_success(lambda url: True))

    uat_calls: list[tuple] = []
    notify_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_uat", lambda item_id, link, actor="claude": (uat_calls.append((item_id, link)), ({}, True))[1])
    monkeypatch.setattr(integrate.backlog, "set_done", lambda *a, **k: ({}, True))
    monkeypatch.setattr(integrate.backlog, "add_note", lambda *a, **k: ({}, True))
    monkeypatch.setattr(
        integrate, "_notify_uat_ready", lambda item_id, title, link, detail=None: notify_calls.append((item_id, title, link, detail))
    )

    item = {"id": "H34", "branch": "feature-H34-thing", "title": "Index only", "uat_review": True}
    result, detail = integrate._integrate_one(item)

    print("no preview directory in the diff -> result:", result, detail)

    assert result == "merged"
    assert uat_calls == [("H34", "https://uat.wealth.auriqltd.co.uk/design")]
    assert notify_calls == [("H34", "Index only", "https://uat.wealth.auriqltd.co.uk/design", None)]


def test_integrate_one_never_aborts_the_merge_when_link_derivation_raises(monkeypatch):
    """H34's own constraint: the link is cosmetic, the merge is not. If
    deriving the preview link blows up for any reason, _integrate_one must
    still report the merge as landed (in uat, with the plain index link),
    not bubble the exception up and turn a successful merge into a
    blocked one."""
    _patch_integrate_one_plumbing(monkeypatch, {"frontend/app/design/plan-picker/page.tsx"})

    def boom(changed):
        raise RuntimeError("boom")

    monkeypatch.setattr(integrate, "_design_round_preview", boom)

    uat_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_uat", lambda item_id, link, actor="claude": (uat_calls.append((item_id, link)), ({}, True))[1])
    monkeypatch.setattr(integrate.backlog, "set_done", lambda *a, **k: ({}, True))
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link, detail=None: None)

    item = {"id": "H34", "branch": "feature-H34-thing", "title": "Broken derivation", "uat_review": True}
    result, detail = integrate._integrate_one(item)

    print("link derivation raises -> result:", result, detail)

    assert result == "merged"
    assert "landed in uat" in detail
    assert uat_calls == [("H34", "https://uat.wealth.auriqltd.co.uk/design")]
