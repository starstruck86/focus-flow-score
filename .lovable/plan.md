

# Will This Plan Work for "Getting to Club" (id1696635955)?

## Yes — with caveats. Here's exactly what works and what doesn't today.

### What works right now (no changes needed)

The URL `https://podcasts.apple.com/us/podcast/getting-to-club/id1696635955` will be correctly parsed by `extractApplePodcastId` — it extracts `1696635955`. The iTunes Lookup API will return the RSS feed URL, and the RSS parser will pull all episodes with titles and audio enclosure URLs. The import modal will show the full episode list with checkboxes. This part works.

### What breaks — 3 critical gaps

**Gap 1: Transcript never reaches the resource**
After import, each episode is stored as a resource with a URL (the audio enclosure). When transcription runs via `processAudioResource`, the transcript lands in `audio_jobs.transcript_text` — but it is **never written back** to `resources.content`. The `extract-tactics` edge function reads from `resources.content`, so it finds nothing. KI extraction silently produces zero results.

**Gap 2: 10,000 character content cap**
`extract-tactics` (lines 91–101) truncates content to ~10,000 characters. A 45–60 minute podcast episode produces ~50,000–90,000 characters of transcript. That means ~85% of the content is silently dropped, and KIs only come from the first ~10 minutes of each episode.

**Gap 3: No show-level organization**
Importing all episodes from "Getting to Club" creates dozens of flat resource rows with no grouping by show. No `source_registry` entry is created. No guest names are extracted from episode titles. When you later import a second podcast, everything becomes an undifferentiated pile.

### No auto-trigger gap
There IS actually an auto-trigger — `useAddUrlResource` calls `autoOperationalizeResource` fire-and-forget after import. But it will fail silently because Gap 1 means there's no content to extract from.

---

## Updated Build Plan

### Step 1: Transcript writeback in audioOrchestrator
**File:** `src/lib/salesBrain/audioOrchestrator.ts`

After successful transcription in `transcribeDirectAudio` (around line 348), add:
- Write `transcript_text` to `resources.content` and `resources.cleaned_content`
- Set `resources.extraction_method = 'audio_transcription'`
- Set `resources.content_status = 'enriched'`
- Then call `autoOperationalizeResource(resourceId)` to trigger KI extraction

This closes the pipeline: import → transcribe → writeback → extract KIs.

### Step 2: Chunked extraction in extract-tactics
**File:** `supabase/functions/extract-tactics/index.ts`

Replace the 10k truncation (lines 89–101) with:
- If content < 12,000 chars: single-pass (as today)
- If content > 12,000 chars: split into ~8,000 char chunks on paragraph boundaries with 500 char overlap
- Run the AI extraction prompt on each chunk sequentially (to avoid rate limiting)
- Include chunk position in user prompt: "Chunk 2 of 5"
- Request 2–4 plays per chunk (not 2–6)
- After all chunks: deduplicate by title similarity (lowercase, strip punctuation, >60% shared words = duplicate — keep the one with longer `source_excerpt`)
- Cap total at 12–15 KIs per resource
- Add `source_location` chunk reference
- On 429: retry once after 2s, skip chunk if retry fails
- Return `chunks_total`, `chunks_processed`, `chunks_failed` alongside `items`

### Step 3: Enrich import-podcast with show + episode metadata
**File:** `supabase/functions/import-podcast/index.ts`

- Extract from RSS: `<itunes:author>`, `<itunes:duration>`, `<pubDate>`, `<description>` per episode
- Extract show-level: `<title>` (channel), `<itunes:author>`, `<description>`, `<itunes:image>`
- Return show metadata in response: `{ show_title, show_author, show_description, show_image }`
- Return per-episode: `{ title, url, description, duration, published, episode_number }`
- Parse guest names from episode titles using common patterns (`"X | Y"`, `"X with Y"`, `"X feat. Y"`)
- Support single-episode import: detect `?i=` parameter, use iTunes episode lookup to filter to just that episode

### Step 4: Auto-create source_registry entry per podcast
**File:** `src/components/prep/PodcastImportModal.tsx`

- After fetching episodes, upsert a `source_registry` row with `name = show_title`, `source_type = 'podcast_rss'`, `url = RSS feed URL`, `metadata = { show_author, show_description, episode_count }`
- Link every imported episode's `source_registry_id` to this entry
- Populate `resources.author_or_speaker` from parsed guest name

### Step 5: Add podcast/speaker filters
**Files:** Resource list and KI list components

- Filter resources by `source_registry_id` (show)
- Filter resources by `author_or_speaker`
- Filter KIs by `who` and source podcast

---

## Technical Details

- No new database tables or columns needed — `source_registry`, `resources.source_registry_id`, `resources.author_or_speaker` all exist
- Edge functions `extract-tactics` and `import-podcast` need redeployment
- Gemini 2.5 Flash supports ~1M token context; chunking is for extraction quality, not model limits — focused chunks produce better attribution
- Sequential chunk processing to avoid rate limiting on the AI gateway

