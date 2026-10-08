"""G239: generic OpenRouter runner for the tier-2 categorisation judge eval.

Same dataset, same split and same v0 baseline prompt as `run_haiku.py` (the
rule text and per-merchant question are imported from it, not copied), but
the model is a flag, the call goes straight to OpenRouter with the account's
`data_collection: deny` provider preference, and nothing is written to Mongo
(`run_haiku.py` metered through `app.core.llm.openrouter_chat`; this runner
posts directly so a comparison run leaves no usage rows behind).

One deliberate prompt change, applied identically to every model so the
comparison is like for like: the reply schema asks for a self-reported
confidence, `{"category": "...", "confidence": 0.0-1.0}`, because three of
the four candidates give no probabilities and the abstain-threshold criterion
needs some confidence. Pass `--no-confidence` for the exact G178 reply line.

Each result row records the model the response says it was served by
(`served_model`, essential for openrouter/auto), latency, `usage.cost`, the
parsed category and confidence. Temperature 0, max_tokens 200 as in G178.

Usage (from backend/):
    .venv/bin/python -m scripts.jev_eval.run_openrouter --model anthropic/claude-haiku-4-5 --data-policy-check
    .venv/bin/python -m scripts.jev_eval.run_openrouter --model <id> --limit 5
    .venv/bin/python -m scripts.jev_eval.run_openrouter --model <id> --confirm-full-run --budget-usd 1.5

Resumable by `row_id`. Refuses an unbounded run without --confirm-full-run
and aborts a run whose recorded cost passes --budget-usd.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time

import httpx

from scripts.jev_eval import options
from scripts.jev_eval.common import (
    DATASET_PATH, append_jsonl, ensure_out_dir, existing_row_ids, load_real_env,
    model_results_path, print_err, read_jsonl, row_id as make_row_id,
)
from scripts.jev_eval.split import filter_rows_by_bucket, load_split
from scripts.jev_eval.variants import Variant, get_variant

CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
MODELS_URL = "https://openrouter.ai/api/v1/models"
PROVIDER_PREFS = {"data_collection": "deny"}  # mirrors app.core.config.OPENROUTER_PROVIDER_PREFS
MAX_TOKENS = 200
RETRY_STATUSES = {429, 500, 502, 503, 504, 529}
MAX_ATTEMPTS = 4

_OLD_REPLY = 'Reply ONLY with JSON: {"category": "Category"}\n\n'
_NEW_REPLY = (
    'Reply ONLY with JSON: {"category": "<one category from the list>", "confidence": <number from 0 to 1>}, '
    "where confidence is your probability that the category is right.\n\n"
)

#: Fallback USD per million tokens (prompt, completion) for models whose
#: listed pricing is dynamic (-1) or missing. Deliberately conservative.
FALLBACK_PRICE_PER_M = (3.0, 15.0)
#: Rough prompt size per row measured on G178 (haiku-4.5: about 0.0005 USD/row
#: at 1/5 USD per M => roughly 350 prompt tokens, 15 completion tokens).
EST_PROMPT_TOKENS = 450
EST_COMPLETION_TOKENS = 25


def build_prompt(row: dict, allowed_cats: list[str], owner_name: str | None,
                 variant: Variant | None = None, ask_confidence: bool = True) -> str:
    from scripts.jev_eval import run_haiku
    prompt = run_haiku.build_prompt(row, allowed_cats, owner_name, variant)
    if ask_confidence:
        if _OLD_REPLY not in prompt:
            raise RuntimeError("run_haiku reply line changed; update run_openrouter._OLD_REPLY")
        prompt = prompt.replace(_OLD_REPLY, _NEW_REPLY, 1)
    return prompt


def build_body(model: str, prompt: str, reasoning_off: bool = True, max_tokens: int = MAX_TOKENS) -> dict:
    body = {
        "model": model, "max_tokens": max_tokens, "temperature": 0,
        "messages": [{"role": "user", "content": prompt}],
        "provider": dict(PROVIDER_PREFS), "usage": {"include": True},
    }
    if reasoning_off:
        # Reasoning-capable models otherwise spend the 200-token cap on hidden
        # thinking and return nothing; production Haiku 4.5 does not reason.
        body["reasoning"] = {"effort": "none"}
    return body


def parse_reply(raw: str | None, allowed: list[str] | None = None) -> tuple[str | None, float | None]:
    """(category, confidence) from a model reply. Category is matched to
    `allowed` case-insensitively when given (an unknown category stays as the
    model wrote it, so it scores as a miss). Confidence in 0..1; a value in
    (1, 100] is read as a percentage; anything else is None."""
    if not raw:
        return None, None
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw).strip()
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return None, None
    try:
        data = json.loads(m.group())
    except Exception:
        return None, None
    if not isinstance(data, dict):
        return None, None
    cat = data.get("category")
    if not isinstance(cat, str) or not cat.strip():
        return None, None
    cat = cat.strip()
    if allowed:
        by_lower = {a.lower(): a for a in allowed}
        cat = by_lower.get(cat.lower(), cat)
    conf = data.get("confidence")
    try:
        conf = float(conf)
    except (TypeError, ValueError):
        conf = None
    if conf is not None:
        if 1.0 < conf <= 100.0:
            conf = conf / 100.0
        if not (0.0 <= conf <= 1.0):
            conf = None
    return cat, conf


def result_from_response(data: dict, allowed: list[str] | None = None) -> dict:
    """Fields of a result row derived from a 200 response body."""
    choice0 = (data.get("choices") or [{}])[0]
    content = (choice0.get("message") or {}).get("content")
    cat, conf = parse_reply(content, allowed)
    usage = data.get("usage") or {}
    return {
        "choice": cat,
        "confidence": conf,
        "served_model": data.get("model"),
        "reply_head": (content or "")[:200],
        "has_reasoning": bool((choice0.get("message") or {}).get("reasoning")),
        "finish_reason": choice0.get("finish_reason"),
        "usage": usage,
        "cost_usd": float(usage.get("cost") or 0.0),
    }


def estimate_cost_usd(n_rows: int, prompt_per_m: float | None, completion_per_m: float | None) -> tuple[float, bool]:
    """(estimated USD, used_fallback_price). Prices are USD per million tokens;
    None or negative (OpenRouter's dynamic marker) falls back conservatively."""
    fallback = False
    pp, cp = prompt_per_m, completion_per_m
    if pp is None or pp < 0:
        pp, fallback = FALLBACK_PRICE_PER_M[0], True
    if cp is None or cp < 0:
        cp, fallback = FALLBACK_PRICE_PER_M[1], True
    per_row = EST_PROMPT_TOKENS * pp / 1e6 + EST_COMPLETION_TOKENS * cp / 1e6
    return n_rows * per_row, fallback


def listed_prices(entry: dict | None) -> tuple[float | None, float | None]:
    """USD per million tokens from a /models entry (pricing is USD per token)."""
    if not entry:
        return None, None
    pricing = entry.get("pricing") or {}

    def conv(v):
        try:
            f = float(v)
        except (TypeError, ValueError):
            return None
        return f if f < 0 else f * 1e6

    return conv(pricing.get("prompt")), conv(pricing.get("completion"))


def fetch_models_index() -> dict[str, dict]:
    r = httpx.get(MODELS_URL, timeout=30)
    r.raise_for_status()
    return {m["id"]: m for m in r.json().get("data", [])}


def lookup_model(index: dict[str, dict], model: str) -> dict | None:
    """Listing entry for `model`, falling back to the dotted spelling
    (anthropic/claude-haiku-4-5 is served as anthropic/claude-haiku-4.5)."""
    return index.get(model) or index.get(re.sub(r"(\d)-(\d)", r"\1.\2", model))


def fetch_endpoint_providers(model: str) -> list[str] | None:
    """Distinct upstream provider names for a model, or None when the lookup
    fails. Virtual routers (auto, jev-router) list none."""
    try:
        r = httpx.get(f"https://openrouter.ai/api/v1/models/{model}/endpoints", timeout=30)
        r.raise_for_status()
        eps = (r.json().get("data") or {}).get("endpoints") or []
        return sorted({e.get("provider_name") for e in eps if e.get("provider_name")})
    except Exception:
        return None


def data_policy_report(model: str, entry: dict | None, providers: list[str] | None = None) -> list[str]:
    """Human-readable data-policy lines for one model from its /models entry.
    The listing carries no per-provider retention flag; what the account-wide
    `data_collection: deny` preference does is filter routing to providers
    that do not train on or retain prompts, and the request fails (404 no
    endpoints) if none qualify for the model."""
    lines = [f"model: {model}"]
    if entry is None:
        lines.append("  listed: NO (id not in /api/v1/models)")
        return lines
    lines.append("  listed: yes")
    pp, cp = listed_prices(entry)
    lines.append(f"  listed price per M tokens: prompt={pp}, completion={cp} (negative means dynamic)")
    pol = {k: v for k, v in entry.items() if "polic" in k.lower() or "collect" in k.lower() or "retention" in k.lower()}
    tp = entry.get("top_provider") or {}
    lines.append(f"  explicit policy fields in listing: {json.dumps(pol) if pol else 'none'}")
    lines.append(f"  top_provider moderated: {tp.get('is_moderated')}")
    lines.append(f"  upstream providers listed: {', '.join(providers) if providers else 'none listed (virtual router or lookup failed)'}")
    if model == "openrouter/auto":
        lines.append("  router: the deny setting constrains which upstream providers auto may route to; "
                     "the served model is logged per row.")
    else:
        lines.append("  our request sets provider.data_collection=deny, so only providers that do not "
                     "retain or train on prompts can serve it; a 404 'no endpoints' means none qualify.")
    return lines


async def _call(client: httpx.AsyncClient, body: dict, api_key: str) -> tuple[httpx.Response | None, int, str | None]:
    """(response, latency_ms of the final attempt, transport error)."""
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    err = None
    for attempt in range(MAX_ATTEMPTS):
        started = time.monotonic()
        try:
            resp = await client.post(CHAT_URL, headers=headers, json=body)
        except Exception as exc:  # network error: retry
            err = f"{type(exc).__name__}: {exc}"
            await asyncio.sleep(min(2 ** attempt, 20))
            continue
        latency = int((time.monotonic() - started) * 1000)
        if resp.status_code in RETRY_STATUSES and attempt < MAX_ATTEMPTS - 1:
            await asyncio.sleep(min(2 ** attempt, 20))
            continue
        return resp, latency, None
    return None, 0, err


async def live_run(model: str, rows: list[dict], variant: Variant, limit: int | None, confirm_full_run: bool,
                   budget_usd: float, ask_confidence: bool, entry: dict | None, reasoning_off: bool = True,
                   max_tokens: int = MAX_TOKENS, tag: str = "") -> None:
    from scripts.jev_eval.run_haiku import _allowed_cats_and_owner_for
    from scripts.jev_eval.mongo_helpers import build_uid_hash_lookup

    ensure_out_dir()
    out_path = model_results_path(model, variant.name, tag)
    done = existing_row_ids(out_path)
    todo = [r for r in rows if make_row_id(r["scope"], r["uid_hash"], r["merchant_key"]) not in done]
    if limit is not None:
        todo = todo[:limit]
    pp, cp = listed_prices(entry)
    est, fb = estimate_cost_usd(len(todo), pp, cp)
    print(f"ESTIMATE {model}: {len(todo)} row(s), about ${est:.4f}"
          + (" (listed price dynamic or missing, conservative fallback used)" if fb else ""))
    if limit is None and not confirm_full_run:
        print_err("Refusing an unbounded run: pass --limit N, or --confirm-full-run with Kevin's go-ahead.")
        sys.exit(2)
    if not todo:
        print(f"nothing to do, every row already has a result in {out_path.name}")
        return

    api_key = os.environ["OPENROUTER_API_KEY"]
    uid_lookup = await build_uid_hash_lookup()
    cache: dict = {}
    total = 0.0
    errors = 0
    async with httpx.AsyncClient(timeout=60) as client:
        for n, row in enumerate(todo, 1):
            allowed, owner = await _allowed_cats_and_owner_for(row, uid_lookup, cache)
            prompt = build_prompt(row, allowed, owner, variant, ask_confidence)
            rec = {
                "row_id": make_row_id(row["scope"], row["uid_hash"], row["merchant_key"]),
                "merchant_key": row["merchant_key"], "scope": row["scope"], "uid_hash": row["uid_hash"],
                "label": row["label"], "label_source": row["label_source"],
                "n_examples": len(row.get("examples") or []),
                "requested_model": model, "variant": variant.name, "max_tokens": max_tokens,
                "choice": None, "confidence": None, "served_model": None, "finish_reason": None,
                "usage": None, "cost_usd": None, "latency_ms": None, "http_status": None, "error": None,
            }
            resp, latency, terr = await _call(client, build_body(model, prompt, reasoning_off, max_tokens), api_key)
            if resp is None:
                rec["error"] = terr
            else:
                rec["latency_ms"] = latency
                rec["http_status"] = resp.status_code
                if resp.status_code == 200:
                    try:
                        rec.update(result_from_response(resp.json(), allowed))
                    except Exception as exc:
                        rec["error"] = f"unparseable response: {type(exc).__name__}"
                    if rec["choice"] is None and not rec["error"]:
                        rec["error"] = "no category in reply"
                else:
                    rec["error"] = f"http {resp.status_code}: {resp.text[:200]}"
            append_jsonl(out_path, rec)
            total += rec["cost_usd"] or 0.0
            errors += 1 if rec["error"] else 0
            if n % 25 == 0 or n == len(todo) or rec["error"]:
                print(f"[{n}/{len(todo)}] cost so far ${total:.5f} errors {errors}"
                      + (f" last error: {rec['error'][:80]}" if rec["error"] else ""))
            if total > budget_usd:
                print_err(f"ABORT: recorded cost ${total:.4f} passed --budget-usd {budget_usd}. Resume to continue.")
                sys.exit(3)
            if errors >= 10 and errors > n // 2:
                print_err("ABORT: most calls are failing; stopping to avoid wasted spend.")
                sys.exit(4)
    print(f"RUN COST {model}: ${total:.6f} across {len(todo)} row(s), {errors} error(s)")


async def dry_run(model: str, rows: list[dict], variant: Variant, ask_confidence: bool) -> None:
    from scripts.jev_eval.run_haiku import _allowed_cats_and_owner_for
    from scripts.jev_eval.mongo_helpers import build_uid_hash_lookup
    uid_lookup = await build_uid_hash_lookup()
    cache: dict = {}
    for i, row in enumerate(rows[:2], 1):
        allowed, owner = await _allowed_cats_and_owner_for(row, uid_lookup, cache)
        print(f"--- dry-run body {i}/2 (merchant text redacted: only the reply line shown) ---")
        body = build_body(model, build_prompt(row, allowed, owner, variant, ask_confidence))
        body["messages"][0]["content"] = body["messages"][0]["content"].split("Example transaction lines:")[0]
        print(json.dumps(body, indent=2))


def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True)
    ap.add_argument("--variant", default="v0_baseline")
    ap.add_argument("--bucket", default="all", choices=["tune", "holdout", "silver", "all"])
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--confirm-full-run", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--data-policy-check", action="store_true")
    ap.add_argument("--no-confidence", action="store_true")
    ap.add_argument("--max-tokens", type=int, default=MAX_TOKENS)
    ap.add_argument("--tag", default="", help="suffix for the results file, e.g. mt1000 for a non-default cap")
    ap.add_argument("--allow-reasoning", action="store_true", help="do not send reasoning.effort=none")
    ap.add_argument("--budget-usd", type=float, default=1.5)
    return ap.parse_args(argv)


def main() -> None:
    args = parse_args(sys.argv[1:])
    load_real_env()
    entry = None
    if args.data_policy_check or not args.dry_run:
        try:
            entry = lookup_model(fetch_models_index(), args.model)
        except Exception as exc:
            print_err(f"could not fetch the models list: {type(exc).__name__}")
    if args.data_policy_check:
        print("\n".join(data_policy_report(args.model, entry, fetch_endpoint_providers(args.model))))
        return
    rows = read_jsonl(DATASET_PATH)
    if not rows:
        print_err(f"{DATASET_PATH} is empty or missing -- run `python -m scripts.jev_eval.dataset` first.")
        sys.exit(1)
    variant = get_variant(args.variant)
    rows = filter_rows_by_bucket(rows, args.bucket, load_split())
    if args.dry_run:
        asyncio.run(dry_run(args.model, rows, variant, not args.no_confidence))
        return
    if not os.environ.get("OPENROUTER_API_KEY"):
        print_err("OPENROUTER_API_KEY is not set in backend/.env")
        sys.exit(2)
    asyncio.run(live_run(args.model, rows, variant, args.limit, args.confirm_full_run,
                         args.budget_usd, not args.no_confidence, entry, not args.allow_reasoning,
                         args.max_tokens, args.tag))


if __name__ == "__main__":
    main()
