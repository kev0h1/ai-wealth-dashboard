"""A28: mint, list and revoke bot/service credentials — the operational
tool for `app.core.bot_credentials`/`app.db.collections.bot_credentials_col`,
the replacement for the single static `BOT_SECRET`.

There is deliberately NO HTTP route that does any of this: minting only
ever happens from here, talking to Mongo directly with whatever
`MONGO_URI` `backend/.env` (or the process environment, on Railway) points
at. Rotation is therefore just "run `create`, update whatever's holding
the old token, run `revoke` on the old one" — no env var to edit, no
redeploy, no process restart; the very next request with the new token
picks it up.

Usage (always from `backend/`, with the venv, same convention as
`scripts_merchant_key_backfill.py`):

    backend/.venv/bin/python scripts_bot_credential.py create --name usage-dashboard --scopes admin:usage
    backend/.venv/bin/python scripts_bot_credential.py list
    backend/.venv/bin/python scripts_bot_credential.py revoke --name usage-dashboard

`create` prints the raw token EXACTLY ONCE, to stdout, and never stores it
anywhere (only its SHA-256 hash is written to Mongo) — if it's lost,
revoke it and mint a new one, there is no recovery path, by design.
"""
import argparse
import asyncio
import sys
from datetime import datetime, timezone

from app.core.bot_credentials import SCOPES, default_expiry, hash_token, mint_token
from app.core.config import BOT_CREDENTIAL_DEFAULT_TTL_DAYS, PRIMARY_EMAIL
from app.db.collections import bot_credentials_col


async def create(name: str, scopes: list[str], created_by: str, expires_days: int | None = None) -> tuple[str, datetime]:
    bad = [s for s in scopes if s not in SCOPES]
    if bad:
        raise SystemExit(f"Unknown scope(s): {', '.join(bad)}. Valid scopes: {', '.join(sorted(SCOPES))}")
    if not scopes:
        raise SystemExit("At least one --scopes value is required (see --list-scopes).")
    if expires_days is not None and expires_days <= 0:
        raise SystemExit("--expires-days must be a positive integer (there is no eternal option — see A32).")
    token = mint_token()
    now = datetime.now(timezone.utc)
    expires_at = default_expiry(expires_days)
    await bot_credentials_col.insert_one({
        "_id": hash_token(token),
        "name": name,
        "scopes": sorted(set(scopes)),
        "created_at": now,
        "created_by": created_by,
        "revoked_at": None,
        "expires_at": expires_at,
        "last_used_at": None,
        "last_used_path": None,
    })
    return token, expires_at


async def revoke(name: str) -> int:
    now = datetime.now(timezone.utc)
    result = await bot_credentials_col.update_many(
        {"name": name, "revoked_at": None},
        {"$set": {"revoked_at": now}},
    )
    return result.modified_count


async def list_credentials() -> list[dict]:
    docs = await bot_credentials_col.find({}).sort("created_at", -1).to_list(None)
    return docs


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p_create = sub.add_parser("create", help="Mint a new credential; prints the raw token once.")
    p_create.add_argument("--name", required=True, help="Human label, e.g. 'usage-dashboard'.")
    p_create.add_argument(
        "--scopes", required=True,
        help=f"Comma-separated scopes. Valid: {', '.join(sorted(SCOPES))}",
    )
    p_create.add_argument(
        "--created-by", default=PRIMARY_EMAIL,
        help="Who minted this (accountability trail). Defaults to the owner's own email.",
    )
    p_create.add_argument(
        "--expires-days", type=int, default=None,
        help=(
            "Lifetime in days from now (A32: every credential expires, there is "
            f"no eternal option). Defaults to BOT_CREDENTIAL_DEFAULT_TTL_DAYS "
            f"({BOT_CREDENTIAL_DEFAULT_TTL_DAYS})."
        ),
    )

    p_revoke = sub.add_parser("revoke", help="Revoke every active credential with this name.")
    p_revoke.add_argument("--name", required=True)

    sub.add_parser("list", help="List every credential (name/scopes/timestamps, never the token).")

    args = parser.parse_args()

    if args.command == "create":
        scopes = [s.strip() for s in args.scopes.split(",") if s.strip()]
        token, expires_at = await create(args.name, scopes, args.created_by, args.expires_days)
        print("Created credential. Store this token now — it is never shown again:\n")
        print(f"  {token}\n")
        print(f"name={args.name} scopes={sorted(set(scopes))} expires_at={expires_at.isoformat()}")
        return 0

    if args.command == "revoke":
        n = await revoke(args.name)
        if n == 0:
            print(f"No active credential named '{args.name}' found.")
            return 1
        print(f"Revoked {n} credential(s) named '{args.name}'.")
        return 0

    if args.command == "list":
        docs = await list_credentials()
        if not docs:
            print("No credentials minted yet.")
            return 0
        now = datetime.now(timezone.utc)
        for d in docs:
            expires_at = d.get("expires_at")
            expires_at_aware = (
                expires_at.replace(tzinfo=timezone.utc) if expires_at and expires_at.tzinfo is None else expires_at
            )
            if d.get("revoked_at"):
                status = "revoked"
            elif expires_at_aware is not None and expires_at_aware <= now:
                status = "expired"
            elif expires_at_aware is None:
                status = "active (no expires_at — pre-A32, awaiting migration backfill)"
            else:
                status = "active"
            print(
                f"{d.get('name'):24} {status:8} scopes={d.get('scopes')} "
                f"created_by={d.get('created_by')} created_at={d.get('created_at')} "
                f"expires_at={expires_at} "
                f"last_used_at={d.get('last_used_at')} last_used_path={d.get('last_used_path')}"
            )
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
