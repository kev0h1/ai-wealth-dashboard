"""B60: docs/penny/action-inventory.md (the capability matrix) cannot go stale.

Section 1's tool tables must list every read tool in TOOL_SCHEMAS and every
propose tool in PROPOSE_TOOL_NAMES, state the right counts, and list nothing
that is not registered. Section 0 (Kevin's list) must name only registered tools.
"""
import re
from pathlib import Path

from app.services.penny_tools import PROPOSE_TOOL_NAMES, TOOL_SCHEMAS

DOC = Path(__file__).resolve().parents[2] / "docs" / "penny" / "action-inventory.md"


def _section(text: str, start: str, end: str) -> str:
    a = text.index(start)
    return text[a:text.index(end, a)]


def _first_column_names(block: str) -> set[str]:
    names = set()
    for line in block.splitlines():
        m = re.match(r"\|\s*`([a-z_]+)(?:\(|`)", line)
        if m:
            names.add(m.group(1))
    return names


def test_section_one_lists_every_registered_tool_and_nothing_else():
    text = DOC.read_text()
    section = _section(text, "## 1. Penny tool list", "## 2. Cross-reference table")
    listed = _first_column_names(section)
    reads = {t["function"]["name"] for t in TOOL_SCHEMAS}
    assert reads <= listed, f"read tools missing from the matrix: {sorted(reads - listed)}"
    assert set(PROPOSE_TOOL_NAMES) <= listed, f"propose tools missing from the matrix: {sorted(set(PROPOSE_TOOL_NAMES) - listed)}"
    stale = listed - reads - set(PROPOSE_TOOL_NAMES)
    assert not stale, f"the matrix lists tools that are not registered: {sorted(stale)}"


def test_section_one_states_the_real_counts():
    section = _section(DOC.read_text(), "## 1. Penny tool list", "## 2. Cross-reference table")
    assert f"### Read tools, {len(TOOL_SCHEMAS)}," in section
    assert f"### Propose/write tools, {len(PROPOSE_TOOL_NAMES)}," in section


def test_kevins_list_names_only_registered_tools():
    section = _section(DOC.read_text(), "## 0. Kevin's list", "## 1. Penny tool list")
    registered = {t["function"]["name"] for t in TOOL_SCHEMAS} | set(PROPOSE_TOOL_NAMES)
    named = set(re.findall(r"`((?:get|propose|plan)_[a-z_]+)`", section))
    assert named and named <= registered, sorted(named - registered)
    rows = [l for l in section.splitlines() if l.startswith("| ") and not l.startswith("| Capability") and not l.startswith("|---")]
    assert len(rows) == 11


def test_ui_only_section_is_the_doctrine_list():
    text = DOC.read_text()
    section = text[text.index("## 7. UI-only by doctrine"):]
    for needle in ("Delete my account", "Erase data", "Scan a grocery receipt", "Upload a bank statement",
                   "consent", "Confirm or cancel a Penny proposal"):
        assert needle in section
    assert "dark mode" not in section and "Pin cards" not in section
