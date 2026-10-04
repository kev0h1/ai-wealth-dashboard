"""G178 deliverable 3: run the eval dataset through TypeSafe Jev's Choice
primitive (`POST https://api.typesafe.ai/v1/systemone`).

Usage (from backend/):
    .venv/bin/python -m scripts.jev_eval.run_jev --dry-run
    .venv/bin/python -m scripts.jev_eval.run_jev --limit 10
    .venv/bin/python -m scripts.jev_eval.run_jev                 # full 258, resumable

Requires `TYPESAFE_API_KEY` in the shared tree's `backend/.env` for a live
run (not needed for `--dry-run`, which builds request bodies and touches no
network). Exits 2 with a one-line message if the key is absent and a live
run was requested.

Resumable: rows already present in `out/jev_results.jsonl` (matched by
`row_id`) are skipped, so a killed/interrupted run can just be re-invoked.
"""
from __future__ import annotations

import asyncio
import json
import random
import sys
import time

import httpx

from scripts.jev_eval.common import (
    DATASET_PATH, JEV_RESULTS_PATH, append_jsonl, build_state_text,
    ensure_out_dir, existing_row_ids, load_real_env, parse_common_args,
    print_err, read_jsonl, row_id as make_row_id,
)
from scripts.jev_eval import options

JEV_URL = "https://api.typesafe.ai/v1/systemone"
JEV_MODEL = "jev-latest"  # alias; valid ids: jev-1.13.0, jev-latest, jev-preview
MAX_ATTEMPTS = 5
INITIAL_BACKOFF_S = 1.0
MAX_BACKOFF_S = 30.0
RETRY_STATUSES = {429, 529}


def _instructions_text() -> str:
    return (
        "Assign this UK bank merchant to exactly one spending category, based "
        "only on the example transaction lines given in the state above. "
        "A debit (money leaving the account) can never be Income, whatever "
        "the text says -- only ever choose Income for a credit line. If "
        "genuinely nothing fits, choose Other."
    )


def build_request_body(row: dict, kind_map: dict, user_examples: dict | None, model: str = JEV_MODEL) -> dict:
    criteria = options.build_criteria(kind_map, scope=row["scope"], user_examples=user_examples)
    state = build_state_text(row["merchant_key"], row["examples"])
    return {
        "state": state,
        "model": model,
        "questions": {
            "category": {
                "type": "choice",
                "instructions": _instructions_text(),
                "criteria": criteria,
            }
        },
    }


async def _kind_map_and_examples_for(row: dict, uid_lookup: dict[str, str], kind_cache: dict) -> tuple[dict, dict | None]:
    from app.services.categories import BUILTIN_CATEGORY_KINDS, get_category_kinds
    from scripts.jev_eval.mongo_helpers import fetch_user_examples

    if row["scope"] != "user":
        return dict(BUILTIN_CATEGORY_KINDS), None

    real_uid = uid_lookup.get(row["uid_hash"])
    if not real_uid:
        # Should not happen (uid_hash is built from the same
        # transactions.user_id set the lookup indexes) -- fail safe to the
        # built-in-only, no-examples shape rather than crash the run.
        return dict(BUILTIN_CATEGORY_KINDS), None

    if real_uid not in kind_cache:
        kind_cache[real_uid] = await get_category_kinds(real_uid)
    kind_map = kind_cache[real_uid]
    user_examples = await fetch_user_examples(real_uid)
    return kind_map, user_examples


async def _post_with_retry(client: httpx.AsyncClient, headers: dict, body: dict) -> tuple[httpx.Response | None, int, str | None]:
    """Returns (response_or_None, latency_ms_of_final_attempt, error_str_or_None)."""
    backoff = INITIAL_BACKOFF_S
    last_error: str | None = None
    for attempt in range(MAX_ATTEMPTS):
        started = time.monotonic()
        try:
            resp = await client.post(JEV_URL, headers=headers, json=body)
        except httpx.HTTPError as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            latency_ms = int((time.monotonic() - started) * 1000)
            if attempt == MAX_ATTEMPTS - 1:
                return None, latency_ms, last_error
            await asyncio.sleep(backoff + random.uniform(0, 0.25 * backoff))
            backoff = min(backoff * 2, MAX_BACKOFF_S)
            continue
        latency_ms = int((time.monotonic() - started) * 1000)
        if resp.status_code in RETRY_STATUSES and attempt < MAX_ATTEMPTS - 1:
            await asyncio.sleep(backoff + random.uniform(0, 0.25 * backoff))
            backoff = min(backoff * 2, MAX_BACKOFF_S)
            continue
        return resp, latency_ms, None
    return None, 0, last_error or "exhausted retries"


def _record_from_response(row: dict, resp: httpx.Response | None, latency_ms: int, error: str | None) -> dict:
    rec = {
        "row_id": make_row_id(row["scope"], row["uid_hash"], row["merchant_key"]),
        "merchant_key": row["merchant_key"],
        "scope": row["scope"],
        "uid_hash": row["uid_hash"],
        "label": row["label"],
        "label_source": row["label_source"],
        "latency_ms": latency_ms,
        "http_status": resp.status_code if resp is not None else None,
        "choice": None,
        "confidence": None,
        "probabilities": None,
        "usage": None,
        "model_used": None,
        "error": error,
    }
    if resp is None:
        return rec
    if resp.status_code != 200:
        rec["error"] = f"http {resp.status_code}: {resp.text[:300]}"
        return rec
    try:
        data = resp.json()
        answer = data["answers"]["category"]
        rec["choice"] = answer.get("choice")
        rec["confidence"] = answer.get("confidence")
        rec["probabilities"] = answer.get("probabilities")
        rec["usage"] = data.get("usage")
        rec["model_used"] = data.get("model") or (data.get("usage") or {}).get("model")
    except Exception as exc:  # malformed 200 body
        rec["error"] = f"unparseable response: {type(exc).__name__}: {exc}"
    return rec


async def _dry_run(rows: list[dict], model: str = JEV_MODEL) -> None:
    from app.services.categories import BUILTIN_CATEGORY_KINDS, get_category_kinds
    from scripts.jev_eval.mongo_helpers import build_uid_hash_lookup, fetch_user_examples

    uid_lookup = await build_uid_hash_lookup()
    kind_cache: dict = {}
    for i, row in enumerate(rows[:3], 1):
        kind_map, user_examples = await _kind_map_and_examples_for(row, uid_lookup, kind_cache)
        body = build_request_body(row, kind_map, user_examples, model)
        print(f"--- dry-run request body {i}/3 (row_id={make_row_id(row['scope'], row['uid_hash'], row['merchant_key'])}) ---")
        print(json.dumps(body, indent=2, default=str))
        print()


async def _live_run(rows: list[dict], limit: int | None, model: str = JEV_MODEL) -> None:
    import os
    from app.services.categories import get_category_kinds
    from scripts.jev_eval.mongo_helpers import build_uid_hash_lookup

    key = os.environ.get("TYPESAFE_API_KEY")
    if not key:
        print_err("TYPESAFE_API_KEY is not set in backend/.env -- add it, then re-run (see README.md).")
        sys.exit(2)

    ensure_out_dir()
    done = existing_row_ids(JEV_RESULTS_PATH)
    todo = [r for r in rows if make_row_id(r["scope"], r["uid_hash"], r["merchant_key"]) not in done]
    if limit is not None:
        todo = todo[:limit]

    if not todo:
        print("nothing to do -- every row already has a result in out/jev_results.jsonl")
        return

    print(f"running {len(todo)} row(s) ({len(done)} already done, skipped)")

    uid_lookup = await build_uid_hash_lookup()
    kind_cache: dict = {}
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=30) as client:
        for n, row in enumerate(todo, 1):
            kind_map, user_examples = await _kind_map_and_examples_for(row, uid_lookup, kind_cache)
            body = build_request_body(row, kind_map, user_examples, model)
            resp, latency_ms, error = await _post_with_retry(client, headers, body)
            rec = _record_from_response(row, resp, latency_ms, error)
            append_jsonl(JEV_RESULTS_PATH, rec)
            status = rec["error"] or f"choice={rec['choice']} conf={rec['confidence']}"
            print(f"[{n}/{len(todo)}] {row['merchant_key']!r}: {status}")


def main() -> None:
    args = parse_common_args(sys.argv[1:])
    load_real_env()

    rows = read_jsonl(DATASET_PATH)
    if not rows:
        print_err(f"{DATASET_PATH} is empty or missing -- run `python -m scripts.jev_eval.dataset` first.")
        sys.exit(1)

    model = JEV_MODEL
    rest = args["rest"]
    if "--model" in rest:
        model = rest[rest.index("--model") + 1]

    if args["dry_run"]:
        asyncio.run(_dry_run(rows, model))
        return

    asyncio.run(_live_run(rows, args["limit"], model))


if __name__ == "__main__":
    main()
