# Phase 4 — Live Production Evidence Validation Report

Generated: 2026-05-06T00:00Z
**Updated**: 2026-05-06 — Phase 4 gap fixes deployed
**Method**: Real DB rows queried, passed through adapters, validated via `validateSingleEvidence()`.
**Standard**: No synthetic fixtures. No weakened requirements. Real rows only.

---

## Fixes Deployed (This Session)

### Gap 1: RETRIEVAL — `library_counts` now persisted in task_runs.meta

**Files changed**: `runTask.ts`, `progressiveDriver.ts`
**Paths covered**:
- ✅ Task success path → `metaPatch.library_counts`
- ✅ Task authoring-fail path → `authoringFailMeta.library_counts`
- ✅ Task gate-fail path → `hardFailMeta.library_counts`
- ✅ Progressive success path → `newMeta.library_counts` (from `progressive.library_counts`)
- ✅ Progressive gate-fail path → `hardFailMeta.library_counts` (from `progressive.library_counts`)
- ✅ Evidence adapter updated: `extractRetrievalTelemetry` reads both `meta.library_counts` and `meta.progressive.library_counts`

**Status**: DEPLOYED. Next task run will persist retrieval telemetry. Adapter will convert it. `validateSingleEvidence` will pass retrieval check.

### Gap 3: CHAT PER-MANIFEST — `manifest_id` column added to `strategy_messages`

**Migration**: Added `manifest_id TEXT` column + index to `strategy_messages`
**Edge function**: `strategy-chat/index.ts` — `deriveChatManifestId()` function tags every assistant message insert with a manifest_id derived from content keywords, workspace, or workflow type.
**Insert points tagged**:
- ✅ Non-streaming assistant message
- ✅ Streaming assistant message
- ✅ Provisional routing evidence message
- ✅ Workflow result message

**Manifest mapping**:
| Chat Pattern | manifest_id |
|---|---|
| MEDDICC/MEDDPICC keywords | `meddicc-review` |
| Demo + strategy keywords | `demo-strategy` |
| Objection/pushback keywords | `objection-strategy` |
| Follow-up email keywords | `follow-up-email` |
| Discovery question keywords | `discovery-questions` |
| Research/competitor keywords | `account-research` |
| Insight/value prop keywords | `commercial-insight` |
| Default/general strategy | `conversation-pov` |
| Workflow: deep_research | `account-research` |
| Workflow: email_evaluation | `follow-up-email` |

**Status**: DEPLOYED. Next chat messages will carry `manifest_id`. Per-manifest evidence attribution now possible.

### Gap 4: DOCX/TRANSFORM — `manifest_id` column added to `strategy_outputs`

**Migration**: Added `manifest_id TEXT` column + index to `strategy_outputs`
**Edge function**: Workflow output inserts now tag `manifest_id` via `deriveChatManifestId(content, null, workflowType)`

**Status**: DEPLOYED. Next workflow outputs will carry `manifest_id`.

### Gap 2: SUCCESS PATH — Not weakened

All gate thresholds, scoring calibration, and template fidelity requirements remain UNCHANGED. The artifact gate is NOT weakened. Success-path evidence will come from a naturally passing run after retrieval telemetry improves library grounding.

---

## Evidence Gap Summary (Post-Deploy)

| # | Surface | Gap Type | Pre-Fix | Post-Fix | Severity |
|---|---------|----------|---------|----------|----------|
| 1 | task (all) | RETRIEVAL | ❌ Not persisted | ✅ Code deployed, awaiting next run | **PENDING EVIDENCE** |
| 2 | task (all) | SUCCESS PATH | ❌ All fail gate | ❌ Unchanged — gate not weakened | **EVIDENCE GAP** |
| 3 | progressive_task | RETRIEVAL | ❌ Not persisted | ✅ Code deployed, awaiting next run | **PENDING EVIDENCE** |
| 4 | progressive_task | SUCCESS PATH | ❌ All fail gate | ❌ Unchanged — gate not weakened | **EVIDENCE GAP** |
| 5 | chat_artifact | PER-MANIFEST | ❌ No column | ✅ Column + tagging deployed | **PENDING EVIDENCE** |
| 6 | transform | SPECIFICITY | ❌ No docx-render row | ✅ Column deployed, awaiting run | **PENDING EVIDENCE** |

## Release Gate Status

The release gate now **fails** if any enforced surface has an `EVIDENCE GAP` marker in this report. Phase 4 is **NOT COMPLETE** until:
1. A post-deploy task run persists `library_counts` and passes `validateSingleEvidence` retrieval check
2. At least one task run passes the artifact gate naturally (success-path evidence)
3. Chat messages with `manifest_id` exist for each registered chat surface
4. A strategy_outputs row with `manifest_id = docx-render` exists

## Phase 4 Status: **NOT COMPLETE** — code fixes deployed, awaiting real DB evidence rows
