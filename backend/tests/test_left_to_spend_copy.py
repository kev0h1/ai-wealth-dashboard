"""G322 (G321 option B): the backend no longer calls the figure "Safe to
Spend" in user-facing or model-facing text, and the three misleading-as-written
strings are gone.

Identifiers (safe_to_spend keys, get_safe_to_spend, the /safe-to-spend route,
module and function names) are deliberately allowed. Comments and docstrings
are stripped before scanning. Marketing, store listing and video kit files are
outside the backend and owned by G323.
"""
import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"

PHRASES = [
    re.compile(r"safe to spend", re.I),
    re.compile(r"Safe-to-Spend"),
    re.compile(r"safe-to-spend (figure|state|verdict)", re.I),
    re.compile(r"genuinely yours to spend", re.I),
    re.compile(r"not a forecast", re.I),
    re.compile(r"just cruise", re.I),
]


def _strip(src: str) -> str:
    src = re.sub(r'"""[\s\S]*?"""', "", src)
    src = re.sub(r"'''[\s\S]*?'''", "", src)
    src = re.sub(r"^\s*#.*$", "", src, flags=re.M)
    return re.sub(r"\s#\s.*$", "", src, flags=re.M)


def test_no_safe_to_spend_wording_in_backend_text():
    hits = []
    for path in sorted(APP.rglob("*.py")):
        text = _strip(path.read_text(encoding="utf-8"))
        for rx in PHRASES:
            m = rx.search(text)
            if m:
                hits.append(f"{path.relative_to(APP)}: {m.group(0)}")
    assert hits == [], "user-facing Safe to Spend wording remains:\n" + "\n".join(hits)


def test_page_explainer_says_estimate_and_can_be_wrong():
    from app.services import penny_tools

    home = penny_tools._PAGE_EXPLAINER_COPY["home"]
    assert "estimated left to spend" in home
    assert "can be wrong" in home
    assert "not a forecast" not in home
