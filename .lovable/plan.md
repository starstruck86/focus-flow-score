

# Consolidated Implementation Plan

## What's Already Done
Bulk selection for accounts and opportunities **already exists** — both tables have checkboxes, `useBulkSelection`, and a `BulkActionsBar` with Change Status, Change Stage, Change Tier, Enrich, and Delete actions. No new work needed here.

## What Still Needs to Be Built (from prior approved plans + new requests)

### 1. Fix Content Builder Streaming (Critical Bug)
**File: `src/components/prep/ContentBuilder.tsx`**
- Replace `supabase.functions.invoke('build-resource', ...)` (line 132) with raw `fetch()` using the Supabase edge function URL + auth token
- Parse SSE stream line-by-line: read `data:` lines, extract token content, progressively append to `generatedContent` state
- Add a **Template Selector** dropdown that loads `is_template = true` resources and passes `templateContent` to the edge function
- Add a **Resource References** multi-select to include battlecards/one-pagers as context
- Replace `whitespace-pre-wrap` rendering with `react-markdown` + `remark-gfm`

### 2. Update Edge Function for Template-Aware Generation
**File: `supabase/functions/build-resource/index.ts`**
- Accept `templateContent` field in the `build-content` branch
- When present, prepend "Follow this template's structure, tone, and sections exactly" to the system prompt

### 3. Transcript Editing in TranscriptViewer
**File: `src/components/TranscriptViewer.tsx`**
- Add edit mode toggle (pencil icon) on detail pane
- Editable fields: title, call_type (Discovery/Demo/Negotiation/QBR/Follow-up/Other), call_date, participants, notes

**File: `src/hooks/useCallTranscripts.ts`**
- Add `useUpdateTranscript()` mutation

### 4. Bulk Re-Score All Transcripts
**File: `src/components/SalesCoachPanel.tsx`**
- Add "Re-Score All" button that sequentially calls `grade-transcript` for each transcript
- Show progress indicator ("Scoring 3/12...")
- Invalidate grade queries on completion

### 5. Search Navigation to Detail Views
**File: `src/components/GlobalSearch.tsx`**
- Change `handleSelect` routes:
  - Accounts → `/accounts/${result.id}` (existing detail page)
  - Opportunities → `/opportunities/${result.id}` (existing detail page)
  - Contacts → navigate to parent account detail
  - Tasks/Renewals → keep current routes with `setCurrentRecord`

### 6. Restore "Last Updated" Timestamp in Header
**File: `src/components/Layout.tsx`**
- Add a persistent `text-[10px]` timestamp next to `SaveIndicator` (line 294) showing when data was last loaded using `formatDistanceToNow`
- Update on any successful data fetch/save

### 7. Bulk Actions Enhancement — Add More Actions
**Files: `src/pages/WeeklyOutreach.tsx` + `src/components/OpportunitiesTable.tsx`**
- Add **Change Motion** (new-logo/renewal) to accounts bulk bar
- Add **Change Churn Risk** (low/medium/high) and **Change Deal Type** to opportunities bulk bar
- These extend the existing `BulkActionsBar` actions arrays

## New Dependency
- `react-markdown`, `remark-gfm`

## Files Modified (8)
1. `src/components/prep/ContentBuilder.tsx`
2. `supabase/functions/build-resource/index.ts`
3. `src/components/TranscriptViewer.tsx`
4. `src/hooks/useCallTranscripts.ts`
5. `src/components/SalesCoachPanel.tsx`
6. `src/components/GlobalSearch.tsx`
7. `src/components/Layout.tsx`
8. `src/components/OpportunitiesTable.tsx`

No database changes required.

