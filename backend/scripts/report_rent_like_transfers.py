#!/usr/bin/env python3
"""G280: READ-ONLY report of Transfer-category debits that look like rent.

Before G280 there was no Rent category, so a rent standing order or a payment
to a landlord or letting agent could sit in Transfer (never counted as
spending). This counts them. It never writes: only find() is used, and it
changes no data.

Output is aggregate counts only: how many debits, how many users (never who),
the total amount, and how many matched each trigger word. Merchant names,
descriptions, user ids and emails are never printed. --per-user adds one line
per user with a short SHA-256 prefix of the id and a count.

Usage (from backend/, with the .env the service uses):
    .venv/bin/python scripts/report_rent_like_transfers.py [--per-user]
"""
import argparse
import hashlib
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pymongo import MongoClient  # noqa: E402

from app.core.config import MONGO_DB, MONGO_URI  # noqa: E402
from app.services.categorisation import RENT_TRIGGER_WORDS, is_rent_payee  # noqa: E402

_BOUNDARY = r"(?<![A-Za-z0-9])(?:{})(?![A-Za-z0-9])"
_WORD_PATTERNS = [
    (w.split("(")[0] if w.startswith("rent(") else w, re.compile(_BOUNDARY.format(w), re.I))
    for w in RENT_TRIGGER_WORDS
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-user", action="store_true", help="one hashed line per user, counts only")
    args = ap.parse_args()

    db = MongoClient(MONGO_URI, serverSelectionTimeoutMS=8000)[MONGO_DB]
    query = {
        "transaction_type": "debit",
        "$or": [{"custom_category": "Transfer"}, {"custom_category": None, "category": "Transfer"}],
    }
    proj = {"user_id": 1, "merchant_name": 1, "description": 1, "amount": 1}
    scanned = matched = 0
    total = 0.0
    words: Counter = Counter()
    users: Counter = Counter()
    for t in db["transactions"].find(query, proj):
        scanned += 1
        text = f"{t.get('merchant_name') or ''} {t.get('description') or ''}"
        if not is_rent_payee(text):
            continue
        matched += 1
        total += abs(float(t.get("amount") or 0))
        users[hashlib.sha256(str(t.get("user_id", "")).encode()).hexdigest()[:12]] += 1
        for label, pat in _WORD_PATTERNS:
            if pat.search(text):
                words[label] += 1
    print(f"db={MONGO_DB} transfer_debits_scanned={scanned} rent_like={matched} "
          f"users_affected={len(users)} total_amount={total:.2f}")
    for label, n in words.most_common():
        print(f"trigger {label!r}: {n}")
    if args.per_user:
        for h, n in users.most_common():
            print(f"{h}  {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
