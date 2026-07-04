"""Throwaway evaluation spike for the UK Fuel Finder open-data scheme.

NOT imported by the app. Goal: confirm the real auth flow + JSON schema for the
official feed, using a registered Information Recipient's Client ID/Secret.

We could not read the developer portal (CloudFront WAF 403s automated clients),
so the exact auth handshake is unknown. This probes the likely patterns and
reports what each returns, so we learn the real shape empirically:

  1. OAuth2 client_credentials token grant against a few candidate token URLs,
     then call the data endpoint with the bearer token.
  2. HTTP Basic auth (client_id:secret) straight on the data endpoint.
  3. Custom client-id/secret headers straight on the data endpoint.

Usage:
    export FUEL_FINDER_CLIENT_ID="..."      # already in backend/.env
    export FUEL_FINDER_CLIENT_SECRET="..."
    .venv/bin/python spike_fuel_finder.py

Heads-up: our host is non-UK (Amsterdam). If the WAF is UK-geo-restricted the
calls may 403 even with valid creds — that itself is a useful finding.
"""
import json
import os

import httpx

CID = os.environ.get("FUEL_FINDER_CLIENT_ID", "")
SECRET = os.environ.get("FUEL_FINDER_CLIENT_SECRET", "")

BASE = "https://www.developer.fuel-finder.service.gov.uk"
DATA_URL = f"{BASE}/access-latest-fuelprices"

# Candidate OAuth2 token endpoints (we don't know the real one — try several).
TOKEN_URLS = [
    f"{BASE}/oauth/token",
    f"{BASE}/oauth2/token",
    f"{BASE}/token",
    f"{BASE}/connect/token",
    f"{BASE}/api/token",
]

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept": "application/json", "Accept-Language": "en-GB"}


def show(label, r):
    body = r.text or ""
    print(f"  [{label}] HTTP {r.status_code}  type={r.headers.get('content-type','')}  "
          f"len={len(body)}")
    if body:
        print("    body: " + body[:300].replace("\n", " "))
    return r


def inspect_data(r):
    """If we got JSON fuel data, dump its shape so we learn the real schema."""
    try:
        data = r.json()
    except Exception:
        print("    (not JSON)")
        return
    print("    --- JSON shape ---")
    if isinstance(data, dict):
        print("    top-level keys:", list(data.keys())[:20])
        # find the station list
        for k, v in data.items():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                print(f"    '{k}' is a list of {len(v)} objects; first object:")
                print("    " + json.dumps(v[0], indent=2)[:1200].replace("\n", "\n    "))
                break
    elif isinstance(data, list) and data:
        print(f"    top-level list of {len(data)} objects; first object:")
        print("    " + json.dumps(data[0], indent=2)[:1200].replace("\n", "\n    "))


def try_oauth(client):
    print("\n== Strategy 1: OAuth2 client_credentials ==")
    payload = {"grant_type": "client_credentials",
               "client_id": CID, "client_secret": SECRET}
    for turl in TOKEN_URLS:
        try:
            r = client.post(turl, data=payload, headers=HEADERS)
        except Exception as e:
            print(f"  [{turl}] ERROR {type(e).__name__}: {e}")
            continue
        show(turl, r)
        if r.status_code == 200:
            try:
                tok = r.json().get("access_token")
            except Exception:
                tok = None
            if tok:
                print("  -> got token, calling data endpoint")
                dr = client.get(DATA_URL,
                                headers={**HEADERS, "Authorization": f"Bearer {tok}"})
                show("data+bearer", dr)
                if dr.status_code == 200:
                    inspect_data(dr)
                return dr.status_code == 200
    return False


def try_basic(client):
    print("\n== Strategy 2: HTTP Basic auth on data endpoint ==")
    try:
        r = client.get(DATA_URL, headers=HEADERS, auth=(CID, SECRET))
    except Exception as e:
        print(f"  ERROR {type(e).__name__}: {e}")
        return False
    show("data+basic", r)
    if r.status_code == 200:
        inspect_data(r)
        return True
    return False


def try_headers(client):
    print("\n== Strategy 3: custom client-id/secret headers on data endpoint ==")
    variants = [
        {"client_id": CID, "client_secret": SECRET},
        {"x-client-id": CID, "x-client-secret": SECRET},
        {"x-api-key": SECRET, "client_id": CID},
    ]
    ok = False
    for h in variants:
        try:
            r = client.get(DATA_URL, headers={**HEADERS, **h})
        except Exception as e:
            print(f"  [{list(h)}] ERROR {type(e).__name__}: {e}")
            continue
        r2 = show(",".join(h.keys()), r)
        if r2.status_code == 200:
            inspect_data(r2)
            ok = True
    return ok


def main():
    if not (CID and SECRET):
        print("Set FUEL_FINDER_CLIENT_ID and FUEL_FINDER_CLIENT_SECRET in env.")
        return
    print(f"Client ID: {CID[:6]}…  Secret: {SECRET[:6]}…  (len {len(SECRET)})")
    print(f"Data endpoint: {DATA_URL}")
    with httpx.Client(timeout=30, follow_redirects=True) as client:
        # Baseline: confirm the WAF behaviour with no auth.
        print("\n== Baseline: no auth ==")
        try:
            show("no-auth", client.get(DATA_URL, headers=HEADERS))
        except Exception as e:
            print(f"  ERROR {type(e).__name__}: {e}")

        if try_oauth(client) or try_basic(client) or try_headers(client):
            print("\nSUCCESS: one strategy returned fuel data (schema dumped above).")
        else:
            print("\nNo strategy returned data. If all are 403 with empty bodies, "
                  "the WAF is blocking us (likely UK-geo / browser-only) regardless "
                  "of creds — we'd need to call from a UK IP or confirm the auth flow "
                  "from the portal docs in a real browser.")


if __name__ == "__main__":
    main()
