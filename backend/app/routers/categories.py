"""Categories and categorisation rules endpoints."""
import asyncio
import re
import uuid as uuid_lib
from datetime import datetime
from typing import Any
from fastapi import APIRouter, Body, Depends, HTTPException
import httpx
from pymongo.errors import DuplicateKeyError

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY
from app.core.llm import openrouter_chat
from app.db.collections import (
    behaviour_portrait_col,
    cashflow_cache_col,
    money_shape_cache_col,
    user_categories_col,
    user_rules_col,
)
from app.services import data_version, response_cache
from app.services.category_groups import EDITABLE_KINDS, response_for, revision_for
from app.services.category_icons import (
    backfill_icon, builtin_icon_key, choose_automatic_icon, fallback_icon_key, valid_icon_key,
)
from app.services.categorisation import apply_rules_bulk, apply_single_rule
from app.services.money_shape import get_money_shape_cached
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

# Retained references for this router's fire-and-forget post-write tasks —
# same rationale as app.routers.accounts._background_tasks: a bare
# `asyncio.create_task(...)` with nothing holding the result can be
# garbage-collected mid-flight.
_background_tasks: set = set()


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
    icons = {name: builtin_icon_key(name) for name in BUILTIN_CATEGORIES}
    icons.update({c["name"]: c.get("icon_key") or backfill_icon(c["name"], c["kind"]) for c in custom})
    return {
        "builtin": BUILTIN_CATEGORIES,
        "custom": names,
        "all": BUILTIN_CATEGORIES + names,
        "kinds": {**BUILTIN_CATEGORY_KINDS, **{c["name"]: c["kind"] for c in custom}},
        "icons": icons,
        "icon_sources": {c["name"]: c.get("icon_source") or "auto" for c in custom},
    }


@router.get("/categories")
async def get_categories(user: dict = Depends(current_user)):
    return _payload(await _custom_for(user["email"]))


@router.get("/categories/groups")
async def get_category_groups(user: dict = Depends(current_user)):
    """The category-group editor's persisted read model.

    ``get_money_shape_cached`` is intentionally the only evidence source: a
    groups read never reaches into the live feed itself (the cache wrapper may
    populate a missing or stale cached snapshot).
    """
    uid = user["email"]
    # The evidence and metadata need not come from one Mongo document, but
    # the advertised revision must describe the list used for these rows.  A
    # short retry turns an edit racing this read into either a consistent
    # snapshot or an explicit conflict, never a revision for stale rows.
    for _ in range(2):
        before = await _custom_for(uid)
        shape = await get_money_shape_cached(uid)
        after = await _custom_for(uid)
        if revision_for(before) == revision_for(after):
            return response_for(after, shape)
    raise HTTPException(409, "Category groups changed concurrently, please retry")


@router.patch("/categories/group")
async def update_category_group(body: Any = Body(...), user: dict = Depends(current_user)):
    if not isinstance(body, dict):
        raise HTTPException(400, "Invalid request body")
    uid = user["email"]
    name = body.get("name")
    kind = body.get("kind")
    revision = body.get("revision")
    if not isinstance(name, str) or not normalise_name(name):
        raise HTTPException(400, "Invalid category name")
    if not isinstance(kind, str) or kind.strip().casefold() not in EDITABLE_KINDS:
        raise HTTPException(400, f"kind must be one of: {', '.join(EDITABLE_KINDS)}")
    if not isinstance(revision, str) or not revision:
        raise HTTPException(400, "revision is required")
    if builtin_conflict(name):
        raise HTTPException(400, "Built-in categories cannot be changed")
    wanted = normalise_name(name)
    selected_kind = kind.strip().casefold()

    def _mutate(custom: list[dict]) -> list[dict]:
        # This is inside _cas_update's retry loop: a revision is compared
        # against the same fresh list which will be conditionally written.
        if revision_for(custom) != revision:
            raise HTTPException(409, "Category groups changed concurrently, please refresh")
        for category in custom:
            if normalise_name(category["name"]) == wanted:
                if category["kind"] == "income":
                    raise HTTPException(400, "Income categories cannot be changed")
                category["default_kind"] = category.get("default_kind") or category["kind"]
                category["kind"] = selected_kind
                return custom
        raise HTTPException(404, "Unknown custom category")

    await _cas_update(uid, _mutate)
    await _invalidate_kind_caches(uid)
    # Do not recalculate/read Money Shape after the committed write. A
    # successful save remains successful if a later read would fail.
    return {"saved": True}


@router.post("/categories/groups/reset")
async def reset_category_groups(body: Any = Body(...), user: dict = Depends(current_user)):
    if not isinstance(body, dict):
        raise HTTPException(400, "Invalid request body")
    uid = user["email"]
    revision = body.get("revision")
    if not isinstance(revision, str) or not revision:
        raise HTTPException(400, "revision is required")

    def _mutate(custom: list[dict]) -> list[dict]:
        if revision_for(custom) != revision:
            raise HTTPException(409, "Category groups changed concurrently, please refresh")
        for category in custom:
            category["kind"] = category.get("default_kind") or category["kind"]
        return custom

    await _cas_update(uid, _mutate)
    await _invalidate_kind_caches(uid)
    return {"saved": True}


@router.post("/categories")
async def add_category(body: dict, user: dict = Depends(current_user)):
    uid  = user["email"]
    raw_name = body.get("name", "")
    if not isinstance(raw_name, str):
        raise HTTPException(400, "Invalid category name")
    name = clean_name(raw_name)
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
        raise HTTPException(400, f"'{ghost}' is a reserved name, please pick a different one")

    norm = normalise_name(name)
    requested_icon = body.get("icon_key")
    if requested_icon is not None and (not isinstance(requested_icon, str) or not valid_icon_key(requested_icon)):
        raise HTTPException(400, "Invalid category icon")
    # Selecting happens before CAS so retries never repeat a model call. An
    # idempotent re-add retains its existing metadata and does not pay for a
    # second automatic selection.
    existing = next((c for c in await _custom_for(uid) if normalise_name(c["name"]) == norm), None)
    automatic_icon = None
    if requested_icon is None and (existing is None or not valid_icon_key(existing.get("icon_key"))):
        automatic_icon = await choose_automatic_icon(name, kind, uid)

    def _mutate(custom: list[dict]) -> list[dict]:
        for c in custom:
            if normalise_name(c["name"]) == norm:
                # Idempotent, matching the old $addToSet: re-adding updates the kind.
                c["default_kind"] = c.get("default_kind") or c["kind"]
                c["kind"] = kind
                if requested_icon is not None:
                    c["icon_key"] = requested_icon
                    c["icon_source"] = "user"
                elif not valid_icon_key(c.get("icon_key")):
                    c["icon_key"] = automatic_icon or fallback_icon_key()
                    c["icon_source"] = "auto"
                return custom
        custom.append({
            "name": name, "kind": kind, "default_kind": kind,
            "icon_key": requested_icon or automatic_icon or fallback_icon_key(),
            "icon_source": "user" if requested_icon is not None else "auto",
        })
        return custom

    custom = await _cas_update(uid, _mutate)
    await _invalidate_kind_caches(uid)
    return _payload(custom)


@router.patch("/categories/icon")
async def update_category_icon(body: Any = Body(...), user: dict = Depends(current_user)):
    """Save one custom category's icon; null returns it to automatic selection."""
    if not isinstance(body, dict):
        raise HTTPException(400, "Invalid request body")
    name, requested_icon = body.get("name"), body.get("icon_key")
    if "icon_key" not in body:
        raise HTTPException(400, "icon_key is required")
    if not isinstance(name, str) or not normalise_name(name):
        raise HTTPException(400, "Invalid category name")
    if requested_icon is not None and (not isinstance(requested_icon, str) or not valid_icon_key(requested_icon)):
        raise HTTPException(400, "Invalid category icon")
    if builtin_conflict(name):
        raise HTTPException(400, "Built-in category icons cannot be changed")
    wanted = normalise_name(name)
    uid = user["email"]
    selected_auto = None
    automatic_snapshot = None

    def icon_snapshot(category: dict) -> tuple:
        return (category["name"], category["kind"], category.get("icon_key"), category.get("icon_source"))

    async def automatic_for_current() -> str:
        # Restore can use the model exactly once for this deliberate user
        # action. It remains outside the synchronous CAS mutator.
        nonlocal automatic_snapshot
        current = await _custom_for(uid)
        for category in current:
            if normalise_name(category["name"]) == wanted:
                automatic_snapshot = icon_snapshot(category)
                if category.get("icon_source") == "auto" and valid_icon_key(category.get("icon_key")):
                    return category["icon_key"]
                return await choose_automatic_icon(category["name"], category["kind"], uid)
        raise HTTPException(404, "Unknown custom category")

    if requested_icon is None:
        selected_auto = await automatic_for_current()

    def _mutate(custom: list[dict]) -> list[dict]:
        for category in custom:
            if normalise_name(category["name"]) == wanted:
                if requested_icon is None and icon_snapshot(category) != automatic_snapshot:
                    raise HTTPException(409, "This category changed while its icon was being chosen. Open it again and try again.")
                category["icon_key"] = selected_auto if requested_icon is None else requested_icon
                category["icon_source"] = "auto" if requested_icon is None else "user"
                return custom
        raise HTTPException(404, "Unknown custom category")

    return _payload(await _cas_update(uid, _mutate, icon_only=True))


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
    - ``money_shape_cache_col`` (``services/money_shape.py:get_money_shape_cached``)
      is the whole Money Shape response persisted as one per-user document,
      keyed the same way as ``behaviour_portrait_col``; its ``computed_at``
      is both the TTL sentinel and the response field, so unsetting it forces
      the next ``/money-shape`` call to recompute fresh, fixed/moved/free
      shares included.
    """
    await cashflow_cache_col.update_one(
        {"_id": uid}, {"$unset": {"monthly_cf": "", "total_baselines": ""}}
    )
    await behaviour_portrait_col.update_one(
        {"_id": uid}, {"$unset": {"computed_at": ""}}
    )
    await money_shape_cache_col.update_one(
        {"_id": uid}, {"$unset": {"computed_at": ""}}
    )
    await response_cache.ainvalidate(uid)


_CAS_RETRIES = 5


async def _cas_update(uid: str, mutate, *, icon_only: bool = False) -> list[dict]:
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
    e.g. a legacy "Charity" entry is dropped on a taxonomy write, matching the
    prior ``_store`` behaviour exactly). Icon-only writes preserve raw records
    and update only changed icon fields.

    Returns the new custom list on success; raises 409 if every retry raced.
    """
    for _ in range(_CAS_RETRIES):
        doc = await user_categories_col.find_one({"user_id": uid})
        raw_before = doc.get("categories") if doc else None
        current = custom_categories(doc)
        previous_icons = {normalise_name(c["name"]): (c.get("icon_key"), c.get("icon_source")) for c in current}
        new_custom = mutate(current)
        new_stored = [
            {"name": c["name"], "kind": c["kind"], **(
                {"default_kind": c["default_kind"]} if c.get("default_kind") else {}
            ), **({"icon_key": c["icon_key"], "icon_source": c.get("icon_source") or "auto"}
                  if c.get("icon_key") else {})}
            for c in new_custom
        ]
        if icon_only:
            # An appearance change must not reserialise names, kinds or any
            # unrelated/malformed historical records. Change only icon fields
            # on the first matching stored entry, under the same raw-array CAS.
            changed = {normalise_name(c["name"]): c for c in new_custom
                       if previous_icons.get(normalise_name(c["name"])) != (c.get("icon_key"), c.get("icon_source"))}
            new_stored = []
            for entry in raw_before if isinstance(raw_before, list) else []:
                raw_name = entry.get("name") if isinstance(entry, dict) else entry
                key = normalise_name(raw_name) if isinstance(raw_name, str) else None
                category = changed.pop(key, None)
                if category is not None:
                    entry = dict(entry) if isinstance(entry, dict) else {"name": raw_name, "kind": category["kind"]}
                    entry.update(icon_key=category["icon_key"], icon_source=category["icon_source"])
                new_stored.append(entry)
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
    raise HTTPException(409, "Category list changed concurrently, please retry")


@router.get("/rules")
async def get_rules(user: dict = Depends(current_user)):
    uid  = user["email"]
    docs = await user_rules_col.find({"uid": uid, "removed_at": {"$exists": False}}).sort("created_at", -1).to_list(None)
    return {"rules": [
        {"id": str(d["_id"]), "description": d["description"],
         "pattern": d["pattern"], "category": d["category"],
         "created_at": d["created_at"].isoformat(),
         **({"kind": d["kind"], "identity": d.get("identity")}
            if d.get("kind") == "scoped-correction" else {})}
        for d in docs
    ]}


@router.post("/rules/parse")
async def parse_rule(body: dict, user: dict = Depends(current_user)):
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
        r = await openrouter_chat(
            {"model": "anthropic/claude-haiku-4-5", "max_tokens": 100,
             "messages": [{"role": "user", "content": prompt}]},
            user_id=user["email"], pipeline="categories_rule", client=http,
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
async def add_rule(body: dict, user: dict = Depends(current_user)):
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
    # A transfer-review choice can offer an "Always" rule from its nested
    # teaching sheet.  Its rows are still saved now, but join the review's
    # one close-time forecast rebuild rather than leaving the pending marker
    # absent because this route normally has no cashflow recompute of its own.
    if affected and body.get("defer_recompute") is True:
        from app.services.derived_caches import defer_transfer_review_recompute
        await defer_transfer_review_recompute(uid)
    # G358: wipe the response caches now (the bulk task below only bumps the
    # data version later), so a refetch straight after this response is fresh.
    await response_cache.ainvalidate(uid)

    async def _apply_rules_bulk_and_bump(u: str) -> None:
        await apply_rules_bulk(u)
        await data_version.bump(u)

    task = asyncio.create_task(_apply_rules_bulk_and_bump(uid))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return {
        "id": rule_id, "description": description, "pattern": pattern.lower(), "category": category,
        "affected": affected,
        "affected_ids": [a["id"] for a in affected],
    }


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, user: dict = Depends(current_user)):
    from app.services.scoped_correction_rules import TYPED_RULE_KIND
    from app.services.scoped_corrections import correction_lock

    uid = user["email"]
    async with correction_lock(uid):
        # A typed rule keeps an inactive revision so an interrupted save
        # cannot recreate it after the user removes it.
        result = await user_rules_col.update_one(
            {"_id": rule_id, "uid": uid, "kind": TYPED_RULE_KIND, "removed_at": {"$exists": False}},
            {"$set": {"removed_at": datetime.utcnow(), "operation_id": str(uuid_lib.uuid4())}},
        )
        if not result.modified_count:
            deleted = await user_rules_col.delete_one({
                "_id": rule_id, "uid": uid, "kind": {"$ne": TYPED_RULE_KIND},
            })
            if not deleted.deleted_count:
                raise HTTPException(404, "Rule not found")
    return {"deleted": rule_id}
