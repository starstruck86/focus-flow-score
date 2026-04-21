# LOCKED — Phase 2.6 Strong-Signal Synthesis Contract

**Status:** Frozen as of Phase 2.6 validation pass (Test A: 0.93, Test B: 0.79).
**Do not modify** without re-running the 2 Phase 2.6 regression tests AND
all 6 Phase 3 validation prompts. If any of these change, this contract
must be re-locked with the new snapshot date and a note explaining the
deliberate change.

## Trigger conditions
- `ask_shape == "synthesis_framework"`
- `mode == "A_strong"` (or `(synthesis_framework && total_hits >= 3)` for the citation block)

## Routing
- `primaryProvider = "anthropic"`
- `model = "claude-sonnet-4-5-20250929"`
- `fallbackProvider = "openai"`, `fallbackModel = "gpt-4o"`
- On fallback, persist `claude_fallback: true` flag in `routing_decision.v2`.
  **Never silent.**

## The 5 non-negotiables (must all be present in every strong-signal
##                          synthesis output — checked by tail block in
##                          `extendedReasoningContract.ts` and audited by
##                          `qualityAudit.ts`)
1. **POV-first opener** — first sentence commits to the dominant pattern.
   Forbidden openers: "Operators converge…" / "There are several patterns…" /
   "Both approaches have merit" / "It depends" — unless immediately followed
   by a named winner.
2. **Literal citations** — `RESOURCE["title"]` or `KI[id]` form. Vague refs
   like "your KI on discovery" are FAILURES when `total_hits >= 5`.
3. **Unequal weighting** — explicit ranking: load-bearing vs noise vs
   table-stakes. Pattern lists without weighting fail.
4. **Commercial consequence** — every load-bearing claim ties to win rate,
   cycle time, ACV, no-decision rate, churn, or forecast confidence.
   "Improves discovery" does NOT count.
5. **Numbered next moves** — 3–5 specific moves the rep runs THIS WEEK on a
   live deal. Each tied to a commercial outcome.

## Tail-block placement
The synthesis tail block MUST be the LAST block in the system prompt (after
all context, after the rubric). This is a recency hack that worked in
Phase 2.6.

## Quality audit stop-rules
- `synthesis_strong_fail` — fires when any of POV / literal citation /
  tradeoff / commercial framing is missing. Caps quality score at 0.35.
- `descriptive_synthesis_despite_citations` — fires when literal citations
  exist but the structure is still a balanced survey.

## Validation evidence (Phase 2.6)
- **Test A** ("Synthesize what I have in my library on discovery — patterns,
  framework, where operators converge vs diverge. Cite specific resources."):
  PASS. Quality 0.93. 12 resource citations. POV-first.
- **Test B** ("Using my discovery resources, what do the best discovery calls
  have in common, what do mediocre reps overweight, and what should a rep
  actually do differently next week?"): PASS. Quality 0.79. Operator-grade
  weighting, commercial framing.

## Contract-drift sentinel (logged, never blocks)
`extendedReasoningContract.ts` exports `assertSynthesisContractIntact()`
which scans the assembled system prompt for the 5 non-negotiable phrases.
If any are missing on a strong-signal synthesis turn, a `contract_drift`
flag is logged in `routing_decision.v2.contract_drift`.
