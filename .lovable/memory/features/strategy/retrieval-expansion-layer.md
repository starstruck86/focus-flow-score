---
name: Strategy Retrieval Expansion Layer
description: Server-authoritative business→sales vocabulary bridge applied uniformly to every skill plan; deterministic, additive, gate-preserving
type: feature
---

# Retrieval Expansion Layer (Phase 3B)

System-level translator between user business language ("platform consolidation", "guest experience", "renewal") and library sales-methodology vocabulary ("discovery", "POV", "business case", "value realization"). Eliminates per-skill manifest patching for vocabulary mismatch.

## Authority

- **Source of truth:** `supabase/functions/_shared/strategy-skills/expansion.ts` + `salesLexicon.ts`.
- **Mirror only (UI/debug):** `src/lib/strategy-skills/planner/expandSeeds.ts` + `salesLexicon.ts`. Server NEVER trusts client-supplied `expandedSeeds` — it rebuilds from raw `termSeeds` + ctx anchors.

## Hard rules

1. **Additive only** — original `termSeeds` remain authoritative and lead the keyword payload; expansions appended after.
2. **Never satisfies `unresolvedBindings`** — missing inputs stay missing.
3. **Never softens the gate** — `sourceMode`, `minRelevantItems`, and `applySourceModeGate` are untouched. Expansion widens the *query*, not the *acceptance threshold*.
4. **Deterministic** — pure tables (no LLM, no embeddings, no clocks, no randomness). Stable iteration order.
5. **Capped** at `EXPANSION_MAX = 8` per plan.
6. **Versioned** via `LEXICON_VERSION` ("1"); folded into `planHash` + `contextHash` so cache invalidation is automatic when the lexicon evolves.

## Three rules in expansion order

1. **Lexicon scan** of each raw seed → token-bounded substring match (e.g. `consolidation` → `change management`, `business case`, `discovery`).
2. **Context anchors** — `ctx.thread.opportunity.stage` is appended even when manifest doesn't bind it.
3. **Persona role inference** — persona title is matched against the lexicon (e.g. `General Manager` → `decision maker`, `economic buyer`).

## Trace contract (in `SkillTrace.plan`)

- `term_seeds` (raw, authoritative)
- `expanded_seeds` (NEW)
- `expansion_trace[]` with `{ term, source: 'lexicon'|'context_anchor'|'persona_role', rule, fromInput?, lexiconVersion }`
- `lexicon_version` (NEW)
- `expansion_enabled` (NEW)

## Feature flag

- Server-controlled secret: `STRATEGY_EXPANSION_ENABLED` (`1|true|on|yes` → enabled). Default OFF in prod until validation passes; ON in dev.
- Read by `readExpansionFlagFromEnv()` inside `buildPlan`. Tests inject `flagsOverride` directly.
- Frontend mirror defaults to OFF; flag is informational only on the client.

## Why the design

Per-skill manifest patches (`${inputs.stage}`, `${inputs.methodology}`) don't scale: each new skill repeats the work and the underlying problem (vocabulary mismatch) is system-wide. The expansion layer fixes it once for every current and future skill.
