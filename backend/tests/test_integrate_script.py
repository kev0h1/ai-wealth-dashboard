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

    # the full multi-line text is preserved as a board note.
    assert len(add_note_calls) == 1
    note_item_id, note_text, note_actor = add_note_calls[0]
    assert note_item_id == "H99"
    assert note_actor == "claude"
    assert note_text == raw_output[:1500]

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


# ---------------------------------------------------------------------
# H31 — a design round lands in `uat` instead of `done`: the backstop diff
# heuristic, the review-candidate exclusion (uat is never picked up
# again, same protection `rejected` already has), and _integrate_one's own
# branch decision between set_uat and set_done.
# ---------------------------------------------------------------------


def test_is_design_round_diff_true_when_every_path_under_frontend_design():
    changed = {
        "frontend/app/design/plan-picker/page.tsx",
        "frontend/app/design/plan-picker/VariantA.tsx",
        "frontend/app/design/page.tsx",  # the index itself, still under the tree
    }
    assert integrate._is_design_round_diff(changed) is True


def test_is_design_round_diff_false_when_a_production_component_is_also_touched():
    changed = {
        "frontend/app/design/plan-picker/page.tsx",
        "frontend/app/components/HomePage.tsx",  # one file outside the tree is enough
    }
    assert integrate._is_design_round_diff(changed) is False


def test_is_design_round_diff_false_for_backend_only_change():
    assert integrate._is_design_round_diff({"backend/app/services/x.py"}) is False


def test_is_design_round_diff_false_for_empty_diff():
    assert integrate._is_design_round_diff(set()) is False


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
    _patch_integrate_one_plumbing(monkeypatch, {"frontend/app/design/plan-picker/page.tsx"})

    uat_calls: list[tuple] = []
    done_calls: list[tuple] = []
    notify_calls: list[tuple] = []
    monkeypatch.setattr(integrate.backlog, "set_uat", lambda item_id, link, actor="claude": (uat_calls.append((item_id, link, actor)), ({}, True))[1])
    monkeypatch.setattr(integrate.backlog, "set_done", lambda *a, **k: (done_calls.append((a, k)), ({}, True))[1])
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link, detail=None: notify_calls.append((item_id, title, link)))

    item = {"id": "H31", "branch": "feature-H31-thing", "title": "UAT review swimlane", "uat_review": True}
    result, detail = integrate._integrate_one(item)

    print("uat_review flag set, diff is design-round-only -> result:", result, detail)

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
