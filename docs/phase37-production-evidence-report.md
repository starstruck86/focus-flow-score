# Phase 4 — Live Production Evidence Validation Report

Generated: 2026-05-06T00:00Z
**Updated**: 2026-05-06 — Real post-deploy executions run and validated
**Method**: Real DB rows queried from production, manifest_id tagging validated, telemetry fields checked.
**Standard**: No synthetic fixtures. No weakened requirements. Real rows only.

---

## TASK PIPELINE EVIDENCE (Post-Deploy)

### account_brief — `486e43d3-3102-45b2-b6d7-932627ab5f9b`
- **Status**: `failed` (artifact_gate: template_fidelity, section_completeness)
- **library_counts**: ✅ `{"kis": 20, "playbooks": 0}` — retrieval telemetry persisted
- **artifact_gate**: ✅ `{"pass": false, "regen_attempts": 1, "failed_dimensions": ["template_fidelity", "section_completeness"], "total_gate_latency_ms": 83625}`
- **performance**: ✅ `{"gate_latency_ms": 83625, "total_latency_ms": 230514, "generation_latency_ms": 163068}`
- **draft_output**: ✅ Correctly NULL (failed run must not leak draft)
- **Adapter**: `adaptTaskRun` converts successfully. `validateSingleEvidence` passes for failure-path semantics.

### ninety_day_plan — `e2d94d5f-97c8-41c2-92f5-01a185745900`
- **Status**: `failed` (artifact_gate: template_fidelity, section_completeness)
- **library_counts**: ✅ `{"kis": 20, "playbooks": 0}`
- **artifact_gate**: ✅ `{"pass": false, "regen_attempts": 1, "failed_dimensions": ["template_fidelity", "section_completeness"], "total_gate_latency_ms": 85954}`
- **performance**: ✅ `{"gate_latency_ms": 85954, "total_latency_ms": 245931, "generation_latency_ms": 168566}`
- **draft_output**: ✅ Correctly NULL
- **Adapter**: Passes.

### discovery_prep — `5f3676e1-5d05-4a4f-8e62-e3664d58db72`
- **Status**: `pending` — run appears stalled (no progress beyond synthesis after 7+ minutes)
- **library_counts**: ❌ Not persisted (run never completed pipeline)
- **artifact_gate**: ❌ Not reached
- **performance**: ❌ Not reached
- **Adapter**: Cannot validate — no telemetry emitted.
- **EVIDENCE GAP**: discovery_prep run stalled. Stale run watchdog should eventually fail it, but no completed or properly-failed evidence exists yet.

### SUCCESS-PATH — All Task Types
- **EVIDENCE GAP**: Every post-deploy task run fails `artifact_gate` on `template_fidelity` and `section_completeness`. No task has ever passed the gate post-deploy. Gates are NOT weakened. Success-path evidence requires a naturally passing run.

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
| `demo-strategy` | — | — | — | — | — | ❌ EVIDENCE GAP |
| `discovery-questions` | — | — | — | — | — | ❌ EVIDENCE GAP |

### Chat Manifest Attribution Gaps

- **demo-strategy**: Message about "demo strategy for Snowflake" was tagged `conversation-pov` instead of `demo-strategy`. The `deriveChatManifestId()` keyword matcher does not detect "demo" + "strategy" as separate words — only fires when both appear together in a specific regex pattern. Fix: update regex to match `\b(demo)\b.*\b(strategy)\b`.
- **discovery-questions**: Message about "discovery questions" was tagged `conversation-pov`. Same root cause — the keyword matcher's `discovery` regex also matches `discovery_prep` task type context and defaults to `conversation-pov` for brainstorm workspace. Fix: add explicit `\b(discovery).*(question|probe)\b` pattern.

---

## TRANSFORM / DOCX-RENDER EVIDENCE

- **strategy_outputs rows with manifest_id**: 0
- **EVIDENCE GAP**: No post-deploy strategy_outputs rows exist with `manifest_id`. The `deriveChatManifestId` tagging was deployed for `strategy-chat` inserts, but no workflow that writes to `strategy_outputs` has been triggered post-deploy.
- **Existing rows** (pre-deploy, no manifest_id): `189cea96` (brief), `15860e3c` (memo)

---

## EVIDENCE GAP SUMMARY

| # | Surface | Gap | Severity | Blocker? |
|---|---------|-----|----------|----------|
| 1 | task (all types) | SUCCESS PATH — no run passes artifact_gate | **CRITICAL** | YES |
| 2 | discovery_prep | Stalled pending run — no telemetry emitted | **HIGH** | YES |
| 3 | demo-strategy | Keyword matcher misattribution | **MEDIUM** | YES — no evidence row |
| 4 | discovery-questions | Keyword matcher misattribution | **MEDIUM** | YES — no evidence row |
| 5 | docx-render | No strategy_outputs row with manifest_id | **HIGH** | YES |

## VALIDATED EVIDENCE (Adapter + validateSingleEvidence)

| Surface | Evidence Type | Row ID | Adapter | Validation |
|---------|--------------|--------|---------|------------|
| account_brief (fail) | task_run | `486e43d3` | `adaptTaskRun` ✅ | `validateSingleEvidence` ✅ |
| ninety_day_plan (fail) | task_run | `e2d94d5f` | `adaptTaskRun` ✅ | `validateSingleEvidence` ✅ |
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

Post-deploy chat messages now persist `manifest_id` — confirmed by 8 real rows above.

---

## Phase 4 Status: **NOT COMPLETE**

### Remaining work to close:
1. **Fix `deriveChatManifestId` regex** for demo-strategy and discovery-questions patterns
2. **Trigger workflow** that writes to `strategy_outputs` with `manifest_id` for docx-render evidence
3. **Investigate artifact_gate failures** — template_fidelity and section_completeness consistently fail. Root cause may be synthesis prompt contract mismatch rather than content quality.
4. **Clear stalled discovery_prep run** and trigger a new one

### What IS proven:
- Retrieval telemetry (`library_counts`) persists on task failure paths ✅
- Artifact gate telemetry persists on task failure paths ✅
- Performance telemetry persists on task failure paths ✅
- Failed runs do NOT leak `draft_output` ✅
- Chat manifest_id tagging works for 6/8 registered manifests ✅
- Chat messages persist routing_decision, retrieval_meta, gate_check, latency_ms ✅
- Release gate correctly fails when EVIDENCE GAP markers exist ✅
