

# Dave Tool Coverage Audit — Gaps & Expansion Plan

## Current State: 36 Tools

The existing tools cover basic CRUD and lookups across accounts, opportunities, renewals, tasks, contacts, daily metrics, calendar, quota, journal, transcripts, coaching, and navigation. Solid foundation — but they only scratch the surface of what the app can do.

## Critical Gaps (High-Impact Missing Tools)

### 1. Create Account (voice can update but not create)
Dave can't add a new account. If you hear about a prospect on a call, you have to leave voice mode and manually create it. Should support: `"Dave, add Acme Corp as a new account, tier B, new-logo motion"`

### 2. Account Enrichment Trigger
The app has a full enrichment pipeline (Firecrawl, Perplexity, AI fallback) but no voice trigger. Should support: `"Dave, enrich Acme Corp"` → kicks off the edge function and reports back.

### 3. Cross-Entity Search
GlobalSearch exists in the app but Dave can't search. Should support: `"Dave, search for anything related to cloud migration"` → searches accounts, opps, contacts, transcripts.

### 4. Weekly Battle Plan / Review
The app generates weekly battle plans and review summaries via edge functions, but Dave can't trigger or summarize them. Should support: `"Dave, what's my battle plan this week?"` and `"Dave, run my weekly review"`

### 5. Commission & Pacing Detail
`quota_status` gives attainment %, but the app has detailed commission pacing (CommissionPacingTile, CommissionSnapshot). Should support: `"Dave, what's my commission tracking at?"` with accelerator tiers, projected earnings, and P-Club math.

### 6. Account Prioritization
The app has an AI Account Prioritizer but Dave can't ask for it. Should support: `"Dave, which accounts should I prioritize today?"` → returns ranked list with reasoning.

### 7. Trend Queries
The Trends page has rich analytics but Dave can't query them. Should support: `"Dave, how are my connects trending this month?"` or `"Dave, compare my activity this week vs last"`

### 8. Stakeholder Intelligence
StakeholderMap and OrgChart exist but Dave can't query them. Should support: `"Dave, who's the economic buyer at Acme?"` or `"Dave, map the org chart at Acme"`

### 9. Territory Copilot
Full territory analysis engine exists but has no voice interface. Should support: `"Dave, analyze my territory balance"` or `"Dave, which accounts are under-touched?"`

### 10. Focus Timer (configurable)
Only `start_power_hour` exists (fixed duration). Should support: `"Dave, start a 25-minute prospecting block for Acme"` with type, duration, and account linking.

### 11. Resource / Prep Hub Access
PrepHub has resources, templates, and AI-generated content but Dave can't access any of it. Should support: `"Dave, find my prep notes for Acme"` or `"Dave, what resources do I have on objection handling?"`

### 12. Bulk / Batch Operations
No multi-record voice commands. Should support: `"Dave, mark all tasks for Acme as done"` or `"Dave, set all Tier C accounts to inactive"`

### 13. Create Recurring Task
RecurringTasks page exists but Dave can't create them. Should support: `"Dave, create a recurring task to check in with Acme every Tuesday"`

### 14. Smart Debrief with Auto-Tasks
Current `debrief` logs notes but doesn't auto-generate follow-up tasks from takeaways. Should support: `"Dave, debrief Acme — they need a proposal by Friday and I need to loop in their VP"` → creates 2 tasks automatically.

### 15. Pipeline Hygiene Report
Edge function `pipeline-hygiene` exists but Dave can't trigger it. Should support: `"Dave, run pipeline hygiene"` → returns stale deals, missing close dates, MEDDICC gaps.

## Summary: 15 New Tools to Add

```text
Category              New Tools
──────────────────────────────────────────
CRM Actions           create_account, enrich_account, bulk_update
Search & Intel        search_crm, stakeholder_query, territory_analysis
Strategy              weekly_battle_plan, weekly_review, pipeline_hygiene
                      account_prioritize, commission_detail
Analytics             trend_query
Productivity          start_focus_timer, create_recurring_task
Resources             search_resources
Enhanced              smart_debrief (replaces debrief with auto-task creation)
```

## Implementation Plan

### Step 1: Add 15 new client tool handlers to `clientTools.ts`
Each tool follows the existing pattern — async function, getUserId, query/mutate database, return summary string, show toast.

### Step 2: Update `register-dave-tools/index.ts` with all 51 tool definitions
Delete old tools, create new set with correct parameter schemas matching client code.

### Step 3: Re-register all tools on ElevenLabs agent
Single invocation of the updated edge function.

### Files to modify
1. **`src/components/dave/clientTools.ts`** — Add 15 new tool handlers (~400 lines)
2. **`supabase/functions/register-dave-tools/index.ts`** — Update DAVE_TOOLS array to 51 entries with corrected schemas for all tools (existing + new)

