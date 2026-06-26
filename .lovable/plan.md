
# Library Surface — Read-Only Audit

No code changes proposed. Findings only.

## 1) Two distinct "Library" surfaces exist

**A. Bottom-nav "Library" → `/prep` → `src/pages/PrepHub.tsx`**
`BottomNav.tsx:59`: `{ to: '/prep', label: 'Library', icon: Brain, color: 'prep' }`. This is actually **Sales Brain OS** — a 4-tab admin/builder workspace (Control Plane, Prep, Knowledge, Ingest) wrapping `KnowledgeControlPlane`, `PrepCommandCenter`, `KnowledgeWorkspace`, `IngestWorkspace`. It is *not* a KI reader for learners; it is the curation/ingest hub.

**B. "Intelligence Library" → `/ki-library` → `src/pages/KILibrary.tsx`**
Linked from Home (`Home.tsx:62` shows `${librarySize} KIs`). This is the learner-facing KI browser. The rest of the audit answers focus on KILibrary, since that's what users mean by "Library" when talking about reading KIs.

## 2) What the user does on KILibrary

- Search KIs (debounced ilike across `title`, `tactic_summary`, `example_usage`, `why_it_matters`).
- Filter by **spider_dimension** pills (12 pills incl. `__null__` "Leadership", with counts).
- Optional secondary **chapter** sub-filter (from `DIMENSION_CHAPTERS` map at `KILibrary.tsx:84-97`).
- For `branch_io` chapter, a tertiary `intelligence_type` head filter.
- Click a card → expand inline to read `tactic_summary`, `when_to_use`, `why_it_matters`, `example_usage`.
- Write a personal note (📝 My Note) → `ki_annotations` upsert on blur.
- Click **"Drill →"** button → navigates to `/sharpen` (legacy drill loop), not `/train`.

## 3) Tables READ

- `knowledge_items` — main listing + count + dim counts (filtered `user_id` + `active=true`).
- `ki_annotations` — per-user notes map.

No reads of `ki_curriculum`, `curriculum_concepts`, `user_competency`, `user_band_gate`, `ki_mastery`, `dojo_sessions`, `dojo_session_turns`, `daily_assignments`.

## 4) Tables WRITTEN by Library

**Only one write path**, in `AnnotationField.save` (KILibrary.tsx:20-23):
```ts
await (supabase as any).from('ki_annotations').upsert(
  { user_id: userId, ki_id: kiId, note, updated_at: new Date().toISOString() },
  { onConflict: 'user_id,ki_id' }
);
```
**Does NOT write** `ki_mastery`, `user_competency`, `user_band_gate`, `dojo_sessions`, or `dojo_session_turns`. Library itself produces zero practice progress.

## 5) Routing into drill loops

Yes — every KI card has a "Drill →" button. `handleDrill` (KILibrary.tsx:335-345) routes **into the legacy /sharpen loop**, never into `/train/*`:
```ts
if (ki.chapter === 'branch_io') {
  navigate('/sharpen', { state: { branchMode: true, dimension: ki.spider_dimension, specificKIId: ki.id } });
} else {
  navigate('/sharpen', { state: { chapter: ki.chapter, specificKIId: ki.id, dimension: ki.spider_dimension } });
}
```
So Library indirectly *does* feed practice — but exclusively through legacy `/sharpen`, which (per prior audit) writes `ki_mastery` + end-of-set `dojo_sessions` but never `user_competency` / `user_band_gate`. TRAIN v2 ladder progress is not advanced from a Library drill.

## 6) Ingest from Library?

**No.** KILibrary is a read-only consumer (plus annotations). All KI creation/import/edit lives behind `/prep` → Ingest / Knowledge / Control Plane tabs (`PrepHub.tsx:108-139` wrapping `KnowledgeWorkspace` and `IngestWorkspace`).

## 7) Taxonomy

Primary axis is **`spider_dimension`** (12 pills incl. `__null__`). Secondary `chapter` filter is derived from a hardcoded `DIMENSION_CHAPTERS` map. It does **not** use `curriculum_concepts.spoke` or the TRAIN v2 topic taxonomy at all — Library's taxonomy and TRAIN's taxonomy are independent.

## Verdict

KILibrary is a **passive knowledge reference** over `knowledge_items` (read-only except for personal `ki_annotations` notes). It produces zero progress writes itself. It overlaps TRAIN only via the "Drill →" CTA, which currently bridges into the **legacy `/sharpen`** path, not TRAIN v2 — so Library practice is invisible to `user_competency` / `user_band_gate`.
