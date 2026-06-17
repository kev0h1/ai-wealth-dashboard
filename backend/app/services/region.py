"""Region detection and Kenya transaction aggregation."""
from app.db.collections import (
    preferences_col, mono_transactions_col,
    mpesa_transactions_col, statement_transactions_col,
)


async def get_user_region(uid: str) -> str:
    doc = await preferences_col.find_one({"user_id": uid})
    return doc.get("region", "UK") if doc else "UK"


async def get_kenya_transactions(uid: str, cutoff=None) -> list:
    q: dict = {"user_id": uid}
    if cutoff:
        q["date"] = {"$gte": cutoff}
    mono  = await mono_transactions_col.find(q).to_list(None)
    mpesa = await mpesa_transactions_col.find(q).to_list(None)
    stmt  = await statement_transactions_col.find(q).to_list(None)
    return mono + mpesa + stmt
