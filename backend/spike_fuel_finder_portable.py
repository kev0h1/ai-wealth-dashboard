"""Portable, ZERO-DEPENDENCY Fuel Finder probe — run this on a UK VPS.

Purpose: find out whether the developer.fuel-finder.service.gov.uk WAF block is
UK-geo (a UK IP fixes it) or a browser-only challenge (a server still fails).
Uses only the Python 3 standard library, so no pip install is needed.

Run on the UK box:
    export FUEL_FINDER_CLIENT_ID="..."
    export FUEL_FINDER_CLIENT_SECRET="..."
    python3 spike_fuel_finder_portable.py

Read the verdict it prints at the end.
"""
import base64
import json
import os
import urllib.parse
import urllib.request
import urllib.error

CID = os.environ.get("FUEL_FINDER_CLIENT_ID", "")
SECRET = os.environ.get("FUEL_FINDER_CLIENT_SECRET", "")

BASE = "https://www.developer.fuel-finder.service.gov.uk"
DATA_URL = f"{BASE}/access-latest-fuelprices"
TOKEN_URLS = [f"{BASE}/oauth/token", f"{BASE}/oauth2/token", f"{BASE}/token",
              f"{BASE}/connect/token", f"{BASE}/api/token"]

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
BASE_HEADERS = {"User-Agent": UA, "Accept": "application/json",
                "Accept-Language": "en-GB"}


def req(url, method="GET", headers=None, data=None):
    """Return (status, content_type, body_text). Never raises on HTTP errors."""
    h = dict(BASE_HEADERS)
    if headers:
        h.update(headers)
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode()
        h.setdefault("Content-Type", "application/x-www-form-urlencoded")
    r = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, resp.headers.get("content-type", ""), resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type", ""), e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, "", f"{type(e).__name__}: {e}"


def show(label, status, ctype, body):
    print(f"  [{label}] HTTP {status}  type={ctype}  len={len(body)}")
    if body:
        print("    body: " + body[:300].replace("\n", " "))


def inspect(body):
    try:
        data = json.loads(body)
    except Exception:
        return
    print("    --- JSON shape ---")
    obj = None
    if isinstance(data, dict):
        print("    top-level keys:", list(data.keys())[:20])
        for k, v in data.items():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                print(f"    '{k}': list of {len(v)}; first object:")
                obj = v[0]
                break
    elif isinstance(data, list) and data:
        print(f"    top-level list of {len(data)}; first object:")
        obj = data[0]
    if obj:
        print("    " + json.dumps(obj, indent=2)[:1200].replace("\n", "\n    "))


def main():
    if not (CID and SECRET):
        print("Set FUEL_FINDER_CLIENT_ID and FUEL_FINDER_CLIENT_SECRET in env.")
        return
    print(f"Client ID {CID[:6]}…  Secret {SECRET[:6]}…  -> {DATA_URL}\n")

    print("== Baseline: no auth ==")
    s, c, b = req(DATA_URL)
    show("no-auth", s, c, b)
    edge_block = (s == 403 and len(b) == 0)

    print("\n== OAuth2 client_credentials ==")
    got = False
    for turl in TOKEN_URLS:
        s, c, b = req(turl, method="POST",
                      data={"grant_type": "client_credentials",
                            "client_id": CID, "client_secret": SECRET})
        show(turl, s, c, b)
        if s == 200:
            try:
                tok = json.loads(b).get("access_token")
            except Exception:
                tok = None
            if tok:
                ds, dc, db = req(DATA_URL, headers={"Authorization": f"Bearer {tok}"})
                show("data+bearer", ds, dc, db)
                if ds == 200:
                    inspect(db); got = True
                break

    if not got:
        print("\n== HTTP Basic auth on data endpoint ==")
        tok = base64.b64encode(f"{CID}:{SECRET}".encode()).decode()
        s, c, b = req(DATA_URL, headers={"Authorization": f"Basic {tok}"})
        show("data+basic", s, c, b)
        if s == 200:
            inspect(b); got = True

    print("\n=== VERDICT ===")
    if got:
        print("SUCCESS — got fuel data from a UK IP. The block WAS geo-based: "
              "migrating the Contabo box to the UK region will fix it. Schema dumped above.")
    elif edge_block:
        print("Still an empty-body 403 even from this IP. NOT a simple geo block — "
              "it's a browser/JS challenge or stricter WAF. Migrating region will NOT help; "
              "we need the real auth flow from the portal docs (open it in a browser).")
    else:
        print("Mixed result — read the per-request output above to see how far auth got.")


if __name__ == "__main__":
    main()
