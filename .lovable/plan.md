# LIBRARY / CONTENT PIPELINE AUDIT (read-only)

Source: `/prep` → `PrepHub.tsx` ("Sales Brain OS"), 4 tabs wired to 4 workspace components.

---

## 1) The 4 tabs (terse)

- **Control Plane** (`KnowledgeControlPlane.tsx`) — Ops view of every resource: health strips, needs-attention queue, bulk action bar, central resource table, inspect drawer. Where you triage failures and re-run extraction.
- **Prep** (`PrepCommandCenter.tsx`) — Deal-prep workspace (stage nav, recommended assets, draft output). Consumes KIs; does not produce them.
- **Knowledge** (`KnowledgeWorkspace.tsx`) — KI-quality surface: coverage audit, duplicate/cluster review, low-yield + re-extraction + trust + verification queues, provenance.
- **Ingest** (`IngestWorkspace.tsx`) — Add new material: Signal Inbox, KnowledgeOps dashboard, EnrichmentEngine, SourceRegistry, IncomingQueue, AudioTestHarness.

---

## 2) Ingest path

User can: paste URL, upload file, paste transcript, queue a podcast, import a course, scrape a webpage's links, import a YouTube playlist, paste a Claude export, screenshot upload.

Edge functions invoked across the pipeline (one-liners):

- `parse-uploaded-file` — turns uploaded file (pdf/docx/audio) into resource content; calls `pdf-ocr`, `transcribe-audio`, `preprocess-transcript` as needed.
- `pdf-ocr` — OCR fallback for non-selectable PDFs.
- `transcribe-audio` / `elevenlabs-transcribe` / `elevenlabs-stt` — audio → text.
- `import-podcast`, `resolve-podcast-episode`, `process-podcast-queue` — RSS/episode import with stale-lock watchdog (`claim_podcast_queue_items`).
- `import-course`, `import-course-capture` — Thinkific/Kajabi course pull → `course_lesson_imports` → `course_lessons`.
- `import-webpage-links`, `import-youtube-playlist`, `import-circle-browserless` — bulk URL ingestion.
- `parse-claude-import`, `parse-screenshot`, `parse-account-screenshot`, `parse-calendar-screenshot` — content-paste / OCR ingestion.
- `discover-resources` — autonomous web discovery (Firecrawl/Perplexity).
- `classify-resource` — assigns `resource_type`, tags, chapter hints.
- `enrich-resource-content` (**3,461 LOC**) — fetches full content, normalizes, writes `enrichment_attempts`.
- `run-enrichment-job` — orchestrator wrapper.
- `validate-enrichment` (536 LOC) — quality/completeness gating before extraction.
- `build-resource` — finalizes resource record post-enrichment.
- `batch-extract-kis` (**2,194 LOC**) — the KI factory (see §3).
- `operationalize-resource` — post-KI: links to playbooks/stage_resources.
- `derive-library-cards` — turns resource into `library_cards` summary tiles.
- `reconcile-library` — sync metadata + phase counts.
- `detect-knowledge-gaps` — finds spider dimensions/chapters under-covered.
- `extract-tactics`, `extract-scenarios` — secondary derivation passes.
- `suggest-resource-uses`, `suggest-templates` — downstream recommendations.

---

## 3) Extraction → KI (deep)

**Automatic.** Trigger path: resource lands enriched → `batch-extract-kis` (run from Control Plane manual button, post-enrich orchestrator, or scheduled batch). One LLM call per resource (per attempt).

**Model:** `google/gemini-2.5-flash` via Lovable AI Gateway, `temperature 0.2`, `max_tokens 16384` (`batch-extract-kis/index.ts:645`).

**Attempt ladder** (`ExtractionStrategy`, lines 292-311): `standard` → `rechunk` → `structured_prompt` → `summary_first`. Lessons take a 2-stage `enumerate → expand` path. Each attempt writes a row to `extraction_runs` (line 1299) with `attempt_number`, `strategy`, `ki_count`, `raw_item_count`, `validated_count`, `deduped_count`, `min_ki_floor`, `floor_met`, `failure_type`, `confidence_score` (computed from yield vs. floor).

**`extraction_runs` vs `enrichment_attempts`:** different stages of the same pipeline.
- `enrichment_attempts` (54 rows) — provenance for **content fetch/normalization** step, written by `enrich-resource-content:2558`.
- `extraction_runs` (1,843 rows) — provenance for **KI generation** step, written by `batch-extract-kis:1299`. ~7× the volume because retries cascade through 4 strategies.

**Core extraction prompt** (`batch-extract-kis/index.ts:480-502`, verbatim):

```
You are an elite sales execution coach. Extract TACTICAL PLAYS from content.

A Knowledge Item is a PLAY — a structured, situational, reusable tactical entry
that tells a rep exactly when, why, and how to execute.

EVERY knowledge item MUST include ALL of these fields:
1. "title" — action title …
2. "framework" — methodology. REQUIRED.
3. "who" — thought leader or author. REQUIRED.
4. "source_excerpt" — EXACT quote from content. Min 2 sentences. REQUIRED.
5. "source_location" …
6-14. macro_situation / micro_strategy / why_it_matters / how_to_execute /
       what_this_unlocks / when_to_use / when_not_to_use / example_usage / tactic_summary
15. "chapter" — one of: cold_calling|discovery|objection_handling|negotiation|
    competitors|personas|messaging|closing|stakeholder_navigation|expansion|demo|follow_up
16. "knowledge_type" — skill|product|competitive

Return ONLY a JSON array. Quality over quantity, but do not under-extract.
```

Three other prompt variants: `LESSON_ENUMERATE_SYSTEM`, `STRUCTURED_PROMPT_ADDENDUM`, `SUMMARY_EXTRACTION_SYSTEM` (lines 511-540).

---

## 4) KI quality / curriculum-readiness (deep)

**Fields populated at insert** (`batch-extract-kis:2059-2089`, verbatim):

```js
const rows = deduped.map((item) => ({
  user_id, source_resource_id, source_title,
  title, knowledge_type, chapter, sub_chapter,
  tactic_summary, why_it_matters, when_to_use, when_not_to_use,
  example_usage, macro_situation, micro_strategy,
  how_to_execute, what_this_unlocks,
  source_excerpt, source_location, framework, who,
  confidence_score: 0.75,        // ← HARD-CODED, not model-derived
  status: 'active', active: true, user_edited: false,
  applies_to_contexts: item.applies_to_contexts || ['all'],
  tags: item.tags || [],
  challenger_type: item._challenger_type || 'teach',
}));
```

**Auto-classification status:**
- `chapter` — **yes**, model-emitted, defaulted to `'messaging'` if missing/invalid (line 953, 971). 12 chapters whitelisted.
- `knowledge_type` — yes, model-emitted (`skill|product|competitive`).
- `framework`, `who`, `tags`, `challenger_type` — model-emitted.
- `confidence_score` — **NO, hard-coded 0.75 for every KI.** The "confidence" your downstream code uses (`get_next_ki_for_dimension` gates on it) is effectively a constant. The real confidence signal lives one level up on `extraction_runs.confidence_score` and never propagates down.
- `spider_dimension` — **NOT set by the extractor.** Sample: 11,162 / 34,876 KIs (32%) have NULL `spider_dimension`. There's no classifier writing it on insert — it must be backfilled by a separate path (likely `reconcile-library` / manual SQL / `detect-knowledge-gaps`).
- `is_core_ae` — **NOT set by the extractor.** 32,260 / 34,876 (92.5%) carry `is_core_ae = true` but only because some backfill flipped them; the extractor itself never writes it.

**Validation gates inside `batch-extract-kis`:**
- Field-substance checks (`when_to_use lacks substance`, etc., line 1051), descriptive-title pattern, MIN_KI_FLOOR per resource, dedup pass, `validateAuditSummary` invariant.
- On floor miss → escalate strategy + re-attempt; best attempt selected by `confidence_score` (lines 385-449).

**External quality gates — mostly empty:**

| Table | Rows | Status |
|---|---|---|
| `canary_reviews` | 1 | unused |
| `verification_runs` | 0 | unused |
| `cluster_resolutions` | 0 | unused |
| `library_reconciliation_runs` | 6 | barely used |
| `asset_provenance` | 5,028 | active (KI→source linking) |
| `extraction_runs` | 1,843 | active |
| `enrichment_attempts` | 54 | sparse (most resources never recorded attempts) |

UI surfaces exist for all of these (`TrustReviewQueue`, `VerificationQueue`, `ClusterReviewPanel`, `DuplicateReviewQueue`, `LowYieldReviewQueue`, `CanaryReviews`) but **the underlying review/cluster/verification pipelines are not running** — they're scaffolded, not wired.

**Output quality verdict:** structurally rich (15+ fields), prompt is sound, but:
1. Every KI is stamped `confidence_score = 0.75` → downstream confidence-based selection is noise.
2. 32% of the catalog has no `spider_dimension` → the TRAIN ladder can't reach them via `get_next_ki_for_dimension`.
3. Dedup/cluster review is theatre; nothing is actually clustering.
4. No Branch-specific bias in the prompt (chapters are generic sales taxonomy).

---

## 5) KI → curriculum bridge (terse)

**No automated bridge.** `knowledge_items` is the raw catalog. The TRAIN drills live in `curriculum_concepts` + `ki_curriculum` (joined via the view `ki_curriculum_full`, queried by `src/lib/train/curriculum.ts`). Nothing in `supabase/functions/` writes to `curriculum_concepts` or `ki_curriculum`. Population is the manual SQL workflow you've been running ("BATCH 1 & 2: 10 Product topics … inserted ~816 drills"). No code links a freshly-extracted KI into the curriculum automatically.

---

## 6) End-to-end & dead pieces (terse)

**Works end-to-end:** Ingest → enrich → extract → KI catalog → Library/Knowledge surfaces. The pipeline produces KIs at scale (34.8K). `asset_provenance` is healthy. Retries and strategy escalation work.

**Broken / scaffolded:**
- `resource_chunks` (0), `resource_jobs` (0), `resource_collections` (0) — built but never written.
- `verification_runs` (0), `cluster_resolutions` (0), `canary_reviews` (1) — quality-gate UIs exist, backends don't run.
- `confidence_score` hard-coded 0.75 — defeats the purpose of having the column.
- KI → curriculum is a manual bridge; the "factory" stops at `knowledge_items`.

**Legacy content check (Rule 3):** clean. `grep` for acoustic|martech|lifecycle|marketo|cdp across `batch-extract-kis`, `enrich-resource-content`, `classify-resource`, `operationalize-resource`, `build-resource` returned **zero hits**. Extraction prompts are generic-sales, not Acoustic-era. (Branch-specific bias is also absent — that's a gap to consider, not contamination.)

---

## Top findings

1. **Hard-coded `confidence_score: 0.75`** on every KI insert silently neutralizes confidence-gated selection in `get_next_ki_for_dimension` and elsewhere.
2. **No `spider_dimension` classifier** in the extractor → 32% of catalog is unreachable by dimension-targeted queries.
3. **Quality-gate surfaces are theatre** — verification/cluster/canary tables empty, UI implies otherwise.
4. **KI → curriculum is manual** — no automated promotion from `knowledge_items` to `ki_curriculum`, which means new ingest never reaches TRAIN without you running SQL.
5. **Extraction prompt is generic** — no Branch vocabulary injection (deep linking, MMP, Universal Ads, etc.), so the KIs the model produces from Branch source material aren't tagged with Branch-native framing.

No code changes proposed — this is the audit deliverable per request.
