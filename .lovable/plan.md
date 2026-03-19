

# Test & Optimize Dave — Bugs Found + Performance Fixes

## Issues Discovered

### Bug 1: Reconnect Never Sends Conversation History (Critical)
**File**: `DaveConversationMode.tsx`, line 200
```
if (!sessionData || !isReconnectRef.current)
```
On reconnect, `isReconnectRef.current` is `true`, so `!isReconnectRef.current` is `false`. Combined with `sessionData` existing (cached), the entire block is skipped. Dave never gets conversation history on reconnect — the core memory feature is broken.

**Fix**: Change to `if (!sessionData || isReconnectRef.current)`.

### Bug 2: Dave Creates Tasks He Can Never See (Critical)
**File**: `clientTools.ts` line 118 creates tasks with `status: 'next'`.
**File**: `dave-conversation-token/index.ts` line 180 queries tasks with `.in("status", ["todo", "in_progress"])`.

The status values don't match. Dave creates tasks that never appear in his own context. The app's type system uses `'next' | 'in-progress' | 'blocked' | 'done' | 'dropped'`.

**Fix**: Change the edge function query to `.in("status", ["next", "in-progress"])`.

### Bug 3: Timezone Calculation Inverted
**File**: `dave-conversation-token/index.ts`, line 676
```
const localHour = (hour - tzOffsetHours + 24) % 24;
```
Client sends `getTimezoneOffset() / -60`, so EST = -5. Formula computes `UTC - (-5) = UTC + 5` — wrong direction. Morning briefings fire at the wrong time.

**Fix**: Change to `(hour + tzOffsetHours + 24) % 24`.

### Bug 4: Task Priority Mismatch
`clientTools.ts` creates tasks with `priority: 'medium'` but the app's type system uses `'P0' | 'P1' | 'P2' | 'P3'`.

**Fix**: Default to `'P2'` instead of `'medium'`.

### Optimization 1: Context Size Too Large
- Resource raw content capped at 500 chars (line 426) — should be 200
- Accounts fetched: 50 — reduce to 30
- Contacts fetched: 50 — reduce to 25
- No hard cap on total context — add 20k char limit with section trimming

### Optimization 2: Missing `workstream` on Created Tasks
Tasks created by Dave have no `workstream` field, which may cause them to not appear in filtered views.

**Fix**: Default to `'pg'` workstream.

## Changes

| File | Change |
|------|--------|
| `src/components/DaveConversationMode.tsx` | Fix reconnect condition (line 200) |
| `src/components/dave/clientTools.ts` | Fix task priority to `'P2'`, add `workstream: 'pg'` |
| `supabase/functions/dave-conversation-token/index.ts` | Fix timezone math, fix task status query, reduce context limits, add 20k hard cap |

## 3 bug fixes, 2 optimizations across 3 files

