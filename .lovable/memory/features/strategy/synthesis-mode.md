---
name: Strategy Library-Grounded Modes (Synthesis / Creation / Evaluation)
description: Three resource-grounded intents in strategy-chat — synthesis derives systems, creation builds assets, evaluation grades content. Each has dual-signal triggers, pre-gen short-circuit on insufficient hits, mandatory output contracts (5-section synthesis, 4-section creation, 6-section evaluation), and post-gen structural guards.
type: feature
---

# Strategy Library-Grounded Modes

All three modes live in `supabase/functions/strategy-chat/index.ts` and share the same architecture: dual-signal intent classifier → forced `useCore=true` → pre-gen short-circuit on thin signal → mode-locked system prompt → post-gen structural guard with one-shot regen.

## Triggers (dual signal required)

Shared **grounding regex** (`SYNTH_GROUNDING_RE`):
`(using|use|based on|from|leveraging|drawing on|pulling from|grounded in|across|against) (my|the|these|those|our) [...up to 4 qualifier words...] (resource|library|playbook|kis|materials|transcripts|docs|uploads|standards|...)`

| Intent | Second signal | Min resources |
|---|---|---|
| `synthesis` | derivation verb (`come up with`, `derive`, `build/create framework/rubric/scoring/model`) OR noun hint (`scoring system`, `rubric`, `framework`, `weighting`) | 2 |
| `creation` | `CREATE_VERB_RE` (`write`, `draft`, `create`, `build`, `turn into`, `generate`) AND `CREATE_NOUN_RE` (`email`, `script`, `talk track`, `call plan`, `one-pager`, `business case`, `playbook`, `sequence`, `outline`, …) | 1 |
| `evaluation` | `EVAL_VERB_RE` (`grade`, `score`, `evaluate`, `critique`, `review`, `coach me on`, `assess`, `audit`, `red-team`, `tear down`, `improve`, `tighten`, `rewrite this/it/my`) | 2 |

All three force `useCore=true` so resource retrieval always runs.

## Pre-gen short-circuit

If `groundedIntent && resourceHits.length < minHits`, the LLM is **never called**. We persist + return:
- synthesis: *"I don't have enough signal in your resources to derive a real system. Point me to 2–3 specific assets and I'll build this properly."*
- creation/evaluation: *"I don't have enough signal in your resources to do this properly. Point me to specific assets and I'll build this correctly."*

Persisted with `provider_used=<intent>-guard` and `library_short_circuit` metadata for audit.

## Output contracts

### Synthesis (5 sections)
1. Pattern Extraction (3-6 patterns, 2+ source citations each)
2. Dimensions table `| # | Dimension | Definition | Weight | Derived From |`
3. Weighting Rationale (per dimension, citing source)
4. Example Scoring (visible math)
5. Source Attribution (source → dimensions map)

Hard rules: weights unequal, sum to 100%, every row cites KI[id] / PLAYBOOK[id] / "Title".

### Creation (4 sections)
1. Source Basis (which resources used, how)
2. Reused vs Created (explicit split, citations on reused lines)
3. The Asset (clean, paste-ready)
4. Gaps / Missing Anchors

### Evaluation (6 sections)
1. Overall Score (`Overall: N/10 — verdict`)
2. Dimension Breakdown table `| Dimension | Score | What Worked | What Failed | Source |`
3. Key Gaps (ranked, each cites a violated source pattern)
4. Improvements (Grounded) — every fix cites a source
5. Optional Rewrite
6. Source Attribution

## Post-gen guards (`enforceModeLock`)

Each mode strips the same banned phrases (`based on the resources`, `in general`, `best practice`, `industry standard`, `as a general rule`, `generally speaking`, `typically`) and runs structural checks. If sections / table / citations are missing, `shouldRegenerate=true` triggers one strict regen.

Synthesis-only extras: equal-weight detector (parses `| 20% |` cells), generic-stage scaffold detector (`Opener/Pitch/Close`, `Discovery/Demo/Close`).

Evaluation-only extra: vague-critique fingerprint (`be more concise`, `stronger CTA`, `improve tone`, `good start`, `with some polish`, `nice work`).

## Why this matters
Without these guards Strategy returns generic frameworks/emails/critiques that any LLM could produce without the user's library — destroying the product's value proposition. The pre-gen short-circuit is the strongest guarantee: when grounding is impossible, we refuse to fabricate.
