"""Shared, dependency-light helpers for the G178 Jev-vs-Haiku eval harness.

Nothing in this module imports `app.*` or talks to Mongo/HTTP, on purpose:
`options.py`'s criteria builder, `report.py`'s maths and the state-text
builder here all need to be importable (and unit-testable) with nothing
running -- no Mongo, no API keys, no network. The scripts that DO need
those things (`dataset.py`, `run_jev.py`, `run_haiku.py`) import `app.*`
lazily, after calling `load_real_env()` below.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Iterable, Iterator

# The real backend .env lives in the shared tree, never in this worktree
# (backend/.env is gitignored and this worktree was created fresh). Loading
# it explicitly, by absolute path, BEFORE anything imports `app.core.config`
# (which does its own `load_dotenv(dotenv_path=<this-file's-own-backend>/
# .env)`, a no-op here since that file does not exist in the worktree) means
# MONGO_URI / OPENROUTER_API_KEY / TYPESAFE_API_KEY are already in
# os.environ by the time `app.core.config` runs its own load -- `load_dotenv`
# never overwrites an already-set variable, so order is everything and
# nothing here writes to the shared tree, only reads its .env file.
REAL_ENV_PATH = "/root/ai-wealth-dashboard/backend/.env"

OUT_DIR = Path(__file__).resolve().parent / "out"
DATASET_PATH = OUT_DIR / "dataset.jsonl"
JEV_RESULTS_PATH = OUT_DIR / "jev_results.jsonl"
HAIKU_RESULTS_PATH = OUT_DIR / "haiku_results.jsonl"
REPORT_PATH = OUT_DIR / "report.md"

#: Categories the ladder assigns deterministically before tier 2 is ever
#: reached (Pass 2 / 2.6 in categorisation.py -- own-transfer / pot-ledger
#: refinement). Neither the real Haiku prompt (`categorise_others_bg`'s
#: `cat_list`) nor this eval's Jev criteria offer these as choices, so a
#: judge is never asked to guess at something the deterministic tier
#: already owns. Kept here (not duplicated per-script) so dataset scoring,
#: options and both runners agree on exactly one list.
EXCLUDED_FROM_CHOICE = frozenset({"Transfer", "Savings", "Debt", "Investment"})


def results_path(kind: str, variant: str) -> Path:
    """Result file for a runner ("jev" or "haiku") and variant. For
    v0_baseline, if the legacy un-suffixed file exists and the new name
    does not, copy it first so earlier runs are reused and no spend repeats."""
    legacy = JEV_RESULTS_PATH if kind == "jev" else HAIKU_RESULTS_PATH
    path = OUT_DIR / f"{kind}_results.{variant}.jsonl"
    if variant == "v0_baseline" and legacy.exists() and not path.exists():
        import shutil
        shutil.copyfile(legacy, path)
    return path


def flag_value(rest: list[str], name: str, default: str) -> str:
    """Value following `name` in an argv remainder, else `default`."""
    if name in rest:
        i = rest.index(name)
        if i + 1 >= len(rest):
            raise SystemExit(f"{name} needs a value")
        return rest[i + 1]
    return default


def load_real_env() -> None:
    """Load the real backend/.env from the shared tree, read-only.

    Call this BEFORE any `from app... import ...`. Idempotent -- safe to
    call more than once (python-dotenv's `load_dotenv` re-reads the file but
    still never overwrites an already-set env var).
    """
    from dotenv import load_dotenv
    load_dotenv(REAL_ENV_PATH)


def ensure_out_dir() -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    return OUT_DIR


def uid_hash(uid: str) -> str:
    """sha256 hex digest of a real uid/email. Never store the uid itself in
    any file under `out/` -- this is the one-way function that lets the
    dataset carry a stable per-user grouping key without carrying the email
    itself. `out/` scripts that need the REAL uid back (to query
    `get_category_kinds`, a user's own custom categories, etc.) rebuild the
    hash -> uid map in memory at run time from a live `distinct("user_id")`
    query (see `dataset.py`/`run_jev.py`'s `build_uid_hash_lookup`); that map
    is never written to disk.
    """
    return hashlib.sha256(uid.encode("utf-8")).hexdigest()


def row_id(scope: str, uid_hash_value: str, merchant_key: str) -> str:
    """The stable identity of one dataset row, used as the resume key in
    both results files. `uid_hash_value` is empty string for scope="global"
    rows (see dataset.py), so this still uniquely identifies a row: a global
    and a user row can share a merchant_key without colliding because their
    uid_hash differs (a global row's is always "")."""
    return f"{scope}:{uid_hash_value}:{merchant_key}"


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            out.append(json.loads(line))
    return out


def iter_jsonl(path: Path) -> Iterator[dict]:
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                yield json.loads(line)


def append_jsonl(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, default=str) + "\n")


def write_jsonl(path: Path, records: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for rec in records:
            fh.write(json.dumps(rec, default=str) + "\n")


def existing_row_ids(results_path: Path) -> set[str]:
    """Row ids already present in a results file -- the resume set."""
    return {rec["row_id"] for rec in iter_jsonl(results_path) if "row_id" in rec}


def build_state_text(merchant_key: str, examples: list[dict]) -> str:
    """The `state` text handed to Jev (and, in equivalent form, folded into
    the Haiku prompt) for one dataset row.

    Every example line carries its direction word ("debit"/"credit")
    explicitly -- ENGINE.md's tier-2 rule ("amounts are ABSOLUTE and
    transaction_type carries direction ... a debit can never be Income,
    whatever the text says") means the direction can never be left for the
    model to infer from the amount sign or the text alone.
    """
    lines = [f"Merchant identity key: {merchant_key}", "", "Example transaction lines:"]
    if not examples:
        lines.append("(no example transaction lines survive for this merchant key)")
    for i, ex in enumerate(examples, 1):
        direction = "debit" if ex.get("direction") == "debit" else "credit"
        subtype = ex.get("subtype") or "unknown account type"
        amount = ex.get("amount")
        amount_str = f"£{amount:.2f}" if isinstance(amount, (int, float)) else "£?"
        desc = ex.get("description") or "(no description)"
        lines.append(f"{i}. [{direction}, {amount_str}, account: {subtype}] {desc}")
    return "\n".join(lines)


def print_err(msg: str) -> None:
    print(msg, file=sys.stderr)


def parse_common_args(argv: list[str]) -> dict[str, Any]:
    """Tiny shared flag parser (`--limit N`, `--dry-run`) -- avoids pulling
    in argparse boilerplate identically into both runners. Unknown flags are
    passed through untouched in `rest` for a caller to parse further."""
    limit: int | None = None
    dry_run = False
    confirm_full_run = False
    rest: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--limit":
            i += 1
            limit = int(argv[i])
        elif a == "--dry-run":
            dry_run = True
        elif a == "--confirm-full-run":
            confirm_full_run = True
        else:
            rest.append(a)
        i += 1
    return {"limit": limit, "dry_run": dry_run, "confirm_full_run": confirm_full_run, "rest": rest}
