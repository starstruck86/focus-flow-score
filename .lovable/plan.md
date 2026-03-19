

# Consolidated Plan: 6 Features for Resource Intelligence

This plan combines all agreed-upon features into a single implementation scope.

---

## Database Migration

**New table: `resource_digests`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| resource_id | uuid | unique FK to resources |
| user_id | uuid | for RLS |
| takeaways | text[] | 5-10 actionable bullets |
| summary | text | 2-3 sentence overview |
| use_cases | text[] | "use when..." scenarios |
| grading_criteria | jsonb | array of `{category, description, weight}` for scorecard auto-grading |
| content_hash | text | md5 of source — skip re-digest if unchanged |
| created_at | timestamptz | |

RLS: authenticated users manage own rows (all commands).

**Alter `transcript_grades`**: add `custom_scorecard_results` (jsonb, nullable, default null).

---

## New Edge Functions

### 1. `operationalize-resource` (One-Click Operationalize + Digest)
- Accepts `{ resource_id }`, validates auth
- Fetches full resource content, computes content hash, skips if unchanged
- Calls Gemini Flash with tool calling to extract: `takeaways`, `summary`, `use_cases`, `grading_criteria` (if resource is a playbook/framework/scorecard), `suggested_tasks`
- Upserts into `resource_digests`
- Returns all generated artifacts to client

### 2. `suggest-resource-uses` (Smart Suggestions + Deal-Aware)
- Fetches user's resources (titles, types, tags) and active opportunities (stage, deal_type, close_date)
- Calls Gemini Flash with tool calling to return 1-3 structured suggestions:
  - `description`, `action_type` (transform | combine | templatize | cadence), `source_resource_ids`, `target_type`, `deal_context`
- Examples: "Your Cold Calling Playbook could become a Scorecard", "Combine Discovery Framework + Objection Playbook into a Pre-Call Template", "3 deals in Tech Eval — generate a checklist from your MEDDICC Framework"

---

## Edge Function Updates

### 3. `build-resource` — add `"transform"` type
- Accepts `sourceResourceId` + `targetType` + optional `prompt`
- Fetches source resource content via service role
- Type-specific system prompts for: `scorecard`, `checklist`, `cadence`, `training_guide`, `one_pager`
- Uses existing streaming pattern

### 4. `dave-conversation-token` — prefer digests over raw content
- Add parallel query for `resource_digests`
- In RESOURCES section (lines 320-328), if digest exists: show `TAKEAWAYS: • bullet1 • bullet2 | USE WHEN: scenario1` instead of truncated raw content
- Falls back to current `trunc(content, 500)` if no digest

### 5. `grade-transcript` — custom scorecard integration
- After existing resource context fetch, also query `resource_digests` where `grading_criteria IS NOT NULL`
- If found, inject custom scoring criteria into system prompt alongside standard MEDDICC/CotM
- Add `custom_scores` to tool call response schema
- Store results in `custom_scorecard_results` column on `transcript_grades`

---

## Frontend Changes

### 6. `src/hooks/useResources.ts`
- Add `useOperationalizeResource()` mutation — calls edge function, returns digest
- Add `useResourceSuggestions()` query — calls `suggest-resource-uses`
- Fire-and-forget digest call after `useCreateResource` and `useUpdateResource` (when content changes)

### 7. `src/components/prep/AIGenerateDialog.tsx`
- Add output types: `scorecard`, `checklist`, `cadence`, `training_guide`, `one_pager`
- Add optional `sourceResourceId` and `initialPrompt` props for pre-configured opening
- When `sourceResourceId` set, use `type: "transform"` instead of `type: "generate"`

### 8. `src/components/prep/ResourceManager.tsx`
- Add "Operationalize" menu item (Sparkles icon) in the MoreHorizontal dropdown (after Duplicate, before Delete separator)
- Add "Generate From This" menu item — opens AIGenerateDialog with source resource pre-selected
- Add suggestions banner above the resource grid: shows 1-3 AI suggestions with one-click "Create" buttons that open AIGenerateDialog pre-configured. Dismiss/refresh controls. Auto-fetches on first load if resources exist.

---

## Implementation Order

1. Migration (new table + alter column)
2. `operationalize-resource` edge function
3. `useResources.ts` hooks + ResourceManager "Operationalize" and "Generate From This" menu items
4. `build-resource` transform type + AIGenerateDialog new output types
5. `suggest-resource-uses` edge function + suggestions banner UI
6. `dave-conversation-token` digest preference
7. `grade-transcript` custom scorecard integration

## Files Changed

| File | Change |
|------|--------|
| Migration SQL | Create `resource_digests`, add `custom_scorecard_results` to `transcript_grades` |
| `supabase/functions/operationalize-resource/index.ts` | New |
| `supabase/functions/suggest-resource-uses/index.ts` | New |
| `supabase/functions/build-resource/index.ts` | Add `"transform"` type |
| `supabase/functions/dave-conversation-token/index.ts` | Query digests, prefer over raw |
| `supabase/functions/grade-transcript/index.ts` | Inject custom scorecard criteria |
| `src/hooks/useResources.ts` | Add operationalize + suggestions hooks, auto-digest on create/update |
| `src/components/prep/AIGenerateDialog.tsx` | New output types + source pre-selection |
| `src/components/prep/ResourceManager.tsx` | Menu items + suggestions banner |

