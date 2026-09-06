"""Investment price refresh service — used by router and daily cron."""
import logging
from datetime import datetime

import httpx

from app.core.config import TAVILY_API_KEY
from app.core.llm import openrouter_chat
from app.db.collections import investment_accounts_col, investment_holdings_col

logger = logging.getLogger(__name__)


async def refresh_account_prices(acc: dict) -> dict:
    """Fetch live prices for all holdings in `acc`, write updates to DB.

    Returns {"updated": int, "new_total": float}.
    acc must be the raw document from investment_accounts_col.
    """
    account_id    = acc["_id"]
    holdings      = await investment_holdings_col.find({"account_id": account_id}).to_list(None)
    updated_count = 0
    new_total     = 0.0

    async with httpx.AsyncClient(timeout=60) as client:
        for h in holdings:
            name     = h.get("name", "")
            isin     = h.get("isin")
            units    = h.get("units")
            stmt_val = h.get("statement_value", 0)
            query    = f"{isin} fund unit price GBP" if isin else f"{name} fund unit price GBP today"
            try:
                tr = await client.post(
                    "https://api.tavily.com/search",
                    json={"api_key": TAVILY_API_KEY, "query": query, "search_depth": "basic", "max_results": 3},
                )
                if tr.status_code != 200:
                    new_total += stmt_val
                    continue
                results = tr.json().get("results", [])
                if not results:
                    new_total += stmt_val
                    continue

                snippets     = "\n\n".join(
                    f"Source: {res.get('url', '')}\n{res.get('content', '')[:500]}"
                    for res in results[:3]
                )
                price_prompt = (
                    f'Extract the current unit/NAV price in GBP for this holding: "{name}" (ISIN: {isin or "N/A"}).\n'
                    f"Search results:\n{snippets}\n\n"
                    f"Return ONLY a JSON number (e.g. 289.95) or null if the price cannot be determined. No other text."
                )
                lr = await openrouter_chat(
                    {
                        "model": "google/gemini-2.5-flash",
                        "messages": [{"role": "user", "content": price_prompt}],
                        "temperature": 0,
                    },
                    user_id=None, pipeline="investment_prices", timeout=30,
                )
                if lr.status_code != 200:
                    new_total += stmt_val
                    continue

                price_raw = lr.json()["choices"][0]["message"]["content"].strip().strip("`").strip()
                try:
                    current_price = float(price_raw) if price_raw.lower() != "null" else None
                except ValueError:
                    current_price = None

                current_value = round(units * current_price, 2) if units and current_price else None
                await investment_holdings_col.update_one(
                    {"_id": h["_id"]},
                    {"$set": {"current_price": current_price, "current_value": current_value, "last_refreshed": datetime.now()}},
                )
                new_total += current_value if current_value is not None else stmt_val
                if current_price is not None:
                    updated_count += 1
            except Exception:
                new_total += stmt_val
                continue

    if updated_count > 0 or holdings:
        await investment_accounts_col.update_one(
            {"_id": account_id},
            {"$set": {"total_value": new_total, "last_refreshed": datetime.now()}},
        )

    return {"updated": updated_count, "new_total": round(new_total, 2)}
