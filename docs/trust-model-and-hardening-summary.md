# Trust Model & Hardening Summary

**Last updated:** 2026-04-11
**Covers:** Phases 1–3, B, C, D, E (Slices 1–10)
**Status:** Stable, monitoring only. No active enforcement changes planned.

---

## 1. Trust Lanes

The system routes every edge-function request into one of three explicit trust lanes based on request signals (`mode`, auth method, headers).

### Protected User Path
- **Signal:** `mode: "protected"` in request body
- **Auth:** JWT required (resolved via `Authorization` header)
- **Scope:** `callerUserId === body.userId` enforced
- **Privilege:** User-scoped reads where proven safe; service-role retained for writes
- **Functions:** `extract-tactics`, `run-enrichment-job`, `batch-actionize`

### Propagated Protected Path
- **Signal:** Orchestrator (`batch-actionize`) forwards the original user's JWT to downstream functions (`extract-tactics`) with `mode: "protected"`
- **Auth:** Original user JWT propagated across function boundaries
- **Scope:** Cross-boundary scope enforcement proven (caller identity validated at each hop)
- **Proven chain:** `batch-actionize` → `extract-tactics` (single-resource rerun)

### Internal Continuation Lane
- **Signal:** `mode: "internal_continuation"` + `is_continuation: true`
- **Auth:** Service-role required
- **Purpose:** Watchdog-triggered handoffs, self-continuation for long-running jobs
- **Separation:** Explicitly distinct from user-initiated flows; telemetry-tracked independently
- **Functions:** `run-enrichment-job` (self-continuation), `batch-actionize` (watchdog)

---

## 2. Enforcement Points

### extract-tactics

| Aspect | Protected Path | Legacy Path |
|---|---|---|
| JWT auth required | ✅ Enforced (401 on failure) | ❌ Not enforced |
| userId scope match | ✅ Enforced (403 on mismatch) | ❌ Not enforced |
| resourceId required | ✅ Enforced (400 on missing) | ❌ Not enforced |
| Service-role reduction | ✅ User-scoped reads | ❌ Full service-role |
| Soft enforcement | N/A | ✅ Warn telemetry + header |
| Behavior change | None | None (classification + telemetry only) |

### run-enrichment-job

| Aspect | Protected Path | Internal Continuation | Legacy Path |
|---|---|---|---|
| JWT auth required | ✅ Enforced | ❌ Service-role | ❌ Not enforced |
| User scope validation | ✅ callerUserId vs job.user_id | ✅ (via job ownership) | ⚠️ Best-effort |
| Service-role reduction | ✅ Job fetch | ❌ Retained | ❌ Full service-role |
| Soft enforcement | N/A | N/A | ✅ Warn telemetry + header |

### batch-actionize

| Aspect | Protected Path | Legacy Path |
|---|---|---|
| JWT auth required | ✅ Enforced | ❌ Not enforced |
| User scope validation | ✅ Enforced | ❌ Not enforced |
| Service-role reduction | ✅ resource_list + dedup_pool | ❌ Full service-role |
| JWT propagation to extract-tactics | ✅ Proven | ❌ N/A |

---

## 3. Service-Role Reduction Map

### Proven Reductions (Protected Path Only)

| Function | Operation | Reduction | Method |
|---|---|---|---|
| extract-tactics | `resource_fetch` | ✅ User-scoped | JWT-based client read |
| extract-tactics | `existing_ki_awareness_read` | ✅ User-scoped | JWT-based client read |
| run-enrichment-job | `job_fetch` | ✅ User-scoped | JWT-based client read |
| batch-actionize | `resource_list_fetch` (up to 500) | ✅ User-scoped | JWT-based client read |
| batch-actionize | `dedup_pool_fetch` (3 parallel SELECTs) | ✅ User-scoped | JWT-based client read |

### Intentionally Retained (Service-Role)

| Category | Reason |
|---|---|
| All write operations | Service-role required for DB writes (inserts, updates, upserts) |
| Asset/storage reads | Cross-concern; not user-scoped in current schema |
| High-frequency loop reads | Performance risk; inside per-resource iteration |
| Downstream orchestration calls | Service-role required for cross-function invocation |
| Internal continuation paths | No user JWT available by design |
| Legacy paths | No enforcement on legacy; service-role preserved for stability |

### Reduction Ceilings

**extract-tactics:** Ceiling reached. Remaining reads are inside the per-resource extraction loop (high frequency) or are write operations. Further reduction would require RLS policy changes on `knowledge_items` and related tables, plus performance validation under load.

**run-enrichment-job:** Ceiling reached. Beyond the initial job fetch, all operations are writes (progress updates, status transitions) or occur within the resource processing loop. The continuation lane has no user JWT by design.

**batch-actionize:** Ceiling reached. Beyond resource list and dedup pool, remaining operations are write-heavy (batch status updates) or involve cross-function orchestration requiring service-role auth.

---

## 4. Legacy Containment

Every request that does not carry an explicit `mode` flag is classified into a legacy category. Classification is telemetry-only — no behavior change.

| Legacy Class | Description | Status |
|---|---|---|
| `legacy_user_path` | JWT present, no `mode` flag | **Migrated + soft-enforced.** Zero traffic observed. All known callers now send `mode: "protected"`. |
| `legacy_batch_path` | Service-role + `x-batch-key`, no `mode` flag | **Intentionally preserved.** Batch orchestration path; separate trust lane. |
| `legacy_continuation` / `legacy_internal_fallback` | Self-invocation without explicit `internal_continuation` mode | **Intentionally preserved.** Internal system flow; migrated where safe. |
| `legacy_service_role_entry` | Service-role initial entry, no continuation | **Rare.** Observed in cron/system contexts. |
| `legacy_unknown_path` | No JWT, no batch key, no mode | **Should not occur.** Would indicate an unexpected caller. |

---

## 5. Soft Enforcement

### What's Deployed

Both `extract-tactics` and `run-enrichment-job` have identical soft enforcement for `legacy_user_path`:

**Telemetry escalation:**
- Event: `fn:legacy_user_path_deprecation_warning`
- Level: `console.warn` (elevated from `console.log`)
- Fields: `_severity: "warn"`, `functionName`, `pathClass`, `authMethod`, `hasProtectedAlternative: true`, `migrationHint`, `userAgent` (truncated), resource/job ID

**Response header:**
- `X-Deprecation-Warning: legacy_user_path; use mode="protected"`
- Additive only — no status code or body changes

**Feature flag:**
- `ENABLE_LEGACY_USER_SOFT_ENFORCEMENT = true` (in each function)
- Set to `false` to instantly revert to original deprecation-only telemetry

### Current Status
- Deployed and active
- Zero legacy-user traffic observed across multiple observation windows
- No regressions

---

## 6. Telemetry Events Reference

| Event | Where | Meaning |
|---|---|---|
| `fn:protected_path_used` | extract-tactics, run-enrichment-job, batch-actionize | Request entered the protected lane |
| `fn:scope_enforced` | Same | userId scope match validated |
| `fn:auth_enforced` | Same | Auth requirement checked (pass or reject) |
| `fn:request_rejected_protected_path` | Same | Protected path rejected a request (auth/scope/shape) |
| `fn:legacy_path_classified` | Same | Legacy request classified into a category |
| `fn:legacy_user_path_deprecation_warning` | extract-tactics, run-enrichment-job | Legacy-user request detected (warn level) |
| `fn:legacy_path_used` | Same | Generic legacy path telemetry (backward compat) |
| `fn:service_role_reduced_path` | Same | User-scoped client used instead of service-role |
| `fn:service_role_used` | Various | Service-role access logged with scope/reason |
| `fn:internal_continuation_used` | run-enrichment-job, batch-actionize | Internal continuation lane entered |
| `fn:cross_user_detected` | Security telemetry | Cross-user access attempt detected |

---

## 7. Operational Guidance

### If legacy-user traffic reappears
1. Check `fn:legacy_user_path_deprecation_warning` logs for the `userAgent` and `resourceId`/`jobId`
2. Identify the caller (client-side code search for the function invocation missing `mode: "protected"`)
3. Migrate that single caller following the Phase E pattern: add `mode: "protected"` + `userId` to the request body
4. Validate with runtime telemetry before migrating another

### How to rollback soft enforcement
Set `ENABLE_LEGACY_USER_SOFT_ENFORCEMENT = false` in the affected function's `index.ts`. Redeploy. All warn-level telemetry and `X-Deprecation-Warning` headers stop immediately. Original deprecation-only logging resumes.

### How to migrate a new caller safely
1. Identify the call site
2. Retrieve `userId` via `supabase.auth.getSession()`
3. Add `userId` and `mode: "protected"` to the request body
4. Deploy and verify: `fn:protected_path_used` + `fn:scope_enforced` appear; `fn:legacy_user_path_deprecation_warning` disappears for that caller
5. Keep rollback trivial: removing `userId`/`mode` from the body reverts

### What NOT to change casually
- **Do not remove legacy path classification.** It's the safety net that catches regressions.
- **Do not add hard rejection on legacy paths** without a full traffic analysis confirming zero usage.
- **Do not reduce service-role on write operations.** Current RLS policies don't support it.
- **Do not modify internal continuation lane auth.** It's the backbone of durable job execution.
- **Do not remove `x-batch-key` validation** from batch-actionize without a replacement trust mechanism.

---

## 8. Future Work (Optional, Not Planned)

| Area | Description | Prerequisite |
|---|---|---|
| Batch-path hardening | Tighten `legacy_batch_path` in extract-tactics | Separate trust analysis; different risk profile |
| Internal entry analysis | Audit `legacy_service_role_entry` and `legacy_unknown_path` | Traffic observation + caller identification |
| Legacy path retirement | Remove legacy classification branches entirely | Extended zero-traffic soak + confidence threshold |
| EnrichmentJobBridge removal | Remove gated legacy bridge component | Confirm env var is never set in any environment |
| Deeper service-role reduction | Reduce writes or loop reads | RLS policy changes + performance benchmarking |
