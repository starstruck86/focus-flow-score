## Read-only roadmap/spec audit — findings

No code changes proposed. This is discovery only. Bottom line up front: **there is no master roadmap, no six-pillar document, and no Learn-pillar spec anywhere in this repo.** The only committed planning artifacts are pillar-scoped phase checklists and Strategy memory files. Anything called "Master Roadmap v4" or "Dynamic-Roadmap-v2" lives entirely outside this repo (Drive/Notion).

### 1) Every `.md` / `.txt` doc in the repo, with git last-modified date

| Last commit (UTC) | Path | Scope |
|---|---|---|
| 2026-03-23 | `supabase/FUNCTION_GROUPS.md` | Edge-function grouping notes. |
| 2026-03-27 | `README.md` | Product blurb + tech stack + setup. Not a plan. |
| 2026-04-07 | `docs/runbook-stuck-background-jobs.md` | Ops runbook. |
| 2026-04-11 | `docs/phase1-verification-checklist.md` | TRAIN v2 Phase 1 verification checklist. |
| 2026-04-11 | `docs/phase2-verification-checklist.md` | TRAIN v2 Phase 2 verification checklist. |
| 2026-04-11 | `docs/trust-model-and-hardening-summary.md` | Auth/RLS trust model summary (Phases 1–3, B–E). |
| 2026-04-14 | `docs/voice-cost-validation.md` | Voice cost validation notes. |
| 2026-04-19 | `.lovable/memory/features/strategy/trust-gate-doctrine.md` | Strategy pillar — trust gate. |
| 2026-04-20 | `.lovable/memory/features/strategy/synthesis-mode.md` | Strategy pillar — synthesis contract. |
| 2026-04-20 | `.lovable/memory/features/strategy/operator-reasoning-contract.md` | Strategy pillar — reasoning contract. |
| 2026-04-25 | `.lovable/memory/features/strategy/discovery-prep-async-execution.md` | Strategy pillar — async job pattern. |
| 2026-05-05 | `.lovable/memory/features/strategy/phase35b-scorer-hardening.md` | Strategy pillar — scorer gates. |
| 2026-05-05 | `.lovable/memory/features/strategy/phase35c-artifact-gate.md` | Strategy pillar — artifact gate. |
| 2026-05-06 | `docs/phase37-production-evidence-report.md` | Strategy Phase 4 evidence report. |
| 2026-06-25 | `docs/train-deep-linking-teach-beats.md` | TRAIN curriculum content (Deep Linking spoke). |
| 2026-07-01 | `.lovable/plan.md` | Prior read-only audit output (NOT a forward plan). |
| (untracked) | `.workspace/AGENTS.md` | 5 hard build rules + Branch AE context. Rules doc, not a plan. |
| (untracked) | `supabase/functions/_shared/strategy-core/v2/_locked/synthesisStrongContract.lock.md` | Locked strategy synthesis contract. |
| (untracked) | `docs/phase2-function-inventory.json` | Edge-function inventory snapshot. |

Total planning-adjacent files: 19. None is app-wide.

Also confirmed: no `planning/`, `roadmap/`, `specs/`, `prd/`, `vision/`, or `docs/roadmap*` folders exist. Only in-code hits for "roadmap" are `src/components/prep/enrichment/RoadmapPanel.tsx` and `src/lib/systemGapRoadmap.ts` — these are the **Enrichment "Product Roadmap" panel** (system-gap drilldown feature), not a product plan.

### 2) Full `.lovable/` tree

```
.lovable/
├── plan.md                                         (2026-07-01, prior audit output)
└── memory/
    └── features/
        └── strategy/
            ├── discovery-prep-async-execution.md   (2026-04-25)
            ├── operator-reasoning-contract.md      (2026-04-20)
            ├── phase35b-scorer-hardening.md        (2026-05-05)
            ├── phase35c-artifact-gate.md           (2026-05-05)
            ├── synthesis-mode.md                   (2026-04-20)
            └── trust-gate-doctrine.md              (2026-04-19)
```

**Only the Strategy pillar has memory files.** There is no `features/train/`, `features/learn/`, `features/coach/`, `features/operate/`, `features/map/`, `features/intel/`, or `features/loop/`. Every non-Strategy pillar is undocumented in `.lovable/memory/`.

### 3) Master Roadmap v4 / Six-pillar / Learn-pillar hunt

- **Master Roadmap (v4 or any version):** does not exist in the repo. No file's title, headings, or opening lines frame it as an app-wide plan. Zero hits for "Master Roadmap", "Dynamic-Roadmap", "Master Plan", "Roadmap v4" in any `.md`/`.txt`.
- **Six-pillar (or N-pillar) framing:** does not exist in the repo. Zero hits for `pillar` / `six pillar` / `6 pillar` / `six-pillar` in any doc file. The only occurrences of the word "pillar" in docs are inside `.lovable/plan.md` — and those are meta-references from the earlier audit describing that no pillar doc exists ("Strategy pillar — …" as a category label, and the sentence "**No pillar framing is documented in the repo.**"). The pillar vocabulary (TRAIN / OPERATE / MAP / INTEL / LOOP / STRATEGY / COACH / LEARN / SKILLS) exists only in chat memory (`mem://index.md`) and prior audit summaries — not in any committed roadmap file. Nothing to quote verbatim.
- **LEARN pillar plan / education roadmap / courses / lessons / curriculum spec:** does not exist in the repo. No file under `docs/`, `.lovable/`, or elsewhere describes the Learn pillar, `learning_lessons`, courses, or an education-system roadmap. The only Learn-adjacent artifact is source code (`src/pages/Learn.tsx`, `src/pages/LearnLesson.tsx`, `src/hooks/useLearnLoop.ts`, `src/lib/learning/*`, `supabase/functions/grade-lesson-response/`) and the TRAIN Deep-Linking content file (`docs/train-deep-linking-teach-beats.md`) — that last one is TRAIN curriculum content for a single spoke, not a Learn-pillar roadmap.

### 4) Google Drive / external roadmap references in the repo

Zero. No repo file references any external roadmap document. Every `drive.google.com` / `docs.google.com` hit is in the enrichment pipeline (`enrich-resource-content`, resource-link helpers, tests) — generic URL handlers, not roadmap links. No file IDs for "Strategy Rebuild Roadmap v2", "Dynamic-Roadmap-v2", or "Master Roadmap v4" appear anywhere. Nothing to cross-check against Drive from this repo.

### 5) "Learn" and "pillar" in a planning/architecture context

- **"pillar"** in docs: only in `.lovable/plan.md`, and only as prior-audit meta-commentary ("Strategy pillar — …" labels + the explicit statement that no pillar doc exists). No architectural definition anywhere.
- **"Learn"** in docs: appears in `.lovable/plan.md` (again, meta: "No Learn-pillar plan, roadmap, backlog, or spec exists in the repo"), and nowhere else in `docs/` or `.lovable/`. The Learn subsystem is defined entirely in source code — no written architecture doc, no roadmap, no spec.

### What this means for you

Every roadmap you've been working from is external. The repo is not the source of truth for product planning — only for phase-scoped verification checklists (TRAIN Phases 1–2, Strategy Phases 3.5–4) and the Strategy pillar's contracts. If "Dynamic-Roadmap-v2" is Strategy-only and hasn't been touched since June 24, then no newer or broader roadmap exists here either — you'd need to check Drive/Notion for a "Master Roadmap v4" or a Learn-pillar doc, or paste one into `docs/` so future planning work can be grounded.

Want me to (a) draft a `docs/roadmap/` skeleton for you to fill in, (b) reverse-engineer a pillar/Learn architecture doc from the current source code so you have a starting point, or (c) just stop here?