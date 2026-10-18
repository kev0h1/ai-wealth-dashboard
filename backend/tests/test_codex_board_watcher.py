"""Safety boundaries for the one-ticket Codex board watcher.

All worker, board and git boundaries are faked here.  These are deliberately
unit tests: neither a real board mutation nor a Codex invocation is permitted.
"""
from __future__ import annotations

from contextlib import nullcontext
import importlib
import json
from pathlib import Path
import sys

import pytest


SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


@pytest.fixture
def watcher(monkeypatch):
    module = importlib.import_module("codex_board_watcher")
    # H118's final dispatch recheck is protected by a repository lock.  It is
    # not under test here and must never touch a real repository lock.
    if hasattr(module, "board_guard"):
        monkeypatch.setattr(module, "board_guard", lambda _repo: nullcontext())
    monkeypatch.setattr(module, "dispatch_preflight", lambda _repo: None)
    return module


def fake_git(args, *_args, **_kwargs):
    if args[:2] == ["git", "show-ref"]:
        return type("R", (), {"returncode": 1, "stdout": ""})()
    if args[:2] == ["git", "ls-remote"]:
        return type("R", (), {"returncode": 0, "stdout": ""})()
    return type("R", (), {"returncode": 0, "stdout": "a" * 40})()


def item(item_id="H118", *, owner="codex", state="todo", branch=None,
         priority="p2", notes=None):
    return {
        "id": item_id,
        "owner": owner,
        "state": state,
        "branch": branch,
        "reason": None,
        "priority": priority,
        "notes": [] if notes is None else notes,
    }


def _fake_launch(calls):
    def launch(_repo, _directory, state, event, _codex, _timeout):
        calls.append(event["item_id"])
        state["queue"] = [queued for queued in state["queue"] if queued["key"] != event["key"]]
        state["runs"].append({"event_key": event["key"], "item_id": event["item_id"],
                              "started_at": 1.0, "status": "completed"})
    return launch


def test_tick_is_observe_only_when_idle_or_dispatch_is_not_requested(watcher, monkeypatch, tmp_path):
    launches = []
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item(owner="kevin")])
    monkeypatch.setattr(watcher, "launch", _fake_launch(launches))

    result = watcher.tick(tmp_path, tmp_path)

    assert result == {"queued": 0, "waiting": "no-actionable-event", "dispatched": False}
    assert launches == []


def test_dry_run_never_persists_or_launches(watcher, monkeypatch, tmp_path):
    writes, launches = [], []
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item()])
    monkeypatch.setattr(watcher, "save_state", lambda *args: writes.append(args))
    monkeypatch.setattr(watcher, "launch", _fake_launch(launches))

    result = watcher.tick(tmp_path, tmp_path / "watcher", dry_run=True)

    assert result["mode"] == "dry-run"
    assert result["dispatch_enabled"] is False
    assert result["queued"] == [{"id": "H118", "kind": "assigned"}]
    assert writes == []
    assert launches == []


def test_persisted_event_dispatches_once_and_is_not_repolled(watcher, monkeypatch, tmp_path):
    launches = []
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item()])
    directory = tmp_path / "watcher"
    directory.mkdir()

    def launch(_repo, _directory, state, event, _codex, _timeout):
        _fake_launch(launches)(_repo, _directory, state, event, _codex, _timeout)
        watcher.save_state(_directory / "state.json", state)

    monkeypatch.setattr(watcher, "launch", launch)

    first = watcher.tick(tmp_path, directory, dispatch=True)
    second = watcher.tick(tmp_path, directory, dispatch=True)

    assert first["dispatched"] is True
    assert second["dispatched"] is False
    assert launches == ["H118"]


def test_approval_event_is_queued_ahead_of_ordinary_assignment(watcher):
    baseline = watcher.reconcile(watcher.empty_state(), [item("H1"), item("H2")], 1)
    baseline["queue"] = []
    changed = watcher.reconcile(
        baseline,
        [item("H1", state="in-progress", notes=[{"text": "approved: variant A"}]), item("H2"), item("H3")],
        2,
    )

    assert [event["kind"] for event in changed["queue"]] == ["approved", "assigned"]
    assert [event["item_id"] for event in changed["queue"]] == ["H1", "H3"]


def test_paused_marker_prevents_dispatch(watcher, monkeypatch, tmp_path):
    launches = []
    directory = tmp_path / "watcher"
    directory.mkdir()
    (directory / "PAUSED").touch()
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item()])
    monkeypatch.setattr(watcher, "launch", _fake_launch(launches))

    result = watcher.tick(tmp_path, directory, dispatch=True)

    assert result["waiting"] == "paused"
    assert result["dispatched"] is False
    assert launches == []


@pytest.mark.parametrize("changed", [item(owner="kevin"), item(state="cancelled")])
def test_reassignment_or_cancellation_before_inference_stops_dispatch(watcher, monkeypatch, tmp_path, changed):
    launches = []
    reads = iter([[item()], [changed], [changed], [changed]])
    monkeypatch.setattr(watcher, "read_items", lambda _repo: next(reads, [changed]))
    monkeypatch.setattr(watcher, "launch", _fake_launch(launches))

    result = watcher.tick(tmp_path, tmp_path, dispatch=True)

    assert result["dispatched"] is False
    assert launches == []


def test_any_live_codex_item_blocks_a_queued_dispatch(watcher, monkeypatch, tmp_path):
    launches = []
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item(), item("H119", state="in-progress", branch="feature-H119")])
    monkeypatch.setattr(watcher, "launch", _fake_launch(launches))

    result = watcher.tick(tmp_path, tmp_path, dispatch=True)

    assert result["waiting"] == "another-codex-ticket-is-live"
    assert launches == []


def test_daily_and_per_item_caps_are_fail_closed(watcher):
    event = {"key": "a" * 64, "item_id": "H118", "kind": "assigned", "priority": "p2"}
    state = watcher.empty_state()
    state["queue"] = [event]
    state["runs"] = [{"event_key": "b" * 64, "item_id": "H117", "started_at": 99, "status": "completed"}]
    assert watcher.eligibility(state, [item()], 100, 1, 2) == "daily-run-cap"

    state["runs"] = [{"event_key": "b" * 64, "item_id": "H118", "started_at": 99, "status": "completed"}]
    assert watcher.choose_event(state, 100, 1) is None


def test_corrupt_state_and_unfinished_run_never_replay(watcher, monkeypatch, tmp_path):
    launches = []
    directory = tmp_path / "watcher"
    directory.mkdir()
    state_file = directory / "state.json"
    state_file.write_text("not json")
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item()])
    monkeypatch.setattr(watcher, "launch", _fake_launch(launches))
    with pytest.raises(Exception):
        watcher.tick(tmp_path, directory, dispatch=True)
    assert launches == []

    state = watcher.reconcile(watcher.empty_state(), [item()], 1)
    state["runs"].append({"event_key": "f" * 64, "item_id": "H117", "started_at": 1, "status": "launching"})
    watcher.save_state(state_file, state)
    result = watcher.tick(tmp_path, directory, dispatch=True)
    assert result["dispatched"] is False
    assert launches == []


def test_launch_persists_launching_marker_before_popen(watcher, monkeypatch, tmp_path):
    directory = tmp_path / "watcher"
    directory.mkdir()
    state = watcher.reconcile(watcher.empty_state(), [item()], 1)
    event = state["queue"][0]
    marker_seen = []

    class Refusal:
        def __call__(self, *args, **kwargs):
            persisted = json.loads((directory / "state.json").read_text())
            marker_seen.append(persisted["runs"][-1]["status"])
            raise OSError("fake process must not start")

    monkeypatch.setattr(watcher, "command", fake_git)
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item()])
    monkeypatch.setattr(watcher.subprocess, "Popen", Refusal())
    monkeypatch.setattr(watcher.signal, "signal", lambda *_args: None)

    with pytest.raises(OSError):
        watcher.launch(tmp_path, directory, state, event, "/not/codex", 1)

    assert marker_seen == ["launching"]
    assert json.loads((directory / "state.json").read_text())["runs"][-1]["status"] == "uncertain"


def test_timeout_kills_the_worker_process_group_and_only_failure_gets_attention(watcher, monkeypatch, tmp_path):
    directory = tmp_path / "watcher"
    directory.mkdir()
    state = watcher.reconcile(watcher.empty_state(), [item()], 1)
    event = state["queue"][0]
    killed, attention = [], []

    class Process:
        pid = 4321
        returncode = None
        class stdin:
            @staticmethod
            def write(_prompt):
                return None
            @staticmethod
            def close():
                return None
        def poll(self): return None
        def wait(self, timeout): self.returncode = -15; return self.returncode

    monkeypatch.setattr(watcher, "command", fake_git)
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item()])
    monkeypatch.setattr(watcher.subprocess, "Popen", lambda *args, **kwargs: Process())
    monkeypatch.setattr(watcher.os, "killpg", lambda pid, signal: killed.append((pid, signal)))
    monkeypatch.setattr(watcher.signal, "signal", lambda *_args: None)
    monkeypatch.setattr(watcher.time, "monotonic", iter([0, 2]).__next__)
    monkeypatch.setattr(watcher, "report_attention", lambda *_args: attention.append(True))

    watcher.launch(tmp_path, directory, state, event, "/not/codex", 1)

    assert killed == [(4321, watcher.signal.SIGTERM)]
    assert attention == [True]
    assert state["runs"][-1]["status"] == "attention"


def test_successful_handoff_does_not_write_an_attention_note(watcher, monkeypatch, tmp_path):
    directory = tmp_path / "watcher"
    directory.mkdir()
    state = watcher.reconcile(watcher.empty_state(), [item()], 1)
    event = state["queue"][0]
    attention = []

    class Process:
        pid = 4321
        returncode = 0
        class stdin:
            @staticmethod
            def write(_prompt):
                return None
            @staticmethod
            def close():
                return None
        def poll(self): return 0

    monkeypatch.setattr(watcher, "command", fake_git)
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item()])
    monkeypatch.setattr(watcher.subprocess, "Popen", lambda *args, **kwargs: Process())
    monkeypatch.setattr(watcher.signal, "signal", lambda *_args: None)
    monkeypatch.setattr(watcher, "handoff", lambda *_args: (True, "b" * 40))
    monkeypatch.setattr(watcher, "report_attention", lambda *_args: attention.append(True))

    watcher.launch(tmp_path, directory, state, event, "/not/codex", 1)

    assert state["runs"][-1]["status"] == "completed"
    assert attention == []


def test_handoff_requires_a_new_commit_and_the_matching_remote_hash(watcher, monkeypatch, tmp_path):
    branch = "feature-H118-board-watcher"
    commit = "b" * 40
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item(state="review", branch=branch)])

    def command(args, _repo, **_kwargs):
        if args[:2] == ["git", "remote"]:
            return type("R", (), {"returncode": 0, "stdout": watcher.CANONICAL_ORIGIN})()
        if args[:2] == ["git", "rev-parse"]:
            return type("R", (), {"returncode": 0, "stdout": commit + "\n"})()
        if args[:2] == ["git", "rev-list"]:
            assert args[2:] == ["--count", commit, "--not", "a" * 40, "c" * 40]
            return type("R", (), {"returncode": 0, "stdout": "1\n"})()
        assert args[:2] == ["git", "ls-remote"]
        return type("R", (), {"returncode": 0, "stdout": commit + "\trefs/heads/" + branch + "\n"})()

    monkeypatch.setattr(watcher, "command", command)
    assert watcher.handoff(tmp_path, "H118", "a" * 40, ["c" * 40], branch) == (True, commit)

    def no_new_commit(args, repo, **kwargs):
        response = command(args, repo, **kwargs)
        if args[:2] == ["git", "rev-list"]:
            return type("R", (), {"returncode": 0, "stdout": "0\n"})()
        return response

    monkeypatch.setattr(watcher, "command", no_new_commit)
    accepted, _detail = watcher.handoff(tmp_path, "H118", "a" * 40, ["c" * 40], branch)
    assert accepted is False


def test_worker_contract_is_fixed_and_prompt_preserves_governance(watcher, tmp_path):
    event = {"item_id": "H118", "key": "a" * 64, "kind": "approved"}
    command = watcher.worker_command(tmp_path, event, tmp_path / "run", "/usr/bin/codex")
    prompt = watcher.worker_prompt(event)

    assert command[:3] == ["/usr/bin/codex", "exec", "--approve-for-me"]
    assert command[-1] == "-"
    assert "H118" not in command
    assert "shell" not in " ".join(command).lower()
    for restriction in ("Read AGENTS.md", "PRODUCT.md, DESIGN.md", "never choose a variant yourself", "You are not the coordinator", "never merge/push main", "Do not claim success without a commit and a verified pushed review handoff"):
        assert restriction in " ".join(prompt.split())


def test_future_only_baselines_existing_work_but_not_new_assignments(watcher, monkeypatch, tmp_path):
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item()])
    assert watcher.tick(tmp_path, tmp_path, future_only=True)["queued"] == 0
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item(), item("H119")])
    assert watcher.tick(tmp_path, tmp_path, future_only=True)["queued"] == 1


def test_final_locked_recheck_prevents_model_spawn(watcher, monkeypatch, tmp_path):
    state = watcher.reconcile(watcher.empty_state(), [item()], 1)
    event = state["queue"][0]
    monkeypatch.setattr(watcher, "command", fake_git)
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item(state="cancelled")])
    monkeypatch.setattr(watcher.subprocess, "Popen", lambda *_args, **_kwargs: pytest.fail("stale event must not invoke Codex"))
    watcher.launch(tmp_path, tmp_path, state, event, "/not/codex", 1)
    assert state["runs"][-1]["status"] == "superseded"
    assert watcher.recent_runs(state, 2) == []


def test_manual_acknowledgement_never_requeues_or_calls_a_model(watcher, monkeypatch, tmp_path):
    state = watcher.reconcile(watcher.empty_state(), [item()], 1)
    event = state["queue"].pop()
    state["runs"] = [{"event_key": event["key"], "item_id": "H118", "started_at": 1, "status": "uncertain", "pid": 12345}]
    watcher.save_state(tmp_path / "state.json", state)
    monkeypatch.setattr(watcher.subprocess, "Popen", lambda *_args, **_kwargs: pytest.fail("ack is never inference"))
    monkeypatch.setattr(watcher.os, "killpg", lambda *_args: None)
    with pytest.raises(watcher.WatcherError, match="still exists"):
        watcher.acknowledge_run(tmp_path, event["key"], "Inspected")
    def gone(*_args):
        raise ProcessLookupError
    monkeypatch.setattr(watcher.os, "killpg", gone)
    watcher.acknowledge_run(tmp_path, event["key"], "Inspected stopped worker")
    saved = watcher.load_state(tmp_path / "state.json")
    assert saved["runs"][0]["status"] == "attention"
    assert watcher.reconcile(saved, [item()], 2)["queue"] == []


def test_process_termination_escalates_to_kill(watcher, monkeypatch):
    killed = []
    class Process:
        pid = 12345
        waits = 0
        def wait(self, timeout):
            self.waits += 1
            if self.waits == 1:
                raise watcher.subprocess.TimeoutExpired("fake", timeout)
    monkeypatch.setattr(watcher.os, "killpg", lambda pid, sig: killed.append((pid, sig)))
    watcher.terminate_worker(Process())
    assert killed == [(12345, watcher.signal.SIGTERM), (12345, watcher.signal.SIGKILL)]


def test_worker_environment_does_not_inherit_secrets_or_git_overrides(watcher, monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "fake-not-a-secret")
    monkeypatch.setenv("GIT_CONFIG_COUNT", "4")
    monkeypatch.setenv("OPENAI_API_KEY", "fake-not-a-key")
    env = watcher.worker_environment()
    assert set(env) == {"HOME", "PATH", "LANG", "BACKLOG_AGENT"}
    assert env["BACKLOG_AGENT"] == "codex"


def test_preexisting_remote_run_branch_never_starts_model(watcher, monkeypatch, tmp_path):
    state = watcher.reconcile(watcher.empty_state(), [item()], 1)
    def remote_exists(args, *_args, **_kwargs):
        if args[:2] == ["git", "ls-remote"]:
            return type("R", (), {"returncode": 0, "stdout": "b" * 40 + "\trefs/heads/existing"})()
        return fake_git(args)
    monkeypatch.setattr(watcher, "command", remote_exists)
    monkeypatch.setattr(watcher.subprocess, "Popen", lambda *_args, **_kwargs: pytest.fail("existing remote is not a fresh run"))
    with pytest.raises(watcher.WatcherError, match="already exists"):
        watcher.launch(tmp_path, tmp_path, state, state["queue"][0], "/not/codex", 1)
    assert state["runs"] == []


def test_foreign_review_branch_is_not_the_worker_handoff(watcher, monkeypatch, tmp_path):
    monkeypatch.setattr(watcher, "read_items", lambda _repo: [item(state="review", branch="feature-H118-someone-else")])
    assert watcher.handoff(tmp_path, "H118", "a" * 40, [], "feature-H118-board-123456789012")[0] is False


def test_real_preflight_refuses_worktree_code_even_with_shared_repo_argument(monkeypatch, tmp_path):
    module = importlib.import_module("codex_board_watcher")
    monkeypatch.setattr(module, "__file__", str(tmp_path / "scripts/codex_board_watcher.py"))
    monkeypatch.setattr(module, "command", lambda *_args, **_kwargs: pytest.fail("wrong code path must fail before Git"))
    with pytest.raises(module.WatcherError, match="merged shared-tree"):
        module.dispatch_preflight(module.SHARED_REPO)


def test_state_write_refuses_special_file_without_replacing_it(watcher, tmp_path):
    target = tmp_path / "state.json"
    watcher.os.mkfifo(target)
    before = target.stat()
    with pytest.raises(OSError, match="device, socket or fifo"):
        watcher.save_state(target, watcher.empty_state())
    assert target.stat().st_ino == before.st_ino
    assert list(tmp_path.iterdir()) == [target]


def test_usage_counts_tokens_without_inventing_dollar_cost(watcher, tmp_path):
    events = tmp_path / "events.jsonl"
    events.write_text("\n".join([
        json.dumps({"type": "turn.completed", "usage": {"input_tokens": 10, "cached_input_tokens": 2, "output_tokens": 3}}),
        json.dumps({"type": "turn.completed", "usage": {"input_tokens": 4, "output_tokens": 7}}),
        "not-json",
    ]))

    assert watcher.usage_from(events) == {"completed_turns": 2, "input_tokens": 14,
                                           "cached_input_tokens": 2, "output_tokens": 10,
                                           "cost_usd": None}
