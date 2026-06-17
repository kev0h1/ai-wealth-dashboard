"""Pydantic response models."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


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
    last_updated: datetime


class Insight(BaseModel):
    id: str
    title: str
    impact: float
    confidence: int
    rationale: str
    action: str
    category: str
