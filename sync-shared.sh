#!/usr/bin/env bash
# Run from repo root after editing shared/src/ to propagate changes to mobile.
# The web frontend imports @wealth/shared directly (works via npm link).
set -e
cp shared/src/types.ts      mobile/lib/shared/types.ts
cp shared/src/categories.ts mobile/lib/shared/categories.ts
cp shared/src/index.ts      mobile/lib/shared/index.ts
echo "✓ shared/src → mobile/lib/shared"
