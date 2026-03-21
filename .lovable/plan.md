

# Deep Resource Enrichment + Remaining 11 Features

This plan consolidates the new deep enrichment requirements with the 11 previously identified unbuilt features into a single execution pass.

---

## Part A: Deep Resource Enrichment (New)

### A1. Database Migration
Add `enriched_at` and `content_length` columns to the `resources` table, backfill existing enriched rows.

```sql
ALTER TABLE resources ADD COLUMN enriched_at timestamptz;
ALTER TABLE resources ADD COLUMN content_length integer;
UPDATE resources SET enriched_at = updated_at, content_length = length(coalesce(content, ''))
  WHERE content_status = 'enriched';
```

### A2. Edge Function: Deeper Scraping
Modify `enrich-resource-content/index.ts`:
- Raise `CONTENT_CAP` from 15,000 to 60,000 characters
- YouTube URLs: increase `waitFor` to 8000ms for transcript loading
- Store `enriched_at = now()` and `content_length` on every successful enrichment
- Accept `force: true` param to re-enrich already-enriched resources
- Accept `resource_ids: string[]` for batch-by-IDs mode (re-enrich specific selected resources regardless of status)
- Single mode: allow re-enrichment when `force: true` (currently only works on placeholders)

### A3. Resource List UI: Enrichment Metadata + Selection
Modify `ResourceManager.tsx`:
- Below each external resource's date line, show enrichment info: "Enriched 3d ago - 14.2K chars" or shallow warning for < 5K chars
- "Enrich Content" / "Re-enrich" dropdown item available for ALL external resources (not just `placeholder` status)
- Add checkbox selection mode with `selectedResourceIds` state (Set)
- Checkbox visible on hover or when any resource is selected
- Floating bulk action bar at bottom when selection active: "N selected" + "Re-enrich Selected" + "Clear"
- Re-enrich calls edge function with `{ resource_ids: [...], force: true }`

### A4. Intelligence Dashboard: Shallow/Stale Stats
Modify `ResourceIntelligenceDashboard.tsx`:
- Query now includes `enriched_at` and `content_length` from resources
- Add "Shallow Content" stat (enriched resources with content_length < 5000)
- Add "Stale" stat (enriched_at > 30 days ago)
- "Re-enrich Shallow" button targeting resources with content_length < 5000

---

## Part B: Remaining 11 Features

### B1. Wake Word Wiring
- `Layout.tsx`: Import and wire `useWakeWord({ onWake: handleOpenDave, enabled })` 
- `Settings.tsx`: Add "Hey Dave" toggle, localStorage-persisted, hidden on unsupported browsers

### B2. Scorecard Q&A UI
- `Coach.tsx`: Add "Ask about this" button on each ScoreBlock
- Opens inline dialog, calls `explain-score` edge function with grade data + transcript excerpt
- Renders markdown response

### B3. Post-Call Task Creation
- `Coach.tsx`: After grading, if `missed_opportunities.length > 0`, show "Create Follow-up Tasks" prompt with pre-filled suggestions linked to account/opportunity

### B4. Scorecard-Resource Cross-Reference
- `Coach.tsx`: For weak categories (score < 3/5), query `resource_digests` matching use_cases
- Surface "Study Material" links on scorecard

### B5. grade-transcript Resource Metadata
- `grade-transcript/index.ts`: Return `resource_id` and title alongside custom grading criteria so client can link back

### B6. Digest Viewer in ResourceEditor
- `ResourceEditor.tsx`: Add collapsible "Intelligence" section showing takeaways, use_cases, grading_criteria from the resource's digest, plus "Re-operationalize" button

### B7. Pre-Call Resource Recommendations
- `PreCallCoach.tsx`: Query `resource_digests` matching call context, surface 1-3 recommended resources with key takeaways

### B8. Content Builder Transcript Intelligence
- `ContentBuilder.tsx`: When account selected, fetch recent `transcript_grades`, surface pain points/objections as clickable chips that inject into generation prompt

### B9. WHOOP Sync Reliability
- `whoop-sync/index.ts`: Return `{ needsReconnect: true }` with 200 on token refresh failure instead of 500
- `WhoopIntegration.tsx`: Detect `needsReconnect`, show reconnect button, auto-sync when stale

### B10. Dave Action Toasts
- `clientTools.ts`: After each DB-writing tool success, emit `toast.success()` with action description

### B11. Dave Activity Log
- `clientTools.ts`: Append action summaries to `localStorage` key `dave-activity-${today}`

---

## Execution Order

| Step | Items | Files |
|------|-------|-------|
| 1 | DB migration (A1) | migration SQL |
| 2 | Deep enrichment edge function (A2) | `enrich-resource-content/index.ts` |
| 3 | Resource list UI + bulk selection (A3) | `ResourceManager.tsx` |
| 4 | Intelligence dashboard shallow/stale stats (A4) | `ResourceIntelligenceDashboard.tsx` |
| 5 | Scorecard Q&A + post-call tasks + cross-ref (B2-B4) | `Coach.tsx` |
| 6 | Digest viewer (B6) | `ResourceEditor.tsx` |
| 7 | grade-transcript metadata (B5) | `grade-transcript/index.ts` |
| 8 | Pre-call recommendations (B7) | `PreCallCoach.tsx` |
| 9 | Content Builder intel (B8) | `ContentBuilder.tsx` |
| 10 | Wake word wiring (B1) | `Layout.tsx`, `Settings.tsx` |
| 11 | WHOOP reliability (B9) | `whoop-sync/index.ts`, `WhoopIntegration.tsx` |
| 12 | Dave toasts + activity log (B10-B11) | `clientTools.ts` |

**Total: 15 features across ~12 files, 1 DB migration, 1 edge function update.**

