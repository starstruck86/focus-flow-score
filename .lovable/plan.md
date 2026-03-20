

## Dave Capability Gap Analysis

### What Dave CAN do today (21 tools)
CRM writes (update_account, update_opportunity, update_methodology, log_touch, move_deal, add_note), task creation, reminders, lookups (lookup_account, pipeline_pulse, scenario_calc), coaching triggers (start_roleplay, start_drill, grade_call), navigation, copilot delegation, email drafting, debrief logging, daily briefing, activity logging.

### What Dave CANNOT do but SHOULD

#### 1. Daily Metrics (already planned)
- **update_daily_metrics** — "Dave, add 5 calls to today" → upserts `daily_journal_entries`
- **get_daily_metrics** — "How many connects do I have today?"

#### 2. Contact Management
- **add_contact** — "Dave, add Sarah Chen, VP Sales at Acme, email sarah@acme.com" → inserts into `contacts`
- **lookup_contact** — "Who do I know at Acme?" → queries contacts by account

#### 3. Opportunity Creation
- **create_opportunity** — "Dave, create a new deal for Acme, 80k ARR, discovery stage" → inserts into `opportunities`

#### 4. Renewal Intelligence
- **lookup_renewal** — "What renewals do I have coming up this quarter?" → queries `renewals` table by date range
- **update_renewal** — "Dave, update the Acme renewal health to yellow, risk reason is low usage" → updates `renewals`

#### 5. Task Management (beyond create)
- **complete_task** — "Dave, mark the Acme follow-up task done" → updates task status to 'done'
- **list_tasks** — "What's on my plate today?" → queries tasks by due_date and status

#### 6. Calendar Awareness
- **get_calendar** — "What meetings do I have today/tomorrow?" → queries `calendar_events`

#### 7. Quota & Commission Read
- **quota_status** — "Where am I against quota?" → reads `quota_targets` + closed-won opps and returns % attainment

#### 8. Journal / Check-in
- **log_reflection** — "Dave, today's blocker was internal legal review, what worked was the multi-thread approach" → updates `daily_journal_entries` reflection fields
- **check_in** — "Dave, check me in for today" → sets `checked_in = true` on today's journal entry

#### 9. Transcript Lookup
- **lookup_transcript** — "What did we talk about in my last call with Acme?" → queries `call_transcripts` by account

#### 10. Power Hour
- **start_power_hour** — "Dave, start a power hour" → navigates to power hour modal or dispatches event
- **log_power_hour_stats** — "Dave, I just finished — 25 dials, 3 connects, 1 meeting set" → inserts `power_hour_sessions`

### Implementation approach

All tools go in `src/components/dave/clientTools.ts`. No database changes needed — all tables already exist with proper RLS.

Each tool also needs a matching **client tool registration** in ElevenLabs with name, description, and parameter JSON schema.

### Files to change

| File | Change |
|------|--------|
| `src/components/dave/clientTools.ts` | Add ~15 new tool functions |

### ElevenLabs registrations needed

For each new tool, a client tool must be added in the ElevenLabs agent dashboard with:
- **Name** (exact match to the key in `clientTools`)
- **Description** (tells the agent when to use it)
- **Parameters** (JSON schema)

I'll provide the complete registration JSON for every new tool alongside the code.

### Summary: Dave goes from 21 → ~36 tools

```text
Current (21)                    New (+15)
─────────────────               ─────────────────
create_task                     update_daily_metrics
update_account                  get_daily_metrics
update_opportunity              add_contact
update_methodology              lookup_contact
log_touch                       create_opportunity
move_deal                       lookup_renewal
add_note                        update_renewal
lookup_account                  complete_task
scenario_calc                   list_tasks
pipeline_pulse                  get_calendar
daily_briefing                  quota_status
debrief                         log_reflection
draft_email                     check_in
set_reminder                    lookup_transcript
navigate                        start_power_hour
open_copilot
prep_meeting
start_roleplay
start_drill
grade_call
log_activity
```

