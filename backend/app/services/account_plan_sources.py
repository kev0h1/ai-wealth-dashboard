"""Source-account handling for the Account plan list.

This deliberately owns only the user-selected source metadata.  It does not
participate in allocation reserves or commitment feasibility calculations.
"""
from __future__ import annotations

import math

from fastapi import HTTPException

from app.db.collections import accounts_col, manual_accounts_col, yapily_accounts_col
from app.services.account_kinds import (
    is_credit_card_account,
    is_current_account,
    is_savings_account,
)


def _account_id(doc: dict) -> str:
    return str(doc.get("_id") or "")


def _is_eligible(doc: dict, *, manual: bool) -> bool:
    """Whether an owned account can pay for a plan.

    Manual accounts pre-date the connected-account currency field and represent
    GBP cash records, so their absent currency is treated as GBP. Connected
    accounts must say GBP explicitly.
    """
    if is_credit_card_account(doc) or doc.get("account_type") == "credit_card":
        return False
    currency = str(doc.get("currency") or ("GBP" if manual else "")).upper()
    if currency != "GBP":
        return False
    subtype = str(doc.get("account_subtype") or doc.get("subtype") or "").upper()
    account_type = str(doc.get("account_type") or doc.get("type") or "").upper()
    return (
        manual
        or is_current_account(doc)
        or is_savings_account(doc)
        or "CASH" in subtype
        or account_type == "CASH"
    )


async def owned_account_map(uid: str) -> dict[str, dict]:
    """All owned account documents, keyed by their public string id."""
    out: dict[str, dict] = {}
    for col, manual in (
        (accounts_col, False),
        (yapily_accounts_col, False),
        (manual_accounts_col, True),
    ):
        for doc in await col.find({"user_id": uid}).to_list(None):
            aid = _account_id(doc)
            if aid:
                out[aid] = {**doc, "_account_plan_manual": manual}
    return out


def account_label(doc: dict | None, fallback: str = "") -> str:
    account = doc or {}
    label = " ".join(str(account.get("name") or account.get("display_name") or fallback).split())
    return label or "Unknown account"


def eligible_source_account_map(
    account_map: dict[str, dict], destination_ids: set[str],
) -> dict[str, dict]:
    """Eligible source universe, retaining destinations for name affinity."""
    return {
        aid: doc for aid, doc in account_map.items()
        if aid in destination_ids or _is_eligible(
            doc, manual=bool(doc.get("_account_plan_manual")),
        )
    }


def owned_plan_balance(doc: dict) -> float | None:
    """Read a known-owned plan balance without an id-based database fallback.

    Connected records use the same balance field precedence as commitments'
    live-balance reader; manual records only have their tracked `balance`.
    `None` means the record has no usable balance at all, not zero.
    """
    manual = bool(doc.get("_account_plan_manual"))
    fields = ("balance",) if manual else ("balance", "current_balance", "available_balance")
    for field in fields:
        if field not in doc or doc[field] is None:
            continue
        try:
            value = float(doc[field])
            return value if math.isfinite(value) else None
        except (TypeError, ValueError):
            return None
    return None


def validate_source_account(
    raw, account_map: dict[str, dict], destination_ids: set[str],
) -> str | None:
    """Validate an explicit source. `None` is the intentional opt-out."""
    if raw is None:
        return None
    if not isinstance(raw, str) or not raw.strip():
        raise HTTPException(400, "source_account_id must be an account id or null")
    aid = raw.strip()
    doc = account_map.get(aid)
    if aid in destination_ids or doc is None or not _is_eligible(
        doc, manual=bool(doc.get("_account_plan_manual")),
    ):
        raise HTTPException(400, "source account not found or not eligible")
    return aid


def chosen_source(
    doc: dict, account_map: dict[str, dict], destination_ids: set[str],
) -> tuple[str | None, str]:
    """Return an explicit source if it remains usable, otherwise unknown.

    The presence check is important: a persisted null is a deliberate opt-out,
    while a legacy document without the field remains eligible for inference.
    """
    if "source_account_id" not in doc:
        return None, "legacy"
    source = doc.get("source_account_id")
    if source is None:
        return None, "unknown"
    aid = str(source)
    candidate = account_map.get(aid)
    if aid in destination_ids or candidate is None or not _is_eligible(
        candidate, manual=bool(candidate.get("_account_plan_manual")),
    ):
        return None, "unknown"
    return aid, "chosen"
