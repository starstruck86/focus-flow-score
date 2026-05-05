# Phase 4 — Live Production Evidence Validation Report

Generated: 2026-05-06T00:00Z
**Method**: Real DB rows queried, passed through adapters, validated via `validateSingleEvidence()`.
**Standard**: No synthetic fixtures. No weakened requirements. Real rows only.

---

## Validation Protocol

For each enforced surface:
1. Query real production rows from the database
2. Pass through the appropriate adapter (`adaptTaskRun`, `adaptChatArtifact`, `adaptTransformOutput`)
3. Run `validateSingleEvidence()` against the registry requirements
4. Report `output_present` / `final_status` semantics
5. Report EVIDENCE GAP for any surface that fails

---

## Surface: `task` — executive-brief (Account Brief)

**Real row**: `10034907-6c1e-4606-87de-0a5b150d8aa3` (status=failed)
**Adapter**: `adaptTaskRun()` → `execution_surface: "task"`, `manifest_id: "executive-brief"`

| Telemetry Block | Required | Present | Source |
|-----------------|----------|---------|--------|
| planner | ✅ | ✅ | `meta.planner` (plan_hash=eb7b0cc9, 10 seeds) |
| retrieval | ✅ | ❌ | `meta.library_counts` not persisted |
| artifact_gate | ✅ | ✅ | `meta.artifact_gate` (pass=false, 2 failed dims) |
| performance | ✅ | ✅ | `meta.performance` (total=197911ms) |
| anomaly_flags | ✅ | ✅ | `meta.anomaly_flags` (regen, failure, latency) |
| output_present | ✅ | ❌ | draft_output=null (failed run — correct) |

**validateSingleEvidence**: ❌ FAIL — `retrieval telemetry required but absent`
**final_status**: `failed` ✅ correct
**output_present**: `false` ✅ correct (no draft on failed run)
**Success path**: ❌ **EVIDENCE GAP** — No completed run exists. All runs fail artifact_gate.

---

## Surface: `task` — ninety-day-plan (90-Day Plan)

**Real row**: `488d5694-abfd-4beb-921c-591c8915bfa7` (status=failed)
**Adapter**: Same as executive-brief.

**validateSingleEvidence**: ❌ FAIL — `retrieval telemetry required but absent`
**Success path**: ❌ **EVIDENCE GAP** — No completed run exists.

---

## Surface: `progressive_task` — discovery-prep

**Real row**: `7b307694-4842-4f91-855f-734bf012cdcc` (status=failed)
**Adapter**: `adaptTaskRun()` → detects `meta.progressive` → `execution_surface: "progressive_task"`

| Telemetry Block | Required | Present | Source |
|-----------------|----------|---------|--------|
| planner | ✅ | ✅ | `meta.planner` (plan_hash=5076c100, 20 seeds) |
| retrieval | ✅ | ❌ | Neither `meta.library_counts` nor `meta.progressive.libraryCounts` populated |
| artifact_gate | ✅ | ✅ | `meta.artifact_gate` (pass=false, template_fidelity) |
| performance | ✅ | ✅ | `meta.performance` (total=987818ms) |
| anomaly_flags | ✅ | ✅ | `meta.anomaly_flags` |
| output_present | ✅ | ❌ | draft_output=null (failed — correct) |

**validateSingleEvidence**: ❌ FAIL — `retrieval telemetry required but absent`
**Success path**: ❌ **EVIDENCE GAP** — No completed run exists.

---

## Surface: `chat_artifact` — conversation-pov (representative)

**Real row**: `7bcb4fdd-43b4-4aa5-8e92-237b3afcd528` (strategy_messages)
**DB column `latency_ms`**: 13080 (exists in DB, was not included in initial adapter test input)
**Adapter**: `adaptChatArtifact()` with `latency_ms` from DB column

| Telemetry Block | Required | Present | Source |
|-----------------|----------|---------|--------|
| planner | ❌ | — | N/A (chat uses routing_decision) |
| retrieval | ✅ | ✅ | `content_json.routing_decision` (ki_hits=0) |
| artifact_gate | ❌ | — | N/A (chat uses inline citation audit) |
| performance | ✅ | ✅ | `latency_ms=13080` column |
| anomaly_flags | ✅ | ✅ | Derived from gate_check + routing_decision |
| output_present | ✅ | ✅ | `content_json.text` present |

**validateSingleEvidence**: ✅ PASS (when latency_ms column included)
**final_status**: `completed` ✅ correct
**output_present**: `true` ✅ correct

**Per-manifest evidence**: ⚠ **EVIDENCE GAP**
- `strategy_messages` has no `manifest_id` or `skill_id` column
- Cannot prove individual manifests (meddicc-review, demo-strategy, etc.) have distinct real rows
- All 8 chat_artifact surfaces share one table; evidence attribution is impossible per-manifest
- Real proof exists for **the adapter and contract**, but not for **individual manifest coverage**

---

## Surface: `transform` — docx-render

**Real row**: `189cea96-3d16-4861-b800-30f61ca02de1` (strategy_outputs)
**DB column `latency_ms`**: 4777 (exists in DB)
**Adapter**: `adaptTransformOutput()`

| Telemetry Block | Required | Present | Source |
|-----------------|----------|---------|--------|
| planner | ❌ | — | N/A |
| retrieval | ❌ | — | N/A |
| artifact_gate | ❌ | — | N/A |
| performance | ✅ | ✅ | `latency_ms=4777` column |
| anomaly_flags | ❌ | — | N/A |
| output_present | ✅ | ✅ | `rendered_text` + `content_json` present |

**validateSingleEvidence**: ✅ PASS (when latency_ms column included)
**final_status**: `completed` ✅ correct
**output_present**: `true` ✅ correct

**Note**: Real row is `output_type=brief`, not a DOCX render. The adapter works generically but no actual DOCX rendering row exists. This is a **minor gap** — the adapter is proven but the specific use case (DOCX) is not yet exercised.

---

## Evidence Gap Summary

| # | Surface | Gap Type | Description | Severity |
|---|---------|----------|-------------|----------|
| 1 | task (all) | RETRIEVAL | `meta.library_counts` not persisted in task_runs. Adapter returns null. Validation fails. | **BLOCKING** — registry requires retrieval but edge function doesn't persist it |
| 2 | task (all) | SUCCESS PATH | No completed run exists. All fail artifact_gate (template_fidelity, section_completeness). | **BLOCKING** — cannot prove success-path telemetry |
| 3 | progressive_task | RETRIEVAL | Same as #1 — neither `library_counts` nor `progressive.libraryCounts` populated | **BLOCKING** |
| 4 | progressive_task | SUCCESS PATH | Same as #2 | **BLOCKING** |
| 5 | chat_artifact | PER-MANIFEST | Cannot attribute messages to specific manifest_ids (no column) | **MODERATE** — adapter works, attribution absent |
| 6 | transform | SPECIFICITY | Real row is `brief` output, not actual DOCX render | **LOW** — adapter proven, specific surface untested |

## What IS Proven

- ✅ Task pipeline adapter correctly converts real DB rows to StrategyExecutionEvidence
- ✅ Progressive task detection works (meta.progressive → progressive_task surface)
- ✅ Chat artifact adapter extracts retrieval from routing_decision, performance from latency_ms column, anomaly_flags from gate_check
- ✅ Transform adapter extracts performance from latency_ms column, output_present from rendered_text
- ✅ `validateSingleEvidence` correctly rejects rows missing required telemetry (no false passes)
- ✅ `final_status` and `output_present` semantics are correct for both failed and completed rows
- ✅ All adapters produce valid StrategyExecutionEvidence shape

## What Is NOT Proven

- ❌ No task run has ever passed the artifact gate in production
- ❌ Retrieval telemetry is not persisted in task_runs.meta
- ❌ Per-manifest coverage for 8 chat artifact surfaces
- ❌ Actual DOCX render evidence

## Phase 4 Status: **NOT COMPLETE** — 4 blocking gaps remain

Next actions:
1. Persist `library_counts` / retrieval telemetry in task pipeline edge function meta
2. Investigate artifact gate failures to unblock success-path evidence
3. Add manifest_id tagging to strategy_messages for per-manifest attribution
4. Exercise a real DOCX render to capture transform evidence
