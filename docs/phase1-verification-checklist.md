# Phase 1: Post-Change Verification Checklist

Manual verification steps after observability instrumentation.
None of these should behave differently after the changes — this checklist
confirms zero regression.

## Core Flow Verification

- [ ] **Sign in** — Login page loads, credentials accepted, redirects to dashboard
- [ ] **Dashboard load** — Dashboard renders with data, no console errors
- [ ] **Resource upload** — Upload a file, resource appears in library
- [ ] **Start enrichment** — Trigger enrichment on a resource, job appears in background indicator
- [ ] **Observe job progress** — Background job indicator shows status updates
- [ ] **Completion persistence** — After enrichment completes, refresh page; resource shows enriched state
- [ ] **Refresh/resume** — Refresh during active job; job reappears via rehydration
- [ ] **Retry/cancel** — Cancel or retry a failed job from the drawer; correct state transitions occur
- [ ] **Major pages render** — Visit: Dashboard, Coach, Prep, Settings, Library, Cockpit

## Observability-Specific Verification

- [ ] **Telemetry buffer** — Open console, run `window.__telemetry.getRecent()` — returns events
- [ ] **Job observer** — Start a job, then check `window.__telemetry.getByPrefix('job:')` — events appear
- [ ] **Function audit** — Trigger any edge function call, check `window.__telemetry.getByPrefix('fn:')` — invocation recorded
- [ ] **Observability page** — Navigate to `/observability` — page loads with tabs
- [ ] **Stale detection** — Stale Jobs tab queries DB and shows results or "No stale jobs"
- [ ] **Export telemetry** — Click Export on Telemetry tab — JSON file downloads

## Regression Guards

- [ ] **No new console errors** — No unexpected errors in browser console
- [ ] **No behavior change** — All user-facing flows behave identically to before
- [ ] **No performance degradation** — Dashboard and page loads feel normal
- [ ] **No auth changes** — Login/logout works the same
- [ ] **Background jobs still work** — Jobs complete successfully end-to-end
