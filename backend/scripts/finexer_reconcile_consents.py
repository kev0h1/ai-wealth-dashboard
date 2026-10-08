#!/usr/bin/env python3
"""A156: reconcile the consents Finexer holds against our finexer_consents collection.

Before A157 (2026-10-08) every revoke sent a non-existent DELETE and treated its
404 as success, and before A106 a failed revoke deleted the local doc anyway, so
Finexer may still hold authorized consents we have no record of. This script
lists every consent via GET /consents (following paging.next), joins on consent
id against the local collection and sorts them into groups:

  a ORPHANS      authorized at Finexer, customer maps to exactly one local user,
                 consent id absent locally  -> revoked with --apply
  b STALE LOCAL  local doc active, but canceled/expired/revoked at Finexer
                 -> local doc set to revoked with --apply
  c MATCHED      local and remote agree
  d OTHER ENV    customer unknown to this database (the other environment's
                 user, as UAT and production share one Finexer account)
                 -> counted only, never touched
  e PENDING      never authorized; Finexer auto-cancels after 7 days. Counts and
                 ages only; with --apply a local pending doc whose Finexer
                 status is already canceled is closed locally. Nothing is ever
                 cancelled at Finexer by this script.

DRY RUN BY DEFAULT: only read-only GETs. --apply additionally needs --yes (and
Kevin's go-ahead). Orphans are revoked through retention.revoke_finexer_consent
(POST /consents/{id}/revoke, A106 marker on failure), rate limited, capped by
--limit, each confirmed with a GET afterwards.

Usage (from backend/):
    .venv/bin/python scripts/finexer_reconcile_consents.py --env-file .env
    ... [--mongo-uri URI] [--db NAME] [--report PATH]
    ... --apply --yes [--limit N]

Output never contains emails: users appear as sha256 hashes. Keys are never
printed. The JSON report goes to /tmp/finexer-reconcile-<date>.json.
"""
import argparse
import asyncio
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx

_BACKEND = Path(__file__).resolve().parents[1]
API_URL = "https://api.finexer.com"
PAGE_TIMEOUT = 30
MAX_PAGES = 500
PENDING_AUTOCANCEL_DAYS = 7
ACTIVE_LOCAL = {"authorized", "connected"}
CLOSED_REMOTE = {"canceled", "cancelled", "revoked", "expired"}
REVOKE_RATE_PER_SEC = 2.0


class ReconcileError(Exception):
    """A failure that must stop the run (never carries a key or email)."""


def user_hash(uid: str) -> str:
    """Same hashing as the A106 marker's user_hash (sha256 of the uid)."""
    return hashlib.sha256(uid.encode()).hexdigest()


def _parse_ts(v):
    """Finexer timestamps may be epoch seconds or ISO strings; None if unknown."""
    if v in (None, "", 0):
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v, tz=timezone.utc)
    if isinstance(v, str):
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _age_days(ts, now):
    t = _parse_ts(ts)
    return None if t is None else max(0, (now - t).days)


# ── Finexer listing ──────────────────────────────────────────────────────────
def _items(body) -> list:
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for k in ("data", "consents", "items"):
            if isinstance(body.get(k), list):
                return body[k]
    return []


def _next_target(body):
    nxt = (body.get("paging") or {}).get("next") if isinstance(body, dict) else None
    if not nxt:
        return None
    if not isinstance(nxt, str):
        raise ReconcileError("unrecognised paging.next shape")
    if nxt.startswith("/"):
        return nxt
    parts = urlsplit(nxt)
    if parts.scheme == "https" and parts.hostname == urlsplit(API_URL).hostname:
        return nxt
    raise ReconcileError("paging.next is not a Finexer URL or path; refusing to follow it")


async def fetch_all_consents(client, max_pages: int = MAX_PAGES) -> list[dict]:
    """GET /consents, following paging.next until exhausted. Bounded by
    max_pages and a repeated-next check; raises ReconcileError on any non-200."""
    out: list[dict] = []
    seen_ids: set = set()
    seen_targets: set = set()
    target = "/consents"
    for _ in range(max_pages):
        seen_targets.add(target)
        rv = await client.get(target, timeout=PAGE_TIMEOUT)
        if rv.status_code != 200:
            raise ReconcileError(f"GET /consents failed: HTTP {rv.status_code}")
        body = rv.json()
        for c in _items(body):
            if isinstance(c, dict) and c.get("id") and c["id"] not in seen_ids:
                seen_ids.add(c["id"])
                out.append({k: c.get(k) for k in
                            ("id", "customer", "provider", "status", "created_at", "authed_at", "expiry_date")})
        target = _next_target(body)
        if target is None:
            return out
        if target in seen_targets:
            raise ReconcileError("paging.next repeated; stopping")
    raise ReconcileError(f"more than {max_pages} pages; stopping")


# ── Local data ───────────────────────────────────────────────────────────────
async def load_local(consents_col, customers_col) -> tuple[dict, dict]:
    """Returns ({consent_id: doc}, {customer_id: sorted list of user ids}).
    Customer ids come from finexer_customers (_id = user email) and from the
    customer_id on consent docs."""
    consents: dict = {}
    async for d in consents_col.find({}):
        consents[d["_id"]] = d
    cust: dict[str, set] = {}
    async for d in customers_col.find({}):
        if d.get("customer_id"):
            cust.setdefault(d["customer_id"], set()).add(d["_id"])
    for d in consents.values():
        if d.get("customer_id") and d.get("user_id"):
            cust.setdefault(d["customer_id"], set()).add(d["user_id"])
    return consents, {k: sorted(v) for k, v in cust.items()}


# ── Classification (pure) ────────────────────────────────────────────────────
def classify(remote: list[dict], local: dict, cust_users: dict, now: datetime) -> dict:
    """Group remote consents. Each entry: id, provider, status, age_days,
    user_hash (when known) and, internally, `_uid` (stripped before output)."""
    g = {k: [] for k in ("orphans", "stale_local", "matched", "other_env", "ambiguous",
                         "pending", "closed_remote_unknown")}
    for c in remote:
        cid, status = c["id"], (c.get("status") or "").lower()
        users = cust_users.get(c.get("customer") or "")
        entry = {"id": cid, "provider": c.get("provider"), "status": status,
                 "age_days": _age_days(c.get("created_at"), now)}
        doc = local.get(cid)
        if not users and not doc:
            g["other_env"].append(entry)
            continue
        uid = doc.get("user_id") if doc else (users[0] if users and len(users) == 1 else None)
        if uid:
            entry["user_hash"] = user_hash(uid)
            entry["_uid"] = uid
        if doc:
            lstatus = (doc.get("status") or "").lower()
            if lstatus in ACTIVE_LOCAL and status in CLOSED_REMOTE:
                g["stale_local"].append(entry)
            elif lstatus == "pending" and status in CLOSED_REMOTE:
                entry["close_local_pending"] = True
                g["pending"].append(entry)
            elif status == "pending":
                g["pending"].append(entry)
            else:
                g["matched"].append(entry)
            continue
        # no local doc, customer is ours
        if status == "authorized":
            (g["orphans"] if uid else g["ambiguous"]).append(entry)
        elif status == "pending":
            g["pending"].append(entry)
        else:
            g["closed_remote_unknown"].append(entry)
    return g


def build_report(groups: dict, now: datetime, mode: str) -> dict:
    def clean(entries):
        return [{k: v for k, v in e.items() if not k.startswith("_")} for e in entries]
    pend = groups["pending"]
    ages = [e["age_days"] for e in pend if e["age_days"] is not None]
    return {
        "generated_at": now.isoformat(),
        "mode": mode,
        "counts": {k: len(v) for k, v in groups.items()},
        "pending_summary": {
            "older_than_7_days": sum(1 for a in ages if a > PENDING_AUTOCANCEL_DAYS),
            "7_days_or_younger": sum(1 for a in ages if a <= PENDING_AUTOCANCEL_DAYS),
            "close_local_candidates": sum(1 for e in pend if e.get("close_local_pending")),
            "oldest_age_days": max(ages) if ages else None,
        },
        # other-environment consents are counted only, never listed.
        "orphans": clean(groups["orphans"]),
        "stale_local": clean(groups["stale_local"]),
        "ambiguous": clean(groups["ambiguous"]),
        "pending": clean(pend),
    }


# ── Apply ────────────────────────────────────────────────────────────────────
async def apply_changes(groups, client, consents_col, revoke, limit, rate=REVOKE_RATE_PER_SEC, sleep=asyncio.sleep):
    """Revoke orphans (capped by limit), flip stale local docs, close stale
    local pending docs. Nothing else. `revoke(uid, cid)` is
    retention.revoke_finexer_consent: None on confirmed success."""
    result = {"revoked": 0, "revoke_failed": 0, "confirmed": 0, "unconfirmed": 0,
              "local_stale_flipped": 0, "local_pending_closed": 0, "skipped_over_limit": 0}
    now = datetime.now(timezone.utc)  # naive-ok: persisted aware-UTC audit instant
    for i, e in enumerate(groups["orphans"]):
        if i >= limit:
            result["skipped_over_limit"] = len(groups["orphans"]) - limit
            break
        uid = e.get("_uid")
        if not uid:  # ownership check: customer must map to a local user
            result["revoke_failed"] += 1
            continue
        if i:
            await sleep(1.0 / rate)
        err = await revoke(uid, e["id"])
        if err is not None:
            result["revoke_failed"] += 1
            continue
        result["revoked"] += 1
        rv = await client.get(f"/consents/{e['id']}", timeout=PAGE_TIMEOUT)
        status = (rv.json().get("status") or "").lower() if rv.status_code == 200 else ""
        result["confirmed" if status in CLOSED_REMOTE else "unconfirmed"] += 1
    for e in groups["stale_local"]:
        await consents_col.update_one(
            {"_id": e["id"], "status": {"$in": sorted(ACTIVE_LOCAL)}},
            {"$set": {"status": "revoked", "revoked_at": now}})
        result["local_stale_flipped"] += 1
    for e in groups["pending"]:
        if e.get("close_local_pending"):
            await consents_col.update_one(
                {"_id": e["id"], "status": "pending"},
                {"$set": {"status": "canceled", "canceled_at": now}})
            result["local_pending_closed"] += 1
    return result


# ── CLI ──────────────────────────────────────────────────────────────────────
def _load_env(env_file, mongo_uri, db):
    """Set process env BEFORE any app import so app.core.config sees it."""
    from dotenv import dotenv_values
    if env_file:
        p = Path(env_file)
        if not p.exists():
            raise SystemExit(f"env file not found: {p}")
        vals = dotenv_values(p)
        for k in ("FINEXER_API_KEY", "MONGO_URI", "MONGO_DB"):
            if vals.get(k) and not os.environ.get(k):
                os.environ[k] = vals[k]
    if mongo_uri:
        os.environ["MONGO_URI"] = mongo_uri
    if db:
        os.environ["MONGO_DB"] = db


async def amain(args) -> int:
    _load_env(args.env_file, args.mongo_uri, args.db)
    sys.path.insert(0, str(_BACKEND))
    key = os.environ.get("FINEXER_API_KEY", "")
    if not key:
        print("FINEXER_API_KEY not found", file=sys.stderr)
        return 2
    from app.db.collections import finexer_consents_col, finexer_customers_col
    from app.core.config import MONGO_DB
    now = datetime.now(timezone.utc)  # naive-ok: report timestamp
    print(f"database: {MONGO_DB}   mode: {'APPLY' if args.apply else 'DRY RUN'}")
    async with httpx.AsyncClient(base_url=API_URL, auth=(key, ""), timeout=PAGE_TIMEOUT) as client:
        try:
            remote = await fetch_all_consents(client)
            local, cust = await load_local(finexer_consents_col, finexer_customers_col)
            groups = classify(remote, local, cust, now)
            report = build_report(groups, now, "apply" if args.apply else "dry-run")
            print(f"remote consents: {len(remote)}   local consents: {len(local)}")
            for k, n in report["counts"].items():
                print(f"  {k}: {n}")
            print("  pending:", json.dumps(report["pending_summary"]))
            for name in ("orphans", "stale_local", "ambiguous"):
                for e in report[name]:
                    print(f"  [{name}] {e['id']} user={str(e.get('user_hash', '-'))[:12]} "
                          f"age={e['age_days']}d provider={e['provider']} status={e['status']}")
            if args.apply:
                from app.services.retention import revoke_finexer_consent
                report["apply_result"] = await apply_changes(
                    groups, client, finexer_consents_col, revoke_finexer_consent, args.limit)
                print("apply result:", json.dumps(report["apply_result"]))
        except ReconcileError as exc:
            print(f"stopped: {exc}", file=sys.stderr)
            return 1
    path = Path(args.report or f"/tmp/finexer-reconcile-{now.date().isoformat()}.json")
    path.write_text(json.dumps(report, indent=2, default=str) + "\n")
    print(f"report: {path}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--env-file", help="env file holding FINEXER_API_KEY (and optionally MONGO_URI/MONGO_DB)")
    ap.add_argument("--mongo-uri", help="default: the app's config")
    ap.add_argument("--db", help="default: the app's config")
    ap.add_argument("--report", help="JSON report path (default /tmp/finexer-reconcile-<date>.json)")
    ap.add_argument("--apply", action="store_true", help="make changes; requires --yes")
    ap.add_argument("--yes", action="store_true", help="confirm --apply")
    ap.add_argument("--limit", type=int, default=25, help="max orphans revoked per run (default 25)")
    args = ap.parse_args(argv)
    if args.apply and not args.yes:
        print("--apply requires --yes (and Kevin's go-ahead); nothing done", file=sys.stderr)
        return 2
    return asyncio.run(amain(args))


if __name__ == "__main__":
    sys.exit(main())
