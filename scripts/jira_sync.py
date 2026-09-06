#!/usr/bin/env python3
"""Two-way sync between TODO.md / the Finexer questionnaire doc and a Jira
Cloud Kanban board.

The markdown files stay the source of truth for *content* (what an item
says); Jira is the board for *workflow* (To Do / In Progress / Blocked /
Done, who owns it, comments). This script is the only thing that should
write a `(SRT-12)` key or a `Jira: SRT-40` tag into the markdown, and the
only thing that should create or transition issues on the board — run it
instead of editing one side by hand.

Run with `backend/.venv/bin/python scripts/jira_sync.py <command> ...`.
See docs/ops/JIRA.md for the one-time Jira setup and full command
reference. Every command works with `--dry-run` and without a configured
`.jira.env` (no real Jira project exists yet), which is what the test
suite in scripts/tests/test_jira_sync.py exercises.
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Optional

import httpx

REPO_ROOT = Path(__file__).resolve().parents[1]
TODO_PATH = REPO_ROOT / "TODO.md"
COMPLIANCE_PATH = REPO_ROOT / "docs" / "compliance" / "finexer-agent-controls-2026-09.md"
JIRA_ENV_PATH = REPO_ROOT / ".jira.env"

DEFAULT_PROJECT_KEY = "SRT"
STATUSES = ("To Do", "In Progress", "Blocked", "Done")

# Section letters A..H map 1:1 to the `## <letter>. <heading>` headings in
# TODO.md; used only to build display names, not to validate the file.
SECTION_HEADING_RE = re.compile(r"^## ([A-H])\. (.+)$")
ITEM_RE = re.compile(
    r"^(?P<prefix>- \[(?P<check>[ xX])\] \*\*(?P<id>[A-H]\d+)\.\s*(?P<title>[^*]*)\*\*)"
    r"(?P<tail>.*)$"
)
OWNER_RE = re.compile(r"\[owner:\s*(kevin|claude)\]")
KEY_RE = re.compile(r"\(([A-Z][A-Z0-9]*-\d+)\)")
DONE_SUFFIX_RE = re.compile(r"\s*\(done[^)]*\)\s*$")

QUESTION_HEADING_RE = re.compile(r"^## (Q\d+) (.+)$")
STATUS_LINE_RE = re.compile(
    r"^Status:\s*(ready|needs-kevin|blocked-deploy|submitted)"
    r"(?:\s+Jira:\s*([A-Z][A-Z0-9]*-\d+))?\s*$"
)

QUESTION_STATUS_TO_JIRA = {
    "ready": ("In Progress", ["ready-to-paste"]),
    "needs-kevin": ("To Do", []),
    "blocked-deploy": ("Blocked", []),
}


class JiraSyncError(RuntimeError):
    """Raised for any user-facing failure; main() prints it and exits 1."""


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------


@dataclass
class JiraConfig:
    base_url: Optional[str] = None
    email: Optional[str] = None
    api_token: Optional[str] = None
    project_key: str = DEFAULT_PROJECT_KEY
    assignee_kevin: Optional[str] = None
    assignee_claude: Optional[str] = None
    actor: str = "claude"
    claude_email: Optional[str] = None
    claude_api_token: Optional[str] = None

    @classmethod
    def load(cls, path: Path = JIRA_ENV_PATH) -> "JiraConfig":
        values: dict[str, str] = {}
        if path.is_file():
            for raw_line in path.read_text(encoding="utf-8").splitlines():
                stripped = raw_line.strip()
                if not stripped or stripped.startswith("#") or "=" not in stripped:
                    continue
                key, _, value = stripped.partition("=")
                values[key.strip()] = value.strip().strip('"').strip("'")
        return cls(
            base_url=values.get("JIRA_BASE_URL") or None,
            email=values.get("JIRA_EMAIL") or None,
            api_token=values.get("JIRA_API_TOKEN") or None,
            project_key=values.get("JIRA_PROJECT_KEY") or DEFAULT_PROJECT_KEY,
            assignee_kevin=values.get("JIRA_ASSIGNEE_KEVIN") or None,
            assignee_claude=values.get("JIRA_ASSIGNEE_CLAUDE") or None,
            actor=(values.get("JIRA_ACTOR") or "claude").strip().lower(),
            claude_email=values.get("JIRA_CLAUDE_EMAIL") or None,
            claude_api_token=values.get("JIRA_CLAUDE_API_TOKEN") or None,
        )

    def is_live(self) -> bool:
        return bool(self.base_url and self.email and self.api_token)

    def require_live(self) -> None:
        if not self.is_live():
            raise JiraSyncError(
                "No .jira.env (or it is missing JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN). "
                "Copy .jira.env.example to .jira.env and fill it in, or pass --dry-run."
            )

    def auth(self) -> tuple[str, str]:
        """Email/token pair to authenticate with, honouring JIRA_ACTOR so
        transitions Claude makes are attributed to a separate Claude user
        when Kevin has set one up."""
        if self.actor == "claude" and self.claude_email and self.claude_api_token:
            return self.claude_email, self.claude_api_token
        return self.email or "", self.api_token or ""

    def assignee_for_owner(self, owner: Optional[str]) -> Optional[str]:
        if owner == "kevin":
            return self.assignee_kevin
        if owner == "claude":
            return self.assignee_claude
        return None


# --------------------------------------------------------------------------
# Jira HTTP client — the only thing that talks to the network. Tests mock
# this class entirely, so its public methods are the sync surface.
# --------------------------------------------------------------------------


class JiraClient:
    def __init__(self, config: JiraConfig, dry_run: bool = False):
        self.config = config
        self.dry_run = dry_run
        self._http: Optional[httpx.Client] = None

    def _client(self) -> httpx.Client:
        if self._http is None:
            if not self.config.is_live():
                raise JiraSyncError("Jira is not configured; cannot make a live API call.")
            self._http = httpx.Client(
                base_url=self.config.base_url.rstrip("/"),
                auth=self.config.auth(),
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                timeout=30.0,
            )
        return self._http

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            resp = self._client().request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise JiraSyncError(f"Jira request failed: {method} {path}: {exc}") from exc
        if resp.status_code >= 400:
            raise JiraSyncError(
                f"Jira API error {resp.status_code} on {method} {path}: {resp.text[:500]}"
            )
        if not resp.content:
            return None
        return resp.json()

    # -- read ---------------------------------------------------------

    def search_issues(self, jql: str, fields: Optional[list[str]] = None) -> list[dict]:
        payload = {"jql": jql, "maxResults": 100, "fields": fields or ["summary", "status", "labels"]}
        data = self._request("POST", "/rest/api/3/search", json=payload)
        return data.get("issues", []) if data else []

    def find_issue_by_summary(self, project_key: str, issue_type: str, summary: str) -> Optional[dict]:
        escaped = summary.replace('"', '\\"')
        jql = f'project = {project_key} AND issuetype = "{issue_type}" AND summary ~ "{escaped}"'
        for issue in self.search_issues(jql):
            if issue.get("fields", {}).get("summary") == summary:
                return issue
        return None

    def get_issue(self, key: str) -> dict:
        return self._request("GET", f"/rest/api/3/issue/{key}")

    def get_transitions(self, key: str) -> list[dict]:
        data = self._request("GET", f"/rest/api/3/issue/{key}/transitions")
        return data.get("transitions", []) if data else []

    def get_project_statuses(self, project_key: str) -> set[str]:
        data = self._request("GET", f"/rest/api/3/project/{project_key}/statuses")
        names: set[str] = set()
        for issue_type in data or []:
            for status in issue_type.get("statuses", []):
                names.add(status.get("name"))
        return names

    # -- write ----------------------------------------------------------

    def create_issue(self, fields: dict) -> dict:
        data = self._request("POST", "/rest/api/3/issue", json={"fields": fields})
        return data

    def transition_issue(self, key: str, status_name: str) -> None:
        transitions = self.get_transitions(key)
        match = next(
            (t for t in transitions if t.get("name", "").lower() == status_name.lower()), None
        )
        if match is None:
            available = ", ".join(t.get("name", "?") for t in transitions)
            raise JiraSyncError(
                f"{key} has no transition named '{status_name}' (available: {available})"
            )
        self._request("POST", f"/rest/api/3/issue/{key}/transitions", json={"transition": {"id": match["id"]}})

    def add_comment(self, key: str, text: str) -> None:
        body = text_to_adf(text)
        self._request("POST", f"/rest/api/3/issue/{key}/comment", json={"body": body})

    def add_labels(self, key: str, labels: list[str]) -> None:
        if not labels:
            return
        self._request(
            "PUT",
            f"/rest/api/3/issue/{key}",
            json={"update": {"labels": [{"add": label} for label in labels]}},
        )

    def assign_issue(self, key: str, account_id: Optional[str]) -> None:
        if not account_id:
            return
        self._request("PUT", f"/rest/api/3/issue/{key}/assignee", json={"accountId": account_id})


def text_to_adf(text: str) -> dict:
    """Plain-paragraph ADF: one paragraph per blank-line-separated block."""
    paragraphs = [p.strip() for p in text.strip().split("\n\n") if p.strip()] or [text.strip()]
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": p}]} for p in paragraphs
        ],
    }


# --------------------------------------------------------------------------
# Markdown model: TODO.md
# --------------------------------------------------------------------------


@dataclass
class TodoItem:
    item_id: str
    section: str
    done: bool
    title: str
    owner: Optional[str]
    jira_key: Optional[str]
    line_no: int
    raw_line: str


@dataclass
class TodoDoc:
    lines: list[str]
    items: dict[str, TodoItem] = field(default_factory=dict)
    section_headings: dict[str, tuple[int, str]] = field(default_factory=dict)  # letter -> (line_no, heading text)

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "TodoDoc":
        # `path` resolves against the module-level TODO_PATH at call time
        # (not as a bound default) so tests can monkeypatch TODO_PATH to a
        # fixture file without touching the real TODO.md.
        return cls.parse((path or TODO_PATH).read_text(encoding="utf-8"))

    @classmethod
    def parse(cls, text: str) -> "TodoDoc":
        lines = text.split("\n")
        doc = cls(lines=lines)
        current_section = ""
        for i, line in enumerate(lines):
            heading = SECTION_HEADING_RE.match(line)
            if heading:
                current_section = heading.group(1)
                doc.section_headings[current_section] = (i, heading.group(2))
                continue
            m = ITEM_RE.match(line)
            if not m:
                continue
            item_id = m.group("id")
            owner_m = OWNER_RE.search(line)
            key_m = KEY_RE.search(line)
            doc.items[item_id] = TodoItem(
                item_id=item_id,
                section=current_section or item_id[0],
                done=m.group("check").lower() == "x",
                title=m.group("title").strip(),
                owner=owner_m.group(1) if owner_m else None,
                jira_key=key_m.group(1) if key_m else None,
                line_no=i,
                raw_line=line,
            )
        return doc

    def text(self) -> str:
        return "\n".join(self.lines)

    def save(self, path: Optional[Path] = None) -> None:
        (path or TODO_PATH).write_text(self.text(), encoding="utf-8")

    def set_jira_key(self, item_id: str, key: str) -> None:
        item = self.items[item_id]
        if item.jira_key:
            return
        self.lines[item.line_no] = f"{self.lines[item.line_no]} ({key})"
        item.jira_key = key
        item.raw_line = self.lines[item.line_no]

    def mark_done(self, item_id: str, suffix: str) -> None:
        item = self.items[item_id]
        line = self.lines[item.line_no]
        line = re.sub(r"^- \[ \]", "- [x]", line, count=1)
        line = f"{line} {suffix}"
        self.lines[item.line_no] = line
        item.done = True
        item.raw_line = line

    def mark_undone(self, item_id: str) -> None:
        item = self.items[item_id]
        line = self.lines[item.line_no]
        line = re.sub(r"^- \[[xX]\]", "- [ ]", line, count=1)
        line = DONE_SUFFIX_RE.sub("", line)
        self.lines[item.line_no] = line
        item.done = False
        item.raw_line = line

    def append_item(self, section: str, line: str) -> None:
        """Insert a new item line at the end of `section`'s item block."""
        if section in self.section_headings:
            heading_line, _ = self.section_headings[section]
            insert_at = heading_line + 1
            # walk forward through the section's existing lines (blank line,
            # then item lines) to find where the block ends.
            i = insert_at
            while i < len(self.lines) and not SECTION_HEADING_RE.match(self.lines[i]):
                i += 1
            # step back over trailing blank lines so the new item sits
            # directly under the last existing item.
            j = i - 1
            while j > insert_at and self.lines[j].strip() == "":
                j -= 1
            self.lines.insert(j + 1, line)
        else:
            self.lines.append("")
            self.lines.append(line)
        # Re-parse to keep item_id -> line_no accurate after the insert.
        reparsed = TodoDoc.parse(self.text())
        self.items = reparsed.items
        self.section_headings = reparsed.section_headings

    def next_item_id(self, section: str) -> str:
        numbers = [int(iid[1:]) for iid in self.items if iid[0] == section]
        return f"{section}{(max(numbers) + 1) if numbers else 1}"


# --------------------------------------------------------------------------
# Markdown model: the questionnaire
# --------------------------------------------------------------------------


@dataclass
class Question:
    q_id: str
    title: str
    status: str
    jira_key: Optional[str]
    status_line_no: int
    heading_line_no: int
    raw_status_line: str

    def body(self, lines: list[str], next_heading_line: int) -> str:
        return "\n".join(lines[self.heading_line_no + 1 : next_heading_line]).strip()


@dataclass
class ComplianceDoc:
    lines: list[str]
    questions: dict[str, Question] = field(default_factory=dict)
    _next_heading: dict[str, int] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "ComplianceDoc":
        # See TodoDoc.load: resolves COMPLIANCE_PATH at call time so tests
        # can monkeypatch it to a fixture file.
        return cls.parse((path or COMPLIANCE_PATH).read_text(encoding="utf-8"))

    @classmethod
    def parse(cls, text: str) -> "ComplianceDoc":
        lines = text.split("\n")
        doc = cls(lines=lines)
        headings: list[tuple[int, str, str]] = []
        for i, line in enumerate(lines):
            m = QUESTION_HEADING_RE.match(line)
            if m:
                headings.append((i, m.group(1), m.group(2).strip()))
        for idx, (heading_line, q_id, title) in enumerate(headings):
            next_line = headings[idx + 1][0] if idx + 1 < len(headings) else len(lines)
            doc._next_heading[q_id] = next_line
            status_line_no = None
            for j in range(heading_line + 1, next_line):
                if STATUS_LINE_RE.match(lines[j]):
                    status_line_no = j
                    break
            if status_line_no is None:
                continue
            sm = STATUS_LINE_RE.match(lines[status_line_no])
            doc.questions[q_id] = Question(
                q_id=q_id,
                title=title,
                status=sm.group(1),
                jira_key=sm.group(2),
                status_line_no=status_line_no,
                heading_line_no=heading_line,
                raw_status_line=lines[status_line_no],
            )
        return doc

    def text(self) -> str:
        return "\n".join(self.lines)

    def save(self, path: Optional[Path] = None) -> None:
        (path or COMPLIANCE_PATH).write_text(self.text(), encoding="utf-8")

    def question_body(self, q_id: str) -> str:
        q = self.questions[q_id]
        end = self._next_heading.get(q_id, len(self.lines))
        return q.body(self.lines, end)

    def _rewrite_status_line(self, q_id: str, status: str, jira_key: Optional[str]) -> None:
        q = self.questions[q_id]
        line = f"Status: {status}"
        if jira_key:
            line = f"{line} Jira: {jira_key}"
        self.lines[q.status_line_no] = line
        q.status = status
        q.jira_key = jira_key
        q.raw_status_line = line

    def set_jira_key(self, q_id: str, key: str) -> None:
        q = self.questions[q_id]
        if q.jira_key:
            return
        self._rewrite_status_line(q_id, q.status, key)

    def set_status(self, q_id: str, status: str) -> None:
        q = self.questions[q_id]
        self._rewrite_status_line(q_id, status, q.jira_key)


# --------------------------------------------------------------------------
# Helpers shared by commands
# --------------------------------------------------------------------------


def first_sentence(text: str) -> str:
    text = text.strip().rstrip(".").strip()
    return text.split(". ")[0].strip()


def find_item_source(item_id: str, todo: TodoDoc, compliance: ComplianceDoc) -> str:
    if re.match(r"^[A-H]\d+$", item_id):
        if item_id not in todo.items:
            raise JiraSyncError(f"{item_id} is not a known TODO.md item.")
        return "todo"
    if re.match(r"^Q\d+$", item_id):
        if item_id not in compliance.questions:
            raise JiraSyncError(f"{item_id} is not a known question in the compliance doc.")
        return "question"
    raise JiraSyncError(f"Unrecognised item id: {item_id}")


def resolve_jira_key(item_id: str, todo: TodoDoc, compliance: ComplianceDoc) -> str:
    source = find_item_source(item_id, todo, compliance)
    key = todo.items[item_id].jira_key if source == "todo" else compliance.questions[item_id].jira_key
    if not key:
        raise JiraSyncError(f"{item_id} has no Jira key yet; run 'bootstrap' first.")
    return key


def today_str() -> str:
    return date.today().isoformat()


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------


def cmd_bootstrap(args: argparse.Namespace, config: JiraConfig) -> None:
    dry_run = args.dry_run
    client = JiraClient(config, dry_run=dry_run)
    todo = TodoDoc.load()
    compliance = ComplianceDoc.load()

    if not dry_run:
        config.require_live()
        existing_statuses = client.get_project_statuses(config.project_key)
        for status in STATUSES:
            if status not in existing_statuses:
                print(
                    f"MANUAL STEP: project {config.project_key} is missing workflow status "
                    f"'{status}'. Add it in Jira admin (Project settings > Statuses/Workflow)."
                )

    epic_keys: dict[str, str] = {}
    section_names = {
        letter: heading for letter, (_, heading) in todo.section_headings.items()
    }
    section_names["Q"] = "Finexer questionnaire"

    for letter, heading in section_names.items():
        epic_name = heading if letter == "Q" else f"{letter}. {heading}"
        if dry_run:
            print(f"[dry-run] would ensure epic exists: {epic_name!r}")
            epic_keys[letter] = f"DRYRUN-EPIC-{letter}"
            continue
        existing = client.find_issue_by_summary(config.project_key, "Epic", epic_name)
        if existing:
            epic_keys[letter] = existing["key"]
            print(f"Epic already exists for section {letter}: {existing['key']}")
        else:
            created = client.create_issue(
                {
                    "project": {"key": config.project_key},
                    "issuetype": {"name": "Epic"},
                    "summary": epic_name,
                }
            )
            epic_keys[letter] = created["key"]
            print(f"Created epic for section {letter}: {created['key']} ({epic_name})")

    created_count = 0
    for item_id, item in sorted(todo.items.items()):
        if item.jira_key:
            print(f"{item_id} already has {item.jira_key}, skipping")
            continue
        summary = f"{item_id}. {first_sentence(item.title)}"
        labels = [f"section-{item.section.lower()}", f"owner-{item.owner or 'claude'}"]
        if dry_run:
            print(f"[dry-run] would create Task {summary!r} labels={labels}")
            continue
        fields = {
            "project": {"key": config.project_key},
            "issuetype": {"name": "Task"},
            "summary": summary,
            "description": text_to_adf(item.raw_line),
            "labels": labels,
            "parent": {"key": epic_keys.get(item.section, epic_keys.get("Q"))},
        }
        assignee = config.assignee_for_owner(item.owner)
        if assignee:
            fields["assignee"] = {"accountId": assignee}
        created = client.create_issue(fields)
        todo.set_jira_key(item_id, created["key"])
        created_count += 1
        print(f"Created {created['key']} for {item_id}: {summary}")

    for q_id, question in sorted(compliance.questions.items()):
        if question.jira_key:
            print(f"{q_id} already has {question.jira_key}, skipping")
            continue
        summary = f"{q_id}. {question.title}"
        status_name, extra_labels = QUESTION_STATUS_TO_JIRA.get(question.status, ("To Do", []))
        if dry_run:
            print(f"[dry-run] would create Task {summary!r} -> status {status_name}")
            continue
        fields = {
            "project": {"key": config.project_key},
            "issuetype": {"name": "Task"},
            "summary": summary,
            "description": text_to_adf(compliance.question_body(q_id)),
            "labels": extra_labels,
            "parent": {"key": epic_keys.get("Q")},
        }
        if question.status == "needs-kevin" and config.assignee_kevin:
            fields["assignee"] = {"accountId": config.assignee_kevin}
        created = client.create_issue(fields)
        if status_name != "To Do":
            client.transition_issue(created["key"], status_name)
        compliance.set_jira_key(q_id, created["key"])
        created_count += 1
        print(f"Created {created['key']} for {q_id}: {summary} (-> {status_name})")

    if dry_run:
        print("[dry-run] no files written, no issues created.")
        return

    if created_count:
        todo.save()
        compliance.save()
        print(f"Wrote {created_count} new Jira key(s) back into the markdown.")
    else:
        print("Nothing new to create; bootstrap is idempotent.")


def cmd_start(args: argparse.Namespace, config: JiraConfig) -> None:
    todo = TodoDoc.load()
    compliance = ComplianceDoc.load()
    key = resolve_jira_key(args.item_id, todo, compliance)
    comment = f"Started by {config.actor} on {today_str()}"
    if args.dry_run:
        print(f"[dry-run] would transition {key} -> In Progress and comment: {comment!r}")
        return
    config.require_live()
    client = JiraClient(config)
    client.transition_issue(key, "In Progress")
    client.add_comment(key, comment)
    print(f"{key} ({args.item_id}) -> In Progress. Comment added.")


def cmd_block(args: argparse.Namespace, config: JiraConfig) -> None:
    todo = TodoDoc.load()
    compliance = ComplianceDoc.load()
    key = resolve_jira_key(args.item_id, todo, compliance)
    if args.dry_run:
        print(f"[dry-run] would transition {key} -> Blocked and comment: {args.reason!r}")
        return
    config.require_live()
    client = JiraClient(config)
    client.transition_issue(key, "Blocked")
    client.add_comment(key, args.reason)
    print(f"{key} ({args.item_id}) -> Blocked. Comment added: {args.reason!r}")


def cmd_done(args: argparse.Namespace, config: JiraConfig) -> None:
    todo = TodoDoc.load()
    compliance = ComplianceDoc.load()
    source = find_item_source(args.item_id, todo, compliance)
    key = resolve_jira_key(args.item_id, todo, compliance)
    commit_note = f", {args.commit}" if args.commit else ""

    if source == "todo":
        suffix = f"(done {today_str()}{commit_note})"
        comment = f"Done by {config.actor} on {today_str()}" + (
            f", commit {args.commit}" if args.commit else " (no commit hash given)"
        )
        if args.dry_run:
            print(f"[dry-run] would tick {args.item_id}, append {suffix!r}, transition {key} -> Done")
            return
        config.require_live()
        client = JiraClient(config)
        client.transition_issue(key, "Done")
        client.add_comment(key, comment)
        todo.mark_done(args.item_id, suffix)
        todo.save()
        print(f"{args.item_id} ticked ({suffix}); {key} -> Done.")
    else:
        comment = f"Done by {config.actor} on {today_str()}" + (
            f", commit {args.commit}" if args.commit else " (no commit hash given)"
        )
        if args.dry_run:
            print(f"[dry-run] would set {args.item_id} Status: submitted, transition {key} -> Done")
            return
        config.require_live()
        client = JiraClient(config)
        client.transition_issue(key, "Done")
        client.add_comment(key, comment)
        compliance.set_status(args.item_id, "submitted")
        compliance.save()
        print(f"{args.item_id} Status set to submitted; {key} -> Done.")


def cmd_status(args: argparse.Namespace, config: JiraConfig) -> None:
    todo = TodoDoc.load()
    compliance = ComplianceDoc.load()
    if not re.match(r"^Q\d+$", args.item_id):
        raise JiraSyncError("status is only for questions (Q1, Q2, ...).")
    key = resolve_jira_key(args.item_id, todo, compliance)
    status_name, labels = QUESTION_STATUS_TO_JIRA[args.status]
    if args.dry_run:
        print(f"[dry-run] would set {args.item_id} Status: {args.status}, transition {key} -> {status_name}")
        return
    config.require_live()
    client = JiraClient(config)
    client.transition_issue(key, status_name)
    client.add_labels(key, labels)
    if args.status == "needs-kevin" and config.assignee_kevin:
        client.assign_issue(key, config.assignee_kevin)
    compliance.set_status(args.item_id, args.status)
    compliance.save()
    print(f"{args.item_id} Status set to {args.status}; {key} -> {status_name}.")


def cmd_pull(args: argparse.Namespace, config: JiraConfig) -> None:
    dry_run = args.dry_run
    todo = TodoDoc.load()
    compliance = ComplianceDoc.load()

    if not config.is_live():
        print("No .jira.env configured; nothing to pull (offline).")
        return

    client = JiraClient(config, dry_run=dry_run)
    issues = client.search_issues(
        f"project = {config.project_key}", fields=["summary", "status", "labels", "parent"]
    )
    by_key = {issue["key"]: issue for issue in issues}

    known_keys = {item.jira_key for item in todo.items.values() if item.jira_key}
    known_keys |= {q.jira_key for q in compliance.questions.values() if q.jira_key}

    changes: list[str] = []

    for item_id, item in sorted(todo.items.items()):
        if not item.jira_key or item.jira_key not in by_key:
            continue
        jira_status = by_key[item.jira_key]["fields"]["status"]["name"]
        if jira_status == "Done" and not item.done:
            changes.append(f"{item_id}: Jira is Done, ticking markdown ({item.jira_key})")
            if not dry_run:
                todo.mark_done(item_id, "(done via Jira)")
        elif jira_status == "To Do" and item.done:
            changes.append(f"{item_id}: Jira moved back to To Do, unticking markdown ({item.jira_key})")
            if not dry_run:
                todo.mark_undone(item_id)

    for q_id, question in sorted(compliance.questions.items()):
        if not question.jira_key or question.jira_key not in by_key:
            continue
        jira_status = by_key[question.jira_key]["fields"]["status"]["name"]
        if jira_status == "Done" and question.status != "submitted":
            changes.append(f"{q_id}: Jira is Done, setting Status: submitted ({question.jira_key})")
            if not dry_run:
                compliance.set_status(q_id, "submitted")

    # Issues created directly on the board: under a section epic, not
    # labelled from-jira, and with a key we don't already track.
    epic_to_section: dict[str, str] = {}
    for letter, (_, heading) in todo.section_headings.items():
        epic_name = f"{letter}. {heading}"
        for issue in issues:
            if issue["fields"].get("summary") == epic_name and issue.get("fields", {}).get("issuetype", {}).get("name") == "Epic":
                epic_to_section[issue["key"]] = letter

    for issue in issues:
        key = issue["key"]
        fields = issue.get("fields", {})
        if fields.get("issuetype", {}).get("name") == "Epic":
            continue
        if key in known_keys:
            continue
        if "from-jira" in (fields.get("labels") or []):
            continue
        parent_key = (fields.get("parent") or {}).get("key")
        section = epic_to_section.get(parent_key)
        if not section:
            continue
        new_id = todo.next_item_id(section)
        summary = fields.get("summary", "(no summary)")
        new_line = f"- [ ] **{new_id}. {summary}** [owner: claude] ({key})"
        changes.append(f"New from Jira under section {section}: {new_id} ({key}) - {summary}")
        if not dry_run:
            todo.append_item(section, new_line)
            client.add_labels(key, ["from-jira"])

    if not changes:
        print("Nothing to reconcile; markdown already matches Jira.")
        return

    print(("[dry-run] " if dry_run else "") + "Pull summary:")
    for line in changes:
        print(f"  - {line}")

    if not dry_run:
        todo.save()
        compliance.save()


def cmd_list(args: argparse.Namespace, config: JiraConfig) -> None:
    todo = TodoDoc.load()
    compliance = ComplianceDoc.load()

    live_statuses: dict[str, str] = {}
    if config.is_live():
        try:
            client = JiraClient(config)
            issues = client.search_issues(f"project = {config.project_key}", fields=["status"])
            live_statuses = {issue["key"]: issue["fields"]["status"]["name"] for issue in issues}
        except JiraSyncError as exc:
            print(f"(offline: {exc})")
    else:
        print("(offline: no .jira.env configured)")

    rows: list[tuple[str, str, str, str, str]] = []
    for item_id, item in sorted(todo.items.items()):
        md_status = "done" if item.done else "open"
        jira_status = live_statuses.get(item.jira_key, "-") if item.jira_key else "-"
        rows.append((item_id, item.owner or "-", md_status, item.jira_key or "-", jira_status))
    for q_id, question in sorted(compliance.questions.items()):
        jira_status = live_statuses.get(question.jira_key, "-") if question.jira_key else "-"
        rows.append((q_id, "-", question.status, question.jira_key or "-", jira_status))

    print(f"{'id':<6} {'owner':<7} {'markdown':<12} {'jira_key':<10} {'jira_status':<12}")
    for row in rows:
        print(f"{row[0]:<6} {row[1]:<7} {row[2]:<12} {row[3]:<10} {row[4]:<12}")


# --------------------------------------------------------------------------
# CLI wiring
# --------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="jira_sync.py",
        description=(
            "Two-way sync between TODO.md / the Finexer questionnaire doc and the "
            "Jira Cloud Kanban board for this backlog. See docs/ops/JIRA.md."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_bootstrap = sub.add_parser("bootstrap", help="Create epics/issues for every item lacking a Jira key.")
    p_bootstrap.add_argument("--dry-run", action="store_true")
    p_bootstrap.set_defaults(func=cmd_bootstrap)

    p_start = sub.add_parser("start", help="Transition an item to In Progress.")
    p_start.add_argument("item_id")
    p_start.add_argument("--dry-run", action="store_true")
    p_start.set_defaults(func=cmd_start)

    p_block = sub.add_parser("block", help="Transition an item to Blocked with a reason.")
    p_block.add_argument("item_id")
    p_block.add_argument("reason")
    p_block.add_argument("--dry-run", action="store_true")
    p_block.set_defaults(func=cmd_block)

    p_done = sub.add_parser("done", help="Tick the item / mark a question submitted, and close it on Jira.")
    p_done.add_argument("item_id")
    p_done.add_argument("--commit", default=None)
    p_done.add_argument("--dry-run", action="store_true")
    p_done.set_defaults(func=cmd_done)

    p_status = sub.add_parser("status", help="Set a questionnaire item's status (questions only).")
    p_status.add_argument("item_id")
    p_status.add_argument("status", choices=["ready", "needs-kevin", "blocked-deploy"])
    p_status.add_argument("--dry-run", action="store_true")
    p_status.set_defaults(func=cmd_status)

    p_pull = sub.add_parser("pull", help="Reconcile the markdown from the board's current state.")
    p_pull.add_argument("--dry-run", action="store_true")
    p_pull.set_defaults(func=cmd_pull)

    p_list = sub.add_parser("list", help="Print every item with its owner, markdown status and Jira status.")
    p_list.set_defaults(func=cmd_list)

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    config = JiraConfig.load()
    try:
        args.func(args, config)
    except JiraSyncError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
