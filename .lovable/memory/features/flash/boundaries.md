---
name: Flash boundaries
description: Flash is the recognition/awareness layer — strict write boundaries against the drill/competency stack
type: constraint
---
PURPOSE: Flash tests UNDERSTANDING (what / why / when) so drills can test execution. Generator emits `definition` (what/why) and `trigger` (when/applicability) cards only; no talk-track recital cards — model-line rehearsal belongs to TrainAtom/Car Mode, reached via the Drill-this CTA.

Flash = the recognition/awareness layer on `ki_mastery`, written ONLY via `src/lib/flash/rollupRecognition.ts` (updates `recognition_score`, `awareness_score`, `updated_at`).

Flash MUST NEVER write:
- `user_competency` (curriculum ladder — TRAIN v2 only, via `recordCompetencyRep`)
- `ki_mastery.next_review_at`, `decay_risk`, `times_drilled`, `avg_score`, `best_score`, `execution_score` (drill stats — belong to `src/lib/dojo/kiMasteryWriter.ts` only)

Card scheduling lives exclusively in `flashcard_state.due_at`, driven by `src/lib/flash/cbr.ts` intervals ({1:+10m, 2:+1d, 3:+3d, 4:+7d, 5:+21d}).

Escalation from recognition to execution practice happens ONLY via the "Drill this →" CTA on a low-confidence, repeat-seen card (routes to `/train/:spoke/:topic/atom/:conceptId`). Flash never advances the ladder itself.
