---
name: Strategy Synthesis Mode
description: Resource-grounded derivation mode in strategy-chat — pre-gen short-circuit on <2 hits, mandatory 5-section output (Pattern Extraction → Dimensions table → Weighting Rationale → Example Scoring → Source Attribution), structural guard with equal-weight + generic-stage detection
type: feature
---

# Strategy Synthesis Mode

Triggered by **dual signal**: grounding phrase ("using my resources", "from my library", etc.) AND derivation phrase ("come up with", "derive", "build a framework", "scoring system", "rubric"). Implemented in `supabase/functions/strategy-chat/index.ts`:

- **Intent classifier** (`classifyChatIntent`): regex pair `SYNTH_GROUNDING_RE` × `SYNTH_DERIVE_RE`/`SYNTH_NOUN_HINT_RE`.
- **Force core routing**: synthesis intent always sets `useCore=true` so resource retrieval runs.
- **Pre-gen short-circuit**: if `intent==="synthesis"` and `resourceHits.length < 2`, the LLM is **never called**. We persist + return: *"I don't have enough signal in your resources to derive a real system. Point me to 2–3 specific assets and I'll build this properly."*
- **MODE LOCK**: requires 5 numbered sections in exact order: (1) Pattern Extraction, (2) Dimensions table with `| # | Dimension | Definition | Weight | Derived From |`, (3) Weighting Rationale, (4) Example Scoring with visible math, (5) Source Attribution.
- **Hard rules in the prompt**: weights must be unequal and sum to 100%; every dimension must cite KI[id] / PLAYBOOK[id] / "Exact Title"; no generic-LLM fallback; no "Opener / Pitch / Close" unless explicitly grounded.
- **Post-gen `enforceModeLock` synthesis case**:
  - Strips forbidden phrases: "based on the resources", "in general", "best practice", "industry standard", "as a general rule", "generally speaking", "typically".
  - Flags missing sections, missing table, missing citations.
  - **Equal-weight detector**: parses `| 20% |` cells from the table; if all weights identical → `shouldRegenerate`.
  - **Generic-scaffold detector**: flags `Opener/Pitch/Close` and `Discovery/Demo/Close` triplets.

## Why this matters
Without these guards Strategy returns generic frameworks that could be produced by any LLM without access to the user's library — which destroys the product's value proposition. The pre-gen short-circuit is the strongest guarantee: when grounding is impossible, we refuse to synthesize.
