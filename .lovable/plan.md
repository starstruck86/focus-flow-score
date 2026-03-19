

# Give Dave Full CRM + Resource Context

## The concern
You're right. For roleplay, Dave needs methodology frameworks (MEDDICC, CotM), battlecards, account-specific opportunity methodology data, and resource library content. Currently he gets none of this — the edge function only fetches 5 tables with tight limits, and the context isn't even delivered properly (no `sendContextualUpdate` call exists).

## What changes

### 1. Edge function: `supabase/functions/dave-conversation-token/index.ts`
Expand `fetchCrmContext` from 5 parallel queries to 18. Add:

| Table | Key fields | Limit |
|-------|-----------|-------|
| accounts (expand) | + website, industry, notes, motion, tech_stack, icp_fit_score | 50 |
| opportunities (expand) | + deal_type, notes, status, term_months | 50 |
| tasks (expand) | + workstream, category, notes | 30 |
| calendar_events (expand) | keep fields | 15 |
| renewals | account_name, arr, renewal_due, churn_risk, health_status, next_step, notes | 30 |
| contacts | name, title, email, buyer_role, influence_level, department, seniority, status | 50 |
| **resources** | **title, resource_type, description, content, tags** | **30** |
| quota_targets | all fields | 1 |
| conversion_benchmarks | all rates | 1 |
| streak_events (last 7d) | date, checked_in, goal_met, daily_score | 7 |
| call_transcripts | title, call_date, call_type, summary | 15 |
| transcript_grades | overall_score, overall_grade, coaching_issue, strengths, improvements | 10 |
| weekly_battle_plans | strategy_summary, moves, quota_gap | 1 |
| weekly_reviews (if exists) | biggest_win, commitment_for_week | 1 |
| opportunity_methodology | all MEDDICC + CotM fields, call_goals | all active opps |
| daily_journal_entries (last 5d) | key activity metrics | 5 |
| daily_time_blocks (today) | blocks, ai_reasoning | 1 |

The **resources** query includes `content` (truncated to ~500 chars each) so Dave actually knows what's in your battlecards, methodology docs, and frameworks — not just titles. The **opportunity_methodology** query gives him full MEDDICC/CotM state per deal so roleplay can reference real gaps.

Each section is formatted as compressed text. Estimated total: ~12-15KB, within ElevenLabs limits.

### 2. Client: `src/components/DaveConversationMode.tsx`
Add `conversation.sendContextualUpdate(sessionDataRef.current.context)` in the `onConnect` callback after the greeting watchdog. This is the SDK's supported method for injecting background context — it works regardless of agent dashboard template configuration.

## Why this solves the roleplay concern
- Dave gets full MEDDICC/CotM field states per opportunity, so he can challenge you on real gaps
- Dave gets resource content (battlecards, frameworks, competitor intel), so he can simulate realistic buyer objections
- Dave gets coaching history (transcript grades, coaching issues), so roleplay scenarios target your actual weak spots
- All data is injected via `sendContextualUpdate` — a reliable, supported SDK method

## Files changed
- `supabase/functions/dave-conversation-token/index.ts` — expand to 18 parallel queries
- `src/components/DaveConversationMode.tsx` — add `sendContextualUpdate` in `onConnect`

## Cost impact
Zero additional AI/Cloud credits. These are all simple SELECT queries on your own data, run once per Dave session start.

