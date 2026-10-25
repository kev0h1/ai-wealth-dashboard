#!/usr/bin/env python3
"""H133: reset the production tester data, erasing every user.

DESTRUCTIVE. Kevin runs this by hand, never an agent, never in a test against
a real database. See docs/ops/RESET.md for the runbook.

What it does
  Dry run (the default) discovers every user (the union of user_profiles ids,
  distinct user_id across the erasure manifest and distinct uid across the
  uid-keyed collections) and prints counts only: documents that would be
  deleted per collection, Finexer consents that would be revoked, allow-list
  entries kept, live PAID subscriptions, orphaned revocation markers, the
  database name and the credential-free host. It never prints an email or a
  raw id; users appear as a count or a sha256 prefix.

  --apply, for each user, calls revoke_sessions then
  app.services.retention.erase_user (the shared erasure path: Finexer and
  TrueLayer revoke first, then the manifest sweep, then the uid-field,
  id-prefix and broadcast-recipient sweeps). It then checks that the shared
  collections (allow list, vendors, tip research, settings, settings audit,
  bot credentials, instrument prices) are unchanged and that no orphaned
  revocation marker was removed. Re-running is safe: erase_user is idempotent.

Refuses (exit 2, before any change) unless ALL of: --apply, --yes,
--expect-host equal to the real host, --confirm-db equal to the database name,
--confirm "RESET PRODUCTION", --backup-confirmed, ALLOW_DROP_PROD_DB=1 in the
environment, assert_drop_allowed passes, and no live PAID subscription exists.
Nothing is ever dropped: only delete_many / update_many on documents.

Exit codes: 0 ok, 1 completed with Finexer revoke failures or a kept-count
mismatch, 2 refused.

Usage (from backend/):
    .venv/bin/python scripts/reset_all_users.py --env-file /path/to/prod.env
    ALLOW_DROP_PROD_DB=1 .venv/bin/python scripts/reset_all_users.py \\
        --env-file /path/to/prod.env --apply --yes --expect-host HOST \\
        --confirm-db NAME --confirm "RESET PRODUCTION" --backup-confirmed
"""
import argparse
import asyncio
import hashlib
import os
import re
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

CONFIRM_PHRASE = "RESET PRODUCTION"
ALLOW_ENV = "ALLOW_DROP_PROD_DB"
LIVE_STATUSES = ("active", "trialing", "past_due")
CONSENT_LIVE_STATUSES = ("authorized", "connected")

# Shared collections (attribute names on app.db.collections) that must be
# identical before and after an apply.
KEPT_COLLECTIONS = (
    "allowed_signups_col", "vendors_col", "tip_research_col", "settings_col",
    "settings_audit_col", "bot_credentials_col", "instrument_prices_col",
)
# Markers may only be added (a failed Finexer revoke), never removed.
ORPHANS = "orphaned_revocations_col"


# ── pure helpers ───────────────────────────────────────────────────────────

def uid_hash(uid: str) -> str:
    """Short sha256 prefix used wherever a user must be referred to."""
    return hashlib.sha256((uid or "").encode()).hexdigest()[:12]


def host_from_uri(uri: str) -> str:
    """Credential-free first host of a Mongo URI (srv and multi-host safe)."""
    rest = (uri or "").split("://", 1)[-1]
    netloc = rest.split("/", 1)[0].split("?", 1)[0]
    first = netloc.rsplit("@", 1)[-1].split(",")[0]
    if first.startswith("["):  # IPv6 literal
        return first[1:].split("]", 1)[0].lower()
    return first.split(":", 1)[0].lower()


def paid_provider(sub: dict):
    """Provider label if `sub` is a live PAID subscription, else None.
    Manual seeds (managed_by == "manual", re-created by _seed_subscriptions)
    never count."""
    if sub.get("status") not in LIVE_STATUSES:
        return None
    if sub.get("managed_by") == "manual":
        return None
    provider = sub.get("provider")
    if provider in ("apple", "google"):
        return provider
    if sub.get("stripe_subscription_id") or sub.get("source") == "stripe":
        return "stripe"
    return None


def check_apply_guards(args, db_name: str, host: str, env) -> list:
    """Every reason the apply must be refused. Pure: calls the H96 guard with
    fake or real names alike, touches no database."""
    reasons = []
    if not args.yes:
        reasons.append("--apply needs --yes")
    if not args.expect_host:
        reasons.append("--apply needs --expect-host HOST")
    elif args.expect_host.strip().lower() != host:
        reasons.append("--expect-host does not match the host in MONGO_URI")
    if not args.confirm_db:
        reasons.append("--apply needs --confirm-db NAME")
    elif args.confirm_db != db_name:
        reasons.append("--confirm-db does not match the database name")
    if args.confirm != CONFIRM_PHRASE:
        reasons.append(f'--apply needs --confirm "{CONFIRM_PHRASE}"')
    if not args.backup_confirmed:
        reasons.append(
            "--apply needs --backup-confirmed: take an on-demand Atlas snapshot "
            "first and name it in your notes, then pass the flag"
        )
    if env.get(ALLOW_ENV) != "1":
        reasons.append(f"{ALLOW_ENV}=1 must be set in the environment")
    try:
        from app.db.guard import assert_drop_allowed
        assert_drop_allowed(db_name, args.confirm_db, env)
    except Exception:
        reasons.append("the H96 database guard refused (assert_drop_allowed)")
    return reasons


def format_counts(title: str, counts: dict) -> str:
    lines = [title]
    for name in sorted(counts):
        if counts[name]:
            lines.append(f"  {name}: {counts[name]}")
    if len(lines) == 1:
        lines.append("  (none)")
    return "\n".join(lines)


# ── data access ────────────────────────────────────────────────────────────

def _cols():
    from app.db import collections as cols
    return cols


async def discover_users(cols) -> list:
    users = set()
    async for d in cols.user_profiles_col.find({}, {"_id": 1}):
        users.add(d["_id"])
    for attr in cols.ERASURE_MANIFEST:
        users.update(await getattr(cols, attr).distinct("user_id"))
    for name in cols.UID_FIELD_COLLECTIONS:
        users.update(await cols.db[name].distinct("uid"))
    return sorted(u for u in users if isinstance(u, str) and u)


async def count_for_user(cols, uid: str) -> dict:
    """Documents erase_user would delete (or pull from) for `uid`."""
    out: dict = {}

    def add(label, n):
        if n:
            out[label] = out.get(label, 0) + n

    for attr in cols.ERASURE_MANIFEST:
        col = getattr(cols, attr)
        n = await col.count_documents({"user_id": uid}) + await col.count_documents({"_id": uid})
        add(attr.removesuffix("_col"), n)
    for name in sorted(cols.ERASE_ONLY_COLLECTIONS | cols.RETIRED_COLLECTIONS):
        col = cols.db[name]
        add(name, await col.count_documents({"user_id": uid}) + await col.count_documents({"_id": uid}))
    for name in sorted(cols.UID_FIELD_COLLECTIONS):
        add(f"{name}_uid", await cols.db[name].count_documents({"uid": uid}))
    for name, templates in sorted(cols.ID_PREFIX_COLLECTIONS.items()):
        for template in templates:
            prefix = template.replace("{uid}", uid)
            add(f"{name}_id_prefix", await cols.db[name].count_documents(
                {"_id": {"$regex": "^" + re.escape(prefix)}}))
    add("broadcasts_recipient_pulled", await cols.db[cols.BROADCAST_RECIPIENTS_COLLECTION]
        .count_documents({"recipient_ids": uid}))
    return out


async def paid_subscription_counts(cols) -> dict:
    counts: dict = {}
    async for sub in cols.subscriptions_col.find({"status": {"$in": list(LIVE_STATUSES)}}):
        provider = paid_provider(sub)
        if provider:
            counts[provider] = counts.get(provider, 0) + 1
    return counts


async def kept_counts(cols) -> dict:
    out = {}
    for attr in KEPT_COLLECTIONS + (ORPHANS,):
        out[attr.removesuffix("_col")] = await getattr(cols, attr).count_documents({})
    return out


async def revocable_consents(cols) -> tuple:
    live = await cols.finexer_consents_col.count_documents(
        {"status": {"$in": list(CONSENT_LIVE_STATUSES)}})
    total = await cols.finexer_consents_col.count_documents({})
    return live, total


# ── run ────────────────────────────────────────────────────────────────────

async def run(args, env=None) -> int:
    env = os.environ if env is None else env
    cols = _cols()
    from app.core import config

    db_name = cols.db.name
    host = host_from_uri(config.MONGO_URI)

    users = await discover_users(cols)
    if not args.include_owner:
        owner = config.PRIMARY_EMAIL
        users = [u for u in users if u.strip().lower() != owner]
    total_users = len(users)
    if args.max_users is not None:
        users = users[: max(args.max_users, 0)]

    print(f"database: {db_name}")
    print(f"host: {host}")
    print(f"mode: {'APPLY' if args.apply else 'dry run (nothing will be changed)'}")
    print(f"users discovered: {total_users} (this run: {len(users)})")

    totals: dict = {}
    for uid in users:
        for label, n in (await count_for_user(cols, uid)).items():
            totals[label] = totals.get(label, 0) + n
    print(format_counts("documents that would be deleted:", totals))
    print(f"  total: {sum(totals.values())} (upper bound: a document matched by two sweeps counts twice)")

    live, consents_total = await revocable_consents(cols)
    print(f"finexer consents to revoke: {live} live of {consents_total} total")
    before = await kept_counts(cols)
    print(f"allow-list entries kept: {before['allowed_signups']}")
    print(f"orphaned_revocations markers: {before['orphaned_revocations']}")
    paid = await paid_subscription_counts(cols)
    paid_total = sum(paid.values())
    print(f"live PAID subscriptions: {paid_total}")
    for provider in sorted(paid):
        print(f"  {provider}: {paid[provider]}")

    if not args.apply:
        print("dry run: nothing changed; see docs/ops/RESET.md for the apply step")
        return 0

    reasons = check_apply_guards(args, db_name, host, env)
    if paid_total:
        reasons.append(
            "live PAID subscriptions exist; cancel or let them lapse first "
            "(per-provider counts above)"
        )
    if reasons:
        print("refusing before any change:", file=sys.stderr)
        for r in reasons:
            print(f"  - {r}", file=sys.stderr)
        return 2

    from app.core.session_revocation import revoke_sessions
    from app.services import retention

    removed_total: dict = {}
    failed_users = 0
    for uid in users:
        try:
            await revoke_sessions(uid)
            removed = await retention.erase_user(uid)
        except Exception as exc:  # never echo the message: it may carry an id
            failed_users += 1
            print(f"user {uid_hash(uid)}: FAILED ({type(exc).__name__})")
            continue
        for k, v in removed.items():
            removed_total[k] = removed_total.get(k, 0) + v
        print(f"user {uid_hash(uid)}: erased ({sum(removed.values())} items)")

    print(format_counts("removed:", removed_total))

    after = await kept_counts(cols)
    exit_code = 0
    changed = []
    for name in before:
        if name == "orphaned_revocations":
            ok = after[name] >= before[name]
        else:
            ok = after[name] == before[name]
        print(f"kept: {name}: {after[name]} (before {before[name]})")
        if not ok:
            changed.append(name)
    if changed:
        print(f"ERROR: shared collection(s) changed: {', '.join(changed)}", file=sys.stderr)
        exit_code = 1

    new_markers = after["orphaned_revocations"] - before["orphaned_revocations"]
    if new_markers > 0:
        print(
            f"Finexer revokes that failed and must be retried: {new_markers}. "
            "Re-run this script (it is idempotent) or wait for the nightly retry, "
            "and confirm in the Finexer dashboard that no consents remain active."
        )
        exit_code = 1
    else:
        print("Confirm in the Finexer dashboard that no consents remain active.")
    if failed_users:
        print(f"ERROR: {failed_users} user(s) failed; re-run to finish them", file=sys.stderr)
        exit_code = 1
    print("Note: _seed_subscriptions recreates the manual subscription docs on the next API start; that is expected.")
    print(f"summary: users processed {len(users) - failed_users}/{len(users)}, "
          f"documents removed {sum(removed_total.values())}, exit {exit_code}")
    return exit_code


def _load_env_file(path: Path) -> None:
    """Copy ONLY MONGO_URI and MONGO_DB from `path` into os.environ."""
    wanted = {"MONGO_URI", "MONGO_DB"}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        if k.startswith("export "):
            k = k[len("export "):].strip()
        if k in wanted:
            os.environ[k] = v.strip().strip("\"'")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="H133: erase every user (production tester reset)")
    ap.add_argument("--env-file", default=None, help="file supplying MONGO_URI and MONGO_DB only")
    ap.add_argument("--apply", action="store_true", help="really delete (default is a dry run)")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--expect-host", default=None, help="host that MONGO_URI must point at")
    ap.add_argument("--confirm-db", default=None, help="the database name, typed again")
    ap.add_argument("--confirm", default=None, help=f'must be exactly "{CONFIRM_PHRASE}"')
    ap.add_argument("--backup-confirmed", action="store_true",
                    help="an on-demand Atlas snapshot has been taken")
    owner = ap.add_mutually_exclusive_group()
    owner.add_argument("--include-owner", dest="include_owner", action="store_true", default=True)
    owner.add_argument("--exclude-owner", dest="include_owner", action="store_false")
    ap.add_argument("--max-users", type=int, default=None, help="safety cap on users this run")
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.env_file:
        _load_env_file(Path(args.env_file))  # before the first app.* import
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
