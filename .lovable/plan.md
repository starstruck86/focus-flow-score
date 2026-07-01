## Read-only roadmap audit — findings

No code changes proposed. This is the full inventory.

### 1) Search coverage
Ran filename + content searches across the whole repo (excluding `node_modules`, `.git`, `dist`) for: `roadmap`, `Roadmap`, `Master Roadmap`, `pillar` / `six-pillar` / `6-pillar`, `Dynamic-Roadmap`, `product plan`, `backlog`, `Learn pillar`. Also enumerated every `.md` / `.txt` / `.doc*` file and dumped the full `.lovable/` and `docs/` trees.

Note: git history is not available in this sandbox (`git log` unavailable), so per-file "last commit date" cannot be reported — filesystem mtimes are all identical (`Jul 1 15:00`, the sandbox checkout time) and are not meaningful.

### 2) All markdown / doc files in the repo

| Path | Bytes | Scope (1–2 sentences) |
|---|---|---|
| `README.md` | 2,971 | Product blurb + tech stack + setup. No roadmap. |
| `.workspace/AGENTS.md` | 2,325 | "5 Hard Build Rules" + Branch AE context. Operating rules, not a roadmap. |
| `.lovable/plan.md` | 5,225 | Read-only **audit findings** from an earlier UX sweep (Skills/Progress/Settings/etc). Not a roadmap. |
| `.lovable/memory/features/strategy/discovery-prep-async-execution.md` | 2,606 | Strategy pillar — async job pattern. |
| `.lovable/memory/features/strategy/operator-reasoning-contract.md` | 4,035 | Strategy pillar — reasoning contract. |
| `.lovable/memory/features/strategy/phase35b-scorer-hardening.md` | 1,435 | Strategy pillar — scorer gates. |
| `.lovable/memory/features/strategy/phase35c-artifact-gate.md` | 3,555 | Strategy pillar — artifact gate. |
| `.lovable/memory/features/strategy/synthesis-mode.md` | 4,901 | Strategy pillar — synthesis mode contract. |
| `.lovable/memory/features/strategy/trust-gate-doctrine.md` | 2,385 | Strategy pillar — trust gate doctrine. |
| `docs/phase1-verification-checklist.md` | 2,094 | TRAIN v2 Phase 1 verification checklist. |
| `docs/phase2-verification-checklist.md` | 1,085 | TRAIN v2 Phase 2 verification checklist. |
| `docs/phase2-function-inventory.json` | 17,059 | Edge-function inventory snapshot. |
| `docs/phase37-production-evidence-report.md` | 9,516 | Strategy Phase 4 production evidence report. |
| `docs/runbook-stuck-background-jobs.md` | 1,928 | Ops runbook. |
| `docs/train-deep-linking-teach-beats.md` | 22,394 | TRAIN — Deep Linking spoke, Stage B teach beats (curriculum content, not a roadmap). |
| `docs/trust-model-and-hardening-summary.md` | 10,083 | Auth/RLS trust model summary (Phases 1–3, B–E). |
| `docs/voice-cost-validation.md` | 5,906 | Voice cost validation notes. |
| `supabase/FUNCTION_GROUPS.md` | 1,831 | Edge function grouping. |
| `supabase/functions/_shared/strategy-core/v2/_locked/synthesisStrongContract.lock.md` | 3,210 | Locked contract for strategy synthesis. |

The only in-code hits for "roadmap" are `src/components/prep/enrichment/RoadmapPanel.tsx` and `src/lib/systemGapRoadmap.ts` — these are the **Enrichment "Product Roadmap" panel** (system-gap drilldown feature inside `/prep`), not a product plan.

### 3) `.lovable/` tree (full)

```
.lovable/
├── plan.md
└── memory/
    └── features/
        └── strategy/
            ├── discovery-prep-async-execution.md
            ├── operator-reasoning-contract.md
            ├── phase35b-scorer-hardening.md
            ├── phase35c-artifact-gate.md
            ├── synthesis-mode.md
            └── trust-gate-doctrine.md
```
Only the Strategy pillar has memory files. No `features/train/`, `features/learn/`, `features/coach/`, `features/operate/`, etc.

### 4) Canonical / master product roadmap

**None exists in the repo.** No file titled or containing "Master Roadmap", "Dynamic-Roadmap", "Product Roadmap", "Master Plan", or equivalent. The closest artifacts are:
- `.workspace/AGENTS.md` — build rules + context, not a plan.
- `.lovable/plan.md` — a past **audit output**, not a forward plan.
- `docs/phase*` files — pillar/phase-specific checklists (TRAIN Phase 1/2, Strategy Phase 3.7/4), each scoped to one workstream.

How I can tell: (a) no file's title, headings, or opening lines frame it as an app-wide plan; (b) the only cross-cutting doc (`AGENTS.md`) is explicitly a rules doc; (c) no doc enumerates pillars or cross-pillar sequencing; (d) no doc references a "Master Roadmap v4" or "Dynamic-Roadmap-v2".

### 5) Six-pillar (or N-pillar) framing

**No pillar framing is documented in the repo.** Zero hits for `pillar` / `six pillar` / `6 pillar` / `N-pillar` in any `.md`/`.txt` file. The pillar language used in prior audits (TRAIN / OPERATE / MAP / INTEL / LOOP / STRATEGY / COACH / LEARN / SKILLS) exists only in this chat's audit summaries and in the persisted memory index — **not** in any committed roadmap file.

### 6) LEARN pillar plan

**No Learn-pillar plan, roadmap, backlog, or spec exists in the repo.** No file under `docs/`, `.lovable/`, or elsewhere mentions "Learn pillar" or documents the courses/lessons/quizzes system as a roadmap. The only Learn-adjacent content is source code (`src/pages/Learn.tsx`, `LearnLesson.tsx`, `src/hooks/useLearnLoop.ts`, `src/lib/learning/*`). Nothing to paste verbatim — it genuinely does not exist as a written plan.

### 7) External roadmap references

**No repo file references any external roadmap Google Drive doc.** All `drive.google.com` / `docs.google.com` hits are in the enrichment pipeline (`enrich-resource-content/index.ts`, tests, resource-link helpers) — generic URL handlers, not roadmap links. There is no mention of "Strategy Rebuild Roadmap v2", "Master Roadmap v4", or any Drive file ID that maps to a roadmap.

### Bottom line

The canonical product roadmap is **not stored in this repo**. If it exists, it lives entirely outside the codebase (Google Drive / Notion / elsewhere). You'll need to bring it in — paste it, drop a copy into `docs/`, or share the Drive link — before any planning work can be grounded in it.
