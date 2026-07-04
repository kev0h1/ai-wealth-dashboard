#!/usr/bin/env bash
# Refresh the cached UK fuel-price snapshot.
#
# The gov feed is geo-gated to UK IPs and this box is not in the UK, so we run the
# collector on the UK droplet over SSH (pure egress), stream the snapshot JSON back,
# validate it, and atomically place it where wealth-api can read it. Creds live in
# the droplet's /root/fuel.env — none are passed from this box.
#
# Intended to be run from cron on this (the original) box. Interim until prod migrates.
set -euo pipefail

REPO="/root/ai-wealth-dashboard"
KEY="$REPO/.keys/fuel_droplet"
KNOWN="$REPO/.keys/known_hosts"
DROPLET="root@139.59.174.149"
CACHE_DIR="$REPO/backend/fuel_cache"
OUT="$CACHE_DIR/fuel_prices_latest.json"

mkdir -p "$CACHE_DIR"
TMP="$(mktemp "$CACHE_DIR/.fuel_XXXXXX.tmp")"
trap 'rm -f "$TMP"' EXIT

ssh -i "$KEY" -o UserKnownHostsFile="$KNOWN" -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout=20 -o BatchMode=yes "$DROPLET" \
    '. /root/fuel.env && /usr/bin/python3 /root/fuel_finder_collector.py --stdout' > "$TMP"

# Validate before publishing: must be JSON with a plausible station count.
python3 -c "import json,sys;d=json.load(open('$TMP'));sys.exit(0 if d.get('station_count',0)>1000 else 1)"

mv "$TMP" "$OUT"
trap - EXIT
echo "$(date -u +%FT%TZ)  refreshed $OUT ($(python3 -c "import json;print(json.load(open('$OUT'))['station_count'])") stations)"
