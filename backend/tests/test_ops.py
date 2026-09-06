"""Unit tests for backend/app/routers/ops.py's `/ops/go-live` — the private
readiness page endpoint. Owner-only (403 for everyone else), reads three
markdown files from the repo root (`_repo_root`, monkeypatched here to a
tmp_path with fixture files rather than the real repo, per the pattern
test_grow.py etc. already use for router-level unit tests: call the handler
directly, no HTTP client, no DB).
"""
import asyncio

import pytest
from fastapi import HTTPException

import app.routers.ops as ops


def test_go_live_403_for_non_owner(monkeypatch):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")

    async def _run():
        with pytest.raises(HTTPException) as exc_info:
            await ops.go_live(user={"email": "someone@example.com"})
        assert exc_info.value.status_code == 403

    asyncio.run(_run())


def test_go_live_200_for_owner_with_three_keys(tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")

    (tmp_path / "TODO.md").write_text("# Backlog\n\n- [ ] item one\n", encoding="utf-8")
    docs_compliance = tmp_path / "docs" / "compliance"
    docs_compliance.mkdir(parents=True)
    (docs_compliance / "finexer-agent-controls-2026-09.md").write_text(
        "## Q1 Start date\n\nStatus: ready\n\n```text\n2026-10-01\n```\n", encoding="utf-8"
    )
    docs_pricing = tmp_path / "docs" / "pricing"
    docs_pricing.mkdir(parents=True)
    (docs_pricing / "tiering-unit-economics-mcp-2026-09.md").write_text(
        "# Pricing\n\nSome content.\n", encoding="utf-8"
    )

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

    asyncio.run(_run())


def test_go_live_omits_missing_files(tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    (tmp_path / "TODO.md").write_text("# Backlog\n", encoding="utf-8")
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)

    async def _run():
        result = await ops.go_live(user={"email": "kevin.maingi12@gmail.com"})
        assert set(result["files"].keys()) == {"todo"}

    asyncio.run(_run())


def test_go_live_email_match_is_case_insensitive(tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    (tmp_path / "TODO.md").write_text("# Backlog\n", encoding="utf-8")
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)

    async def _run():
        result = await ops.go_live(user={"email": "Kevin.Maingi12@Gmail.com"})
        assert "todo" in result["files"]

    asyncio.run(_run())


def test_go_live_jira_base_url_read_from_jira_env(tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    (tmp_path / "TODO.md").write_text("# Backlog\n", encoding="utf-8")
    (tmp_path / ".jira.env").write_text(
        "JIRA_BASE_URL=https://auriqltd.atlassian.net\nJIRA_EMAIL=kevin@example.com\nJIRA_API_TOKEN=secret\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)

    async def _run():
        result = await ops.go_live(user={"email": "kevin.maingi12@gmail.com"})
        assert result["jira_base_url"] == "https://auriqltd.atlassian.net"

    asyncio.run(_run())


def test_go_live_jira_base_url_none_without_jira_env(tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")
    (tmp_path / "TODO.md").write_text("# Backlog\n", encoding="utf-8")
    monkeypatch.setattr(ops, "_repo_root", lambda: tmp_path)

    async def _run():
        result = await ops.go_live(user={"email": "kevin.maingi12@gmail.com"})
        assert result["jira_base_url"] is None

    asyncio.run(_run())
