---
name: Phase 3.5C Artifact Gate
description: Five deterministic gates (template fidelity, readability, section completeness, evidence discipline, usability QA) that reject unusable artifacts before delivery
type: feature
---

## Phase 3.5C — Artifact Gate (LOCKED)

### Principle
Hard stop between generation and delivery. ANY dimension failure → artifact rejected → one regen attempt → if still failing → `artifact_gate_failed` = Strategy LOSS.

### Five Gates (all deterministic, no LLM)

1. **Template Fidelity** — Top-level keys/headings must match manifest `mustHave`. Missing or extra sections → FAIL.
2. **Readability** — Max 120 words/paragraph. ≥200 words with no line breaks → FAIL. >70% dense prose → FAIL.
3. **Section Completeness** — Every mustHave ≥40 words, contains substance (metric/stakeholder/causal), no filler → FAIL.
4. **Evidence Discipline** — >3 citations per sentence = stuffing → FAIL. Citation without causal language ±2 sentences = orphan → FAIL. JSON artifacts extract string values before checking.
5. **Usability QA** — Composite: if ANY gate fails → overall FAIL. No override, no weighting.

### Synthesis Contract Hardening (Phase 3.5C-fix)
- Synthesis prompt now includes explicit mustHave section list with exact ordering
- Structured artifacts: mustHave → exact top-level JSON keys
- Prose: mustHave phrases must appear literally in text
- Evidence placement rules: every citation must have causal language in same/adjacent sentence
- Constrained prose: 2-4 short paragraphs (max 100 words each), not one wall of text

### Regen Hardening
- Regen prompt is gate-specific: includes exact failed diagnostics + gate-specific fix instructions
- Template fidelity fix: rename/reorder to exact required keys
- Evidence discipline fix: rewrite citations into causal claim sentences
- Readability fix: split dense paragraphs
- Section completeness fix: expand stubs with metrics/stakeholder/causal reasoning

### Implementation
- Pure logic: `src/lib/strategy-control/artifactGate.ts`
- Inline copy in: `supabase/functions/run-strategy-eval-synthesis/index.ts`
- Tests: 78/78 passing across 8 test files
- Validation runner: `supabase/functions/run-phase35b-validation/index.ts`

### Live Validation Results (Post-Fix)
| Case | Gate Pass | Regen | Final Winner |
|------|-----------|-------|--------------|
| conversation-pov | ✅ | regen succeeded | Strategy |
| commercial-insight | ✅ | regen succeeded | Strategy |
| discovery-prep | ✅ | no regen needed | Strategy |
| executive-brief | ✅ | regen succeeded | Strategy |
| meddicc-review | N/A (422 library gate) | N/A | N/A |

### Does NOT change
- 3.5B scorer hardening (unchanged)
- Scoring scale (1–5)
- Artifact gate thresholds (unchanged — synthesis was fixed, not the gate)
