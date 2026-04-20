---
name: Strategy Library-Grounded Modes (Synthesis / Creation / Evaluation) + Application Layer
description: Three resource-grounded intents in strategy-chat — synthesis derives systems, creation builds assets, evaluation grades content. Each has dual-signal triggers, pre-gen short-circuit on insufficient hits, mandatory output contracts, mandatory Application Appendix (Situation/Audience/Industry), and post-gen structural guards.
type: feature
---

# Strategy Library-Grounded Modes + Application Layer

All three modes live in `supabase/functions/strategy-chat/index.ts` and share the same architecture: dual-signal intent classifier → forced `useCore=true` → pre-gen short-circuit on thin signal → mode-locked system prompt → **Application Layer appendix** → post-gen structural guard with one-shot regen.

## Triggers (dual signal required)

Shared **grounding regex** (`SYNTH_GROUNDING_RE`): `(using|use|based on|from|leveraging|...) (my|the|these|those|our) [...up to 4 qualifier words...] (resource|library|playbook|kis|materials|transcripts|...)`

| Intent | Second signal | Min resources |
|---|---|---|
| `synthesis` | derivation verb (`come up with`, `derive`, `build/create framework/rubric/scoring/model`) OR noun hint (`scoring system`, `rubric`, `framework`, `weighting`) | 2 |
| `creation` | `CREATE_VERB_RE` (`write`, `draft`, `create`, …) AND `CREATE_NOUN_RE` (`email`, `script`, `talk track`, `one-pager`, `business case`, …) | 1 |
| `evaluation` | `EVAL_VERB_RE` (`grade`, `score`, `evaluate`, `critique`, `review`, `coach me on`, `audit`, `red-team`, `tear down`, `improve`, `tighten`, `rewrite this/it/my`) | 2 |

All three force `useCore=true` so resource retrieval always runs.

## Pre-gen short-circuit
If `groundedIntent && resourceHits.length < minHits`, the LLM is **never called**. Persisted with `provider_used=<intent>-guard` and `library_short_circuit` metadata.

## Output contracts

### Synthesis (5 sections + Application)
1. Pattern Extraction (3-6 patterns, 2+ source citations each)
2. Dimensions table `| # | Dimension | Definition | Weight | Derived From |`
3. Weighting Rationale
4. Example Scoring (visible math)
5. Source Attribution
6. **Application appendix** (mandatory)

Hard rules: weights unequal, sum to 100%, every row cites KI[id] / PLAYBOOK[id] / "Title".

### Creation (4 sections + Application)
1. Source Basis
2. Reused vs Created
3. The Asset
4. Gaps / Missing Anchors
5. **Application appendix** (mandatory)

### Evaluation (6 sections + Application)
1. Overall Score (`Overall: N/10 — verdict`)
2. Dimension Breakdown table `| Dimension | Score | What Worked | What Failed | Source |`
3. Key Gaps (cites violated source pattern)
4. Improvements (Grounded) — every fix cites a source
5. Optional Rewrite
6. Source Attribution
7. **Application appendix** (mandatory)

## Application Layer (mandatory after every grounded mode)

Injected as `applicationLayer` block in `buildModeLockBlock` and appended to all three mode-lock prompts. Tells the model:

1. **Detect context** — Situation (cold call/discovery/renewal/exec/etc), Audience (CFO/VP Sales/Champion/Procurement/Technical/Founder/Board), Industry (SaaS/Healthcare/Manufacturing/FinServ/Retail).
2. **Adapt the primary output** to that audience/situation/industry. Audience adaptation is highest priority — CFO wants ROI/payback/risk; VP Sales wants pipeline/conversion; Champion wants forwardable proof points; etc.
3. **Append exact appendix** with header `**Application**` and three labeled lines (`Situation:`, `Audience:`, `Industry:`) plus 2–4 concrete bullets explaining HOW the output was adapted (not vague claims like "tailored for a CFO").

If audience cannot be inferred, the model is instructed to ask a single short clarifying question instead of guessing.

## Post-gen guards (`enforceModeLock`)

Each mode strips banned phrases (`based on the resources`, `in general`, `best practice`, `industry standard`, `as a general rule`, `generally speaking`, `typically`) and runs structural checks. Missing sections / table / citations → `shouldRegenerate=true` (one strict regen).

**New: `hasApplicationAppendix(text)` helper** scans the last ~1800 chars for `Application` header AND `Situation:` AND `Audience:` AND `Industry:`. Missing → violation tag (`<intent>_missing_application_appendix`) + regen.

Mode-specific extras:
- Synthesis: equal-weight detector, generic-stage scaffold detector (Opener/Pitch/Close, Discovery/Demo/Close).
- Evaluation: vague-critique fingerprint (`be more concise`, `stronger CTA`, `improve tone`, `good start`, `with some polish`, `nice work`).

## Why the Application Layer matters
A correct framework / asset / critique that uses generic language fails when the user has to mentally translate it for a specific buyer. The appendix forces the model to commit to (and justify) audience/situation/industry choices, and the guard ensures that commitment is visible — not assumed.
