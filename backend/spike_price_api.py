"""Throwaway evaluation spike for a third-party UK grocery price API (RapidAPI).

NOT imported by the app. Run standalone to assess whether the feed is worth
building on: coverage (do items resolve?), accuracy (vs a real receipt),
response shape (structured prices?), latency, and how the free tier behaves.

Usage:
    export RAPIDAPI_KEY="...your key..."
    export RAPIDAPI_HOST="uk-supermarkets-product-pricing.p.rapidapi.com"  # from playground snippet
    export RAPIDAPI_PATH="/search"          # exact path from the playground snippet
    export RAPIDAPI_PARAM="query"           # the query param name (e.g. query / q / name)
    .venv/bin/python spike_price_api.py

Optionally edit TEST_BASKET / RECEIPT_TRUTH below to match a real receipt so we
can measure accuracy, not just whether something comes back.
"""
import json
import os
import time

import httpx

KEY   = os.environ.get("RAPIDAPI_KEY", "")
HOST  = os.environ.get("RAPIDAPI_HOST", "")
PATH  = os.environ.get("RAPIDAPI_PATH", "/search")
PARAM = os.environ.get("RAPIDAPI_PARAM", "query")

# A representative UK weekly-shop basket. Swap in items from a real receipt.
TEST_BASKET = [
    "semi skimmed milk 2 litre",
    "free range eggs 6",
    "hovis wholemeal bread",
    "cathedral city mature cheddar 350g",
    "heinz baked beans 415g",
    "bananas loose",
    "anchor butter 250g",
    "walkers ready salted multipack",
]

# If you have a real receipt, fill in {item: actual_price_paid} so we can score
# the API's prices against ground truth. Leave empty to just check coverage.
RECEIPT_TRUTH: dict[str, float] = {}


def find_price_fields(obj, _depth=0):
    """Heuristically surface any price-looking numbers + their shop, for shape inspection."""
    hits = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if any(t in k.lower() for t in ("price", "cost", "amount")) and isinstance(v, (int, float, str)):
                hits.append((k, v))
            hits += find_price_fields(v, _depth + 1)
    elif isinstance(obj, list):
        for v in obj[:5]:
            hits += find_price_fields(v, _depth + 1)
    return hits


def main():
    if not (KEY and HOST):
        print("Set RAPIDAPI_KEY and RAPIDAPI_HOST (and check RAPIDAPI_PATH/RAPIDAPI_PARAM).")
        print(f"  host={HOST!r} path={PATH!r} param={PARAM!r} key_set={bool(KEY)}")
        return

    url = f"https://{HOST}{PATH}"
    headers = {"X-RapidAPI-Key": KEY, "X-RapidAPI-Host": HOST}
    print(f"Calling {url}  param={PARAM!r}  on {len(TEST_BASKET)} items\n")

    total_lat, ok, with_price = 0.0, 0, 0
    with httpx.Client(timeout=20) as client:
        for i, item in enumerate(TEST_BASKET, 1):
            t0 = time.time()
            try:
                r = client.get(url, headers=headers, params={PARAM: item})
                lat = (time.time() - t0) * 1000
                total_lat += lat
                status = r.status_code
                if status == 200:
                    ok += 1
                    data = r.json()
                    prices = find_price_fields(data)
                    if prices:
                        with_price += 1
                    print(f"[{i}] {item!r}  {status}  {lat:.0f}ms  prices={prices[:4]}")
                    if i == 1:  # dump full shape of the first response for inspection
                        print("    --- full first response (truncated 1500 chars) ---")
                        print("    " + json.dumps(data, indent=2)[:1500].replace("\n", "\n    "))
                else:
                    print(f"[{i}] {item!r}  {status}  {lat:.0f}ms  body={r.text[:200]}")
            except Exception as e:
                print(f"[{i}] {item!r}  ERROR  {type(e).__name__}: {e}")

    n = len(TEST_BASKET)
    print(f"\nSummary: {ok}/{n} returned 200, {with_price}/{n} had a price-looking field, "
          f"avg {total_lat / max(ok,1):.0f}ms/call")
    if RECEIPT_TRUTH:
        print("Add parsing of the matched price per item once we see the real response shape, "
              "then diff against RECEIPT_TRUTH to score accuracy.")


if __name__ == "__main__":
    main()
