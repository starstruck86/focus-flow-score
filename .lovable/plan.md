

# Fix Limitations & Update ElevenLabs Skills

## Issues to Fix

### 1. Sync Tools Toast Shows 0/0 (Settings.tsx bug)
The "Sync Tools" button reads `data?.results` but the `register-dave-tools` edge function returns `{ message, failedTools, patchResult }` — not a `results` array. The toast always shows `0/0`.

**Fix**: Parse the `data.message` string or use `DAVE_TOOLS.length` (67) minus `data.failedTools.length`.

### 2. DealRiskAlerts Misses Deals With No `last_touch_date`
Deals without `last_touch_date` skip the staleness check entirely, meaning brand-new or never-touched deals silently pass.

**Fix**: Add an `else` branch — if `last_touch_date` is null and the deal was created > 7 days ago, flag as "Never touched" (high severity).

### 3. Memory Docs Say 55 Tools Instead of 67
The memory references still say "55 tools" in `voice/dave/capabilities` and `voice/dave/tool-management-ui`. These need updating to 67.

**Fix**: Update both memory entries to reflect 67 tools and list the 12 new tools from Phases 3-4.

### 4. AIInsightsNarrator Sparse Data Handling
With <5 data points, it returns an empty array but shows