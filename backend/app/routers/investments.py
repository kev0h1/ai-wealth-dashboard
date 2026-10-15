"""Investment account upload and management endpoints."""
import hashlib
import re
from datetime import datetime

from typing import Literal

from fastapi import APIRouter, Body, Depends, Form, HTTPException, Query, UploadFile
from pymongo.errors import DuplicateKeyError

from app.core.auth import current_user
from app.core import timeutil
from app.db.collections import investment_accounts_col, investment_holdings_col, investment_notes_col, investment_valuations_col
from app.services import investment_anchor as ia
from app.services.investment_growth import account_growth, build_positions
from app.services.pdf import extract_pdf_text, llm_parse_investment_statement, llm_parse_contract_note
from app.core.timeutil import as_utc, to_user_date
from app.services.investment_prices import (
    get_instruments, holding_value, legacy_price, instrument_key, refresh_account_prices,
)

router = APIRouter(tags=["investments"])


def clean_book_cost(v) -> float | None:
    """G277: the statement's book cost for one holding, or None. Zero, negative,
    non-numeric and non-finite values read as not shown, never as a cost."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return round(f, 2) if f == f and f not in (float("inf"),) and f > 0 else None


def _stmt_date_or_none(v):
    """The statement's closing day as a date, or None when the statement did not give one."""
    return ia.as_date(v)


async def _notes_for_account(account_id: str, statement_date: datetime | None) -> list[dict]:
    """Return all contract notes for this account, newest first."""
    return await investment_notes_col.find({"account_id": account_id}).sort("trade_date", -1).to_list(None)


async def _investment_display(acc: dict, notes: list[dict] | None = None) -> dict:
    """Compute display fields for an investment account dict."""
    account_id = acc["_id"]
    statement_date = acc.get("statement_date")
    if notes is None:
        notes = await _notes_for_account(account_id, statement_date)

    added_since = 0.0
    notes_since = 0
    paid_in_since = 0.0  # G278: money paid in since the statement; a fee-driven sale is not a contribution
    fee_lines = ia.all_fee_lines(acc.get("statement_periods") or [])
    if statement_date:
        # statement_date may be date-only; normalise to datetime for comparison
        sd = statement_date if isinstance(statement_date, datetime) else datetime.combine(statement_date, datetime.min.time())
        for n in notes:
            td = n.get("trade_date")
            if td and td > sd:
                added_since += n.get("amount", 0.0)
                notes_since += 1
                if not ia.is_fee_note(n, fee_lines):
                    paid_in_since += n.get("amount", 0.0)
    else:
        # No statement yet — all notes count
        for n in notes:
            added_since += n.get("amount", 0.0)
            notes_since += 1
            if not ia.is_fee_note(n, fee_lines):
                paid_in_since += n.get("amount", 0.0)

    total_value = acc.get("total_value", 0.0)
    display_value = round(total_value + added_since, 2)
    return {
        "id":                account_id,
        "provider":          acc.get("provider", "Unknown"),
        "account_type":      acc.get("account_type", ""),
        "account_reference": acc.get("account_reference", ""),
        "currency":          acc.get("currency", "GBP"),
        "total_value":       total_value,
        "added_since":       round(added_since, 2),
        "paid_in_since":     round(paid_in_since, 2),
        "has_anchor":        bool(acc.get("anchor")),
        "has_statement_periods": bool(acc.get("statement_periods")),
        "notes_since":       notes_since,
        "display_value":     display_value,
        "statement_date":    acc.get("statement_date").isoformat() if acc.get("statement_date") else None,
        "last_refreshed":    acc.get("last_refreshed").isoformat() if acc.get("last_refreshed") else None,
        "updated_at":        acc.get("updated_at", datetime.now()).isoformat(),
        "provisional":       acc.get("provisional", False),
    }


async def _extract_and_parse_note(file: UploadFile, password: str) -> tuple[str, dict]:
    """Extract text from upload and parse as contract note.

    Returns (raw_text, parsed_dict).
    Raises HTTPException 422 if extraction fails, text is empty, or the
    document is classified as a statement rather than a contract note.
    """
    content  = await file.read()
    filename = (file.filename or "").lower()

    if filename.endswith(".pdf") or content[:4] == b"%PDF":
        raw_text = await extract_pdf_text(content, password=password)
        if not raw_text.strip():
            raise HTTPException(422, "Could not extract text, wrong PDF password or unsupported format")
    else:
        try:
            raw_text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raw_text = content.decode("latin-1")

    if not raw_text.strip():
        raise HTTPException(422, "Could not extract text from file")

    parsed = await llm_parse_contract_note(raw_text)

    if parsed.get("doc_type") == "statement":
        raise HTTPException(
            422,
            "This looks like a statement, not a contract note, use Upload statement instead. Statements set the value; contract notes add trades on top.",
        )

    return raw_text, parsed


@router.get("/investment/accounts")
async def get_investment_accounts(user: dict = Depends(current_user)):
    uid  = user["email"]
    accs = await investment_accounts_col.find({"user_id": uid}).sort("updated_at", -1).to_list(None)
    return [await _investment_display(a) for a in accs]


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
            raise HTTPException(422, "Could not extract text, wrong PDF password or unsupported format")
    else:
        try:
            raw_text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raw_text = content.decode("latin-1")

    if not raw_text.strip():
        raise HTTPException(422, "Could not extract text from file")

    parsed            = await llm_parse_investment_statement(raw_text)

    # Guard: contract note uploaded to statement flow
    if parsed.get("doc_type") == "contract_note":
        raise HTTPException(422, "This looks like a contract note, not a statement, use Add contract note instead. A contract note only adds one trade; a statement sets the whole value.")

    provider          = str(parsed.get("provider") or "Unknown")
    account_type      = str(parsed.get("account_type") or "")
    account_reference = str(parsed.get("account_reference") or "")
    currency          = str(parsed.get("currency") or "GBP")
    total_value       = float(parsed.get("total_value") or 0)
    statement_date_str = parsed.get("statement_date")
    holdings          = parsed.get("holdings", [])
    # G278: the period figures printed on the statement, never estimated.
    period_closing    = _stmt_date_or_none(statement_date_str)
    period            = ia.clean_period(parsed, total_value, period_closing)

    provider_slug = re.sub(r"[^a-z0-9]", "", provider.lower())
    ref_slug      = re.sub(r"[^a-z0-9]", "", account_reference.lower())[:12]
    acc_id        = (
        f"inv-{uid}-{provider_slug}-{ref_slug}"
        if ref_slug
        else f"inv-{uid}-{provider_slug}-{hashlib.sha256(uid.encode()).hexdigest()[:8]}"
    )

    try:
        statement_date = datetime.fromisoformat(statement_date_str) if statement_date_str else timeutil.user_now().replace(tzinfo=None)
    except (ValueError, TypeError):
        statement_date = timeutil.user_now().replace(tzinfo=None)

    # Provisional id-alignment: if the derived acc_id is new but the user has
    # exactly one PROVISIONAL account for this provider_slug, write to that
    # provisional account's id instead so notes stay attached.
    provisional_check = await investment_accounts_col.find_one({"_id": acc_id})
    if not provisional_check:
        prov_prefix = f"inv-{uid}-{provider_slug}-"
        prov_candidates = await investment_accounts_col.find(
            {"user_id": uid, "_id": {"$regex": f"^{re.escape(prov_prefix)}"}, "provisional": True}
        ).to_list(None)
        if len(prov_candidates) == 1:
            acc_id = prov_candidates[0]["_id"]

    # Stale-statement guard: reject if incoming statement is older than stored one
    existing = await investment_accounts_col.find_one({"_id": acc_id})
    if existing:
        stored_date = existing.get("statement_date")
        if stored_date and statement_date < stored_date:
            stored_fmt   = stored_date.strftime("%-d %b %Y")
            incoming_fmt = statement_date.strftime("%-d %b %Y")
            raise HTTPException(
                422,
                f"This account already has a statement from {stored_fmt}; the uploaded one ({incoming_fmt}) is older and would rewind the value.",
            )

    acc_set = {
        "user_id": uid, "provider": provider, "account_type": account_type,
        "account_reference": account_reference, "currency": currency,
        "total_value": total_value, "statement_date": statement_date,
        "provisional": False, "updated_at": datetime.now(),
    }
    if period is not None:
        acc_set["statement_periods"] = ia.upsert_period((existing or {}).get("statement_periods"), period)
    await investment_accounts_col.update_one({"_id": acc_id}, {"$set": acc_set}, upsert=True)

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
            book_cost = clean_book_cost(h.get("book_cost"))
            await investment_holdings_col.update_one(
                {"_id": holding_id},
                {"$set": {
                    "account_id": acc_id, "user_id": uid, "name": name,
                    "isin": h.get("isin"), "type": str(h.get("type") or "Fund"),
                    "units": h.get("units"), "price_per_unit": h.get("price_per_unit"),
                    "statement_value": val,
                    # G277: only what the statement itself shows, never inferred
                    "book_cost": book_cost,
                    "book_cost_source": "statement" if book_cost is not None else None,
                    # G270: the price lives once per instrument in instrument_prices
                    "instrument_key": instrument_key(h.get("isin"), h.get("ticker"), name),
                }, "$unset": {"current_price": "", "current_value": "", "last_refreshed": ""}},
                upsert=True,
            )
            holdings_saved += 1

    return {
        "account_id": acc_id, "provider": provider, "account_type": account_type,
        "account_reference": account_reference, "total_value": total_value,
        "holdings_count": holdings_saved, "period_captured": period is not None,
    }


@router.post("/investment/accounts/{account_id}/notes/upload")
async def upload_contract_note(
    account_id: str,
    file: UploadFile,
    password: str = Form(default=""),
    user: dict = Depends(current_user),
):
    uid             = user["email"]
    _raw_text, parsed = await _extract_and_parse_note(file, password)

    # Guard: statement uploaded to contract-note flow (already handled in helper)

    # Load and validate account
    acc = await investment_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Investment account not found")

    stmt_date = acc.get("statement_date")

    # Parse trade date
    trade_date_str = parsed.get("trade_date")
    if not trade_date_str:
        raise HTTPException(422, "Couldn't read a trade date from this document, it's needed to place the note against your statements.")
    try:
        trade_date = datetime.fromisoformat(trade_date_str)
    except (ValueError, TypeError):
        raise HTTPException(422, "Couldn't read a trade date from this document, it's needed to place the note against your statements.")

    # Invariant 1: trade_date must be after statement_date (skip when None)
    if stmt_date:
        sd = stmt_date if isinstance(stmt_date, datetime) else datetime.combine(stmt_date, datetime.min.time())
        if trade_date <= sd:
            raise HTTPException(
                422,
                f"This contract note is dated {trade_date.strftime('%-d %b %Y')}, on or before your latest statement ({sd.strftime('%-d %b %Y')}), so its value is already counted. Only notes newer than the statement can be added.",
            )

    # Extract other fields
    kind           = str(parsed.get("kind") or "purchase").lower()
    raw_amount     = float(parsed.get("amount") or 0)
    amount         = raw_amount if kind not in ("sale", "fee") else -raw_amount
    fund_name      = str(parsed.get("fund_name") or "").strip()
    units          = parsed.get("units")
    price_per_unit = parsed.get("price_per_unit")
    reference      = parsed.get("reference") or None
    provider       = str(parsed.get("provider") or acc.get("provider") or "Unknown")

    # Invariant 2: deduplicate
    if reference:
        note_id = hashlib.sha256(f"{account_id}|ref:{reference}".encode()).hexdigest()[:24]
    else:
        note_id = hashlib.sha256(f"{account_id}|{trade_date_str}|{raw_amount:.2f}|{fund_name.lower().strip()}".encode()).hexdigest()[:24]

    note_doc = {
        "_id":            note_id,
        "user_id":        uid,
        "account_id":     account_id,
        "trade_date":     trade_date,
        "kind":           kind,
        "amount":         amount,
        "fund_name":      fund_name,
        "units":          units,
        "price_per_unit": price_per_unit,
        "reference":      reference,
        "provider":       provider,
        "created_at":     datetime.now(),
    }

    try:
        await investment_notes_col.insert_one(note_doc)
    except DuplicateKeyError:
        raise HTTPException(
            422,
            f"This contract note looks like one you've already added ({fund_name} · {trade_date.strftime('%-d %b %Y')} · £{raw_amount:,.2f}). Duplicates would double-count the trade.",
        )

    acc_fresh   = await investment_accounts_col.find_one({"_id": account_id})
    acc_display = await _investment_display(acc_fresh)

    return {
        "note": {
            "id":         note_id,
            "trade_date": trade_date.isoformat(),
            "kind":       kind,
            "amount":     amount,
            "fund_name":  fund_name,
            "units":      units,
            "reference":  reference,
        },
        "account": acc_display,
    }


@router.post("/investment/notes/upload")
async def upload_contract_note_global(
    file: UploadFile,
    password: str = Form(default=""),
    user: dict = Depends(current_user),
):
    """Upload a contract note without specifying an account.

    Account resolution:
    - Derive provider_slug from parsed provider.
    - If the user has EXACTLY ONE account with that provider_slug prefix, attach to it.
    - Otherwise create a provisional account (total_value=0, statement_date=None).
    """
    uid               = user["email"]
    _raw_text, parsed = await _extract_and_parse_note(file, password)

    # Parse trade date
    trade_date_str = parsed.get("trade_date")
    if not trade_date_str:
        raise HTTPException(422, "Couldn't read a trade date from this document, it's needed to place the note against your statements.")
    try:
        trade_date = datetime.fromisoformat(trade_date_str)
    except (ValueError, TypeError):
        raise HTTPException(422, "Couldn't read a trade date from this document, it's needed to place the note against your statements.")

    # Extract fields
    kind              = str(parsed.get("kind") or "purchase").lower()
    raw_amount        = float(parsed.get("amount") or 0)
    amount            = raw_amount if kind not in ("sale", "fee") else -raw_amount
    fund_name         = str(parsed.get("fund_name") or "").strip()
    units             = parsed.get("units")
    price_per_unit    = parsed.get("price_per_unit")
    reference         = parsed.get("reference") or None
    provider          = str(parsed.get("provider") or "Unknown")
    account_reference = str(parsed.get("account_reference") or "")

    provider_slug = re.sub(r"[^a-z0-9]", "", provider.lower())

    # Account resolution
    prefix = f"inv-{uid}-{provider_slug}-"
    existing_accs = await investment_accounts_col.find(
        {"user_id": uid, "_id": {"$regex": f"^{re.escape(prefix)}"}}
    ).to_list(None)

    if len(existing_accs) == 1:
        # Attach to the single matching account
        acc        = existing_accs[0]
        account_id = acc["_id"]
        stmt_date  = acc.get("statement_date")

        # Invariant 1: skip when statement_date is None (provisional account)
        if stmt_date:
            sd = stmt_date if isinstance(stmt_date, datetime) else datetime.combine(stmt_date, datetime.min.time())
            if trade_date <= sd:
                raise HTTPException(
                    422,
                    f"This contract note is dated {trade_date.strftime('%-d %b %Y')}, on or before your latest statement ({sd.strftime('%-d %b %Y')}), so its value is already counted. Only notes newer than the statement can be added.",
                )
    else:
        # Create or find provisional account
        ref_slug   = re.sub(r"[^a-z0-9]", "", account_reference.lower())[:12]
        account_id = (
            f"inv-{uid}-{provider_slug}-{ref_slug}"
            if ref_slug
            else f"inv-{uid}-{provider_slug}-{hashlib.sha256(uid.encode()).hexdigest()[:8]}"
        )
        existing = await investment_accounts_col.find_one({"_id": account_id})
        if not existing:
            await investment_accounts_col.insert_one({
                "_id":               account_id,
                "user_id":           uid,
                "provider":          provider,
                "account_type":      "",
                "account_reference": account_reference,
                "currency":          "GBP",
                "total_value":       0.0,
                "statement_date":    None,
                "provisional":       True,
                "updated_at":        datetime.now(),
            })
        acc = await investment_accounts_col.find_one({"_id": account_id})
        # No invariant-1 check needed: provisional account has statement_date=None

    # Invariant 2: deduplicate
    if reference:
        note_id = hashlib.sha256(f"{account_id}|ref:{reference}".encode()).hexdigest()[:24]
    else:
        note_id = hashlib.sha256(f"{account_id}|{trade_date_str}|{raw_amount:.2f}|{fund_name.lower().strip()}".encode()).hexdigest()[:24]

    note_doc = {
        "_id":            note_id,
        "user_id":        uid,
        "account_id":     account_id,
        "trade_date":     trade_date,
        "kind":           kind,
        "amount":         amount,
        "fund_name":      fund_name,
        "units":          units,
        "price_per_unit": price_per_unit,
        "reference":      reference,
        "provider":       provider,
        "created_at":     datetime.now(),
    }

    try:
        await investment_notes_col.insert_one(note_doc)
    except DuplicateKeyError:
        raise HTTPException(
            422,
            f"This contract note looks like one you've already added ({fund_name} · {trade_date.strftime('%-d %b %Y')} · £{raw_amount:,.2f}). Duplicates would double-count the trade.",
        )

    acc_fresh   = await investment_accounts_col.find_one({"_id": account_id})
    acc_display = await _investment_display(acc_fresh)

    return {
        "note": {
            "id":         note_id,
            "trade_date": trade_date.isoformat(),
            "kind":       kind,
            "amount":     amount,
            "fund_name":  fund_name,
            "units":      units,
            "reference":  reference,
        },
        "account": acc_display,
    }


@router.get("/investment/accounts/{account_id}/notes")
async def list_contract_notes(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    acc = await investment_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Investment account not found")

    stmt_date = acc.get("statement_date")
    sd = None
    if stmt_date:
        sd = stmt_date if isinstance(stmt_date, datetime) else datetime.combine(stmt_date, datetime.min.time())

    notes = await investment_notes_col.find({"account_id": account_id}).sort("trade_date", -1).to_list(None)
    fee_lines = ia.all_fee_lines(acc.get("statement_periods") or [])
    return [
        {
            "is_fee":        ia.is_fee_note(n, fee_lines),
            "id":            n["_id"],
            "trade_date":    n["trade_date"].isoformat() if isinstance(n["trade_date"], datetime) else n["trade_date"],
            "kind":          n.get("kind"),
            "amount":        n.get("amount"),
            "fund_name":     n.get("fund_name"),
            "units":         n.get("units"),
            "price_per_unit": n.get("price_per_unit"),
            "reference":     n.get("reference"),
            "superseded":    (sd is not None and n["trade_date"] <= sd) if isinstance(n.get("trade_date"), datetime) else False,
        }
        for n in notes
    ]


@router.delete("/investment/notes/{note_id}")
async def delete_contract_note(note_id: str, user: dict = Depends(current_user)):
    uid  = user["email"]
    note = await investment_notes_col.find_one({"_id": note_id, "user_id": uid})
    if not note:
        raise HTTPException(404, "Contract note not found")

    account_id = note["account_id"]
    await investment_notes_col.delete_one({"_id": note_id})

    acc = await investment_accounts_col.find_one({"_id": account_id})
    acc_display = await _investment_display(acc) if acc else None

    return {"deleted": note_id, "account": acc_display}


@router.get("/investment/accounts/{account_id}/holdings")
async def get_investment_holdings(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    acc = await investment_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Investment account not found")
    holdings = await investment_holdings_col.find({"account_id": account_id}).to_list(None)
    insts = await get_instruments(h.get("instrument_key") for h in holdings)
    out = []
    for h in holdings:
        inst = insts.get(h.get("instrument_key"))
        if inst and inst.get("price"):
            price, value = inst["price"], holding_value(h, inst)
            price_date, source, conf = inst.get("price_date"), inst.get("source"), inst.get("confidence")
            fetched = inst.get("fetched_at")
        else:
            # Not yet linked or priced: fall back to any legacy per-holding price.
            price, value = legacy_price(h), holding_value(h, None)
            price_date = to_user_date(as_utc(h["last_refreshed"])).isoformat() if price and h.get("last_refreshed") else None
            source, conf = ("legacy" if price else None), ("low" if price else None)
            fetched = h.get("last_refreshed")
        out.append({
            "id": h["_id"], "name": h.get("name"), "isin": h.get("isin"),
            "type": h.get("type", "Fund"), "units": h.get("units"),
            "price_per_unit": h.get("price_per_unit"), "statement_value": h.get("statement_value", 0),
            "book_cost": h.get("book_cost"), "book_cost_source": h.get("book_cost_source"),
            "current_price": price, "current_value": value,
            "price_date": price_date, "price_source": source, "price_confidence": conf,
            "last_refreshed": fetched.isoformat() if fetched else None,
        })
    # G278: a fund that exists only through contract notes (for example an ETF bought
    # after the statement) is a holding too, with its units, price, value and gain.
    notes = await investment_notes_col.find({"account_id": account_id}).to_list(None)
    keys = [h.get("instrument_key") for h in holdings] + [instrument_key(None, None, n.get("fund_name")) for n in notes]
    all_insts = await get_instruments(keys)
    sd = ia.as_date(acc.get("statement_date"))
    pos = build_positions(sd, holdings, notes, all_insts, ia.all_fee_lines(acc.get("statement_periods") or []))
    by_id = {r["id"]: r for r in pos["rows"]}
    for row in out:
        r = by_id.get(row["id"])
        if r:
            row["gain_abs"], row["gain_pct"], row["cost"] = r["gain_abs"], r["gain_pct"], r["cost"]
    have = {o["id"] for o in out}
    for r in pos["rows"]:
        if r["id"] in have:
            continue
        price_date = r["price_date"]
        out.append({
            "id": r["id"], "name": r["name"], "isin": r["isin"], "type": r["type"], "units": r["units"],
            "price_per_unit": None, "statement_value": 0, "book_cost": None, "book_cost_source": None,
            "current_price": r["price"], "current_value": r["value"], "price_date": price_date,
            "price_source": "contract_notes", "price_confidence": None, "last_refreshed": None,
            "from_contract_notes": True, "cost": r["cost"], "gain_abs": r["gain_abs"], "gain_pct": r["gain_pct"],
        })
    return out


@router.delete("/investment/accounts/{account_id}")
async def delete_investment_account(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    acc = await investment_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Investment account not found")
    await investment_holdings_col.delete_many({"account_id": account_id})
    await investment_notes_col.delete_many({"account_id": account_id})
    await investment_valuations_col.delete_many({"account_id": account_id})
    await investment_accounts_col.delete_one({"_id": account_id})
    return {"deleted": account_id}


@router.post("/investment/accounts/{account_id}/refresh")
async def refresh_investment_prices(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    acc = await investment_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Investment account not found")
    result = await refresh_account_prices(acc)
    return result


@router.get("/investment/accounts/{account_id}/growth")
@router.get("/investments/{account_id}/growth")
async def get_investment_growth(
    account_id: str,
    range: Literal["1m", "3m", "6m", "1y", "all"] = Query("all"),
    user: dict = Depends(current_user),
):
    """G271: value over time, money paid in and simple growth (value minus
    paid in) for one account, plus each holding's change since the last
    statement. Prices are end of day and may be delayed."""
    acc = await investment_accounts_col.find_one({"_id": account_id, "user_id": user["email"]})
    if not acc:
        raise HTTPException(404, "Investment account not found")
    return await account_growth(acc, range)


# ── G278: anchor from your provider ───────────────────────────────────────

async def _owned_account(account_id: str, uid: str) -> dict:
    acc = await investment_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Investment account not found")
    return acc


@router.post("/investment/accounts/{account_id}/anchor")
async def set_investment_anchor(account_id: str, body: dict = Body(...), user: dict = Depends(current_user)):
    """Set, edit or re-anchor: what the provider shows on a date. User-entered
    and editable. Re-anchoring keeps the previous anchor in anchor_history."""
    acc = await _owned_account(account_id, user["email"])
    anchor, problem = ia.check_anchor(body or {}, timeutil.user_today())
    if anchor is None:
        raise HTTPException(422, problem)
    anchor["entered_at"] = timeutil.user_now().isoformat()
    new, history = ia.replace_anchor(acc.get("anchor"), anchor, acc.get("anchor_history"))
    await investment_accounts_col.update_one(
        {"_id": account_id, "user_id": user["email"]},
        {"$set": {"anchor": new, "anchor_history": history}},
    )
    fresh = await investment_accounts_col.find_one({"_id": account_id})
    return await account_growth(fresh, "all")


@router.delete("/investment/accounts/{account_id}/anchor")
async def clear_investment_anchor(account_id: str, user: dict = Depends(current_user)):
    """Clear the current anchor. The history of earlier anchors is kept."""
    acc = await _owned_account(account_id, user["email"])
    history = acc.get("anchor_history") or []
    if acc.get("anchor"):
        history = (history + [{**{k: v for k, v in acc["anchor"].items() if k != "use_provider_value"},
                               "replaced_at": timeutil.user_now().isoformat(), "cleared": True}])[-20:]
    await investment_accounts_col.update_one(
        {"_id": account_id, "user_id": user["email"]},
        {"$unset": {"anchor": ""}, "$set": {"anchor_history": history}},
    )
    fresh = await investment_accounts_col.find_one({"_id": account_id})
    return await account_growth(fresh, "all")


@router.post("/investment/accounts/{account_id}/anchor/override")
async def set_anchor_override(account_id: str, body: dict = Body(...), user: dict = Depends(current_user)):
    """Display override only: show the provider's value for the anchor date.
    No data is rewritten; turning it off restores Sorted's own figure."""
    acc = await _owned_account(account_id, user["email"])
    if not acc.get("anchor"):
        raise HTTPException(422, "There is no anchor to use. Anchor from your provider first.")
    on = body.get("use_provider_value")
    if not isinstance(on, bool):
        raise HTTPException(422, "use_provider_value must be true or false.")
    await investment_accounts_col.update_one(
        {"_id": account_id, "user_id": user["email"]}, {"$set": {"anchor": {**acc["anchor"], "use_provider_value": on}}},
    )
    fresh = await investment_accounts_col.find_one({"_id": account_id})
    return await account_growth(fresh, "all")
