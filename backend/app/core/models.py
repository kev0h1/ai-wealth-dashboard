"""Pydantic response models."""
from pydantic import BaseModel, computed_field
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
    # A175: when the last successful transaction walk finished (ISO, UTC) and
    # how many rows the bank returned in it. Null on rows that predate the
    # diagnostics, on manual and statement accounts, and on providers that do
    # not record them.
    transactions_synced_at: Optional[str] = None
    transactions_last_count: Optional[int] = None
    # A176: when the bank's own data was last refreshed (Finexer's sync object
    # synced_to, ISO UTC). Null where Finexer has not reported one.
    bank_synced_to: Optional[str] = None
    # A179: when the bank's once-an-hour rule next allows a refresh of this
    # account (ISO UTC); null when one is allowed now or the account is not Finexer.
    bank_next_refresh_at: Optional[str] = None
    # A186: the provider is not expected to share transactions for this account.
    balance_only: Optional[bool] = None
    balance_only_reason: Optional[str] = None
    # A181: Finexer's raw account class and holder type (personal, business,
    # unknown), stored as returned; class_unknown is true when the class was
    # not recognised and the account fell back to a current account.
    finexer_class: Optional[str] = None
    finexer_type: Optional[str] = None
    class_unknown: Optional[bool] = None
    # A181: a card's credit limit (Finexer overdraft.limit with type credit).
    # Absent when the bank does not report one.
    credit_limit: Optional[float] = None
    # A181: what the bank reports as available (current plus any credit line,
    # 0 when current is negative), and the arranged overdraft limit and type on
    # a current account. Display only: Left to spend uses balance, never these.
    available: Optional[float] = None
    overdraft_limit: Optional[float] = None
    overdraft_type: Optional[str] = None

    # A192: false when the account does not count towards Left to spend for
    # ANY reason: the user's own G231 choice above, or an ended bank
    # connection (status expired). Derived on read through the one shared
    # helper, never stored; the UI filters on this, never on the raw flag.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def counted_in_left_to_spend(self) -> bool:
        from app.services.counted_accounts import is_counted
        return is_counted({"include_in_safe_to_spend": self.include_in_safe_to_spend, "status": self.status})

    # G282: the one shared display name (services/account_names.py), so every
    # client shows an account identically. `name` stays the raw stored value.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def display_name(self) -> str:
        from app.services.account_names import display_account_name
        return display_account_name(self.name)


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
    # Provisional bank entries live outside the settled transaction feeds.
    # List endpoints return them separately so callers cannot accidentally
    # include them in historical totals.
    is_pending: Optional[bool] = None
    # The customer-facing activity day.  `date` remains the bank's immutable
    # booked date, which can be a later working day for weekend activity.
    activity_date: Optional[datetime] = None
    # G268: this row's signed contribution to spending under the one
    # definition (app.services.spending): +payment, -refund, 0 for income,
    # movement, own-account moves and foreign-currency rows. None on routes
    # that do not compute it; the charts read it so they cannot disagree with
    # Spend's Out.
    spend_amount: Optional[float] = None

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
