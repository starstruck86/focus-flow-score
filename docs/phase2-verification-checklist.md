# Phase 2: Security Hardening — Manual Verification Checklist

## Pre-flight
- [ ] App builds without errors (`npx tsc --noEmit`)
- [ ] No new console errors on load

## Core flows (must remain identical)
- [ ] Sign in works
- [ ] Dashboard loads
- [ ] Journal page loads — daily nudge appears (migrated to safeInternalInvoke)
- [ ] Resource upload works
- [ ] Start enrichment — job progresses
- [ ] Completion persists after refresh
- [ ] Retry/cancel behavior unchanged

## Phase 2 specific verification
- [ ] `window.__telemetry.getByPrefix('fn:')` shows invocation events
- [ ] Journal nudge call shows `fn:internal_path_used` in telemetry
- [ ] No `fn:cross_user_detected` events for normal single-user flows
- [ ] `/observability` dashboard still loads (admin-gated)
- [ ] All existing function calls work identically

## What was NOT changed (intentionally deferred)
- No verify_jwt settings changed
- No RLS policies modified
- No service-role access removed
- No public endpoints blocked
- No request shapes changed
- No existing callers broken
- No DB schema modified
