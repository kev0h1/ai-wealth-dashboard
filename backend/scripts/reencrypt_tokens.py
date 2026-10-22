#!/usr/bin/env python3
"""A171: move every stored Fernet ciphertext from the previous token key to the
primary one, so TOKEN_ENCRYPTION_KEY_PREVIOUS can be removed after a rotation.

Every field that holds ciphertext written by app.core.crypto.encrypt_token
(grep of every encrypt_token/decrypt_token call site, 2026-10-22):

  connections.access_token      TrueLayer access token   (services/truelayer_sync.py)
  connections.refresh_token     TrueLayer refresh token  (services/truelayer_sync.py)
  yapily_consents.token         Yapily consent token     (legacy rows only; the
                                Yapily code is removed but the data is kept)

Finexer consents hold no stored credential, so there is nothing to rewrite there.
If a new encrypt_token call site is added, add its collection and field to
TARGETS below.

Behaviour:
  * Dry run by default: prints counts per collection and field, writes nothing.
    --apply writes.
  * A value is rewritten only when it opens under the PREVIOUS key and not the
    primary. Already-primary values, legacy plaintext (the startup migration
    owns those) and values no key opens are left alone and counted.
  * Idempotent and resumable: a rerun finds only what is left. Each write is a
    compare-and-set on the old ciphertext, so a concurrent change is never
    clobbered (it is counted as "changed concurrently" and picked up next run).
  * Never prints plaintext, ciphertext, keys or document ids; counts only.
  * Exit 0 when nothing remains under the previous key and nothing is unknown,
    1 otherwise (so it can gate removing TOKEN_ENCRYPTION_KEY_PREVIOUS).

Usage (from backend/, with TOKEN_ENCRYPTION_KEY and TOKEN_ENCRYPTION_KEY_PREVIOUS
in the environment, the same values the running service has):

    .venv/bin/python scripts/reencrypt_tokens.py            # dry run
    .venv/bin/python scripts/reencrypt_tokens.py --apply
"""
import argparse
import asyncio
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

# (collection attribute on app.db.collections, fields holding ciphertext)
TARGETS = [
    ("connections_col", ("access_token", "refresh_token")),
    ("yapily_consents_col", ("token",)),
]

STATES = ("primary", "previous", "plaintext", "unknown", "empty")


async def reencrypt(targets, ring, apply: bool) -> dict:
    """targets: iterable of (name, collection, fields). Returns
    {(name, field): {state: count, 'rewritten': n, 'raced': n}}."""
    report: dict = {}
    for name, col, fields in targets:
        for field in fields:
            row = {s: 0 for s in STATES}
            row["rewritten"] = 0
            row["raced"] = 0
            report[(name, field)] = row
            docs = col.find({field: {"$exists": True}}, {field: 1})
            async for doc in docs:
                value = doc.get(field)
                state = ring.classify(value)
                row[state] += 1
                if state != "previous" or not apply:
                    continue
                new_value = ring.reencrypt_if_previous(value)
                if new_value is None:
                    continue
                res = await col.update_one(
                    {"_id": doc["_id"], field: value}, {"$set": {field: new_value}}
                )
                if getattr(res, "modified_count", 1):
                    row["rewritten"] += 1
                else:
                    row["raced"] += 1
    return report


def format_report(report: dict, apply: bool) -> str:
    lines = [f"mode: {'APPLY' if apply else 'dry run (nothing written)'}"]
    for (name, field), row in report.items():
        lines.append(
            f"{name}.{field}: primary={row['primary']} previous={row['previous']} "
            f"plaintext={row['plaintext']} unknown={row['unknown']} "
            f"rewritten={row['rewritten']} changed_concurrently={row['raced']}"
        )
    return "\n".join(lines)


def remaining(report: dict, apply: bool) -> int:
    """Values still under the previous key (after this run) plus unknown ones."""
    n = 0
    for row in report.values():
        n += row["unknown"] + row["previous"] - (row["rewritten"] if apply else 0)
    return n


async def run(apply: bool) -> int:
    from app.core.crypto import get_ring
    from app.db import collections as cols

    ring = get_ring()
    if not ring.has_previous:
        print("TOKEN_ENCRYPTION_KEY_PREVIOUS is not set: nothing to move from.", file=sys.stderr)
        return 2
    targets = [(name, getattr(cols, name), fields) for name, fields in TARGETS]
    report = await reencrypt(targets, ring, apply)
    print(format_report(report, apply))
    left = remaining(report, apply)
    if left == 0:
        print("remaining under previous key or unreadable: 0 (previous key can be removed)")
        return 0
    print(f"remaining under previous key or unreadable: {left}")
    return 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="write (default is a dry run)")
    a = ap.parse_args(argv)
    return asyncio.run(run(a.apply))


if __name__ == "__main__":
    sys.exit(main())
