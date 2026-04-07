#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Regression guardrail: detect hard reload usage
# ═══════════════════════════════════════════════════════════════
# Run: bash scripts/guard-no-hard-reload.sh
#
# Fails if any source file (outside known exceptions) contains
# window.location.reload() or location.reload().
#
# Known exceptions (intentional hard reloads):
#   - ErrorBoundary.tsx    — crash recovery, last resort
#   - useAppFreshness.ts   — build-version update, intentional
#   - main.tsx             — boot crash fallback
#   - softRefresh.ts       — contract comment (not actual usage)
#   - warningEligibility   — contract comment
#   - test files           — test assertions
#
# The app's DATA REFRESH must use performSoftRefresh() from
# src/lib/softRefresh.ts.

set -euo pipefail

VIOLATIONS=$(grep -rn 'window\.location\.reload\|location\.reload' src/ \
  --include='*.ts' --include='*.tsx' \
  | grep -v 'ErrorBoundary' \
  | grep -v 'useAppFreshness' \
  | grep -v 'main\.tsx' \
  | grep -v '__tests__' \
  | grep -v '\.test\.' \
  | grep -v 'NEVER.*reload' \
  | grep -v 'not.*contain.*reload' \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ REGRESSION: Unexpected hard reload detected!"
  echo ""
  echo "$VIOLATIONS"
  echo ""
  echo "Use performSoftRefresh() from src/lib/softRefresh.ts instead."
  exit 1
fi

echo "✅ No unexpected hard reload usage found."
