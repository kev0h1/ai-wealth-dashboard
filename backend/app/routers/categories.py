"""Categories and categorisation rules endpoints."""
import asyncio
import re
import uuid as uuid_lib
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
import httpx
from pymongo.errors import DuplicateKeyError

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY, OPENROUTER_PROVIDER_PREFS
from app.core.subscription import Tier, require_tier
from app.db.collections import (
    behaviour_portrait_col,
    cashflow_cache_col,
    user_categories_col,
    user_rules_col,
)
from app.services import response_cache
from app.services.categorisation import apply_rules_bulk, apply_single_rule
from app.services.categories import (
    BUILTIN_CATEGORIES,
    BUILTIN_CATEGORY_KINDS,
    DEFAULT_KIND,
    USER_SELECTABLE_KINDS,
    builtin_conflict,
    clean_name,
    coerce_kind,
    custom_categories,
    normalise_name,
    reserved_conflict,
)

router = APIRouter(tags=["categories"])


async def _custom_for(uid: str) -> list[dict]:
    """This user's custom categories as ``[{name, kind}]`` (either schema)."""
    doc = await user_categories_col.find_one({"user_id": uid})
    return custom_categories(doc)


def _payload(custom: list[dict]) -> dict:
    """Response body for the category endpoints.

    ``builtin`` / ``custom`` / ``all`` keep their historic shape (arrays of
    names) so existing callers are unaffected. ``kinds`` is additive: one map
    covering built-ins AND customs, so the frontend has a single source of
    truth instead of its own copy of the taxonomy.
    """
    names = [c["name"] for c in custom]
    return {
        "builtin": BUILTIN_CATEGORIES,
        "custom": names,
        "all": BUILTIN_CATEGORIES + names,
        "kinds": {**BUILTIN_CATEGORY_KINDS, **{c["name"]: c["kind"] for c in custom}},
    }


@router.get("/categories")
async def get_categories(user: dict = Depends(current_user)):
    return _payload(await _custom_for(user["email"]))


@router.post("/categories")
async def add_category(body: dict, user: dict = Depends(current_user), _sub=Depends(require_tier(Tier.PRO))):
    uid  = user["email"]
    name = clean_name(body.get("name", ""))
    if not name or len(name) > 40:
        raise HTTPException(400, "Invalid category name")

    kind_raw = body.get("kind") or DEFAULT_KIND
    if not isinstance(kind_raw, str):
        # Anything non-string (e.g. `123`) would otherwise reach coerce_kind,
        # which calls .strip() on it and raises an unhandled AttributeError —
        # a 500 for a plain bad-input request. Reject it as a 400 instead.
        raise HTTPException(400, f"kind must be one of: {', '.join(USER_SELECTABLE_KINDS)}")
    kind = coerce_kind(kind_raw)
    if kind is None:
        raise HTTPException(400, f"kind must be one of: {', '.join(USER_SELECTABLE_KINDS)}")

    # Case- and whitespace-insensitive, so "groceries" or "Bills " cannot create
    # a shadow category that no backend code path recognises.
    if (clash := builtin_conflict(name)):
        raise HTTPException(400, f"'{clash}' is a built-in category")

    # Names that only *some* code paths recognise — creating one yields two
    # different totals for the same category depending on which screen you're on.
    if (ghost := reserved_conflict(name)):
        raise HTTPException(400, f"'{ghost}' is a reserved name — please pick a different one")

    norm = normalise_name(name)

    def _mutate(custom: list[dict]) -> list[dict]:
        for c in custom:
            if normalise_name(c["name"]) == norm:
                # Idempotent, matching the old $addToSet: re-adding updates the kind.
                c["kind"] = kind
                return custom
        custom.append({"name": name, "kind": kind})
        return custom

    custom = await _cas_update(uid, _mutate)
    await _invalidate_kind_caches(uid)
    return _payload(custom)


@router.delete("/categories/{name}")
async def delete_category(name: str, user: dict = Depends(current_user)):
    # Guard BEFORE any mutation — previously the $pull ran first, so deleting a
    # legacy collision (e.g. "Charity") mutated the document and *then* 400'd.
    if builtin_conflict(name):
        raise HTTPException(400, "Cannot delete built-in categories")
    uid  = user["email"]
    norm = normalise_name(name)

    def _mutate(custom: list[dict]) -> list[dict]:
        return [c for c in custom if normalise_name(c["name"]) != norm]

    await _cas_update(uid, _mutate)
    await _invalidate_kind_caches(uid)
    return {"deleted": name}


async def _invalidate_kind_caches(uid: str) -> None:
    """Drop every cache whose contents depend on this user's category kinds.

    A category create/delete (which may change an existing entry's ``kind``,
    see the idempotent-update branch in ``add_category``) can flip whether a
    category counts as spend. Each cache below is invalidated via its own
    documented mechanism rather than being deleted wholesale:

    - ``monthly_cf`` / ``total_baselines`` are blobs living on the single
      per-user ``cashflow_cache_col`` document (see
      ``services/cashflow.py:monthly_cashflow_cached`` and
      ``services/pace.py:_read_cached_baseline``). Both keys are ``$unset``
      so each memo's own "missing -> recompute live" fallback kicks in,
      WITHOUT touching the doc's other fields (bills, income, synced_at,
      etc.) that a category-kind change does not affect.
    - ``behaviour_portrait_col``'s freshness check
      (``routers/behaviour.py:get_mirror``) only trusts a cached portrait
      when ``computed_at`` is present and under 7 days old. Unsetting
      ``computed_at`` forces the next ``/mirror`` call down the "compute
      fresh" path while leaving the document (and any persisted
      keep/change trait choices, which are merged back in from the OLD doc)
      intact — deleting the doc outright would discard those choices.
    - ``response_cache`` (``today`` / ``safe-to-spend``) has a public
      ``invalidate(uid)`` that already drops every named cache for a user;
      used the same way commitments/accounts/planned routers do.
    """
    await cashflow_cache_col.update_one(
        {"_id": uid}, {"$unset": {"monthly_cf": "", "total_baselines": ""}}
    )
    await behaviour_portrait_col.update_one(
        {"_id": uid}, {"$unset": {"computed_at": ""}}
    )
    response_cache.invalidate(uid)


_CAS_RETRIES = 5


async def _cas_update(uid: str, mutate) -> list[dict]:
    """Read-modify-write this user's custom-category list, atomically.

    HEAD used ``$addToSet``/``$pull``, which Mongo applies atomically
    server-side. Once the stored shape became ``[{name, kind}]`` (needed so a
    re-add can update an existing entry's kind, and a delete can match
    case/whitespace-insensitively), those operators stopped fitting: there is
    no atomic "update this array entry's kind if a normalised name matches,
    else append" or "$pull by normalised name" operator. A plain whole-array
    ``$set`` reads naturally and handles both cases in Python — but it is a
    read-modify-write, so two concurrent requests (e.g. two tabs adding
    different categories at once) can both read the same starting array and
    one write silently clobbers the other, a lost update.

    Restores atomicity via optimistic concurrency instead of a positional
    update: read the document, compute the new list with ``mutate``, then
    write conditioned on the raw stored ``categories`` value being unchanged
    since the read (a compare-and-swap Mongo evaluates atomically as part of
    the single ``update_one`` call). If another write raced us, the filter
    matches nothing and we retry with a fresh read. Bounded at
    ``_CAS_RETRIES`` — this is a low-contention path (one user editing their
    own category list) so a handful of retries is already generous; a wedged
    loop would indicate something worse than an ordinary race.

    ``mutate(custom: list[dict]) -> list[dict]`` computes the new custom list
    from the current one (already filtered to exclude built-in collisions —
    e.g. a legacy "Charity" entry is dropped on any write, matching the prior
    ``_store`` behaviour exactly; see module-level note on that).

    Returns the new custom list on success; raises 409 if every retry raced.
    """
    for _ in range(_CAS_RETRIES):
        doc = await user_categories_col.find_one({"user_id": uid})
        raw_before = doc.get("categories") if doc else None
        new_custom = mutate(custom_categories(doc))
        new_stored = [{"name": c["name"], "kind": c["kind"]} for c in new_custom]
        try:
            result = await user_categories_col.update_one(
                {"user_id": uid, "categories": raw_before},
                {"$set": {"categories": new_stored}, "$setOnInsert": {"user_id": uid}},
                upsert=True,
            )
        except DuplicateKeyError:
            continue  # another request created the doc concurrently — retry
        if result.matched_count or result.upserted_id is not None:
            return new_custom
        # else: `categories` changed under us between read and write — retry
    raise HTTPException(409, "Category list changed concurrently — please retry")


@router.get("/rules")
async def get_rules(user: dict = Depends(current_user)):
    uid  = user["email"]
    docs = await user_rules_col.find({"uid": uid}).sort("created_at", -1).to_list(None)
    return {"rules": [
        {"id": str(d["_id"]), "description": d["description"],
         "pattern": d["pattern"], "category": d["category"],
         "created_at": d["created_at"].isoformat()}
        for d in docs
    ]}


@router.post("/rules/parse")
async def parse_rule(body: dict, user: dict = Depends(current_user), _sub=Depends(require_tier(Tier.PRO))):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "No text provided")
    custom   = [c["name"] for c in await _custom_for(user["email"])]
    all_cats = BUILTIN_CATEGORIES + custom
    prompt = (
        f"Extract a transaction categorisation rule from this instruction: \"{text}\"\n"
        f"Available categories: {', '.join(all_cats)}\n"
        f"Return ONLY JSON: {{\"pattern\": \"<simple regex>\", \"category\": \"<exact category name>\"}}\n"
        f"The pattern should be a lowercase regex that matches the merchant name or description.\n"
        f"If you cannot extract a valid rule, return: {{\"error\": \"reason\"}}"
    )
    if not OPENROUTER_API_KEY:
        raise HTTPException(503, "AI not configured")
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}",
                     "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
            json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 100,
                  "messages": [{"role": "user", "content": prompt}],
                  "provider": OPENROUTER_PROVIDER_PREFS},
        )
    if r.status_code != 200:
        raise HTTPException(502, "AI request failed")
    content = r.json()["choices"][0]["message"]["content"]
    import json as _json
    m = re.search(r"\{.*\}", content, re.DOTALL)
    if not m:
        raise HTTPException(422, "Could not parse rule")
    parsed = _json.loads(m.group())
    if "error" in parsed:
        raise HTTPException(422, parsed["error"])
    if parsed.get("category") not in all_cats:
        raise HTTPException(422, f"Unknown category: {parsed.get('category')}")
    try:
        re.compile(parsed["pattern"])
    except re.error:
        raise HTTPException(422, "Invalid pattern generated")
    return {"pattern": parsed["pattern"], "category": parsed["category"]}


@router.post("/rules")
async def add_rule(body: dict, user: dict = Depends(current_user), _sub=Depends(require_tier(Tier.PRO))):
    uid         = user["email"]
    description = (body.get("description") or "").strip()
    pattern     = (body.get("pattern") or "").strip()
    category    = (body.get("category") or "").strip()
    if not description or not pattern or not category:
        raise HTTPException(400, "description, pattern and category are required")
    custom = [c["name"] for c in await _custom_for(uid)]
    if category not in BUILTIN_CATEGORIES + custom:
        raise HTTPException(400, "Invalid category")
    try:
        re.compile(pattern)
    except re.error:
        raise HTTPException(400, "Invalid regex pattern")
    rule_id = str(uuid_lib.uuid4())
    await user_rules_col.insert_one({
        "_id": rule_id, "uid": uid, "description": description,
        "pattern": pattern.lower(), "category": category,
        "created_at": datetime.utcnow(),
    })
    # Awaited (not fire-and-forget) and scoped to just this new rule so the
    # response can carry exactly which sibling rows it recategorised —
    # TeachingSheet's "Undo" reverts each one by id (fix-round HIGH finding).
    affected = await apply_single_rule(uid, pattern.lower(), category)
    asyncio.create_task(apply_rules_bulk(uid))
    return {
        "id": rule_id, "description": description, "pattern": pattern.lower(), "category": category,
        "affected": affected,
    }


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, user: dict = Depends(current_user)):
    result = await user_rules_col.delete_one({"_id": rule_id, "uid": user["email"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Rule not found")
    return {"deleted": rule_id}
