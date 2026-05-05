---
name: Phase 3.5B Scorer Hardening Standard
description: Locked scorer gates requiring cross-section causality for structure/biz-impact 5/5; baseline flat JSON capped at 4
type: feature
---

## Phase 3.5B — Scorer Hardening (LOCKED)

**Commit:** `f1cc7e55`
**Rollback:** `git revert f1cc7e55`

### Structure 5/5 Gate
A 5 on structure requires cross-section causality:
- Embedded KI/PB citations in section values (≥2 = +3 signals)
- Deep nested reasoning: objects with 3+ keys containing sub-objects (≥4 = +3)
- Explicit causal connectors within JSON values (≥3 = +2)
- Flat JSON with independent sections → max 4

### Business Impact 5/5 Gate
A 5 requires ALL of:
1. Causal chain: 3+ of 4 phases (current state → consequence → financial impact → action)
2. Stakeholder role tied to specific impact (not just mentioned)
3. Cross-section causality (same as structure gate)
- Generic value language with <2 quantifications → max 3

### Cross-Section Causality Bonus
+1 within cap when signals ≥4. Applied to business impact scores 3-4.

### Validation Endpoint
- Secured with `x-validation-key` header (matches `STRATEGY_VALIDATION_KEY` secret)
- Returns `attempt_id`, `cases_errored`, `all_cases_ran` for audit trail
- Includes rollback instructions in response

### Regression Suite
- `src/lib/strategy-control/__tests__/phase35b-scorer-hardening.test.ts` (7 tests)
- Total strategy control tests: 34/34 passing
