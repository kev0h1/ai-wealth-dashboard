"""G178 deliverable 4: run the SAME eval dataset through the existing Haiku
tier-2 judge, as the baseline Jev is being compared against.

The categorisation RULE TEXT below (the bullet list of category
definitions, the "[OUT] line can NEVER be Income" rule, the owner-name
clause) is copied VERBATIM from
`app.services.categorisation.categorise_others_bg`'s `prompt_prefix`
(categorisation.py ~line 1505-1520) -- it could not be imported directly:
that function is an inline async generator that fetches its own batch from
Mongo, builds the prompt, calls OpenRouter and writes back category/cache
updates all in one body, with no seam that returns just the prompt text.
Copying was the documented fallback ("otherwise copy it and say so").

What IS an adaptation, not a copy: `categorise_others_bg` batches up to 80
DIFFERENT (label, direction) keys into one call and asks for one category
PER KEY. This script asks about ONE merchant per call, given that
merchant's up-to-three example lines, and asks for ONE category for the
whole merchant -- the same question shape `run_jev.py` puts to Jev (one
state, one Choice), which is what makes the two runners' latency/cost/
accuracy numbers comparable row-for-row. The rule text and the Income/
owner-name logic are unchanged from production.

`llm_name_check` (categorisation.py ~1605) was read and considered as the
reuse target instead, but its task is narrower and differently shaped: it
decides ONLY whether text references the account owner's name (defaulting
non-matches to Income or the general category list), a fact this dataset
does not carry a ground truth for. `categorise_others_bg`'s prompt is the
general "assign a category to this merchant" task, which is what this
dataset's labels (`merchant_categories.category`) actually are, so its rule
text is the fairer baseline for Jev's Choice on the same task.

Side effect, disclosed: every live call goes through the app's real
`app.core.llm.openrouter_chat`, which -- exactly like every other OpenRouter
call in the app -- meters itself into `llm_usage_col` (pipeline=
"jev_eval_haiku_baseline", user_id="jev_eval_harness"). This is the ONE
Mongo write anywhere in this whole toolkit, and it is the ordinary metering
side effect of using the real call path (deliberately reused rather than
posting to OpenRouter directly, so the recorded `usage.cost` is the same
number the app's own cost dashboards would show).

Usage (from backend/):
    .venv/bin/python -m scripts.jev_eval.run_haiku --dry-run
    .venv/bin/python -m scripts.jev_eval.run_haiku --limit 5   # prove it works, see the cost
    .venv/bin/python -m scripts.jev_eval.run_haiku --limit 258 --confirm-full-run   # Kevin's call, spends real credit
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
import time

import httpx

from scripts.jev_eval.common import (
    DATASET_PATH, HAIKU_RESULTS_PATH, EXCLUDED_FROM_CHOICE, append_jsonl,
    ensure_out_dir, existing_row_ids, load_real_env, parse_common_args,
    print_err, read_jsonl, row_id as make_row_id,
)
from scripts.jev_eval import options

HAIKU_MODEL = "anthropic/claude-haiku-4-5"
PIPELINE = "jev_eval_haiku_baseline"
HARNESS_USER_ID = "jev_eval_harness"

# Kevin's own back-of-envelope estimate from the item brief: ~$0.20 for 258
# rows on this model at current OpenRouter rates. Used only to print an
# up-front estimate before a full, unbounded run; the real number afterwards
# always comes from the recorded `usage.cost` in each result, never this
# constant.
_ESTIMATED_COST_PER_ROW_USD = 0.20 / 258


_RULE_TEXT = (
    "Rules:\n"
    "- Eating Out: restaurants, cafes, takeaways, delivery apps\n"
    "- Transport: trains, buses, taxis, Uber, parking, fuel, car-related services\n"
    "- Shopping: retail, online stores, non-food goods, homeware\n"
    "- Bills: utilities, broadband, mobile, insurance, rent, council tax\n"
    "- Subscriptions: streaming, software, recurring digital memberships\n"
    "- Health: hospitals, pharmacies, gyms, dentists, medical services\n"
    "- Travel: flights, hotels, holidays\n"
    "- Income: salary, refunds, cashback, money received from people. An [OUT] line can NEVER "
    "be Income, no matter what the text says\n"
)


def _name_clause(owner_name: str | None) -> str:
    if not owner_name:
        return ""
    return (
        f"- The account owner's name is {owner_name}. "
        "A credit into a bank account whose text does NOT reference the owner's name -> Income. "
        "A credit that DOES reference the owner's own name is their own money moving, never Income.\n"
    )


def build_prompt(row: dict, allowed_cats: list[str], owner_name: str | None) -> str:
    cat_list = ", ".join(allowed_cats)
    prefix = (
        "You are a UK personal finance assistant categorising a bank merchant from its "
        "example transaction lines.\n"
        "Each line is tagged [OUT] (a debit, money leaving the account) or [IN] (a credit, "
        "money entering the account).\n"
        f"Assign the WHOLE merchant to exactly one of: {cat_list}.\n"
        f"{_RULE_TEXT}"
        f"{_name_clause(owner_name)}"
        "- Other: only if genuinely unclassifiable\n"
        'Reply ONLY with JSON: {"category": "Category"}\n\nExample transaction lines:\n'
    )
    lines = []
    for i, ex in enumerate(row["examples"], 1):
        tag = "IN" if ex.get("direction") == "credit" else "OUT"
        amount = ex.get("amount")
        amount_str = f"£{amount:.2f}" if isinstance(amount, (int, float)) else "£?"
        desc = ex.get("description") or "(no description)"
        lines.append(f"{i}. [{tag}] {amount_str} {desc}")
    if not lines:
        lines.append("(no example transaction lines survive for this merchant key)")
    return prefix + "\n".join(lines)


def _parse_category(raw: str) -> str | None:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```\s*$', '', raw).strip()
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return None
    try:
        data = json.loads(m.group())
    except Exception:
        return None
    return data.get("category")


async def _allowed_cats_and_owner_for(row: dict, uid_lookup: dict[str, str], cache: dict) -> tuple[list[str], str | None]:
    if row["scope"] != "user":
        base = [c for c in options.VALID_CATEGORIES if c not in EXCLUDED_FROM_CHOICE]
        return base, None

    from app.services.categories import get_category_kinds
    from app.services.categorisation import user_identity

    real_uid = uid_lookup.get(row["uid_hash"])
    if not real_uid:
        base = [c for c in options.VALID_CATEGORIES if c not in EXCLUDED_FROM_CHOICE]
        return base, None

    if real_uid not in cache:
        kind_map = await get_category_kinds(real_uid)
        identity = await user_identity(real_uid)
        name_tokens = identity.get("name_tokens") or []
        owner_name = " ".join(t.capitalize() for t in name_tokens) if name_tokens else None
        customs = options.custom_category_names(kind_map)
        allowed = [c for c in options.VALID_CATEGORIES if c not in EXCLUDED_FROM_CHOICE] + customs
        cache[real_uid] = (allowed, owner_name)
    return cache[real_uid]


async def _dry_run(rows: list[dict]) -> None:
    from scripts.jev_eval.mongo_helpers import build_uid_hash_lookup

    uid_lookup = await build_uid_hash_lookup()
    cache: dict = {}
    for i, row in enumerate(rows[:3], 1):
        allowed_cats, owner_name = await _allowed_cats_and_owner_for(row, uid_lookup, cache)
        prompt = build_prompt(row, allowed_cats, owner_name)
        body = {
            "model": HAIKU_MODEL, "max_tokens": 200, "temperature": 0,
            "messages": [{"role": "user", "content": prompt}],
        }
        row_key = make_row_id(row["scope"], row["uid_hash"], row["merchant_key"])
        print(f"--- dry-run request body {i}/3 (row_id={row_key}) ---")
        print(json.dumps(body, indent=2, default=str))
        print()


async def _live_run(rows: list[dict], limit: int | None, confirm_full_run: bool) -> None:
    from app.core.llm import openrouter_chat
    from scripts.jev_eval.mongo_helpers import build_uid_hash_lookup

    ensure_out_dir()
    done = existing_row_ids(HAIKU_RESULTS_PATH)
    todo = [r for r in rows if make_row_id(r["scope"], r["uid_hash"], r["merchant_key"]) not in done]

    if limit is None and not confirm_full_run:
        est = len(todo) * _ESTIMATED_COST_PER_ROW_USD
        print_err(
            f"Refusing an unbounded run over all {len(todo)} remaining row(s): this spends real "
            f"OpenRouter credit (estimated ~${est:.2f} at Kevin's own ~$0.20/258-row rate, unverified "
            "per-row). Pass --limit N to bound it (recommended: --limit 5 first), or "
            "--confirm-full-run if you have Kevin's go-ahead to run the whole baseline."
        )
        sys.exit(2)

    if limit is not None:
        todo = todo[:limit]

    if not todo:
        print("nothing to do -- every row already has a result in out/haiku_results.jsonl")
        return

    print(f"running {len(todo)} row(s) ({len(done)} already done, skipped)")

    uid_lookup = await build_uid_hash_lookup()
    cache: dict = {}
    total_cost = 0.0

    async with httpx.AsyncClient(timeout=30) as client:
        for n, row in enumerate(todo, 1):
            allowed_cats, owner_name = await _allowed_cats_and_owner_for(row, uid_lookup, cache)
            prompt = build_prompt(row, allowed_cats, owner_name)
            body = {
                "model": HAIKU_MODEL, "max_tokens": 200, "temperature": 0,
                "messages": [{"role": "user", "content": prompt}],
            }
            started = time.monotonic()
            rec = {
                "row_id": make_row_id(row["scope"], row["uid_hash"], row["merchant_key"]),
                "merchant_key": row["merchant_key"],
                "scope": row["scope"],
                "uid_hash": row["uid_hash"],
                "label": row["label"],
                "label_source": row["label_source"],
                "choice": None,
                "usage": None,
                "cost_usd": None,
                "latency_ms": None,
                "http_status": None,
                "error": None,
            }
            try:
                resp = await openrouter_chat(
                    body, user_id=HARNESS_USER_ID, pipeline=PIPELINE, client=client,
                )
            except Exception as exc:
                rec["error"] = f"{type(exc).__name__}: {exc}"
                append_jsonl(HAIKU_RESULTS_PATH, rec)
                print(f"[{n}/{len(todo)}] {row['merchant_key']!r}: {rec['error']}")
                continue
            rec["latency_ms"] = int((time.monotonic() - started) * 1000)
            rec["http_status"] = resp.status_code
            if resp.status_code == 200:
                try:
                    data = resp.json()
                    content = data["choices"][0]["message"]["content"]
                    rec["choice"] = _parse_category(content)
                    usage = data.get("usage") or {}
                    rec["usage"] = usage
                    rec["cost_usd"] = float(usage.get("cost") or 0.0)
                    total_cost += rec["cost_usd"]
                except Exception as exc:
                    rec["error"] = f"unparseable response: {type(exc).__name__}: {exc}"
            else:
                rec["error"] = f"http {resp.status_code}: {resp.text[:300]}"
            append_jsonl(HAIKU_RESULTS_PATH, rec)
            print(f"[{n}/{len(todo)}] {row['merchant_key']!r}: choice={rec['choice']} cost_usd={rec['cost_usd']}")

    print(f"total recorded cost this run: ${total_cost:.6f} across {len(todo)} row(s)")


def main() -> None:
    args = parse_common_args(sys.argv[1:])
    load_real_env()

    rows = read_jsonl(DATASET_PATH)
    if not rows:
        print_err(f"{DATASET_PATH} is empty or missing -- run `python -m scripts.jev_eval.dataset` first.")
        sys.exit(1)

    if args["dry_run"]:
        asyncio.run(_dry_run(rows))
        return

    import os
    if not os.environ.get("OPENROUTER_API_KEY"):
        print_err("OPENROUTER_API_KEY is not set in backend/.env -- needed for a live Haiku run.")
        sys.exit(2)

    asyncio.run(_live_run(rows, args["limit"], args["confirm_full_run"]))


if __name__ == "__main__":
    main()
