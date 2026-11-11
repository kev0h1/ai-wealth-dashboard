"""Shared identity and field helpers for G453 correction scopes.

The correction executor owns database writes.  This module keeps the exact
identity and typed destination shape shared by that executor and sync-time
future-rule application.
"""
from __future__ import annotations

from hashlib import sha256
from typing import Any, Optional

from app.services.categorisation import canonical_merchant_key

SCOPED_CORRECTION_KINDS = frozenset({"one", "history", "history-future", "rule"})
TYPED_RULE_KIND = "scoped-correction"


def correction_identity(row: dict) -> Optional[tuple[str, str, str]]:
    """Return the stable user-visible payment identity for a booked row."""
    key = str(row.get("merchant_key") or "").strip()
    if not key:
        key = canonical_merchant_key(row.get("merchant_name") or "", row.get("description") or "")
    direction = str(row.get("transaction_type") or "").strip().lower()
    currency = str(row.get("currency") or "").strip().upper()
    if len(key) < 3 or direction not in {"debit", "credit"} or not currency:
        return None
    return key, direction, currency


def is_booked_payment(row: dict) -> bool:
    """Pending and planned entries never belong to a correction scope."""
    return (
        row.get("is_pending") is not True
        and row.get("pending") is not True
        and row.get("planned") is not True
        and str(row.get("status") or "").strip().lower() != "pending"
    )


def correction_fields(
    category: str,
    *,
    goal_id: Optional[str] = None,
    offline_account_id: Optional[str] = None,
    card_repayment: bool = False,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Build mutually-exclusive saved destination fields for a correction."""
    set_fields: dict[str, Any] = {"custom_category": category}
    unset_fields: dict[str, str] = {}
    if goal_id:
        set_fields["linked_goal_id"] = goal_id
        unset_fields.update({"linked_offline_account_id": "", "card_repayment_taught": "", "card_repayment_rule": ""})
    elif offline_account_id:
        set_fields["linked_offline_account_id"] = offline_account_id
        unset_fields.update({"linked_goal_id": "", "card_repayment_taught": "", "card_repayment_rule": ""})
    elif card_repayment:
        set_fields["card_repayment_taught"] = True
        unset_fields.update({"linked_goal_id": "", "linked_offline_account_id": "", "card_repayment_rule": ""})
    else:
        unset_fields.update({"linked_goal_id": "", "linked_offline_account_id": "", "card_repayment_taught": "", "card_repayment_rule": ""})
    return set_fields, unset_fields


def make_correction_rule(
    uid: str,
    identity: tuple[str, str, str],
    *,
    operation_id: str,
    label: str,
    fields: tuple[dict[str, Any], dict[str, str]],
    stamp: Any,
) -> dict[str, Any]:
    """Build a deterministic, typed rule document for one exact identity."""
    merchant_key, direction, currency = identity
    merchant_key = str(merchant_key or "").strip()
    direction = str(direction or "").strip().lower()
    currency = str(currency or "").strip().upper()
    if len(merchant_key) < 3 or direction not in {"debit", "credit"} or not currency:
        raise ValueError("Invalid typed correction identity")
    digest = sha256(f"{uid}\x1f{merchant_key}\x1f{direction}\x1f{currency}".encode()).hexdigest()
    set_fields, unset_fields = fields
    allowed_set = {"custom_category", "linked_goal_id", "linked_offline_account_id", "card_repayment_taught"}
    allowed_unset = {"linked_goal_id", "linked_offline_account_id", "card_repayment_taught", "card_repayment_rule"}
    if (
        not isinstance(set_fields, dict)
        or not isinstance(unset_fields, dict)
        or set(set_fields) - allowed_set
        or set(unset_fields) - allowed_unset
        or not isinstance(set_fields.get("custom_category"), str)
        or not set_fields["custom_category"].strip()
    ):
        raise ValueError("Invalid typed correction fields")
    destinations = {key for key in ("linked_goal_id", "linked_offline_account_id", "card_repayment_taught") if set_fields.get(key)}
    if len(destinations) > 1:
        raise ValueError("A typed correction can have only one destination")
    return {
        "_id": f"scoped-correction::{digest}",
        "uid": uid,
        "kind": TYPED_RULE_KIND,
        "identity": {"merchant_key": merchant_key, "transaction_type": direction, "currency": currency},
        "description": label,
        "pattern": "",  # Retained for the established /rules response shape.
        "category": set_fields["custom_category"],
        "correction_set": dict(set_fields),
        "correction_unset": dict(unset_fields),
        "operation_id": operation_id,
        "created_at": stamp,
    }
