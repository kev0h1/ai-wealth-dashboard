"""
AI Wealth Dashboard - FastAPI Backend
Install: pip install fastapi uvicorn sqlalchemy psycopg2-binary pydantic pydantic-settings python-dotenv httpx
"""

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timedelta
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AI Wealth API", version="0.1.0")

# CORS for Next.js frontend and local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# GOCARDLESS BANK ACCOUNT DATA API (FORMERLY NORDIGEN)
# ============================================================================
# Sign up for FREE at: https://gocardless.com/bank-account-data/
# Free tier: 100 end users, unlimited API calls
# Supports 2500+ banks across Europe including all major UK banks

GOCARDLESS_SECRET_ID = os.getenv("GOCARDLESS_SECRET_ID")
GOCARDLESS_SECRET_KEY = os.getenv("GOCARDLESS_SECRET_KEY")
GOCARDLESS_BASE_URL = "https://bankaccountdata.gocardless.com/api/v2"
GOCARDLESS_REDIRECT_URI = os.getenv(
    "GOCARDLESS_REDIRECT_URI", "http://localhost:8000/auth/gocardless/callback"
)

# ============================================================================
# LEGACY CONFIGURATIONS (FOR COMPARISON)
# ============================================================================

# Monzo Developer API (Personal Access) - COMPLEX, PERMISSIONS ISSUES
MONZO_CLIENT_ID = os.getenv("MONZO_CLIENT_ID")
MONZO_CLIENT_SECRET = os.getenv("MONZO_CLIENT_SECRET")
MONZO_AUTH_URL = "https://auth.monzo.com"
MONZO_API_URL = "https://api.monzo.com"
MONZO_REDIRECT_URI = os.getenv(
    "MONZO_REDIRECT_URI", "http://localhost:8000/auth/monzo/callback"
)

# ============================================================================
# TRUELAYER CONFIGURATION (PRODUCTION)
# ============================================================================
# Sign up at: https://console.truelayer.com/
# Using PRODUCTION environment for real bank connections

TRUELAYER_CLIENT_ID = os.getenv("TRUELAYER_CLIENT_ID")
TRUELAYER_CLIENT_SECRET = os.getenv("TRUELAYER_CLIENT_SECRET")
TRUELAYER_AUTH_URL = "https://auth.truelayer.com"  # PRODUCTION
TRUELAYER_API_URL = "https://api.truelayer.com"  # PRODUCTION
TRUELAYER_REDIRECT_URI = os.getenv(
    "TRUELAYER_REDIRECT_URI", "http://localhost:8000/auth/truelayer/callback"
)

# ============================================================================
# MODELS
# ============================================================================


class Account(BaseModel):
    id: str
    name: str
    type: str  # bank, pension, crypto
    balance: float
    currency: str = "GBP"
    provider: str
    status: str = "connected"
    account_number: Optional[str] = None
    sort_code: Optional[str] = None


class Transaction(BaseModel):
    id: str
    account_id: str
    date: datetime
    amount: float
    currency: str
    description: str
    merchant_name: Optional[str] = None
    category: Optional[str] = None
    transaction_type: str  # debit, credit


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


# ============================================================================
# IN-MEMORY STORAGE (Replace with PostgreSQL in production)
# ============================================================================

# Store access tokens per user (in production, use encrypted DB)
user_tokens = {}
user_accounts = {}
user_transactions = {}

# ============================================================================
# GOCARDLESS BANK ACCOUNT DATA API (SIMPLE & WORKS WITH ALL BANKS)
# ============================================================================


class GoCardlessAuth(BaseModel):
    access_token: str
    access_expires: int
    refresh_token: str
    refresh_expires: int


# Store GoCardless tokens
gocardless_auth: Optional[GoCardlessAuth] = None


async def get_gocardless_token():
    """Get or refresh GoCardless access token"""
    global gocardless_auth

    if not GOCARDLESS_SECRET_ID or not GOCARDLESS_SECRET_KEY:
        raise HTTPException(status_code=500, detail="GoCardless not configured")

    # Check if token exists and is still valid
    if gocardless_auth and datetime.now().timestamp() < gocardless_auth.access_expires:
        return gocardless_auth.access_token

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{GOCARDLESS_BASE_URL}/token/new/",
            json={
                "secret_id": GOCARDLESS_SECRET_ID,
                "secret_key": GOCARDLESS_SECRET_KEY,
            },
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to get GoCardless token: {response.text}",
            )

        data = response.json()
        gocardless_auth = GoCardlessAuth(
            access_token=data["access"],
            access_expires=datetime.now().timestamp() + data["access_expires"],
            refresh_token=data["refresh"],
            refresh_expires=datetime.now().timestamp() + data["refresh_expires"],
        )

        return gocardless_auth.access_token


@app.get("/banks")
async def get_available_banks(country: str = "GB"):
    """Get list of all available banks for a country via GoCardless"""
    token = await get_gocardless_token()

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{GOCARDLESS_BASE_URL}/institutions/",
            params={"country": country},
            headers={"Authorization": f"Bearer {token}"},
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=400, detail=f"Failed to fetch banks: {response.text}"
            )

        banks = response.json()
        return {
            "country": country,
            "banks": [
                {
                    "id": bank["id"],
                    "name": bank["name"],
                    "logo": bank["logo"],
                    "supported_features": bank.get("supported_features", []),
                }
                for bank in banks
            ],
            "total": len(banks),
        }


@app.post("/auth/connect-bank")
async def connect_bank(bank_id: str, user_id: str = "default"):
    """Start bank connection process with GoCardless"""
    token = await get_gocardless_token()

    async with httpx.AsyncClient() as client:
        # Create end user agreement
        agreement_response = await client.post(
            f"{GOCARDLESS_BASE_URL}/agreements/enduser/",
            json={
                "institution_id": bank_id,
                "max_historical_days": 90,
                "access_valid_for_days": 90,
                "access_scope": ["balances", "details", "transactions"],
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        if agreement_response.status_code != 201:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to create agreement: {agreement_response.text}",
            )

        agreement = agreement_response.json()

        # Create requisition (connection request)
        requisition_response = await client.post(
            f"{GOCARDLESS_BASE_URL}/requisitions/",
            json={
                "redirect": GOCARDLESS_REDIRECT_URI,
                "institution_id": bank_id,
                "agreement": agreement["id"],
                "reference": f"{user_id}_{bank_id}_{int(datetime.now().timestamp())}",
                "user_language": "EN",
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        if requisition_response.status_code != 201:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to create requisition: {requisition_response.text}",
            )

        requisition = requisition_response.json()

        return {
            "auth_url": requisition["link"],
            "requisition_id": requisition["id"],
            "instructions": "Open this URL to connect your bank account",
            "bank_id": bank_id,
        }


@app.get("/auth/callback-status/{requisition_id}")
async def check_connection_status(requisition_id: str):
    """Check if bank connection was successful"""
    token = await get_gocardless_token()

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{GOCARDLESS_BASE_URL}/requisitions/{requisition_id}/",
            headers={"Authorization": f"Bearer {token}"},
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=400, detail=f"Failed to check status: {response.text}"
            )

        data = response.json()

        if data["status"] == "LN":  # Linked successfully
            # Fetch accounts immediately
            account_ids = data["accounts"]
            accounts = []

            for account_id in account_ids:
                account_data = await fetch_gocardless_account(account_id)
                if account_data:
                    accounts.append(account_data)

            return {
                "status": "connected",
                "accounts": accounts,
                "message": "Bank connected successfully!",
            }
        else:
            return {
                "status": data["status"],
                "message": "Connection in progress or failed",
            }


async def fetch_gocardless_account(account_id: str):
    """Fetch account details from GoCardless"""
    token = await get_gocardless_token()

    async with httpx.AsyncClient() as client:
        # Get account details
        details_response = await client.get(
            f"{GOCARDLESS_BASE_URL}/accounts/{account_id}/details/",
            headers={"Authorization": f"Bearer {token}"},
        )

        # Get account balance
        balance_response = await client.get(
            f"{GOCARDLESS_BASE_URL}/accounts/{account_id}/balances/",
            headers={"Authorization": f"Bearer {token}"},
        )

        if details_response.status_code == 200 and balance_response.status_code == 200:
            details = details_response.json()["account"]
            balances = balance_response.json()["balances"]

            # Find the current balance
            current_balance = 0
            for balance in balances:
                if balance["balanceType"] == "expected":
                    current_balance = float(balance["balanceAmount"]["amount"])
                    break

            return Account(
                id=account_id,
                name=details.get("name", details.get("product", "Account")),
                type="bank",
                balance=current_balance,
                currency=details.get("currency", "GBP"),
                provider=details.get("institutionId", "Unknown"),
                status="connected",
                account_number=details.get("resourceId"),
                sort_code=details.get("bic"),
            )

    return None


# ============================================================================
# LEGACY DIRECT BANK INTEGRATIONS (COMPLEX - USE NORDIGEN INSTEAD)
# ============================================================================


import secrets


# ============================================================================
# TRUELAYER AUTH FLOW (RESTORED & IMPROVED)
# ============================================================================


@app.get("/auth/truelayer/link")
async def initiate_truelayer_auth():
    """
    Step 1: Generate TrueLayer authorization URL
    User clicks this link to connect their bank account
    """
    if not TRUELAYER_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail="TrueLayer not configured. Set TRUELAYER_CLIENT_ID in .env",
        )

    # Scopes: accounts, transactions, balance - MOCK PROVIDER ONLY (FAST & RELIABLE)
    auth_url = (
        f"{TRUELAYER_AUTH_URL}/?"
        f"response_type=code&"
        f"client_id={TRUELAYER_CLIENT_ID}&"
        f"scope=accounts%20transactions%20balance%20offline_access&"
        f"redirect_uri={TRUELAYER_REDIRECT_URI}&"
        f"providers=uk-cs-mock"
    )

    return {
        "auth_url": auth_url,
        "instructions": "⚡ Open this URL to connect with TrueLayer Mock Provider (fastest, most reliable)",
        "provider": "truelayer-mock",
        "debug_info": {
            "client_id": TRUELAYER_CLIENT_ID,
            "redirect_uri": TRUELAYER_REDIRECT_URI,
            "providers": "uk-cs-mock (mock provider only - working configuration)",
        },
    }


@app.get("/auth/truelayer/link-no-providers")
async def initiate_truelayer_auth_no_providers():
    """
    Alternative TrueLayer auth without providers parameter
    Sometimes works better with certain TrueLayer configurations
    """
    if not TRUELAYER_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail="TrueLayer not configured. Set TRUELAYER_CLIENT_ID in .env",
        )

    # Auth URL without providers - let TrueLayer show all available
    auth_url = (
        f"{TRUELAYER_AUTH_URL}/?"
        f"response_type=code&"
        f"client_id={TRUELAYER_CLIENT_ID}&"
        f"scope=accounts%20transactions%20balance%20offline_access&"
        f"redirect_uri={TRUELAYER_REDIRECT_URI}"
    )

    return {
        "auth_url": auth_url,
        "components": {
            "base_url": TRUELAYER_AUTH_URL,
            "client_id": TRUELAYER_CLIENT_ID,
            "redirect_uri": TRUELAYER_REDIRECT_URI,
            "providers": "ALL (no filter - same as main endpoint now)",
        },
    }


@app.get("/auth/truelayer/real-banks")
async def initiate_truelayer_real_banks():
    """
    Connect REAL banks via TrueLayer Open Banking (UK banks)
    This uses real bank connections, not mock data
    """
    if not TRUELAYER_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail="TrueLayer not configured. Set TRUELAYER_CLIENT_ID in .env",
        )

    # Use uk-ob-all for real UK Open Banking providers
    auth_url = (
        f"{TRUELAYER_AUTH_URL}/?"
        f"response_type=code&"
        f"client_id={TRUELAYER_CLIENT_ID}&"
        f"scope=accounts%20transactions%20balance%20offline_access&"
        f"redirect_uri={TRUELAYER_REDIRECT_URI}&"
        f"providers=uk-ob-all"
    )

    return {
        "auth_url": auth_url,
        "instructions": "🏦 Open this URL to connect your REAL bank account",
        "provider": "truelayer-real-banks",
        "supported_banks": [
            "Barclays",
            "HSBC",
            "Lloyds",
            "NatWest",
            "Santander",
            "Monzo",
            "Revolut",
            "Starling",
            "and many more...",
        ],
        "note": "This connects to real banks via Open Banking - you'll need to login with your actual bank credentials",
        "warning": "Make sure you're using a TrueLayer sandbox account or you'll connect real accounts!",
    }


@app.get("/auth/truelayer/mock")
async def initiate_truelayer_mock_only():
    """
    Fast TrueLayer auth using ONLY mock provider (fastest for testing)
    """
    if not TRUELAYER_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail="TrueLayer not configured. Set TRUELAYER_CLIENT_ID in .env",
        )

    # Only use mock provider for fastest testing
    auth_url = (
        f"{TRUELAYER_AUTH_URL}/?"
        f"response_type=code&"
        f"client_id={TRUELAYER_CLIENT_ID}&"
        f"scope=accounts%20transactions%20balance%20offline_access&"
        f"redirect_uri={TRUELAYER_REDIRECT_URI}&"
        f"providers=uk-cs-mock"
    )

    return {
        "auth_url": auth_url,
        "instructions": "⚡ FASTEST: Mock provider only - should be instant!",
        "provider": "truelayer-mock-only",
        "note": "This uses only the mock provider for fastest testing",
    }


@app.get("/auth/truelayer/all-providers")
async def initiate_truelayer_all_providers():
    """
    Show ALL available providers (mock + real banks)
    Lets user choose between mock bank and real banks
    """
    if not TRUELAYER_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail="TrueLayer not configured. Set TRUELAYER_CLIENT_ID in .env",
        )

    # Show all available providers
    auth_url = (
        f"{TRUELAYER_AUTH_URL}/?"
        f"response_type=code&"
        f"client_id={TRUELAYER_CLIENT_ID}&"
        f"scope=accounts%20transactions%20balance%20offline_access&"
        f"redirect_uri={TRUELAYER_REDIRECT_URI}"
        # No providers parameter = show everything
    )

    return {
        "auth_url": auth_url,
        "instructions": "🔍 Open this URL to see ALL available options (mock + real banks)",
        "provider": "truelayer-all",
        "note": "TrueLayer will show you both mock provider AND real banks to choose from",
    }


@app.get("/auth/truelayer/provider-options")
async def get_truelayer_provider_options():
    """Get different TrueLayer provider configuration options"""
    if not TRUELAYER_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail="TrueLayer not configured. Set TRUELAYER_CLIENT_ID in .env",
        )

    base_params = (
        f"response_type=code&"
        f"client_id={TRUELAYER_CLIENT_ID}&"
        f"scope=accounts%20transactions%20balance%20offline_access&"
        f"redirect_uri={TRUELAYER_REDIRECT_URI}"
    )

    return {
        "options": {
            "all_providers": {
                "url": f"{TRUELAYER_AUTH_URL}/?{base_params}",
                "description": "Show ALL available providers (banks + mock)",
                "recommended": True,
                "speed": "Variable (depends on bank)",
            },
            "mock_only": {
                "url": f"{TRUELAYER_AUTH_URL}/?{base_params}&providers=uk-cs-mock",
                "description": "Only mock provider for testing",
                "recommended": False,
                "speed": "Fast",
            },
            "uk_open_banking": {
                "url": f"{TRUELAYER_AUTH_URL}/?{base_params}&providers=uk-ob-all",
                "description": "UK Open Banking providers only",
                "recommended": True,
                "speed": "Medium",
            },
            "uk_oauth": {
                "url": f"{TRUELAYER_AUTH_URL}/?{base_params}&providers=uk-oauth-all",
                "description": "UK OAuth providers (legacy)",
                "recommended": False,
                "speed": "Slow",
            },
            "mixed": {
                "url": f"{TRUELAYER_AUTH_URL}/?{base_params}&providers=uk-cs-mock%20uk-ob-all",
                "description": "Mock + Open Banking providers",
                "recommended": True,
                "speed": "Mixed",
            },
        },
        "note": "The main /auth/truelayer/link endpoint now shows ALL providers by default",
    }


@app.get("/auth/truelayer/test-callback")
async def test_truelayer_callback():
    """Test endpoint to verify callback routing works"""
    return {
        "message": "TrueLayer callback routing is working!",
        "timestamp": datetime.now(),
        "expected_url": "http://localhost:8000/auth/truelayer/callback",
    }


@app.get("/auth/truelayer/callback")
async def truelayer_auth_callback(
    code: str, user_id: str = "default", state: Optional[str] = None
):
    """
    Step 2: TrueLayer redirects here after user authorizes
    Exchange authorization code for access token
    """
    print(
        f"🔥 TRUELAYER CALLBACK HIT! Code: {code[:20]}..., User ID: {user_id}, State: {state}"
    )
    print(f"🔥 CALLBACK TIMESTAMP: {datetime.now()}")
    print(f"🔥 FULL CODE: {code}")

    if not TRUELAYER_CLIENT_ID or not TRUELAYER_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="TrueLayer not configured")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{TRUELAYER_AUTH_URL}/connect/token",
            data={
                "grant_type": "authorization_code",
                "client_id": TRUELAYER_CLIENT_ID,
                "client_secret": TRUELAYER_CLIENT_SECRET,
                "redirect_uri": TRUELAYER_REDIRECT_URI,
                "code": code,
            },
        )

        print(f"🔥 TOKEN EXCHANGE RESPONSE: {response.status_code}")
        print(f"🔥 RESPONSE BODY: {response.text}")

        if response.status_code != 200:
            return {
                "error": "Token exchange failed",
                "status_code": response.status_code,
                "details": response.text,
                "debug_info": {
                    "client_id": TRUELAYER_CLIENT_ID,
                    "redirect_uri": TRUELAYER_REDIRECT_URI,
                },
            }

        token_data = response.json()
        user_tokens[user_id] = {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "expires_at": datetime.now()
            + timedelta(seconds=token_data.get("expires_in", 3600)),
        }

    # Immediately fetch accounts
    try:
        accounts = await sync_accounts(user_id)
        return {
            "message": "TrueLayer connected successfully!",
            "accounts_found": len(accounts),
            "redirect": "http://localhost:3000",
            "provider": "truelayer",
        }
    except Exception as e:
        import traceback

        error_details = traceback.format_exc()
        print(f"🔥 ERROR FETCHING ACCOUNTS: {error_details}")

        return {
            "message": "Token received but failed to fetch accounts",
            "error": str(e),
            "error_type": type(e).__name__,
            "redirect": "http://localhost:3000",
            "provider": "truelayer",
            "suggestion": "Check server logs for detailed error. The token is saved and you can manually sync accounts later.",
        }


# Keep the old callback for backward compatibility
@app.get("/callback")
async def legacy_auth_callback(code: str, user_id: str = "default"):
    """Legacy callback - redirects to new TrueLayer callback"""
    return await truelayer_auth_callback(code, user_id)
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{TRUELAYER_AUTH_URL}/connect/token",
            data={
                "grant_type": "authorization_code",
                "client_id": TRUELAYER_CLIENT_ID,
                "client_secret": TRUELAYER_CLIENT_SECRET,
                "redirect_uri": TRUELAYER_REDIRECT_URI,
                "code": code,
            },
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=400, detail="Failed to exchange code for token"
            )

        token_data = response.json()
        user_tokens[user_id] = {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "expires_at": datetime.now()
            + timedelta(seconds=token_data.get("expires_in", 3600)),
        }

    # Immediately fetch accounts
    await sync_accounts(user_id)

    return {
        "message": "Successfully connected! Redirecting...",
        "redirect": "http://localhost:3000",
    }


# ============================================================================
# ACCOUNT & TRANSACTION SYNC
# ============================================================================


async def get_access_token(user_id: str = "default") -> str:
    """Get valid access token, refresh if needed"""
    if user_id not in user_tokens:
        raise HTTPException(
            status_code=401, detail="Not authenticated. Please connect your bank first."
        )

    token_info = user_tokens[user_id]

    # Check if token expired, refresh if needed
    if datetime.now() >= token_info["expires_at"]:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{TRUELAYER_AUTH_URL}/connect/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": TRUELAYER_CLIENT_ID,
                    "client_secret": TRUELAYER_CLIENT_SECRET,
                    "refresh_token": token_info["refresh_token"],
                },
            )
            if response.status_code == 200:
                token_data = response.json()
                user_tokens[user_id]["access_token"] = token_data["access_token"]
                user_tokens[user_id]["expires_at"] = datetime.now() + timedelta(
                    seconds=token_data.get("expires_in", 3600)
                )

    return user_tokens[user_id]["access_token"]


async def sync_accounts(user_id: str = "default"):
    """Fetch all accounts from TrueLayer"""
    access_token = await get_access_token(user_id)

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{TRUELAYER_API_URL}/data/v1/accounts",
            headers={"Authorization": f"Bearer {access_token}"},
        )

        print(f"🔥 ACCOUNTS API RESPONSE STATUS: {response.status_code}")
        print(f"🔥 ACCOUNTS API RESPONSE BODY: {response.text}")

        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Failed to fetch accounts: {response.text}",
            )

        data = response.json()
        accounts = []

        for acc in data.get("results", []):
            print(f"🔥 PROCESSING ACCOUNT: {acc}")

            # Handle different balance structures from TrueLayer API
            balance = 0.0
            if "current" in acc and acc["current"]:
                balance = acc["current"].get("value", 0.0)
            elif "balance" in acc:
                balance = acc["balance"].get("current", 0.0)

            account = Account(
                id=acc["account_id"],
                name=acc.get(
                    "display_name", acc.get("account_type", "Unknown Account")
                ),
                type="bank",
                balance=balance,
                currency=acc.get("currency", "GBP"),
                provider=acc.get("provider", {}).get("display_name", "Unknown"),
                status="connected",
                account_number=(
                    acc.get("account_number", {}).get("number")
                    if acc.get("account_number")
                    else None
                ),
                sort_code=(
                    acc.get("account_number", {}).get("sort_code")
                    if acc.get("account_number")
                    else None
                ),
            )
            accounts.append(account)
            print(f"✅ ACCOUNT CREATED: {account.name} - £{account.balance}")

        user_accounts[user_id] = accounts

        # Fetch transactions for each account
        for account in accounts:
            await sync_transactions(user_id, account.id)

        return accounts


async def sync_transactions(user_id: str, account_id: str, days: int = 90):
    """Fetch transactions for a specific account"""
    access_token = await get_access_token(user_id)

    # Get transactions from last 90 days
    from_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    to_date = datetime.now().strftime("%Y-%m-%d")

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{TRUELAYER_API_URL}/data/v1/accounts/{account_id}/transactions",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"from": from_date, "to": to_date},
        )

        if response.status_code != 200:
            return []

        data = response.json()
        transactions = []

        for txn in data.get("results", []):
            transaction = Transaction(
                id=txn["transaction_id"],
                account_id=account_id,
                date=datetime.fromisoformat(txn["timestamp"].replace("Z", "+00:00")),
                amount=abs(txn["amount"]),
                currency=txn["currency"],
                description=txn["description"],
                merchant_name=txn.get("merchant_name"),
                category=txn.get("transaction_category"),
                transaction_type="debit" if txn["amount"] < 0 else "credit",
            )
            transactions.append(transaction)

        if user_id not in user_transactions:
            user_transactions[user_id] = {}
        user_transactions[user_id][account_id] = transactions

        return transactions


# ============================================================================
# API ENDPOINTS
# ============================================================================


@app.get("/health")
async def health():
    return {"status": "ok", "truelayer_configured": bool(TRUELAYER_CLIENT_ID)}


@app.get("/accounts", response_model=List[Account])
async def get_accounts(user_id: str = "default"):
    """Get all connected accounts from all providers"""
    if user_id not in user_accounts:
        return []

    return user_accounts.get(user_id, [])


@app.post("/accounts/sync")
async def refresh_accounts(user_id: str = "default"):
    """Manually trigger account & transaction sync for all providers"""
    synced_providers = []
    total_accounts = 0

    # Sync TrueLayer if connected (legacy)
    if user_id in user_tokens and "access_token" in user_tokens[user_id]:
        try:
            accounts = await sync_accounts(user_id)
            synced_providers.append("truelayer")
            total_accounts += len(accounts)
        except Exception as e:
            print(f"Failed to sync TrueLayer: {e}")

    return {
        "message": "Accounts synced successfully",
        "providers": synced_providers,
        "total_accounts": total_accounts,
    }


@app.get("/providers")
async def get_available_providers():
    """Get list of available banking providers"""
    providers = []

    if GOCARDLESS_SECRET_ID:
        providers.append(
            {
                "id": "gocardless",
                "name": "GoCardless (2500+ Banks)",
                "type": "open_banking_aggregator",
                "auth_url": "/banks",
                "status": "configured",
                "description": "Access 2500+ European banks via GoCardless",
            }
        )

    if TRUELAYER_CLIENT_ID:
        providers.append(
            {
                "id": "truelayer",
                "name": "TrueLayer (Multiple Banks)",
                "type": "open_banking_aggregator",
                "auth_url": "/auth/truelayer/link",
                "status": "configured",
                "description": "Access multiple UK banks via TrueLayer",
            }
        )

        providers.append(
            {
                "id": "truelayer-no-providers",
                "name": "TrueLayer (Alternative)",
                "type": "open_banking_aggregator",
                "auth_url": "/auth/truelayer/link-no-providers",
                "status": "configured",
                "description": "TrueLayer without provider filtering",
            }
        )

    if MONZO_CLIENT_ID:
        providers.append(
            {
                "id": "monzo-dev",
                "name": "Monzo Developer API",
                "type": "direct_bank_api",
                "auth_url": "/auth/monzo-dev/link",
                "status": "configured",
                "description": "Direct access to your personal Monzo account",
            }
        )

    return {"providers": providers, "total": len(providers)}


@app.get("/accounts/{account_id}/transactions", response_model=List[Transaction])
async def get_transactions(account_id: str, user_id: str = "default", days: int = 90):
    """Get transactions for a specific account"""
    if user_id not in user_transactions or account_id not in user_transactions[user_id]:
        # Try to sync
        await sync_transactions(user_id, account_id, days)

    return user_transactions.get(user_id, {}).get(account_id, [])


@app.get("/kpis", response_model=KPIResponse)
async def get_kpis(user_id: str = "default"):
    """Calculate and return KPIs"""
    accounts = user_accounts.get(user_id, [])

    if not accounts:
        raise HTTPException(status_code=404, detail="No accounts found")

    total_balance = sum(acc.balance for acc in accounts)
    cash_balance = sum(acc.balance for acc in accounts if acc.type == "bank")

    # Calculate runway (simplified - should use transaction history)
    transactions = []
    for acc_id, txns in user_transactions.get(user_id, {}).items():
        transactions.extend(txns)

    # Calculate average monthly spend (last 90 days)
    recent_debits = [t.amount for t in transactions if t.transaction_type == "debit"]
    avg_monthly_spend = (
        sum(recent_debits) / 3 if recent_debits else 1000
    )  # Default to £1k

    runway = cash_balance / avg_monthly_spend if avg_monthly_spend > 0 else 0

    return KPIResponse(
        net_worth=total_balance,
        cash=cash_balance,
        runway=round(runway, 1),
        investments=0,  # TODO: Add investment accounts
        pensions=0,  # TODO: Add pension accounts
        last_updated=datetime.now(),
    )


@app.get("/insights", response_model=List[Insight])
async def get_insights(user_id: str = "default"):
    """Generate insights based on account data"""
    insights = []

    accounts = user_accounts.get(user_id, [])
    if not accounts:
        return insights

    # Insight 1: Idle cash check
    for account in accounts:
        if account.balance > 5000:  # More than £5k sitting
            insights.append(
                Insight(
                    id=f"idle-cash-{account.id}",
                    title=f"Sweep Idle Cash from {account.name}",
                    impact=int(account.balance * 0.045),  # Assume 4.5% rate difference
                    confidence=100,
                    rationale=f"£{account.balance:,.0f} sitting in {account.name}. Move to 5% AER easy-access savings → +£{int(account.balance * 0.045)}/yr.",
                    action="Transfer to savings",
                    category="savings",
                )
            )

    # Insight 2: Subscription detection (look for recurring transactions)
    all_transactions = []
    for acc_txns in user_transactions.get(user_id, {}).values():
        all_transactions.extend(acc_txns)

    # Group by merchant and find recurring
    from collections import defaultdict

    merchant_txns = defaultdict(list)
    for txn in all_transactions:
        if txn.merchant_name and txn.transaction_type == "debit":
            merchant_txns[txn.merchant_name].append(txn)

    for merchant, txns in merchant_txns.items():
        if len(txns) >= 2:  # At least 2 transactions
            # Check if roughly monthly
            sorted_txns = sorted(txns, key=lambda x: x.date)
            avg_amount = sum(t.amount for t in sorted_txns) / len(sorted_txns)

            # If last transaction was >60 days ago, might be unused
            if (datetime.now() - sorted_txns[-1].date).days > 60:
                insights.append(
                    Insight(
                        id=f"sub-{merchant.replace(' ', '-').lower()}",
                        title=f"Review {merchant} Subscription",
                        impact=int(avg_amount * 12),
                        confidence=85,
                        rationale=f"£{avg_amount:.2f} monthly to {merchant}. Last charge {(datetime.now() - sorted_txns[-1].date).days} days ago.",
                        action="Review subscription",
                        category="spending",
                    )
                )

    # Sort by impact
    insights.sort(key=lambda x: x.impact, reverse=True)

    return insights[:10]  # Top 10


# ============================================================================
# DEVELOPMENT HELPERS
# ============================================================================


@app.get("/auth/truelayer/simulate-success")
async def simulate_truelayer_success(user_id: str = "default"):
    """
    Simulate successful TrueLayer connection with mock token
    Use this to bypass slow verification and test the rest of your app
    """
    # Simulate a successful token
    user_tokens[user_id] = {
        "access_token": "mock_access_token_12345",
        "refresh_token": "mock_refresh_token_12345",
        "expires_at": datetime.now() + timedelta(hours=1),
        "provider": "truelayer-simulated",
    }

    # Add mock TrueLayer accounts
    mock_accounts = [
        Account(
            id="truelayer-mock-1",
            name="TrueLayer Mock Current Account",
            type="bank",
            balance=2500.75,
            currency="GBP",
            provider="TrueLayer Mock Bank",
            status="connected",
            account_number="12345678",
            sort_code="12-34-56",
        ),
        Account(
            id="truelayer-mock-2",
            name="TrueLayer Mock Savings",
            type="bank",
            balance=15000.00,
            currency="GBP",
            provider="TrueLayer Mock Bank",
            status="connected",
            account_number="87654321",
            sort_code="65-43-21",
        ),
    ]

    if user_id not in user_accounts:
        user_accounts[user_id] = []

    # Remove old TrueLayer accounts and add new ones
    user_accounts[user_id] = [
        acc
        for acc in user_accounts[user_id]
        if not acc.provider.startswith("TrueLayer")
    ]
    user_accounts[user_id].extend(mock_accounts)

    # Add mock transactions
    mock_transactions = [
        Transaction(
            id="tl-t1",
            account_id="truelayer-mock-1",
            date=datetime.now() - timedelta(days=2),
            amount=25.99,
            currency="GBP",
            description="Grocery Shopping",
            merchant_name="Tesco",
            category="Groceries",
            transaction_type="debit",
        ),
        Transaction(
            id="tl-t2",
            account_id="truelayer-mock-1",
            date=datetime.now() - timedelta(days=5),
            amount=3000.00,
            currency="GBP",
            description="Salary Payment",
            merchant_name="Employer Ltd",
            category="Income",
            transaction_type="credit",
        ),
    ]

    if user_id not in user_transactions:
        user_transactions[user_id] = {}

    user_transactions[user_id]["truelayer-mock-1"] = mock_transactions

    return {
        "message": "✅ TrueLayer connection simulated successfully!",
        "provider": "truelayer-simulated",
        "accounts": len(mock_accounts),
        "transactions": len(mock_transactions),
        "note": "This bypasses slow verification - you can now test your app with mock TrueLayer data",
        "next_steps": [
            "Check /accounts to see mock accounts",
            "Check /kpis to see calculated metrics",
            "Check /insights for generated insights",
        ],
    }


@app.get("/test/mock-data")
async def load_mock_data(user_id: str = "default"):
    """Load mock data for testing without TrueLayer"""
    user_accounts[user_id] = [
        Account(
            id="mock-1",
            name="Monzo Current",
            type="bank",
            balance=3240.50,
            currency="GBP",
            provider="Monzo",
            status="connected",
        ),
        Account(
            id="mock-2",
            name="Chase Savings",
            type="bank",
            balance=15000.00,
            currency="GBP",
            provider="Chase",
            status="connected",
        ),
    ]

    # Mock transactions
    user_transactions[user_id] = {
        "mock-1": [
            Transaction(
                id="t1",
                account_id="mock-1",
                date=datetime.now() - timedelta(days=5),
                amount=45.99,
                currency="GBP",
                description="Adobe Creative Cloud",
                merchant_name="Adobe",
                category="Software",
                transaction_type="debit",
            ),
            Transaction(
                id="t2",
                account_id="mock-1",
                date=datetime.now() - timedelta(days=10),
                amount=2500.00,
                currency="GBP",
                description="Salary",
                merchant_name="Employer Ltd",
                category="Income",
                transaction_type="credit",
            ),
        ]
    }

    return {"message": "Mock data loaded", "accounts": len(user_accounts[user_id])}


@app.get("/auth/truelayer/status")
async def check_truelayer_status(user_id: str = "default"):
    """Check current TrueLayer connection status"""
    if user_id not in user_tokens:
        return {
            "status": "not_connected",
            "message": "No TrueLayer token found",
            "suggestion": "Use /auth/truelayer/simulate-success for instant testing",
        }

    token_info = user_tokens[user_id]
    accounts = user_accounts.get(user_id, [])
    truelayer_accounts = [
        acc
        for acc in accounts
        if "truelayer" in acc.provider.lower() or "mock" in acc.provider.lower()
    ]

    return {
        "status": "connected",
        "provider": token_info.get("provider", "truelayer"),
        "token_expires": token_info["expires_at"],
        "token_valid": datetime.now() < token_info["expires_at"],
        "accounts_count": len(truelayer_accounts),
        "accounts": [
            {"id": acc.id, "name": acc.name, "balance": acc.balance}
            for acc in truelayer_accounts
        ],
        "last_sync": datetime.now(),
    }


@app.get("/debug/truelayer-config")
async def debug_truelayer_config():
    """Comprehensive debug endpoint for TrueLayer configuration"""
    return {
        "client_id": TRUELAYER_CLIENT_ID,
        "client_secret_configured": bool(TRUELAYER_CLIENT_SECRET),
        "auth_url": TRUELAYER_AUTH_URL,
        "api_url": TRUELAYER_API_URL,
        "redirect_uri": TRUELAYER_REDIRECT_URI,
        "full_auth_url": (
            f"{TRUELAYER_AUTH_URL}/?"
            f"response_type=code&"
            f"client_id={TRUELAYER_CLIENT_ID}&"
            f"scope=accounts%20transactions%20balance%20offline_access&"
            f"redirect_uri={TRUELAYER_REDIRECT_URI}&"
            f"providers=uk-cs-mock"
        ),
        "checklist": {
            "callback_endpoint_accessible": "Test: curl http://localhost:8000/auth/truelayer/test-callback",
            "redirect_uri_in_console": f"Make sure '{TRUELAYER_REDIRECT_URI}' is configured in TrueLayer Console",
            "environment": "Using sandbox environment (correct for testing)",
            "provider": "uk-cs-mock (mock provider - fast and reliable)",
            "client_credentials": (
                "Client ID configured" if TRUELAYER_CLIENT_ID else "Missing client ID"
            ),
        },
    }


@app.get("/debug/auth-url")
async def debug_auth_url():
    """Debug endpoint to see the exact auth URL being generated"""
    if not TRUELAYER_CLIENT_ID:
        return {"error": "TrueLayer not configured"}

    auth_url = (
        f"{TRUELAYER_AUTH_URL}/?"
        f"response_type=code&"
        f"client_id={TRUELAYER_CLIENT_ID}&"
        f"scope=accounts%20transactions%20balance%20offline_access&"
        f"redirect_uri={TRUELAYER_REDIRECT_URI}&"
        f"providers=uk-cs-mock"
    )

    return {
        "auth_url": auth_url,
        "components": {
            "base_url": TRUELAYER_AUTH_URL,
            "client_id": TRUELAYER_CLIENT_ID,
            "redirect_uri": TRUELAYER_REDIRECT_URI,
            "providers": "uk-cs-mock",
        },
    }


@app.delete("/test/clear-data")
async def clear_all_data(user_id: str = "default"):
    """Clear all stored data for a user (tokens, accounts, transactions)"""
    cleared_items = []

    if user_id in user_tokens:
        del user_tokens[user_id]
        cleared_items.append("tokens")

    if user_id in user_accounts:
        del user_accounts[user_id]
        cleared_items.append("accounts")

    if user_id in user_transactions:
        del user_transactions[user_id]
        cleared_items.append("transactions")

    return {
        "message": "Data cleared successfully",
        "cleared": cleared_items,
        "user_id": user_id,
    }


@app.delete("/test/clear-all")
async def clear_everything():
    """Clear ALL data for ALL users (complete reset)"""
    user_tokens.clear()
    user_accounts.clear()
    user_transactions.clear()

    return {
        "message": "All data cleared successfully",
        "cleared": ["all_tokens", "all_accounts", "all_transactions"],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
