"""Income evidence after row corrections, before recurring detection.

A correction must be considered alongside the older credits it corrects.
Filtering to Income first loses that instruction and can recreate a forecast
from older rows, or from the confirmed-schedule fallback.
"""
from collections import defaultdict
from dataclasses import dataclass

from app.services.categorisation import series_key
from app.services.income_payer import payer_key, payer_tokens
from app.services.recurring_category import series_category


async def historical_income_context(uid, cutoff, current_rows, collections, projection, *, include_pairs):
    """Read enduring instructions without extending forecast history.

    Corrections do not expire when their transactions leave the 180-day
    window. Pair markers also need their actual counterpart, never a stale
    flag alone. All reads are user-scoped; no preferences are rewritten.
    """
    choices = [{"transaction_type": "credit", "custom_category": {"$nin": [None, ""]}}]
    if include_pairs:
        choices.append({"own_transfer_match": {"$exists": True}})
    history = []
    for collection in collections:
        history.extend(await collection.find(
            {"user_id": uid, "date": {"$lt": cutoff}, "$or": choices}, projection,
        ).to_list(None))
    known = {str(row.get("_id")) for row in [*current_rows, *history]}
    missing = {
        str(marker["counterpart_id"]) for row in history
        if isinstance(marker := row.get("own_transfer_match"), dict) and marker.get("counterpart_id")
        and str(marker["counterpart_id"]) not in known
    }
    if missing:
        for collection in collections:
            history.extend(await collection.find(
                {"user_id": uid, "_id": {"$in": list(missing)}}, projection,
            ).to_list(None))
    return history


@dataclass
class IncomeEvidence:
    credits: list[dict]
    groups: dict[str, list[dict]]
    blocked: set[str]

    def confirmed(self, streams: dict[str, dict]) -> dict[str, dict]:
        """Keep schedules unless their own available evidence contradicts them.

        Old confirmations have raw statement keys with no account field.
        They may describe several same-named payers on different accounts:
        don't reuse their schedule when any matching account group is
        blocked: a mixed set is ambiguous, not permission to move an old
        confirmation onto another account. Unblocked receipts still detect
        independently, and the stored preference is never deleted.
        Missing evidence is not a correction (a real salary can age out).
        """
        result = {}
        for key, stream in streams.items():
            if key == "manual":
                result[key] = stream
                continue
            if "::" in key:
                # Modern payer keys are already account-specific. Never
                # alias their token portion onto a different account.
                matching = {key} if key in self.groups else set()
            else:
                tokens = payer_tokens(key)
                account = stream.get("account_id")
                matching = {
                    group_key for group_key, rows in self.groups.items()
                    if (not account or str(rows[0].get("account_id") or "") == str(account))
                    and any(
                        series_key(row) == key
                        or (tokens and payer_tokens(f"{row.get('merchant_name') or ''} {row.get('description') or ''}") == tokens)
                        for row in rows
                    )
                }
            if not matching.intersection(self.blocked):
                result[key] = stream
        return result


def select_income_evidence(rows: list[dict]) -> IncomeEvidence:
    """Use all booked credits to honour the latest correction per payer.

    Automatic matching remains row-specific: a matched transfer is excluded,
    but cannot teach that an unrelated receipt with the same name is a move.
    The caller revalidates pair markers before supplying these rows.
    """
    groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        if row.get("transaction_type") == "credit" and not row.get("is_pending"):
            groups[payer_key(row)].append(row)
    credits = []
    blocked = set()
    for key, group in groups.items():
        corrected = any(row.get("custom_category") for row in group)
        eligible = [row for row in group if (row.get("custom_category") or row.get("category")) == "Income"]
        # A provider's Other/missing category is not evidence that a
        # confirmed salary stopped. Only an explicit correction, or wholly
        # validated own-transfer evidence, can suppress that fallback.
        own_transfers_only = all(row.get("own_transfer_match") for row in group) and not eligible
        if (corrected and series_category(group) != "Income") or own_transfers_only:
            blocked.add(key)
        else:
            credits.extend(eligible)
    return IncomeEvidence(credits, dict(groups), blocked)
