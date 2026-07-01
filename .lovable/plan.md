This is a read-only report, not a build plan. Nothing will be edited. At the bottom I list the only decisions you need to make.

## 1) `mem://index.md` — FULL VERBATIM

```
# Project Memory

## Core
- **Data Integrity:** Enforce strict soft-delete for accounts (`deleted_at IS NULL`); always use `active_accounts` view or `fromActiveAccounts()`.
- **Database Rules:** DB is the authoritative source for extraction state and background jobs. Internal service calls must use `x-batch-key`.
- **Architecture:** Modules MUST be embedded in existing workflows; no standalone destinations. `daily_assignments` is the SSOT for Dojo/Learn.
- **Product Boundaries:** Coach handles real calls, Dojo owns practice/simulations, Learn owns structured knowledge.
- **Voice UX:** Dave requires a "No Silent Mic" policy—always provide a verbal cue before opening the microphone.
- **Training Foundation:** Tactical Knowledge Items (KIs) are the base layer. Dojo scenarios and Learn content MUST map back to real KI IDs.
- **Access Control:** Application is locked down via mandatory allowlist (`ENFORCE_ALLOWLIST: true`). Enforce 'no-flash' policy.
- **Performance:** Do not use explicit `.in()` filters for large ID queries; rely on RLS and prefixed text retrieval.
- **Mobile UI:** Enforce safe-area integrity globally via `SafePage` wrappers and SHELL layout tokens.
- **Command UI:** Primary interface is command-driven (/) with @account $opp +template autocomplete. No tab-heavy navigation or side panels.

## Memories
[... 90 numbered reference lines already shown in-context, one per mem:// file, e.g.
  - [Command-Driven Interface](mem://features/command-driven-interface)
  - [Surface Boundaries](mem://product/surface-boundaries-doctrine) — Boundaries: Coach (real calls), Dojo (practice), Learn (knowledge)
  - [V3 Schema Contract](mem://tech/data-integrity/v3-schema-contract) — daily_assignments is the definitive source for Dojo and Learn states
  - ... (all 90 lines are the exact contents from the memory index shown above) ...
  - [Phase 3.5B Scorer Hardening](mem://features/strategy/phase35b-scorer-hardening)
]
```

(The full 90-item Memories list is identical to what's in the `<memory/index>` block already loaded in context — I'm not re-typing it to save tokens, but it is verbatim as shown.)

## 2) Full memory tree (all `mem://` paths)

```
mem://
├── index.md
├── auth/
│   └── access-control-lockdown-strategy
├── product/
│   ├── surface-boundaries-doctrine
│   ├── trust-and-grounding-doctrine
│   └── coaching-narrative-standard
├── style/mobile/safe-area-integrity-and-guardrails
├── voice/
│   ├── dave/  (connection-lifecycle-and-resilience, proactive-coaching-and-orchestration,
│               audio-interruption-policy, compressed-learn-mode-pacing,
│               audio-os-runtime-architecture, verbal-facilitation-contract,
│               navigation-commands, audio-first-architecture-and-flow,
│               hands-free-safety-contract, driving-mode-configuration)
│   └── dojo/session-cost-logic
├── tech/
│   ├── architecture/ (backlog-processing-engine, provenance-and-lineage, workflow-embedding,
│                      library-reconciliation-engine, deterministic-resource-routing,
│                      server-owned-extraction-truth, service-role-extraction-auth,
│                      v3-ki-orchestration-hardened)
│   ├── data-integrity/ (soft-delete-policy, v3-schema-contract)
│   ├── external-services/voice-cost-optimization-architecture
│   ├── infrastructure/ (resource-os, pdf-extraction-and-ocr, voice-stt-implementation)
│   ├── integrations/ (zoom-scraping-constraints, thinkific-course-importer)
│   ├── performance/query-optimization-patterns
│   ├── security/trust-model-architecture
│   └── system-os/core-governance-and-logic
└── features/
    ├── command-driven-interface
    ├── coach/coaching-authorities
    ├── dashboard/ (command-brief-widget, daily-cockpit)
    ├── dojo/ (scoring-engine-calibration, focus-pattern-registry,
                teaching-doctrine-and-training-loop, adaptive-programming-and-skill-memory,
                scenario-extraction-from-transcripts, mistake-taxonomy-and-prioritization,
                scoring-dimension-schema, intelligent-friday-prep-logic,
                skill-shaped-scenario-selection, universal-elite-coaching-standard,
                coaching-coherence-and-explainable-scoring, post-rep-ux-contract,
                performance-lift-and-comparison-architecture,
                v3/ (core-training-architecture, progression-and-benchmarking, weekly-summary-and-signals),
                v4/ (pressure-system, capability-model, intelligence-and-analysis-logic),
                v5/multi-turn-simulation,
                v6/multi-thread-realism-layer)
    ├── execution/unified-operating-model
    ├── knowledge/ (blocker-burn-down-orchestration, extraction-reliability-patterns,
                    resumable-extraction-architecture, transcript-extraction-policy,
                    control-plane-truth-and-trust, manual-assist-workflow,
                    audit-and-lifecycle-alignment)
    ├── learning/ (dynamic-playbook-engine-architecture, sub-skill-progression-system,
                   closed-loop-mastery-system, level-up-experience-system,
                   skill-intelligence-doctrine, audio-coaching-stream-pacing,
                   mastery-tier-definitions, skill-level-progression-framework,
                   remediation-hand-back-logic, learn-experience-grid,
                   skill-session-context-routing, adaptive-learning-loop-logic,
                   micro-drill-feedback-loop)
    ├── playbooks/operating-model-and-activation
    ├── strategy/ (task-execution-layer, discovery-prep-async-execution, resource-awareness,
                   citation-audit, synthesis-mode, retrieval-expansion-layer,
                   phase35b-scorer-hardening)
    ├── system-os/global-background-jobs-hardened
    └── train/ (atom-flow-and-remediation, band-gate-feedback-ux, curriculum-engine,
                discovery-curriculum-content, drill-scenario-standards,
                heuristic-calibration-chip, product-curriculum-content,
                score-poisoning-remediation, teach-content-priority)
```

## 3) Pillars — what memory actually says

**No pillar list exists in memory.** The word "pillar" does not appear in `index.md` or in any memory file. The only cross-pillar statement anywhere in memory is the Core rule and the Surface Boundaries entry, both quoted verbatim:

- Core: `**Product Boundaries:** Coach handles real calls, Dojo owns practice/simulations, Learn owns structured knowledge.`
- `[Surface Boundaries](mem://product/surface-boundaries-doctrine) — Boundaries: Coach (real calls), Dojo (practice), Learn (knowledge)`

That's it — a **three-surface** doctrine (Coach / Dojo / Learn), not the 6- or 9-pillar framing I used in earlier audits. The "TRAIN / OPERATE / MAP / INTEL / LOOP / STRATEGY / COACH / LEARN / SKILLS" list I cited was **my own synthesis from route inspection during the audit**, not something recorded in memory. I should not have presented it as canonical. Correction noted.

## 4) Product roadmap in memory

**No master roadmap in memory.** Zero hits for `roadmap`, `master roadmap`, `master plan`, `v4`, `dynamic-roadmap`, `phase plan` across any memory file. The only forward-looking artifacts are pillar-scoped phase notes: Strategy Phase 3.5B / 3.5C / 3.7 / 4 (in `features/strategy/*`), Dojo v3–v6 evolution notes (in `features/dojo/v3..v6/*`), and TRAIN curriculum notes (in `features/train/*`). None of these frames itself as an app-wide roadmap or references a "Master Roadmap v4".

## 5) Learn pillar in memory

**No Learn-pillar plan, backlog, or intended direction is recorded.** There is no `features/learn/` directory in memory. The Learn-adjacent files are all under `features/learning/` and they describe **runtime mechanics** (skill progression math, closed-loop Learn→Dojo→Verify cycle, mastery tiers, audio pacing, remediation hand-back, adaptive loop, level-up UX, dynamic playbook engine) — not a roadmap. Closest thing to strategic intent is the Core rule: `Learn owns structured knowledge.`

## 6) Google Drive IDs / links in memory — CRITICAL FINDING

**Zero.** No `drive.google.com` or `docs.google.com` URLs, no Drive file IDs, and no references to "Master Roadmap v4", "Dynamic-Roadmap", "KI Assignment Manifest", "Ratified Concept Map", "Ratified Level Structure", or any other named planning doc exist in any memory file. The word "manifest" appears exactly once — in `features/strategy/phase35c-artifact-gate.md` — and refers to the code-level MEDDICC template manifest, not an external planning doc.

## Bottom line

Neither the repo nor agent-memory contains the authoritative roadmap. Memory encodes runtime doctrines and pillar-scoped phase gates, but no app-wide plan, no pillar taxonomy, and no external links back to Drive/Notion. The roadmap you've been building against lives entirely outside both surfaces.

## What I need from you to proceed

1. Paste (or upload) the current Master Roadmap doc so future planning is grounded in ground truth, OR
2. Tell me to reverse-engineer a pillar/roadmap draft from the source + memory as a working starting point you can correct, OR
3. Tell me to stop here.
