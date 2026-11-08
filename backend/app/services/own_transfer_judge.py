"""G442: a model judges the own-account transfer pairs no rule can settle.

ENGINE.md ladder, tier 2. The deterministic tools do everything they can first
(`own_account_transfers.ai_candidate_pairs` builds the candidates with the same
pair builder the automatic matcher uses, then removes every pair a rule, a
learned pair, a card repayment link or the user has already decided). The model
only JUDGES what is left: same_transfer, not_transfer or unclear, with a
one-line reason. It never classifies a transaction itself.

Where it runs (H145: computed on change, stored, never on a screen load):

* at sync, on new candidate pairs, in the arq worker (`task_judge_transfer_pairs`);
  the API process forbids model calls (`recurring_judge.forbid_model_calls`),
  so a sync that runs there only enqueues the worker;
* once over the last 90 days per user as a paced, metered backfill, the first
  time a user is judged (`backfill_user`).

Every verdict is stored once, keyed by both transaction ids plus a signature of
exactly what was sent, so a pair is never re-sent unless the bank amends a row.
A model error or the monthly call ceiling leaves a pair unjudged, which falls
back to today's behaviour (the transfers review asks). The user's answers always
win: an undo writes an override that the model's verdict can never beat.

Privacy: the payload carries only the user's own transaction fields (both
descriptions, dates, directions, account display names and bank names, and the
Finexer metadata), the same scope as the categorisation calls. No balances, no
email, no other user's data.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from datetime import datetime, timedelta

import httpx

from app.core.config import OPENROUTER_API_KEY
from app.core.llm import LLMCeilingReached, openrouter_chat
from app.db.collections import (
    accounts_col, confirmed_transfer_pairs_col, own_transfer_judgements_col, preferences_col,
    transactions_col, user_profiles_col,
)
from app.services.categorisation import canonical_merchant_key
from app.services.categories import MOVEMENT, get_category_kinds
from app.services.own_account_transfers import (
    _learned_pair_keys, _pair_key, active_separate_review_ids, ai_candidate_pairs, pair_doc_id,
    reconcile_own_account_transfers, series_key as _txn_series_key, series_signature, too_generic_to_learn,
)
from app.services.recurring_judge import _MODEL as HAIKU_MODEL, model_calls_allowed

logger = logging.getLogger(__name__)

PIPELINE = "own_transfer_judge"
VERDICTS = ("same_transfer", "not_transfer", "unclear")
LOOKBACK_DAYS = 90
BATCH_SIZE = 12                # pairs per model call
SYNC_MAX_PAIRS = 36            # new pairs judged per sync run (three calls at most)
BACKFILL_MAX_PAIRS = 240       # one-off backfill over the last 90 days
BACKFILL_PACE_S = 1.0          # pause between backfill calls
MAX_REASON_CHARS = 140
_TIMEOUT_S = 30
_MAX_FIELD_CHARS = 160

# The ONLY fields that ever reach the model. The privacy test asserts this.
ALLOWED_PAIR_FIELDS = frozenset({"n", "amount", "currency", "gap_days", "out", "in"})
ALLOWED_LEG_FIELDS = frozenset({
    "date", "time", "account", "bank", "description", "merchant",
    "party_name", "party_sort_code", "party_number", "reference", "bank_code",
})

_PROJECTION = {
    "account_id": 1, "amount": 1, "currency": 1, "date": 1, "transaction_type": 1,
    "merchant_name": 1, "description": 1, "category": 1, "custom_category": 1,
    "is_pending": 1, "own_transfer_match": 1,
    "party_name": 1, "party_sort_code": 1, "party_number": 1, "reference": 1, "bank_code": 1,
}


# ── Payload ────────────────────────────────────────────────────────────────

def _clip(value) -> str | None:
    text = " ".join(str(value or "").split())[:_MAX_FIELD_CHARS]
    return text or None


def leg_payload(row: dict, account: dict | None) -> dict:
    """One leg, allowed fields only. Empty values are dropped."""
    date = row.get("date")
    out: dict = {}
    if isinstance(date, datetime):
        out["date"] = date.date().isoformat()
        if (date.hour, date.minute, date.second) != (0, 0, 0):
            out["time"] = date.strftime("%H:%M")
    account = account or {}
    out["account"] = _clip(account.get("display_name") or account.get("name"))
    out["bank"] = _clip(account.get("provider"))
    out["description"] = _clip(row.get("description"))
    out["merchant"] = _clip(row.get("merchant_name"))
    out["party_name"] = _clip(row.get("party_name"))
    out["party_sort_code"] = _clip(row.get("party_sort_code"))
    out["party_number"] = _clip(row.get("party_number"))
    out["reference"] = _clip(row.get("reference"))
    out["bank_code"] = _clip(row.get("bank_code"))
    return {k: v for k, v in out.items() if v}


def pair_payload(n: int, credit: dict, debit: dict, accounts: dict[str, dict]) -> dict:
    money = _pair_key(credit) or ("", None)
    gap = abs((credit["date"].date() - debit["date"].date()).days)
    return {
        "n": n,
        "amount": f"{money[1]:.2f}" if money[1] is not None else None,
        "currency": money[0] or None,
        "gap_days": gap,
        "out": leg_payload(debit, accounts.get(debit.get("account_id"))),
        "in": leg_payload(credit, accounts.get(credit.get("account_id"))),
    }


def pair_signature(credit: dict, debit: dict, accounts: dict[str, dict]) -> str:
    """Fingerprint of exactly what the model is shown. A bank amendment to any
    sent field changes it and earns a fresh judgement; nothing else does."""
    body = pair_payload(0, credit, debit, accounts)
    body.pop("n")
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:24]


# ── Prompt and validation ──────────────────────────────────────────────────

RULES = (
    "You help a UK banking app decide whether two transactions are the two legs of ONE "
    "transfer of the user's own money between two of the user's own bank accounts. Each pair "
    "below has the same amount, one payment out of an account and one payment into a different "
    "account, a few days apart. Both accounts belong to the user.\n\n"
    "For each pair answer exactly one verdict:\n"
    "- same_transfer: the two records together show one movement of the user's own money. "
    "Evidence that counts: the outgoing record names the other account's bank or account, or "
    "the incoming record names the sending bank or account, a standing order or faster payment "
    "reference that fits, or matching account details.\n"
    "- not_transfer: the records point to different counterparties, or look like a purchase, a "
    "refund, wages or a payment to someone else, or nothing links them except amount and timing.\n"
    "- unclear: the evidence is mixed or too thin to be sure.\n\n"
    "Rules:\n"
    "- The user's own name alone in a reference never makes it same_transfer. The name appears "
    "on payments the user makes to other people too.\n"
    "- If one record names a different bank from the other record's account, answer unclear.\n"
    "- Judge only what is written. When unsure answer unclear, never same_transfer.\n"
    "- A direct debit is never a transfer between the user's own accounts.\n\n"
    "Reply with STRICT JSON only, no other text: an object keyed by the pair number, for example "
    '{"1": {"verdict": "same_transfer", "reason": "..."}}. The reason is one plain sentence '
    f"under {MAX_REASON_CHARS} characters that names the evidence, in British English, with no "
    "dashes used as punctuation and no exclamation marks."
)


def build_prompt(items: list[dict]) -> str:
    """The full user message: the rules, then one JSON line per pair."""
    lines = "\n".join(json.dumps(item, ensure_ascii=False, sort_keys=True) for item in items)
    return f"{RULES}\n\nPairs:\n{lines}"


_DASHES = re.compile(r"\s*[–—]\s*")


def clean_reason(value) -> str | None:
    """One short line of safe copy, or None. No em or en dashes, no exclamation
    marks, no newlines; clipped to MAX_REASON_CHARS."""
    if not isinstance(value, str):
        return None
    text = _DASHES.sub(", ", value).replace("!", ".")
    text = " ".join(text.split()).strip()
    if len(text) > MAX_REASON_CHARS:
        text = text[:MAX_REASON_CHARS - 1].rstrip(" ,.;") + "."
    return text or None


def parse_response(content, expected: list[int]) -> dict[int, dict]:
    """Strictly validate a model reply. Always returns an entry for every
    expected pair number; anything malformed (not JSON, not an object, a
    missing or unknown verdict, a same_transfer with no stated evidence)
    becomes `unclear` with no reason and `fallback: True`. Never raises."""
    fallback = {"verdict": "unclear", "reason": None, "fallback": True}
    data = None
    if isinstance(content, str):
        text = content.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```\s*$", "", text).strip()
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(0))
            except (ValueError, TypeError):
                data = None
    if not isinstance(data, dict):
        return {n: dict(fallback) for n in expected}
    out: dict[int, dict] = {}
    for n in expected:
        entry = data.get(str(n))
        if not isinstance(entry, dict):
            out[n] = dict(fallback)
            continue
        verdict = entry.get("verdict")
        verdict = verdict.strip().lower() if isinstance(verdict, str) else None
        if verdict not in VERDICTS:
            out[n] = dict(fallback)
            continue
        reason = clean_reason(entry.get("reason"))
        if verdict == "same_transfer" and reason is None:
            out[n] = dict(fallback)  # a same_transfer must name its evidence
            continue
        out[n] = {"verdict": verdict, "reason": reason, "fallback": False}
    return out


# ── Model call ─────────────────────────────────────────────────────────────

async def _call_model(prompt: str, uid: str, n_pairs: int) -> tuple[str | None, str]:
    """(content, status). Status is "ok", "budget" (the monthly ceiling refused
    the call) or "error". Metered through the shared `openrouter_chat`."""
    if not OPENROUTER_API_KEY or not model_calls_allowed():
        return None, "error"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
            r = await openrouter_chat(
                {"model": HAIKU_MODEL, "max_tokens": min(2000, 70 * n_pairs + 120), "temperature": 0,
                 "messages": [{"role": "user", "content": prompt}]},
                user_id=uid, pipeline=PIPELINE, client=client,
            )
        if r.status_code != 200:
            return None, "error"
        return r.json()["choices"][0]["message"]["content"], "ok"
    except LLMCeilingReached:
        return None, "budget"
    except Exception as exc:
        logger.info("own_transfer_judge: model call failed, leaving pairs unjudged: %s", type(exc).__name__)
        return None, "error"


# ── Storage ────────────────────────────────────────────────────────────────

def _day(value) -> str | None:
    return value.date().isoformat() if isinstance(value, datetime) else None


async def _store_verdict(uid: str, credit: dict, debit: dict, sig: str, series_sig: str,
                         verdict: str, reason: str | None, fallback: bool) -> None:
    ids = sorted((str(credit["_id"]), str(debit["_id"])))
    await own_transfer_judgements_col.update_one(
        {"_id": pair_doc_id(uid, ids)},
        {"$set": {
            "user_id": uid, "kind": "pair", "ids": ids,
            "credit_id": str(credit["_id"]), "debit_id": str(debit["_id"]),
            "signature": sig, "series_sig": series_sig, "verdict": verdict, "reason": reason,
            "fallback": bool(fallback), "model": HAIKU_MODEL, "judged_at": datetime.utcnow(),  # naive-ok: Mongo audit stamp, naive UTC like every other stored date
        }},
        upsert=True,
    )


async def learn_pair(uid: str, credit: dict, debit: dict) -> bool:
    """Learn the pair by its normalised descriptions (dates, times and
    reference numbers stripped by `canonical_merchant_key`), so past and future
    occurrences match with no further model call. Marked `source: "ai"`; a pair
    the user already confirmed keeps its own (unmarked) document."""
    key_a = canonical_merchant_key(credit.get("merchant_name") or "", credit.get("description") or "")
    key_b = canonical_merchant_key(debit.get("merchant_name") or "", debit.get("description") or "")
    if too_generic_to_learn(key_a) or too_generic_to_learn(key_b):
        return False
    ka, kb = sorted((key_a, key_b))
    await confirmed_transfer_pairs_col.update_one(
        {"user_id": uid, "key_a": ka, "key_b": kb},
        {"$setOnInsert": {"user_id": uid, "key_a": ka, "key_b": kb, "source": "ai",
                          "created_at": datetime.utcnow()}},  # naive-ok: matches the confirm path's created_at
        upsert=True,
    )
    return True


async def _stored_state(uid: str) -> tuple[dict[str, dict], set[str]]:
    """({pair doc id: doc} for judged pairs, series signatures the user undid)."""
    docs = await own_transfer_judgements_col.find(
        {"user_id": uid, "kind": {"$in": ["pair", "undo"]}},
        {"kind": 1, "signature": 1, "series_sig": 1},
    ).to_list(None)
    pairs = {d["_id"]: d for d in docs if d.get("kind") == "pair"}
    undone = {d.get("series_sig") for d in docs if d.get("kind") == "undo" and d.get("series_sig")}
    return pairs, undone


# ── The run ────────────────────────────────────────────────────────────────

async def _candidates(uid: str) -> tuple[list[tuple[dict, dict]], dict[str, dict]]:
    """Deterministic candidates still needing a verdict, newest first, plus the
    account map. Reads only; never calls the model."""
    accounts = {a["_id"]: a async for a in accounts_col.find(
        {"user_id": uid},
        {"name": 1, "display_name": 1, "provider": 1, "type": 1, "subtype": 1, "account_type": 1,
         "account_number": 1, "sort_code": 1, "currency": 1},
    )}
    if len(accounts) < 2:
        return [], accounts
    profile = await user_profiles_col.find_one({"_id": uid}, {"name_tokens": 1}) or {}
    kinds = await get_category_kinds(uid)
    movement = {name for name, kind in kinds.items() if kind == MOVEMENT}
    cutoff = datetime.utcnow() - timedelta(days=LOOKBACK_DAYS)  # naive-ok: Mongo booked dates are naive UTC
    rows = await transactions_col.find(
        {"user_id": uid, "date": {"$gte": cutoff}, "transaction_type": {"$in": ["credit", "debit"]}},
        _PROJECTION,
    ).to_list(None)
    rows = [{**r, "currency": str(r.get("currency") or accounts.get(r.get("account_id"), {}).get("currency") or "").upper()}
            for r in rows]
    learned_rows = await confirmed_transfer_pairs_col.find({"user_id": uid}, {"key_a": 1, "key_b": 1}).to_list(None)
    queued = await active_separate_review_ids(uid, rows, accounts, movement_categories=movement)
    pairs = ai_candidate_pairs(rows, accounts, profile.get("name_tokens") or [], _learned_pair_keys(learned_rows),
                               movement_categories=movement, exclude_ids=queued)
    prefs = await preferences_col.find_one(
        {"user_id": uid},
        {"dismissed_transfer_pairs": 1, "dismissed_miscategorised": 1, "dismissed_miscategorised_series": 1},
    ) or {}
    dismissed_pairs = set(prefs.get("dismissed_transfer_pairs") or [])
    dismissed_rows = set(prefs.get("dismissed_miscategorised") or [])
    dismissed_series = set(prefs.get("dismissed_miscategorised_series") or [])
    stored, undone = await _stored_state(uid)
    todo: list[tuple[dict, dict]] = []
    for credit, debit in pairs:
        ids = sorted((str(credit["_id"]), str(debit["_id"])))
        if ":".join(ids) in dismissed_pairs or str(debit["_id"]) in dismissed_rows or str(credit["_id"]) in dismissed_rows:
            continue  # the user already answered this one
        if _txn_series_key(debit) in dismissed_series:
            continue
        if series_signature(credit, debit) in undone:
            continue  # the user undid this series; the model does not get another go
        cached = stored.get(pair_doc_id(uid, ids))
        if cached and cached.get("signature") == pair_signature(credit, debit, accounts):
            continue
        todo.append((credit, debit))
    todo.sort(key=lambda p: max(p[0]["date"], p[1]["date"]), reverse=True)
    return todo, accounts


async def judge_user(uid: str, *, max_pairs: int = SYNC_MAX_PAIRS, pace_s: float = 0.0) -> dict:
    """Judge this user's new candidate pairs, store the verdicts, and apply
    them. Worker (or script) only: the API process forbids model calls."""
    if not OPENROUTER_API_KEY or not model_calls_allowed():
        return {"skipped": "model_calls_not_allowed"}
    todo, accounts = await _candidates(uid)
    if not todo:
        return {"candidates": 0, "judged": 0}
    todo = todo[:max_pairs]
    judged = 0
    same = 0
    failures = 0
    status = "ok"
    for start in range(0, len(todo), BATCH_SIZE):
        batch = todo[start:start + BATCH_SIZE]
        items = [pair_payload(i + 1, c, d, accounts) for i, (c, d) in enumerate(batch)]
        content, status = await _call_model(build_prompt(items), uid, len(batch))
        if status == "budget":
            break  # the monthly ceiling: leave the rest unjudged
        if status != "ok":
            failures += 1
            if failures >= 2:
                break
            continue
        parsed = parse_response(content, [i["n"] for i in items])
        for i, (credit, debit) in enumerate(batch):
            result = parsed[i + 1]
            await _store_verdict(uid, credit, debit, pair_signature(credit, debit, accounts),
                                 series_signature(credit, debit), result["verdict"], result["reason"], result["fallback"])
            judged += 1
            if result["verdict"] == "same_transfer":
                same += 1
                await learn_pair(uid, credit, debit)
        if pace_s and start + BATCH_SIZE < len(todo):
            await asyncio.sleep(pace_s)
    if judged:
        await _after_verdicts(uid, filed=same > 0)
    return {"candidates": len(todo), "judged": judged, "same_transfer": same, "status": status}


async def _after_verdicts(uid: str, *, filed: bool) -> None:
    """Apply the stored verdicts: file same_transfer pairs through the ordinary
    reconcile, then mark the review state and derived caches stale so the next
    read rebuilds from the new verdicts. Never raises into the caller."""
    from app.services import transfer_review_store
    from app.services.derived_caches import mark_stale
    try:
        if filed:
            await reconcile_own_account_transfers(uid)
        await transfer_review_store.mark_stale(uid)
        await mark_stale(uid, reason="own_transfer_judged")
        await transfer_review_store.refresh(uid)
    except Exception:
        logger.exception("own_transfer_judge: applying verdicts failed for %s", uid)


# ── Backfill and sync entry points ─────────────────────────────────────────

def _backfill_id(uid: str) -> str:
    return f"{uid}::backfill"


async def backfill_done(uid: str) -> bool:
    return bool(await own_transfer_judgements_col.find_one({"_id": _backfill_id(uid)}, {"_id": 1}))


async def backfill_user(uid: str) -> dict:
    """The one-off pass over the last 90 days: rate-limited (paced between
    calls, capped per user) and metered like every other call. Recorded so it
    never runs twice; pairs beyond the cap are picked up by the ordinary
    sync passes."""
    result = await judge_user(uid, max_pairs=BACKFILL_MAX_PAIRS, pace_s=BACKFILL_PACE_S)
    if "skipped" not in result and result.get("status") != "budget":
        await own_transfer_judgements_col.update_one(
            {"_id": _backfill_id(uid)},
            {"$set": {"user_id": uid, "kind": "backfill", "done_at": datetime.utcnow(),  # naive-ok: audit stamp
                      "judged": result.get("judged", 0)}},
            upsert=True,
        )
    return result


async def run_for_user(uid: str) -> dict:
    """Worker entry: the backfill the first time, the ordinary sync pass after."""
    if not await backfill_done(uid):
        return await backfill_user(uid)
    return await judge_user(uid)


async def after_sync(uid: str) -> None:
    """Sync hook (every pipeline, API or worker). In the worker the pass runs
    inline; in the API process, where model calls are forbidden, it only
    enqueues the worker. Never raises into the sync that called it."""
    if not OPENROUTER_API_KEY:
        return
    try:
        if model_calls_allowed():
            await run_for_user(uid)
        else:
            from app.workers import queue
            await queue.enqueue("task_judge_transfer_pairs", uid, job_id=f"judge-transfers:{uid}")
    except Exception:
        logger.exception("own_transfer_judge.after_sync failed for %s", uid)


async def backfill_all_users(*, pace_s: float = BACKFILL_PACE_S) -> dict:
    """Fan-out for the one-off job: every user with two or more accounts who has
    not been backfilled, one at a time."""
    uids = [u for u in await accounts_col.distinct("user_id") if u]
    done = 0
    for uid in uids:
        if await backfill_done(uid):
            continue
        try:
            await backfill_user(uid)
            done += 1
        except Exception:
            logger.exception("own_transfer_judge backfill failed for %s", uid)
        await asyncio.sleep(pace_s)
    return {"users": len(uids), "backfilled": done}


# ── Auto-filed series and undo (the review sheet's "Filed automatically") ───

async def list_auto_filed(uid: str) -> list[dict]:
    """The pairs the model's verdicts filed, grouped into recurring series,
    newest first. Read from the stamped rows (so a later month filed through a
    learned pair is included), never from the model."""
    rows = await transactions_col.find(
        {"user_id": uid, "own_transfer_match.source": "ai", "own_transfer_match.confirmed": {"$ne": True}},
        _PROJECTION,
    ).to_list(None)
    credits = [r for r in rows if r.get("transaction_type") == "credit"]
    counterpart_ids = [(r.get("own_transfer_match") or {}).get("counterpart_id") for r in credits]
    others = await transactions_col.find(
        {"user_id": uid, "_id": {"$in": [c for c in counterpart_ids if c]}}, _PROJECTION,
    ).to_list(None) if counterpart_ids else []
    by_id = {str(r["_id"]): r for r in others}
    verdicts = {}
    for d in await own_transfer_judgements_col.find(
            {"user_id": uid, "kind": "pair"}, {"ids": 1, "reason": 1, "series_sig": 1}).to_list(None):
        verdicts[d.get("series_sig")] = d.get("reason") or verdicts.get(d.get("series_sig"))
    series: dict[str, dict] = {}
    for credit in credits:
        debit = by_id.get(str((credit.get("own_transfer_match") or {}).get("counterpart_id")))
        if not debit or not isinstance(credit.get("date"), datetime) or not isinstance(debit.get("date"), datetime):
            continue
        sig = series_signature(credit, debit)
        entry = series.setdefault(sig, {
            "series_key": sig, "count": 0, "amount": credit.get("amount"),
            "currency": credit.get("currency") or debit.get("currency"),
            "credit_account_id": credit.get("account_id"), "debit_account_id": debit.get("account_id"),
            "credit_description": credit.get("merchant_name") or credit.get("description"),
            "debit_description": debit.get("merchant_name") or debit.get("description"),
            "first_date": None, "last_date": None, "reason": verdicts.get(sig), "pairs": [],
        })
        entry["count"] += 1
        when = max(credit["date"], debit["date"])
        iso = when.isoformat()
        entry["first_date"] = min(filter(None, (entry["first_date"], iso)))
        entry["last_date"] = max(filter(None, (entry["last_date"], iso)))
        entry["pairs"].append({"credit_id": str(credit["_id"]), "debit_id": str(debit["_id"])})
    return sorted(series.values(), key=lambda s: s["last_date"] or "", reverse=True)


async def undo_series(uid: str, series_key: str) -> dict:
    """Undo one auto-filed series: the user's answer, which the model can never
    beat. Writes an undo marker for the series (the model never re-judges it),
    overrides every stored verdict in it, unlearns the pair (only a pair the AI
    learned; one the user confirmed keeps its own document), then reconciles so
    the rows return to their prior category and the review or Spend picks them
    up through the ordinary rules."""
    items = [s for s in await list_auto_filed(uid) if s["series_key"] == series_key]
    if not items:
        return {"undone": 0}
    item = items[0]
    all_ids = [i for p in item["pairs"] for i in (p["credit_id"], p["debit_id"])]
    rows = await transactions_col.find({"user_id": uid, "_id": {"$in": all_ids}}, _PROJECTION).to_list(None)
    by_id = {str(r["_id"]): r for r in rows}
    now = datetime.utcnow()  # naive-ok: audit stamp
    await own_transfer_judgements_col.update_one(
        {"_id": f"{uid}::undo::{series_key}"},
        {"$set": {"user_id": uid, "kind": "undo", "series_sig": series_key, "at": now}},
        upsert=True,
    )
    for pair in item["pairs"]:
        ids = sorted((pair["credit_id"], pair["debit_id"]))
        await own_transfer_judgements_col.update_one(
            {"_id": pair_doc_id(uid, ids)},
            {"$set": {"user_id": uid, "kind": "pair", "ids": ids, "series_sig": series_key, "user_override": True},
             "$setOnInsert": {"verdict": "same_transfer", "reason": None}},
            upsert=True,
        )
        credit, debit = by_id.get(pair["credit_id"]), by_id.get(pair["debit_id"])
        if credit and debit:
            ka, kb = sorted((
                canonical_merchant_key(credit.get("merchant_name") or "", credit.get("description") or ""),
                canonical_merchant_key(debit.get("merchant_name") or "", debit.get("description") or "")))
            await confirmed_transfer_pairs_col.delete_many(
                {"user_id": uid, "key_a": ka, "key_b": kb, "source": "ai"})
    await reconcile_own_account_transfers(uid)
    return {"undone": len(item["pairs"])}
