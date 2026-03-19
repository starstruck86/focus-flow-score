

# Dave 0.05% Sales Ninja — Full Implementation

## Summary

Transform Dave from a raw-data-dumping voice assistant into an elite sales coach with identity, memory, meeting prep intelligence, proactive gap analysis, and powerful voice-driven CRM tools.

## 4 Files, 7 Changes

### 1. Edge Function: `supabase/functions/dave-conversation-token/index.ts`

**1a. Operating Instructions (prepended to context)**

Add ~1200 chars of `DAVE OPERATING INSTRUCTIONS` as the first context section. Defines:
- Identity: "Your name is Dave. You are an elite sales strategist and coach."
- Meeting prep protocol: match calendar titles to accounts, synthesize MEDDICC gaps + transcripts + contacts + resources into a prep brief
- Strategy/collaboration mode: back-and-forth Socratic coaching — challenge assumptions, suggest multi-threading, reference specific resources by name
- Proactive coaching: flag stale deals, overdue tasks, MEDDICC gaps unprompted
- Task creation: when user says "remind me" / "don't forget" — use create_task with due date
- Debrief protocol: guide structured post-meeting flow
- Pipeline math: use scenario_calc for "if I close X and Y, where am I?"
- Objection handling: reference coaching_history patterns and replacement behaviors

**1b. Accept `conversationHistory` in request body**

Read `body.conversationHistory` string and append as `CURRENT SESSION CONTEXT` section to context string.

**1c. Fetch previous session from `dave_transcripts`**

Query `dave_transcripts` for the most recent entry within 24h, extract last 10 messages, append as `LAST SESSION` section. Dave picks up where he left off.

**1d. Meeting Prep Cross-Referencing**

After fetching calendar + accounts + transcripts + contacts + methodology:
- Match each calendar event title against account names (case-insensitive substring)
- For matched meetings, build a `MEETING PREP` block with: account tier, pipeline value, MEDDICC confirmed vs gaps, last 2 call summaries, key contacts, relevant resource takeaways

**1e. Proactive `DEALS NEEDING ATTENTION` section**

Compute from methodology + opps + accounts:
- Deals with 3+ unconfirmed MEDDICC elements
- Deals closing within 30 days with gaps
- Accounts with active pipeline but no touch in 14+ days

**1f. Update `buildFirstMessage` to use Dave's name**

Replace generic greetings with "Hey, it's Dave." identity-aware messages. Reference last session if available.

---

### 2. Component: `src/components/DaveConversationMode.tsx`

**Wire `useDaveConversation` hook for memory:**
- Import and call `useDaveConversation()`
- On `user_transcript` messages, call `addUserMessage(text)`
- On `agent_response` messages, call `addDaveResponse(text)`
- Pass `getConversationContext()` to `getSession()` so reconnects preserve context
- On timeout/reconnect, history stays in the hook and gets re-sent with next token fetch

---

### 3. Hook: `src/hooks/useDaveContext.ts`

**Accept `conversationHistory` parameter:**
- `fetchSession(conversationHistory?: string)` includes it in POST body
- `getSession(conversationHistory?: string)` passes it through
- Edge function receives and appends to context

---

### 4. Client Tools: `src/components/dave/clientTools.ts`

**4a. Enhanced `create_task`** — Add `dueDate` param (accepts "today", "tomorrow", "Friday", ISO date) and `dueTime` ("7pm", "14:00"). Parse into `due_date`. When time is specified, also create `voice_reminders` entry.

**4b. New `update_methodology`** — Confirm/update MEDDICC fields by voice. Params: `opportunityName`, `field` (champion, economic_buyer, pain, etc.), `confirmed` (boolean), `notes`. Looks up opportunity → methodology row → upserts.

**4c. New `log_touch`** — Record interaction. Params: `accountName`, `touchType` (call/email/meeting/linkedin), `notes`. Updates `last_touch_date`, `last_touch_type`, appends to notes.

**4d. New `move_deal`** — Advance opportunity stage. Params: `opportunityName`, `newStage`.

**4e. New `scenario_calc`** — Pipeline math. Params: `dealNames` (array). Calculates total ARR if those close, remaining to quota, attainment %. Returns spoken summary.

**4f. New `lookup_account`** — Deep account lookup. Params: `accountName`. Fetches full details + contacts + opportunities + MEDDICC + recent transcripts. Returns synthesized summary for Dave to reference.

## No Database Migrations Needed

All tables already exist: `dave_transcripts`, `opportunity_methodology`, `tasks`, `voice_reminders`, `accounts`, `opportunities`, `contacts`, `call_transcripts`, `quota_targets`.

## What This Enables

- "Prep me for my 2pm with Acme" → synthesized brief with gaps, transcripts, frameworks
- "Don't let me forget to send pricing to FTD by 7pm" → task + voice reminder
- "I just confirmed the champion is Sarah Chen" → MEDDICC updated
- "If I close Acme and Beta, where am I?" → live quota math
- "Let's strategize on the FTD deal" → collaborative Socratic coaching
- Session times out → reconnects → Dave knows what was discussed
- Next morning → Dave references yesterday's conversation

