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
4. **Evidence Discipline** — >3 citations per sentence = stuffing → FAIL. Citation without causal language ±2 sentences = orphan → FAIL.
5. **Usability QA** — Composite: if ANY gate fails → overall FAIL. No override, no weighting.

### Implementation
- Pure logic: `src/lib/strategy-control/artifactGate.ts`
- Tests: `src/lib/strategy-control/__tests__/phase35c-artifact-gate.test.ts` (16 tests)
- Validation runner: `supabase/functions/run-phase35b-validation/index.ts` (inlined gate, artifact_gate_failed = Strategy LOSS)
- Total strategy control tests: 50/50 passing

### Does NOT change
- 3.5B scorer hardening (unchanged)
- Scoring scale (1–5)
- Synthesis prompt
- Adversarial loop
