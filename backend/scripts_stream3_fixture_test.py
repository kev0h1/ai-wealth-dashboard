"""ENGINE.md Build Stream 3 — teaching-endpoints fixture round trip.

WRITES ONLY to the isolated fixture user (FIXTURE_UID) — never to a real
user. Exercises the live API (systemctl service on localhost:8000) exactly
as a real client would: mints a session token for the fixture user with the
app's own serializer (never touches BOT_SECRET, which resolves to the real
kevin.maingi12@gmail.com identity and must never be used for writes).

Cleans up every fixture doc it created, in every collection, at the end
(best-effort — runs even if an assertion fails, via try/finally).
"""
import asyncio
import sys
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone

import httpx
from bson import ObjectId

from app.core.config import serializer
from app.db.collections import (
    transactions_col, teaching_events_col, manual_accounts_col,
    commitments_col, user_categories_col, user_rules_col,
    merchant_categories_col, subscriptions_col,
)
from app.services.categorisation import canonical_merchant_key

FIXTURE_UID = "fixture-engine@test.local"
BASE_URL = "http://localhost:8000"

PLAYTOMIC_DESCS = [
    "PLAYTOMIC* PI-C096 ON 10 JUN BCC",
    "PLAYTOMIC.IO 0987A SPAIN ON 25 FEB BCC",
    "PLAYTOMIC* PI-AA2E ON 25 JUN BCC",
    "PLAYTOMIC* PI-F0D6 ON 11 JUL BCC",
]
PLAYTOMIC_KEY = canonical_merchant_key("", PLAYTOMIC_DESCS[0])

failures: list[str] = []


def check(label: str, cond: bool, detail: str = ""):
    status = "OK" if cond else "FAIL"
    print(f"[{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(f"{label}: {detail}")


async def cleanup():
    await transactions_col.delete_many({"user_id": FIXTURE_UID})
    await teaching_events_col.delete_many({"user_id": FIXTURE_UID})
    await manual_accounts_col.delete_many({"user_id": FIXTURE_UID})
    await commitments_col.delete_many({"user_id": FIXTURE_UID})
    await user_categories_col.delete_many({"user_id": FIXTURE_UID})
    await user_rules_col.delete_many({"uid": FIXTURE_UID})
    await subscriptions_col.delete_many({"user_id": FIXTURE_UID})
    # merchant_categories_col: both the global key (VALID_CATEGORIES writes)
    # and the uid-scoped key (custom-category writes, Firewall Rule).
    await merchant_categories_col.delete_many({
        "$or": [{"_id": PLAYTOMIC_KEY}, {"_id": {"$regex": f"^{FIXTURE_UID}::"}},
                {"uid": FIXTURE_UID}],
    })


async def main():
    await cleanup()  # in case a previous run left something behind

    token = serializer.dumps({"email": FIXTURE_UID, "name": "Fixture Engine"})
    headers = {"Authorization": f"Bearer {token}"}

    now = datetime.now(timezone.utc)

    # --- fixture transactions ------------------------------------------------
    tx_ids = {}

    async def insert_tx(key: str, *, description: str, amount: float,
                         txn_type: str = "debit", category="Other", days_ago=1):
        _id = f"fixture-{uuid_lib.uuid4().hex[:12]}"
        mkey = canonical_merchant_key("", description)
        await transactions_col.insert_one({
            "_id": _id, "user_id": FIXTURE_UID, "account_id": "fixture-acct",
            "description": description, "merchant_name": None,
            "amount": amount, "transaction_type": txn_type,
            "category": category, "custom_category": None,
            "merchant_key": mkey,
            "date": now - timedelta(days=days_ago),
        })
        tx_ids[key] = _id
        return _id, mkey

    # 4 Playtomic rows: tx_A is the one we correct; the other 3 make matches_past == 3
    primary_id, primary_key = await insert_tx("playtomic_primary", description=PLAYTOMIC_DESCS[0], amount=48.0)
    for i, d in enumerate(PLAYTOMIC_DESCS[1:], start=1):
        await insert_tx(f"playtomic_decoy_{i}", description=d, amount=44.0 + i, days_ago=10 + i)

    wise_someone_id, wise_someone_key = await insert_tx(
        "wise_someone_else", description="WISE *8827 TRANSFER MUM", amount=1020.0)
    wise_goal_id, wise_goal_key = await insert_tx(
        "wise_goal", description="WISE *9911 TRANSFER HOUSE", amount=500.0)
    wise_offline_id, wise_offline_key = await insert_tx(
        "wise_offline", description="WISE *1234 TRANSFER SAVER", amount=300.0)
    spend_id, spend_key = await insert_tx(
        "spend_target", description="ZARA LONDON ON 01 AUG CPM", amount=62.0)

    # A row we'll mis-resolve as movement then walk back via resolution=spending.
    undo_id, undo_key = await insert_tx(
        "undo_target", description="WISE *4477 TRANSFER UNDO", amount=75.0)

    # --- fixture custom category + PRO subscription (for /rules) -------------
    await user_categories_col.update_one(
        {"user_id": FIXTURE_UID},
        {"$set": {"categories": [{"name": "Padel", "kind": "discretionary"}]}},
        upsert=True,
    )
    await subscriptions_col.update_one(
        {"user_id": FIXTURE_UID},
        {"$set": {"user_id": FIXTURE_UID, "tier": "pro", "status": "active"}},
        upsert=True,
    )

    # --- fixture goal (commitment) ---------------------------------------------
    goal_oid = ObjectId()
    await commitments_col.insert_one({
        "_id": goal_oid, "user_id": FIXTURE_UID, "name": "House Fund",
        "amount": 5000.0, "target_date": "2027-01-01", "funding_pots": [],
        "contributed": 0.0, "source": "manual", "status": "active",
        "created_at": now,
    })

    async with httpx.AsyncClient(base_url=BASE_URL, headers=headers, timeout=20) as c:
        # ---- 1. PATCH /transactions/{id} — propagation payload ----
        r = await c.patch(f"/transactions/{primary_id}", json={"category": "Padel"})
        check("PATCH correction — 200", r.status_code == 200, r.text)
        body = r.json()
        check("PATCH — merchant_key echoed", body.get("merchant_key") == primary_key, body)
        check("PATCH — matches_past == 3", body.get("matches_past") == 3, body)
        rs = body.get("rule_suggestion") or {}
        check("PATCH — rule_suggestion.category == Padel", rs.get("category") == "Padel", rs)
        import re as _re
        pat = rs.get("pattern", "")
        check("PATCH — rule pattern matches a real Playtomic line",
              bool(pat) and _re.search(pat, PLAYTOMIC_DESCS[2].lower()) is not None, pat)
        check("PATCH — rule pattern does NOT match unrelated text",
              bool(pat) and _re.search(pat, "not playtomicx at all") is None, pat)

        cache_doc = await merchant_categories_col.find_one({"_id": f"{FIXTURE_UID}::{primary_key}"})
        check("PATCH — custom category cached user-scoped (Firewall Rule)",
              bool(cache_doc) and cache_doc.get("category") == "Padel", cache_doc)
        global_leak = await merchant_categories_col.find_one({"_id": primary_key})
        check("PATCH — custom category NOT leaked to global cache",
              global_leak is None, global_leak)

        ev = await teaching_events_col.find_one({"user_id": FIXTURE_UID, "type": "correction",
                                                    "transaction_id": primary_id})
        check("PATCH — teaching_event 'correction' written", bool(ev), ev)

        # ---- 2. POST /rules with a custom category + identity-derived pattern ----
        r = await c.post("/rules", json={
            "description": "Padel via Playtomic", "pattern": pat, "category": "Padel",
        })
        check("POST /rules accepts custom category (not gated on VALID_CATEGORIES)",
              r.status_code == 200, r.text)
        rule_id = r.json().get("id") if r.status_code == 200 else None
        if rule_id:
            rd = await c.delete(f"/rules/{rule_id}")
            check("DELETE /rules cleanup", rd.status_code == 200, rd.text)

        r_bad = await c.post("/rules", json={
            "description": "bogus", "pattern": r"\bfoo\b", "category": "NotARealCategory",
        })
        check("POST /rules rejects unknown category", r_bad.status_code == 400, r_bad.text)

        # ---- 3. resolve-movement: mine-goal ----
        r = await c.post(f"/transactions/{wise_goal_id}/resolve-movement",
                          json={"resolution": "mine-goal", "goal_id": str(goal_oid)})
        check("resolve-movement mine-goal — 200", r.status_code == 200, r.text)
        b = r.json()
        check("mine-goal — custom_category == Transfer", b.get("custom_category") == "Transfer", b)
        check("mine-goal — linked_goal_id echoed", b.get("linked_goal_id") == str(goal_oid), b)
        doc = await transactions_col.find_one({"_id": wise_goal_id})
        check("mine-goal — persisted on the row", doc.get("custom_category") == "Transfer"
              and doc.get("linked_goal_id") == str(goal_oid), doc)
        ev = await teaching_events_col.find_one({"user_id": FIXTURE_UID, "type": "movement_mine_goal",
                                                    "transaction_id": wise_goal_id})
        check("mine-goal — teaching_event written", bool(ev), ev)

        r_404 = await c.post(f"/transactions/{wise_goal_id}/resolve-movement",
                              json={"resolution": "mine-goal", "goal_id": str(ObjectId())})
        check("mine-goal — 404 for a goal that doesn't exist (no half-linked state)",
              r_404.status_code == 404, r_404.text)

        # ---- 4. resolve-movement: mine-offline ----
        r = await c.post(f"/transactions/{wise_offline_id}/resolve-movement",
                          json={"resolution": "mine-offline", "offline_pot_name": "Kevin's Fixture ISA"})
        check("resolve-movement mine-offline — 200", r.status_code == 200, r.text)
        b = r.json()
        offline_acc_id = b.get("linked_offline_account_id")
        check("mine-offline — custom_category == Transfer", b.get("custom_category") == "Transfer", b)
        acc = await manual_accounts_col.find_one({"_id": offline_acc_id, "user_id": FIXTURE_UID})
        check("mine-offline — manual_accounts_col pot created (full linking shipped)",
              bool(acc) and acc.get("name") == "Kevin's Fixture ISA", acc)
        ev = await teaching_events_col.find_one({"user_id": FIXTURE_UID, "type": "movement_mine_offline",
                                                    "transaction_id": wise_offline_id})
        check("mine-offline — teaching_event written", bool(ev), ev)

        # Same pot name again on a fresh row — must REUSE, not duplicate.
        _id2, _ = await insert_tx("wise_offline_2", description="WISE *5566 TRANSFER SAVER2", amount=80.0)
        r2 = await c.post(f"/transactions/{_id2}/resolve-movement",
                           json={"resolution": "mine-offline", "offline_pot_name": "kevin's fixture isa"})
        check("mine-offline — reuses existing pot by case-insensitive name",
              r2.json().get("linked_offline_account_id") == offline_acc_id, r2.json())
        dupe_count = await manual_accounts_col.count_documents(
            {"user_id": FIXTURE_UID, "name": {"$regex": "^kevin's fixture isa$", "$options": "i"}})
        check("mine-offline — no duplicate pot created", dupe_count == 1, dupe_count)

        # No name given — default "An account of mine elsewhere".
        _id3, _ = await insert_tx("wise_offline_default", description="WISE *7788 TRANSFER X", amount=20.0)
        r3 = await c.post(f"/transactions/{_id3}/resolve-movement", json={"resolution": "mine-offline"})
        check("mine-offline — default pot name when omitted",
              r3.json().get("offline_pot_name") == "An account of mine elsewhere", r3.json())

        # ---- 5. resolve-movement: someone-else ----
        r = await c.post(f"/transactions/{wise_someone_id}/resolve-movement",
                          json={"resolution": "someone-else", "note": "sent to mum"})
        check("resolve-movement someone-else — 200", r.status_code == 200, r.text)
        doc = await transactions_col.find_one({"_id": wise_someone_id})
        check("someone-else — category NOT forced to movement (kept spend kind)",
              doc.get("custom_category") is None, doc)
        ev = await teaching_events_col.find_one({"user_id": FIXTURE_UID, "type": "movement_someone_else",
                                                    "transaction_id": wise_someone_id})
        check("someone-else — user-scoped fact recorded on the teaching stream",
              bool(ev) and ev.get("payload", {}).get("note") == "sent to mum", ev)
        global_cat_write = await merchant_categories_col.find_one({"_id": wise_someone_key})
        check("someone-else — never written to the merchant cache as a category",
              global_cat_write is None, global_cat_write)

        # ---- 6. resolve-movement: spending (normal correction path) ----
        r = await c.post(f"/transactions/{spend_id}/resolve-movement",
                          json={"resolution": "spending", "category": "Shopping"})
        check("resolve-movement spending w/ category — 200", r.status_code == 200, r.text)
        doc = await transactions_col.find_one({"_id": spend_id})
        check("spending — custom_category set", doc.get("custom_category") == "Shopping", doc)
        global_cache = await merchant_categories_col.find_one({"_id": spend_key})
        check("spending — VALID_CATEGORIES write goes to the GLOBAL cache",
              bool(global_cache) and global_cache.get("category") == "Shopping", global_cache)

        # ---- 7. resolve-movement: spending undoes a prior movement mis-resolution ----
        r = await c.post(f"/transactions/{undo_id}/resolve-movement",
                          json={"resolution": "mine-goal", "goal_id": str(goal_oid)})
        check("undo setup — mine-goal applied first", r.status_code == 200, r.text)
        r2 = await c.post(f"/transactions/{undo_id}/resolve-movement", json={"resolution": "spending"})
        check("resolve-movement spending w/o category — 200", r2.status_code == 200, r2.text)
        doc = await transactions_col.find_one({"_id": undo_id})
        check("spending (no category) — reverted custom_category to None",
              doc.get("custom_category") is None, doc)
        check("spending (no category) — cleared linked_goal_id",
              "linked_goal_id" not in doc, doc)

        # ---- 8. bad resolution value ----
        r_bad = await c.post(f"/transactions/{spend_id}/resolve-movement", json={"resolution": "bogus"})
        check("resolve-movement rejects unknown resolution", r_bad.status_code == 400, r_bad.text)

        # ---- 9. missing transaction ----
        r_404 = await c.post("/transactions/does-not-exist/resolve-movement",
                              json={"resolution": "spending"})
        check("resolve-movement 404 for unknown transaction", r_404.status_code == 404, r_404.text)


async def run_all():
    try:
        await main()
    finally:
        await cleanup()


if __name__ == "__main__":
    asyncio.run(run_all())
    if failures:
        print(f"\n{len(failures)} FAILURE(S):")
        for f in failures:
            print(f" - {f}")
        sys.exit(1)
    print("\nAll checks passed.")
