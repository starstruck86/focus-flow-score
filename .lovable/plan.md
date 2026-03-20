

# Full Implementation Plan — 22-Item Stack with Dave Tools + QA Gates

This is a phased implementation with QA checkpoints after every batch to ensure zero data loss or functionality regression.

---

## Phase 1: Trivial Fixes (QA Gate: verify table views + merge flow)

### 1A. Sticky Group Dimensions
**File:** `src/components/OpportunitiesTable.tsx`
- Line 357: read `groupDimensions` from localStorage on init (keyed by `group-dimensions-{renewals|newlogo|all}`)
- Add useEffect to persist whenever `groupDimensions` changes
- Pattern already exists on lines 340-344 for `collapsedGroups`

### 1B. Duplicate Merge Fix
**File:** `src/components/OpportunitiesTable.tsx`
- Add `showDuplicateReview` boolean state
- Lines 1298-1301: change "Review & Merge" onClick to toggle `showDuplicateReview` instead of navigating to Settings
- Render `<DuplicateDetector />` inline below the banner when toggled

**File:** `src/hooks/useDuplicateDetection.ts`
- After successful merge, call `useStore.getState().deleteAccount(removeId)` or `deleteOpportunity(removeId)` to sync Zustand

**QA Gate 1:** Verify table loads with correct group defaults, groups persist across refresh, duplicate merge works inline without navigating away, Zustand store updates after merge.

---

## Phase 2: Coach Scoring Overhaul (QA Gate: verify grading + new fields)

### 2A. Database Migration
```sql
ALTER TABLE transcript_grades
  ADD COLUMN IF NOT EXISTS call_goals_inferred text[],
  ADD COLUMN IF NOT EXISTS goals_achieved jsonb,
  ADD COLUMN IF NOT EXISTS deal_progressed boolean,
  ADD COLUMN IF NOT EXISTS progression_evidence text,
  ADD COLUMN IF NOT EXISTS likelihood_impact text,
  ADD COLUMN IF NOT EXISTS competitors_mentioned text[];

ALTER TABLE call_transcripts
  ADD COLUMN IF NOT EXISTS call_goals text[];
```

### 2B. Grade-Transcript Overhaul
**File:** `supabase/functions/grade-transcript/index.ts`
- Fetch prior transcript grades for same `opportunity_id` to build cumulative MEDDICC coverage
- Fetch opportunity stage/next steps for cycle context
- Rewrite grading rules: remove "Most reps are 2-3", add outcome-based scoring per call type
- Add new output fields to tool schema: `call_goals_inferred`, `goals_achieved`, `deal_progressed`, `progression_evidence`, `likelihood_impact`, `competitors_mentioned`
- After grading, auto-append structured summary to opportunity `notes`
- Save new fields to `transcript_grades`

### 2C. Coach UI Updates
**File:** `src/pages/Coach.tsx`
- Add "Call Goals" text input to transcript upload form
- Add "Re-analyze" button on scorecard that re-invokes `grade-transcript`
- Add outcome display card (Deal Progressed, Goals, Likelihood Impact)

**QA Gate 2:** Upload a transcript, verify grading completes with new outcome fields, verify re-grade works, verify MEDDICC auto-enrichment still works, verify call summary appended to opportunity notes.

---

## Phase 3: Dave New Tools — Batch 1 (QA Gate: verify all 6 tools via Settings sync)

### 3A. Client Tools (6 new tools)
**File:** `src/components/dave/clientTools.ts`

1. **`add_opportunity_note`** — writes note to `opportunities.notes` (mirrors `add_note` for accounts)
2. **`read_resource`** — fetches resource content by title match (truncated 3000 chars)
3. **`methodology_gaps`** — fetches all `opportunity_methodology` for active opps, returns ranked unconfirmed elements weighted by ARR/close date
4. **`next_action`** — weighted priority synthesizer across overdue tasks, upcoming unprepped meetings, stale deals, methodology gaps, journal status. Returns single highest-impact action.
5. **`contact_timeline`** — cross-references contact name against `call_transcripts` and `calendar_events` to return last engagement date/type
6. **`save_commitment`** — persists verbal commitment to account notes + creates a task

### 3B. Register Tools in ElevenLabs
**File:** `supabase/functions/register-dave-tools/index.ts`
- Add 6 new tool schemas to `DAVE_TOOLS` array with exact parameter schemas matching clientTools.ts

### 3C. Update Dave Instructions
**File:** `supabase/functions/dave-conversation-token/index.ts`
- Add instruction lines for new tools: "Use `next_action` when asked 'what should I do?'", "Use `methodology_gaps` for cross-deal MEDDICC analysis", "Use `save_commitment` when user agrees to something"

**QA Gate 3:** Run "Sync Tools" in Settings, verify 61/61 tools created. Test Dave voice: "What should I do next?", "What are my MEDDICC gaps?", "Add a note to the ISG opportunity."

---

## Phase 4: Dave New Tools — Batch 2 (QA Gate: verify all 6 tools)

### 4A. Client Tools (6 more tools)
**File:** `src/components/dave/clientTools.ts`

7. **`generate_content`** — resolves account/opp/contact, fetches latest transcript + methodology, calls `build-resource` edge function, returns generated content + copies to clipboard
8. **`open_content_builder`** — navigates to `/prep` and dispatches custom event with pre-filled context (accountName, opportunityName, contentType)
9. **`assess_deal_risk`** — calls `deal-intelligence` edge function (or client-side heuristic if edge fn not yet built) for deep risk analysis
10. **`competitive_intel`** — searches `call_transcripts.content` and `accounts.notes` for competitor mentions, returns aggregated results
11. **`create_methodology_tasks`** — fetches unconfirmed MEDDICC elements for an opp, generates specific tasks with talk tracks for each gap
12. **`meeting_brief`** — fuzzy-matches next calendar event to an account, pulls account summary + opp status + MEDDICC gaps, returns concise inline brief

### 4B. Register in ElevenLabs
**File:** `supabase/functions/register-dave-tools/index.ts`
- Add 6 more tool schemas (total now 67)

### 4C. Update Instructions
**File:** `supabase/functions/dave-conversation-token/index.ts`
- Add: "Use `generate_content` when asked to draft emails or content", "Use `meeting_brief` for inline pre-call briefs", "Use `create_methodology_tasks` to convert MEDDICC gaps to tasks"

**QA Gate 4:** Sync Tools → verify 67/67. Test: "Draft me a follow-up email for [account]", "Brief me on my next meeting", "Create tasks to close MEDDICC gaps on [deal]."

---

## Phase 5: Prep Hub Content Engine (QA Gate: verify generation + save)

### 5A. Database Migration
```sql
CREATE TABLE custom_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  prompt_text text NOT NULL,
  content_type text DEFAULT 'document',
  variables text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE custom_prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own prompts" ON custom_prompts
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS is_screenshot_template boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS screenshot_structure text;
```

### 5B. ContentBuilder Component
**File:** `src/components/prep/ContentBuilder.tsx` (NEW)
- Account/Opportunity/Contact selectors from Zustand store + DB
- Transcript multi-select (up to 5)
- Resource multi-select
- Screenshot drop zone (reuses `parse-screenshot`)
- Content type picker (Business Case, ROI, Executive Email, Follow-up, QBR, Proposal, Custom)
- Custom instructions textarea
- Generate button → streams to inline RichTextEditor
- Save to Library button

### 5C. Enhanced Build-Content Edge Function
**File:** `supabase/functions/build-resource/index.ts`
- Add `type: 'build-content'` path
- Server-side context assembly: full account data, opportunity + methodology, transcripts, contacts, org chart
- Per-content-type system prompts
- Screenshot template replication support

### 5D. PrepHub Redesign
**File:** `src/pages/PrepHub.tsx`
- ContentBuilder as primary tab
- My Prompts tab with CRUD (replaces "Coming soon")
- Generated history tab (query resources filtered by AI-generated)

**QA Gate 5:** Select account + opp, generate a business case, verify it uses transcript/MEDDICC context. Save to library, verify it appears. Save a custom prompt, verify CRUD works.

---

## Phase 6: Professional Export Engine (QA Gate: verify all 3 export formats)

### 6A. DOCX Export Overhaul
**File:** `src/components/prep/ExportMenu.tsx`
- Cover page with title, account name, date
- Table of Contents from headings
- Professional styling (headers/footers, page numbers)
- Full markdown table rendering as Word tables
- Branded accent colors

### 6B. PPTX Export Overhaul
- Cover slide with branded background
- Agenda slide auto-generated from H2s
- Content slides with proper bullet formatting
- Data slides with PowerPoint tables
- Closing slide with next steps

### 6C. PDF Export
- Proper page layout with margins
- Cover page, table rendering, professional typography

**QA Gate 6:** Generate content, export as DOCX/PPTX/PDF, verify each has cover page, proper formatting, tables render correctly.

---

## Phase 7: AI Intelligence Layer (QA Gate: verify each widget)

### 7A. Deal Intelligence Edge Function
**File:** `supabase/functions/deal-intelligence/index.ts` (NEW)
- Per-opportunity risk analysis from transcripts + methodology + activity cadence

### 7B. Deal Patterns Table + Edge Function
```sql
CREATE TABLE deal_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  opportunity_id uuid,
  outcome text NOT NULL,
  analysis jsonb NOT NULL DEFAULT '{}',
  patterns_identified text[],
  created_at timestamptz DEFAULT now()
);
ALTER TABLE deal_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own patterns" ON deal_patterns
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```
**File:** `supabase/functions/analyze-deal-outcome/index.ts` (NEW)

### 7C. Additional Widgets
- `DealRiskAlerts` dashboard widget
- Quota page "Close the Gap" advisor (calls new `quota-acceleration` edge function)
- Account Detail: relationship health card (client-side computed)
- Opportunity Detail: deal velocity widget (client-side from benchmarks)
- Trends page: AI Insights narrator card
- PostMeetingPrompt: auto-stage advancement suggestion
- Methodology gap auto-tasks edge function

**QA Gate 7:** Verify each new widget loads without breaking existing pages. Verify deal risk alerts show for stale deals. Verify quota advisor generates recommendations.

---

## Summary

| Phase | Items | New Dave Tools | QA Gate |
|-------|-------|---------------|---------|
| 1 | Sticky groups + merge fix | 0 | Table views work, merge works inline |
| 2 | Coach scoring overhaul | 0 | Grading produces outcome fields |
| 3 | Dave batch 1 | 6 (→61 total) | Sync Tools 61/61, voice test 3 tools |
| 4 | Dave batch 2 | 6 (→67 total) | Sync Tools 67/67, voice test 3 tools |
| 5 | Prep Hub content engine | 0 | Generate + save + custom prompts |
| 6 | Professional exports | 0 | DOCX/PPTX/PDF quality check |
| 7 | AI intelligence layer | 0 | All new widgets load, no regressions |

Total: 22 features, 12 new Dave tools, 4 new edge functions, 4 database migrations, 7 QA gates.

