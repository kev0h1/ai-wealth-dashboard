"""Tests for scripts/jira_sync.py.

Run with: backend/.venv/bin/python -m pytest -q scripts/tests

Everything here uses temp copies of TODO.md / the compliance doc (never the
real files) and a FakeJiraClient that records calls instead of touching the
network, per the "no Jira credentials exist yet" constraint on this repo.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import jira_sync  # noqa: E402


TODO_FIXTURE = """# Sorted backlog (test fixture)

Working rules paragraph goes here.

Context documents: none.

Jira: every item mirrors a Jira issue.

## A. Section A heading

- [ ] **A1. First item title.** [owner: claude] Some description text about A1.
- [x] **A2. Second item title.** [owner: kevin] (SRT-5) Already synced and done (done 2026-09-01, abc123)
- [ ] **A3. Third item.** [owner: claude] (SRT-9) Has a key already, not done.

## B. Section B heading

- [ ] **B1. Only item in B.** [owner: claude] Something about B1.
"""

COMPLIANCE_FIXTURE = """# Fixture compliance doc

## Q1 Start date

Status: ready

```text
2026-10-01
```

## Q2 Material changes

Status: needs-kevin

```text
Some answer body for Q2.
```

## Q3 Already synced

Status: blocked-deploy Jira: SRT-40

```text
Some answer body for Q3.
```
"""


@pytest.fixture()
def fixtures(tmp_path, monkeypatch):
    todo_path = tmp_path / "TODO.md"
    todo_path.write_text(TODO_FIXTURE, encoding="utf-8")
    compliance_path = tmp_path / "compliance.md"
    compliance_path.write_text(COMPLIANCE_FIXTURE, encoding="utf-8")
    monkeypatch.setattr(jira_sync, "TODO_PATH", todo_path)
    monkeypatch.setattr(jira_sync, "COMPLIANCE_PATH", compliance_path)
    return todo_path, compliance_path


def make_config(**overrides) -> jira_sync.JiraConfig:
    base = dict(
        base_url="https://example.atlassian.net",
        email="bot@example.com",
        api_token="token123",
        project_key="SRT",
        assignee_kevin="kevin-account-id",
        assignee_claude="claude-account-id",
        actor="claude",
    )
    base.update(overrides)
    return jira_sync.JiraConfig(**base)


class FakeJiraClient:
    """Records every call instead of hitting the network. Tests configure
    canned responses on the instance before it's used by patching the
    class-level `next_instance` factory or by grabbing `created[0]` etc."""

    created: list["FakeJiraClient"] = []

    def __init__(self, config, dry_run=False):
        self.config = config
        self.dry_run = dry_run
        self.calls: list[tuple] = []
        self.epics: dict[str, dict] = {}
        self.search_results: list[dict] = []
        self._issue_counter = 100
        FakeJiraClient.created.append(self)

    def get_project_statuses(self, project_key):
        self.calls.append(("get_project_statuses", project_key))
        return {"To Do", "In Progress", "Blocked", "Done"}

    def find_issue_by_summary(self, project_key, issue_type, summary):
        self.calls.append(("find_issue_by_summary", issue_type, summary))
        return self.epics.get(summary)

    def create_issue(self, fields):
        self.calls.append(("create_issue", dict(fields)))
        self._issue_counter += 1
        key = f"SRT-{self._issue_counter}"
        return {"key": key}

    def get_transitions(self, key):
        self.calls.append(("get_transitions", key))
        return [
            {"id": "11", "name": "To Do"},
            {"id": "21", "name": "In Progress"},
            {"id": "31", "name": "Blocked"},
            {"id": "41", "name": "Done"},
        ]

    def transition_issue(self, key, status_name):
        self.calls.append(("transition_issue", key, status_name))

    def add_comment(self, key, text):
        self.calls.append(("add_comment", key, text))

    def add_labels(self, key, labels):
        self.calls.append(("add_labels", key, labels))

    def assign_issue(self, key, account_id):
        self.calls.append(("assign_issue", key, account_id))

    def search_issues(self, jql, fields=None):
        self.calls.append(("search_issues", jql))
        return self.search_results


@pytest.fixture()
def fake_client(monkeypatch):
    FakeJiraClient.created = []
    monkeypatch.setattr(jira_sync, "JiraClient", FakeJiraClient)
    return FakeJiraClient


# ---------------------------------------------------------------------
# Markdown parsing
# ---------------------------------------------------------------------


def test_parses_items_owners_and_keys():
    doc = jira_sync.TodoDoc.parse(TODO_FIXTURE)
    assert set(doc.items) == {"A1", "A2", "A3", "B1"}
    assert doc.items["A1"].owner == "claude"
    assert doc.items["A1"].jira_key is None
    assert doc.items["A1"].done is False
    assert doc.items["A2"].owner == "kevin"
    assert doc.items["A2"].jira_key == "SRT-5"
    assert doc.items["A2"].done is True
    assert doc.items["A3"].jira_key == "SRT-9"
    assert doc.items["A3"].done is False
    assert doc.items["A1"].section == "A"
    assert doc.items["B1"].section == "B"


def test_parses_questionnaire_status_and_keys():
    doc = jira_sync.ComplianceDoc.parse(COMPLIANCE_FIXTURE)
    assert doc.questions["Q1"].status == "ready"
    assert doc.questions["Q1"].jira_key is None
    assert doc.questions["Q2"].status == "needs-kevin"
    assert doc.questions["Q3"].status == "blocked-deploy"
    assert doc.questions["Q3"].jira_key == "SRT-40"


def test_first_sentence_trims_bold_title():
    assert jira_sync.first_sentence("Production deploy of this branch.") == "Production deploy of this branch"
    assert jira_sync.first_sentence("Kevin-only inputs for the questionnaire:") == "Kevin-only inputs for the questionnaire:"


# ---------------------------------------------------------------------
# Key write-back
# ---------------------------------------------------------------------


def test_set_jira_key_is_idempotent():
    doc = jira_sync.TodoDoc.parse(TODO_FIXTURE)
    doc.set_jira_key("A1", "SRT-100")
    assert doc.items["A1"].jira_key == "SRT-100"
    assert doc.lines[doc.items["A1"].line_no].endswith("(SRT-100)")

    # Re-running must not append a second key.
    doc.set_jira_key("A1", "SRT-999")
    assert doc.items["A1"].jira_key == "SRT-100"
    assert doc.lines[doc.items["A1"].line_no].count("(SRT-100)") == 1
    assert "SRT-999" not in doc.lines[doc.items["A1"].line_no]


def test_compliance_set_jira_key_is_idempotent():
    doc = jira_sync.ComplianceDoc.parse(COMPLIANCE_FIXTURE)
    doc.set_jira_key("Q1", "SRT-77")
    assert doc.questions["Q1"].raw_status_line == "Status: ready Jira: SRT-77"
    doc.set_jira_key("Q1", "SRT-88")
    assert doc.questions["Q1"].jira_key == "SRT-77"


# ---------------------------------------------------------------------
# done / status ticking
# ---------------------------------------------------------------------


def test_mark_done_and_undone_round_trip():
    doc = jira_sync.TodoDoc.parse(TODO_FIXTURE)
    doc.mark_done("A1", "(done 2026-09-06, abc1234)")
    line = doc.lines[doc.items["A1"].line_no]
    assert line.startswith("- [x]")
    assert line.endswith("(done 2026-09-06, abc1234)")

    doc.mark_undone("A1")
    line = doc.lines[doc.items["A1"].line_no]
    assert line.startswith("- [ ]")
    assert "(done" not in line


def test_done_command_ticks_todo_and_transitions(fixtures, fake_client):
    args = argparse.Namespace(item_id="A3", commit="abc1234", dry_run=False)
    config = make_config()
    jira_sync.cmd_done(args, config)

    saved = jira_sync.TODO_PATH.read_text(encoding="utf-8")
    assert "- [x] **A3." in saved
    assert "(done " in saved
    assert "abc1234" in saved

    client = FakeJiraClient.created[-1]
    kinds = [c[0] for c in client.calls]
    assert "transition_issue" in kinds
    assert client.calls[kinds.index("transition_issue")] == ("transition_issue", "SRT-9", "Done")
    assert any(c[0] == "add_comment" and "abc1234" in c[2] for c in client.calls)


def test_done_command_on_question_sets_submitted(fixtures, fake_client):
    args = argparse.Namespace(item_id="Q3", commit=None, dry_run=False)
    config = make_config()
    jira_sync.cmd_done(args, config)

    saved = jira_sync.COMPLIANCE_PATH.read_text(encoding="utf-8")
    assert "Status: submitted Jira: SRT-40" in saved

    client = FakeJiraClient.created[-1]
    assert ("transition_issue", "SRT-40", "Done") in client.calls


def test_status_command_maps_and_transitions(fixtures, fake_client):
    args = argparse.Namespace(item_id="Q3", status="ready", dry_run=False)
    config = make_config()
    jira_sync.cmd_status(args, config)

    saved = jira_sync.COMPLIANCE_PATH.read_text(encoding="utf-8")
    assert "Status: ready Jira: SRT-40" in saved

    client = FakeJiraClient.created[-1]
    assert ("transition_issue", "SRT-40", "In Progress") in client.calls
    assert ("add_labels", "SRT-40", ["ready-to-paste"]) in client.calls


@pytest.mark.parametrize(
    "status,expected_transition,expected_labels",
    [
        ("ready", "In Progress", ["ready-to-paste"]),
        ("needs-kevin", "To Do", []),
        ("blocked-deploy", "Blocked", []),
    ],
)
def test_questionnaire_status_mapping_table(status, expected_transition, expected_labels):
    transition, labels = jira_sync.QUESTION_STATUS_TO_JIRA[status]
    assert transition == expected_transition
    assert labels == expected_labels


# ---------------------------------------------------------------------
# start / block
# ---------------------------------------------------------------------


def test_start_transitions_and_comments(fixtures, fake_client):
    args = argparse.Namespace(item_id="A3", dry_run=False)
    config = make_config(actor="claude")
    jira_sync.cmd_start(args, config)

    client = FakeJiraClient.created[-1]
    assert ("transition_issue", "SRT-9", "In Progress") in client.calls
    assert any(c[0] == "add_comment" and c[1] == "SRT-9" and "Started by claude" in c[2] for c in client.calls)


def test_block_transitions_with_reason(fixtures, fake_client):
    args = argparse.Namespace(item_id="A3", reason="Waiting on Kevin", dry_run=False)
    config = make_config()
    jira_sync.cmd_block(args, config)

    client = FakeJiraClient.created[-1]
    assert ("transition_issue", "SRT-9", "Blocked") in client.calls
    assert ("add_comment", "SRT-9", "Waiting on Kevin") in client.calls


def test_start_without_key_errors(fixtures, fake_client):
    args = argparse.Namespace(item_id="A1", dry_run=False)
    config = make_config()
    with pytest.raises(jira_sync.JiraSyncError):
        jira_sync.cmd_start(args, config)
    # No client should even have been constructed for an item with no key.
    assert FakeJiraClient.created == []


# ---------------------------------------------------------------------
# dry-run: no writes, no network
# ---------------------------------------------------------------------


def test_dry_run_start_makes_no_writes_or_network_calls(fixtures, fake_client):
    before = jira_sync.TODO_PATH.read_text(encoding="utf-8")
    args = argparse.Namespace(item_id="A3", dry_run=True)
    config = make_config()
    jira_sync.cmd_start(args, config)
    after = jira_sync.TODO_PATH.read_text(encoding="utf-8")
    assert before == after
    assert FakeJiraClient.created == []


def test_dry_run_done_makes_no_writes_or_network_calls(fixtures, fake_client):
    before_todo = jira_sync.TODO_PATH.read_text(encoding="utf-8")
    before_compliance = jira_sync.COMPLIANCE_PATH.read_text(encoding="utf-8")
    args = argparse.Namespace(item_id="A3", commit="abc1234", dry_run=True)
    config = make_config()
    jira_sync.cmd_done(args, config)
    assert jira_sync.TODO_PATH.read_text(encoding="utf-8") == before_todo
    assert jira_sync.COMPLIANCE_PATH.read_text(encoding="utf-8") == before_compliance
    assert FakeJiraClient.created == []


def test_dry_run_bootstrap_creates_nothing(fixtures, fake_client):
    before = jira_sync.TODO_PATH.read_text(encoding="utf-8")
    args = argparse.Namespace(dry_run=True)
    config = make_config()
    jira_sync.cmd_bootstrap(args, config)
    after = jira_sync.TODO_PATH.read_text(encoding="utf-8")
    assert before == after
    # A client object is constructed by cmd_bootstrap but none of its
    # network methods should have been invoked while dry_run is set.
    for client in FakeJiraClient.created:
        assert client.calls == []


def test_dry_run_works_without_any_jira_env(fixtures, fake_client):
    """No .jira.env at all (base_url/email/token all None) must still let
    --dry-run commands run end to end, since no Jira project exists yet."""
    config = jira_sync.JiraConfig()
    assert config.is_live() is False
    args = argparse.Namespace(item_id="A3", dry_run=True)
    jira_sync.cmd_start(args, config)  # must not raise
    assert FakeJiraClient.created == []


# ---------------------------------------------------------------------
# bootstrap: idempotency and epic/task creation
# ---------------------------------------------------------------------


def test_bootstrap_creates_only_missing_items_and_writes_keys(fixtures, fake_client):
    args = argparse.Namespace(dry_run=False)
    config = make_config()
    jira_sync.cmd_bootstrap(args, config)

    saved = jira_sync.TODO_PATH.read_text(encoding="utf-8")
    doc = jira_sync.TodoDoc.parse(saved)
    # A1 and B1 had no key and must now have one; A2/A3 already had keys
    # and must be untouched.
    assert doc.items["A1"].jira_key is not None
    assert doc.items["B1"].jira_key is not None
    assert doc.items["A2"].jira_key == "SRT-5"
    assert doc.items["A3"].jira_key == "SRT-9"

    client = FakeJiraClient.created[-1]
    create_calls = [c for c in client.calls if c[0] == "create_issue"]
    # 2 epics (A, B) + 1 questionnaire epic + 2 tasks (A1, B1) + 2 question
    # tasks (Q1, Q2; Q3 already has a key) = 7 create_issue calls.
    assert len(create_calls) == 7


def test_bootstrap_is_idempotent_on_rerun(fixtures, fake_client):
    config = make_config()
    jira_sync.cmd_bootstrap(argparse.Namespace(dry_run=False), config)
    first_saved = jira_sync.TODO_PATH.read_text(encoding="utf-8")

    # Second run: give the fake client the epics it "already created" so it
    # doesn't duplicate them, mirroring a real idempotent Jira project.
    client = FakeJiraClient.created[-1]
    for call in client.calls:
        if call[0] == "create_issue" and call[1].get("issuetype", {}).get("name") == "Epic":
            client.epics[call[1]["summary"]] = {"key": "existing"}

    jira_sync.cmd_bootstrap(argparse.Namespace(dry_run=False), config)
    second_saved = jira_sync.TODO_PATH.read_text(encoding="utf-8")
    assert first_saved == second_saved

    second_client = FakeJiraClient.created[-1]
    task_creates = [c for c in second_client.calls if c[0] == "create_issue" and c[1].get("issuetype", {}).get("name") == "Task"]
    assert task_creates == []


# ---------------------------------------------------------------------
# pull: both directions + issues created directly on the board
# ---------------------------------------------------------------------


def test_pull_ticks_done_and_unticks_reopened(fixtures, fake_client):
    client_holder = {}

    class SeededClient(FakeJiraClient):
        def __init__(self, config, dry_run=False):
            super().__init__(config, dry_run=dry_run)
            self.search_results = [
                {
                    "key": "SRT-5",
                    "fields": {
                        "status": {"name": "To Do"},
                        "labels": [],
                        "issuetype": {"name": "Task"},
                        "summary": "A2. Second item title",
                        "parent": {"key": "EPIC-A"},
                    },
                },
                {
                    "key": "SRT-9",
                    "fields": {
                        "status": {"name": "Done"},
                        "labels": [],
                        "issuetype": {"name": "Task"},
                        "summary": "A3. Third item",
                        "parent": {"key": "EPIC-A"},
                    },
                },
            ]
            client_holder["instance"] = self

    import jira_sync as js

    js.JiraClient = SeededClient
    config = make_config()
    js.cmd_pull(argparse.Namespace(dry_run=False), config)

    saved = js.TODO_PATH.read_text(encoding="utf-8")
    doc = js.TodoDoc.parse(saved)
    assert doc.items["A2"].done is False  # was done, Jira moved back to To Do
    assert doc.items["A3"].done is True  # was open, Jira says Done
    assert "(done via Jira)" in saved


def test_pull_appends_board_only_issue_as_new_item(fixtures, fake_client):
    class SeededClient(FakeJiraClient):
        def __init__(self, config, dry_run=False):
            super().__init__(config, dry_run=dry_run)
            self.search_results = [
                {
                    "key": "EPIC-A",
                    "fields": {
                        "status": {"name": "To Do"},
                        "labels": [],
                        "issuetype": {"name": "Epic"},
                        "summary": "A. Section A heading",
                    },
                },
                {
                    "key": "SRT-500",
                    "fields": {
                        "status": {"name": "To Do"},
                        "labels": [],
                        "issuetype": {"name": "Task"},
                        "summary": "Kevin's new idea from the board",
                        "parent": {"key": "EPIC-A"},
                    },
                },
            ]

    import jira_sync as js

    js.JiraClient = SeededClient
    config = make_config()
    js.cmd_pull(argparse.Namespace(dry_run=False), config)

    saved = js.TODO_PATH.read_text(encoding="utf-8")
    assert "SRT-500" in saved
    assert "Kevin's new idea from the board" in saved
    assert "**A4." in saved  # next free id after A1-A3


def test_pull_dry_run_reads_but_does_not_write(fixtures, fake_client):
    class SeededClient(FakeJiraClient):
        def __init__(self, config, dry_run=False):
            super().__init__(config, dry_run=dry_run)
            self.search_results = [
                {
                    "key": "SRT-9",
                    "fields": {
                        "status": {"name": "Done"},
                        "labels": [],
                        "issuetype": {"name": "Task"},
                        "summary": "A3. Third item",
                        "parent": {"key": "EPIC-A"},
                    },
                }
            ]

    import jira_sync as js

    js.JiraClient = SeededClient
    before = js.TODO_PATH.read_text(encoding="utf-8")
    config = make_config()
    js.cmd_pull(argparse.Namespace(dry_run=True), config)
    after = js.TODO_PATH.read_text(encoding="utf-8")
    assert before == after


def test_pull_offline_without_config_does_not_crash(fixtures, fake_client):
    config = jira_sync.JiraConfig()  # no base_url/email/token
    jira_sync.cmd_pull(argparse.Namespace(dry_run=False), config)  # must not raise
    assert FakeJiraClient.created == []


# ---------------------------------------------------------------------
# list
# ---------------------------------------------------------------------


def test_list_offline_prints_rows_without_network(fixtures, fake_client, capsys):
    config = jira_sync.JiraConfig()
    jira_sync.cmd_list(argparse.Namespace(), config)
    out = capsys.readouterr().out
    assert "offline" in out
    assert "A1" in out
    assert "B1" in out
    assert FakeJiraClient.created == []


def test_list_online_includes_jira_status(fixtures, fake_client, capsys):
    client = fake_client
    client.created = []

    class SeededClient(FakeJiraClient):
        def __init__(self, config, dry_run=False):
            super().__init__(config, dry_run=dry_run)
            self.search_results = [{"key": "SRT-9", "fields": {"status": {"name": "In Progress"}}}]

    import jira_sync as js

    js.JiraClient = SeededClient
    config = make_config()
    js.cmd_list(argparse.Namespace(), config)
    out = capsys.readouterr().out
    assert "In Progress" in out


# ---------------------------------------------------------------------
# config loading
# ---------------------------------------------------------------------


def test_config_load_missing_file_is_offline(tmp_path):
    config = jira_sync.JiraConfig.load(tmp_path / "does-not-exist.env")
    assert config.is_live() is False
    assert config.project_key == "SRT"


def test_config_load_parses_env_file(tmp_path):
    env_file = tmp_path / ".jira.env"
    env_file.write_text(
        "\n".join(
            [
                "JIRA_BASE_URL=https://auriqltd.atlassian.net",
                "JIRA_EMAIL=kevin@example.com",
                "JIRA_API_TOKEN=secret",
                "JIRA_PROJECT_KEY=SRT",
                "JIRA_ASSIGNEE_KEVIN=acc-kevin",
                "JIRA_ASSIGNEE_CLAUDE=acc-claude",
                "# a comment",
                "",
            ]
        ),
        encoding="utf-8",
    )
    config = jira_sync.JiraConfig.load(env_file)
    assert config.is_live() is True
    assert config.base_url == "https://auriqltd.atlassian.net"
    assert config.assignee_kevin == "acc-kevin"


def test_config_actor_selects_claude_credentials_when_set():
    config = make_config(
        actor="claude", claude_email="claude@example.com", claude_api_token="claude-token"
    )
    assert config.auth() == ("claude@example.com", "claude-token")

    config_no_claude_creds = make_config(actor="claude")
    assert config_no_claude_creds.auth() == ("bot@example.com", "token123")
