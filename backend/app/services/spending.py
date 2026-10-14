"""What counts as spending: the one definition (G268, Kevin 2026-10-14).

Every surface that shows an "Out" or "spent" figure goes through this module,
so Spend's Out, the jump-strip chip, the notables, the pace line, the charts,
money shape, Safe to Spend's pace and Penny/MCP's category tools cannot
disagree. The canonical statement is in ENGINE.md, "What counts as spending".

COUNTS
    everyday purchases (shopping, eating out, groceries, travel), bills and
    subscriptions, the whole mortgage or rent payment, loan repayments such as
    car finance, fees, interest, gifts and family. In declared-kind terms: any
    DEBIT whose category kind is ``discretionary`` or ``commitment``.

DOES NOT COUNT
    * transfers between the user's own accounts (kind ``movement``, or a debit
      the own-account detector below recognises, whatever its category),
    * savings, investment and pension contributions (kind ``movement``),
    * credit card repayments (kind ``movement``; the purchases were already
      counted, so counting the repayment would count them twice),
    * refunds: a credit in a spend category NETS OFF that category's spend
      rather than being income,
    * income (kind ``income``).

BUSINESS (Kevin's option b): a payment to the user's OWN account (for example
"AURIQ AURIQ TIDE" to his Tide business account) is a movement; a Business
payment to a third party is spending. That is decided per transaction by
own-account detection, never by a blanket category kind, so Business keeps
whatever kind it has for third-party payments.

Own-account detection (``find_own_move_ids``), strongest evidence first:
    1. the row is linked to an offline account or a goal (the user's own
       resolve-movement answer),
    2. its text carries the number or sort code of ANOTHER of the user's
       accounts,
    3. a transfer-pair match: a credit of the same amount (within 2p), on a
       DIFFERENT account of the user's, within five days (the closest date
       wins), categorised Transfer/movement or unplaced (never Income), not
       already paired, and only for Business, Other or transfer-like rows
       (text that says transfer or carries the user's name). Debits that are
       already movements claim their partner credits first,
    4. the user's own name in the text counts only together with a pair match
       (never alone: "MR K MAINGI RENT REF" is a rent payment).
A payee that is merely called the same as a provider ("TIDE PLATFORM LIMI", a
fee) is NOT evidence: only an account number, a pair or a link is.

Pure functions take plain dicts and touch no database; the two ``build_*``
constructors are the only I/O (one identity read plus one window fetch).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.db.collections import transactions_col, yapily_transactions_col
from app.services.categories import (
    INCOME,
    MOVEMENT,
    get_category_kinds,
    is_card_repayment,
    kind_of,
    normalise_name,
)
from app.services.categorisation import own_transfer_evidence, user_identity

logger = logging.getLogger(__name__)

#: How far either side of a debit a pairing credit may sit.
PAIR_WINDOW_DAYS = 5
#: Amount tolerance for a pair, in pounds.
PAIR_AMOUNT_TOLERANCE = 0.02
#: Categories whose rows may be recognised as own-account on the user's name
#: alone (a weak signal, so it is kept to the categories where an own-account
#: payment is plausible).
NAME_EVIDENCE_CATEGORIES = frozenset({"business", "other"})

# Flow kinds.
SPEND = "spend"
REFUND = "refund"
INCOME_FLOW = "income"
MOVED = "movement"

_PROJECTION = {
    "amount": 1, "date": 1, "category": 1, "custom_category": 1,
    "transaction_type": 1, "description": 1, "merchant_name": 1,
    "account_id": 1, "linked_offline_account_id": 1, "linked_goal_id": 1,
    "currency": 1,
}


@dataclass(frozen=True)
class Flow:
    """How one transaction is read: ``kind`` is spend, refund, income or
    movement; ``reason`` is the traceable why (Show Your Working)."""

    kind: str
    reason: str

    @property
    def counts_as_spend(self) -> bool:
        """True for a counted payment. A refund is not a payment but it does
        move the total, see ``signed``."""
        return self.kind == SPEND

    def signed(self, amount: float) -> float:
        """The contribution to spending: +amount for a payment, -amount for a
        refund, 0 for income and movement. ``amount`` is taken as absolute."""
        amt = abs(float(amount or 0))
        if self.kind == SPEND:
            return amt
        if self.kind == REFUND:
            return -amt
        return 0.0


def classify_flow(kinds, category: str | None, is_debit: bool, own_move: bool = False) -> Flow:
    """The definition, as one pure function over a category kind map."""
    kind = kind_of(kinds, category)
    if kind == INCOME:
        return Flow(INCOME_FLOW, "income")
    if kind == MOVEMENT:
        if is_debit and is_card_repayment(category):
            return Flow(MOVED, "card_repayment")
        return Flow(MOVED, "movement")
    if own_move:
        return Flow(MOVED, "own_account")
    return Flow(SPEND, "spend") if is_debit else Flow(REFUND, "refund")


# ── Own-account detection ────────────────────────────────────────────────────

def _txn_id(doc: dict) -> str:
    return str(doc.get("id") or doc.get("_id") or "")


def _effective_category(doc: dict) -> str:
    return doc.get("custom_category") or doc.get("category") or "Other"


def _is_debit(doc: dict) -> bool:
    if "is_debit" in doc:
        return bool(doc["is_debit"])
    if "debit" in doc:
        return bool(doc["debit"])
    return doc.get("transaction_type") == "debit"


def _text(doc: dict) -> str:
    return f"{doc.get('merchant_name') or ''} {doc.get('description') or ''}".strip()


def find_own_move_ids(docs: list[dict], kinds, identity: dict | None = None) -> set[str]:
    """Ids of spend-kind rows that are really a move between the user's own
    accounts. ``docs`` are raw transaction documents (``_id``, ``amount``,
    ``date``, ``category``/``custom_category``, ``transaction_type``,
    ``account_id``, ``description``, ``merchant_name``, optional links),
    ideally the period padded by ``PAIR_WINDOW_DAYS`` each side so a pair that
    straddles the period edge is still found."""
    identity = identity or {"name_tokens": [], "own_ids": set(), "own_map": {}}
    own: set[str] = set()

    # Candidate partner credits, by amount in pence. A credit in a spend
    # category is a refund and never a partner. Income is a partner only for a
    # debit that is already a movement (the free leg of a savings transfer is
    # often tagged Income); a spend-kind debit never pairs with Income, so a
    # purchase cannot be absorbed by a coincidentally equal salary credit.
    pool: dict[int, list[dict]] = {}
    for d in docs:
        if _is_debit(d) or not isinstance(d.get("date"), datetime):
            continue
        cat = _effective_category(d)
        kind = kind_of(kinds, cat)
        if kind not in (INCOME, MOVEMENT) and normalise_name(cat) != "other":
            continue
        pool.setdefault(round(abs(float(d.get("amount") or 0)) * 100), []).append(d)

    used: set[str] = set()

    def closest_partner(d: dict, allow_income: bool) -> dict | None:
        amt = abs(float(d.get("amount") or 0))
        cents = round(amt * 100)
        best, best_gap = None, None
        for c in (cents - 2, cents - 1, cents, cents + 1, cents + 2):
            for cr in pool.get(c, ()):
                if _txn_id(cr) in used or cr.get("account_id") == d.get("account_id"):
                    continue
                if not allow_income and kind_of(kinds, _effective_category(cr)) == INCOME:
                    continue
                if abs(abs(float(cr.get("amount") or 0)) - amt) >= PAIR_AMOUNT_TOLERANCE:
                    continue
                gap = abs((cr["date"] - d["date"]).days)
                if gap > PAIR_WINDOW_DAYS:
                    continue
                if best is None or gap < best_gap:
                    best, best_gap = cr, gap
        return best

    dated = sorted(
        (d for d in docs if _is_debit(d) and isinstance(d.get("date"), datetime)),
        key=lambda d: d["date"],
    )

    # Pass 1: debits that are already movements claim their partner credits
    # first, so those credits are not left free to pair with a spend debit.
    for d in dated:
        if kind_of(kinds, _effective_category(d)) in (INCOME, MOVEMENT):
            partner = closest_partner(d, allow_income=True)
            if partner is not None:
                used.add(_txn_id(partner))

    # Pass 2: spend-kind debits.
    for d in dated:
        cat = _effective_category(d)
        if kind_of(kinds, cat) in (INCOME, MOVEMENT):
            continue  # already not spending; no evidence needed
        did = _txn_id(d)

        if d.get("linked_offline_account_id") or d.get("linked_goal_id"):
            own.add(did)
            continue

        evidence = own_transfer_evidence(_text(d), identity, own_account_id=d.get("account_id"))
        if evidence is not None and evidence["kind"] == "account":
            own.add(did)
            continue

        # A pair is only considered for rows that could plausibly be a move:
        # Business and Other, or text that says transfer or names the user. A
        # Groceries or Shopping debit never becomes a movement by coincidence
        # of amount.
        text = _text(d).lower()
        transfer_like = (
            normalise_name(cat) in NAME_EVIDENCE_CATEGORIES
            or "transfer" in text
            or evidence is not None
        )
        if not transfer_like:
            continue
        partner = closest_partner(d, allow_income=False)
        if partner is None:
            continue  # the user's name alone never flags a row
        used.add(_txn_id(partner))
        own.add(did)
        if kind_of(kinds, _effective_category(partner)) not in (INCOME, MOVEMENT):
            own.add(_txn_id(partner))  # an unplaced credit leg is a move too, not a refund
    return own


@dataclass
class SpendingContext:
    """Everything the definition needs beyond the category kinds: which rows
    are own-account moves. Build once per request."""

    kinds: dict
    own_move_ids: set[str] = field(default_factory=set)

    def is_own_move(self, txn_id: str | None) -> bool:
        return bool(txn_id) and str(txn_id) in self.own_move_ids

    @classmethod
    def from_docs(cls, docs: list[dict], kinds, identity: dict | None = None) -> "SpendingContext":
        return cls(kinds=kinds, own_move_ids=find_own_move_ids(docs, kinds, identity))


async def build_spending_context(
    uid: str,
    start: datetime | None = None,
    end: datetime | None = None,
    *,
    kinds=None,
    collections=None,
    identity: dict | None = None,
) -> SpendingContext:
    """One category-kind read (unless given), one identity read, and one padded
    window fetch per collection. ``start``/``end`` of None fetch everything."""
    if kinds is None:
        kinds = await get_category_kinds(uid)
    if identity is None:
        identity = await user_identity(uid)
    query: dict = {"user_id": uid, "transaction_type": {"$in": ["debit", "credit"]}}
    if start is not None or end is not None:
        window: dict = {}
        if start is not None:
            window["$gte"] = start - timedelta(days=PAIR_WINDOW_DAYS)
        if end is not None:
            window["$lte"] = end + timedelta(days=PAIR_WINDOW_DAYS)
        query["date"] = window
    docs: list[dict] = []
    for col in collections or (transactions_col, yapily_transactions_col):
        docs.extend(await col.find(query, _PROJECTION).to_list(None))
    return SpendingContext.from_docs(docs, kinds, identity)


async def try_build_spending_context(*args, **kwargs) -> SpendingContext | None:
    """``build_spending_context`` for read-only surfaces that must still answer
    when the own-account lookup fails: logs the failure and returns None, which
    callers read as "no own-account moves known" (the kind-only reading, exactly
    the behaviour before G268). Never raises."""
    try:
        return await build_spending_context(*args, **kwargs)
    except Exception:
        logger.exception("spending: own-account lookup failed")
        return None


# ── The predicates callers use ───────────────────────────────────────────────

def txn_flow(txn: dict, ctx: SpendingContext) -> Flow:
    """Classify one transaction dict (raw document or a normalised row with
    ``category``/``custom_category``, ``debit``/``is_debit``/``transaction_type``
    and ``id``/``_id``)."""
    own = bool(txn.get("own_move")) or ctx.is_own_move(_txn_id(txn))
    return classify_flow(ctx.kinds, _effective_category(txn), _is_debit(txn), own)


def is_spending(txn: dict, ctx: SpendingContext) -> bool:
    """True when ``txn`` is a payment that counts as spending."""
    return txn_flow(txn, ctx).counts_as_spend


def spend_amount(txn: dict, ctx: SpendingContext) -> float:
    """Signed contribution to spending: +payment, -refund, 0 otherwise."""
    return txn_flow(txn, ctx).signed(txn.get("amount") or 0)


def bulk_spend_amounts(txns: list[dict], ctx: SpendingContext) -> list[float]:
    """``spend_amount`` for every row, in order."""
    return [spend_amount(t, ctx) for t in txns]


def bulk_is_spending(txns: list[dict], ctx: SpendingContext) -> list[bool]:
    """``is_spending`` for every row, in order."""
    return [is_spending(t, ctx) for t in txns]
