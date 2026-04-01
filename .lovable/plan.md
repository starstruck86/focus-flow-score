

# Server-Side Podcast Import Queue — Deep Analysis

## Will it work?

Yes, but the original plan has three real risks that need to be addressed before building.

## Risk 1: Edge function timeout vs batch processing

Each episode requires **3 sequential operations**: classify (~5s) → save (~1s) → enrich (~15-30s). That's ~20-35s per episode. Processing 5 episodes per cron invocation = 100-175s. **Edge functions time out at ~60s by default** (max ~150s with config).

**Fix**: Process **1 episode per cron invocation**, not 5. With pg_cron running every 1 minute, throughput is ~60 episodes/hour. A 600-episode import finishes in ~10 hours — fine for overnight. This is safer than trying to batch and hitting timeout walls.

## Risk 2: Overlapping cron runs

If a cron run takes longer than the interval, the next run starts while the previous is still going. Two runs grab the same rows, creating duplicate resources.

**Fix**: Use `FOR UPDATE SKIP LOCKED` when claiming queue rows. The edge function atomically marks a row as `processing` before doing work. If a previous run is still holding a row, the next run skips it.

```sql
-- Inside the edge function:
UPDATE podcast_import_queue
SET status = 'processing', updated_at = now()
WHERE id = (
  SELECT id FROM podcast_import_queue
  WHERE status = 'queued'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

## Risk 3: processItem logic duplication

The current `processItem` in `useBulkIngestion.ts` is ~150 lines of browser-side logic (canonicalize, dedup check, classify via edge function, folder creation, resource insert, enrich via edge function). The server-side queue function needs to replicate all of this — but edge functions can't import from `src/`.

**Fix**: The server-side function calls the **existing** `classify-resource` and `enrich-resource-content` edge functions via `fetch()` (function-to-function). Resource creation and dedup use the service_role Supabase client directly. The logic is simpler server-side because there's no UI state to update — just DB writes.

## What happens if episode 3 errors?

Each episode is an independent row in the queue table. If episode 3 fails:

1. Episode 3's row gets `status = 'failed'`, `attempts = 1`, `error_message = 'Classification timeout'`
2. Episodes 1-2 are already `complete` — untouched
3. Episodes 4-600 remain `queued` — the next cron run picks up episode 4
4. On a later cron run, episode 3 gets retried (if `attempts < 3`)
5. After 3 failures, it stays `failed` permanently — you can see why in the `error_message`

This is strictly better than the client-side model where a crash loses all progress context.

## How do you keep track?

Two mechanisms:

1. **Realtime subscription**: When you open the app, a subscription on `podcast_import_queue` shows live progress — "142/600 complete, 3 failed, 455 queued" — updating in real-time as cron processes items
2. **Persistent state**: Close the tab, go to bed, open the app tomorrow — the queue table is the source of truth. You see exactly which episodes succeeded, which failed (and why), which are still queued

A small status indicator on the Prep page shows active queue progress without needing to open the import modal.

## Revised Build Plan

### Step 1: Create `podcast_import_queue` table
- Migration with columns: `id`, `user_id`, `source_registry_id`, `episode_url`, `episode_title`, `episode_guest`, `episode_published`, `episode_duration`, `show_author`, `status` (queued/processing/complete/failed/skipped), `error_message`, `resource_id`, `attempts`, `created_at`, `updated_at`, `processed_at`
- RLS: users see only their own rows
- Realtime enabled
- Index on `(status)` for fast queue polling

### Step 2: Create `process-podcast-queue` edge function
- Called by pg_cron every 1 minute
- Claims **1 queued row** using `FOR UPDATE SKIP LOCKED`
- Pipeline: dedup check → call `classify-resource` → insert resource → call `enrich-resource-content` → mark `complete` with `resource_id`
- On failure: increment `attempts`, set `error_message`, mark `failed` if attempts >= 3, else back to `queued`
- Uses `SUPABASE_SERVICE_ROLE_KEY` (already exists as a secret)
- Links completed resource to `source_registry_id`, sets `author_or_speaker`

### Step 3: Schedule with pg_cron
- Every 1 minute: `net.http_post` to `process-podcast-queue`
- pg_cron and pg_net extensions already enabled in existing migrations

### Step 4: Update PodcastImportModal
- Keep the fetch/select episode flow as-is
- On "Start Import": INSERT all selected episodes into `podcast_import_queue`
- Show a queue progress panel (replaces `BulkIngestionPanel` for podcast flow)
- Subscribe to Realtime on `podcast_import_queue` for live updates
- "Cancel remaining" button: UPDATE all `queued` rows to `skipped`
- User can close the modal — processing continues server-side

### Step 5: Add queue status indicator on Prep page
- Small badge/progress ring when active queue items exist
- "Importing: 47/600 episodes" — click to see details
- Realtime-driven, no polling

## Technical Details

- 1 episode/minute throughput = ~600 episodes in 10 hours (fine for overnight)
- `FOR UPDATE SKIP LOCKED` prevents duplicate processing from overlapping cron runs
- 3-attempt retry with error classification handles transient failures
- No changes to `useBulkIngestion` — it stays for non-podcast bulk operations
- The edge function reuses existing `classify-resource` and `enrich-resource-content` via internal fetch, so no logic duplication for the heavy lifting
- Service role client handles resource creation without user session

