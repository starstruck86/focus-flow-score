

# Scaling Podcast Import for 600+ Episodes

## Current State

The podcast import (`PodcastImportModal`) uses a **manual sequential `for` loop** to process episodes one-by-one. Meanwhile, the YouTube playlist import (`PlaylistImportModal`) already uses `useBulkIngestion` + `BulkIngestionPanel` — which provides batching (5-10 at a time), pause/resume/cancel, deduplication, progress tracking, and inter-batch delays. The podcast modal should use the same pattern.

Additionally, the `import-podcast` edge function relies solely on the RSS feed, which often caps at 100-300 episodes. For a 600+ episode show, this means silently returning a partial list.

## What to Build

### 1. Wire PodcastImportModal to useBulkIngestion

Replace the sequential `handleImport` loop with the existing `useBulkIngestion` hook + `BulkIngestionPanel` component — mirroring exactly how `PlaylistImportModal` works.

- Import `useBulkIngestion` and `BulkIngestionPanel`
- Map selected episodes to `sourceItems` format (`{ url, title, videoId?, channel?, publishDate?, duration? }`)
- Move the `source_registry` upsert to run **before** starting the bulk job (keep that logic)
- After source_registry is created, start the bulk ingestion which handles: classify → save → enrich per item, with batching, dedup, retry, pause/cancel
- Remove the old sequential `handleImport`, `importProgress` state, and manual progress bar
- The bulk engine already skips duplicates by canonical URL, so re-importing the same show won't create duplicates

### 2. Supplement RSS with iTunes Search API for large shows

In `supabase/functions/import-podcast/index.ts`, after fetching the RSS feed:

- Compare RSS episode count against `trackCount` from the iTunes lookup response
- If RSS returned significantly fewer episodes than `trackCount`, paginate through the iTunes Search API (`entity=podcastEpisode&limit=200` with `offset`) to get additional episodes
- Merge iTunes results with RSS results, deduplicating by title similarity or enclosure URL match
- Return the combined list with a `source_counts` field so the client knows: `{ rss_count, itunes_count, total_returned }`

### 3. Import-only mode (skip auto-transcription on bulk)

The current transcript writeback in `audioOrchestrator.ts` triggers `autoOperationalizeResource` after every transcription. For 600 episodes imported at once, this would cascade into 600 transcription + extraction jobs.

- In `PodcastImportModal`, do **not** trigger transcription during bulk import — the `useBulkIngestion` hook's `processItem` handles classify → save → enrich, which is the right pipeline for URL resources
- Audio transcription should be triggered separately via the existing "Deep Enrich" flow where the user controls batch size
- The key insight: bulk podcast import creates resources with metadata; transcription + KI extraction happens later in controlled batches

### 4. Smart selection helpers for large lists

Add selection shortcuts above the episode list when episode count > 50:

- "Newest 50" / "Newest 100" buttons (based on `published` date sort)
- "Episodes with guests" (filter where `guest` is non-null)
- Show count of episodes with detected guests vs total

### 5. Episode dedup indicator

Before starting import, check existing resources by enclosure URL and mark already-imported episodes:

- Query user's resources where `file_url` matches any episode URL
- Show "X already imported" badge, auto-deselect those
- This prevents duplicate imports when re-visiting the same show

---

## Technical Details

- `useBulkIngestion` already handles: batching (configurable 1-10), pause/resume/cancel, inter-item delays (1.2s), inter-batch delays (2.5s), canonical dedup, progress UI via `BulkIngestionPanel`, retry failed items
- The `source_registry` upsert + metadata population (guest, speaker, published date) stays in the modal but runs once before bulk start
- After bulk import creates the resources, the user can use Deep Enrich to batch-process transcription + KI extraction at their pace
- iTunes Search API max is `limit=200` per call; for 600 episodes need 3 paginated calls with `offset=0,200,400`
- No new DB tables, columns, or migrations needed

