#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Regression guardrail: detect hard reload usage
# ═══════════════════════════════════════════════════════════════
# Run: npm run guard:no-hard-reload  (or bash scripts/guard-no-hard-reload.sh)
#
# Fails if any source file contains window.location.reload() or
# location.reload(). The app MUST use performSoftRefresh() from
# src/lib/softRefresh.ts instead.

set -euo pipefail

VIOLATIONS=$(grep -rn 'window\.location\.reload\|location\.reload' src/ --include='*.ts' --include='*.tsx' || true)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ REGRESSION: Hard reload detected in source files!"
  echo ""
  echo "$VIOLATIONS"
  echo ""
  echo "Use performSoftRefresh() from src/lib/softRefresh.ts instead."
  exit 1
fi

echo "✅ No hard reload usage found."
