#!/usr/bin/env python3
"""Fuel Finder collector — runs on the UK VPS (the gov feed is geo-gated to UK IPs).

Authenticates with OAuth2 client-credentials, paginates the price feed AND the
forecourt registry, joins them on node_id, and emits a trimmed snapshot that
carries location (lat/long/postcode) alongside live prices — i.e. everything the
app needs for "compare what you paid vs what's nearby". Stdlib-only, so the box
needs no pip installs.

Two feeds (both 500 records/batch, paginate by batch-number):
  - /api/v1/pfs/fuel-prices  live prices, changes often  -> fetched every run
  - /api/v1/pfs              forecourt registry (location, brand, flags), rarely
                             changes -> cached to registry.json, refreshed ~daily

Interim setup: the main app (currently in a non-UK region) cannot reach the feed,
so this box collects and caches it. Full integration happens at the prod migration.

Env:
  FUEL_FINDER_CLIENT_ID, FUEL_FINDER_CLIENT_SECRET   (required)
  FUEL_CACHE_DIR    output dir (default /root/fuel_cache)

Writes:
  <cache>/fuel_prices_latest.json   consolidated joined snapshot (app reads this)
  <cache>/registry.json             cached forecourt registry (location etc.)
  <cache>/collector.log             append-only run log
"""
import datetime as dt
import json
import os
import sys
import tempfile
import urllib.parse
import urllib.request
import urllib.error

BASE = "https://www.fuel-finder.service.gov.uk/api/v1"
TOKEN_URL = f"{BASE}/oauth/generate_access_token"
PRICES_URL = f"{BASE}/pfs/fuel-prices"
REGISTRY_URL = f"{BASE}/pfs"
BATCH_SIZE = 500              # observed page size
MAX_BATCHES = 100             # safety cap (~7.4k stations => ~16 batches)
REGISTRY_MAX_AGE_S = 24 * 3600  # registry rarely changes; refresh ~daily
UA = "ai-wealth-dashboard fuel-collector"

CID = os.environ.get("FUEL_FINDER_CLIENT_ID", "")
SECRET = os.environ.get("FUEL_FINDER_CLIENT_SECRET", "")
CACHE_DIR = os.environ.get("FUEL_CACHE_DIR", "/root/fuel_cache")


def _utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def get_token():
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": CID,
        "client_secret": SECRET,
        "scope": "fuelfinder.read",
    }).encode()
    req = urllib.request.Request(
        TOKEN_URL, data=body, method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read())
    token = payload["data"]["access_token"]
    return token


def fetch_batch(token, base_url, n):
    url = f"{base_url}?{urllib.parse.urlencode({'batch-number': n})}"
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}", "User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def paginate(token, base_url):
    """Pull every batch from a 500/page batch-number feed. Returns (records, batch_count)."""
    records = []
    batch_count = 0
    for n in range(1, MAX_BATCHES + 1):
        batch = fetch_batch(token, base_url, n)
        if not isinstance(batch, list) or not batch:
            break
        records.extend(batch)
        batch_count += 1
        if len(batch) < BATCH_SIZE:
            break
    return records, batch_count


def load_cached_registry():
    """Return the cached registry list if present and younger than REGISTRY_MAX_AGE_S, else None."""
    path = os.path.join(CACHE_DIR, "registry.json")
    try:
        with open(path) as f:
            cached = json.load(f)
        fetched = dt.datetime.fromisoformat(cached["fetched_at"])
        age = (dt.datetime.now(dt.timezone.utc) - fetched).total_seconds()
        if age < REGISTRY_MAX_AGE_S:
            return cached["records"]
    except (OSError, ValueError, KeyError):
        pass
    return None


def save_registry(records, batch_count):
    os.makedirs(CACHE_DIR, exist_ok=True)
    payload = {"fetched_at": _utcnow(), "batch_count": batch_count,
               "record_count": len(records), "records": records}
    _atomic_write("registry.json", payload)


def get_registry(token):
    """Forecourt registry, served from the daily cache when fresh. Returns (records, source)."""
    cached = load_cached_registry()
    if cached is not None:
        return cached, "cache"
    records, batch_count = paginate(token, REGISTRY_URL)
    save_registry(records, batch_count)
    return records, "fetched"


def _trim_location(loc):
    if not isinstance(loc, dict):
        return {}
    return {
        "lat": loc.get("latitude"),
        "lng": loc.get("longitude"),
        "postcode": loc.get("postcode"),
        "city": loc.get("city"),
        "address": loc.get("address_line_1"),
    }


def join(prices, registry):
    """Join live prices to registry location on node_id, producing trimmed station records."""
    reg_by_id = {r.get("node_id"): r for r in registry if r.get("node_id")}
    joined = []
    unmatched = 0
    for p in prices:
        nid = p.get("node_id")
        reg = reg_by_id.get(nid)
        if reg is None:
            unmatched += 1
        reg = reg or {}
        loc = _trim_location(reg.get("location"))
        grades = {}
        updated = {}
        for fp in p.get("fuel_prices", []):
            ft = fp.get("fuel_type")
            if ft is None:
                continue
            grades[ft] = fp.get("price")
            updated[ft] = fp.get("price_last_updated")
        joined.append({
            "node_id": nid,
            "brand_name": reg.get("brand_name"),
            "trading_name": p.get("trading_name") or reg.get("trading_name"),
            "lat": loc.get("lat"),
            "lng": loc.get("lng"),
            "postcode": loc.get("postcode"),
            "city": loc.get("city"),
            "address": loc.get("address"),
            "is_supermarket": reg.get("is_supermarket_service_station"),
            "is_motorway": reg.get("is_motorway_service_station"),
            "closed": bool(reg.get("temporary_closure") or reg.get("permanent_closure")),
            "prices": grades,
            "updated": updated,
        })
    return joined, unmatched


def _atomic_write(name, payload):
    os.makedirs(CACHE_DIR, exist_ok=True)
    out = os.path.join(CACHE_DIR, name)
    fd, tmp = tempfile.mkstemp(dir=CACHE_DIR, prefix=".fuel_", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        os.replace(tmp, out)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return out


def log(line):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(os.path.join(CACHE_DIR, "collector.log"), "a") as f:
        f.write(f"{_utcnow()}  {line}\n")


def build_snapshot(stations, price_batches, registry_source, unmatched):
    return {
        "fetched_at": _utcnow(),
        "source": "fuel-finder /api/v1/pfs/fuel-prices + /api/v1/pfs (joined on node_id)",
        "price_batches": price_batches,
        "registry_source": registry_source,
        "station_count": len(stations),
        "unmatched_count": unmatched,
        "stations": stations,
    }


def collect():
    token = get_token()
    prices, price_batches = paginate(token, PRICES_URL)
    registry, registry_source = get_registry(token)
    stations, unmatched = join(prices, registry)
    return build_snapshot(stations, price_batches, registry_source, unmatched)


def main():
    if not (CID and SECRET):
        print("Set FUEL_FINDER_CLIENT_ID and FUEL_FINDER_CLIENT_SECRET", file=sys.stderr)
        return 2
    # --stdout: emit the snapshot JSON to stdout (for the prod box to capture over
    # SSH, using this box purely as the UK egress). Status goes to stderr.
    to_stdout = "--stdout" in sys.argv[1:]
    try:
        snapshot = collect()
        n = snapshot["station_count"]
        info = (f"{n} stations, {snapshot['price_batches']} price batches, "
                f"registry={snapshot['registry_source']}, unmatched={snapshot['unmatched_count']}")
        if to_stdout:
            json.dump(snapshot, sys.stdout, separators=(",", ":"))
            print(f"OK  {info} (stdout)", file=sys.stderr)
            return 0
        out = _atomic_write("fuel_prices_latest.json", snapshot)
        msg = f"OK  {info} -> {out}"
        log(msg)
        print(msg)
        return 0
    except urllib.error.HTTPError as e:
        detail = e.read()[:200].decode("utf-8", "replace")
        msg = f"FAIL  HTTP {e.code} {e.reason}  {detail}"
        log(msg); print(msg, file=sys.stderr); return 1
    except Exception as e:
        msg = f"FAIL  {type(e).__name__}: {e}"
        log(msg); print(msg, file=sys.stderr); return 1


if __name__ == "__main__":
    sys.exit(main())
