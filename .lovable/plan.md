

# Consolidated Podcast Queue Pipeline — Final Plan

## What's already approved (recap)
- Rewrite `process-podcast-queue` to use `resolve-podcast-episode` → `transcribe-audio` instead of `classify-resource`
- Add content validation gate (HTML/CSS/bot rejection)
- Add `platform`, `transcript_status`, `failure_type`, `content_validation` columns
- Smart retry by failure type
- Remove `firecrawlScrape` from podcast method chain in `enrich-resource-content`
- Add HTML/CSS guard to `batch-actionize` Step 0
- Auto-trigger KI extraction after successful import
- Add `ki_status` and `ki_count` tracking
- Update UI for all new fields

## What's still missing — 3 gaps

### Gap 1: Podcast transcripts are terrible for KI extraction without preprocessing

The `extract-tactics` prompt (line 8-46 of `extract-tactics/index.ts`) expects structured written content — articles, books, training material. It asks for "source_excerpt" verbatim quotes and "source_location" section headings.

Raw podcast transcripts are **unstructured conversational speech**: no headings, no sections, run-on paragraphs, filler words, topic-jumping. The chunking (8000 chars with 500 overlap) will split mid-sentence, mid-thought. The AI will either:
- Extract vague, generic KIs ("build rapport with prospects")
- Hallucinate structure that doesn't exist in the transcript
- Return zero items because nothing matches the quality gates

**Fix**: Add a **transcript preprocessing step** between transcription and KI extraction. Before calling `batch-actionize`, run the transcript through an AI pass that:
1. Segments the conversation into topical sections with generated headings
2. Strips filler ("um", "you know", "like", "right")
3. Identifies speaker turns (host vs guest) using conversation patterns
4. Produces a structured document with `## Section Heading` markers and clean paragraphs

This gives `extract-tactics` content it can actually work with — section headings to reference, clean quotes to excerpt, coherent paragraphs to chunk on.

**Implementation**: New edge function `preprocess-transcript` that takes raw transcript text and returns structured markdown. Called by `process-podcast-queue` after transcription succeeds, before saving to the resource. ~200 lines, uses Gemini 2.5 Flash.

### Gap 2: Podcast episodes are long — 12K char cap truncates 90% of content

`batch-actionize` line 652: `content: content.slice(0, 12000)`. A 45-minute podcast transcript is ~30,000-50,000 characters. You're throwing away 60-75% of the episode.

The chunking in `extract-tactics` (8K chunks, max 15 KIs per resource) partially handles this, but `batch-actionize` pre-truncates before `extract-tactics` even sees the full content.

**Fix**: For podcast/transcript resources, pass the full content (up to `CONTENT_CAP` = 60K) to `extract-tactics` instead of truncating at 12K. The chunking system in `extract-tactics` already handles splitting — let it work. Add a content-type check in `batch-actionize`:

```text
Line 652: content.slice(0, resource.resource_type === 'transcript' ? 60000 : 12000)
```

### Gap 3: No dedup across episodes from the same show

If you import 600 episodes of a sales podcast, many episodes will contain overlapping tactics. The current intra-batch dedup in `batch-actionize` only catches duplicates within a single batch run. Episode 1 produces "Use cost-of-inaction framing" and episode 47 produces the same tactic — both get saved because they ran in different cron cycles.

**Fix**: The existing `isContentDuplicate` function (line ~47 of batch-actionize) compares against `existingKIContents` loaded from the DB. This already provides cross-batch dedup for KIs — **but only if the content pool is loaded correctly**. Verify that `existingKIContents` includes all existing KIs for the user, not just the current batch. If it does, this is already handled. If not, extend the initial load query.

## Revised step list (8 steps)

### Step 1: Migration
Add to `podcast_import_queue`:
- `platform text`
- `transcript_status text default 'pending'`
- `failure_type text`
- `content_validation jsonb`
- `ki_status text default 'pending'`
- `ki_count int default 0`

### Step 2: Create `preprocess-transcript` edge function
- Input: raw transcript text, optional episode metadata (title, guest, show)
- Uses Gemini 2.5 Flash to: segment into topics with headings, strip filler, identify speakers, produce structured markdown
- Output: cleaned structured transcript
- ~200 lines

### Step 3: Rewrite `process-podcast-queue`
Full pipeline per item:
1. Claim (FOR UPDATE SKIP LOCKED)
2. Dedup check
3. Detect platform, set `transcript_status = 'resolving_link'`
4. Call `resolve-podcast-episode`
5. If audio found → `transcript_status = 'transcribing'` → call `transcribe-audio`
6. Validate transcript (HTML/CSS/bot/length gate)
7. Call `preprocess-transcript` to structure the raw transcript
8. Save resource with structured content, `content_status = 'enriched'`
9. Skip `enrich-resource-content` (transcript already clean)
10. Call `batch-actionize` for this resource → update `ki_status`, `ki_count`
11. Mark queue item complete

### Step 4: Add content validation guard to `batch-actionize`
At Step 0 (line 498), after length check:
- Reject HTML tags, CSS, bot/login text patterns
- `terminal_state = 'content_missing'`, `failure_reasons = ['content_invalid_html']`

### Step 5: Raise content cap for transcripts in `batch-actionize`
Line 652: pass full content (up to 60K) for transcript-type resources instead of truncating at 12K.

### Step 6: Remove Firecrawl fallback from podcast chain
`enrich-resource-content` line 2284: change `[podcastResolveAndTranscribe, directAudioTranscribe, firecrawlScrape]` → `[podcastResolveAndTranscribe, directAudioTranscribe]`

### Step 7: Update hook + UI
- `usePodcastQueue.ts`: extend types for all new columns, detect platform at enqueue
- `PodcastQueueProgress.tsx`: show platform, transcript status, KI status/count, failure type per item
- `PodcastQueueIndicator.tsx`: show aggregate KI count

### Step 8: Verify cross-batch KI dedup
Check that `batch-actionize`'s initial content pool load includes all existing user KIs, not just current batch. Fix if needed.

## Files changed
1. New migration SQL
2. **New**: `supabase/functions/preprocess-transcript/index.ts`
3. `supabase/functions/process-podcast-queue/index.ts` — major rewrite
4. `supabase/functions/batch-actionize/index.ts` — content guard + transcript cap
5. `supabase/functions/enrich-resource-content/index.ts` — remove firecrawl from podcast chain
6. `src/hooks/usePodcastQueue.ts` — extend types
7. `src/components/prep/PodcastQueueProgress.tsx` — richer display
8. `src/components/prep/PodcastQueueIndicator.tsx` — KI counts

## Why this matters

Without Gap 1 (preprocessing), you'll get garbage KIs from conversational transcripts — the AI can't extract structured tactical plays from "yeah so like the thing I always tell people is you gotta like really understand their pain right". 

Without Gap 2 (content cap), you lose 60-75% of every episode before KI extraction even starts. A 45-minute episode gets truncated to the first ~8 minutes.

Without Gap 3 verification, importing 600 episodes of the same show will produce massive KI duplication across episodes.

