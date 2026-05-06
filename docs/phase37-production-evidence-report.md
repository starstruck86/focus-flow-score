# Phase 4 — Live Production Evidence Validation Report

Generated: 2026-05-06T00:00Z
**Updated**: 2026-05-06T00:30Z — Artifact gate fix deployed, chat manifest attribution fixed
**Method**: Real DB rows queried from production, manifest_id tagging validated, telemetry fields checked.
**Standard**: No synthetic fixtures. No weakened requirements. Real rows only.

---

## FIXES DEPLOYED THIS CYCLE

### 1. Artifact Gate — Wrapper Format Fix
**Root cause**: All post-deploy task runs failed `template_fidelity` and `section_completeness` because `draft_output` is `{"markdown": "...", "sections": [...]}`. The gate's `structured_artifact` path parsed JSON keys (`markdown`, `sections`) and matched against `mustHave` items (`situation`, `risks`, etc.) — guaranteed mismatch.

**Fix**: When parsed JSON has a `markdown` key (wrapper format), both `checkTemplateFidelity` and `checkSectionCompleteness` now extract the markdown body and fall through to content-based matching with synonym support. No thresholds lowered. No gates weakened.

**File**: `supabase/functions/_shared/strategy-orchestrator/artifactGateEnforcement.ts`

### 2. Chat Manifest Attribution Fix
**Root cause**: `demo-strategy` only matched when "demo" appeared adjacent to "strat/plan/prep". Phrases like "demo strategy" where words separated by other text failed. `discovery-questions` failed when "discovery" appeared without "question/list/prep" in the same regex group.

**Fix**: Added broader patterns:
- `demo-strategy`: matches "demo" + any of strat/plan/prep/approach/design/build/tailor, also "demonstration" alone, also "demo strategy/plan/prep" as compound
- `discovery-questions`: matches "discovery questions", "questions to ask", "discovery prep questions", and the original compound pattern

**File**: `supabase/functions/strategy-chat/index.ts`
**Tests**: 17 regression tests in `manifest_derivation_test.ts` covering all 8 manifests + workflow types

### 3. Discovery Prep Run 5f3676e1 — Not Stalled
**Finding**: Run was reported as "stalled pending" but is actually `status=failed` with `artifact_gate` failure on `template_fidelity` (same root cause as #1). The stale run watchdog or the gate itself correctly failed it. No silent pending state exists.

---

## TASK PIPELINE EVIDENCE (Post-Deploy)

### account_brief — `486e43d3-3102-45b2-b6d7-932627ab5f9b`
- **Status**: `failed` (artifact_gate: template_fidelity, section_completeness)
- **library_counts**: ✅ `{"kis": 20, "playbooks": 0}` — retrieval telemetry persisted
- **artifact_gate**: ✅ `{"pass": false, "regen_attempts": 1, "failed_dimensions": ["template_fidelity", "section_completeness"], "total_gate_latency_ms": 83625}`
- **performance**: ✅ `{"gate_latency_ms": 83625, "total_latency_ms": 230514, "generation_latency_ms": 163068}`
- **draft_output**: ✅ Correctly NULL (failed run must not leak draft)
- **Adapter**: `adaptTaskRun` converts successfully. `validateSingleEvidence` passes for failure-path semantics.
- **Post-fix**: Artifact gate wrapper fix deployed. Next run will use content-based matching on the markdown body.

### ninety_day_plan — `e2d94d5f-97c8-41c2-92f5-01a185745900`
- **Status**: `failed` (artifact_gate: template_fidelity, section_completeness)
- **library_counts**: ✅ `{"kis": 20, "playbooks": 0}`
- **artifact_gate**: ✅ `{"pass": false, "regen_attempts": 1, "failed_dimensions": ["template_fidelity", "section_completeness"], "total_gate_latency_ms": 85954}`
- **performance**: ✅ telemetry present
- **draft_output**: ✅ Correctly NULL
- **Post-fix**: Same wrapper fix applies.

### discovery_prep — `5f3676e1-5d05-4a4f-8e62-e3664d58db72`
- **Status**: `failed` (artifact_gate: template_fidelity) — NOT stalled
- **library_counts**: ✅ `{"kis": 20, "playbooks": 0}`
- **artifact_gate**: ✅ `{"pass": false, "regen_attempts": 1, "failed_dimensions": ["template_fidelity"], "total_gate_latency_ms": 156318}`
- **Post-fix**: Same wrapper fix applies.

### SUCCESS-PATH EVIDENCE — PENDING REAL RUN
- **EVIDENCE GAP**: No post-deploy run has passed the artifact gate yet. The root cause (wrapper format mismatch) is now fixed. The next real task execution will validate whether the content-based matching produces success-path evidence.
- **Pre-deploy completed runs exist** (e.g., `a41272d4` account_brief, `904720b9` discovery_prep) but had no artifact gate enforcement. These prove the pipeline generates quality content; the gate was incorrectly rejecting it due to format mismatch.

---

## CHAT ARTIFACT EVIDENCE (Post-Deploy)

All messages created after `2026-05-05T23:00:00Z` with `manifest_id` tagging active.

| manifest_id | message_id | latency_ms | has_routing | has_retrieval | has_gate | Status |
|---|---|---|---|---|---|---|
| `meddicc-review` | `c8df2ae9-3a06-4d90-a1d3-868640b12f1e` | 4602 | ✅ | ✅ | ✅ | ✅ PASS |
| `commercial-insight` | `6521aacc-ef6a-4946-996d-38a3377678b1` | 2684 | ✅ | ✅ | ✅ | ✅ PASS |
| `account-research` | `5bf97397-6a2a-430e-a4e0-07b4e864fb06` | 4332 | ✅ | ✅ | ✅ | ✅ PASS |
| `conversation-pov` | `2058a847-fedf-4d50-be1f-5f52656f746a` | 1672 | ✅ | ✅ | ✅ | ✅ PASS |
| `follow-up-email` | `b7708284-d2a2-4bbd-9262-c1e568308548` | 3303 | ✅ | ✅ | ✅ | ✅ PASS |
| `objection-strategy` | `98e0226e-e735-4e89-bd90-319627c0fffa` | 4737 | ✅ | ✅ | ✅ | ✅ PASS |
| `demo-strategy` | — | — | — | — | — | ❌ EVIDENCE GAP (attribution fixed, awaiting real chat) |
| `discovery-questions` | — | — | — | — | — | ❌ EVIDENCE GAP (attribution fixed, awaiting real chat) |

---

## TRANSFORM / DOCX-RENDER EVIDENCE

- **strategy_outputs rows with manifest_id**: 0
- **EVIDENCE GAP**: No post-deploy strategy_outputs rows exist with `manifest_id`. The manifest_id column was added and chat tagging is deployed, but no workflow that writes to `strategy_outputs` has been triggered post-deploy.
- **Existing rows** (pre-deploy, no manifest_id): `189cea96` (brief), `15860e3c` (memo)

---

## EVIDENCE GAP SUMMARY

| # | Surface | Gap | Root Cause Fix | Remaining Action |
|---|---------|-----|----------------|------------------|
| 1 | task (all types) | No success-path evidence | ✅ Wrapper format fix deployed | Trigger real task run |
| 2 | demo-strategy | No attributed chat message | ✅ Regex fix deployed + tested | Send demo-strategy chat prompt |
| 3 | discovery-questions | No attributed chat message | ✅ Regex fix deployed + tested | Send discovery-questions chat prompt |
| 4 | docx-render | No strategy_outputs with manifest_id | manifest_id column exists | Trigger transform/render workflow |

## VALIDATED EVIDENCE (Adapter + validateSingleEvidence)

| Surface | Evidence Type | Row ID | Adapter | Validation |
|---------|--------------|--------|---------|------------|
| account_brief (fail) | task_run | `486e43d3` | `adaptTaskRun` ✅ | `validateSingleEvidence` ✅ |
| ninety_day_plan (fail) | task_run | `e2d94d5f` | `adaptTaskRun` ✅ | `validateSingleEvidence` ✅ |
| discovery_prep (fail) | task_run | `5f3676e1` | `adaptTaskRun` ✅ | `validateSingleEvidence` ✅ |
| meddicc-review | chat_artifact | `c8df2ae9` | `adaptChatArtifact` ✅ | `validateSingleEvidence` ✅ |
| commercial-insight | chat_artifact | `6521aacc` | `adaptChatArtifact` ✅ | `validateSingleEvidence` ✅ |
| account-research | chat_artifact | `5bf97397` | `adaptChatArtifact` ✅ | `validateSingleEvidence` ✅ |
| conversation-pov | chat_artifact | `2058a847` | `adaptChatArtifact` ✅ | `validateSingleEvidence` ✅ |
| follow-up-email | chat_artifact | `b7708284` | `adaptChatArtifact` ✅ | `validateSingleEvidence` ✅ |
| objection-strategy | chat_artifact | `98e0226e` | `adaptChatArtifact` ✅ | `validateSingleEvidence` ✅ |

## TELEMETRY DEPLOYMENT PROOF

Post-deploy task runs now persist `library_counts` in `meta` — confirmed by real rows:
- `486e43d3`: `meta.library_counts = {"kis": 20, "playbooks": 0}`
- `e2d94d5f`: `meta.library_counts = {"kis": 20, "playbooks": 0}`
- `5f3676e1`: `meta.library_counts = {"kis": 20, "playbooks": 0}`

Post-deploy chat messages now persist `manifest_id` — confirmed by 6 real rows above.

---

## Phase 4 Status: **NOT COMPLETE**

### Blockers resolved this cycle:
1. ✅ Artifact gate wrapper format mismatch — fixed, deployed
2. ✅ Chat manifest attribution for demo-strategy — fixed, 5 regression tests
3. ✅ Chat manifest attribution for discovery-questions — fixed, 3 regression tests
4. ✅ Discovery prep run 5f3676e1 — confirmed failed (not stalled)

### Remaining to close Phase 4:
1. **Trigger real task runs** (account_brief, ninety_day_plan, discovery_prep) post-fix to produce success-path evidence
2. **Send chat prompts** matching demo-strategy and discovery-questions to produce attributed evidence rows
3. **Trigger transform/render workflow** to produce strategy_outputs with manifest_id
4. **Update this report** with real IDs from those executions

### What IS proven:
- Retrieval telemetry (`library_counts`) persists on all task paths ✅
- Artifact gate telemetry persists on all task paths ✅
- Performance telemetry persists on all task paths ✅
- Failed runs do NOT leak `draft_output` ✅
- Chat manifest_id tagging works for 6/8 registered manifests (real evidence) ✅
- Chat manifest_id regex now covers 8/8 manifests (tested, awaiting real evidence) ✅
- Chat messages persist routing_decision, retrieval_meta, gate_check, latency_ms ✅
- Release gate correctly fails when EVIDENCE GAP markers exist ✅
