#!/usr/bin/env bash
# Nightly MongoDB backup with 7-day rotation.
# Prod note: replace with managed snapshots (Atlas backups / EBS snapshots)
# and ship archives off-host — an on-disk backup doesn't survive the disk.
set -euo pipefail

BACKUP_DIR="/root/ai-wealth-dashboard/backups"
MONGO_URI="${MONGO_URI:-mongodb://localhost:27017}"
DB="wealth"
KEEP_DAYS=7

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
ARCHIVE="$BACKUP_DIR/${DB}_${STAMP}.archive.gz"

mongodump --uri="$MONGO_URI" --db="$DB" --archive="$ARCHIVE" --gzip --quiet

# Rotate
find "$BACKUP_DIR" -name "${DB}_*.archive.gz" -mtime +"$KEEP_DAYS" -delete

echo "$(date -Is) backup ok: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
