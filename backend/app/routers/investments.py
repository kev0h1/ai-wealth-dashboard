"""Investment account upload and management endpoints."""
import hashlib
import re
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY, TAVILY_API_KEY
from app.db.collections import investment_accounts_col, investment_holdings_col
from app.services.pdf import extract_pdf_text, llm_parse_investment_statement

router = APIRouter(tags=["investments"])


@router.get("/investment/accounts")
async def get_investment_accounts(user: dict = Depends(current_user)):
    uid  = user["email"]
    accs = await investment_accounts_col.find({"user_id": uid}).sort("updated_at", -1).to_list(None)
    return [
        {
            "id":                a["_id"],
            "provider":          a.get("provider", "Unknown"),
            "account_type":      a.get("account_type", ""),
            "account_reference": a.get("account_reference", ""),
            "currency":          a.get("currency", "GBP"),
            "total_value":       a.get("total_value", 0),
            "statement_date":    a.get("statement_date").isoformat() if a.get("statement_date") else None,
            "last_refreshed":    a.get("last_refreshed").isoformat() if a.get("last_refreshed") else None,
            "updated_at":        a.get("updated_at", datetime.now()).isoformat(),
        }
        for a in accs
    ]


@router.post("/investment/upload")
async def investment_upload(
    file: UploadFile,
    password: str = Form(default=""),
    user: dict = Depends(current_user),
):
    uid      = user["email"]
    content  = await file.read()
    filename = (file.filename or "").lower()

    if filename.endswith(".pdf") or content[:4] == b"%PDF":
        raw_text = await extract_pdf_text(content, password=password)
        if not raw_text.strip():
            raise HTTPException(422, "Could not extract text — wrong PDF password or unsupported format")
    else:
        try:
            raw_text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raw_text = content.decode("latin-1")

    if not raw_text.strip():
        raise HTTPException(422, "Could not extract text from file")

    parsed            = await llm_parse_investment_statement(raw_text)
    provider          = str(parsed.get("provider") or "Unknown")
    account_type      = str(parsed.get("account_type") or "")
    account_reference = str(parsed.get("account_reference") or "")
    currency          = str(parsed.get("currency") or "GBP")
    total_value       = float(parsed.get("total_value") or 0)
    statement_date_str = parsed.get("statement_date")
    holdings          = parsed.get("holdings", [])

    provider_slug = re.sub(r"[^a-z0-9]", "", provider.lower())
    ref_slug      = re.sub(r"[^a-z0-9]", "", account_reference.lower())[:12]
    acc_id        = (
        f"inv-{uid}-{provider_slug}-{ref_slug}"
        if ref_slug
        else f"inv-{uid}-{provider_slug}-{hashlib.sha256(uid.encode()).hexdigest()[:8]}"
    )

    try:
        statement_date = datetime.fromisoformat(statement_date_str) if statement_date_str else datetime.now()
    except (ValueError, TypeError):
        statement_date = datetime.now()

    await investment_accounts_col.update_one(
        {"_id": acc_id},
        {"$set": {
            "user_id": uid, "provider": provider, "account_type": account_type,
            "account_reference": account_reference, "currency": currency,
            "total_value": total_value, "statement_date": statement_date, "updated_at": datetime.now(),
        }},
        upsert=True,
    )

    await investment_holdings_col.delete_many({"account_id": acc_id})
    holdings_saved = 0
    if isinstance(holdings, list):
        for h in holdings:
            if not isinstance(h, dict):
                continue
            name = str(h.get("name") or "").strip()
            if not name:
                continue
            holding_id = hashlib.sha256(f"{acc_id}|{name}".encode()).hexdigest()[:20]
            try:
                val = float(h.get("value") or 0)
            except (TypeError, ValueError):
                val = 0.0
            await investment_holdings_col.update_one(
                {"_id": holding_id},
                {"$set": {
                    "account_id": acc_id, "user_id": uid, "name": name,
                    "isin": h.get("isin"), "type": str(h.get("type") or "Fund"),
                    "units": h.get("units"), "price_per_unit": h.get("price_per_unit"),
                    "statement_value": val, "current_price": None,
                    "current_value": None, "last_refreshed": None,
                }},
                upsert=True,
            )
            holdings_saved += 1

    return {
        "account_id": acc_id, "provider": provider, "account_type": account_type,
        "account_reference": account_reference, "total_value": total_value,
        "holdings_count": holdings_saved,
    }


@router.get("/investment/accounts/{account_id}/holdings")
async def get_investment_holdings(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    acc = await investment_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Investment account not found")
    holdings = await investment_holdings_col.find({"account_id": account_id}).to_list(None)
    return [
        {
            "id": h["_id"], "name": h.get("name"), "isin": h.get("isin"),
            "type": h.get("type", "Fund"), "units": h.get("units"),
            "price_per_unit": h.get("price_per_unit"), "statement_value": h.get("statement_value", 0),
            "current_price": h.get("current_price"), "current_value": h.get("current_value"),
            "last_refreshed": h.get("last_refreshed").isoformat() if h.get("last_refreshed") else None,
        }
        for h in holdings
    ]


@router.delete("/investment/accounts/{account_id}")
async def delete_investment_account(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    acc = await investment_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Investment account not found")
    await investment_holdings_col.delete_many({"account_id": account_id})
    await investment_accounts_col.delete_one({"_id": account_id})
    return {"deleted": account_id}


@router.post("/investment/accounts/{account_id}/refresh")
async def refresh_investment_prices(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    acc = await investment_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Investment account not found")
    if not TAVILY_API_KEY:
        raise HTTPException(422, "Tavily API key not configured — add TAVILY_API_KEY to backend/.env")

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

                snippets     = "\n\n".join(f"Source: {res.get('url', '')}\n{res.get('content', '')[:500]}" for res in results[:3])
                price_prompt = (
                    f'Extract the current unit/NAV price in GBP for this holding: "{name}" (ISIN: {isin or "N/A"}).\n'
                    f"Search results:\n{snippets}\n\n"
                    f"Return ONLY a JSON number (e.g. 289.95) or null if the price cannot be determined. No other text."
                )
                lr = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
                    json={"model": "google/gemini-2.5-flash", "messages": [{"role": "user", "content": price_prompt}], "temperature": 0},
                    timeout=30,
                )
                if lr.status_code != 200:
                    new_total += stmt_val
                    continue

                price_raw     = lr.json()["choices"][0]["message"]["content"].strip().strip("`").strip()
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
