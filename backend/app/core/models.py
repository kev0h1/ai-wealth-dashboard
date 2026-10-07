"""Pydantic response models."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class Account(BaseModel):
    id: str
    name: str
    type: str
    subtype: Optional[str] = None
    balance: float
    currency: str = "GBP"
    provider: str
    provider_id: Optional[str] = None
    status: str = "connected"
    account_number: Optional[str] = None
    sort_code: Optional[str] = None
    connection_id: Optional[str] = None
    manual: bool = False
    cover_source_eligible: Optional[bool] = None
    logo_url: Optional[str] = None
    bg_colors: Optional[list] = None
    apr: Optional[float] = None
    # B45: true when the user's plan has no open banking (Statements) so this
    # bank-synced account is read-only history, not live. Never set on manual
    # or statement accounts, which stay current.
    paused: bool = False
    # G231: false when the user has chosen not to count this account towards
    # Safe to Spend. Absent on the document means counted.
    include_in_safe_to_spend: bool = True


class Transaction(BaseModel):
    id: str
    account_id: str
    date: datetime
    amount: float
    currency: str
    description: str
    merchant_name: Optional[str] = None
    category: Optional[str] = None
    custom_category: Optional[str] = None
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
    last_updated: datetime | None = None


class Insight(BaseModel):
    id: str
    title: str
    impact: float
    confidence: int
    rationale: str
    action: str
    category: str
