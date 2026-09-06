"""Unit tests for backend/app/routers/ops.py — the private go-live
readiness board (`GET /ops/go-live`, `POST /ops/go-live/items/{id}`,
`POST /ops/go-live/questions/{q}`). Owner-only (403 for everyone else);
reads and writes three markdown files from the repo root (`_repo_root`,
monkeypatched here to a tmp_path with fixture files rather than the real
repo, per the pattern test_grow.py etc. already use for router-level unit
tests: call the handler directly, no HTTP client, no DB). Git is mocked
throughout via `app.services.backlog.subprocess.run` so no test touches
the real history or network.
"""
import asyncio
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

import app.routers.ops as ops
from app.services import backlog
from app.routers.ops import ItemActionRequest, QuestionStatusRequest


TODO_FIXTURE = """# Backlog

## H. Repo hygiene

- [ ] **H3. Docs housekeeping.** [owner: claude] Some description.
"""

COMPLIANCE_FIXTURE = "## Q1 Start date\n\nStatus: ready\n\n```text\n2026-10-01\n```\n"


@pytest.fixture()
def mock_git(monkeypatch):
    mock_run = MagicMock(return_value=MagicMock(returncode=0))
    monkeypatch.setattr(backlog.subprocess, "run", mock_run)
    return mock_run


def _write_repo(tmp_path: Path) -> Path:
    (tmp_path / "TODO.md").write_text(TODO_FIXTURE, encoding="utf-8")
    docs_compliance = tmp_path / "docs" / "compliance"
    docs_compliance.mkdir(parents=True)
    (docs_compliance / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")
    docs_pricing = tmp_path / "docs" / "pricing"
    docs_pricing.mkdir(parents=True)
    (docs_pricing / "tiering-unit-economics-mcp-2026-09.md").write_text("# Pricing\n\nSome content.\n", encoding="utf-8")
    return tmp_path


def test_go_live_403_for_non_owner(monkeypatch):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")

    async def _run():
        with pytest.raises(HTTPException) as exc_info:
            await ops.go_live(user={"email": "someone@example.com"})
        assert exc_info.value.status_code == 403

    asyncio.run(_run())


def test_go_live_200_for_owner_with_three_keys_and_parsed_items(tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    _write_repo(tmp_path)
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)

    async def _run():
        result = await ops.go_live(user={"email": "kevin.maingi12@gmail.com"})
        files = result["files"]
        assert set(files.keys()) == {"todo", "compliance", "pricing"}
        assert "Backlog" in files["todo"]["markdown"]
        assert "Status: ready" in files["compliance"]["markdown"]
        assert "Pricing" in files["pricing"]["markdown"]
        for doc in files.values():
            assert doc["updated_at"]  # ISO timestamp string, non-empty

        assert "jira_base_url" not in result
        assert [i["id"] for i in result["items"]] == ["H3"]
        assert result["items"][0]["owner"] == "claude"
        assert result["items"][0]["state"] == "todo"
        assert [q["q"] for q in result["questions"]] == ["Q1"]
        assert result["questions"][0]["status"] == "ready"

    asyncio.run(_run())


def test_go_live_omits_missing_files_and_returns_empty_parsed_lists(tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    (tmp_path / "TODO.md").write_text("# Backlog\n", encoding="utf-8")
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)

    async def _run():
        result = await ops.go_live(user={"email": "kevin.maingi12@gmail.com"})
        assert set(result["files"].keys()) == {"todo"}
        assert result["items"] == []
        assert result["questions"] == []

    asyncio.run(_run())


def test_go_live_email_match_is_case_insensitive(tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    (tmp_path / "TODO.md").write_text("# Backlog\n", encoding="utf-8")
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)

    async def _run():
        result = await ops.go_live(user={"email": "Kevin.Maingi12@Gmail.com"})
        assert "todo" in result["files"]

    asyncio.run(_run())


# ---------------------------------------------------------------------
# POST /ops/go-live/items/{item_id}
# ---------------------------------------------------------------------


def test_item_action_403_for_non_owner(monkeypatch, mock_git):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")

    async def _run():
        with pytest.raises(HTTPException) as exc_info:
            await ops.go_live_item_action(
                "H3", ItemActionRequest(action="start"), user={"email": "someone@example.com"}
            )
        assert exc_info.value.status_code == 403

    asyncio.run(_run())


def test_item_action_done_round_trip_on_temp_repo_root(tmp_path, monkeypatch, mock_git):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    _write_repo(tmp_path)
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)

    async def _run():
        result = await ops.go_live_item_action(
            "H3",
            ItemActionRequest(action="done", commit="abc1234"),
            user={"email": "kevin.maingi12@gmail.com"},
        )
        assert result["committed"] is True
        item = next(i for i in result["items"] if i["id"] == "H3")
        assert item["state"] == "done"
        assert item["commit"] == "abc1234"

        saved = (tmp_path / "TODO.md").read_text(encoding="utf-8")
        assert "- [x]" in saved
        assert "abc1234" in saved

    asyncio.run(_run())

    commit_calls = [c for c in mock_git.call_args_list if c.args[0][:2] == ["git", "commit"]]
    assert commit_calls
    assert "backlog: H3 done by kevin" in commit_calls[0].args[0]


def test_item_action_start_then_block_then_reopen(tmp_path, monkeypatch, mock_git):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    _write_repo(tmp_path)
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)
    user = {"email": "kevin.maingi12@gmail.com"}

    async def _run():
        result = await ops.go_live_item_action("H3", ItemActionRequest(action="start"), user=user)
        item = next(i for i in result["items"] if i["id"] == "H3")
        assert item["state"] == "in-progress"

        result = await ops.go_live_item_action(
            "H3", ItemActionRequest(action="block", reason="waiting on Kevin"), user=user
        )
        item = next(i for i in result["items"] if i["id"] == "H3")
        assert item["state"] == "blocked"
        assert item["reason"] == "waiting on Kevin"

        result = await ops.go_live_item_action("H3", ItemActionRequest(action="done"), user=user)
        item = next(i for i in result["items"] if i["id"] == "H3")
        assert item["state"] == "done"

        result = await ops.go_live_item_action("H3", ItemActionRequest(action="reopen"), user=user)
        item = next(i for i in result["items"] if i["id"] == "H3")
        assert item["state"] == "todo"

    asyncio.run(_run())


def test_item_action_block_without_reason_is_400(tmp_path, monkeypatch, mock_git):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    _write_repo(tmp_path)
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)

    async def _run():
        with pytest.raises(HTTPException) as exc_info:
            await ops.go_live_item_action(
                "H3", ItemActionRequest(action="block"), user={"email": "kevin.maingi12@gmail.com"}
            )
        assert exc_info.value.status_code == 400

    asyncio.run(_run())


def test_item_action_note_and_owner(tmp_path, monkeypatch, mock_git):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    _write_repo(tmp_path)
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)
    user = {"email": "kevin.maingi12@gmail.com"}

    async def _run():
        result = await ops.go_live_item_action(
            "H3", ItemActionRequest(action="note", text="Board write-side smoke test"), user=user
        )
        item = next(i for i in result["items"] if i["id"] == "H3")
        assert item["notes"][-1]["text"] == "Board write-side smoke test"
        assert item["notes"][-1]["actor"] == "kevin"

        result = await ops.go_live_item_action("H3", ItemActionRequest(action="owner", owner="kevin"), user=user)
        item = next(i for i in result["items"] if i["id"] == "H3")
        assert item["owner"] == "kevin"

    asyncio.run(_run())


def test_item_action_unknown_item_id_is_404(tmp_path, monkeypatch, mock_git):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    _write_repo(tmp_path)
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)

    async def _run():
        with pytest.raises(HTTPException) as exc_info:
            await ops.go_live_item_action(
                "Z9", ItemActionRequest(action="start"), user={"email": "kevin.maingi12@gmail.com"}
            )
        assert exc_info.value.status_code == 404

    asyncio.run(_run())


def test_item_action_reports_committed_false_when_git_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    _write_repo(tmp_path)
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)

    def _raise(*args, **kwargs):
        raise RuntimeError("git unavailable in this sandbox")

    monkeypatch.setattr(backlog.subprocess, "run", _raise)

    async def _run():
        result = await ops.go_live_item_action(
            "H3", ItemActionRequest(action="start"), user={"email": "kevin.maingi12@gmail.com"}
        )
        assert result["committed"] is False
        item = next(i for i in result["items"] if i["id"] == "H3")
        assert item["state"] == "in-progress"  # file write still landed

    asyncio.run(_run())


# ---------------------------------------------------------------------
# POST /ops/go-live/questions/{q}
# ---------------------------------------------------------------------


def test_question_status_403_for_non_owner(monkeypatch, mock_git):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")

    async def _run():
        with pytest.raises(HTTPException) as exc_info:
            await ops.go_live_question_status(
                "Q1", QuestionStatusRequest(status="submitted"), user={"email": "someone@example.com"}
            )
        assert exc_info.value.status_code == 403

    asyncio.run(_run())


def test_question_status_round_trip(tmp_path, monkeypatch, mock_git):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    _write_repo(tmp_path)
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)

    async def _run():
        result = await ops.go_live_question_status(
            "Q1", QuestionStatusRequest(status="submitted"), user={"email": "kevin.maingi12@gmail.com"}
        )
        assert result["committed"] is True
        q = next(q for q in result["questions"] if q["q"] == "Q1")
        assert q["status"] == "submitted"

        saved = (tmp_path / "docs" / "compliance" / "finexer-agent-controls-2026-09.md").read_text(encoding="utf-8")
        assert "Status: submitted" in saved

    asyncio.run(_run())


def test_question_status_unknown_question_is_404(tmp_path, monkeypatch, mock_git):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    _write_repo(tmp_path)
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)

    async def _run():
        with pytest.raises(HTTPException) as exc_info:
            await ops.go_live_question_status(
                "Q99", QuestionStatusRequest(status="ready"), user={"email": "kevin.maingi12@gmail.com"}
            )
        assert exc_info.value.status_code == 404

    asyncio.run(_run())
