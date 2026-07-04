"""Transport & Mobility insights endpoint."""
from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.db.collections import (
    transactions_col, yapily_transactions_col,
    statement_transactions_col,
)
from app.services.transport import analyse_transport

router = APIRouter(tags=["transport"])


@router.get("/transport/summary")
async def get_transport_summary(user: dict = Depends(current_user)):
    uid = user["email"]

    # Pull 90 days from all transaction sources
    from datetime import datetime, timedelta
    cutoff = datetime.now() - timedelta(days=90)
    proj = {"merchant_name": 1, "description": 1, "amount": 1,
            "date": 1, "transaction_type": 1, "category": 1}

    raw = await transactions_col.find({"user_id": uid, "date": {"$gte": cutoff}}, proj).to_list(None)
    raw += await yapily_transactions_col.find({"user_id": uid, "date": {"$gte": cutoff}}, proj).to_list(None)
    raw += await statement_transactions_col.find({"user_id": uid, "date": {"$gte": cutoff}}, proj).to_list(None)

    return analyse_transport(raw, period_days=90)
