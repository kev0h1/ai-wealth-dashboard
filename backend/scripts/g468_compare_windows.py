"""G468: compare the old same-day own-transfer rule with the new 24 hour / 3 day windows.

READ-ONLY. It loads one user's accounts, transactions, learned pairs and name tokens with
`find()` only (no write, no recompute, no cache warm, no queue, no model call), then runs
BOTH rules as pure functions over those rows in memory and prints:

  1. counts per rule: automatic / ask / none
  2. every pair that would file AUTOMATICALLY under the new rule: date, amount, the two
     account labels, the two descriptions and why (name, counterparty, learned, model),
     flagged when the old rule would not have filed it.

Usage (from backend/):  python scripts/g468_compare_windows.py --user-email someone@example.com

Which database it reads is whatever MONGO_DB / MONGO_URI the process is configured with
(printed first). Only run it against a database you mean to read.

Definitions
  automatic  a pair the matcher files without asking (`select_unique_pairs_detailed`, non-card).
  ask        a candidate pair (same amount, opposite directions, two own accounts, in the
             rule's timing window, not pruned) that is NOT automatic. An upper bound on what
             the review asks: the review's evidence gate is not applied here.
  none       same-amount opposite legs on two own accounts within 14 days that the rule does
             not offer at all.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

NONE_LOOKAROUND = timedelta(days=14)


def _old_timing(oat):
    """G447's rule as a function: same London calendar day, a card repayment within
    CARD_REPAY_DAYS, or a learned pair on any date."""
    def old_pair_timing_ok(credit, debit, accounts=None, learned=frozenset(), keys=None):
        c_date, d_date = credit.get("date"), debit.get("date")
        if not isinstance(c_date, datetime) or not isinstance(d_date, datetime):
            return False
        if oat.same_calendar_day(c_date, d_date):
            return True
        from app.services.transfer_pruning import _is_card_account
        accounts = accounts or {}
        if _is_card_account(accounts.get(credit.get("account_id"))) or _is_card_account(accounts.get(debit.get("account_id"))):
            if oat.pair_gap_days(c_date, d_date) <= oat.CARD_REPAY_DAYS:
                return True
        return bool(learned) and oat.learned_match(learned, credit, debit, keys)

    def old_within_auto_window(a, b):
        da = a.get("date") if isinstance(a, dict) else a
        db = b.get("date") if isinstance(b, dict) else b
        return oat.same_calendar_day(da, db)

    return old_pair_timing_ok, old_within_auto_window


@contextmanager
def _rule(oat, which: str):
    """Temporarily point the module's timing functions at the old rule (in memory only)."""
    if which == "new":
        yield
        return
    old_timing, old_auto = _old_timing(oat)
    saved = (oat.pair_timing_ok, oat.within_auto_window)
    oat.pair_timing_ok, oat.within_auto_window = old_timing, old_auto
    try:
        yield
    finally:
        oat.pair_timing_ok, oat.within_auto_window = saved


def classify(rows: list[dict], accounts: dict, name_tokens: list[str], learned: set, which: str, movement: set | None = None) -> dict:
    """Pure: {"automatic": [(credit, debit)], "ask": [...], "none": [...]} for one rule."""
    import app.services.own_account_transfers as oat
    from app.services.categories import BUILTIN_CATEGORY_KINDS, MOVEMENT
    movement = movement if movement is not None else {n for n, k in BUILTIN_CATEGORY_KINDS.items() if k == MOVEMENT}
    with _rule(oat, which):
        auto_detailed = oat.select_unique_pairs_detailed(rows, accounts, name_tokens, learned, movement_categories=movement)
        _, consumed = oat._confirmed_pairs(rows, accounts, movement)
        built = list(oat._same_amount_pairs(rows, accounts, movement, consumed=consumed, exclude_ids=frozenset(),
                                            learned=learned, name_tokens=name_tokens))
    auto = [(c, d) for c, d, issuer in auto_detailed if not issuer]
    auto_ids = {(c["_id"], d["_id"]) for c, d in auto}
    offered = {(c["_id"], d["_id"]) for c, d, _ in built}
    ask = [(c, d) for c, d, issuer in built if issuer is None and (c["_id"], d["_id"]) not in auto_ids]
    none = []
    credits = [r for r in rows if r.get("transaction_type") == "credit" and not r.get("is_pending")]
    debits = [r for r in rows if r.get("transaction_type") == "debit" and not r.get("is_pending")]
    for c in credits:
        key = oat._pair_key(c)
        ic = oat.leg_instant(c)
        if key is None or ic is None:
            continue
        for d in debits:
            if d.get("account_id") == c.get("account_id") or oat._pair_key(d) != key:
                continue
            if c.get("account_id") not in accounts or d.get("account_id") not in accounts:
                continue
            idb = oat.leg_instant(d)
            if idb is not None and abs(ic - idb) <= NONE_LOOKAROUND and (c["_id"], d["_id"]) not in offered:
                none.append((c, d))
    return {"automatic": auto, "ask": ask, "none": none}


def why(credit: dict, debit: dict, accounts: dict, name_tokens: list[str], learned: set) -> str:
    import app.services.own_account_transfers as oat
    from app.services.categorisation import _text_has_account_pair
    reasons = []
    if oat.learned_match(learned, credit, debit):
        reasons.append("learned pair")
    ct, dt = oat._text(credit), oat._text(debit)
    if oat._compact_owner_name(ct, name_tokens) or oat._compact_owner_name(dt, name_tokens):
        reasons.append("owner name on a leg")
    elif (oat.account_name_in_text(ct, accounts.get(debit.get("account_id"))) or oat.account_name_in_text(dt, accounts.get(credit.get("account_id")))):
        reasons.append("account name on a leg")
    for text, other in ((ct, accounts.get(debit.get("account_id"))), (dt, accounts.get(credit.get("account_id")))):
        key = oat.counterparty_key((other or {}).get("sort_code"), (other or {}).get("account_number"))
        if key is not None and _text_has_account_pair(text, key[0], key[1]):
            reasons.append("sort code and account number in text")
            break
    if (oat.counterparty_matches_account(credit, accounts.get(debit.get("account_id")))
            or oat.counterparty_matches_account(debit, accounts.get(credit.get("account_id")))):
        reasons.append("bank counterparty fields")
    return ", ".join(reasons) or "other evidence (model verdict or movement choice)"


def label(accounts: dict, account_id) -> str:
    a = accounts.get(account_id) or {}
    return " ".join(str(x) for x in (a.get("provider"), a.get("display_name") or a.get("name")) if x) or str(account_id)


def report(rows: list[dict], accounts: dict, name_tokens: list[str], learned: set) -> str:
    import app.services.own_account_transfers as oat
    old = classify(rows, accounts, name_tokens, learned, "old")
    new = classify(rows, accounts, name_tokens, learned, "new")
    old_auto = {(c["_id"], d["_id"]) for c, d in old["automatic"]}
    lines = ["rule  automatic  ask  none"]
    for name, res in (("old (same London day)", old), ("new (24 h auto / 3 day ask)", new)):
        lines.append(f"{name}: automatic={len(res['automatic'])} ask={len(res['ask'])} none={len(res['none'])}")
    lines += ["", f"Pairs filing automatically under the new rule ({len(new['automatic'])}):"]
    for c, d in sorted(new["automatic"], key=lambda p: oat.leg_instant(p[0]) or datetime.min):
        gap = oat.pair_gap(c, d)
        flag = "" if (c["_id"], d["_id"]) in old_auto else "  [NEW: old rule would not file this]"
        lines.append(
            f"- {oat.leg_instant(c):%Y-%m-%d %H:%M} / {oat.leg_instant(d):%Y-%m-%d %H:%M}  {oat._pennies(c.get('amount'))}  "
            f"{label(accounts, c.get('account_id'))} <- {label(accounts, d.get('account_id'))}  "
            f"in: {oat._text(c).strip()!r}  out: {oat._text(d).strip()!r}  gap {gap}  why: {why(c, d, accounts, name_tokens, learned)}{flag}")
    return "\n".join(lines)


async def load(user_email: str):
    """find() only. Returns (rows, accounts, name_tokens, learned)."""
    import app.db.collections as cols
    import app.services.own_account_transfers as oat
    print(f"[read-only] database: {cols.db.name}")
    accounts = {a["_id"]: a async for a in cols.accounts_col.find({"user_id": user_email})}
    profile = await cols.user_profiles_col.find_one({"_id": user_email}, {"name_tokens": 1}) or {}
    learned_docs = await cols.confirmed_transfer_pairs_col.find({"user_id": user_email}, {"key_a": 1, "key_b": 1, "source": 1}).to_list(None)
    cutoff = datetime.utcnow() - timedelta(days=oat.HISTORY_DAYS)  # naive-ok: Mongo booked dates are naive UTC
    projection = {"account_id": 1, "amount": 1, "currency": 1, "date": 1, "transaction_type": 1, "merchant_name": 1,
                  "description": 1, "category": 1, "custom_category": 1, "is_pending": 1, "own_transfer_match": 1,
                  "party_sort_code": 1, "party_number": 1, "bank_code": 1, "first_seen": 1, "activity_date": 1}
    rows = await cols.transactions_col.find(
        {"user_id": user_email, "date": {"$gte": cutoff}, "transaction_type": {"$in": ["credit", "debit"]}}, projection).to_list(None)
    rows = [{**r, "currency": str(r.get("currency") or accounts.get(r.get("account_id"), {}).get("currency") or "").upper()} for r in rows]
    return rows, accounts, profile.get("name_tokens") or [], oat._learned_pair_keys(learned_docs)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--user-email", required=True)
    args = parser.parse_args(argv)
    rows, accounts, tokens, learned = asyncio.run(load(args.user_email))
    print(report(rows, accounts, tokens, learned))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
