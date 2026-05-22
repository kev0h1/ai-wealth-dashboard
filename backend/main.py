"""
AI Wealth API - FastAPI backend with MongoDB storage.
Each bank connection gets its own connection_id so multiple banks coexist.
"""

from fastapi import FastAPI, HTTPException, Request, Depends, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
import httpx
import os
import re
import json
import secrets
import urllib.parse
import asyncio
import uuid as uuid_lib
import hashlib
from pathlib import Path
from dotenv import load_dotenv
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

app = FastAPI(title="AI Wealth API", version="0.2.0")

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000",
                   "http://localhost:8000", "https://wealth.auriqltd.co.uk"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# ── Auth ──────────────────────────────────────────────────────────────────────
DASHBOARD_PIN = os.getenv("DASHBOARD_PIN", "8048")
BOT_SECRET    = os.getenv("BOT_SECRET", "")

_secrets_file = Path(__file__).parent / ".session_secret"
if s := os.getenv("SESSION_SECRET"):
    SESSION_SECRET = s
elif _secrets_file.exists():
    SESSION_SECRET = _secrets_file.read_text().strip()
else:
    SESSION_SECRET = secrets.token_hex(32)
    _secrets_file.write_text(SESSION_SECRET)

serializer = URLSafeTimedSerializer(SESSION_SECRET)


async def current_user(request: Request) -> dict:
    """Dependency: extract & validate session token, return user dict {email, name}."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = auth[7:]
    if BOT_SECRET and token == BOT_SECRET:
        # Bot authenticates as Kevin; use /admin/sync-all for all-user sync
        return {"email": "kevin.maingi12@gmail.com", "name": "Bot"}
    try:
        data = serializer.loads(token, max_age=SESSION_MAX_AGE)
        return data if isinstance(data, dict) else {"email": "unknown", "name": ""}
    except (SignatureExpired, BadSignature):
        raise HTTPException(401, "Session expired")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    if path.startswith("/auth/") or path in {"/health", "/docs", "/openapi.json", "/redoc"}:
        return await call_next(request)
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    token = auth[7:]
    if BOT_SECRET and token == BOT_SECRET:
        return await call_next(request)
    try:
        serializer.loads(token, max_age=SESSION_MAX_AGE)
    except (SignatureExpired, BadSignature):
        return JSONResponse(status_code=401, content={"detail": "Session expired"})
    return await call_next(request)

# ── MongoDB ───────────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
_mongo     = AsyncIOMotorClient(MONGO_URI)
db         = _mongo["wealth"]
connections_col  = db["connections"]   # one doc per bank connection
accounts_col     = db["accounts"]      # one doc per bank account
transactions_col = db["transactions"]  # one doc per transaction
preferences_col  = db["preferences"]
chat_sessions_col = db["chat_sessions"]
episodic_memory_col = db["episodic_memory"]
user_categories_col  = db["user_categories"]
budgets_col          = db["budgets"]
mono_connections_col = db["mono_connections"]   # isolated — drop to revert
mono_accounts_col    = db["mono_accounts"]
mono_transactions_col = db["mono_transactions"]

# ── TrueLayer config ──────────────────────────────────────────────────────────
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

TRUELAYER_CLIENT_ID     = os.getenv("TRUELAYER_CLIENT_ID")
TRUELAYER_CLIENT_SECRET = os.getenv("TRUELAYER_CLIENT_SECRET")
TRUELAYER_AUTH_URL      = "https://auth.truelayer.com"
TRUELAYER_API_URL       = "https://api.truelayer.com"
TRUELAYER_REDIRECT_URI  = os.getenv("TRUELAYER_REDIRECT_URI",
                                    "http://localhost:8000/auth/truelayer/callback")

# ── Google OAuth ───────────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
APP_URL              = os.getenv("APP_URL", "https://wealth.auriqltd.co.uk")
ALLOWED_EMAILS       = {e.strip().lower() for e in os.getenv("ALLOWED_EMAILS", "kevin.maingi12@gmail.com").split(",")}
SESSION_MAX_AGE      = 7 * 24 * 3600  # 7 days

# ── Mono (Kenya) ──────────────────────────────────────────────────────────────
MONO_SECRET_KEY = os.getenv("MONO_SECRET_KEY", "")
MONO_PUBLIC_KEY  = os.getenv("MONO_PUBLIC_KEY", "")
MONO_API_URL     = "https://api.withmono.com/v2"

# ── Models ────────────────────────────────────────────────────────────────────
class Account(BaseModel):
    id: str
    name: str
    type: str
    balance: float
    currency: str = "GBP"
    provider: str
    status: str = "connected"
    account_number: Optional[str] = None
    sort_code: Optional[str] = None
    connection_id: Optional[str] = None

class Transaction(BaseModel):
    id: str
    account_id: str
    date: datetime
    amount: float
    currency: str
    description: str
    merchant_name: Optional[str] = None
    category: Optional[str] = None          # from TrueLayer or AI
    custom_category: Optional[str] = None   # user-set, takes priority
    transaction_type: str

    @property
    def effective_category(self) -> str:
        return self.custom_category or self.category or "Other"

class KPIResponse(BaseModel):
    net_worth: float
    cash: float
    runway: float
    investments: float
    pensions: float
    last_updated: datetime

class Insight(BaseModel):
    id: str
    title: str
    impact: float
    confidence: int
    rationale: str
    action: str
    category: str

# ── Token helpers ─────────────────────────────────────────────────────────────

async def save_connection(connection_id: str, token_data: dict, user_id: Optional[str] = None):
    """Upsert a connection's token in MongoDB."""
    update: dict = {
        "access_token":  token_data["access_token"],
        "refresh_token": token_data.get("refresh_token"),
        "expires_at":    datetime.now() + timedelta(seconds=token_data.get("expires_in", 3600)),
        "updated_at":    datetime.now(),
    }
    if user_id:
        update["user_id"] = user_id
    await connections_col.update_one(
        {"_id": connection_id},
        {"$set": update},
        upsert=True,
    )

async def get_valid_token(connection_id: str) -> Optional[str]:
    """Return a valid access token, refreshing if needed."""
    conn = await connections_col.find_one({"_id": connection_id})
    if not conn or "expires_at" not in conn or "access_token" not in conn:
        return None

    if datetime.now() < conn["expires_at"]:
        return conn["access_token"]

    # Attempt refresh
    if not conn.get("refresh_token"):
        return None
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{TRUELAYER_AUTH_URL}/connect/token",
            data={
                "grant_type":    "refresh_token",
                "client_id":     TRUELAYER_CLIENT_ID,
                "client_secret": TRUELAYER_CLIENT_SECRET,
                "refresh_token": conn["refresh_token"],
            },
        )
        if r.status_code == 200:
            await save_connection(connection_id, r.json())
            return r.json()["access_token"]
    return None

# ── Sync helpers ──────────────────────────────────────────────────────────────

async def _upsert_transactions(txns: list, account_id: str, user_id: str, is_card: bool = False):
    """Upsert a batch of TrueLayer transaction results — never overwrite custom_category.
    Applies merchant rules immediately so raw TrueLayer categories are never stored as-is.

    Sign convention differs between TrueLayer APIs:
      Bank accounts: positive = credit (income in), negative = debit (spending out)
      Cards:         positive = debit (purchase/charge), negative = credit (payment/refund)
    """
    for txn in txns:
        merchant = txn.get("merchant_name") or ""
        description = txn.get("description", "")
        raw_cat = txn.get("transaction_category", "")
        # Flip sign interpretation for cards
        is_credit = (txn["amount"] < 0) if is_card else (txn["amount"] > 0)

        if raw_cat == "TRANSFER":
            category = "Transfer"
        elif is_credit:
            category = rule_categorise(merchant, description) or "Transfer"
        else:
            # Never store raw TrueLayer categories (PURCHASE, DIRECT_DEBIT, etc.)
            # Leave as None so AI categorisation can handle it properly
            category = rule_categorise(merchant, description) or None

        tdoc = {
            "account_id":       account_id,
            "user_id":          user_id,
            "date":             datetime.fromisoformat(txn["timestamp"].replace("Z", "+00:00")),
            "amount":           abs(txn["amount"]),
            "currency":         txn["currency"],
            "description":      description,
            "merchant_name":    merchant or None,
            "category":         category,
            "transaction_type": "credit" if is_credit else "debit",
        }
        await transactions_col.update_one(
            {"_id": txn["transaction_id"]},
            {"$set": tdoc, "$setOnInsert": {"_id": txn["transaction_id"], "custom_category": None}},
            upsert=True,
        )


async def sync_connection(connection_id: str, user_id: Optional[str] = None, from_date: Optional[str] = None):
    """Fetch accounts + cards + transactions for one connection; upsert into MongoDB."""
    token = await get_valid_token(connection_id)
    if not token:
        return []

    # Resolve user_id from the connection doc if not passed directly
    if not user_id:
        conn_doc = await connections_col.find_one({"_id": connection_id}, {"user_id": 1})
        user_id = (conn_doc or {}).get("user_id", "unknown")

    if from_date is None:
        from_date = datetime.now().strftime("%Y-%m-%d")
    to_date   = datetime.now().strftime("%Y-%m-%d")
    headers   = {"Authorization": f"Bearer {token}"}
    fetched   = []

    async with httpx.AsyncClient(timeout=30) as client:

        # ── Bank accounts ──────────────────────────────────────────────────
        r = await client.get(f"{TRUELAYER_API_URL}/data/v1/accounts", headers=headers)
        if r.status_code == 200:
            for acc in r.json().get("results", []):
                account_id = acc["account_id"]
                balance = 0.0
                try:
                    br = await client.get(
                        f"{TRUELAYER_API_URL}/data/v1/accounts/{account_id}/balance",
                        headers=headers,
                    )
                    if br.status_code == 200:
                        res = br.json().get("results", [])
                        if res:
                            balance = res[0].get("current", 0.0)
                except Exception:
                    pass

                await accounts_col.update_one({"_id": account_id}, {"$set": {
                    "_id":            account_id,
                    "connection_id":  connection_id,
                    "user_id":        user_id,
                    "name":           acc.get("display_name", acc.get("account_type", "Account")),
                    "type":           "bank",
                    "balance":        balance,
                    "currency":       acc.get("currency", "GBP"),
                    "provider":       acc.get("provider", {}).get("display_name", "Unknown"),
                    "status":         "connected",
                    "account_number": (acc.get("account_number") or {}).get("number"),
                    "sort_code":      (acc.get("account_number") or {}).get("sort_code"),
                    "updated_at":     datetime.now(),
                }}, upsert=True)
                fetched.append(account_id)

                try:
                    tr = await client.get(
                        f"{TRUELAYER_API_URL}/data/v1/accounts/{account_id}/transactions",
                        headers=headers, params={"from": from_date, "to": to_date},
                    )
                    if tr.status_code == 200:
                        await _upsert_transactions(tr.json().get("results", []), account_id, user_id)
                except Exception:
                    pass

        # ── Credit cards ───────────────────────────────────────────────────
        cr = await client.get(f"{TRUELAYER_API_URL}/data/v1/cards", headers=headers)
        if cr.status_code == 200:
            for card in cr.json().get("results", []):
                card_id = card["account_id"]
                balance = 0.0
                try:
                    cbr = await client.get(
                        f"{TRUELAYER_API_URL}/data/v1/cards/{card_id}/balance",
                        headers=headers,
                    )
                    if cbr.status_code == 200:
                        res = cbr.json().get("results", [])
                        if res:
                            # Credit card balance is what you owe — store as negative
                            balance = -abs(res[0].get("current", 0.0))
                except Exception:
                    pass

                await accounts_col.update_one({"_id": card_id}, {"$set": {
                    "_id":            card_id,
                    "connection_id":  connection_id,
                    "user_id":        user_id,
                    "name":           card.get("display_name", card.get("card_type", "Credit Card")),
                    "type":           "credit_card",
                    "balance":        balance,
                    "currency":       card.get("currency", "GBP"),
                    "provider":       card.get("provider", {}).get("display_name", "Unknown"),
                    "status":         "connected",
                    "account_number": card.get("partial_card_number"),
                    "sort_code":      None,
                    "updated_at":     datetime.now(),
                }}, upsert=True)
                fetched.append(card_id)

                try:
                    ctr = await client.get(
                        f"{TRUELAYER_API_URL}/data/v1/cards/{card_id}/transactions",
                        headers=headers, params={"from": from_date, "to": to_date},
                    )
                    if ctr.status_code == 200:
                        await _upsert_transactions(ctr.json().get("results", []), card_id, user_id, is_card=True)
                except Exception:
                    pass

        await connections_col.update_one(
            {"_id": connection_id}, {"$set": {"last_synced": datetime.now()}}, upsert=True
        )

    return fetched


# ── TrueLayer auth ────────────────────────────────────────────────────────────

@app.get("/auth/truelayer/link")
async def truelayer_link(user: dict = Depends(current_user)):
    if not TRUELAYER_CLIENT_ID:
        raise HTTPException(500, "TrueLayer not configured")
    connection_id = secrets.token_hex(8)
    # Reserve the connection slot so the callback can find the user_id
    await connections_col.update_one(
        {"_id": connection_id},
        {"$set": {"user_id": user["email"], "pending": True, "created_at": datetime.now()}},
        upsert=True,
    )
    auth_url = (
        f"{TRUELAYER_AUTH_URL}/?"
        f"response_type=code&"
        f"client_id={TRUELAYER_CLIENT_ID}&"
        f"scope=accounts%20transactions%20balance%20cards%20offline_access&"
        f"redirect_uri={TRUELAYER_REDIRECT_URI}&"
        f"state={connection_id}&"
        f"providers=uk-ob-all%20uk-cs-mock"
    )
    return {"auth_url": auth_url, "connection_id": connection_id}


@app.get("/auth/truelayer/callback")
async def truelayer_callback(code: str, state: Optional[str] = None):
    if not TRUELAYER_CLIENT_ID or not TRUELAYER_CLIENT_SECRET:
        raise HTTPException(500, "TrueLayer not configured")

    connection_id = state or secrets.token_hex(8)

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{TRUELAYER_AUTH_URL}/connect/token",
            data={
                "grant_type":    "authorization_code",
                "client_id":     TRUELAYER_CLIENT_ID,
                "client_secret": TRUELAYER_CLIENT_SECRET,
                "redirect_uri":  TRUELAYER_REDIRECT_URI,
                "code":          code,
            },
        )
        if r.status_code != 200:
            return HTMLResponse(f"<h2>Token exchange failed</h2><pre>{r.text}</pre>", status_code=400)

        await save_connection(connection_id, r.json())

    # Retrieve the user_id stored when the link was generated
    conn_doc = await connections_col.find_one({"_id": connection_id}, {"user_id": 1})
    user_id = (conn_doc or {}).get("user_id", "unknown")

    # Sync in background — don't block the redirect
    asyncio.create_task(sync_connection(connection_id, user_id))

    return HTMLResponse("""
    <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#1a1a2e;color:#e0e0e0">
    <h1 style="color:#00d4aa">&#10003; Bank Connected!</h1>
    <p>Your account has been linked. Transactions are syncing in the background.</p>
    <p>Head to Discord and use <strong>/summary</strong> to see your data.</p>
    </body></html>
    """)


@app.get("/auth/truelayer/test-callback")
async def test_callback():
    return {"message": "Callback routing works", "timestamp": datetime.now()}

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    await transactions_col.create_index("account_id")
    await transactions_col.create_index("date")
    await transactions_col.create_index("user_id")
    await accounts_col.create_index("connection_id")
    await accounts_col.create_index("user_id")
    await connections_col.create_index("user_id")
    await preferences_col.create_index("user_id", unique=True)
    await chat_sessions_col.create_index("user_id")
    await chat_sessions_col.create_index([("created_at", 1)], expireAfterSeconds=604800)  # 7 day TTL
    await episodic_memory_col.create_index("user_id", unique=True)
    await user_categories_col.create_index("user_id", unique=True)
    await budgets_col.create_index([("user_id", 1), ("region", 1)], unique=True)
    await mono_connections_col.create_index("user_id")
    await mono_accounts_col.create_index("user_id")
    await mono_transactions_col.create_index([("user_id", 1), ("date", -1)])


@app.get("/health")
async def health():
    return {"status": "ok", "truelayer_configured": bool(TRUELAYER_CLIENT_ID)}


async def get_user_region(uid: str) -> str:
    doc = await preferences_col.find_one({"user_id": uid})
    return doc.get("region", "UK") if doc else "UK"


async def _get_kenya_transactions(uid: str, cutoff=None) -> list:
    """Return all Mono + MPesa + statement transactions for a user, optionally filtered by cutoff date."""
    q: dict = {"user_id": uid}
    if cutoff:
        q["date"] = {"$gte": cutoff}
    mono  = await mono_transactions_col.find(q).to_list(None)
    mpesa = await mpesa_transactions_col.find(q).to_list(None)
    stmt  = await statement_transactions_col.find(q).to_list(None)
    return mono + mpesa + stmt


@app.get("/accounts", response_model=List[Account])
async def get_accounts(user: dict = Depends(current_user)):
    uid = user["email"]
    region = await get_user_region(uid)

    if region == "Kenya":
        mono_accs  = await mono_accounts_col.find({"user_id": uid}).to_list(None)
        mpesa_accs = await mpesa_accounts_col.find({"user_id": uid}).to_list(None)
        result = []
        for a in mono_accs:
            result.append(Account(
                id=a["_id"], name=a.get("name", "Account"), type=a.get("type", "bank"),
                balance=a.get("balance", 0), currency=a.get("currency", "KES"),
                provider=a.get("provider", "Mono"), status=a.get("status", "connected"),
                user_id=uid, connection_id=a.get("connection_id", ""),
            ))
        for a in mpesa_accs:
            result.append(Account(
                id=a["_id"], name=a.get("name", "M-Pesa"), type=a.get("type", "bank"),
                balance=a.get("balance", 0), currency=a.get("currency", "KES"),
                provider=a.get("provider", "MPesa"), status=a.get("status", "connected"),
                user_id=uid, connection_id=a.get("connection_id", ""),
            ))
        stmt_accs = await statement_accounts_col.find({"user_id": uid, "region": "Kenya"}).to_list(None)
        for a in stmt_accs:
            result.append(Account(
                id=a["_id"], name=a.get("name", "Bank Account"), type=a.get("type", "bank"),
                balance=a.get("balance", 0), currency=a.get("currency", "KES"),
                provider=a.get("provider", "BANK"), status=a.get("status", "connected"),
                user_id=uid, connection_id="",
            ))
        return result

    docs = await accounts_col.find({"user_id": uid}).to_list(None)
    result = [Account(id=d["_id"], **{k: v for k, v in d.items() if k != "_id"}) for d in docs]
    # Include UK statement accounts only
    stmt_accs = await statement_accounts_col.find({"user_id": uid, "region": "UK"}).to_list(None)
    for a in stmt_accs:
        result.append(Account(
            id=a["_id"], name=a.get("name", "Bank Account"), type=a.get("type", "bank"),
            balance=a.get("balance", 0), currency=a.get("currency", "GBP"),
            provider=a.get("provider", "BANK"), status=a.get("status", "connected"),
            user_id=uid, connection_id="",
        ))
    return result


@app.post("/accounts/sync")
async def sync_all(user: dict = Depends(current_user)):
    """Re-sync all connections belonging to the current user (region-aware)."""
    uid = user["email"]
    region = await get_user_region(uid)

    if region == "Kenya":
        conns = await mono_connections_col.find({"user_id": uid}).to_list(None)
        total = 0
        for conn in conns:
            ids = await _sync_mono_connection(conn["_id"], uid)
            total += len(ids)
        return {"message": "Synced", "connections": len(conns), "total_accounts": total}

    conns = await connections_col.find({"user_id": uid}).to_list(None)
    total = 0
    for conn in conns:
        ids = await sync_connection(conn["_id"], uid)
        total += len(ids)
    asyncio.create_task(_apply_rules_bulk(uid, structural=True))
    return {"message": "Synced", "connections": len(conns), "total_accounts": total}


@app.post("/accounts/sync-history")
async def sync_history(user: dict = Depends(current_user)):
    """Full 90-day re-sync for the current user — triggered from Settings."""
    uid = user["email"]
    region = await get_user_region(uid)

    if region == "Kenya":
        conns = await mono_connections_col.find({"user_id": uid}).to_list(None)
        total = 0
        for conn in conns:
            ids = await _sync_mono_connection(conn["_id"], uid)
            total += len(ids)
        return {"message": "Full sync complete", "connections": len(conns), "total_accounts": total}

    conns = await connections_col.find({"user_id": uid}).to_list(None)
    from_dt = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    total = 0
    for conn in conns:
        ids = await sync_connection(conn["_id"], uid, from_date=from_dt)
        total += len(ids)
    asyncio.create_task(_apply_rules_bulk(uid, structural=True))
    return {"message": "Full sync complete", "connections": len(conns), "total_accounts": total}


@app.post("/admin/sync-all")
async def admin_sync_all(request: Request):
    """Bot-only endpoint: sync all users' connections and apply categorisation rules."""
    auth = request.headers.get("Authorization", "")
    if not (BOT_SECRET and auth == f"Bearer {BOT_SECRET}"):
        raise HTTPException(403, "Forbidden")
    all_conns = await connections_col.find({}).to_list(None)
    total_accounts = 0
    user_ids: set = set()
    for conn in all_conns:
        uid = conn.get("user_id")
        if not uid:
            continue
        ids = await sync_connection(conn["_id"], uid)
        total_accounts += len(ids)
        user_ids.add(uid)
    for uid in user_ids:
        asyncio.create_task(_apply_rules_bulk(uid, structural=True))
    return {"connections": len(all_conns), "total_accounts": total_accounts, "users": len(user_ids)}


@app.delete("/connections/{connection_id}")
async def delete_connection(connection_id: str, user: dict = Depends(current_user)):
    """Remove a bank connection and all its accounts (must belong to current user)."""
    conn = await connections_col.find_one({"_id": connection_id, "user_id": user["email"]})
    if not conn:
        raise HTTPException(404, "Connection not found")
    account_ids = [d["_id"] async for d in accounts_col.find({"connection_id": connection_id}, {"_id": 1})]
    await transactions_col.delete_many({"account_id": {"$in": account_ids}})
    await accounts_col.delete_many({"connection_id": connection_id})
    await connections_col.delete_one({"_id": connection_id})
    return {"deleted": connection_id, "accounts_removed": len(account_ids)}


@app.delete("/accounts/{account_id}")
async def delete_account(account_id: str, user: dict = Depends(current_user)):
    """Remove a single account and its transactions (works for TrueLayer, Mono, and MPesa accounts)."""
    uid = user["email"]

    # --- MPesa account ---
    if account_id.startswith("mpesa-"):
        acc = await mpesa_accounts_col.find_one({"_id": account_id, "user_id": uid})
        if not acc:
            raise HTTPException(404, "Account not found")
        await mpesa_transactions_col.delete_many({"account_id": account_id})
        await mpesa_accounts_col.delete_one({"_id": account_id})
        return {"deleted": account_id}

    # --- Statement account (any Kenyan bank uploaded PDF/CSV) ---
    if account_id.startswith("statement-"):
        acc = await statement_accounts_col.find_one({"_id": account_id, "user_id": uid})
        if not acc:
            raise HTTPException(404, "Account not found")
        await statement_transactions_col.delete_many({"account_id": account_id})
        await statement_accounts_col.delete_one({"_id": account_id})
        return {"deleted": account_id}

    # --- Mono account ---
    mono_acc = await mono_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if mono_acc:
        conn = await mono_connections_col.find_one({"mono_account_id": account_id, "user_id": uid})
        await mono_transactions_col.delete_many({"account_id": account_id})
        await mono_accounts_col.delete_one({"_id": account_id})
        if conn:
            await mono_connections_col.delete_one({"_id": conn["_id"]})
        return {"deleted": account_id}

    # --- TrueLayer account ---
    tl_acc = await accounts_col.find_one({"_id": account_id, "user_id": uid})
    if tl_acc:
        connection_id = tl_acc.get("connection_id")
        await transactions_col.delete_many({"account_id": account_id})
        await accounts_col.delete_one({"_id": account_id})
        # Delete the connection only if no other accounts still use it
        if connection_id:
            remaining = await accounts_col.count_documents({"connection_id": connection_id})
            if remaining == 0:
                await connections_col.delete_one({"_id": connection_id})
        return {"deleted": account_id}

    # --- Fall back: check mpesa_accounts_col without prefix assumption ---
    mpesa_acc = await mpesa_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if mpesa_acc:
        await mpesa_transactions_col.delete_many({"account_id": account_id})
        await mpesa_accounts_col.delete_one({"_id": account_id})
        return {"deleted": account_id}

    raise HTTPException(404, "Account not found")


@app.get("/connections")
async def list_connections(user: dict = Depends(current_user)):
    conns = await connections_col.find(
        {"user_id": user["email"]}, {"access_token": 0, "refresh_token": 0}
    ).to_list(None)
    result = []
    for c in conns:
        account_count = await accounts_col.count_documents({"connection_id": c["_id"]})
        result.append({
            "connection_id": c["_id"],
            "expires_at":    c.get("expires_at"),
            "accounts":      account_count,
        })
    return result


@app.get("/accounts/{account_id}/transactions", response_model=List[Transaction])
async def get_transactions(account_id: str, days: int = 90, user: dict = Depends(current_user)):
    uid = user["email"]
    cutoff = datetime.now() - timedelta(days=days)

    def _doc_to_tx(d):
        eff = d.get("custom_category") or d.get("category") or "Other"
        return Transaction(id=str(d["_id"]), category=eff, custom_category=d.get("custom_category"),
                           **{k: v for k, v in d.items() if k not in ("_id", "category", "custom_category")})

    # Route Mono / MPesa accounts to their own collections
    if account_id.startswith("mono-"):
        docs = await mono_transactions_col.find(
            {"account_id": account_id, "user_id": uid, "date": {"$gte": cutoff}}
        ).sort("date", -1).to_list(None)
        return [_doc_to_tx(d) for d in docs]

    if account_id.startswith("mpesa-"):
        docs = await mpesa_transactions_col.find(
            {"account_id": account_id, "user_id": uid, "date": {"$gte": cutoff}}
        ).sort("date", -1).to_list(None)
        return [_doc_to_tx(d) for d in docs]

    if account_id.startswith("statement-"):
        docs = await statement_transactions_col.find(
            {"account_id": account_id, "user_id": uid, "date": {"$gte": cutoff}}
        ).sort("date", -1).to_list(None)
        return [_doc_to_tx(d) for d in docs]

    docs = await transactions_col.find(
        {"account_id": account_id, "user_id": uid, "date": {"$gte": cutoff}}
    ).sort("date", -1).to_list(None)
    return [_doc_to_tx(d) for d in docs]


@app.get("/transactions/{transaction_id}/similar", response_model=List[Transaction])
async def similar_transactions(transaction_id: str, scope: str = "all", user: dict = Depends(current_user)):
    """Return transactions that share the same merchant/description AND transaction direction."""
    ref = await transactions_col.find_one({"_id": transaction_id, "user_id": user["email"]})
    if not ref:
        raise HTTPException(404, "Transaction not found")

    merchant = ref.get("merchant_name")
    description = ref.get("description", "")
    txn_type = ref.get("transaction_type", "debit")

    match: dict = {
        "_id": {"$ne": transaction_id},
        "user_id": user["email"],
        "transaction_type": txn_type,
    }
    if merchant:
        match["merchant_name"] = merchant
    else:
        match["description"] = description

    if scope == "future":
        match["date"] = {"$gte": ref["date"]}

    docs = await transactions_col.find(match).sort("date", -1).to_list(200)
    def _doc_to_tx(d):
        eff = d.get("custom_category") or d.get("category") or "Other"
        return Transaction(id=d["_id"], category=eff, custom_category=d.get("custom_category"),
                           **{k: v for k, v in d.items() if k not in ("_id", "category", "custom_category")})
    return [_doc_to_tx(d) for d in docs]


@app.patch("/transactions/{transaction_id}")
async def update_transaction(transaction_id: str, body: dict, user: dict = Depends(current_user)):
    """Update category for a transaction, optionally bulk-updating additional specific IDs."""
    if "category" not in body:
        raise HTTPException(400, "Provide 'category' in body")

    category = body["category"]
    additional_ids: list[str] = body.get("additional_ids", [])

    await transactions_col.update_one(
        {"_id": transaction_id, "user_id": user["email"]},
        {"$set": {"custom_category": category}},
    )

    bulk_count = 0
    if additional_ids:
        result = await transactions_col.update_many(
            {"_id": {"$in": additional_ids}, "user_id": user["email"]},
            {"$set": {"custom_category": category}},
        )
        bulk_count = result.modified_count

    return {
        "updated": transaction_id,
        "custom_category": category,
        "bulk_count": bulk_count,
    }


RAW_TRUELAYER_CATEGORIES = {"BILL_PAYMENT", "DEBIT", "DIRECT_DEBIT", "PURCHASE", "STANDING_ORDER",
                             "CREDIT", "TRANSFER"}

VALID_CATEGORIES = [
    "Groceries", "Eating Out", "Transport", "Entertainment",
    "Shopping", "Bills", "Subscriptions", "Health", "Travel",
    "Software", "Savings", "Debt", "Transfer", "Income", "Other",
]

# Rule-based merchant patterns — applied at sync time and before AI calls.
# Order matters: first match wins.
MERCHANT_PATTERNS: list[tuple[re.Pattern, str]] = [
    # Credit card payment received (on the card itself) → Transfer, not Income
    (re.compile(r'payment received|thank you for payment|card payment received|direct debit payment', re.I), 'Transfer'),
    # Amex payment from bank account → Transfer
    (re.compile(r'american express.*ddr|amex.*ddr|american express.*direct debit|\bAMERICAN EXPRESS\b', re.I), 'Transfer'),
    # Goldman Sachs salary / BGC credit → Income (must come before generic GS Transfer rule)
    (re.compile(r'goldman sachs.*bgc|goldman sachs.*bcc|goldman sachs.*salary|gs.*payroll', re.I), 'Income'),
    # Interest earned / received → Income
    (re.compile(r'interest received|interest earned|interest credit|gross interest|net interest|interest payment to you|interest paid to you|credit interest', re.I), 'Income'),
    # Marcus savings account transfers → Transfer
    (re.compile(r'\bmarcus\b', re.I), 'Transfer'),
    # NatWest Mastercard / World Mastercard debt repayments → Debt
    (re.compile(r'nw world mastercar|natwest.*mastercard|world mastercard payment', re.I), 'Debt'),
    # NATWEST credit card self-payment (paying own Natwest CC from Natwest bank) → Debt
    # Description pattern: just "NATWEST" as the payee on a bank account debit
    (re.compile(r'^natwest\s*$', re.I), 'Debt'),
    # Groceries
    (re.compile(r'tesco|sainsbury|asda|morrisons?|waitrose|lidl|aldi|iceland food|co-?op\b|ocado|farmfoods|marks.{0,5}spencer food|m&s food|whole foods|budgens|londis|spar\b|nisa\b|costco', re.I), 'Groceries'),
    # Eating Out
    (re.compile(r"mcdonald'?s?|kfc\b|starbucks|costa coffee|pret\b|nando'?s?|pizza\b|burger king|subway\b|deliveroo|just.?eat|uber.?eat|greggs|domino'?s?|papa.?john|wagamama|itsu\b|leon\b|five.?guys|wetherspoon|yo.?sushi|wasabi|eat\b|caffe nero|cafe\b|restaurant|bistro|brasserie|food.?delivery|hungry.?house", re.I), 'Eating Out'),
    # Transport — public / ride-share
    (re.compile(r'tfl\b|transport for london|oyster|uber\b|bolt\b|trainline|national rail|avanti|lner\b|cross.?country|great western|south western|south.?eastern|northern rail|arriva|stagecoach|first.?bus|megabus|national express|eurostar|heathrow express|gatwick express|stansted express|go.?ahead|chiltern rail', re.I), 'Transport'),
    # Transport — fuel / parking
    (re.compile(r'\bbp\b|shell\b|esso\b|total energies|texaco|gulf\b|moto\b|roadchef|welcome break|petrol|fuel\b|parking|ncp\b|q-park|ringgo|paybyphone', re.I), 'Transport'),
    # Subscriptions (streaming / software / recurring)
    (re.compile(r'netflix|spotify|disney\+?|amazon prime|apple music|youtube.?premium|google\*youtube|now tv|now\.tv|apple.?one|apple\.?com/bill|apple tv\+?|hulu|paramount\+?|bbc sounds|audible|kindle unlimited|duolingo|headspace|calm\b|grammarly|canva\b|adobe\b|microsoft 365|office 365|dropbox|icloud|google one|playstation|psn\b|ps\+|xbox.?game.?pass|nintendo online|twitch', re.I), 'Subscriptions'),
    # Entertainment
    (re.compile(r'odeon|vue cinema|cineworld|curzon|everyman cinema|ticketmaster|see.?tickets|eventbrite|sky sports|bt sport|dazn\b|steam\b|epic games|xbox store|nintendo eshop|google play|app store|museum|theatre|gallery|gig\b|concert', re.I), 'Entertainment'),
    # Shopping — online & retail
    (re.compile(r'\bamazon\b(?!.*prime)|asos\b|zara\b|h&m\b|h and m|next\b|john lewis|argos\b|currys\b|pc world|ebay\b|very\b|boohoo|river island|topshop|primark|tkmaxx|tk maxx|matalan|new look|sports direct|jd sports|foot locker|footlocker|nike\b|adidas\b|vinted\b|etsy\b|zalando|prettylittlething|shein\b|uniqlo|gap\b|lush\b|holland.?barrett|the body shop|boots(?! pharmacy)', re.I), 'Shopping'),
    # Bills — utilities & telecoms
    (re.compile(r'british gas|octopus energy|edf energy|e\.?on\b|scottish power|npower|bulb\b|ovo energy|shell energy|thames water|severn trent|yorkshire water|united utilities|south west water|bt group\b|bt broadband|virgin media|sky\b|vodafone|ee\b|o2\b|three\b|giffgaff|talktalk|plusnet|now broadband|council tax|tv licence|water bill|electricity bill|gas bill|broadband', re.I), 'Bills'),
    # Health & fitness
    (re.compile(r'boots pharmacy|lloyds pharmacy|superdrug|pharmacy|chemist|puregym|the gym group|anytime fitness|david lloyd|virgin active|planet fitness|nuffield health|bannatyne|snap fitness|dentist|dental|doctor\b|gp\b|nhs\b|hospital|optician|specsavers|vision express|holland.?barrett|vitabiotics|protein', re.I), 'Health'),
    # Travel
    (re.compile(r'airbnb|booking\.com|hotels\.com|expedia|trivago|ryanair|easyjet|british airways|jet2|tui\b|virgin atlantic|wizz air|blue air|hilton|marriott|premier inn|travelodge|holiday inn|ibis\b|accor|airfare|holiday|travel insurance', re.I), 'Travel'),
    # Software & dev tools
    (re.compile(r'github\b|digitalocean|aws\b|amazon web services|google cloud|azure\b|heroku|netlify|vercel|cloudflare|linode|hetzner|namecheap|godaddy|1password|lastpass|dashlane|bitwarden|notion\b|figma\b|slack\b|zoom\b|webflow|railway\b|supabase|mongodb atlas|datadog|sentry\b|linear\b', re.I), 'Software'),
    # Savings & investments
    (re.compile(r'moneybox|plum\b|chip\b|nutmeg|wealthify|wealthsimple|vanguard|hargreaves lansdown|fidelity|trading 212|freetrade|ii\b|interactive investor|isa\b|pension|savings', re.I), 'Savings'),
    # Interest charges & fees → Bills
    (re.compile(r'interest on your|interest charge|late fee|overdraft fee|annual fee|card fee|bank charge', re.I), 'Bills'),
    # Balance transfers & pot withdrawals (Monzo/Starling) → Transfer
    (re.compile(r'balance transfer|internal transfer|faster payment|bacs payment|chaps payment|from .* pot\b|goldman sachs\b', re.I), 'Transfer'),
    # Car rental → Transport
    (re.compile(r'enterprise rent|rent.?a.?car|hertz\b|avis\b|sixt\b|national car|zipcar|enterprise.?car', re.I), 'Transport'),
    # Service stations / fuel without brand → Transport
    (re.compile(r'service.?station|s/stn\b|petrol station|auto service|car wash|mot\b|tyre', re.I), 'Transport'),
    # Sports & leisure → Health
    (re.compile(r'playtomic|tennis|padel|squash|badminton|swimming|leisure.?centre|sports.?centre|golf|yoga|pilates|crossfit', re.I), 'Health'),
    # Bus/coach operators → Transport
    (re.compile(r'\bnx bus\b|arriva bus|first bus|stagecoach bus|national express bus|megabus|coach\b', re.I), 'Transport'),
    # Personal standing orders with name patterns → Transfer
    (re.compile(r'\b(sto|standing order)\b', re.I), 'Transfer'),
    # Eating Out catch-all for dining/food descriptors
    (re.compile(r'dining|diner\b|grill\b|kitchen\b|eatery|takeaway|take.?away', re.I), 'Eating Out'),
    # PayPal payments → Shopping (generic online purchase)
    (re.compile(r'\bpaypal\b', re.I), 'Shopping'),
    # ATM / cash withdrawals → Other
    (re.compile(r'\batm\b|cash.?machine|cash.?withdrawal|cashpoint', re.I), 'Other'),
    # Currency / crypto exchange → Transfer
    (re.compile(r'exchanged? to\b|fx\b|foreign.?exchange|currency.?exchange', re.I), 'Transfer'),
    # Pot transfers (Monzo/Starling/Goldman) → Transfer
    (re.compile(r'from .* pot\b|to .* pot\b|pot.?transfer|pot.?withdrawal|pot.?deposit', re.I), 'Transfer'),
    # Post office → Shopping
    (re.compile(r'post office\b|royal mail\b|parcelforce', re.I), 'Shopping'),
    # Perks / cashback / rewards → Income
    (re.compile(r'\bperks?\b|cashback\b|reward.?payment|loyalty.?reward', re.I), 'Income'),
]


def rule_categorise(merchant: str, description: str) -> Optional[str]:
    """Return a category if any merchant rule matches; else None."""
    text = f"{merchant} {description}"
    for pattern, category in MERCHANT_PATTERNS:
        if pattern.search(text):
            return category
    return None


async def _apply_rules_bulk(user_id: str, structural: bool = False) -> int:
    """Apply merchant rules to null/raw/Other transactions.
    If structural=True, also runs the more expensive passes:
      - Pass 1: credits on credit card accounts → never Income
      - Pass 2: mirror pairs (same desc+amount, opposite direction within 5 days) → Transfer
    structural=True is used by sync and auto-categorise; False for startup cleanup.
    Returns total number updated."""
    updated = 0

    if structural:
        # ── Pass 1: Fix credits on credit card accounts — never Income ────────
        cc_ids = [d["_id"] async for d in accounts_col.find({"user_id": user_id, "type": "credit_card"}, {"_id": 1})]
        if cc_ids:
            result = await transactions_col.update_many(
                {
                    "user_id": user_id,
                    "account_id": {"$in": cc_ids},
                    "transaction_type": "credit",
                    "category": "Income",
                    "custom_category": None,
                },
                {"$set": {"category": "Transfer"}},
            )
            updated += result.modified_count

        # ── Pass 2: Match transfer pairs by description + amount ──────────────
        from collections import defaultdict
        all_txns = await transactions_col.find(
            {"user_id": user_id, "custom_category": None, "description": {"$ne": None}},
            {"description": 1, "amount": 1, "transaction_type": 1, "date": 1, "category": 1},
        ).to_list(None)

        desc_map: dict = defaultdict(list)
        for t in all_txns:
            key = re.sub(r'\s+', ' ', (t.get("description") or "").strip().lower())
            if key:
                desc_map[key].append(t)

        transfer_ids = []
        for key, txns in desc_map.items():
            credits = [t for t in txns if t["transaction_type"] == "credit"]
            debits  = [t for t in txns if t["transaction_type"] == "debit"]
            if not credits or not debits:
                continue
            for c in credits:
                for d in debits:
                    if abs(c["amount"] - d["amount"]) < 0.02:
                        date_diff = abs((c["date"] - d["date"]).days) if isinstance(c["date"], datetime) and isinstance(d["date"], datetime) else 999
                        if date_diff <= 5:
                            if c.get("category") != "Transfer":
                                transfer_ids.append(c["_id"])
                            if d.get("category") != "Transfer":
                                transfer_ids.append(d["_id"])

        if transfer_ids:
            result = await transactions_col.update_many(
                {"_id": {"$in": transfer_ids}, "custom_category": None},
                {"$set": {"category": "Transfer"}},
            )
            updated += result.modified_count

    # ── Pass 3: Merchant rules on null/raw/Other transactions ─────────────────
    raw_txns = await transactions_col.find(
        {"user_id": user_id, "custom_category": None,
         "$or": [{"category": None}, {"category": {"$in": list(RAW_TRUELAYER_CATEGORIES) + ["Other"]}}]},
        {"merchant_name": 1, "description": 1, "transaction_type": 1, "category": 1},
    ).to_list(None)

    for t in raw_txns:
        merchant = t.get("merchant_name") or ""
        description = t.get("description", "")
        txn_type = t.get("transaction_type", "debit")
        raw_cat = t.get("category", "")

        if raw_cat == "TRANSFER":
            cat = "Transfer"
        elif txn_type == "credit" and raw_cat in ("CREDIT", None):
            cat = "Transfer"
        else:
            cat = rule_categorise(merchant, description)
            if cat is None and raw_cat in RAW_TRUELAYER_CATEGORIES:
                cat = "__clear__"

        if cat == "__clear__":
            await transactions_col.update_one({"_id": t["_id"]}, {"$set": {"category": None}})
            updated += 1
        elif cat:
            await transactions_col.update_one({"_id": t["_id"]}, {"$set": {"category": cat}})
            updated += 1

    return updated


@app.post("/transactions/auto-categorise")
async def auto_categorise(from_date: Optional[str] = None, to_date: Optional[str] = None, user: dict = Depends(current_user)):
    """Categorise transactions using merchant rules then AI.

    Raw TrueLayer categories are fixed across ALL dates.
    Truly uncategorised (null) transactions are filtered by date range (default: all time).
    Never overwrites custom_category.
    """
    uid = user["email"]

    # Step 1: apply deterministic merchant rules to everything with a raw category
    rules_fixed = await _apply_rules_bulk(uid, structural=True)

    # Step 2: find what's still uncategorised after rules
    try:
        start_dt = datetime.fromisoformat(from_date) if from_date else None
        end_dt   = datetime.fromisoformat(to_date)   if to_date   else None
    except ValueError as e:
        raise HTTPException(400, f"Invalid date format: {e}")

    date_filter: dict = {}
    if start_dt:
        date_filter["$gte"] = start_dt
    if end_dt:
        date_filter["$lte"] = end_dt

    query: dict = {
        "user_id": uid,
        "custom_category": None,
        "transaction_type": "debit",
        "$or": [
            {"category": None},
            {"category": {"$in": list(RAW_TRUELAYER_CATEGORIES)}},
        ],
    }
    if date_filter:
        query["date"] = date_filter

    uncategorised = await transactions_col.find(query).to_list(1000)

    if not uncategorised:
        return {"rules_fixed": rules_fixed, "ai_categorised": 0}

    # ── Step A: historical merchant matching ──────────────────────────────────
    # Build a map of merchant_name/description → category from already-categorised transactions.
    # Prefer custom_category (user-confirmed) over auto-assigned category.
    historical = await transactions_col.find(
        {"user_id": uid,
         "$or": [{"custom_category": {"$ne": None}}, {"category": {"$nin": list(RAW_TRUELAYER_CATEGORIES) + [None]}}]},
        {"merchant_name": 1, "description": 1, "category": 1, "custom_category": 1},
    ).to_list(None)

    merchant_map: dict[str, str] = {}  # normalised key → category
    for h in historical:
        cat = h.get("custom_category") or h.get("category")
        if not cat or cat in RAW_TRUELAYER_CATEGORIES:
            continue
        # Prefer merchant_name exact match; fall back to normalised description
        for key in [h.get("merchant_name"), h.get("description")]:
            if key:
                norm = re.sub(r'\s+', ' ', key.strip().lower())
                if norm and norm not in merchant_map:
                    merchant_map[norm] = cat

    # Apply historical matches; only send remaining to AI
    needs_ai: list = []
    history_matched = 0
    for t in uncategorised:
        matched = None
        for key in [t.get("merchant_name"), t.get("description")]:
            if key:
                norm = re.sub(r'\s+', ' ', key.strip().lower())
                if norm in merchant_map:
                    matched = merchant_map[norm]
                    break
        if matched:
            await transactions_col.update_one(
                {"_id": t["_id"]}, {"$set": {"category": matched}}
            )
            history_matched += 1
        else:
            needs_ai.append(t)

    if not needs_ai or not OPENROUTER_API_KEY:
        return {"rules_fixed": rules_fixed, "history_matched": history_matched, "ai_categorised": 0}

    # ── Step B: AI categorisation for remaining transactions ──────────────────
    # Collect manual examples as few-shot context
    manual = await transactions_col.find(
        {"user_id": uid, "custom_category": {"$ne": None}},
        {"merchant_name": 1, "description": 1, "custom_category": 1},
    ).limit(50).to_list(50)
    example_block = ""
    if manual:
        lines_ex = "\n".join(
            f'  "{(e.get("merchant_name") or e.get("description", ""))[:50]}" → {e["custom_category"]}'
            for e in manual
        )
        example_block = f"User-confirmed examples (follow these patterns):\n{lines_ex}\n\n"

    ai_total = 0
    for i in range(0, len(needs_ai), 30):
        batch = needs_ai[i:i + 30]
        lines = "\n".join(
            f'{j}: merchant="{t.get("merchant_name") or ""}" '
            f'desc="{t.get("description", "")[:60]}" '
            f'amount=£{t["amount"]:.2f}'
            for j, t in enumerate(batch)
        )
        prompt = (
            f"You are a UK personal finance categoriser. "
            f"Assign each transaction to exactly one category from: {', '.join(VALID_CATEGORIES)}.\n"
            f"Use the merchant name and description to identify WHAT the transaction is — "
            f"never use the payment method (direct debit, standing order, debit, purchase) as the category.\n"
            f"If genuinely uncertain, use 'Other'. "
            f"Reply with ONLY a JSON object like {{\"0\": \"Groceries\", \"1\": \"Transport\"}}.\n\n"
            f"{example_block}"
            f"Transactions:\n{lines}"
        )
        try:
            async with httpx.AsyncClient(timeout=30) as http:
                r = await http.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}",
                             "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
                    json={"model": "anthropic/claude-haiku-4-5",
                          "max_tokens": 400,
                          "messages": [{"role": "user", "content": prompt}]},
                )
            if r.status_code == 200:
                content = r.json()["choices"][0]["message"]["content"]
                m = re.search(r"\{.*\}", content, re.DOTALL)
                if m:
                    mapping = json.loads(m.group())
                    for k, cat in mapping.items():
                        if k.isdigit() and int(k) < len(batch):
                            final_cat = cat if cat in VALID_CATEGORIES else "Other"
                            await transactions_col.update_one(
                                {"_id": batch[int(k)]["_id"]},
                                {"$set": {"category": final_cat}},
                            )
                            ai_total += 1
            # Fallback: any in this batch still uncategorised → "Other"
            for t in batch:
                doc = await transactions_col.find_one(
                    {"_id": t["_id"], "$or": [{"category": None}, {"category": {"$in": list(RAW_TRUELAYER_CATEGORIES)}}]},
                    {"_id": 1}
                )
                if doc:
                    await transactions_col.update_one({"_id": t["_id"]}, {"$set": {"category": "Other"}})
        except Exception:
            # On any error, mark the whole batch as Other rather than leaving them raw
            for t in batch:
                await transactions_col.update_one(
                    {"_id": t["_id"]},
                    {"$set": {"category": "Other"}},
                )

    return {"rules_fixed": rules_fixed, "history_matched": history_matched, "ai_categorised": ai_total}


@app.get("/kpis", response_model=KPIResponse)
async def get_kpis(user: dict = Depends(current_user)):
    uid = user["email"]
    region = await get_user_region(uid)
    cutoff = datetime.now() - timedelta(days=90)

    if region == "Kenya":
        mono_accs  = await mono_accounts_col.find({"user_id": uid}).to_list(None)
        mpesa_accs = await mpesa_accounts_col.find({"user_id": uid}).to_list(None)
        stmt_accs  = await statement_accounts_col.find({"user_id": uid}).to_list(None)
        all_accs   = mono_accs + mpesa_accs + stmt_accs
        if not all_accs:
            return KPIResponse(net_worth=0, cash=0, runway=0, investments=0, pensions=0, last_updated=datetime.now())
        net_worth = sum(a.get("balance", 0) for a in all_accs)
        cash      = net_worth
        debits    = await _get_kenya_transactions(uid, cutoff)
        debits    = [d for d in debits if d.get("transaction_type") == "debit"]
        avg_spend = (sum(d["amount"] for d in debits) / 3) if debits else 1000
        runway    = cash / avg_spend if avg_spend else 0
        return KPIResponse(
            net_worth=net_worth, cash=cash, runway=round(runway, 1),
            investments=0, pensions=0, last_updated=datetime.now(),
        )

    accounts = await accounts_col.find({"user_id": uid}).to_list(None)
    if not accounts:
        return KPIResponse(net_worth=0, cash=0, runway=0, investments=0, pensions=0, last_updated=datetime.now())

    net_worth = sum(a["balance"] for a in accounts)
    cash      = sum(a["balance"] for a in accounts if a["type"] == "bank")
    debits    = await transactions_col.find(
        {"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}
    ).to_list(None)
    avg_spend = (sum(d["amount"] for d in debits) / 3) if debits else 1000
    runway    = cash / avg_spend if avg_spend else 0

    return KPIResponse(
        net_worth=net_worth, cash=cash, runway=round(runway, 1),
        investments=0, pensions=0, last_updated=datetime.now(),
    )


@app.get("/insights", response_model=List[Insight])
async def get_insights(user: dict = Depends(current_user)):
    from collections import defaultdict
    uid = user["email"]
    insights = []
    accounts = await accounts_col.find({"user_id": uid}).to_list(None)

    for acc in accounts:
        if acc["balance"] > 5000:
            insights.append(Insight(
                id=f"idle-{acc['_id']}", title=f"Sweep idle cash from {acc['name']}",
                impact=int(acc["balance"] * 0.045), confidence=100,
                rationale=f"£{acc['balance']:,.0f} sitting idle. Move to 5% AER savings → +£{int(acc['balance']*0.045)}/yr.",
                action="Transfer to savings", category="savings",
            ))

    cutoff = datetime.now() - timedelta(days=90)
    txns   = await transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}).to_list(None)
    by_merchant: dict[str, list] = defaultdict(list)
    for t in txns:
        if t.get("merchant_name"):
            by_merchant[t["merchant_name"]].append(t)

    for merchant, ts in by_merchant.items():
        if len(ts) >= 2:
            sorted_ts  = sorted(ts, key=lambda x: x["date"])
            avg_amount = sum(t["amount"] for t in sorted_ts) / len(sorted_ts)
            last_days  = (datetime.now() - sorted_ts[-1]["date"]).days
            if last_days > 60:
                insights.append(Insight(
                    id=f"sub-{merchant.lower().replace(' ','-')}",
                    title=f"Review {merchant} subscription",
                    impact=int(avg_amount * 12), confidence=85,
                    rationale=f"£{avg_amount:.2f}/mo to {merchant}. Last charge {last_days}d ago — possibly unused.",
                    action="Review subscription", category="spending",
                ))

    insights.sort(key=lambda x: x.impact, reverse=True)
    return insights[:10]


@app.get("/preferences")
async def get_preferences(user: dict = Depends(current_user)):
    doc = await preferences_col.find_one({"user_id": user["email"]})
    defaults = {
        "hide_net_worth": False,
        "dark_mode": False,
        "pay_period_config": {"type": "calendar_month"},
        "region": "UK",
    }
    if not doc:
        return defaults
    return {
        "hide_net_worth": doc.get("hide_net_worth", False),
        "dark_mode": doc.get("dark_mode", False),
        "pay_period_config": doc.get("pay_period_config", {"type": "calendar_month"}),
        "region": doc.get("region", "UK"),
    }

@app.patch("/preferences")
async def update_preferences(body: dict, user: dict = Depends(current_user)):
    await preferences_col.update_one(
        {"user_id": user["email"]},
        {"$set": {**body, "user_id": user["email"]}},
        upsert=True,
    )
    doc = await preferences_col.find_one({"user_id": user["email"]})
    return {"hide_net_worth": doc.get("hide_net_worth", False), "dark_mode": doc.get("dark_mode", False)}


BUILTIN_CATEGORIES = [
    "Groceries", "Eating Out", "Transport", "Entertainment", "Shopping",
    "Bills", "Subscriptions", "Health", "Travel", "Software",
    "Savings", "Debt", "Transfer", "Income", "Other",
]

@app.get("/categories")
async def get_categories(user: dict = Depends(current_user)):
    doc = await user_categories_col.find_one({"user_id": user["email"]})
    custom = doc.get("categories", []) if doc else []
    return {"builtin": BUILTIN_CATEGORIES, "custom": custom, "all": BUILTIN_CATEGORIES + custom}

@app.post("/categories")
async def add_category(body: dict, user: dict = Depends(current_user)):
    name = body.get("name", "").strip()
    if not name or len(name) > 40:
        raise HTTPException(400, "Invalid category name")
    if name in BUILTIN_CATEGORIES:
        raise HTTPException(400, "That's a built-in category")
    await user_categories_col.update_one(
        {"user_id": user["email"]},
        {"$addToSet": {"categories": name}, "$setOnInsert": {"user_id": user["email"]}},
        upsert=True,
    )
    doc = await user_categories_col.find_one({"user_id": user["email"]})
    custom = doc.get("categories", []) if doc else []
    return {"builtin": BUILTIN_CATEGORIES, "custom": custom, "all": BUILTIN_CATEGORIES + custom}

@app.delete("/categories/{name}")
async def delete_category(name: str, user: dict = Depends(current_user)):
    if name in BUILTIN_CATEGORIES:
        raise HTTPException(400, "Cannot delete built-in categories")
    await user_categories_col.update_one(
        {"user_id": user["email"]},
        {"$pull": {"categories": name}},
    )
    return {"deleted": name}


@app.get("/debt/insights")
async def debt_insights(user: dict = Depends(current_user)):
    """Calculate debt payoff insights based on current balances and spending."""
    uid = user["email"]
    region = await get_user_region(uid)
    cutoff = datetime.now() - timedelta(days=90)

    if region == "Kenya":
        # Kenya: no credit cards — debt is 0; compute income/spend from Mono+MPesa
        all_txns    = await _get_kenya_transactions(uid, cutoff)
        income_txns = [t for t in all_txns if t.get("transaction_type") == "credit" and
                       (t.get("custom_category") or t.get("category")) == "Income"]
        debit_txns  = [t for t in all_txns if t.get("transaction_type") == "debit"]
        monthly_income = sum(t["amount"] for t in income_txns) / 3
        cat_totals: dict[str, float] = {}
        for t in debit_txns:
            cat = t.get("custom_category") or t.get("category") or "Other"
            cat_totals[cat] = cat_totals.get(cat, 0) + t["amount"]
        monthly_cat = {k: round(v / 3, 2) for k, v in cat_totals.items()}
        non_disc = {"Transfer", "Savings", "Debt", "Income"}
        monthly_essential = sum(v for k, v in monthly_cat.items() if k not in non_disc)
        monthly_surplus   = monthly_income - monthly_essential
        DISCRETIONARY = ["Eating Out", "Entertainment", "Shopping", "Travel", "Subscriptions", "Software", "Other", "Health"]
        recommendations = []
        for cat in sorted(DISCRETIONARY, key=lambda c: monthly_cat.get(c, 0), reverse=True):
            amt = monthly_cat.get(cat, 0)
            if amt > 5:
                recommendations.append({
                    "category": cat, "monthly_spend": amt,
                    "cut_25pct_saves": round(amt * 0.25, 2),
                    "cut_50pct_saves": round(amt * 0.50, 2),
                })
        disc_cutoff = datetime.now() - timedelta(days=30)
        DISC_CATS = {"Eating Out", "Entertainment", "Shopping", "Travel", "Subscriptions", "Software", "Other", "Health"}
        disc_txns = [t for t in all_txns if
                     t.get("transaction_type") == "debit" and
                     t.get("date", datetime.min) >= disc_cutoff and
                     (t.get("custom_category") or t.get("category")) in DISC_CATS]
        disc_txns.sort(key=lambda t: t.get("amount", 0), reverse=True)
        recent_discretionary = [
            {"id": str(t["_id"]), "description": t.get("merchant_name") or t.get("description", ""),
             "amount": t["amount"], "date": t["date"].isoformat(),
             "category": t.get("custom_category") or t.get("category") or "Other"}
            for t in disc_txns[:20]
        ]
        return {
            "total_debt": 0, "accounts": [],
            "monthly_income": round(monthly_income, 2),
            "monthly_spending": round(monthly_essential, 2),
            "monthly_surplus": round(monthly_surplus, 2),
            "monthly_debt_payment": 0,
            "payment_needed_12mo": 0, "gap_to_12mo": 0, "months_at_current_rate": 0,
            "category_spending": {k: v for k, v in sorted(monthly_cat.items(), key=lambda x: -x[1])},
            "recommendations": recommendations,
            "recent_discretionary": recent_discretionary,
        }

    accounts = await accounts_col.find({"user_id": uid}).to_list(None)
    cc_accounts = [a for a in accounts if a.get("type") == "credit_card" and a.get("balance", 0) < 0]
    total_debt = sum(abs(a["balance"]) for a in cc_accounts)

    # Monthly income
    income_txns = await transactions_col.find(
        {"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}}
    ).to_list(None)
    monthly_income = sum(t["amount"] for t in income_txns) / 3

    # Monthly spending by category (debit only, exclude Transfer/Debt/Savings)
    debit_txns = await transactions_col.find(
        {"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}
    ).to_list(None)

    cat_totals: dict[str, float] = {}
    for t in debit_txns:
        cat = t.get("custom_category") or t.get("category") or "Other"
        cat_totals[cat] = cat_totals.get(cat, 0) + t["amount"]

    monthly_cat = {k: round(v / 3, 2) for k, v in cat_totals.items()}

    # What's already going to debt repayment
    monthly_debt_payment = monthly_cat.get("Debt", 0)

    # Spending surplus (income minus non-debt, non-transfer spending)
    non_discretionary_cats = {"Transfer", "Savings", "Debt", "Income"}
    monthly_essential = sum(v for k, v in monthly_cat.items() if k not in non_discretionary_cats)
    monthly_surplus = monthly_income - monthly_essential

    # Payoff maths — simple (no interest modelling)
    payment_for_12mo = round(total_debt / 12, 2) if total_debt > 0 else 0
    gap = max(0, round(payment_for_12mo - monthly_surplus, 2))
    months_at_current = round(total_debt / monthly_surplus, 1) if monthly_surplus > 0 else 999

    # Discretionary categories — ranked by spend, with 25% cut savings
    DISCRETIONARY = ["Eating Out", "Entertainment", "Shopping", "Travel", "Subscriptions", "Software", "Other", "Health"]
    recommendations = []
    for cat in sorted(DISCRETIONARY, key=lambda c: monthly_cat.get(c, 0), reverse=True):
        amt = monthly_cat.get(cat, 0)
        if amt > 5:
            recommendations.append({
                "category": cat,
                "monthly_spend": amt,
                "cut_25pct_saves": round(amt * 0.25, 2),
                "cut_50pct_saves": round(amt * 0.50, 2),
            })

    # Recent discretionary transactions (last 30 days)
    disc_cutoff = datetime.now() - timedelta(days=30)
    DISC_CATS = {"Eating Out", "Entertainment", "Shopping", "Travel", "Subscriptions", "Software", "Other", "Health"}
    disc_txns = await transactions_col.find({
        "user_id": uid,
        "transaction_type": "debit",
        "date": {"$gte": disc_cutoff},
        "$or": [
            {"custom_category": {"$in": list(DISC_CATS)}},
            {"category": {"$in": list(DISC_CATS)}, "custom_category": None},
        ]
    }).sort("amount", -1).to_list(20)

    recent_discretionary = [
        {
            "id": str(t["_id"]),
            "description": t.get("merchant_name") or t.get("description", ""),
            "amount": t["amount"],
            "date": t["date"].isoformat(),
            "category": t.get("custom_category") or t.get("category") or "Other",
        }
        for t in disc_txns
    ]

    return {
        "total_debt": round(total_debt, 2),
        "accounts": [
            {"name": a["name"], "provider": a.get("provider", ""), "balance": round(a["balance"], 2)}
            for a in cc_accounts
        ],
        "monthly_income": round(monthly_income, 2),
        "monthly_spending": round(monthly_essential, 2),
        "monthly_surplus": round(monthly_surplus, 2),
        "monthly_debt_payment": round(monthly_debt_payment, 2),
        "payment_needed_12mo": payment_for_12mo,
        "gap_to_12mo": gap,
        "months_at_current_rate": months_at_current,
        "category_spending": {k: v for k, v in sorted(monthly_cat.items(), key=lambda x: -x[1])},
        "recommendations": recommendations,
        "recent_discretionary": recent_discretionary,
    }


# ── PIN auth ──────────────────────────────────────────────────────────────────

@app.post("/auth/pin")
async def pin_login(body: dict):
    if body.get("pin") != DASHBOARD_PIN:
        raise HTTPException(401, "Incorrect PIN")
    return {"session_token": serializer.dumps({"email": "local", "name": "Local"}), "ok": True}


@app.post("/auth/session/validate")
async def validate_session(request: Request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    try:
        data = serializer.loads(auth[7:], max_age=SESSION_MAX_AGE)
        name = data.get("name", "") if isinstance(data, dict) else ""
        email = data.get("email", "") if isinstance(data, dict) else ""
        return {"valid": True, "name": name, "email": email}
    except (SignatureExpired, BadSignature):
        raise HTTPException(401, "Session expired")


@app.get("/auth/google")
async def google_auth():
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(500, "Google OAuth not configured")
    redirect_uri = f"{APP_URL}/api/auth/google/callback"
    params = urllib.parse.urlencode({
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
    })
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


@app.get("/auth/google/callback")
async def google_callback(code: str = None, error: str = None):
    if error or not code:
        return RedirectResponse(f"{APP_URL}/?error=auth_failed")

    redirect_uri = f"{APP_URL}/api/auth/google/callback"

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )

    if not token_resp.is_success:
        return RedirectResponse(f"{APP_URL}/?error=token_exchange_failed")

    access_token = token_resp.json().get("access_token")

    async with httpx.AsyncClient() as client:
        userinfo_resp = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )

    if not userinfo_resp.is_success:
        return RedirectResponse(f"{APP_URL}/?error=userinfo_failed")

    userinfo = userinfo_resp.json()
    email = userinfo.get("email", "").lower()
    if not email:
        return RedirectResponse(f"{APP_URL}/?error=auth_failed")

    if email not in ALLOWED_EMAILS:
        return RedirectResponse(f"{APP_URL}/?error=access_denied")

    session_token = serializer.dumps({"email": email, "name": userinfo.get("name", "")})
    return RedirectResponse(f"{APP_URL}/?token={urllib.parse.quote(session_token, safe='')}")


@app.post("/admin/fix-card-transactions")
async def fix_card_transactions(user: dict = Depends(current_user)):
    """One-time migration: flip transaction_type for credit card accounts and clear category
    so auto-categorise can re-assign correctly."""
    uid = user["email"]
    cc_ids = [d["_id"] async for d in accounts_col.find({"user_id": uid, "type": "credit_card"}, {"_id": 1})]
    if not cc_ids:
        return {"message": "No credit card accounts found", "fixed": 0}

    # Swap credit ↔ debit in two passes using a temp sentinel
    await transactions_col.update_many(
        {"account_id": {"$in": cc_ids}, "transaction_type": "credit"},
        {"$set": {"transaction_type": "_fixing", "category": None}},
    )
    await transactions_col.update_many(
        {"account_id": {"$in": cc_ids}, "transaction_type": "debit"},
        {"$set": {"transaction_type": "credit", "category": None}},
    )
    result = await transactions_col.update_many(
        {"account_id": {"$in": cc_ids}, "transaction_type": "_fixing"},
        {"$set": {"transaction_type": "debit"}},
    )
    return {"message": "Card transactions fixed — run auto-categorise next", "fixed": result.modified_count}


@app.on_event("startup")
async def migrate_user_id():
    email = "kevin.maingi12@gmail.com"
    for col in [connections_col, accounts_col, transactions_col]:
        await col.update_many({"user_id": {"$exists": False}}, {"$set": {"user_id": email}})
    # Set Kevin's pay period config to last_friday if not already configured
    await preferences_col.update_one(
        {"user_id": "kevin.maingi12@gmail.com", "pay_period_config": {"$exists": False}},
        {"$set": {"pay_period_config": {"type": "last_friday"}}},
        upsert=False,
    )
    # Apply categorisation rules for ALL users to clear any lingering raw TrueLayer categories
    asyncio.create_task(_fix_all_users_categories())


async def _fix_all_users_categories():
    """Background startup task: only fix users who have uncategorised or raw-category transactions."""
    user_ids = await transactions_col.distinct("user_id")
    for uid in user_ids:
        if not uid:
            continue
        needs_fix = await transactions_col.count_documents({
            "user_id": uid,
            "custom_category": None,
            "$or": [
                {"category": None},
                {"category": {"$in": list(RAW_TRUELAYER_CATEGORIES) + ["Other"]}},
            ],
        })
        if needs_fix > 0:
            await _apply_rules_bulk(uid)


@app.get("/debt/chat/session")
async def get_chat_session(user: dict = Depends(current_user)):
    """Get or create the active chat session for the user."""
    uid = user["email"]
    # Find the most recent active session
    session = await chat_sessions_col.find_one(
        {"user_id": uid},
        sort=[("created_at", -1)]
    )
    if not session:
        session_id = str(uuid_lib.uuid4())
        await chat_sessions_col.insert_one({
            "_id": session_id,
            "user_id": uid,
            "messages": [],
            "created_at": datetime.now(),
        })
        return {"session_id": session_id, "messages": []}
    return {"session_id": session["_id"], "messages": session.get("messages", [])}


@app.post("/debt/chat/new")
async def new_chat_session(user: dict = Depends(current_user)):
    """Start a fresh chat session."""
    uid = user["email"]
    session_id = str(uuid_lib.uuid4())
    await chat_sessions_col.insert_one({
        "_id": session_id,
        "user_id": uid,
        "messages": [],
        "created_at": datetime.now(),
    })
    return {"session_id": session_id, "messages": []}


async def _extract_episodic_memory(uid: str, conversation: list):
    """Ask AI to extract personal facts worth remembering from the conversation."""
    if not OPENROUTER_API_KEY or len(conversation) < 2:
        return
    try:
        extraction_prompt = """Review this conversation and extract any personal facts about the user that would be useful to remember for future financial advice conversations. Focus on: lifestyle preferences, goals, hobbies, family situation, specific financial goals or concerns they've mentioned, constraints, or any personal context.

Output ONLY a JSON array of short fact strings (max 10 facts). If nothing notable, output [].
Example: ["Goes to the gym regularly", "Has a holiday planned for summer", "Wants to save for a house deposit"]

Conversation to analyze:
""" + "\n".join(f"{m['role'].upper()}: {m['content']}" for m in conversation[-10:])

        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
                json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 200,
                      "messages": [{"role": "user", "content": extraction_prompt}]},
            )
        if r.status_code != 200:
            return
        content = r.json()["choices"][0]["message"]["content"].strip()
        # Parse JSON array
        start = content.find("[")
        end = content.rfind("]") + 1
        if start == -1 or end == 0:
            return
        new_facts = json.loads(content[start:end])
        if not new_facts or not isinstance(new_facts, list):
            return
        # Merge with existing facts (deduplicate loosely)
        mem_doc = await episodic_memory_col.find_one({"_id": uid})
        existing = mem_doc.get("facts", []) if mem_doc else []
        # Add only genuinely new facts (simple string match)
        combined = list(existing)
        for f in new_facts:
            if isinstance(f, str) and f not in combined:
                combined.append(f)
        combined = combined[-50:]  # cap at 50 facts
        await episodic_memory_col.update_one(
            {"_id": uid},
            {"$set": {"facts": combined, "updated_at": datetime.now(), "user_id": uid}},
            upsert=True,
        )
    except Exception:
        pass


@app.post("/debt/chat")
async def debt_chat(body: dict, user: dict = Depends(current_user)):
    messages = body.get("messages", [])  # just the new user message
    session_id = body.get("session_id")
    if not messages or not OPENROUTER_API_KEY:
        raise HTTPException(400, "No messages or AI not configured")

    uid = user["email"]
    name = user.get("name", "").split()[0] or "there"
    region = await get_user_region(uid)
    currency = "KES " if region == "Kenya" else "£"

    # Load session history
    history = []
    if session_id:
        session_doc = await chat_sessions_col.find_one({"_id": session_id, "user_id": uid})
        if session_doc:
            history = session_doc.get("messages", [])

    # Load episodic memory
    mem_doc = await episodic_memory_col.find_one({"_id": uid})
    memory_facts = mem_doc.get("facts", []) if mem_doc else []
    memory_section = ""
    if memory_facts:
        memory_section = "\n\nWhat you know about this user from previous conversations:\n" + "\n".join(f"- {f}" for f in memory_facts)

    # Gather financial context — region-aware
    cutoff = datetime.now() - timedelta(days=90)
    non_disc = {"Transfer", "Savings", "Debt", "Income"}

    if region == "Kenya":
        cc_accounts = []
        total_debt = 0.0
        all_txns = await _get_kenya_transactions(uid, cutoff)
        income_txns = [t for t in all_txns if t.get("transaction_type") == "credit" and (t.get("custom_category") or t.get("category")) == "Income"]
        debit_txns  = [t for t in all_txns if t.get("transaction_type") == "debit"]
    else:
        accounts = await accounts_col.find({"user_id": uid}).to_list(None)
        cc_accounts = [a for a in accounts if a.get("type") == "credit_card" and a.get("balance", 0) < 0]
        total_debt = sum(abs(a["balance"]) for a in cc_accounts)
        income_txns = await transactions_col.find({"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}}).to_list(None)
        debit_txns  = await transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}).to_list(None)

    monthly_income = sum(t["amount"] for t in income_txns) / 3
    cat_totals: dict = {}
    for t in debit_txns:
        cat = t.get("custom_category") or t.get("category") or "Other"
        cat_totals[cat] = cat_totals.get(cat, 0) + t["amount"]
    monthly_cat = {k: round(v/3, 2) for k, v in cat_totals.items()}
    monthly_spending = sum(v for k, v in monthly_cat.items() if k not in non_disc)
    monthly_surplus = monthly_income - monthly_spending
    months_to_clear = round(total_debt / monthly_surplus, 1) if monthly_surplus > 0 and total_debt > 0 else 0
    payment_12mo = round(total_debt / 12, 2)
    gap = max(0, round(payment_12mo - monthly_surplus, 2))

    cards_text = "\n".join(f"  - {a['name']} ({a.get('provider','')}): {currency}{abs(a['balance']):.2f}" for a in cc_accounts)
    cats_text = "\n".join(f"  - {k}: {currency}{v:.2f}/mo" for k, v in sorted(monthly_cat.items(), key=lambda x: -x[1]) if k not in non_disc and v > 0)

    debt_line = f"- Total credit card debt: {currency}{total_debt:.2f} across {len(cc_accounts)} card(s)\n{cards_text}" if total_debt > 0 else "- No credit card debt"

    system = f"""You are a friendly, practical personal finance advisor helping {name} manage their finances.

Their current financial situation:
{debt_line}
- Average monthly income (last 3 months): {currency}{monthly_income:.2f}
- Average monthly spending (last 3 months): {currency}{monthly_spending:.2f}
- Monthly surplus available: {currency}{monthly_surplus:.2f}
{f"- At current rate, debt-free in: {months_to_clear} months" if total_debt > 0 else ""}
{f"- To clear debt in 12 months, need: {currency}{payment_12mo:.2f}/month" if total_debt > 0 else ""}
{f"- Monthly shortfall to 12-month goal: {currency}{gap:.2f}" if total_debt > 0 else ""}

Monthly spending breakdown:
{cats_text}{memory_section}

Be specific to their numbers. Be encouraging but realistic. Give concrete, actionable advice. Keep responses concise (2-4 short paragraphs max). Use plain English, no jargon."""

    # Combine history + new messages for the API call
    full_messages = history + messages

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
            json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 600, "messages": [{"role": "system", "content": system}] + full_messages},
        )
    if r.status_code != 200:
        raise HTTPException(500, "AI unavailable")

    reply = r.json()["choices"][0]["message"]["content"]

    # Persist messages to session
    if session_id:
        new_msgs = messages + [{"role": "assistant", "content": reply}]
        await chat_sessions_col.update_one(
            {"_id": session_id, "user_id": uid},
            {"$push": {"messages": {"$each": new_msgs}}},
        )
        # Extract episodic memory in background (fire and forget)
        asyncio.create_task(_extract_episodic_memory(uid, full_messages + [{"role": "assistant", "content": reply}]))

    return {"reply": reply, "session_id": session_id}


@app.get("/budgets")
async def get_budgets(user: dict = Depends(current_user)):
    uid = user["email"]
    region = await get_user_region(uid)
    doc = await budgets_col.find_one({"user_id": uid, "region": region})
    return {"budgets": doc.get("budgets", []) if doc else []}

@app.put("/budgets")
async def set_budgets(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    region = await get_user_region(uid)
    budgets = body.get("budgets", [])
    await budgets_col.update_one(
        {"user_id": uid, "region": region},
        {"$set": {"budgets": budgets, "user_id": uid, "region": region}},
        upsert=True,
    )
    return {"budgets": budgets}

@app.post("/budget/chat")
async def budget_chat(body: dict, user: dict = Depends(current_user)):
    messages = body.get("messages", [])
    session_id = body.get("session_id")
    if not messages or not OPENROUTER_API_KEY:
        raise HTTPException(400, "No messages or AI not configured")

    uid = user["email"]
    name = user.get("name", "").split()[0] or "there"
    region = await get_user_region(uid)

    # Load session history
    history = []
    if session_id:
        session_doc = await chat_sessions_col.find_one({"_id": session_id, "user_id": uid})
        if session_doc:
            history = session_doc.get("messages", [])

    # Load episodic memory
    mem_doc = await episodic_memory_col.find_one({"_id": uid})
    memory_facts = mem_doc.get("facts", []) if mem_doc else []
    memory_section = ""
    if memory_facts:
        memory_section = "\n\nPersonal context from previous conversations:\n" + "\n".join(f"- {f}" for f in memory_facts)

    # Current budgets (region-scoped)
    budget_doc = await budgets_col.find_one({"user_id": uid, "region": region})
    current_budgets = budget_doc.get("budgets", []) if budget_doc else []

    # Spending data (last 3 months)
    cutoff = datetime.now() - timedelta(days=90)
    non_budget = {"Transfer", "Savings", "Debt"}

    if region == "Kenya":
        currency = "KES "
        all_kenya_txns = await _get_kenya_transactions(uid, cutoff)
        debit_txns = [t for t in all_kenya_txns if t.get("transaction_type") == "debit"]
        income_txns = [t for t in all_kenya_txns if t.get("transaction_type") == "credit" and (t.get("custom_category") or t.get("category")) == "Income"]
    else:
        currency = "£"
        debit_txns = await transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}).to_list(None)
        income_txns = await transactions_col.find({"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}}).to_list(None)

    budgets_text = "\n".join(f"  - {b['category']}: {currency}{b['monthly_limit']:.0f}/mo" for b in current_budgets) if current_budgets else "  None set yet"

    cat_totals: dict = {}
    for t in debit_txns:
        cat = t.get("custom_category") or t.get("category") or "Other"
        if cat in non_budget: continue
        cat_totals[cat] = cat_totals.get(cat, 0) + t["amount"]
    monthly_avg = {k: round(v/3, 2) for k, v in cat_totals.items()}
    avg_text = "\n".join(f"  - {k}: {currency}{v:.2f}/mo" for k, v in sorted(monthly_avg.items(), key=lambda x: -x[1]))

    monthly_income = round(sum(t["amount"] for t in income_txns) / 3, 2)

    system = f"""You are a friendly, practical personal finance assistant helping {name} set up and manage monthly budgets.

Their average monthly income: {currency}{monthly_income:.2f}

Their average monthly spending by category (last 3 months):
{avg_text}

Their current budget limits:
{budgets_text}{memory_section}

IMPORTANT: When the user wants to set or update budgets, respond with BOTH a friendly message AND a JSON block in this exact format (the app will parse it to save automatically):

```budgets
[
  {{"category": "Groceries", "monthly_limit": 300}},
  {{"category": "Eating Out", "monthly_limit": 150}}
]
```

Only include categories with actual limits. Don't include Transfer, Savings, Debt.
Be encouraging, practical, and specific to their numbers. Suggest realistic budgets based on their actual spending."""

    full_messages = history + messages

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
            json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 800,
                  "messages": [{"role": "system", "content": system}] + full_messages},
        )
    if r.status_code != 200:
        raise HTTPException(500, "AI unavailable")

    reply = r.json()["choices"][0]["message"]["content"]

    # Parse budget JSON from reply — return as suggestion, do NOT auto-save
    suggested_budgets = None
    try:
        start = reply.find("```budgets")
        if start != -1:
            end = reply.find("```", start + 9)
            json_str = reply[start + 10:end].strip()
            parsed = json.loads(json_str)
            if isinstance(parsed, list):
                suggested_budgets = parsed
    except Exception:
        pass

    # Persist messages to session
    if session_id:
        new_msgs = messages + [{"role": "assistant", "content": reply}]
        await chat_sessions_col.update_one(
            {"_id": session_id, "user_id": uid},
            {"$push": {"messages": {"$each": new_msgs}}},
        )
        asyncio.create_task(_extract_episodic_memory(uid, full_messages + [{"role": "assistant", "content": reply}]))

    return {"reply": reply, "session_id": session_id, "suggested_budgets": suggested_budgets}

@app.get("/budget/chat/session")
async def get_budget_chat_session(user: dict = Depends(current_user)):
    uid = user["email"]
    session = await chat_sessions_col.find_one(
        {"user_id": uid, "session_type": "budget"},
        sort=[("created_at", -1)]
    )
    if not session:
        session_id = str(uuid_lib.uuid4())
        await chat_sessions_col.insert_one({
            "_id": session_id,
            "user_id": uid,
            "session_type": "budget",
            "messages": [],
            "created_at": datetime.now(),
        })
        return {"session_id": session_id, "messages": []}
    return {"session_id": session["_id"], "messages": session.get("messages", [])}

@app.post("/budget/chat/new")
async def new_budget_chat_session(user: dict = Depends(current_user)):
    uid = user["email"]
    session_id = str(uuid_lib.uuid4())
    await chat_sessions_col.insert_one({
        "_id": session_id,
        "user_id": uid,
        "session_type": "budget",
        "messages": [],
        "created_at": datetime.now(),
    })
    return {"session_id": session_id, "messages": []}



# ══════════════════════════════════════════════════════════════════════════════
# ── Mono / Kenya Integration ──────────────────────────────────────────────────
# To revert: remove this section and drop mono_connections, mono_accounts,
# mono_transactions, mpesa_accounts, mpesa_transactions collections.
# ══════════════════════════════════════════════════════════════════════════════

mpesa_accounts_col       = db["mpesa_accounts"]
mpesa_transactions_col   = db["mpesa_transactions"]
statement_accounts_col   = db["statement_accounts"]
statement_transactions_col = db["statement_transactions"]

BANK_SLUG_MAP: dict[str, str] = {
    "m-pesa": "mpesa", "mpesa": "mpesa", "safaricom": "mpesa",
    "equity": "equity", "equity bank": "equity",
    "kcb": "kcb", "kenya commercial bank": "kcb",
    "ncba": "ncba", "ncba bank": "ncba",
    "stanbic": "stanbic", "stanbic bank": "stanbic",
    "absa": "absa",
    "co-op": "coop", "cooperative bank": "coop", "co-operative bank": "coop",
    "dtb": "dtb", "diamond trust bank": "dtb",
    "standard chartered": "stanchart",
    "family bank": "family",
    "i&m bank": "imbank", "im bank": "imbank",
}


def _bank_slug(raw_name: str) -> str:
    key = raw_name.lower().strip()
    return BANK_SLUG_MAP.get(key, re.sub(r"[^a-z0-9]+", "", key) or "bank")


def _statement_dedup_key(account_id: str, ref, date: str, txn_type: str, description: str) -> str:
    if ref and not str(ref).startswith("TXN-"):
        return f"{account_id}|{ref}"
    date_part = date[:10] if len(date) >= 10 else date
    desc_norm = " ".join(description.lower().split())[:80]
    digest = hashlib.sha256(
        f"{account_id}|{date_part}|{txn_type}|{desc_norm}".encode()
    ).hexdigest()[:24]
    return digest


# ── Mono helpers ──────────────────────────────────────────────────────────────

def _mono_headers() -> dict:
    return {"mono-sec-key": MONO_SECRET_KEY, "Content-Type": "application/json"}


async def _sync_mono_connection(connection_id: str, user_id: str) -> list:
    """Fetch accounts and transactions from Mono for one connection."""
    conn = await mono_connections_col.find_one({"_id": connection_id})
    if not conn:
        return []
    account_id = conn["mono_account_id"]
    fetched = []

    async with httpx.AsyncClient(timeout=30) as client:
        # Account info — Mono v2 wraps in {data: {...}}
        ar = await client.get(
            f"{MONO_API_URL}/accounts/{account_id}",
            headers=_mono_headers(),
        )
        if ar.status_code == 200:
            payload = ar.json()
            acc = payload.get("data", payload)
            institution = acc.get("institution", {})
            if isinstance(institution, str):
                institution = {"name": institution}
            # Mono v2 returns balance in major units for some currencies, kobo for NGN
            raw_bal = acc.get("balance", 0)
            currency = acc.get("currency", "KES")
            # Divide by 100 for sub-unit currencies (NGN kobo, KES cents)
            balance = raw_bal / 100 if raw_bal > 10000 else raw_bal
            await mono_accounts_col.update_one(
                {"_id": account_id},
                {"$set": {
                    "_id":           account_id,
                    "connection_id": connection_id,
                    "user_id":       user_id,
                    "name":          acc.get("name", "Account"),
                    "type":          acc.get("type", "bank").lower().replace(" ", "_"),
                    "balance":       balance,
                    "currency":      currency,
                    "provider":      institution.get("name", "Mono") if isinstance(institution, dict) else "Mono",
                    "status":        "connected",
                    "updated_at":    datetime.now(),
                }},
                upsert=True,
            )
            fetched.append(account_id)

        # Transactions — Mono v2 pagination
        for page in range(1, 6):
            tr = await client.get(
                f"{MONO_API_URL}/accounts/{account_id}/transactions",
                headers=_mono_headers(),
                params={"page": page, "limit": 100},
            )
            if tr.status_code != 200:
                break
            tr_payload = tr.json()
            results = tr_payload.get("data", [])
            if not results:
                break
            for t in results:
                raw_amount = abs(t.get("amount", 0))
                # Mono v2: amounts in minor units if > 10000, else major
                amount = raw_amount / 100 if raw_amount > 10000 else raw_amount
                # Mono v2 uses "debit" / "credit" in the type field
                txn_type_raw = t.get("type", t.get("transaction_type", "debit")).lower()
                txn_type = "credit" if txn_type_raw == "credit" else "debit"
                merchant = t.get("merchant", {})
                merchant_name = merchant.get("name") if isinstance(merchant, dict) else None
                narration = t.get("narration", t.get("description", t.get("note", "")))
                date_str = t.get("date", t.get("created_at", t.get("timestamp", "")))
                try:
                    txn_date = datetime.fromisoformat(str(date_str).replace("Z", "+00:00"))
                except Exception:
                    txn_date = datetime.now()

                txn_id = str(t.get("_id", t.get("id", f"{account_id}-{date_str}-{raw_amount}")))
                cat = rule_categorise(merchant_name or "", narration)

                await mono_transactions_col.update_one(
                    {"_id": txn_id},
                    {"$set": {
                        "account_id":       account_id,
                        "user_id":          user_id,
                        "date":             txn_date,
                        "amount":           amount,
                        "currency":         t.get("currency", "KES"),
                        "description":      narration,
                        "merchant_name":    merchant_name,
                        "category":         cat,
                        "transaction_type": txn_type,
                    },
                    "$setOnInsert": {"custom_category": None}},
                    upsert=True,
                )
            # Stop if fewer results than page size
            meta = tr_payload.get("meta", {})
            if not meta.get("next") and len(results) < 100:
                break

    await mono_connections_col.update_one(
        {"_id": connection_id}, {"$set": {"last_synced": datetime.now()}}
    )
    return fetched


# ── Mono auth endpoints ────────────────────────────────────────────────────────

@app.get("/auth/mono/public-key")
async def mono_public_key(user: dict = Depends(current_user)):
    """Return the Mono public key so the frontend widget can initialise."""
    return {"public_key": MONO_PUBLIC_KEY}


@app.post("/auth/mono/exchange")
async def mono_exchange(body: dict, user: dict = Depends(current_user)):
    """Exchange the code returned by the Mono Connect widget for an account."""
    code = body.get("code")
    if not code:
        raise HTTPException(400, "code required")
    uid = user["email"]

    async with httpx.AsyncClient(timeout=30) as client:
        # Mono v2 uses /accounts/auth for the token exchange
        r = await client.post(
            f"{MONO_API_URL}/accounts/auth",
            headers=_mono_headers(),
            json={"code": code},
        )
    if r.status_code != 200:
        raise HTTPException(502, f"Mono exchange failed: {r.text[:200]}")

    payload = r.json()
    data = payload.get("data", payload)
    account_id = data.get("id") or data.get("account_id") or data.get("accountId")
    if not account_id:
        raise HTTPException(502, "Mono did not return an account id")

    connection_id = f"mono-{account_id}"
    await mono_connections_col.update_one(
        {"_id": connection_id},
        {"$set": {
            "_id":              connection_id,
            "user_id":          uid,
            "mono_account_id":  account_id,
            "provider_type":    "mono",
            "created_at":       datetime.now(),
        }},
        upsert=True,
    )

    asyncio.create_task(_sync_mono_connection(connection_id, uid))
    return {"ok": True, "connection_id": connection_id}


@app.post("/mono/sync")
async def mono_sync_all(user: dict = Depends(current_user)):
    """Manually re-sync all Mono connections for the current user."""
    uid = user["email"]
    conns = await mono_connections_col.find({"user_id": uid}).to_list(None)
    total = 0
    for c in conns:
        ids = await _sync_mono_connection(c["_id"], uid)
        total += len(ids)
    return {"synced": total}


# ── Mono data endpoints ────────────────────────────────────────────────────────

@app.get("/mono/accounts")
async def get_mono_accounts(user: dict = Depends(current_user)):
    uid = user["email"]
    accs = await mono_accounts_col.find({"user_id": uid}).to_list(None)
    return [
        {
            "id":           a["_id"],
            "name":         a.get("name", "Account"),
            "type":         a.get("type", "bank"),
            "balance":      a.get("balance", 0),
            "currency":     a.get("currency", "KES"),
            "provider":     a.get("provider", "Mono"),
            "status":       a.get("status", "connected"),
            "connection_id": a.get("connection_id"),
        }
        for a in accs
    ]


@app.get("/mono/accounts/{account_id}/transactions")
async def get_mono_transactions(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    acc = await mono_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Account not found")
    txns = await mono_transactions_col.find(
        {"account_id": account_id, "user_id": uid}
    ).sort("date", -1).to_list(500)
    return [
        {
            "id":               str(t["_id"]),
            "account_id":       t["account_id"],
            "date":             t["date"].isoformat(),
            "amount":           t["amount"],
            "currency":         t.get("currency", "KES"),
            "description":      t.get("description", ""),
            "merchant_name":    t.get("merchant_name"),
            "category":         t.get("custom_category") or t.get("category"),
            "custom_category":  t.get("custom_category"),
            "transaction_type": t.get("transaction_type", "debit"),
        }
        for t in txns
    ]


@app.delete("/mono/connections/{connection_id}")
async def delete_mono_connection(connection_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    conn = await mono_connections_col.find_one({"_id": connection_id, "user_id": uid})
    if not conn:
        raise HTTPException(404, "Connection not found")
    account_id = conn.get("mono_account_id")
    await mono_connections_col.delete_one({"_id": connection_id})
    if account_id:
        await mono_accounts_col.delete_one({"_id": account_id})
        await mono_transactions_col.delete_many({"account_id": account_id})
    return {"ok": True}


# ── M-Pesa upload ─────────────────────────────────────────────────────────────

async def _extract_pdf_text(content: bytes, password: str = "") -> str:
    """Extract plain text from a PDF using pdftotext (poppler-utils)."""
    import tempfile, subprocess, os
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(content)
        tmp_path = f.name
    try:
        cmd = ["pdftotext", "-layout"]
        if password:
            cmd += ["-upw", password]
        cmd += [tmp_path, "-"]
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        if result.returncode != 0 and password:
            # Try owner password as fallback
            result = subprocess.run(
                ["pdftotext", "-layout", "-opw", password, tmp_path, "-"],
                capture_output=True, timeout=30,
            )
        return result.stdout.decode("utf-8", errors="replace")
    finally:
        os.unlink(tmp_path)


async def _llm_parse_mpesa(text: str) -> list[dict]:
    """Send raw PDF/CSV text to LLM and get back structured M-Pesa transactions."""
    prompt = (
        "You are a financial data extraction assistant. Below is raw text from an M-Pesa "
        "statement (Safaricom Kenya mobile money). Extract ALL transactions and return ONLY "
        "a valid JSON array with no extra text. Each object must have exactly these fields:\n"
        "  receipt: string (transaction ID / receipt number, or generate 'TXN-<index>' if missing)\n"
        "  date: string (ISO 8601, e.g. '2024-03-15T14:30:00')\n"
        "  type: 'credit' or 'debit' (credit = money received, debit = money sent/paid)\n"
        "  amount: number (positive, KES)\n"
        "  description: string (full details/narration)\n"
        "  balance: number or null (running balance after transaction)\n"
        "Ignore header rows, footers, and non-transaction lines.\n\n"
        "STATEMENT TEXT:\n" + text[:12000]  # cap to avoid token limits
    )
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "google/gemini-2.0-flash-001",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                },
            )
        raw = r.json()["choices"][0]["message"]["content"].strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())
    except Exception as e:
        raise HTTPException(422, f"LLM parsing failed: {e}")


@app.post("/mpesa/upload")
async def mpesa_upload(
    file: UploadFile,
    password: str = Form(default=""),
    user: dict = Depends(current_user),
):
    """Parse a Safaricom M-Pesa PDF (or CSV) statement using LLM extraction."""
    uid = user["email"]
    content = await file.read()
    filename = (file.filename or "").lower()

    # Extract text
    if filename.endswith(".pdf") or content[:4] == b"%PDF":
        raw_text = await _extract_pdf_text(content, password=password)
        if not raw_text.strip():
            raise HTTPException(422, "Could not extract text — check the PDF password")
    else:
        # CSV fallback
        try:
            raw_text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raw_text = content.decode("latin-1")

    if not raw_text.strip():
        raise HTTPException(422, "Could not extract text from file")

    # Parse via LLM
    rows = await _llm_parse_mpesa(raw_text)
    if not isinstance(rows, list):
        raise HTTPException(422, "LLM did not return a list of transactions")

    acc_id   = f"mpesa-{uid}"
    conn_id  = f"mpesa-conn-{uid}"
    imported = 0
    latest_balance: float | None = None

    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        receipt = str(row.get("receipt") or f"mpesa-{uid}-{i}")
        raw_date = row.get("date", "")
        try:
            txn_date = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00"))
        except Exception:
            txn_date = datetime.now()

        try:
            amount = float(row.get("amount", 0))
        except (TypeError, ValueError):
            continue
        if amount <= 0:
            continue

        txn_type    = "credit" if str(row.get("type", "debit")).lower() == "credit" else "debit"
        description = str(row.get("description", ""))
        bal         = row.get("balance")
        if bal is not None:
            try:
                latest_balance = float(bal)
            except (TypeError, ValueError):
                pass

        cat = rule_categorise("", description)

        await mpesa_transactions_col.update_one(
            {"_id": receipt},
            {"$set": {
                "account_id":       acc_id,
                "user_id":          uid,
                "date":             txn_date,
                "amount":           amount,
                "currency":         "KES",
                "description":      description,
                "merchant_name":    None,
                "category":         cat,
                "transaction_type": txn_type,
            },
            "$setOnInsert": {"custom_category": None}},
            upsert=True,
        )
        imported += 1

    # Upsert synthetic account
    await mpesa_accounts_col.update_one(
        {"_id": acc_id},
        {"$set": {
            "_id":        acc_id,
            "user_id":    uid,
            "name":       "M-Pesa",
            "type":       "mobile_money",
            "balance":    latest_balance or 0,
            "currency":   "KES",
            "provider":   "MPESA",
            "status":     "connected",
            "updated_at": datetime.now(),
        }},
        upsert=True,
    )
    await mpesa_accounts_col.update_one(
        {"_id": conn_id},
        {"$set": {"_id": conn_id, "user_id": uid, "provider_type": "mpesa"}},
        upsert=True,
    )

    return {"inserted": imported, "account_id": acc_id, "balance": latest_balance}


# ── Generic Kenyan bank statement upload ──────────────────────────────────────

async def _llm_parse_statement(text: str) -> dict:
    """Parse any Kenyan bank statement (M-Pesa, Equity, KCB, NCBA, Stanbic, Absa, Co-op…).
    Returns: {bank_name, account_number, currency, transactions: [{ref, date, type, amount, description, balance}]}
    """
    prompt = (
        "You are a financial data extraction assistant for bank statements.\n"
        "Analyze this bank statement text and return ONLY a single valid JSON object — "
        "no markdown fences, no explanation.\n\n"
        "The object must use this exact schema:\n"
        "{\n"
        '  "bank_name": "<bank name as printed, e.g. Barclays, HSBC, Monzo, Lloyds, NatWest, Revolut, M-Pesa, Equity Bank, KCB>",\n'
        '  "account_number": "<the primary account number, IBAN, or phone number — digits and hyphens only, no spaces>",\n'
        '  "currency": "<ISO code, e.g. GBP, USD, KES>",\n'
        '  "transactions": [\n'
        "    {\n"
        '      "ref": "<receipt / reference / cheque number, or null if absent>",\n'
        '      "date": "<ISO 8601 datetime, e.g. 2024-03-15T14:30:00>",\n'
        '      "type": "<credit or debit>",\n'
        '      "amount": <positive number>,\n'
        '      "description": "<full narration>",\n'
        '      "balance": <running balance after transaction, or null>\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- credit = money received / deposited into the account\n"
        "- debit = money sent / withdrawn / paid out\n"
        "- If ref is absent or unclear, set it to null (NOT a generated string)\n"
        "- Ignore header rows, footers, totals, and non-transaction lines\n"
        "- Extract ALL transactions in the statement\n\n"
        "STATEMENT TEXT:\n" + text[:14000]
    )
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
                json={"model": "google/gemini-2.0-flash-001", "messages": [{"role": "user", "content": prompt}], "temperature": 0},
            )
        raw = r.json()["choices"][0]["message"]["content"].strip()
        # Strip markdown fences if LLM wraps anyway
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw.strip())
        if not isinstance(parsed, dict) or "transactions" not in parsed:
            raise ValueError("LLM response missing required keys")
        return parsed
    except Exception as e:
        raise HTTPException(422, f"LLM parsing failed: {e}")


@app.post("/statement/upload")
async def statement_upload(
    file: UploadFile,
    password: str = Form(default=""),
    region: str = Form(default="Kenya"),
    user: dict = Depends(current_user),
):
    """Parse any Kenyan bank statement PDF or CSV using LLM. Fully idempotent — re-uploading the same
    statement produces no duplicates. Account ID is stable per (user, bank, account number)."""
    uid = user["email"]
    content = await file.read()
    filename = (file.filename or "").lower()

    # Extract text
    if filename.endswith(".pdf") or content[:4] == b"%PDF":
        raw_text = await _extract_pdf_text(content, password=password)
        if not raw_text.strip():
            raise HTTPException(422, "Could not extract text — wrong PDF password or unsupported format")
    else:
        try:
            raw_text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raw_text = content.decode("latin-1")

    if not raw_text.strip():
        raise HTTPException(422, "Could not extract text from file")

    parsed         = await _llm_parse_statement(raw_text)
    bank_name      = str(parsed.get("bank_name") or "Unknown Bank")
    account_number = str(parsed.get("account_number") or "")
    currency       = str(parsed.get("currency") or "KES")
    rows           = parsed.get("transactions", [])

    if not isinstance(rows, list):
        raise HTTPException(422, "LLM did not return a transactions list")

    slug        = _bank_slug(bank_name)
    acct_digits = re.sub(r"\D", "", account_number)
    acct_suffix = acct_digits[-8:] if len(acct_digits) >= 4 else hashlib.sha256(f"{uid}|{slug}".encode()).hexdigest()[:8]
    acc_id      = f"statement-{uid}-{slug}-{acct_suffix}"
    acc_name    = f"{bank_name} ••{acct_suffix[-4:]}"

    imported = 0
    skipped  = 0
    latest_balance: float | None = None

    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            amount = float(row.get("amount", 0))
        except (TypeError, ValueError):
            continue
        if amount <= 0:
            skipped += 1
            continue

        raw_date = str(row.get("date", ""))
        try:
            txn_date = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
        except Exception:
            txn_date = datetime.now()

        txn_type    = "credit" if str(row.get("type", "debit")).lower() == "credit" else "debit"
        description = str(row.get("description") or "")
        ref         = row.get("ref")  # None when absent
        bal         = row.get("balance")

        if bal is not None:
            try:
                latest_balance = float(bal)
            except (TypeError, ValueError):
                pass

        txn_id = _statement_dedup_key(acc_id, ref, raw_date, txn_type, description)
        cat    = rule_categorise("", description)

        await statement_transactions_col.update_one(
            {"_id": txn_id},
            {"$set": {
                "account_id":       acc_id,
                "user_id":          uid,
                "date":             txn_date,
                "amount":           amount,
                "currency":         currency,
                "description":      description,
                "merchant_name":    None,
                "category":         cat,
                "transaction_type": txn_type,
            },
            "$setOnInsert": {"custom_category": None}},
            upsert=True,
        )
        imported += 1

    # Upsert stable account record
    await statement_accounts_col.update_one(
        {"_id": acc_id},
        {"$set": {
            "_id":            acc_id,
            "user_id":        uid,
            "name":           acc_name,
            "type":           "bank",
            "balance":        latest_balance or 0,
            "currency":       currency,
            "provider":       slug.upper(),
            "account_number": account_number,
            "region":         region,
            "status":         "connected",
            "updated_at":     datetime.now(),
        }},
        upsert=True,
    )

    return {
        "inserted":       imported,
        "skipped":        skipped,
        "account_id":     acc_id,
        "bank_name":      bank_name,
        "account_number": account_number,
        "balance":        latest_balance,
    }


@app.get("/mpesa/accounts")
async def get_mpesa_accounts(user: dict = Depends(current_user)):
    uid = user["email"]
    accs = await mpesa_accounts_col.find({"user_id": uid, "type": "mobile_money"}).to_list(None)
    return [
        {
            "id":       a["_id"],
            "name":     a.get("name", "M-Pesa"),
            "type":     a.get("type", "mobile_money"),
            "balance":  a.get("balance", 0),
            "currency": a.get("currency", "KES"),
            "provider": a.get("provider", "MPESA"),
            "status":   a.get("status", "connected"),
        }
        for a in accs
    ]


@app.get("/mpesa/accounts/{account_id}/transactions")
async def get_mpesa_transactions(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    acc = await mpesa_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "M-Pesa account not found")
    txns = await mpesa_transactions_col.find(
        {"account_id": account_id, "user_id": uid}
    ).sort("date", -1).to_list(500)
    return [
        {
            "id":               t["_id"],
            "account_id":       t["account_id"],
            "date":             t["date"].isoformat(),
            "amount":           t["amount"],
            "currency":         "KES",
            "description":      t.get("description", ""),
            "merchant_name":    t.get("merchant_name"),
            "category":         t.get("custom_category") or t.get("category"),
            "custom_category":  t.get("custom_category"),
            "transaction_type": t.get("transaction_type", "debit"),
        }
        for t in txns
    ]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
