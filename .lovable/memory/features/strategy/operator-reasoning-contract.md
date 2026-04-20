---
name: Strategy Operator-Grade Reasoning Contract
description: Mandatory thinking-layer prompt + post-gen guard for synthesis/creation/evaluation modes — forces pattern extraction → POV → unequal weighting → IF/THEN decision logic → consequence framing tied to pipeline/velocity/win rate/churn. Kills book-smart, low-agency output.
type: feature
---

# Operator-Grade Reasoning Contract

Lives in `supabase/functions/strategy-chat/index.ts`. Applies ONLY to grounded modes: `synthesis`, `creation`, `evaluation`. Composes with the existing Application Layer + body↔appendix consistency guard.

## Prompt layer — `operatorReasoningContract`

Prepended to all three grounded mode-locks, before the Application Layer. Forces a 5-step thinking sequence:

1. **Pattern extraction** across sources (not within one). Behavioral/structural patterns only — vibes are banned.
2. **Point of view** — name the 2-3 patterns that drive outcomes AND the noise/table-stakes to ignore.
3. **Weighted model** — unequal weights with per-weight rationale citing pattern + source.
4. **Decision logic** — 2-4 step IF/THEN sequence the rep can run mid-deal.
5. **Consequence framing** — every dimension tied to pipeline / velocity / win rate / ACV / expansion / churn / payback / cost-of-inaction.

Self-validation rule baked into the prompt: if the output could have been written without the library, all weights are equal, recommendations are behavioral fluff, or no recommendation ties to a measurable outcome → restart.

## Post-gen guard — `auditOperatorReasoning(body)`

Runs after `stripApplicationAppendix()` so it scores the body, not the appendix. Returns violations; 2+ violations triggers a strict one-shot regen. Thresholds:

| Check | Trigger |
|---|---|
| `operator_no_consequence_framing` | <2 hits across {pipeline, velocity, win rate, churn, expansion, ACV, ARR, payback, cost of inaction, deal stalls/slips/dies, time-to-revenue, forecast, conversion rate, quota, attainment} |
| `operator_no_decision_logic` | No `IF…THEN/do/run`, no `WHEN…then/do`, no "dominant move", "next move", "Playbook:" |
| `operator_behavioral_fluff` | ≥1 hit on banned phrases: "ask better questions", "build trust/rapport", "be authentic/curious/confident", "observe tone", "active listening", "stay curious", "show empathy", "mirror their language" |
| `operator_no_tradeoffs` | <2 hits across {instead of, not because, deprioritize, table stakes, noise, matters more/less, weighted higher/lower, ignore, overvalued, underrated, tradeoff} |
| `operator_no_pov_commitment` | No phrase like "the dominant", "the highest-leverage", "the one thing", "the biggest", "what actually matters", "the real driver/lever", "the single biggest", "the core" |

Violations are namespaced per mode (e.g. `synthesis_operator_no_consequence_framing`) and surface in `[operator-reasoning]` logs + `routing_decision.guard_violations`.

Word-count floor: only fires when body wordCount ≥ 120, so short-form/freeform answers are unaffected.

## Composition order in mode-lock prompts

```
MODE LOCK header
├── HARD GROUNDING REQUIREMENT
├── REQUIRED OUTPUT SHAPE (sections + table)
├── FORBIDDEN list
├── THIN-MODE CONTRACT
├── ${operatorReasoningContract}   ← thinking layer
├── ${economicLayer}                (creation only)
├── ${constraintLine}
├── ${substanceContract}
├── ${applicationLayer}             ← real-world adaptation
└── ${bindingClause}
```

## What this prevents

- "Ask discovery questions to understand pain" — fluff, no consequence, no decision logic → FAIL.
- A 5-dimension framework with 20% weights each → caught by existing equal-weights guard AND operator_no_tradeoffs.
- Generic CFO business case that lists benefits with no IF/THEN, no payback math, no consequence → operator_no_decision_logic + operator_no_consequence_framing → regen.
- Any output a generic LLM could produce without the user's library → fails ≥2 of the 5 checks.
