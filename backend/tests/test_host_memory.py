"""H95: scripts/host_memory.py is read-only and its gate is honest."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "host_memory.py"
spec = importlib.util.spec_from_file_location("host_memory_under_test", SCRIPT)
hm = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = hm
spec.loader.exec_module(hm)


def test_available_mb_prefers_memavailable(tmp_path):
    f = tmp_path / "meminfo"
    f.write_text("MemTotal: 8192000 kB\nMemFree: 100 kB\nMemAvailable: 2048000 kB\nCached: 5 kB\n")
    assert hm.available_mb(f) == 2000


def test_available_mb_falls_back_to_free_plus_cached(tmp_path):
    f = tmp_path / "meminfo"
    f.write_text("MemTotal: 8192000 kB\nMemFree: 1024000 kB\nCached: 1024000 kB\n")
    assert hm.available_mb(f) == 2000


def test_require_available_message_and_pass():
    with pytest.raises(hm.MemoryGateError, match=r"refusing to run the suite: 900 MB available, need 1500 MB"):
        hm.require_available(1500, "the suite", avail=900)
    assert hm.require_available(1500, "the suite", avail=1500) == 1500


def test_main_require_exit_codes(capsys):
    assert hm.main(["--require", "1"]) == 0
    assert hm.main(["--require", "99999999"]) == 1
    assert "refusing to run" in capsys.readouterr().err


def test_report_and_stale_listing_run_and_kill_nothing(capsys, monkeypatch):
    killed = []
    monkeypatch.setattr(hm.os, "kill", lambda *a: killed.append(a))
    assert hm.main(["--top", "3"]) == 0
    assert hm.main(["--stale-sessions", "1"]) == 0
    assert killed == []
    assert "Nothing was killed" in capsys.readouterr().out
