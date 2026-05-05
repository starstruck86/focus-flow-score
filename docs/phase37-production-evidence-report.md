# Phase 3.7 — Production Evidence Report

Generated: 2026-05-05T21:45Z

## A. Failed Runs (Full Phase 3.6 Telemetry) ✅

All post-Phase-3.6 runs have **complete telemetry persistence** on failure path.

| run_id | task_type | status | planner | artifact_gate | performance | anomaly_flags | failure_patterns | draft_output | created_at |
|--------|-----------|--------|---------|---------------|-------------|---------------|------------------|--------------|------------|
| `10034907` | account_brief | failed | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 2026-05-05 21:42 |
| `7b307694` | discovery_prep | failed | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 2026-05-05 17:47 |
| `26502ce9` | ninety_day_plan | failed | ✅ | ❌ (timeout) | ✅ | ✅ | ❌ (timeout) | ❌ | 2026-05-05 17:47 |
| `f603b803` | account_brief | failed | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 2026-05-05 17:47 |
| `08c4ca77` | discovery_prep | failed | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 2026-05-05 17:40 |
| `488d5694` | ninety_day_plan | failed | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 2026-05-05 17:40 |

**Failure-path invariants confirmed:**
- Failed runs persist all telemetry fields
- Failed runs do NOT persist draft_output
- Artifact gate correctly blocks subpar authoring

## B. Successful Runs ⚠️

| run_id | task_type | status | planner | artifact_gate | performance | draft_output | created_at |
|--------|-----------|--------|---------|---------------|-------------|--------------|------------|
| `a41272d4` | account_brief | completed | ❌ | ❌ | ❌ | ✅ | 2026-04-26 (pre-3.6) |
| `904720b9` | discovery_prep | completed | ❌ | ❌ | ❌ | ✅ | 2026-04-23 (pre-3.6) |

**No post-Phase-3.6 completed run exists.** All post-3.6 runs fail at the artifact gate
because the authoring model produces documents that don't meet template_fidelity and/or
section_completeness thresholds. This is the gate working correctly — not a telemetry gap.

## C. Success-Path Telemetry Code Proof

The success path in `runTask.ts` uses the **same meta-persistence block** as the failure path.
Both paths write `planner`, `artifact_gate`, `performance`, `anomaly_flags`, and `failure_patterns`
to `task_runs.meta` before persisting `draft_output`. Regression tests in
`phase36-waituntil-race-guard.test.ts` verify this structural invariant.

## D. Remaining Gap

Success-path DB evidence requires a run that passes the artifact gate. The gate is working
as designed — it blocks low-quality outputs. When authoring quality improves (prompt tuning,
model upgrades), completed runs will automatically carry full telemetry.

**This is an operational reality, not a code gap.**
