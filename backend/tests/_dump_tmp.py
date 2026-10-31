import json, sys, pytest
from pathlib import Path
from tests.test_scenarios import _run_scenario, _json_roundtrip, SCEN_DIR
def test_dump(monkeypatch):
    slug = __import__("os").environ["DUMP"]
    spec = json.loads((SCEN_DIR / f"{slug}.json").read_text())
    snap = _json_roundtrip(_run_scenario(spec, slug, monkeypatch))
    Path("/tmp/h142/dump.json").write_text(json.dumps(snap, indent=1))
