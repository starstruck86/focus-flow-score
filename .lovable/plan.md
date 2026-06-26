## COACH (deep)

### 1. Surface & Reach
- **Route:** `/coach` → `src/pages/Coach.tsx` (1683 lines). Registered in `App.tsx:151`. Removed from `BottomNav` (App.tsx:152 comment: *"Coach is no longer a nav destination — accessible via /coach for transcript grading"*). Only nav surface still labeled "Coach" is the bottom-nav Mic button → `/coach` (BottomNav.tsx:57), so it IS reachable.
- **User input:** paste transcript only. `pasteContent` state (line 943), `<Textarea value={pasteContent}>` (line 1104), plus a file `<input>` (1080) that loads text into the same state. **No live recording, no upload-to-STT, no audio file ingestion.** Save → `useSaveTranscript` → row in `call_transcripts`.
- **What's shown:** Tabs (Score / Patterns / Calls / Pre-Call / Deal Intel / Streaks / Weekly Digest / Coaching Focus / Performance Panels / After-Action Review). `CallScorecard` renders per-dimension scores (structure, cotm, meddicc, discovery, presence, commercial, next_step + Branch-specific scores), MEDDICC + CotM signal checklists, evidence quotes, an "Ask about this score" dialog calling `explain-score`, weak-area study material from `resource_digests`, and missed-opportunities → bulk task insert.

### 2. Grading (`grade-transcript`, 1016 lines)
- **Model:** Anthropic Claude (`ANTHROPIC_API_KEY`, structured tool-use JSON schema). No OpenAI in this fn.
- **Dimensions scored (1–5):** structure, cotm, meddicc, discovery, presence, commercial, next_step, product_knowledge, plus Branch-specific: `branch_expansion_hypothesis_score`, `branch_product_fit_score`, `branch_value_prop_score`, `branch_objection_handling_score`. Role-play extras: challenger_posture, narrative_arc, pressure_recovery, multi_thread, self_awareness. Overall mapped to letter grade via explicit weighted formula in prompt.
- **Auxiliary signals:** `cotm_signals` (before/neg-consequences/after/PBOs/required-caps/metrics booleans), `meddicc_signals` (M/E/D/D/I/C/C booleans), `discovery_stats`, `presence_stats`, `behavioral_flags`, `missed_opportunities`, `evidence`, `coaching_issue/why/strengths/improvements`, custom_scores.
- **Writes besides `transcript_grades` upsert (line 694):**
  - **`opportunity_methodology`** — confirmed. Lines 815/845/863: reads existing row, then either `.update()` or `.insert()` setting `*_confirmed` booleans + evidence from `meddicc_signals` whenever a `transcript.opportunity_id` is present. This is the MEDDICC auto-fill.
  - `dimension_scores` insert (line 998) — per-dimension avg roll-up.
  - Reads (not writes): prior grades, opportunity stage, resource_links, resource_digests for cumulative context.
- Has service-role bypass path (`isServiceRole`, line 24) for `batch-regrade-now`.

### 3. What is "Dave"?
- **Live realtime voice agent via ElevenLabs Conversational AI.** Confirmed: `DaveConversationMode.tsx:4` `import { useConversation } from '@elevenlabs/react'`. Hooks: `useDaveConversation`, `useDaveConnectionManager`, secret `ELEVENLABS_AGENT_ID` present.
- **`dave-conversation-token` (829 lines):** server fn that (a) mints a session token, (b) builds an enormous CRM context dump (`DAVE_INSTRUCTIONS` ~80+ lines covering identity, rules, Boston time) injected with live data from `calendar_events`, `accounts`, `tasks`, `opportunities` (active only), `voice_reminders`, `renewals`, `contacts`, `resources`, `quota_targets`, `conversion_benchmarks`, `streak_events`, `call_transcripts`, `transcript_grades`, `daily_journal_entries`, `daily_time_blocks`, `opportunity_methodology`, weekly_battle_plans, AAR. Also computes a personalized `firstMessage`.
- **`register-dave-tools` (304 lines):** registers client tools / function-calling schema for Dave.
- **Wired & working:** yes — `ProactiveDaveCard` (Dojo entry), `DaveCoachingFocusChip`, `useDaveContext`, conn-manager with stale-session 90s watchdog and reconnect toasts (DaveConversationMode.tsx:202/263), contract assertions on session payload (39). `dave_transcripts` has 0 rows because transcript persistence is optional / not currently being written — voice plumbing itself is live.
- **Key quote:** `DaveConversationMode.tsx:4` — `import { useConversation } from '@elevenlabs/react';` and `dave-conversation-token` constant `FUNCTION_GROUP_VERSION = "dave-v2"`.

### 4. Coach → Train bridge (EXISTS — partial)
Two bridges already wired in `CallScorecard` (Coach.tsx ~300–390, 572–588):
1. **"Dave recommends: Drill {dimension}"** card on the scorecard. Maps each score field → spider dimension (`CATEGORY_TO_DIMENSION` line 307), picks weakest dim with score <4, calls `selectNextKI(user.id, weakDim)`, button "Start Drill" → `navigate('/dojo/session', { state: { kiContext } })`.
2. **`signal_dimension_weakness` RPC** fired silently for every category <3/5; toast: *"📞 Drill queue updated from this call — N weak areas flagged for tomorrow's session"* (line 381). Flags 5 stalest KIs in dimension via `ki_mastery`.
- Destination is `/dojo/session` (legacy KI/sharpen path) — **NOT the new TRAIN v2 `/train/:spoke/:topic` ladder.** Phase 4 work = swap the navigate target + map spider dims to TRAIN spokes.

### 5. Coaching Feed
- `src/components/coach/CoachingFocus.tsx` (383 lines). Pure aggregator over `useAllTranscriptGrades` + `useBehavioralPatterns` + `useMeddiccCompleteness`. Hard-coded `CATEGORY_META` provides 3 textual drills per category (structure/cotm/meddicc/discovery/presence/commercial). No model call — deterministic recommender off recent grade history. Other surfaces: `WeeklyCoachingDigest`, `CoachingStreaks`, `PerformancePanels`, `AfterActionReview`. `useCoachingEngine` is a separate file driving conversion-math/pipeline-hygiene/battle-plan (not the per-transcript coaching feed).

### 6. End-to-end status
- **Working:** paste → grade → scorecard render → MEDDICC auto-fill on linked opp → weakness signal → drill recommendation → task creation → score-Q&A. Dave realtime voice works; CRM context assembly is rich.
- **Dead / weak:**
  - Drill bridge points at legacy `/dojo/session`, not TRAIN v2.
  - `dave_transcripts` table never written (0 rows) despite existing.
  - Only 5 transcripts / 4 grades total — the surface is under-used vs. capability.
  - Coach hidden from primary nav (only Mic icon).
- **Legacy content check (Rule 3):** spot-checked `grade-transcript`, `dave-conversation-token`, `CoachingFocus` — clean of Acoustic/Marketo/lifecycle/martech vocabulary. Branch-specific scoring dimensions present. ✅

---

## INTEL (ghost — confirmed)
No mounted route, no nav entry, no page component. `intelligence_units` and `knowledge_signals` are referenced only as schema in `integrations/supabase/types.ts` and incidentally by `AccountDetail` / `OpportunityDetail` displays. No `/intel` route in `App.tsx`. No edge function named `intel-*`. `branch-intelligence` and `deal-intelligence` exist but feed Coach's `DealIntelligence` component, not an Intel pillar. Verdict: **unbuilt schema + a handful of related edge fns**; there is no Intel pillar UI.

---

## WHOOP (light)
- **Sync path:** OAuth via `whoop-auth` (initiate) → `whoop-callback` (161 lines, stores tokens in `whoop_connections`) → `whoop-sync` (640 lines). All three share `FUNCTION_GROUP_VERSION = "whoop-v2"` and must deploy together. `whoop-sync` refreshes the token if needed, then fetches three families (`cycles`, `recovery`, `sleep`) using granted OAuth scopes and upserts into `whoop_daily_metrics`. Returns `scopeDiagnostics` + per-family success.
- **UI surfaces:** `src/components/WhoopIntegration.tsx` (connect/sync UI in Settings), `src/pages/Trends.tsx` + `useTrendsData`/`useWhoopData`/`useWhoopPatterns` (trend overlay charts), `src/components/dashboard/SalesAgeTile.tsx`, and Dave synthesis tools (`components/dave/tools/synthesis/whoopInsights.ts`, `behaviorEnergy.ts`, `trendComparison.ts`) which inject recovery/strain context into Dave responses.
- **Scoring integration:** none. WHOOP data is read-only overlay + Dave context. It is **not** an input into `daily_journal_entries.daily_score`, `calculateJournalScores`, transcript grading, or any TRAIN/Coach scoring path. Confirmed trend-overlay-only.

---

*Audit only. No edits requested or made.*