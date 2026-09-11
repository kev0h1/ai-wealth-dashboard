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


def test_design_round_preview_link_is_on_the_public_uat_host():
    link = integrate._design_round_preview_link()
    assert link == "https://uat.wealth.auriqltd.co.uk/design"
    assert link.startswith("https://" + integrate.backlog.PUBLIC_UAT_HOST)


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
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link: notify_calls.append((item_id, title, link)))

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
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link: None)

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
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link: None)

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
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda item_id, title, link: None)

    item = {"id": "G2", "branch": "feature-G2-thing", "title": "Also touches production", "uat_review": False}
    result, detail = integrate._integrate_one(item)

    print("design-round diff PLUS a production file -> result:", result, detail)

    assert result == "merged"
    assert uat_calls == []
    assert len(done_calls) == 1
