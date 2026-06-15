"""
AI Wealth API - FastAPI backend with MongoDB storage.
Each bank connection gets its own connection_id so multiple banks coexist.
"""

from fastapi import FastAPI, HTTPException, Request, Depends, UploadFile, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta, date as _date
import calendar as _calendar
import httpx
import os
import re
import json
import secrets
import urllib.parse
import asyncio
import uuid as uuid_lib
import hashlib
import base64
import logging
from pathlib import Path
from dotenv import load_dotenv
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature
from motor.motor_asyncio import AsyncIOMotorClient
from pywebpush import webpush, WebPushException
from py_vapid import Vapid
from cryptography.hazmat.primitives.serialization import (
    Encoding, PublicFormat, PrivateFormat, NoEncryption,
)

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
user_rules_col       = db["user_rules"]
budgets_col          = db["budgets"]
challenges_col       = db["challenges"]
mono_connections_col = db["mono_connections"]   # isolated — drop to revert
mono_accounts_col    = db["mono_accounts"]
mono_transactions_col = db["mono_transactions"]
account_rates_col       = db["account_rates"]         # APR per credit card account
push_subscriptions_col  = db["push_subscriptions"]    # Web Push subscriptions per user

# ── TrueLayer config ──────────────────────────────────────────────────────────
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
TAVILY_API_KEY     = os.getenv("TAVILY_API_KEY", "")

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

# ── VAPID / Web Push ──────────────────────────────────────────────────────────
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", f"mailto:admin@wealthdashboard.app")
_vapid_key_file = Path(__file__).parent / ".vapid_private_key"

if _vapid_pk_env := os.getenv("VAPID_PRIVATE_KEY"):
    _vapid_pem = _vapid_pk_env.replace("\\n", "\n").encode()
elif _vapid_key_file.exists():
    _vapid_pem = _vapid_key_file.read_bytes()
else:
    _v = Vapid()
    _v.generate_keys()
    _vapid_pem = _v.private_key.private_bytes(Encoding.PEM, PrivateFormat.TraditionalOpenSSL, NoEncryption())
    _vapid_key_file.write_bytes(_vapid_pem)

_vapid = Vapid.from_pem(_vapid_pem)
VAPID_PRIVATE_KEY_PEM: str = _vapid_pem.decode()
VAPID_PUBLIC_KEY_B64: str = (
    __import__("base64").urlsafe_b64encode(
        _vapid.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    ).rstrip(b"=").decode()
)

# ── Mono (Kenya) ──────────────────────────────────────────────────────────────
MONO_SECRET_KEY = os.getenv("MONO_SECRET_KEY", "")
MONO_PUBLIC_KEY  = os.getenv("MONO_PUBLIC_KEY", "")
MONO_API_URL     = "https://api.withmono.com/v2"

# ── Yapily ────────────────────────────────────────────────────────────────────
YAPILY_APP_UUID = os.getenv("YAPILY_APP_UUID", "")
YAPILY_SECRET   = os.getenv("YAPILY_SECRET", "")
YAPILY_BASE_URL = os.getenv("YAPILY_BASE_URL", "https://api.yapily.com")

# ── Models ────────────────────────────────────────────────────────────────────
class Account(BaseModel):
    id: str
    name: str
    type: str
    balance: float
    currency: str = "GBP"
    provider: str
    provider_id: Optional[str] = None
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
    planned: Optional[bool] = None

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
            await connections_col.update_one({"_id": connection_id}, {"$unset": {"needs_reauth": ""}})
            await save_connection(connection_id, r.json())
            return r.json()["access_token"]
    # Refresh failed — mark connection so the UI can prompt re-auth
    await connections_col.update_one({"_id": connection_id}, {"$set": {"needs_reauth": True}})
    return None

# ── Sync helpers ──────────────────────────────────────────────────────────────

async def send_push_to_user(user_id: str, title: str, body: str, url: str = "/") -> None:
    """Send a Web Push notification to every subscription registered by user_id."""
    subs = await push_subscriptions_col.find({"user_id": user_id}).to_list(None)
    if not subs:
        return
    expired = []
    for sub in subs:
        try:
            await asyncio.to_thread(
                webpush,
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["keys"]["p256dh"], "auth": sub["keys"]["auth"]},
                },
                data=json.dumps({"title": title, "body": body, "url": url}),
                vapid_private_key=_vapid,
                vapid_claims={"sub": VAPID_SUBJECT},
                ttl=3600,
            )
        except WebPushException as e:
            if e.response is not None and e.response.status_code in (404, 410):
                expired.append(sub["_id"])
            else:
                logging.warning("WebPushException for %s: %s", user_id, e)
        except Exception as e:
            logging.warning("Push send error for %s: %s", user_id, e)
    if expired:
        await push_subscriptions_col.delete_many({"_id": {"$in": expired}})


async def _notify_new_transactions(user_id: str, new_txns: list) -> None:
    """Build a human-readable push notification from a batch of new transactions."""
    if not new_txns:
        return
    sym = "KES " if (new_txns[0].get("currency") == "KES") else "£"
    if len(new_txns) == 1:
        t = new_txns[0]
        name = (t.get("merchant_name") or t.get("description", "Transaction"))[:30]
        title = "New transaction"
        body  = f"{name} — {sym}{t['amount']:,.2f}"
    else:
        title = f"{len(new_txns)} new transactions"
        parts = [(t.get("merchant_name") or t.get("description", ""))[:20] for t in new_txns[:2]]
        body  = " · ".join(p for p in parts if p)
        if len(new_txns) > 2:
            body += f" +{len(new_txns) - 2} more"
    await send_push_to_user(user_id, title, body)


async def _upsert_transactions(txns: list, account_id: str, user_id: str, is_card: bool = False) -> list:
    """Upsert a batch of TrueLayer transaction results — never overwrite custom_category.
    Applies merchant rules immediately so raw TrueLayer categories are never stored as-is.
    Returns a list of dicts for transactions that were genuinely new (not already stored).

    Sign convention differs between TrueLayer APIs:
      Bank accounts: positive = credit (income in), negative = debit (spending out)
      Cards:         positive = debit (purchase/charge), negative = credit (payment/refund)
    """
    new_txns = []
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
        result = await transactions_col.update_one(
            {"_id": txn["transaction_id"]},
            {"$set": tdoc, "$setOnInsert": {"_id": txn["transaction_id"], "custom_category": None}},
            upsert=True,
        )
        if result.upserted_id is not None:
            new_txns.append({
                "description":   description,
                "merchant_name": merchant or None,
                "amount":        abs(txn["amount"]),
                "currency":      txn["currency"],
            })
    return new_txns


async def sync_connection(connection_id: str, user_id: Optional[str] = None, from_date: Optional[str] = None):
    """Fetch accounts + cards + transactions for one connection; upsert into MongoDB."""
    token = await get_valid_token(connection_id)
    if not token:
        return []

    # Resolve user_id and last_synced from the connection doc if not passed directly
    conn_doc = await connections_col.find_one({"_id": connection_id}, {"user_id": 1, "last_synced": 1})
    if not user_id:
        user_id = (conn_doc or {}).get("user_id", "unknown")
    # Don't notify on first-ever sync (would flood with historical transactions)
    is_initial_sync = not (conn_doc or {}).get("last_synced")
    all_new_txns: list = []

    if from_date is None:
        last_synced = (conn_doc or {}).get("last_synced")
        if last_synced and isinstance(last_synced, datetime):
            # Go back 1 extra day to catch any late-posting transactions
            from_date = (last_synced - timedelta(days=1)).strftime("%Y-%m-%d")
        else:
            from_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    to_date   = datetime.now().strftime("%Y-%m-%d")
    headers   = {"Authorization": f"Bearer {token}"}
    fetched   = []

    async with httpx.AsyncClient(timeout=30) as client:

        # Fetch account list and card list in parallel
        accs_r, cards_r = await asyncio.gather(
            client.get(f"{TRUELAYER_API_URL}/data/v1/accounts", headers=headers),
            client.get(f"{TRUELAYER_API_URL}/data/v1/cards", headers=headers),
        )

        async def _latest_txn_date(account_id: str) -> str:
            """Return the date of the most recent stored transaction, or from_date if none."""
            latest = await transactions_col.find_one(
                {"account_id": account_id}, sort=[("date", -1)], projection={"date": 1}
            )
            if latest and latest.get("date"):
                return latest["date"].strftime("%Y-%m-%d")
            return from_date

        async def _sync_bank_account(acc: dict):
            account_id = acc["account_id"]
            sync_from = await _latest_txn_date(account_id)
            balance = 0.0
            try:
                br, tr = await asyncio.gather(
                    client.get(f"{TRUELAYER_API_URL}/data/v1/accounts/{account_id}/balance", headers=headers),
                    client.get(f"{TRUELAYER_API_URL}/data/v1/accounts/{account_id}/transactions",
                               headers=headers, params={"from": sync_from, "to": to_date}),
                )
                if br.status_code == 200:
                    res = br.json().get("results", [])
                    if res:
                        balance = res[0].get("current", 0.0)
                if tr.status_code == 200:
                    new = await _upsert_transactions(tr.json().get("results", []), account_id, user_id)
                    all_new_txns.extend(new)
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
                "provider_id":    acc.get("provider", {}).get("provider_id"),
                "status":         "connected",
                "account_number": (acc.get("account_number") or {}).get("number"),
                "sort_code":      (acc.get("account_number") or {}).get("sort_code"),
                "updated_at":     datetime.now(),
            }}, upsert=True)
            return account_id

        async def _sync_card(card: dict):
            card_id = card["account_id"]
            sync_from = await _latest_txn_date(card_id)
            balance = 0.0
            try:
                cbr, ctr = await asyncio.gather(
                    client.get(f"{TRUELAYER_API_URL}/data/v1/cards/{card_id}/balance", headers=headers),
                    client.get(f"{TRUELAYER_API_URL}/data/v1/cards/{card_id}/transactions",
                               headers=headers, params={"from": sync_from, "to": to_date}),
                )
                if cbr.status_code == 200:
                    res = cbr.json().get("results", [])
                    if res:
                        balance = -abs(res[0].get("current", 0.0))
                if ctr.status_code == 200:
                    new = await _upsert_transactions(ctr.json().get("results", []), card_id, user_id, is_card=True)
                    all_new_txns.extend(new)
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
                "provider_id":    card.get("provider", {}).get("provider_id"),
                "status":         "connected",
                "account_number": card.get("partial_card_number"),
                "sort_code":      None,
                "updated_at":     datetime.now(),
            }}, upsert=True)
            return card_id

        # ── Bank accounts + credit cards all in parallel ───────────────────
        bank_accs  = accs_r.json().get("results", [])  if accs_r.status_code  == 200 else []
        card_accs  = cards_r.json().get("results", []) if cards_r.status_code == 200 else []

        results = await asyncio.gather(
            *[_sync_bank_account(a) for a in bank_accs],
            *[_sync_card(c) for c in card_accs],
            return_exceptions=True,
        )
        fetched = [r for r in results if isinstance(r, str)]

        await connections_col.update_one(
            {"_id": connection_id}, {"$set": {"last_synced": datetime.now()}}, upsert=True
        )

        # Mark any DB accounts for this connection that TrueLayer no longer returns as expired
        if fetched:
            await accounts_col.update_many(
                {"connection_id": connection_id, "_id": {"$nin": fetched}},
                {"$set": {"status": "expired"}},
            )
            # Clear expired flag on accounts that are still live
            await accounts_col.update_many(
                {"connection_id": connection_id, "_id": {"$in": fetched}},
                {"$set": {"status": "connected"}},
            )

    if all_new_txns and not is_initial_sync and user_id and user_id != "unknown":
        asyncio.create_task(_notify_new_transactions(user_id, all_new_txns))

    return fetched


# ── TrueLayer auth ────────────────────────────────────────────────────────────

@app.get("/auth/truelayer/providers")
async def truelayer_providers(user: dict = Depends(current_user)):
    """Return TrueLayer's supported UK provider list for the custom bank picker."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get("https://auth.truelayer.com/api/providers?country=uk")
    if r.status_code != 200:
        return []
    providers = r.json()
    # Filter out mock/test providers and normalise shape
    return [
        {"id": p["provider_id"], "name": p["display_name"], "logo": p.get("logo_url", "")}
        for p in providers
        if p["provider_id"] != "mock"
    ]

@app.get("/auth/truelayer/link")
async def truelayer_link(provider: str = "", user: dict = Depends(current_user)):
    if not TRUELAYER_CLIENT_ID:
        raise HTTPException(500, "TrueLayer not configured")
    connection_id = secrets.token_hex(8)
    await connections_col.update_one(
        {"_id": connection_id},
        {"$set": {"user_id": user["email"], "pending": True, "created_at": datetime.now()}},
        upsert=True,
    )
    # If a specific provider is requested, skip TrueLayer's own picker
    providers_param = f"uk-ob-all%20uk-cs-mock" if not provider else provider
    auth_url = (
        f"{TRUELAYER_AUTH_URL}/?"
        f"response_type=code&"
        f"client_id={TRUELAYER_CLIENT_ID}&"
        f"scope=accounts%20transactions%20balance%20cards%20offline_access&"
        f"redirect_uri={TRUELAYER_REDIRECT_URI}&"
        f"state={connection_id}&"
        f"providers={providers_param}"
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
    # Savings insights: sparse TTL so pinned docs (expires_at=null) are never deleted
    await savings_insights_col.create_index("expires_at", expireAfterSeconds=0, sparse=True)
    await savings_insights_col.create_index([("user_id", 1), ("category", 1)])
    await savings_labels_col.create_index([("user_id", 1), ("merchant_key", 1)], unique=True)


@app.get("/health")
async def health():
    return {"status": "ok", "truelayer_configured": bool(TRUELAYER_CLIENT_ID)}


# ── Push Notification endpoints ───────────────────────────────────────────────

@app.get("/push/vapid-public-key")
async def get_vapid_public_key():
    """Return the VAPID public key so the browser can create a push subscription."""
    return {"public_key": VAPID_PUBLIC_KEY_B64}


@app.post("/push/subscribe")
async def push_subscribe(request: Request, user: dict = Depends(current_user)):
    """Store a push subscription for the authenticated user (keyed by endpoint URL)."""
    data = await request.json()
    endpoint = data.get("endpoint")
    if not endpoint:
        raise HTTPException(status_code=400, detail="Missing endpoint")
    await push_subscriptions_col.update_one(
        {"_id": endpoint},
        {"$set": {
            "_id":        endpoint,
            "user_id":    user["email"],
            "endpoint":   endpoint,
            "keys":       data.get("keys", {}),
            "updated_at": datetime.now(),
        }},
        upsert=True,
    )
    return {"ok": True}


@app.delete("/push/subscribe")
async def push_unsubscribe(request: Request, user: dict = Depends(current_user)):
    """Remove a push subscription for the authenticated user."""
    data = await request.json()
    endpoint = data.get("endpoint")
    if endpoint:
        # user_id check ensures users can only remove their own subscriptions
        await push_subscriptions_col.delete_one({"_id": endpoint, "user_id": user["email"]})
    return {"ok": True}


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
    # Include Yapily accounts
    yapily_accs = await yapily_accounts_col.find({"user_id": uid}).to_list(None)
    for a in yapily_accs:
        result.append(Account(
            id=a["_id"], name=a.get("name", "Account"), type=a.get("type", "bank"),
            balance=a.get("balance", 0), currency=a.get("currency", "GBP"),
            provider=a.get("institution_id", "YAPILY"), status=a.get("status", "connected"),
            user_id=uid, connection_id=a.get("consent", ""),
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
    # Also sync Yapily connections
    yapily_conns = await yapily_consents_col.find({"user_id": uid, "status": "AUTHORIZED"}).to_list(None)
    for yc in yapily_conns:
        asyncio.create_task(_sync_yapily_consent(yc["_id"], uid))
    async def _post_sync(u):
        await _apply_rules_bulk(u, structural=True)
        await _categorise_others_bg(u)
    asyncio.create_task(_post_sync(uid))
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
    # Also sync Yapily connections
    yapily_conns = await yapily_consents_col.find({"user_id": uid, "status": "AUTHORIZED"}).to_list(None)
    for yc in yapily_conns:
        asyncio.create_task(_sync_yapily_consent(yc["_id"], uid))
    async def _post_sync(u):
        await _apply_rules_bulk(u, structural=True)
        await _categorise_others_bg(u)
    asyncio.create_task(_post_sync(uid))
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
    async def _post_sync(u):
        await _apply_rules_bulk(u, structural=True)
        await _categorise_others_bg(u)
    for uid in user_ids:
        asyncio.create_task(_post_sync(uid))
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

    # --- Yapily account ---
    yapily_acc = await yapily_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if yapily_acc:
        await yapily_transactions_col.delete_many({"account_id": account_id})
        await yapily_accounts_col.delete_one({"_id": account_id})
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


@app.get("/accounts/{account_id}/rate")
async def get_account_rate(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    rec = await account_rates_col.find_one({"user_id": uid, "account_id": account_id})
    return {"apr": rec["apr"] if rec else None}


@app.put("/accounts/{account_id}/rate")
async def set_account_rate(account_id: str, body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    apr_val = body.get("apr")
    if apr_val is None:
        await account_rates_col.delete_one({"user_id": uid, "account_id": account_id})
        return {"apr": None}
    apr = float(apr_val)
    await account_rates_col.update_one(
        {"user_id": uid, "account_id": account_id},
        {"$set": {"apr": apr, "user_id": uid, "account_id": account_id}},
        upsert=True,
    )
    return {"apr": apr}


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

    # Yapily account
    yapily_acc = await yapily_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if yapily_acc:
        docs = await yapily_transactions_col.find(
            {"account_id": account_id, "user_id": uid, "date": {"$gte": cutoff}}
        ).sort("date", -1).to_list(None)
        return [_doc_to_tx(d) for d in docs]

    docs = await transactions_col.find(
        {"account_id": account_id, "user_id": uid, "date": {"$gte": cutoff}}
    ).sort("date", -1).to_list(None)
    return [_doc_to_tx(d) for d in docs]


def _description_stem(desc: str) -> str:
    """Strip bank-appended date/reference suffixes to get the matchable core.

    Examples:
      'RENEWAL ON 26 APR BCC'      → 'RENEWAL'
      'LYCAMOBILE ON 09 MAY BCC'   → 'LYCAMOBILE'
      'SQSP* WEBSIT#23231 ON 28 APR' → 'SQSP* WEBSIT#23231'
      'Nintendo CD1591416166'       → 'Nintendo'
    """
    s = desc.strip()
    # Remove trailing bank-reference codes (2-4 uppercase letters at the very end)
    s = re.sub(r'\s+[A-Z]{2,4}\s*$', '', s).strip()
    # Remove trailing " ON DD MMM" or " DD MMM" date patterns and everything after
    s = re.sub(r'\s+(?:ON\s+)?\d{1,2}\s+[A-Z]{3}\b.*$', '', s, flags=re.I).strip()
    # Remove trailing " DDMMM" compact date (e.g. "22MAY")
    s = re.sub(r'\s+\d{2}[A-Z]{3}\b.*$', '', s, flags=re.I).strip()
    # Remove trailing long numeric reference IDs (6+ digits)
    s = re.sub(r'\s+\d{6,}\s*$', '', s).strip()
    return s or desc


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
        stem = _description_stem(description)
        # Prefix regex so "RENEWAL" matches "RENEWAL ON 26 APR BCC", "RENEWAL ON 09 MAY BCC" etc.
        match["description"] = re.compile(r'^\s*' + re.escape(stem), re.IGNORECASE)

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


@app.patch("/transactions/{transaction_id}/planned")
async def set_transaction_planned(transaction_id: str, body: dict, user: dict = Depends(current_user)):
    planned = bool(body.get("planned", True))
    result = await transactions_col.update_one(
        {"_id": transaction_id, "user_id": user["email"]},
        {"$set": {"planned": planned}},
    )
    if result.matched_count == 0:
        await yapily_transactions_col.update_one(
            {"_id": transaction_id, "user_id": user["email"]},
            {"$set": {"planned": planned}},
        )
    return {"updated": transaction_id, "planned": planned}


RAW_TRUELAYER_CATEGORIES = {"BILL_PAYMENT", "DEBIT", "DIRECT_DEBIT", "PURCHASE", "STANDING_ORDER",
                             "CREDIT", "TRANSFER"}

VALID_CATEGORIES = [
    "Groceries", "Eating Out", "Transport", "Entertainment",
    "Shopping", "Bills", "Subscriptions", "Health", "Travel",
    "Software", "Savings", "Debt", "Transfer", "Income",
    "Cash", "Charity", "Other",
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
    (re.compile(r"mcdonald'?s?|kfc\b|starbucks|costa coffee|pret\b|nando'?s?|pizza\b|burger king|subway\b|deliveroo|just.?eat|uber.{0,5}eat|ubereats|greggs|domino'?s?|papa.?john|wagamama|itsu\b|leon\b|five.?guys|wetherspoon|yo.?sushi|wasabi|eat\b|caffe nero|cafe\b|restaurant|bistro|brasserie|food.?delivery|hungry.?house|cabana\b|dishoom|hawksmoor|bills restaurant|turtle bay|wahaca|zizzi\b|bella italia|frankie|benny|carluccio|harvester\b|toby carvery|ember inns|mitchells.?butlers|stonehouse\b|vintage inns", re.I), 'Eating Out'),
    # Transport — public / ride-share / train booking
    (re.compile(r'tfl\b|transport for london|oyster|uber\b|bolt\b|trainline|national rail|avanti|lner\b|cross.?country|great western|south western|south.?eastern|northern rail|arriva|stagecoach|first.?bus|megabus|national express|eurostar|heathrow express|gatwick express|stansted express|go.?ahead|chiltern rail|trainpal|train pal|railcard|splittickets|railsmartr|seatfrog', re.I), 'Transport'),
    # Transport — fuel / parking / car parks
    (re.compile(r'\bbp\b|shell\b|esso\b|total energies|texaco|gulf\b|moto\b|roadchef|welcome break|petrol|fuel\b|\bparking\b|ncp\b|q-park|ringgo|paybyphone|car.?par\b|car.?park|airparks|purple.?parking|jfk.?park|airport.?park|birmingham.?int.*car|int.*car.*par', re.I), 'Transport'),
    # Subscriptions (streaming / software / recurring)
    (re.compile(r'netflix|spotify|disney\+?|amazon prime|apple music|youtube.?premium|google\*youtube|now tv|now\.tv|apple.?one|apple\.?com/bill|apple tv\+?|hulu|paramount\+?|bbc sounds|audible|kindle unlimited|duolingo|headspace|calm\b|grammarly|canva\b|adobe\b|microsoft 365|office 365|dropbox|icloud|google one|playstation|psn\b|ps\+|xbox.?game.?pass|nintendo online|nintendo switch online|twitch|squarespace|\bsqsp\b|claude\.ai|anthropic\b', re.I), 'Subscriptions'),
    # Entertainment
    (re.compile(r'odeon|vue cinema|cineworld|curzon|everyman cinema|ticketmaster|see.?tickets|eventbrite|sky sports|bt sport|dazn\b|steam\b|epic games|xbox store|nintendo eshop|nintendo\b|google play|app store|museum|theatre|gallery|gig\b|concert', re.I), 'Entertainment'),
    # Shopping — online & retail
    (re.compile(r'\bamazon\b(?!.*prime)|\bamzn\b|amazon marketplace|amznmkt|asos\b|zara\b|h&m\b|h and m|next\b|john lewis|argos\b|currys\b|pc world|ebay\b|very\b|boohoo|river island|topshop|primark|tkmaxx|tk maxx|matalan|new look|sports direct|jd sports|foot locker|footlocker|nike\b|adidas\b|vinted\b|etsy\b|zalando|prettylittlething|shein\b|uniqlo|gap\b|lush\b|holland.?barrett|the body shop|boots(?! pharmacy)|dunelm\b|habitat\b|b&q\b|homebase\b|wickes\b|screwfix|toolstation|ikea\b|wayfair|made\.com|next\.co|very\.co|littlewoods|kaleidoscope|qvc\b|ao\.com|\bao\b appliances|smyths|toy.?r.?us|the range\b|homebargains|home bargains|pound.?land|poundworld|savers\b', re.I), 'Shopping'),
    # Bills — utilities & telecoms
    (re.compile(r'british gas|octopus energy|edf energy|e\.?on\b|scottish power|npower|bulb\b|ovo energy|shell energy|thames water|severn trent|yorkshire water|united utilities|south west water|bt group\b|bt broadband|virgin media|sky\b|vodafone|ee\b|o2\b|three\b|giffgaff|lycamobile|lyca mobile|lebara|voxi\b|smarty\b|talktalk|plusnet|now broadband|council tax|tv licence|water bill|electricity bill|gas bill|broadband|metropoli.*council|borough council|city council|district council|county council|local authority', re.I), 'Bills'),
    # Health & fitness
    (re.compile(r'boots pharmacy|lloyds pharmacy|superdrug|pharmacy|chemist|puregym|the gym\b|gym ltd|gym group|anytime fitness|jd gyms|david lloyd|virgin active|planet fitness|nuffield health|bannatyne|snap fitness|dentist|dental|doctor\b|gp\b|nhs\b|hospital|optician|specsavers|vision express|holland.?barrett|vitabiotics|protein|\bspire\s+\w+|bupa\b|axa health|vitality health|aviva health|private.?health|medical.?centre|walk.?in.?centre|urgent.?care|physiotherapy|physio\b|osteopath|chiropractor|acupuncture|counselling|therapy\b|mental health', re.I), 'Health'),
    # Travel
    (re.compile(r'airbnb|booking\.com|hotels\.com|expedia|trivago|ryanair|easyjet|british airways|jet2|tui\b|virgin atlantic|wizz air|blue air|hilton|marriott|premier inn|travelodge|holiday inn|ibis\b|accor|airfare|holiday|travel insurance', re.I), 'Travel'),
    # Software & dev tools
    (re.compile(r'github\b|digitalocean|aws\b|amazon web services|google cloud|azure\b|heroku|netlify|vercel|cloudflare|linode|hetzner|namecheap|godaddy|1password|lastpass|dashlane|bitwarden|notion\b|figma\b|slack\b|zoom\b|webflow|railway\b|supabase|mongodb atlas|datadog|sentry\b|linear\b', re.I), 'Software'),
    # Savings & investments
    (re.compile(r'moneybox|plum\b|chip\b|nutmeg|wealthify|wealthsimple|vanguard|hargreaves lansdown|fidelity|trading 212|freetrade|ii\b|interactive investor|isa\b|pension|\bsavings?\b', re.I), 'Savings'),
    # Interest charges & fees → Bills
    (re.compile(r'interest on your|interest charge|late fee|overdraft fee|annual fee|card fee|bank charge', re.I), 'Bills'),
    # Balance transfers & pot withdrawals (Monzo/Starling) → Transfer
    (re.compile(r'balance transfer|internal transfer|faster payment|bacs payment|chaps payment|from .* pot\b', re.I), 'Transfer'),
    # Goldman Sachs payment from a bank account (Apple Card / Marcus repayments) → Transfer
    # Matches "Goldman Sachs" only when description also contains payment-like words
    (re.compile(r'goldman sachs.{0,30}(purchase|payment|ddr|direct debit|repay)', re.I), 'Transfer'),
    # Personal Faster Payments from an individual (e.g. "From John Smith Payment") → Transfer
    (re.compile(r'\bfrom\s+\w+\s+\w+(\s+\w+)?\s+(payment|transfer|paid)\b|fps credit\b|faster payment credit|\bpayment from\b', re.I), 'Transfer'),
    # Valeting / car cleaning → Transport
    (re.compile(r'valeting|car.?valet|car.?clean|car.?wash\b', re.I), 'Transport'),
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
    (re.compile(r'dining|diner\b|grill\b|kitchen\b|eatery|takeaway|take.?away|porters.?lodge|lodge.?cafe|kebab|shawarma|german.?diner|currywurst|schnitzel|bratwurst|falafel|gyros?\b', re.I), 'Eating Out'),
    # PayPal payments → Shopping (generic online purchase)
    (re.compile(r'\bpaypal\b', re.I), 'Shopping'),
    # ATM / cash withdrawals → Other
    (re.compile(r'\batm\b|cash.?machine|cash.?withdrawal|cashpoint|notemachine|note.?machine', re.I), 'Other'),
    # Currency / crypto exchange → Transfer
    (re.compile(r'exchanged? to\b|fx\b|foreign.?exchange|currency.?exchange|transnational', re.I), 'Transfer'),
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


async def tavily_lookup_merchants(merchants: list[str]) -> dict[str, str]:
    """Search Tavily for unknown merchant names to help categorisation.
    Capped at 20 lookups per call to preserve quota.
    Returns a map of merchant → short description snippet."""
    if not TAVILY_API_KEY or not merchants:
        return {}
    results: dict[str, str] = {}
    async with httpx.AsyncClient(timeout=15) as client:
        for merchant in merchants[:20]:
            try:
                r = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": TAVILY_API_KEY,
                        "query": f"What is \"{merchant}\"? What type of business or service is it?",
                        "search_depth": "basic",
                        "max_results": 1,
                        "include_answer": True,
                    },
                )
                if r.status_code == 200:
                    data = r.json()
                    answer = data.get("answer") or ""
                    if not answer and data.get("results"):
                        answer = data["results"][0].get("content", "")[:200]
                    if answer:
                        results[merchant] = answer[:200]
            except Exception:
                pass
    return results


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
        from collections import defaultdict, Counter
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

        # ── Pass 2.5: Propagate manual overrides ──────────────────────────────
        # If the user has manually categorised transactions with a given description
        # + direction, apply the same category to new transactions with custom_category=None.
        # This means "I changed this Saving Challenge debit to Savings" automatically
        # applies to every future Saving Challenge debit.
        custom_txns = await transactions_col.find(
            {"user_id": user_id, "custom_category": {"$ne": None}},
            {"description": 1, "transaction_type": 1, "custom_category": 1},
        ).to_list(None)

        override_map: dict = defaultdict(Counter)
        for t in custom_txns:
            desc_key = re.sub(r'\s+', ' ', (t.get("description") or "").strip().lower())
            if desc_key:
                override_map[(desc_key, t.get("transaction_type", "debit"))][t["custom_category"]] += 1

        if override_map:
            no_custom = await transactions_col.find(
                {"user_id": user_id, "custom_category": None},
                {"_id": 1, "description": 1, "transaction_type": 1, "category": 1},
            ).to_list(None)
            for t in no_custom:
                desc_key = re.sub(r'\s+', ' ', (t.get("description") or "").strip().lower())
                key = (desc_key, t.get("transaction_type", "debit"))
                if key not in override_map:
                    continue
                target_cat = override_map[key].most_common(1)[0][0]
                if t.get("category") != target_cat:
                    await transactions_col.update_one(
                        {"_id": t["_id"], "custom_category": None},
                        {"$set": {"category": target_cat}},
                    )
                    updated += 1

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

    # ── Pass 3.5: Apply user-defined categorisation rules ─────────────────────
    user_rules = await user_rules_col.find({"uid": user_id}).to_list(None)
    if user_rules:
        no_custom = await transactions_col.find(
            {"user_id": user_id, "custom_category": None},
            {"_id": 1, "merchant_name": 1, "description": 1, "category": 1},
        ).to_list(None)
        for t in no_custom:
            text = " ".join(filter(None, [t.get("merchant_name"), t.get("description")])).lower()
            for rule in user_rules:
                try:
                    if re.search(rule["pattern"], text, re.IGNORECASE):
                        if t.get("category") != rule["category"]:
                            await transactions_col.update_one(
                                {"_id": t["_id"]}, {"$set": {"category": rule["category"]}}
                            )
                            updated += 1
                        break
                except re.error:
                    continue

    # ── Pass 4: Propagate user custom_category overrides to auto-categorised txns ──
    # Key is (normalised_text, transaction_type) so credits and debits with the same
    # description can carry different categories — e.g. a transfer-out (credit) and a
    # savings deduction (debit) sharing the same description won't bleed into each other.
    user_overrides = await transactions_col.find(
        {"user_id": user_id, "custom_category": {"$ne": None}},
        {"merchant_name": 1, "description": 1, "custom_category": 1, "transaction_type": 1},
    ).to_list(None)

    override_map: dict[tuple[str, str], str] = {}
    for h in user_overrides:
        cat = h["custom_category"]
        txn_type = h.get("transaction_type", "")
        for key in [h.get("merchant_name"), h.get("description")]:
            if key:
                norm = re.sub(r'\s+', ' ', key.strip().lower())
                map_key = (norm, txn_type)
                if norm and map_key not in override_map:
                    override_map[map_key] = cat

    if override_map:
        all_auto = await transactions_col.find(
            {"user_id": user_id, "custom_category": None},
            {"_id": 1, "merchant_name": 1, "description": 1, "category": 1, "transaction_type": 1},
        ).to_list(None)
        for t in all_auto:
            txn_type = t.get("transaction_type", "")
            for key in [t.get("merchant_name"), t.get("description")]:
                if key:
                    norm = re.sub(r'\s+', ' ', key.strip().lower())
                    desired = override_map.get((norm, txn_type))
                    if desired:
                        if t.get("category") != desired:
                            await transactions_col.update_one(
                                {"_id": t["_id"]}, {"$set": {"category": desired}}
                            )
                            updated += 1
                        break

    return updated


async def _categorise_others_bg(uid: str) -> int:
    """Background: LLM-classify transactions still on None/Other across all collections.
    Uses a single Haiku call per collection per batch — no Tavily needed.
    Sets ai_attempted=True so each transaction is tried at most once.
    Never overwrites custom_category."""
    if not OPENROUTER_API_KEY:
        return 0

    col_map = [
        transactions_col,
        statement_transactions_col,
        mono_transactions_col,
        mpesa_transactions_col,
    ]
    cat_list = ", ".join(VALID_CATEGORIES)
    prompt_prefix = (
        "You are a UK personal finance assistant categorising bank transactions.\n"
        f"Assign each to exactly one of: {cat_list}.\n"
        "Rules:\n"
        "- Eating Out: restaurants, cafes, takeaways, delivery apps\n"
        "- Transport: trains, buses, taxis, Uber, parking, fuel, car-related services\n"
        "- Shopping: retail, online stores, non-food goods, homeware\n"
        "- Bills: utilities, broadband, mobile, insurance, rent, council tax\n"
        "- Subscriptions: streaming, software, recurring digital memberships\n"
        "- Health: hospitals, pharmacies, gyms, dentists, medical services\n"
        "- Travel: flights, hotels, holidays\n"
        "- Transfer: payments between accounts, credit card repayments, personal transfers\n"
        "- Income: salary, refunds, cashback, money received from people\n"
        "- Other: only if genuinely unclassifiable\n"
        "Reply ONLY with JSON: {\"1\": \"Category\", \"2\": \"Category\", ...}\n\n"
        "Transactions:\n"
    )

    total_updated = 0

    for col in col_map:
        # Fetch up to 80 unclassified transactions not yet attempted
        batch = await col.find(
            {"user_id": uid, "custom_category": None,
             "ai_attempted": {"$ne": True},
             "category": {"$in": [None, "Other"]}},
            {"merchant_name": 1, "description": 1, "transaction_type": 1},
        ).to_list(80)

        if not batch:
            continue

        # Deduplicate: one LLM call per unique label to save tokens
        seen: dict[str, list] = {}  # label → [ids]
        for t in batch:
            label = ((t.get("merchant_name") or "") + " " + (t.get("description") or "")).strip()[:100]
            seen.setdefault(label, []).append(t["_id"])

        unique_labels = list(seen.keys())
        lines = "\n".join(f"{i+1}. {lbl}" for i, lbl in enumerate(unique_labels))

        try:
            async with httpx.AsyncClient(timeout=30) as http:
                r = await http.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
                    json={
                        "model": "anthropic/claude-haiku-4-5",
                        "max_tokens": 600,
                        "temperature": 0,
                        "messages": [{"role": "user", "content": prompt_prefix + lines}],
                    },
                )
            data = r.json()
            if "choices" not in data:
                continue
            raw = data["choices"][0]["message"]["content"].strip()
            # Strip markdown fences
            if raw.startswith("```"):
                raw = re.sub(r'^```(?:json)?\s*', '', raw)
                raw = re.sub(r'\s*```\s*$', '', raw).strip()
            m = re.search(r"\{.*\}", raw, re.DOTALL)
            if not m:
                continue
            classifications: dict = json.loads(m.group())
        except Exception:
            # Mark all as attempted so we don't retry on every sync
            await col.update_many(
                {"_id": {"$in": [t["_id"] for t in batch]}},
                {"$set": {"ai_attempted": True}},
            )
            continue

        # Apply results
        for i, label in enumerate(unique_labels):
            cat = classifications.get(str(i + 1))
            final = cat if (cat and cat in VALID_CATEGORIES) else None
            update: dict = {"ai_attempted": True}
            if final and final != "Other":
                update["category"] = final
                total_updated += len(seen[label])
            await col.update_many(
                {"_id": {"$in": seen[label]}},
                {"$set": update},
            )

        # Mark any not reached by the LLM response
        reached_ids = {_id for ids in seen.values() for _id in ids}
        all_ids = {t["_id"] for t in batch}
        missed = list(all_ids - reached_ids)
        if missed:
            await col.update_many({"_id": {"$in": missed}}, {"$set": {"ai_attempted": True}})

    return total_updated


@app.post("/transactions/auto-categorise")
async def auto_categorise(from_date: Optional[str] = None, to_date: Optional[str] = None, user: dict = Depends(current_user)):
    """Categorise transactions using merchant rules then AI.

    Raw TrueLayer categories are fixed across ALL dates.
    Truly uncategorised (null) transactions are filtered by date range (default: all time).
    Never overwrites custom_category.
    """
    uid = user["email"]

    # Reset ai_attempted so a manual run always gets a fresh pass on all Others
    await transactions_col.update_many(
        {"user_id": uid, "category": "Other", "custom_category": None, "ai_attempted": True},
        {"$unset": {"ai_attempted": ""}},
    )

    # Step 1: apply deterministic merchant rules + custom_category propagation to all transactions
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
        "$or": [
            {"category": None},
            {"category": "Other"},
            {"category": {"$in": list(RAW_TRUELAYER_CATEGORIES)}},
        ],
    }
    if date_filter:
        query["date"] = date_filter

    uncategorised = await transactions_col.find(query).to_list(1000)

    if not uncategorised:
        return {"rules_fixed": rules_fixed, "ai_categorised": 0}

    # ── Step A: historical merchant matching ──────────────────────────────────
    # Build a map of (normalised text, transaction_type) → category.
    # Keying on direction prevents credits and debits with the same description
    # from inheriting each other's category (e.g. a savings transfer that appears
    # as both a credit and a debit with different intended categories).
    historical = await transactions_col.find(
        {"user_id": uid,
         "$or": [{"custom_category": {"$ne": None}}, {"category": {"$nin": list(RAW_TRUELAYER_CATEGORIES) + [None]}}]},
        {"merchant_name": 1, "description": 1, "category": 1, "custom_category": 1, "transaction_type": 1},
    ).to_list(None)

    merchant_map: dict[tuple[str, str], str] = {}
    for h in historical:
        cat = h.get("custom_category") or h.get("category")
        if not cat or cat in RAW_TRUELAYER_CATEGORIES:
            continue
        txn_type = h.get("transaction_type", "")
        for key in [h.get("merchant_name"), h.get("description")]:
            if key:
                norm = re.sub(r'\s+', ' ', key.strip().lower())
                map_key = (norm, txn_type)
                if norm and map_key not in merchant_map:
                    merchant_map[map_key] = cat

    # Apply historical matches; only send remaining to AI
    needs_ai: list = []
    history_matched = 0
    for t in uncategorised:
        txn_type = t.get("transaction_type", "")
        matched = None
        for key in [t.get("merchant_name"), t.get("description")]:
            if key:
                norm = re.sub(r'\s+', ' ', key.strip().lower())
                if (norm, txn_type) in merchant_map:
                    matched = merchant_map[(norm, txn_type)]
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

    # Tavily lookup for merchants that rules couldn't identify
    # Only search merchants that look like real names (not bank reference strings)
    unknown_merchants = list({
        name for t in needs_ai
        if (name := (t.get("merchant_name") or "").strip()) and 2 < len(name) < 50
        and not re.search(r'\d{6,}', name)  # skip strings that are mostly reference numbers
    })
    tavily_info = await tavily_lookup_merchants(unknown_merchants) if TAVILY_API_KEY else {}

    ai_total = 0
    for i in range(0, len(needs_ai), 30):
        batch = needs_ai[i:i + 30]
        lines = "\n".join(
            f'{j}: merchant="{t.get("merchant_name") or ""}" '
            f'desc="{t.get("description", "")[:80]}" '
            f'amount=£{t["amount"]:.2f} type={t.get("transaction_type", "debit")}'
            + (f' [web: {tavily_info[t.get("merchant_name") or t.get("description", "")][:120]}]'
               if (t.get("merchant_name") or t.get("description", "")) in tavily_info else "")
            for j, t in enumerate(batch)
        )
        prompt = (
            f"You are an expert UK personal finance categoriser. "
            f"Assign each transaction to exactly one category from this list: {', '.join(VALID_CATEGORIES)}.\n\n"
            f"Rules:\n"
            f"- Use the merchant name and description to determine WHAT the business/service is, not HOW payment was made.\n"
            f"- Ignore payment method words (direct debit, standing order, purchase, faster payment, BACS) — look at the actual merchant.\n"
            f"- '[web: ...]' entries contain a web search result about the merchant — use this to inform your decision.\n"
            f"- 'Other' is a last resort: only use it if you truly cannot identify the merchant or service after careful consideration.\n"
            f"- Credits to a current account are usually 'Income' or 'Transfer' unless clearly a refund.\n"
            f"- UK-specific: Monzo pots, Starling spaces, Marcus savings = 'Savings'; Amex/Barclaycard payments = 'Debt'.\n\n"
            f"Reply with ONLY a JSON object mapping index to category, e.g. {{\"0\": \"Groceries\", \"1\": \"Transport\"}}.\n\n"
            f"{example_block}"
            f"Transactions:\n{lines}"
        )
        try:
            async with httpx.AsyncClient(timeout=45) as http:
                r = await http.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}",
                             "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
                    json={"model": "anthropic/claude-haiku-4-5",
                          "max_tokens": 600,
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
    yapily_accs = await yapily_accounts_col.find({"user_id": uid}).to_list(None)
    stmt_accs_all = await statement_accounts_col.find({"user_id": uid}).to_list(None)
    # Only include GBP / UK statement accounts in the UK net-worth figure
    stmt_accs = [a for a in stmt_accs_all if a.get("currency", "GBP") == "GBP" or a.get("region", "UK") == "UK"]
    inv_accs = await investment_accounts_col.find({"user_id": uid}).to_list(None)
    investment_total = sum(a.get("total_value", 0) for a in inv_accs)
    if not accounts and not yapily_accs and not stmt_accs and not inv_accs:
        return KPIResponse(net_worth=0, cash=0, runway=0, investments=0, pensions=0, last_updated=datetime.now())

    net_worth = (
        sum(a["balance"] for a in accounts)
        + sum(a.get("balance", 0) for a in yapily_accs)
        + sum(a.get("balance", 0) for a in stmt_accs)
        + investment_total
    )
    # Cash = liquid bank accounts only (exclude credit cards); Yapily filtered to bank type too
    cash = (
        sum(a["balance"] for a in accounts if a["type"] == "bank")
        + sum(a.get("balance", 0) for a in yapily_accs if a.get("type") == "bank")
        + sum(a.get("balance", 0) for a in stmt_accs if a.get("type") == "bank")
    )
    yapily_txn_debits = await yapily_transactions_col.find(
        {"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}
    ).to_list(None)
    debits    = await transactions_col.find(
        {"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}
    ).to_list(None)
    all_debits = debits + yapily_txn_debits
    avg_spend = (sum(d["amount"] for d in all_debits) / 3) if all_debits else 1000
    runway    = cash / avg_spend if avg_spend else 0

    return KPIResponse(
        net_worth=net_worth, cash=cash, runway=round(runway, 1),
        investments=investment_total, pensions=0, last_updated=datetime.now(),
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
    if not doc:
        return {
            "hide_net_worth": False,
            "dark_mode": False,
            "pay_period_config": {"type": "calendar_month"},
            "region": "UK",
            "debt_target_months": 12,
        }
    region = doc.get("region", "UK")
    result = {
        "hide_net_worth": doc.get("hide_net_worth", False),
        "dark_mode": doc.get("dark_mode", False),
        "pay_period_config": doc.get("pay_period_config", {"type": "calendar_month"}),
        "region": region,
        "debt_target_months": doc.get("debt_target_months", 12),
    }
    if "debt_tracking_start" in doc:
        result["debt_tracking_start"] = doc["debt_tracking_start"]
    return result

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
    "Savings", "Debt", "Transfer", "Income", "Cash", "Charity", "Other",
]

def _clean_custom(raw: list) -> list:
    """Remove any custom categories that have since become built-in."""
    return [c for c in raw if c not in BUILTIN_CATEGORIES]

@app.get("/categories")
async def get_categories(user: dict = Depends(current_user)):
    doc = await user_categories_col.find_one({"user_id": user["email"]})
    custom = _clean_custom(doc.get("categories", []) if doc else [])
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
    custom = _clean_custom(doc.get("categories", []) if doc else [])
    return {"builtin": BUILTIN_CATEGORIES, "custom": custom, "all": BUILTIN_CATEGORIES + custom}

@app.delete("/categories/{name}")
async def delete_category(name: str, user: dict = Depends(current_user)):
    # Always remove from custom list (handles migration where a category became built-in)
    await user_categories_col.update_one(
        {"user_id": user["email"]},
        {"$pull": {"categories": name}},
    )
    if name in BUILTIN_CATEGORIES:
        raise HTTPException(400, "Cannot delete built-in categories")
    return {"deleted": name}


# ── Categorisation Rules ───────────────────────────────────────────────────────

@app.get("/rules")
async def get_rules(user: dict = Depends(current_user)):
    uid = user["email"]
    docs = await user_rules_col.find({"uid": uid}).sort("created_at", -1).to_list(None)
    return {"rules": [{"id": str(d["_id"]), "description": d["description"],
                        "pattern": d["pattern"], "category": d["category"],
                        "created_at": d["created_at"].isoformat()} for d in docs]}

@app.post("/rules/parse")
async def parse_rule(body: dict, user: dict = Depends(current_user)):
    """Use Haiku to extract a structured rule from natural language."""
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "No text provided")
    doc = await user_categories_col.find_one({"user_id": user["email"]})
    custom = doc.get("categories", []) if doc else []
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
                  "messages": [{"role": "user", "content": prompt}]},
        )
    if r.status_code != 200:
        raise HTTPException(502, "AI request failed")
    content = r.json()["choices"][0]["message"]["content"]
    m = re.search(r"\{.*\}", content, re.DOTALL)
    if not m:
        raise HTTPException(422, "Could not parse rule")
    parsed = json.loads(m.group())
    if "error" in parsed:
        raise HTTPException(422, parsed["error"])
    if parsed.get("category") not in all_cats:
        raise HTTPException(422, f"Unknown category: {parsed.get('category')}")
    try:
        re.compile(parsed["pattern"])
    except re.error:
        raise HTTPException(422, "Invalid pattern generated")
    return {"pattern": parsed["pattern"], "category": parsed["category"]}

@app.post("/rules")
async def add_rule(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    description = (body.get("description") or "").strip()
    pattern = (body.get("pattern") or "").strip()
    category = (body.get("category") or "").strip()
    if not description or not pattern or not category:
        raise HTTPException(400, "description, pattern and category are required")
    doc = await user_categories_col.find_one({"user_id": uid})
    custom = doc.get("categories", []) if doc else []
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
    # Apply the new rule immediately
    asyncio.create_task(_apply_rules_bulk(uid))
    return {"id": rule_id, "description": description, "pattern": pattern.lower(), "category": category}

@app.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, user: dict = Depends(current_user)):
    result = await user_rules_col.delete_one({"_id": rule_id, "uid": user["email"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Rule not found")
    return {"deleted": rule_id}


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
    yapily_income_txns = await yapily_transactions_col.find(
        {"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}}
    ).to_list(None)
    income_txns = income_txns + yapily_income_txns
    monthly_income = sum(t["amount"] for t in income_txns) / 3

    # Monthly spending by category (debit only, exclude Transfer/Debt/Savings)
    debit_txns = await transactions_col.find(
        {"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}
    ).to_list(None)
    yapily_debit_txns = await yapily_transactions_col.find(
        {"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}
    ).to_list(None)
    debit_txns = debit_txns + yapily_debit_txns

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

    # Look up APR per CC account
    account_rates: dict[str, float] = {}
    for a in cc_accounts:
        rate_doc = await account_rates_col.find_one({"user_id": uid, "account_id": str(a["_id"])})
        if rate_doc:
            account_rates[str(a["_id"])] = float(rate_doc["apr"])

    # Weighted average APR
    weighted_apr = (
        sum(abs(a["balance"]) * account_rates.get(str(a["_id"]), 0) for a in cc_accounts) / total_debt
        if total_debt > 0 else 0.0
    )
    monthly_rate = weighted_apr / 12 / 100

    # Payoff maths with compound interest
    prefs_doc = await preferences_col.find_one({"user_id": uid}) or {}
    target_months_pref = int(prefs_doc.get("debt_target_months", 12))
    if monthly_rate > 0 and target_months_pref > 0:
        payment_for_target = round(total_debt * monthly_rate / (1 - (1 + monthly_rate) ** (-target_months_pref)), 2) if total_debt > 0 else 0
    else:
        payment_for_target = round(total_debt / target_months_pref, 2) if total_debt > 0 else 0

    gap = max(0, round(payment_for_target - monthly_surplus, 2))

    # Months at current rate with compound interest
    if monthly_surplus > 0 and total_debt > 0:
        if monthly_rate > 0:
            # Use simulation to find months to payoff at monthly_surplus
            sim_bal = total_debt
            months_at_current = 0
            while sim_bal > 0.01 and months_at_current < 999:
                sim_bal = sim_bal * (1 + monthly_rate) - monthly_surplus
                months_at_current += 1
            months_at_current = round(float(months_at_current), 1)
        else:
            months_at_current = round(total_debt / monthly_surplus, 1)
    else:
        months_at_current = 999

    payment_for_12mo = payment_for_target  # kept for backwards compat

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
            {
                "account_id": str(a["_id"]),
                "name": a["name"],
                "provider": a.get("provider", ""),
                "balance": round(a["balance"], 2),
                "apr": account_rates.get(str(a["_id"])),
                "monthly_interest": round(abs(a["balance"]) * account_rates.get(str(a["_id"]), 0) / 12 / 100, 2),
            }
            for a in cc_accounts
        ],
        "monthly_income": round(monthly_income, 2),
        "monthly_spending": round(monthly_essential, 2),
        "monthly_surplus": round(monthly_surplus, 2),
        "monthly_debt_payment": round(monthly_debt_payment, 2),
        "payment_needed_12mo": payment_for_12mo,
        "gap_to_12mo": gap,
        "months_at_current_rate": months_at_current,
        "weighted_apr": round(weighted_apr, 4),
        "category_spending": {k: v for k, v in sorted(monthly_cat.items(), key=lambda x: -x[1])},
        "recommendations": recommendations,
        "recent_discretionary": recent_discretionary,
    }


@app.get("/debt/burndown")
async def debt_burndown(
    user: dict = Depends(current_user),
    target_months: Optional[int] = None,
    strategy: str = "avalanche",
    start_date: Optional[str] = None,
):
    """Return monthly debt burndown with compound interest and repayment strategy."""
    uid  = user["email"]
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    if target_months is None:
        target_months = int(prefs.get("debt_target_months", 12))
    region = prefs.get("region", "UK")
    sym = "KES" if region == "Kenya" else "GBP"

    # Current CC accounts and their APRs
    accounts = await accounts_col.find({"user_id": uid}).to_list(None)
    cc_accounts = [a for a in accounts if a.get("type") == "credit_card" and a.get("balance", 0) < 0]
    cc_ids = [a["_id"] for a in cc_accounts]

    # Load per-account APRs
    apr_map: dict[str, float] = {}
    for a in cc_accounts:
        rate_doc = await account_rates_col.find_one({"user_id": uid, "account_id": str(a["_id"])})
        if rate_doc:
            apr_map[str(a["_id"])] = float(rate_doc["apr"])

    # Build simulation cards (each card has its own balance + APR)
    sim_cards = [
        {
            "id": str(a["_id"]),
            "balance": abs(a["balance"]),
            "monthly_rate": apr_map.get(str(a["_id"]), 0) / 12 / 100,
        }
        for a in cc_accounts
    ]
    current_debt = sum(c["balance"] for c in sim_cards)

    today = datetime.now()
    cur_mk = today.strftime("%Y-%m")
    if start_date is None:
        start_date = prefs.get("debt_tracking_start", cur_mk)

    if current_debt == 0 or not cc_ids:
        return {
            "burndown": [], "current_debt": 0, "target_months": target_months,
            "target_date": (today.replace(day=1) + timedelta(days=32 * target_months)).strftime("%Y-%m"),
            "monthly_payment_needed": 0, "currency": sym,
            "total_interest_target": 0, "total_interest_projected": 0,
            "weighted_apr": 0, "strategy": strategy, "has_rates": False,
            "start_date": start_date,
        }

    weighted_apr = sum(c["balance"] * c["monthly_rate"] * 12 * 100 for c in sim_cards) / current_debt if current_debt > 0 else 0
    avg_monthly_rate = weighted_apr / 12 / 100
    has_rates = any(c["monthly_rate"] > 0 for c in sim_cards)

    # Historical data — check both TrueLayer and Yapily transaction collections
    all_cc_txns = await transactions_col.find(
        {"account_id": {"$in": cc_ids}, "user_id": uid},
        {"amount": 1, "transaction_type": 1, "date": 1},
    ).to_list(None)
    yapily_cc_txns = await yapily_transactions_col.find(
        {"account_id": {"$in": cc_ids}, "user_id": uid},
        {"amount": 1, "transaction_type": 1, "date": 1},
    ).to_list(None)
    all_cc_txns += yapily_cc_txns

    from collections import defaultdict as _dd
    monthly_net: dict = _dd(float)
    for t in all_cc_txns:
        d = t.get("date")
        if not isinstance(d, datetime):
            continue
        mk = d.strftime("%Y-%m")
        if t["transaction_type"] == "debit":
            monthly_net[mk] += t["amount"]
        else:
            monthly_net[mk] -= t["amount"]

    # Build full history (all available months) for computing avg reduction
    full_history: dict[str, float] = {cur_mk: current_debt}
    running = current_debt
    for mk in sorted(monthly_net.keys(), reverse=True):
        running -= monthly_net[mk]
        year, mon = map(int, mk.split("-"))
        prev_mon = mon - 1 if mon > 1 else 12
        prev_year = year if mon > 1 else year - 1
        full_history[f"{prev_year}-{prev_mon:02d}"] = max(0.0, running)

    # Average monthly reduction from full history (so projection is always based on real spending rate)
    if len(full_history) >= 2:
        sorted_full = sorted(full_history.items())
        oldest_debt = sorted_full[0][1]
        num_hist_months = len(sorted_full) - 1
        avg_monthly_reduction = (oldest_debt - current_debt) / num_hist_months if num_hist_months > 0 else 0
    else:
        avg_monthly_reduction = 0

    # Filter to start_date for chart display only
    history = {mk: v for mk, v in full_history.items() if mk >= start_date}
    if not history:
        history = {cur_mk: current_debt}

    # Target monthly payment using amortization formula (with interest)
    if avg_monthly_rate > 0 and target_months > 0:
        monthly_target_payment = current_debt * avg_monthly_rate / (1 - (1 + avg_monthly_rate) ** (-target_months))
    else:
        monthly_target_payment = current_debt / target_months if target_months > 0 else current_debt

    # ── Strategy simulation (avalanche or snowball) ───────────────────────────
    def simulate(cards: list[dict], monthly_payment: float, max_months: int) -> tuple[list[float], float]:
        """Simulate debt payoff. Returns list of total balances per month and total interest paid."""
        import copy
        cards_s = copy.deepcopy(cards)
        balances: list[float] = []
        total_interest = 0.0
        for _ in range(max_months):
            # Apply monthly interest
            for c in cards_s:
                interest = c["balance"] * c["monthly_rate"]
                c["balance"] += interest
                total_interest += interest
            # Sort by strategy
            if strategy == "snowball":
                order = sorted(cards_s, key=lambda x: x["balance"])
            else:  # avalanche (default)
                order = sorted(cards_s, key=lambda x: x["monthly_rate"], reverse=True)
            # Apply payment
            remaining = monthly_payment
            for c in order:
                pay = min(c["balance"], remaining)
                c["balance"] = round(c["balance"] - pay, 4)
                remaining -= pay
                if remaining <= 0:
                    break
            total = sum(c["balance"] for c in cards_s)
            balances.append(round(total, 2))
            if total < 0.01:
                break
        return balances, round(total_interest, 2)

    # Target line: simple total-debt amortization — strategy-independent, so target never
    # moves when the user switches between avalanche/snowball.
    target_balances: list[float] = []
    total_interest_target = 0.0
    _bal = current_debt
    for _ in range(target_months):
        _interest = _bal * avg_monthly_rate
        total_interest_target += _interest
        _bal = max(0.0, _bal + _interest - monthly_target_payment)
        target_balances.append(round(_bal, 2))
        if _bal < 0.01:
            break
    total_interest_target = round(total_interest_target, 2)

    # Projected line: derive the implied monthly payment from actual historical behaviour.
    # avg_monthly_reduction = historical net debt change per month (positive = shrinking, negative = growing).
    # implied_payment = that net change + interest on current balance = what the user actually pays each month.
    implied_payment = avg_monthly_reduction + avg_monthly_rate * current_debt
    if implied_payment >= 0:
        # Debt reducing (or just covering interest): simulate at historical payment rate
        proj_balances, total_interest_projected = simulate(sim_cards, implied_payment, target_months)
    else:
        # Debt growing faster than any payment — project forward at historical growth rate
        proj_balances = []
        total_interest_projected = 0.0
        _p = current_debt
        for _ in range(target_months):
            interest = _p * avg_monthly_rate
            total_interest_projected += interest
            # subtracting a negative avg_monthly_reduction = adding the growth amount
            _p = _p * (1 + avg_monthly_rate) - avg_monthly_reduction
            proj_balances.append(round(_p, 2))
        total_interest_projected = round(total_interest_projected, 2)

    # Assemble chart points
    points: list[dict] = []

    # Historical (actual) points — target line anchored at current_debt going back
    for mk, debt_val in sorted(history.items()):
        year, mon = map(int, mk.split("-"))
        months_back = (today.year - year) * 12 + (today.month - mon)
        if months_back > 0 and avg_monthly_rate > 0:
            past_target = round(current_debt + months_back * monthly_target_payment / (1 + avg_monthly_rate) ** months_back, 2)
        elif months_back > 0:
            past_target = round(current_debt + months_back * monthly_target_payment, 2)
        else:
            past_target = round(current_debt, 2)
        # Anchor the projected line at today's balance so it connects to the actual line
        proj_anchor = round(current_debt, 2) if months_back == 0 else None
        points.append({"month": mk, "actual": round(debt_val, 2), "target": max(0.0, past_target), "projected": proj_anchor})

    # Future points — cap chart at exactly target_months
    for i in range(1, target_months + 1):
        future_dt = today.replace(day=1) + timedelta(days=32 * i)
        mk = future_dt.strftime("%Y-%m")
        target_val = target_balances[i - 1] if i - 1 < len(target_balances) else 0.0
        proj_val   = proj_balances[i - 1]   if i - 1 < len(proj_balances)   else 0.0
        points.append({
            "month": mk,
            "actual": None,
            "target": round(max(0.0, target_val), 2),
            "projected": round(max(0.0, proj_val), 2),
        })

    target_date = (today.replace(day=1) + timedelta(days=32 * target_months)).strftime("%Y-%m")

    return {
        "burndown": points,
        "current_debt": round(current_debt, 2),
        "target_months": target_months,
        "target_date": target_date,
        "monthly_payment_needed": round(monthly_target_payment, 2),
        "currency": sym,
        "total_interest_target": total_interest_target,
        "total_interest_projected": total_interest_projected,
        "weighted_apr": round(weighted_apr, 2),
        "strategy": strategy,
        "has_rates": has_rates,
        "start_date": start_date,
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
        {"user_id": uid, "session_type": "debt"},
        sort=[("created_at", -1)]
    )
    if not session:
        session_id = str(uuid_lib.uuid4())
        await chat_sessions_col.insert_one({
            "_id": session_id,
            "user_id": uid,
            "session_type": "debt",
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
        "session_type": "debt",
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
        yapily_income = await yapily_transactions_col.find({"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}}).to_list(None)
        income_txns = income_txns + yapily_income
        debit_txns  = await transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}).to_list(None)
        yapily_debits = await yapily_transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}).to_list(None)
        debit_txns = debit_txns + yapily_debits

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

# ── Pay-period helpers (mirror of frontend payPeriod.ts) ─────────────────────

def _js_to_py_weekday(js_weekday: int) -> int:
    """JS weekday (0=Sun) → Python weekday (0=Mon)."""
    return (js_weekday - 1) % 7

def _last_py_weekday_of_month(year: int, month: int, py_weekday: int) -> _date:
    last = _date(year, month, _calendar.monthrange(year, month)[1])
    return last - timedelta(days=(last.weekday() - py_weekday) % 7)

def _period_last_weekday(ref: _date, py_weekday: int) -> tuple[_date, _date]:
    y, m = ref.year, ref.month
    this_pay = _last_py_weekday_of_month(y, m, py_weekday)
    if ref >= this_pay:
        nm = m % 12 + 1; ny = y + (1 if m == 12 else 0)
        return this_pay, _last_py_weekday_of_month(ny, nm, py_weekday) - timedelta(days=1)
    pm = 12 if m == 1 else m - 1; py_ = y - 1 if m == 1 else y
    return _last_py_weekday_of_month(py_, pm, py_weekday), this_pay - timedelta(days=1)

def _period_calendar_month(ref: _date) -> tuple[_date, _date]:
    y, m = ref.year, ref.month
    return _date(y, m, 1), _date(y, m, _calendar.monthrange(y, m)[1])

def _period_monthly_pay_date(ref: _date, pay_day: int) -> tuple[_date, _date]:
    def clamp(yr, mo, d): return min(d, _calendar.monthrange(yr, mo)[1])
    y, m, d = ref.year, ref.month, ref.day
    tp = clamp(y, m, pay_day)
    if d >= tp:
        nm = m % 12 + 1; ny = y + (1 if m == 12 else 0)
        np = clamp(ny, nm, pay_day)
        return _date(y, m, tp), _date(ny, nm, np) - timedelta(days=1)
    pm = 12 if m == 1 else m - 1; py_ = y - 1 if m == 1 else y
    pp = clamp(py_, pm, pay_day)
    return _date(py_, pm, pp), _date(y, m, tp) - timedelta(days=1)

def _period_weekly(ref: _date, js_weekday: int) -> tuple[_date, _date]:
    py_wd = _js_to_py_weekday(js_weekday)
    start = ref - timedelta(days=(ref.weekday() - py_wd) % 7)
    return start, start + timedelta(days=6)

def _period_biweekly(ref: _date, reference_date_str: str) -> tuple[_date, _date]:
    ref_start = _date.fromisoformat(reference_date_str)
    n = (ref - ref_start).days // 14
    start = ref_start + timedelta(days=n * 14)
    return start, start + timedelta(days=13)

def _get_pay_period_for_date(ref: _date, config: dict) -> tuple[_date, _date]:
    t = config.get("type", "calendar_month")
    if t == "calendar_month":      return _period_calendar_month(ref)
    if t == "last_friday":         return _period_last_weekday(ref, 4)
    if t == "last_weekday_of_month": return _period_last_weekday(ref, _js_to_py_weekday(config.get("weekday", 4)))
    if t == "monthly_pay_date":    return _period_monthly_pay_date(ref, config.get("day", 1))
    if t == "weekly":              return _period_weekly(ref, config.get("weekday", 1))
    if t == "biweekly":            return _period_biweekly(ref, config.get("referenceDate", "2024-01-01"))
    return _period_calendar_month(ref)

def _prev_pay_period(start: _date, config: dict) -> tuple[_date, _date]:
    return _get_pay_period_for_date(start - timedelta(days=1), config)


@app.get("/budget/pace-profile")
async def budget_pace_profile(user: dict = Depends(current_user)):
    """Return per-category cumulative spend curves built from the user's own history."""
    uid = user["email"]
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    pay_config = prefs.get("pay_period_config", {"type": "calendar_month"})
    region = prefs.get("region", "UK")

    today = _date.today()
    SKIP = {"Transfer", "Savings", "Debt", "Income"}
    SAMPLE_POINTS = 20   # curve resolution (0 → 1 in 20 steps)
    MIN_PERIODS = 2      # periods needed before trusting the curve

    cur_start, _ = _get_pay_period_for_date(today, pay_config)

    # Walk back up to 6 periods
    periods: list[tuple[_date, _date]] = []
    ps, pe = cur_start, _date.today()
    for _ in range(6):
        ps, pe = _prev_pay_period(ps, pay_config)
        periods.append((ps, pe))
        if ps < _date(2024, 1, 1):
            break

    if not periods:
        return {"curves": {}, "sample_points": SAMPLE_POINTS, "periods_analysed": 0}

    earliest_dt = datetime(min(p[0] for p in periods).year, min(p[0] for p in periods).month, min(p[0] for p in periods).day)
    cutoff_dt = datetime(cur_start.year, cur_start.month, cur_start.day)
    proj = {"date": 1, "amount": 1, "category": 1, "custom_category": 1, "planned": 1, "transaction_type": 1}
    base_q = {"user_id": uid, "transaction_type": "debit", "date": {"$gte": earliest_dt, "$lt": cutoff_dt}}

    raw: list[dict] = []
    if region == "Kenya":
        for col in [mono_transactions_col, mpesa_transactions_col, statement_transactions_col]:
            raw.extend(await col.find(base_q, proj).to_list(None))
    else:
        raw.extend(await transactions_col.find(base_q, proj).to_list(None))
        raw.extend(await yapily_transactions_col.find(base_q, proj).to_list(None))

    # Map each transaction to (category, period_index, day_fraction, amount)
    from collections import defaultdict
    # cat → list[list[(frac, amount)]]  (outer list indexed by period)
    cat_data: dict[str, list[list[tuple[float, float]]]] = defaultdict(
        lambda: [[] for _ in range(len(periods))]
    )

    for tx in raw:
        if tx.get("planned"):
            continue
        cat = tx.get("custom_category") or tx.get("category") or "Other"
        if cat in SKIP:
            continue
        amount = abs(float(tx.get("amount", 0) or 0))
        if amount <= 0:
            continue
        try:
            d = tx["date"]
            tx_date = d.date() if isinstance(d, datetime) else _date.fromisoformat(str(d)[:10])
        except Exception:
            continue
        for i, (ps, pe) in enumerate(periods):
            if ps <= tx_date <= pe:
                span = max(1, (pe - ps).days)
                frac = (tx_date - ps).days / span
                cat_data[cat][i].append((frac, amount))
                break

    # Build cumulative curves averaged across periods
    sample_fracs = [i / SAMPLE_POINTS for i in range(SAMPLE_POINTS + 1)]
    curves: dict[str, list[float]] = {}

    for cat, period_lists in cat_data.items():
        per_period_curves: list[list[float]] = []
        for period_txns in period_lists:
            if not period_txns:
                continue
            total = sum(a for _, a in period_txns)
            if total <= 0:
                continue
            per_period_curves.append([
                sum(a for f, a in period_txns if f <= sf) / total
                for sf in sample_fracs
            ])
        if len(per_period_curves) < MIN_PERIODS:
            continue
        n = len(per_period_curves)
        curves[cat] = [
            sum(pc[i] for pc in per_period_curves) / n
            for i in range(len(sample_fracs))
        ]

    return {"curves": curves, "sample_points": SAMPLE_POINTS, "periods_analysed": len(periods)}


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
        yapily_debits_b = await yapily_transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}).to_list(None)
        debit_txns = debit_txns + yapily_debits_b
        income_txns = await transactions_col.find({"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}}).to_list(None)
        yapily_income_b = await yapily_transactions_col.find({"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}}).to_list(None)
        income_txns = income_txns + yapily_income_b

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
yapily_consents_col      = db["yapily_consents"]
yapily_accounts_col      = db["yapily_accounts"]
yapily_transactions_col  = db["yapily_transactions"]
savings_insights_col     = db["savings_insights"]
savings_labels_col       = db["savings_insight_labels"]
investment_accounts_col  = db["investment_accounts"]
investment_holdings_col  = db["investment_holdings"]

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


# ── Yapily helpers ────────────────────────────────────────────────────────────

def _yapily_headers(consent: str | None = None) -> dict:
    creds = base64.b64encode(f"{YAPILY_APP_UUID}:{YAPILY_SECRET}".encode()).decode()
    h = {"Authorization": f"Basic {creds}", "Content-Type": "application/json"}
    if consent:
        h["consent"] = consent
    return h


async def _sync_yapily_consent(consent_token: str, user_id: str):
    headers = _yapily_headers(consent_token)
    async with httpx.AsyncClient(timeout=30) as client:
        ar = await client.get(f"{YAPILY_BASE_URL}/accounts", headers=headers)
    if ar.status_code != 200:
        return
    accounts = ar.json().get("data", [])
    yapily_new_txns: list = []
    yapily_is_initial = not await yapily_transactions_col.find_one({"user_id": user_id})
    for acc in accounts:
        acc_id = acc.get("id")
        if not acc_id:
            continue
        balance = 0.0
        for b in acc.get("balances", []):
            try:
                balance = float(b.get("amount", 0))
                break
            except Exception:
                pass
        currency = acc.get("currency", "GBP")
        details = acc.get("details", {})
        name = details.get("name") or acc.get("nickname") or acc.get("type", "Account")
        institution_id = acc.get("institutionId", "")
        await yapily_accounts_col.update_one({"_id": acc_id}, {"$set": {
            "_id":          acc_id,
            "user_id":      user_id,
            "consent":      consent_token,
            "name":         name,
            "type":         acc.get("type", "TRANSACTION").lower(),
            "balance":      balance,
            "currency":     currency,
            "institution_id": institution_id,
            "status":       "connected",
            "updated_at":   datetime.now(),
        }}, upsert=True)
        # Determine from-date based on last synced transaction for this account
        latest_yapily = await yapily_transactions_col.find_one(
            {"account_id": acc_id, "user_id": user_id},
            sort=[("date", -1)],
            projection={"date": 1},
        )
        txn_params: dict = {"accountId": acc_id, "limit": 500}
        if latest_yapily and latest_yapily.get("date"):
            last_dt = latest_yapily["date"]
            if isinstance(last_dt, datetime):
                from_dt = (last_dt - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
            else:
                from_dt = str(last_dt)[:10] + "T00:00:00Z"
            txn_params["from"] = from_dt

        # Fetch transactions
        async with httpx.AsyncClient(timeout=30) as client:
            tr = await client.get(
                f"{YAPILY_BASE_URL}/transactions",
                headers=headers,
                params=txn_params
            )
        if tr.status_code != 200:
            continue
        txns = tr.json().get("data", [])
        for txn in txns:
            amt_obj = txn.get("amount", {})
            try:
                amount = abs(float(amt_obj.get("amount", txn.get("amount", 0))))
            except Exception:
                continue
            if amount <= 0:
                continue
            txn_type_raw = str(txn.get("transactionInformation", {}).get("type", txn.get("type", "DEBIT"))).upper()
            txn_type = "credit" if txn_type_raw == "CREDIT" else "debit"
            desc = (txn.get("description") or txn.get("reference") or txn.get("proprietaryBankTransactionCode", {}).get("code") or "")
            merchant = txn.get("merchant", {})
            merchant_name = merchant.get("name") if isinstance(merchant, dict) else None
            txn_id = txn.get("id")
            if not txn_id:
                txn_id = hashlib.sha256(f"{acc_id}|{txn.get('date','')}|{amount}|{desc[:60]}".encode()).hexdigest()[:24]
            date_str = txn.get("date") or txn.get("bookingDateTime") or ""
            try:
                txn_date = datetime.fromisoformat(str(date_str).replace("Z", "+00:00"))
            except Exception:
                txn_date = datetime.now()
            cat = rule_categorise(merchant_name or "", desc)
            yresult = await yapily_transactions_col.update_one({"_id": txn_id}, {"$set": {
                "account_id":       acc_id,
                "user_id":          user_id,
                "date":             txn_date,
                "amount":           amount,
                "currency":         amt_obj.get("currency", currency) if isinstance(amt_obj, dict) else currency,
                "description":      desc,
                "merchant_name":    merchant_name,
                "category":         cat,
                "transaction_type": txn_type,
            }, "$setOnInsert": {"custom_category": None}}, upsert=True)
            if yresult.upserted_id is not None:
                yapily_new_txns.append({
                    "description":   desc,
                    "merchant_name": merchant_name,
                    "amount":        amount,
                    "currency":      amt_obj.get("currency", currency) if isinstance(amt_obj, dict) else currency,
                })

    if yapily_new_txns and not yapily_is_initial and user_id and user_id != "unknown":
        asyncio.create_task(_notify_new_transactions(user_id, yapily_new_txns))


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

        # Determine from-date based on last synced transaction for this account
        latest_mono = await mono_transactions_col.find_one(
            {"account_id": account_id, "user_id": user_id},
            sort=[("date", -1)],
            projection={"date": 1},
        )
        mono_from_date: str | None = None
        if latest_mono and latest_mono.get("date"):
            last_dt = latest_mono["date"]
            if isinstance(last_dt, datetime):
                mono_from_date = (last_dt - timedelta(days=1)).strftime("%Y-%m-%d")
            else:
                mono_from_date = str(last_dt)[:10]

        # Transactions — Mono v2 pagination
        for page in range(1, 6):
            txn_params: dict = {"page": page, "limit": 100}
            if mono_from_date:
                txn_params["start"] = mono_from_date
            tr = await client.get(
                f"{MONO_API_URL}/accounts/{account_id}/transactions",
                headers=_mono_headers(),
                params=txn_params,
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


# ── Yapily endpoints ──────────────────────────────────────────────────────────

@app.get("/auth/yapily/institutions")
async def yapily_institutions(country: str = "GB", user: dict = Depends(current_user)):
    if not YAPILY_APP_UUID:
        raise HTTPException(503, "Yapily not configured")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{YAPILY_BASE_URL}/institutions",
            headers=_yapily_headers(),
            params={"filtered-countries": country}
        )
    if r.status_code != 200:
        raise HTTPException(502, f"Yapily institutions failed: {r.text[:200]}")
    institutions = r.json().get("data", [])
    result = []
    for inst in institutions:
        media = inst.get("media", [])
        logo = next((m.get("source", "") for m in media if m.get("type") == "icon"), "")
        if not logo:
            logo = next((m.get("source", "") for m in media), "")
        result.append({"id": inst["id"], "name": inst.get("name", inst["id"]), "logo": logo, "countries": inst.get("countries", [])})
    return result


@app.post("/auth/yapily/requisition")
async def yapily_create_requisition(body: dict, user: dict = Depends(current_user)):
    institution_id = body.get("institution_id")
    if not institution_id:
        raise HTTPException(400, "institution_id required")
    uid = user["email"]
    if not YAPILY_APP_UUID:
        raise HTTPException(503, "Yapily not configured")
    callback = f"{APP_URL}/auth/yapily/callback"
    from_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%dT00:00:00Z")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{YAPILY_BASE_URL}/account-auth-requests",
            headers=_yapily_headers(),
            json={
                "applicationUserId": uid[:36],
                "institutionId": institution_id,
                "callback": callback,
                "accountRequest": {"transactionFrom": from_date},
            }
        )
    if r.status_code not in (200, 201):
        raise HTTPException(502, f"Yapily auth request failed: {r.text[:300]}")
    data = r.json().get("data", {})
    consent_token = data.get("id")
    auth_url = data.get("authorisationUrl")
    if consent_token:
        await yapily_consents_col.update_one({"_id": consent_token}, {"$set": {
            "_id":            consent_token,
            "user_id":        uid,
            "institution_id": institution_id,
            "status":         "AWAITING_AUTHORIZATION",
            "created_at":     datetime.now(),
        }}, upsert=True)
    return {"link": auth_url, "requisition_id": consent_token}


@app.get("/auth/yapily/callback")
async def yapily_callback(consent: str = "", error: str = ""):
    if consent:
        doc = await yapily_consents_col.find_one({"_id": consent})
        if doc:
            await yapily_consents_col.update_one({"_id": consent}, {"$set": {"status": "AUTHORIZED"}})
            asyncio.create_task(_sync_yapily_consent(consent, doc["user_id"]))
    return RedirectResponse(url=f"{APP_URL}/accounts?yapily=connected")


@app.post("/yapily/sync")
async def yapily_sync_all(user: dict = Depends(current_user)):
    uid = user["email"]
    consents = await yapily_consents_col.find({"user_id": uid, "status": "AUTHORIZED"}).to_list(None)
    for c in consents:
        asyncio.create_task(_sync_yapily_consent(c["_id"], uid))
    return {"message": f"Syncing {len(consents)} Yapily connections"}


@app.delete("/yapily/connections/{consent_token}")
async def yapily_delete_connection(consent_token: str, user: dict = Depends(current_user)):
    uid = user["email"]
    doc = await yapily_consents_col.find_one({"_id": consent_token, "user_id": uid})
    if not doc:
        raise HTTPException(404, "Not found")
    accs = await yapily_accounts_col.find({"consent": consent_token, "user_id": uid}).to_list(None)
    for acc in accs:
        await yapily_transactions_col.delete_many({"account_id": acc["_id"]})
        await yapily_accounts_col.delete_one({"_id": acc["_id"]})
    await yapily_consents_col.delete_one({"_id": consent_token})
    return {"deleted": consent_token}


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
                    "model": "google/gemini-2.5-flash",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                },
            )
        resp_data = r.json()
        if r.status_code != 200 or "choices" not in resp_data:
            err = resp_data.get("error", {})
            msg = err.get("message", str(resp_data)) if isinstance(err, dict) else str(err)
            raise ValueError(f"OpenRouter error ({r.status_code}): {msg}")
        raw = resp_data["choices"][0]["message"]["content"].strip()
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
    """Parse any bank statement (UK, Kenya, etc.).
    Returns: {bank_name, account_number, currency, closing_balance, transactions: [{ref, date, type, amount, description, balance}]}
    """
    prompt = (
        "You are a financial data extraction assistant for bank statements.\n"
        "Analyze this bank statement text and return ONLY a single valid JSON object — "
        "no markdown fences, no explanation.\n\n"
        "The object must use this exact schema:\n"
        "{\n"
        '  "bank_name": "<bank name as printed, e.g. Barclays, HSBC, Monzo, Lloyds, NatWest, Revolut, Chase, M-Pesa, Equity Bank, KCB>",\n'
        '  "account_number": "<the primary account number, IBAN, or phone number — digits and hyphens only, no spaces>",\n'
        '  "currency": "<ISO code, e.g. GBP, USD, KES>",\n'
        '  "closing_balance": <the final closing balance as a signed number — negative for overdrafts/credit card debt, positive for assets. null if not found>,\n'
        '  "transactions": [\n'
        "    {\n"
        '      "ref": "<receipt / reference / cheque number, or null if absent>",\n'
        '      "date": "<ISO 8601 datetime, e.g. 2024-03-15T14:30:00>",\n'
        '      "type": "<credit or debit>",\n'
        '      "amount": <positive number>,\n'
        '      "description": "<full narration>",\n'
        '      "balance": <running balance after transaction as signed number, or null>\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- credit = money received / deposited into the account\n"
        "- debit = money sent / withdrawn / paid out\n"
        "- closing_balance is signed: -463.45 means the account is overdrawn by £463.45\n"
        "- If ref is absent or unclear, set it to null (NOT a generated string)\n"
        "- Ignore header rows, footers, totals, and non-transaction lines\n"
        "- Do NOT include closing/opening balance summary rows as transactions\n"
        "- Extract ALL real transactions in the statement\n\n"
        "STATEMENT TEXT:\n" + text[:14000]
    )
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
                json={"model": "google/gemini-2.5-flash", "messages": [{"role": "user", "content": prompt}], "temperature": 0},
            )
        resp_data = r.json()
        if r.status_code != 200 or "choices" not in resp_data:
            err = resp_data.get("error", {})
            msg = err.get("message", str(resp_data)) if isinstance(err, dict) else str(err)
            raise ValueError(f"OpenRouter error ({r.status_code}): {msg}")
        raw = resp_data["choices"][0]["message"]["content"].strip()
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


async def _llm_parse_investment_statement(text: str) -> dict:
    """Extract holdings from an investment/ISA/SIPP statement PDF via LLM."""
    prompt = (
        "You are a financial data extraction assistant. Below is raw text from an investment account statement "
        "(e.g. Vanguard ISA, Wealthify, Hargreaves Lansdown, Fidelity, AJ Bell, etc.).\n"
        "Return ONLY a single valid JSON object — no markdown fences, no explanation.\n\n"
        "Required schema:\n"
        "{\n"
        '  "provider": "<e.g. Vanguard, Wealthify, Hargreaves Lansdown>",\n'
        '  "account_type": "<e.g. ISA, GIA, SIPP, Pension, Stocks and Shares ISA>",\n'
        '  "account_reference": "<the plan/account reference number>",\n'
        '  "statement_date": "<ISO date of statement end date, e.g. 2026-06-04>",\n'
        '  "currency": "<ISO code, e.g. GBP>",\n'
        '  "total_value": <total portfolio value as a number>,\n'
        '  "holdings": [\n'
        "    {\n"
        '      "name": "<full fund/ETF/stock name>",\n'
        '      "isin": "<ISIN code if present, else null>",\n'
        '      "type": "<Fund, ETF, Share, Bond, Infrastructure, Property, Cash>",\n'
        '      "units": <units/shares held as number, or null>,\n'
        '      "price_per_unit": <price per unit in statement currency, or null>,\n'
        '      "value": <total value of this holding as a number>\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- Include cash holdings if they have a non-zero value.\n"
        "- total_value should be the closing portfolio value shown in the statement.\n"
        "- If units or price_per_unit are not present, set them to null.\n"
        "- Extract ALL holdings shown in the statement.\n\n"
        "STATEMENT TEXT:\n" + text[:15000]
    )
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
                json={"model": "google/gemini-2.5-flash", "messages": [{"role": "user", "content": prompt}], "temperature": 0},
            )
        resp_data = r.json()
        if r.status_code != 200 or "choices" not in resp_data:
            err = resp_data.get("error", {})
            msg = err.get("message", str(resp_data)) if isinstance(err, dict) else str(err)
            raise ValueError(f"OpenRouter error ({r.status_code}): {msg}")
        raw = resp_data["choices"][0]["message"]["content"].strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw.strip())
        if not isinstance(parsed, dict) or "holdings" not in parsed:
            raise ValueError("LLM response missing required keys")
        return parsed
    except Exception as e:
        raise HTTPException(422, f"LLM investment parsing failed: {e}")


# ── Investment Accounts ───────────────────────────────────────────────────────

@app.get("/investment/accounts")
async def get_investment_accounts(user: dict = Depends(current_user)):
    uid = user["email"]
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


@app.post("/investment/upload")
async def investment_upload(
    file: UploadFile,
    password: str = Form(default=""),
    user: dict = Depends(current_user),
):
    """Parse an investment statement PDF and store holdings. Re-uploading the same account replaces holdings."""
    uid = user["email"]
    content = await file.read()
    filename = (file.filename or "").lower()

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

    parsed            = await _llm_parse_investment_statement(raw_text)
    provider          = str(parsed.get("provider") or "Unknown")
    account_type      = str(parsed.get("account_type") or "")
    account_reference = str(parsed.get("account_reference") or "")
    currency          = str(parsed.get("currency") or "GBP")
    total_value       = float(parsed.get("total_value") or 0)
    statement_date_str = parsed.get("statement_date")
    holdings          = parsed.get("holdings", [])

    provider_slug = re.sub(r"[^a-z0-9]", "", provider.lower())
    ref_slug      = re.sub(r"[^a-z0-9]", "", account_reference.lower())[:12]
    if ref_slug:
        acc_id = f"inv-{uid}-{provider_slug}-{ref_slug}"
    else:
        acc_id = f"inv-{uid}-{provider_slug}-{hashlib.sha256(uid.encode()).hexdigest()[:8]}"

    try:
        statement_date = datetime.fromisoformat(statement_date_str) if statement_date_str else datetime.now()
    except (ValueError, TypeError):
        statement_date = datetime.now()

    await investment_accounts_col.update_one(
        {"_id": acc_id},
        {"$set": {
            "user_id":           uid,
            "provider":          provider,
            "account_type":      account_type,
            "account_reference": account_reference,
            "currency":          currency,
            "total_value":       total_value,
            "statement_date":    statement_date,
            "updated_at":        datetime.now(),
        }},
        upsert=True,
    )

    # Replace holdings on re-upload so stale positions are removed
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
                    "account_id":      acc_id,
                    "user_id":         uid,
                    "name":            name,
                    "isin":            h.get("isin"),
                    "type":            str(h.get("type") or "Fund"),
                    "units":           h.get("units"),
                    "price_per_unit":  h.get("price_per_unit"),
                    "statement_value": val,
                    "current_price":   None,
                    "current_value":   None,
                    "last_refreshed":  None,
                }},
                upsert=True,
            )
            holdings_saved += 1

    return {
        "account_id":        acc_id,
        "provider":          provider,
        "account_type":      account_type,
        "account_reference": account_reference,
        "total_value":       total_value,
        "holdings_count":    holdings_saved,
    }


@app.get("/investment/accounts/{account_id}/holdings")
async def get_investment_holdings(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    acc = await investment_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Investment account not found")
    holdings = await investment_holdings_col.find({"account_id": account_id}).to_list(None)
    return [
        {
            "id":              h["_id"],
            "name":            h.get("name"),
            "isin":            h.get("isin"),
            "type":            h.get("type", "Fund"),
            "units":           h.get("units"),
            "price_per_unit":  h.get("price_per_unit"),
            "statement_value": h.get("statement_value", 0),
            "current_price":   h.get("current_price"),
            "current_value":   h.get("current_value"),
            "last_refreshed":  h.get("last_refreshed").isoformat() if h.get("last_refreshed") else None,
        }
        for h in holdings
    ]


@app.delete("/investment/accounts/{account_id}")
async def delete_investment_account(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    acc = await investment_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Investment account not found")
    await investment_holdings_col.delete_many({"account_id": account_id})
    await investment_accounts_col.delete_one({"_id": account_id})
    return {"deleted": account_id}


@app.post("/investment/accounts/{account_id}/refresh")
async def refresh_investment_prices(account_id: str, user: dict = Depends(current_user)):
    """Use Tavily search + LLM to fetch current unit prices and update holding values."""
    uid = user["email"]
    acc = await investment_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Investment account not found")
    if not TAVILY_API_KEY:
        raise HTTPException(422, "Tavily API key not configured — add TAVILY_API_KEY to backend/.env")

    holdings = await investment_holdings_col.find({"account_id": account_id}).to_list(None)
    updated_count = 0
    new_total = 0.0

    async with httpx.AsyncClient(timeout=60) as client:
        for h in holdings:
            name  = h.get("name", "")
            isin  = h.get("isin")
            units = h.get("units")
            stmt_val = h.get("statement_value", 0)

            query = f"{isin} fund unit price GBP" if isin else f"{name} fund unit price GBP today"
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

                snippets = "\n\n".join(
                    f"Source: {res.get('url', '')}\n{res.get('content', '')[:500]}"
                    for res in results[:3]
                )
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

                price_raw = lr.json()["choices"][0]["message"]["content"].strip().strip("`").strip()
                try:
                    current_price = float(price_raw) if price_raw.lower() != "null" else None
                except ValueError:
                    current_price = None

                current_value = round(units * current_price, 2) if units and current_price else None
                await investment_holdings_col.update_one(
                    {"_id": h["_id"]},
                    {"$set": {
                        "current_price":  current_price,
                        "current_value":  current_value,
                        "last_refreshed": datetime.now(),
                    }},
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

    # Reject M-PESA / KES statements when user is in UK region
    user_region = await get_user_region(uid)
    is_mpesa = "mpesa" in bank_name.lower() or "m-pesa" in bank_name.lower() or currency == "KES"
    if user_region != "Kenya" and is_mpesa:
        raise HTTPException(
            422,
            "M-PESA / KES statements can only be uploaded in Kenya region. "
            "Switch your region to Kenya in Settings to upload this statement.",
        )

    if not isinstance(rows, list):
        raise HTTPException(422, "LLM did not return a transactions list")

    # Prefer the top-level closing_balance the LLM was explicitly asked for
    raw_closing = parsed.get("closing_balance")
    try:
        closing_balance: float | None = float(raw_closing) if raw_closing is not None else None
    except (TypeError, ValueError):
        closing_balance = None

    slug        = _bank_slug(bank_name)
    acct_digits = re.sub(r"\D", "", account_number)
    acct_suffix = acct_digits[-8:] if len(acct_digits) >= 4 else hashlib.sha256(f"{uid}|{slug}".encode()).hexdigest()[:8]
    acc_id      = f"statement-{uid}-{slug}-{acct_suffix}"
    acc_name    = f"{bank_name} ••{acct_suffix[-4:]}"

    imported = 0
    skipped  = 0
    # Track the balance from the chronologically latest transaction that has one
    latest_balance: float | None = None
    latest_balance_date: datetime | None = None

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
                bal_f = float(bal)
                # Keep balance from the chronologically latest transaction
                if latest_balance_date is None or txn_date >= latest_balance_date:
                    latest_balance = bal_f
                    latest_balance_date = txn_date
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

    # Resolve balance: prefer explicit closing_balance, fall back to per-row balance
    resolved_balance = closing_balance if closing_balance is not None else latest_balance

    # Only update the stored balance if this statement's data is newer than what's stored
    # (prevents older statement uploads from overwriting a more recent balance)
    existing = await statement_accounts_col.find_one({"_id": acc_id}, {"balance_date": 1, "balance": 1})
    stored_balance_date: datetime | None = existing.get("balance_date") if existing else None
    this_statement_date = latest_balance_date or datetime.now()

    should_update_balance = (
        resolved_balance is not None and
        (stored_balance_date is None or this_statement_date >= stored_balance_date)
    )

    account_update: dict = {
        "_id":            acc_id,
        "user_id":        uid,
        "name":           acc_name,
        "type":           "bank",
        "currency":       currency,
        "provider":       slug.upper(),
        "account_number": account_number,
        "region":         region,
        "status":         "connected",
        "updated_at":     datetime.now(),
    }
    if should_update_balance:
        account_update["balance"] = resolved_balance
        account_update["balance_date"] = this_statement_date
    elif existing is None:
        # New account with no balance data yet
        account_update["balance"] = 0

    # Upsert stable account record
    await statement_accounts_col.update_one(
        {"_id": acc_id},
        {"$set": account_update},
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


# ── Weekly Challenges (3-tier: easy daily / medium weekly / stretch weekly) ────

# Allowlist of categories eligible for tier challenges (regular, non-essential, recurring)
CHALLENGE_CATS = {"Eating Out", "Entertainment", "Shopping", "Groceries", "Transport", "Subscriptions"}
CHALLENGE_EXCL = {"Transfer", "Savings", "Debt", "Income", "Bills", "Utilities"}  # kept for budget adherence exclusion

def _week_bounds():
    now = datetime.utcnow()
    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    week_end = week_start + timedelta(days=6, hours=23, minutes=59, seconds=59)
    return week_start, week_end

def _day_bounds():
    now = datetime.utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(hours=23, minutes=59, seconds=59)
    return day_start, day_end

async def _get_debit_txns_challenge(uid: str, since: datetime) -> list:
    region = await get_user_region(uid)
    if region == "Kenya":
        return await _get_kenya_transactions(uid, since)
    tl  = await transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": since}}).to_list(None)
    yap = await yapily_transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": since}}).to_list(None)
    return tl + yap

async def _resolve_stale_challenges(uid: str):
    now = datetime.utcnow()
    stale = await challenges_col.find({"uid": uid, "status": "active", "period_end": {"$lt": now}}).to_list(None)
    for ch in stale:
        txns = await _get_debit_txns_challenge(uid, ch["period_start"])
        cat = ch["category"]
        actual = sum(
            t["amount"] for t in txns
            if (t.get("custom_category") or t.get("category")) == cat
            and ch["period_start"] <= t.get("date", datetime.min) <= ch["period_end"]
        )
        status = "completed" if actual <= ch["target"] else "failed"
        update: dict = {"status": status, "actual": round(actual, 2)}
        # Budget adherence: tiered XP based on how far under budget
        if ch.get("tier") == "budget" and status == "completed" and ch["target"] > 0:
            ratio = actual / ch["target"]
            update["xp_reward"] = 60 if ratio <= 0.5 else 40 if ratio <= 0.75 else 20
        await challenges_col.update_one({"_id": ch["_id"]}, {"$set": update})

async def _get_challenge_stats(uid: str) -> dict:
    history = await challenges_col.find(
        {"uid": uid, "status": {"$in": ["completed", "failed"]}}
    ).sort("period_start", -1).to_list(None)
    total_xp = sum(ch["xp_reward"] for ch in history if ch["status"] == "completed")
    level = total_xp // 300 + 1
    xp_in_level = total_xp % 300
    # Streak = consecutive weeks where at least medium was completed
    seen_weeks: dict[str, dict] = {}
    for ch in history:
        wk = ch["period_start"].strftime("%Y-W%W") if ch["cadence"] == "weekly" else None
        if wk:
            seen_weeks.setdefault(wk, {})
            if ch["status"] == "completed":
                seen_weeks[wk][ch["tier"]] = True
    streak = 0
    for wk in sorted(seen_weeks.keys(), reverse=True):
        if seen_weeks[wk].get("medium") or seen_weeks[wk].get("stretch"):
            streak += 1
        else:
            break
    return {
        "total_xp": total_xp, "level": level,
        "xp_in_level": xp_in_level, "xp_per_level": 300,
        "streak": streak,
        "completed": sum(1 for ch in history if ch["status"] == "completed"),
        "failed": sum(1 for ch in history if ch["status"] == "failed"),
    }

async def _generate_all_challenges(uid: str) -> list[dict]:
    """Generate easy (daily) + medium + stretch (weekly) challenges if not already created."""
    week_start, week_end = _week_bounds()
    day_start, day_end = _day_bounds()
    region = await get_user_region(uid)
    currency = "KES" if region == "Kenya" else "GBP"
    min_weekly = 500 if region == "Kenya" else 5

    # Load raw transactions for last 4 weeks (exclude current period)
    four_weeks_ago = week_start - timedelta(days=28)
    raw_txns = await _get_debit_txns_challenge(uid, four_weeks_ago)
    hist_txns = [t for t in raw_txns if t.get("date", datetime.min) < week_start]

    # Spending totals + daily frequency — only allowlisted regular categories
    cat_totals: dict[str, float] = {}
    cat_days: dict[str, set] = {}
    for t in hist_txns:
        cat = t.get("custom_category") or t.get("category") or "Other"
        if cat not in CHALLENGE_CATS:
            continue
        cat_totals[cat] = cat_totals.get(cat, 0) + t["amount"]
        cat_days.setdefault(cat, set()).add(t.get("date", datetime.min).date())

    # Rank by weekly average spend
    ranked = sorted(
        [(cat, total / 4) for cat, total in cat_totals.items() if total / 4 >= min_weekly],
        key=lambda x: -x[1]
    )

    new_docs: list[dict] = []

    # ── Easy: daily goal on the most frequently purchased category ──
    existing_easy = await challenges_col.find_one({"uid": uid, "tier": "easy", "period_start": day_start})
    if not existing_easy and ranked:
        # Prefer category with most spend days (frequent small purchases); fallback to top spend
        daily_ranked = sorted(
            [(cat, w) for cat, w in ranked if len(cat_days.get(cat, set())) >= 5],
            key=lambda x: -len(cat_days.get(x[0], set()))
        )
        easy_cat, easy_baseline_wk = (daily_ranked[0] if daily_ranked else ranked[-1])  # least spend = easiest weekly
        daily_baseline = easy_baseline_wk / 7
        daily_target = round(daily_baseline * 0.85, 2)  # 15% under daily average
        easy = {
            "_id": str(uuid_lib.uuid4()), "uid": uid, "tier": "easy",
            "cadence": "daily", "title": f"Keep {easy_cat} under budget today",
            "category": easy_cat, "baseline": round(daily_baseline, 2),
            "target": daily_target, "reduction_pct": 0.15, "currency": currency,
            "xp_reward": 20, "period_start": day_start, "period_end": day_end,
            "status": "active", "actual": None, "created_at": datetime.utcnow(),
        }
        await challenges_col.insert_one(easy)
        new_docs.append(easy)

    # ── Medium: weekly goal on 2nd highest category ──
    existing_medium = await challenges_col.find_one({"uid": uid, "tier": "medium", "period_start": week_start})
    if not existing_medium and len(ranked) >= 1:
        med_cat, med_wk = ranked[min(1, len(ranked) - 1)]  # 2nd or top if only 1
        med_target = round(med_wk * 0.80, 2)  # 20% reduction
        medium = {
            "_id": str(uuid_lib.uuid4()), "uid": uid, "tier": "medium",
            "cadence": "weekly", "title": f"Cut {med_cat} spending by 20% this week",
            "category": med_cat, "baseline": round(med_wk, 2),
            "target": med_target, "reduction_pct": 0.20, "currency": currency,
            "xp_reward": 75, "period_start": week_start, "period_end": week_end,
            "status": "active", "actual": None, "created_at": datetime.utcnow(),
        }
        await challenges_col.insert_one(medium)
        new_docs.append(medium)

    # ── Stretch: weekly goal on top category, 35% cut ──
    existing_stretch = await challenges_col.find_one({"uid": uid, "tier": "stretch", "period_start": week_start})
    if not existing_stretch and len(ranked) >= 1:
        str_cat, str_wk = ranked[0]
        str_target = round(str_wk * 0.65, 2)  # 35% reduction
        stretch = {
            "_id": str(uuid_lib.uuid4()), "uid": uid, "tier": "stretch",
            "cadence": "weekly", "title": f"Slash {str_cat} spending by 35% this week",
            "category": str_cat, "baseline": round(str_wk, 2),
            "target": str_target, "reduction_pct": 0.35, "currency": currency,
            "xp_reward": 150, "period_start": week_start, "period_end": week_end,
            "status": "active", "actual": None, "created_at": datetime.utcnow(),
        }
        await challenges_col.insert_one(stretch)
        new_docs.append(stretch)

    return new_docs

async def _compute_progress(ch: dict, all_txns: list) -> dict:
    cat = ch["category"]
    actual_so_far = sum(
        t["amount"] for t in all_txns
        if (t.get("custom_category") or t.get("category")) == cat
        and t.get("date", datetime.min) >= ch["period_start"]
    )
    now = datetime.utcnow()
    if ch["cadence"] == "daily":
        remaining_label = "today"
        hours_left = max(0, int((ch["period_end"] - now).total_seconds() / 3600))
        time_left = f"{hours_left}h left"
    else:
        days_left = max(0, (ch["period_end"] - now).days)
        time_left = f"{days_left}d left"
    pct_used = min(1.0, actual_so_far / ch["target"]) if ch["target"] > 0 else 0.0
    return {
        "actual_so_far": round(actual_so_far, 2),
        "target": ch["target"],
        "pct_used": round(pct_used * 100, 1),
        "on_track": actual_so_far <= ch["target"],
        "time_left": time_left,
    }

def _fmt_challenge(ch: dict, progress: dict | None = None) -> dict:
    out = {
        "id": ch["_id"], "tier": ch["tier"], "cadence": ch["cadence"],
        "title": ch["title"], "category": ch["category"],
        "baseline": ch["baseline"], "target": ch["target"],
        "reduction_pct": ch["reduction_pct"], "currency": ch["currency"],
        "xp_reward": ch["xp_reward"],
        "period_start": ch["period_start"].isoformat(),
        "period_end": ch["period_end"].isoformat(),
        "status": ch["status"], "actual": ch.get("actual"),
    }
    if progress is not None:
        out["progress"] = progress
    return out

async def _generate_budget_adherence_challenges(uid: str) -> None:
    """One weekly 'stay within budget' challenge per non-planned budgeted category."""
    week_start, week_end = _week_bounds()
    region = await get_user_region(uid)
    currency = "KES" if region == "Kenya" else "GBP"

    budget_doc = await budgets_col.find_one({"user_id": uid, "region": region})
    if not budget_doc:
        return

    for b in budget_doc.get("budgets", []):
        cat = b.get("category", "")
        if not cat or b.get("planned", False) or cat in CHALLENGE_EXCL:
            continue
        existing = await challenges_col.find_one(
            {"uid": uid, "tier": "budget", "category": cat, "period_start": week_start}
        )
        if existing:
            continue
        weekly_target = round(b["monthly_limit"] / 4, 2)
        await challenges_col.insert_one({
            "_id": str(uuid_lib.uuid4()),
            "uid": uid,
            "tier": "budget",
            "cadence": "weekly",
            "title": f"Stay within your {cat} budget this week",
            "category": cat,
            "baseline": round(b["monthly_limit"], 2),
            "target": weekly_target,
            "reduction_pct": 0.0,
            "currency": currency,
            "xp_reward": 20,  # updated to tiered value at resolution
            "period_start": week_start,
            "period_end": week_end,
            "status": "active",
            "actual": None,
            "created_at": datetime.utcnow(),
        })


@app.get("/challenges")
async def get_challenges(user: dict = Depends(current_user)):
    uid = user["email"]
    await _resolve_stale_challenges(uid)

    # Generate any missing challenges for today/this week
    await _generate_all_challenges(uid)
    await _generate_budget_adherence_challenges(uid)

    stats = await _get_challenge_stats(uid)

    # Load all active challenges (only new-schema docs that have period_start)
    active = await challenges_col.find({"uid": uid, "status": "active", "period_start": {"$exists": True}}).to_list(None)

    # Compute progress for active challenges
    if active:
        earliest = min(ch["period_start"] for ch in active)
        all_txns = await _get_debit_txns_challenge(uid, earliest)
    else:
        all_txns = []

    tier_order = ["easy", "medium", "stretch"]
    tier_challenges = []
    budget_challenges = []
    for ch in sorted(
        [c for c in active if c.get("tier") in ("easy", "medium", "stretch")],
        key=lambda c: tier_order.index(c.get("tier", "easy"))
    ):
        progress = await _compute_progress(ch, all_txns)
        tier_challenges.append(_fmt_challenge(ch, progress))

    for ch in sorted(
        [c for c in active if c.get("tier") == "budget"],
        key=lambda c: c.get("category", "")
    ):
        progress = await _compute_progress(ch, all_txns)
        budget_challenges.append(_fmt_challenge(ch, progress))

    # History — last 15 resolved, newest first
    history_docs = await challenges_col.find(
        {"uid": uid, "status": {"$in": ["completed", "failed"]}, "tier": {"$in": ["easy", "medium", "stretch"]}}
    ).sort("period_start", -1).limit(15).to_list(None)

    return {
        "stats": stats,
        "challenges": tier_challenges,
        "budget_challenges": budget_challenges,
        "history": [_fmt_challenge(ch) for ch in history_docs],
    }



# ── Savings Insights ─────────────────────────────────────────────────────────

INSIGHT_CATEGORIES: dict[str, dict] = {
    "energy": {
        "icon": "⚡",
        "label": "Energy",
        "query": "best energy tariff switch UK 2025 cheapest deals save money",
        "triggers": ["british gas", "eon ", "edf", "scottish power", "octopus energy", "npower", "sse ", "bulb energy", "shell energy", "utilita", "utility warehouse", "bg energy"],
    },
    "mortgage": {
        "icon": "🏠",
        "label": "Mortgage",
        "query": "best mortgage remortgage deals UK 2025 lowest fixed rate switch lender",
        "triggers": ["mortgage", "nationwide", "halifax", "santander mortgage", "barclays mortgage", "lloyds mortgage", "natwest mortgage", "hsbc mortgage", "virgin money mortgage", "mortg"],
    },
    "car_finance": {
        "icon": "🚘",
        "label": "Car Finance",
        "query": "refinance car loan UK 2025 best rate save money PCP HP alternatives",
        "triggers": ["black horse", "close brothers", "moneybarn", "evolution funding", "motonovo", "car loan", "car finance", "hire purchase", "santander consumer", "toyota finance", "volkswagen finance"],
    },
    "car_insurance": {
        "icon": "🚗",
        "label": "Car Insurance",
        "query": "cheapest car insurance deals UK 2025 comparison save",
        "triggers": ["direct line", "admiral", "aviva", "hastings direct", "churchill", "more than", "lv= ", "esure", "elephant auto"],
    },
    "broadband": {
        "icon": "📡",
        "label": "Broadband",
        "query": "best broadband deals UK 2025 switch provider save money",
        "triggers": ["bt ", "bt group", "virgin media", "sky broadband", "talktalk", "vodafone broadband", "now broadband", "plusnet", "community fibre", "hyperoptic"],
    },
    "mobile": {
        "icon": "📱",
        "label": "Mobile",
        "query": "best SIM only mobile plan UK 2025 cheapest deal",
        "triggers": ["ee ltd", "ee limited", "ee ", "o2 ", "vodafone", "three ", "giffgaff", "sky mobile", "tesco mobile", "id mobile", "lycamobile"],
    },
    "groceries": {
        "icon": "🛒",
        "label": "Groceries",
        "query": "cheapest UK supermarket comparison 2025 where to shop save groceries",
        "triggers": ["tesco", "sainsbury", "asda", "morrisons", "waitrose", "lidl", "aldi", "co-op", "marks and spencer food", "ocado", "m&s food"],
    },
    "eating_out": {
        "icon": "🍽️",
        "label": "Eating Out",
        "query": "restaurant dining offers discounts UK 2025 deals save money eating out",
        "triggers": ["restaurant", "mcdonald", "kfc", "nando", "wagamama", "pizza express", "prezzo", "costa coffee", "starbucks", "pret a manger", "itsu", "leon ", "subway"],
    },
    "gym": {
        "icon": "💪",
        "label": "Gym",
        "query": "best value gym membership UK 2025 cheapest monthly no contract",
        "triggers": ["pure gym", "the gym group", "david lloyd", "virgin active", "anytime fitness", "nuffield health", "fitness first", "bannatyne", "everyone active"],
    },
    "subscriptions": {
        "icon": "📺",
        "label": "Subscriptions",
        "query": "how to save on streaming subscriptions UK 2025 cheaper alternatives deals",
        "triggers": ["netflix", "spotify", "amazon prime", "disney+", "disney plus", "apple tv", "youtube premium", "now tv", "sky entertainment", "paramount+", "apple music"],
    },
}

# Categories the user can assign to unidentified bills (superset of auto-detectable ones)
LABEL_OPTIONS: dict[str, dict] = {
    **{k: {"icon": v["icon"], "label": v["label"]} for k, v in INSIGHT_CATEGORIES.items()},
    "home_insurance":  {"icon": "🛡️", "label": "Home Insurance"},
    "life_insurance":  {"icon": "❤️",  "label": "Life Insurance"},
    "council_tax":     {"icon": "🏛️",  "label": "Council Tax"},
    "water":           {"icon": "💧",  "label": "Water"},
    "tv_licence":      {"icon": "📻",  "label": "TV Licence"},
    "pension":         {"icon": "🏦",  "label": "Pension/Savings"},
}


async def _detect_insight_categories(user_id: str) -> list[str]:
    """Return which INSIGHT_CATEGORIES apply based on last 90 days of transactions."""
    cutoff = datetime.now() - timedelta(days=90)

    # Gather from all transaction collections
    pipelines = [
        transactions_col.find({"user_id": user_id, "date": {"$gte": cutoff}}, {"merchant_name": 1, "description": 1, "category": 1}).to_list(None),
        yapily_transactions_col.find({"user_id": user_id, "date": {"$gte": cutoff}}, {"merchant_name": 1, "description": 1, "category": 1}).to_list(None),
        mono_transactions_col.find({"user_id": user_id, "date": {"$gte": cutoff}}, {"merchant_name": 1, "description": 1, "category": 1}).to_list(None),
        statement_transactions_col.find({"user_id": user_id, "date": {"$gte": cutoff}}, {"merchant_name": 1, "description": 1, "category": 1}).to_list(None),
    ]
    all_lists = await asyncio.gather(*pipelines, return_exceptions=True)

    text_parts = []
    for lst in all_lists:
        if isinstance(lst, list):
            for t in lst:
                text_parts.append(f"{t.get('merchant_name', '')} {t.get('description', '')} {t.get('category', '')}".lower())
    all_text = " ".join(text_parts)

    detected = [k for k, cfg in INSIGHT_CATEGORIES.items() if any(trigger in all_text for trigger in cfg["triggers"])]

    # Also include categories the user has explicitly labelled
    labels = await savings_labels_col.find(
        {"user_id": user_id, "category": {"$in": list(INSIGHT_CATEGORIES.keys())}}
    ).to_list(None)
    for lbl in labels:
        if lbl["category"] not in detected:
            detected.append(lbl["category"])

    return detected


async def _generate_savings_insight_content(category_key: str, user_context: Optional[dict] = None) -> Optional[dict]:
    """Tavily search + Haiku summarise → returns {title, body, savings_estimate} or None."""
    cfg = INSIGHT_CATEGORIES[category_key]

    web_snippets: list[str] = []
    if TAVILY_API_KEY:
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                r = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": TAVILY_API_KEY,
                        "query": cfg["query"],
                        "search_depth": "basic",
                        "max_results": 3,
                        "include_answer": True,
                    },
                )
                if r.status_code == 200:
                    data = r.json()
                    if data.get("answer"):
                        web_snippets.append(data["answer"][:500])
                    for res in (data.get("results") or [])[:2]:
                        snippet = res.get("content", "")[:250]
                        if snippet:
                            web_snippets.append(snippet)
            except Exception:
                pass

    if not web_snippets or not OPENROUTER_API_KEY:
        return None

    web_text = "\n\n".join(web_snippets)
    if user_context:
        ctx_lines = "\n".join(
            f"- {k.replace('_', ' ').title()}: {v}"
            for k, v in user_context.items() if v
        )
        prompt = (
            f"Based on these UK search results about {cfg['label']} savings:\n\n{web_text}\n\n"
            f"The user's current {cfg['label'].lower()} situation:\n{ctx_lines}\n\n"
            "Write a HIGHLY PERSONALISED savings insight. Reference their specific rate, provider, amount or end date where relevant. "
            "Give concrete next steps they should take right now.\n"
            "JSON: title (max 8 words, specific to their situation), "
            "body (2–3 sentences, direct advice referencing their details), "
            "savings_estimate (calculate from their numbers if possible, else null)\n\n"
            'Respond ONLY with valid JSON: {"title":"...","body":"...","savings_estimate":"..."}'
        )
    else:
        prompt = (
            f"Based on these UK search results about {cfg['label']} savings:\n\n{web_text}\n\n"
            "Write a concise savings insight card in JSON with three fields:\n"
            "- title: max 8 words, punchy, present tense\n"
            "- body: 1–2 sentences, specific deal or tip, no filler\n"
            "- savings_estimate: e.g. 'Up to £200/yr' or 'Save 30%' if clearly stated, else null\n\n"
            'Respond ONLY with valid JSON: {"title":"...","body":"...","savings_estimate":"..."}'
        )

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": APP_URL},
                json={
                    "model": "anthropic/claude-haiku-4-5",
                    "max_tokens": 200,
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                },
            )
            if r.status_code == 200:
                raw = r.json()["choices"][0]["message"]["content"].strip()
                # Strip markdown code fences that some models add despite json_object mode
                if raw.startswith("```"):
                    raw = re.sub(r'^```(?:json)?\s*', '', raw)
                    raw = re.sub(r'\s*```$', '', raw).strip()
                parsed = json.loads(raw)
                return {
                    "title": str(parsed.get("title", cfg["label"])),
                    "body": str(parsed.get("body", "")),
                    "savings_estimate": parsed.get("savings_estimate") or None,
                }
        except Exception:
            pass
    return None


async def _refresh_savings_insights_for_user(user_id: str) -> None:
    """Detect applicable categories, search web, summarise with Haiku, upsert into MongoDB."""
    applicable = await _detect_insight_categories(user_id)

    # Always include energy and groceries as universal tips even without matching transactions
    for cat in ("energy", "groceries"):
        if cat not in applicable:
            applicable.append(cat)

    for cat_key in applicable:
        cfg = INSIGHT_CATEGORIES.get(cat_key)
        if not cfg:
            continue

        # Skip if refreshed in last 7 days (avoid hammering Tavily)
        existing = await savings_insights_col.find_one({"user_id": user_id, "category": cat_key})
        if existing and existing.get("refreshed_at"):
            age_days = (datetime.now() - existing["refreshed_at"]).days
            if age_days < 7:
                continue

        stored_context = existing.get("user_context") if existing else None
        content = await _generate_savings_insight_content(cat_key, stored_context)
        if not content or not content.get("body"):
            continue

        triggered_by = await _find_triggered_transactions(user_id, cat_key)
        title = content["title"]
        body = content["body"]
        savings_estimate = content.get("savings_estimate")
        content_hash = hashlib.md5(f"{title}{body}".encode()).hexdigest()
        now = datetime.now()
        is_new = not existing or existing.get("content_hash") != content_hash

        if existing:
            update: dict = {
                "title": title, "body": body,
                "savings_estimate": savings_estimate,
                "triggered_by": triggered_by,
                "refreshed_at": now, "content_hash": content_hash, "is_new": is_new,
            }
            if not existing.get("pinned"):
                update["expires_at"] = now + timedelta(days=30)
            await savings_insights_col.update_one({"_id": existing["_id"]}, {"$set": update})
        else:
            insight_id = f"{cat_key}-{hashlib.md5(user_id.encode()).hexdigest()[:8]}"
            await savings_insights_col.insert_one({
                "insight_id": insight_id, "user_id": user_id,
                "category": cat_key, "icon": cfg["icon"], "label": cfg["label"],
                "title": title, "body": body, "savings_estimate": savings_estimate,
                "triggered_by": triggered_by,
                "pinned": False, "created_at": now, "refreshed_at": now,
                "expires_at": now + timedelta(days=30),
                "content_hash": content_hash, "is_new": True,
            })


@app.get("/savings-insights")
async def get_savings_insights(user: dict = Depends(current_user)):
    uid = user["email"]
    docs = await savings_insights_col.find(
        {"user_id": uid},
    ).sort([("pinned", -1), ("refreshed_at", -1)]).to_list(None)

    results = []
    for d in docs:
        # Lazily populate triggered_by for older insights that were created before this field existed
        if not d.get("triggered_by"):
            triggered_by = await _find_triggered_transactions(uid, d["category"])
            if triggered_by:
                await savings_insights_col.update_one({"_id": d["_id"]}, {"$set": {"triggered_by": triggered_by}})
                d["triggered_by"] = triggered_by

        results.append({
            "id": d.get("insight_id", str(d["_id"])),
            "category": d["category"],
            "icon": d.get("icon", "💡"),
            "label": d.get("label", d["category"].replace("_", " ").title()),
            "title": d.get("title", ""),
            "body": d.get("body", ""),
            "savings_estimate": d.get("savings_estimate"),
            "pinned": d.get("pinned", False),
            "is_new": d.get("is_new", False),
            "refreshed_at": d["refreshed_at"].isoformat() if d.get("refreshed_at") else None,
            "triggered_by": d.get("triggered_by", []),
            "user_context": d.get("user_context"),
            "has_workflow": d["category"] in CATEGORY_WORKFLOWS,
        })
    return results


@app.get("/savings-insights/workflows")
async def get_workflows(_user: dict = Depends(current_user)):
    return CATEGORY_WORKFLOWS


@app.post("/savings-insights/{insight_id}/context")
async def save_insight_context(
    insight_id: str,
    body: dict,
    background_tasks: BackgroundTasks,
    user: dict = Depends(current_user),
):
    uid = user["email"]
    doc = await savings_insights_col.find_one({"user_id": uid, "insight_id": insight_id})
    if not doc:
        raise HTTPException(404, "Insight not found")
    context = body.get("context", {})
    await savings_insights_col.update_one({"_id": doc["_id"]}, {"$set": {"user_context": context}})
    background_tasks.add_task(_refresh_single_insight, uid, doc["category"], context)
    return {"message": "Saved, regenerating insight"}


@app.patch("/savings-insights/{insight_id}/pin")
async def toggle_pin_insight(insight_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    doc = await savings_insights_col.find_one({"user_id": uid, "insight_id": insight_id})
    if not doc:
        raise HTTPException(404, "Insight not found")
    new_pinned = not doc.get("pinned", False)
    update: dict = {"pinned": new_pinned}
    update["expires_at"] = None if new_pinned else datetime.now() + timedelta(days=30)
    await savings_insights_col.update_one({"_id": doc["_id"]}, {"$set": update})
    return {"pinned": new_pinned}


@app.post("/savings-insights/refresh")
async def trigger_refresh_insights(background_tasks: BackgroundTasks, user: dict = Depends(current_user)):
    uid = user["email"]
    background_tasks.add_task(_refresh_savings_insights_for_user, uid)
    return {"message": "Refresh started"}


CATEGORY_WORKFLOWS: dict[str, dict] = {
    # Only ask for things we CANNOT derive from transactions
    "mortgage": {
        "cta": "Add your mortgage details",
        "steps": [
            {"id": "type",           "label": "Mortgage type",            "type": "select", "options": ["Fixed Rate", "Tracker", "Variable/SVR", "Interest Only", "Not sure"]},
            {"id": "rate",           "label": "Current interest rate",    "type": "number", "placeholder": "e.g. 4.5", "unit": "%"},
            {"id": "outstanding",    "label": "Amount outstanding",       "type": "currency", "placeholder": "e.g. 250000"},
            {"id": "deal_end",       "label": "When does your deal end?", "type": "text",   "placeholder": "e.g. March 2027"},
            {"id": "term_remaining", "label": "Years remaining",          "type": "number", "placeholder": "e.g. 22", "unit": "yrs"},
        ],
    },
    "car_finance": {
        "cta": "Add your finance details",
        "steps": [
            {"id": "type",             "label": "Finance type",        "type": "select", "options": ["Personal Loan", "PCP", "Hire Purchase (HP)", "Lease/PCH", "Not sure"]},
            {"id": "rate",             "label": "Interest rate / APR", "type": "number", "placeholder": "e.g. 6.9", "unit": "%"},
            {"id": "outstanding",      "label": "Amount outstanding",  "type": "currency", "placeholder": "e.g. 8000"},
            {"id": "months_remaining", "label": "Months remaining",    "type": "number", "placeholder": "e.g. 36", "unit": "mo"},
        ],
    },
    "energy": {
        "cta": "Add your energy details",
        "steps": [
            {"id": "tariff_type", "label": "Tariff type",            "type": "select", "options": ["Fixed Rate", "Variable/SVR", "Not sure"]},
            {"id": "deal_end",    "label": "When does your deal end?", "type": "text", "placeholder": "e.g. Oct 2026 or Rolling"},
        ],
    },
    "broadband": {
        "cta": "Add your broadband details",
        "steps": [
            {"id": "contract_end", "label": "Contract end date",  "type": "text",   "placeholder": "e.g. Aug 2026 or Rolling"},
            {"id": "speed",        "label": "Download speed",     "type": "select", "options": ["Under 50 Mbps", "50–100 Mbps", "100–500 Mbps", "500 Mbps+", "Not sure"]},
        ],
    },
    "mobile": {
        "cta": "Add your plan details",
        "steps": [
            {"id": "contract_end", "label": "Contract end date",  "type": "text",   "placeholder": "e.g. Dec 2026 or Rolling"},
            {"id": "data",         "label": "Monthly data usage", "type": "select", "options": ["Under 5 GB", "5–20 GB", "20–50 GB", "50 GB+", "Unlimited"]},
        ],
    },
    "car_insurance": {
        "cta": "Add your insurance details",
        "steps": [
            {"id": "renewal_date", "label": "Renewal date", "type": "text", "placeholder": "e.g. September 2026"},
        ],
    },
    "gym": {
        "cta": "Add your gym details",
        "steps": [
            {"id": "gym_name", "label": "Which gym?",     "type": "text",   "placeholder": "e.g. David Lloyd"},
            {"id": "contract", "label": "Contract type",  "type": "select", "options": ["Monthly rolling", "3-month", "6-month", "12-month", "Not sure"]},
        ],
    },
    "subscriptions": {
        "cta": "Tell us about your subscriptions",
        "steps": [
            {"id": "services", "label": "Which services do you subscribe to?", "type": "text", "placeholder": "e.g. Netflix, Spotify, Disney+"},
        ],
    },
    "groceries": {
        "cta": "Add your shopping habits",
        "steps": [
            {"id": "main_supermarket", "label": "Where do you mostly shop?", "type": "select", "options": ["Tesco", "Sainsbury's", "ASDA", "Morrisons", "Waitrose", "M&S", "Lidl", "Aldi", "Mix of stores"]},
        ],
    },
    "eating_out": {
        "cta": "Add your dining habits",
        "steps": [
            {"id": "frequency", "label": "How often do you eat out?", "type": "select", "options": ["Daily", "2–3× per week", "Once a week", "Few times a month", "Rarely"]},
        ],
    },
}


async def _find_triggered_transactions(user_id: str, category_key: str) -> list[dict]:
    """Find the recurring transactions that triggered this insight category."""
    from collections import defaultdict
    cfg = INSIGHT_CATEGORIES.get(category_key)
    if not cfg:
        return []
    cutoff = datetime.now() - timedelta(days=90)

    # Check for a user label pointing at this category
    label = await savings_labels_col.find_one({"user_id": user_id, "category": category_key})
    labelled_key = label["merchant_key"] if label else None

    buckets: dict[str, list[float]] = defaultdict(list)
    for col in [transactions_col, yapily_transactions_col, statement_transactions_col, mono_transactions_col]:
        try:
            txns = await col.find(
                {"user_id": user_id, "date": {"$gte": cutoff}, "transaction_type": "debit"},
                {"merchant_name": 1, "description": 1, "amount": 1},
            ).to_list(None)
        except Exception:
            continue
        for t in txns:
            key = (t.get("merchant_name") or t.get("description", "")[:30]).strip()
            if not key:
                continue
            key_lower = key.lower()
            if (labelled_key and key == labelled_key) or any(tr in key_lower for tr in cfg.get("triggers", [])):
                buckets[key].append(float(t.get("amount", 0)))

    result = []
    for key, amounts in sorted(buckets.items(), key=lambda x: -sum(x[1])):
        result.append({
            "merchant_key": key,
            "display_name": key.title(),
            "monthly_amount": round(sum(amounts) / 3, 2),
            "occurrences": len(amounts),
        })
        if len(result) >= 4:
            break
    return result


async def _refresh_single_insight(user_id: str, category_key: str, user_context: Optional[dict] = None) -> None:
    """Force-refresh one insight category, bypassing the 7-day throttle."""
    cfg = INSIGHT_CATEGORIES.get(category_key)
    if not cfg:
        return
    # If no context provided, carry forward any stored context
    if user_context is None:
        existing_doc = await savings_insights_col.find_one({"user_id": user_id, "category": category_key})
        user_context = existing_doc.get("user_context") if existing_doc else None
    content = await _generate_savings_insight_content(category_key, user_context)
    if not content or not content.get("body"):
        return
    triggered_by = await _find_triggered_transactions(user_id, category_key)
    title = content["title"]
    body_text = content["body"]
    savings_estimate = content.get("savings_estimate")
    content_hash = hashlib.md5(f"{title}{body_text}".encode()).hexdigest()
    now = datetime.now()
    existing = await savings_insights_col.find_one({"user_id": user_id, "category": category_key})
    is_new = not existing or existing.get("content_hash") != content_hash
    base_update: dict = {
        "title": title, "body": body_text,
        "savings_estimate": savings_estimate,
        "triggered_by": triggered_by,
        "refreshed_at": now, "content_hash": content_hash, "is_new": is_new,
    }
    if user_context is not None:
        base_update["user_context"] = user_context
    if existing:
        if not existing.get("pinned"):
            base_update["expires_at"] = now + timedelta(days=30)
        await savings_insights_col.update_one({"_id": existing["_id"]}, {"$set": base_update})
    else:
        insight_id = f"{category_key}-{hashlib.md5(user_id.encode()).hexdigest()[:8]}"
        await savings_insights_col.insert_one({
            "insight_id": insight_id, "user_id": user_id,
            "category": category_key, "icon": cfg["icon"], "label": cfg["label"],
            "pinned": False, "created_at": now,
            "expires_at": now + timedelta(days=30),
            **base_update,
        })


BILL_CATEGORIES = {"bills", "housing", "utilities", "insurance"}

# Triggers whose presence means we already know the category — exclude from unknown-bills
_ALL_TRIGGERS: set[str] = {t for cfg in INSIGHT_CATEGORIES.values() for t in cfg.get("triggers", [])}


@app.get("/savings-insights/unknown-bills")
async def get_unknown_bills(user: dict = Depends(current_user)):
    """Return recurring Bills transactions the system can't categorise automatically."""
    uid = user["email"]
    cutoff = datetime.now() - timedelta(days=90)
    from collections import defaultdict

    labelled_keys = {
        lbl["merchant_key"]
        async for lbl in savings_labels_col.find({"user_id": uid}, {"merchant_key": 1})
    }

    buckets: dict[str, list[float]] = defaultdict(list)
    for col in [transactions_col, yapily_transactions_col, statement_transactions_col]:
        txns = await col.find(
            {"user_id": uid, "date": {"$gte": cutoff}, "transaction_type": "debit"},
            {"merchant_name": 1, "description": 1, "category": 1, "custom_category": 1, "amount": 1},
        ).to_list(None)
        for t in txns:
            cat = (t.get("custom_category") or t.get("category") or "").lower()
            if cat not in BILL_CATEGORIES:
                continue
            key = (t.get("merchant_name") or t.get("description", "")[:30]).strip()
            if not key:
                continue
            buckets[key].append(float(t.get("amount", 0)))

    results = []
    for key, amounts in sorted(buckets.items(), key=lambda x: -sum(x[1])):
        if len(amounts) < 2:
            continue
        key_lower = key.lower()
        if any(trigger in key_lower for trigger in _ALL_TRIGGERS):
            continue
        if key in labelled_keys:
            continue
        results.append({
            "merchant_key": key,
            "display_name": key.title(),
            "monthly_amount": round(sum(amounts) / 3, 2),
            "occurrences": len(amounts),
        })
        if len(results) >= 8:
            break

    return {"unknown_bills": results, "label_options": LABEL_OPTIONS}


@app.post("/savings-insights/label")
async def label_bill(body: dict, background_tasks: BackgroundTasks, user: dict = Depends(current_user)):
    """User labels an unrecognised recurring bill; triggers an insight for that category."""
    uid = user["email"]
    merchant_key = (body.get("merchant_key") or "").strip()
    category = (body.get("category") or "").strip()
    if not merchant_key or not category:
        raise HTTPException(400, "merchant_key and category required")
    valid_cats = set(INSIGHT_CATEGORIES.keys()) | set(LABEL_OPTIONS.keys()) | {"skip"}
    if category not in valid_cats:
        raise HTTPException(400, "Invalid category")

    await savings_labels_col.update_one(
        {"user_id": uid, "merchant_key": merchant_key},
        {"$set": {"user_id": uid, "merchant_key": merchant_key, "category": category, "updated_at": datetime.now()}},
        upsert=True,
    )

    # Immediately generate an insight if the category is supported
    if category in INSIGHT_CATEGORIES:
        background_tasks.add_task(_refresh_single_insight, uid, category)

    return {"message": "Labelled", "category": category}


@app.get("/savings-insights/labels")
async def get_bill_labels(user: dict = Depends(current_user)):
    """Return all bill labels the user has assigned, for review and editing."""
    uid = user["email"]
    docs = await savings_labels_col.find({"user_id": uid}).sort("merchant_key", 1).to_list(None)
    return [
        {
            "merchant_key": d["merchant_key"],
            "display_name": d["merchant_key"].title(),
            "category": d["category"],
            "icon": LABEL_OPTIONS.get(d["category"], {}).get("icon", "💡"),
            "label": LABEL_OPTIONS.get(d["category"], {}).get("label", d["category"].replace("_", " ").title()),
            "is_skip": d["category"] == "skip",
        }
        for d in docs
    ]


@app.delete("/savings-insights/labels/{merchant_key}")
async def delete_bill_label(merchant_key: str, user: dict = Depends(current_user)):
    """Remove a label so the bill reappears in the unknown-bills panel."""
    uid = user["email"]
    await savings_labels_col.delete_one({"user_id": uid, "merchant_key": merchant_key})
    return {"deleted": merchant_key}


# ─────────────────────────────────────────────────────────────────────────────


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
