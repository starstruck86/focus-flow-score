

# Execution Analysis: Gaps, Limitations & Implementation Strategy

## Critical Architectural Constraints

### ElevenLabs SDK Limitation — The Floating Panel Problem
The `useConversation` hook from `@elevenlabs/react` bakes overrides (prompt, firstMessage, clientTools) at **mount time**. The "retry-via-remount" pattern in `Layout.tsx` (line 343: `key={...}`) already exploits this — every retry destroys and recreates the component to inject fresh overrides.

**Implication for floating panel**: Converting Dave from fullscreen to a floating panel is purely a CSS/layout change. The `useConversation` hook, WebRTC session, and all client tools are unaffected — only the wrapper `<motion.div>` at line 432 changes. The `conversation.startSession()`, `conversation.endSession()`, and all 67 client tool handlers continue to work identically. No SDK limitation blocks this.

**However**: The `navigate` tool currently calls `navigate(path)` (React Router), which works — but with fullscreen Dave blocking the view, the user never sees the navigation. Once Dave becomes a floating panel, `navigate` becomes truly functional for the first time.

### ElevenLabs Concurrency — Dave's Ceiling
The system already handles `workspace_concurrency_limit_exceeded` with exponential backoff (5s→15s→30s→60s) in `useDaveContext.ts`. But this means **only one Dave session per ElevenLabs workspace at a time**. The cross-tab guard (BroadcastChannel) is essential to prevent burning concurrent slots.

### Dave's 67 Client Tools — What's Missing
Current tools cover CRM CRUD, metrics, strategy, content, and coaching. But the plan calls for tools that **don't exist yet**:

| Missing Tool | Why It Matters |
|---|---|
| `get_whoop_status` | Dave can't report recovery/strain scores |
| `sync_whoop` | User must manually navigate to Settings |
| `explain_score` | No conversational scorecard Q&A via voice |
| `find_knowledge_gaps` | No "what am I missing in my library?" |
| `read_resource_digest` | Dave can `read_resource` (raw content) but can't read the operationalized takeaways/use-cases |

Each new tool requires **three synchronized changes**:
1. Handler in `clientTools.ts` (~30-50 lines each)
2. Schema in `register-dave-tools/index.ts` (tool definition)
3. Instruction in `DAVE_INSTRUCTIONS` in `dave-conversation-token/index.ts` (so Dave knows when to use it)

After adding tools, "Sync Tools" in Settings must be clicked to re-register with ElevenLabs.

### Context Window Limit — Dave's 20K Char Cap
`dave-conversation-token/index.ts` line 176-178: context is hard-capped at 20,000 chars. This already includes: DAVE_INSTRUCTIONS (~3.5K), accounts (30), tasks (30), opps (50), contacts (25), resources (30 titles), transcripts (15), grades (5), calendar, journal, methodology, battle plan, benchmarks, streaks, and last session transcript.

**Implication**: Adding resource digests, WHOOP data, or coaching plans to Dave's context will require either: (a) trimming existing sections, or (b) making these available only via on-demand tools (preferred — `get_whoop_status`, `read_resource_digest` fetch when asked, not pre-loaded).

### Real-Time Sync Gap — Confirmed Missing
- `ActivityRings.tsx`: No `addEventListener` for `dave-metrics-updated`. The store gets updated by `useDataSync`, but `initializeToday()` in ActivityRings runs once on mount and never re-runs.
- `JournalDashboardCard.tsx`: Uses `useWeekJournalEntries` via React Query but has no event listener to invalidate the cache. Dave updates go to DB → store, but the card shows stale data.

### Wake Word — Browser Compatibility Reality
`webkitSpeechRecognition` works on Chrome (desktop + Android) and Safari (iOS 14.5+). Firefox and other browsers don't support it. The hook must be a graceful no-op with `if (!('webkitSpeechRecognition' in window))`. Settings toggle should be hidden on unsupported browsers.

**Mic conflict**: When Dave is active, the ElevenLabs WebRTC session owns the mic. The wake word listener MUST pause during active Dave sessions to avoid conflicts.

### WHOOP Sync — The Token Refresh Failure Path
`whoop-sync/index.ts` line 33-36: when token refresh fails, it throws a generic `Error('Token refresh failed: ...')`, which bubbles up as a 500. The client (`WhoopIntegration.tsx`) catches this as a generic toast. No `needsReconnect` flag, no partial success reporting.

### Edge Function Limitations for New Features
- `explain-score`: New edge function using Lovable AI (`google/gemini-3-flash-preview`). Straightforward — accepts grade data + question, returns markdown. ~60 lines.
- `detect-knowledge-gaps`: New edge function comparing `resource_digests` vs `transcript_grades`. Needs to query both tables, synthesize with AI. ~100 lines.

Both need `LOVABLE_API_KEY` which is already available.

---

## Implementation Plan — Execution Order

### Phase 1: Dave Floating Panel + Real-Time Sync (Highest Impact)

**1a. DaveConversationMode.tsx — Floating panel refactor**
- Replace line 432 `fixed inset-0 z-[100] bg-black` with conditional layout:
  - **Expanded**: `fixed bottom-24 right-4 z-50 w-80 h-[380px] rounded-2xl bg-card/95 backdrop-blur-xl border shadow-2xl` — orb shrinks to 80px, scrollable transcript below, minimize + close buttons top-right
  - **Minimized**: `fixed bottom-24 right-4 z-50 w-14 h-14 rounded-full` — pulsing orb with state indicator, tap to expand
- Add props: `minimized: boolean`, `onMinimize: () => void`
- "Tap to talk" initial state adapts to card size
- All WebRTC/conversation logic untouched

**1b. Layout.tsx — Minimized state + cross-tab guard**
- Add `daveMinimized` state (default: false)
- Pass `onMinimize` / `minimized` to DaveConversationMode
- Add `BroadcastChannel('dave-session')` — post `dave-active` on open, `dave-inactive` on close. Other tabs disable Dave button with toast "Dave active in another tab"

**1c. ActivityRings.tsx — Event listener**
- Add `useEffect` with `addEventListener('dave-metrics-updated', handler)` where handler calls `initializeToday()` (re-reads store values) and forces a re-render via state increment

**1d. JournalDashboardCard.tsx — Query invalidation**
- Add `useQueryClient()` import, `useEffect` listener for `dave-metrics-updated` → `queryClient.invalidateQueries({ queryKey: ['journal-week'] })`

### Phase 2: New Dave Tools (WHOOP + Resources)

**2a. clientTools.ts — Add 3 new tools**
- `get_whoop_status`: Query `whoop_daily_metrics` for today, return recovery/sleep/strain with coaching context ("82% recovery = green zone")
- `sync_whoop`: Invoke `whoop-sync` edge function, return results
- `read_resource_digest`: Query `resource_digests` by resource title match, return takeaways + use_cases + grading_criteria

**2b. register-dave-tools/index.ts — Add 3 tool schemas**
- Add corresponding `ToolDef` entries to `DAVE_TOOLS` array

**2c. dave-conversation-token/index.ts — Update DAVE_INSTRUCTIONS**
- Add instructions for when to use `get_whoop_status`, `sync_whoop`, `read_resource_digest`

**2d. clientTools.ts — Action toasts**
- In `wrapTool` or after each DB-writing tool's success, emit `toast.success()` with action description so the user sees "Dave created task: Follow up with Acme" as a non-blocking notification

### Phase 3: WHOOP Sync Reliability

**3a. whoop-sync/index.ts**
- In `refreshTokenIfNeeded`: on catch, return structured `{ error: message, needsReconnect: true }` (200, not 500)
- In `fetchAndUpsertMetrics`: wrap each API call individually, return `{ synced: N, partialErrors: ['Recovery unavailable'] }`

**3b. WhoopIntegration.tsx**
- Detect `needsReconnect` in sync response → show "Reconnect WHOOP" button
- Auto-sync on mount if `connection` exists and `updated_at` > 6 hours stale
- Show partial sync results

### Phase 4: Wake Word

**4a. src/hooks/useWakeWord.ts** (new file)
- ~70 lines. `webkitSpeechRecognition` in continuous mode
- Listens for "hey dave" / "ok dave" in transcript results
- Props: `{ onWake: () => void, enabled: boolean }`
- No-op on unsupported browsers
- Pauses when Dave is active

**4b. Layout.tsx** — Wire `useWakeWord({ onWake: handleOpenDave, enabled: wakeWordEnabled && !daveOpen })`

**4c. Settings.tsx** — Toggle for "Hey Dave" wake word, stored in localStorage, hidden on unsupported browsers

### Phase 5: Scorecard Q&A + Resource Intelligence

**5a. supabase/functions/explain-score/index.ts** (new)
- Accepts `{ gradeData, transcriptExcerpt, question, category }`
- Uses Lovable AI Gateway with `google/gemini-3-flash-preview`
- System prompt: sales coaching expert, cite transcript quotes
- Returns markdown

**5b. Coach.tsx — Scorecard Q&A UI**
- "Ask about this" button on each ScoreBar/ScoreBlock
- Opens inline chat panel, calls `explain-score`

**5c. supabase/functions/detect-knowledge-gaps/index.ts** (new)
- Queries `resource_digests` + `transcript_grades`
- AI identifies coverage gaps
- Returns structured gap cards

**5d. ResourceIntelligenceDashboard.tsx** (new)
- Coverage map from `resource_digests.use_cases`
- Enrichment health stats
- "Find My Gaps" button
- "Bulk Operationalize" button

**5e. ResourceEditor.tsx — Digest viewer**
- Collapsible "Intelligence" section showing takeaways, use_cases, grading_criteria from digest

### Phase 6: Cross-System Wiring

**6a. Coach.tsx — Post-call task creation**
- After grading, if `missed_opportunities` exist → "Create Follow-up Tasks" prompt

**6b. Coach.tsx — Scorecard ↔ Resource cross-reference**
- For weak categories, query `resource_digests` matching use_cases → surface "Study Material" links

**6c. grade-transcript/index.ts — Return resource metadata**
- Include `resource_id` and title alongside custom grading criteria

**6d. PreCallCoach.tsx — Resource recommendations**
- Query `resource_digests` matching call context → surface 1-3 recommended resources

**6e. ContentBuilder.tsx — Transcript intelligence hints**
- When account selected, fetch recent grades → show pain points, objections as clickable chips

### Phase 7: Database Migrations (2)

**7a. coaching_plans table**
```sql
CREATE TABLE coaching_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  focus_category text NOT NULL,
  target_score numeric NOT NULL,
  start_date date DEFAULT CURRENT_DATE,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE coaching_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own plans" ON coaching_plans
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```

**7b. resource_usage_events table**
```sql
CREATE TABLE resource_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  event_type text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE resource_usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own events" ON resource_usage_events
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```

---

## Summary

| Phase | Features | New Files | Modified Files | DB Migrations |
|---|---|---|---|---|
| 1 | Floating Dave + real-time sync | 0 | 4 | 0 |
| 2 | Dave WHOOP/resource tools + toasts | 0 | 3 | 0 |
| 3 | WHOOP sync reliability | 0 | 2 | 0 |
| 4 | Wake word | 1 | 2 | 0 |
| 5 | Scorecard Q&A + resource intelligence | 3 | 3 | 0 |
| 6 | Cross-system wiring | 0 | 4 | 0 |
| 7 | DB migrations | 0 | 0 | 2 |
| **Total** | **20 features** | **4** | **~14 unique** | **2** |

