

## Plan: Improve YouTube Playlist Import with oEmbed Title Resolution

### Problem
The current Firecrawl-based scraping extracts video URLs correctly but produces junk titles (timestamps, "Now playing" markers) from the scraped markdown.

### Solution
After extracting video URLs via Firecrawl, use YouTube's free **oEmbed API** (`https://www.youtube.com/oembed?url=...&format=json`) to fetch the real title for each video. No API key required.

### Changes

**File: `supabase/functions/import-youtube-playlist/index.ts`**

1. Remove all the markdown-based title extraction logic (the regex patterns parsing `[title](url)` and line-by-line scanning)
2. After collecting deduplicated video URLs from Firecrawl links, call YouTube oEmbed in parallel batches of 5:
   ```
   GET https://www.youtube.com/oembed?url=${videoUrl}&format=json
   → { title: "Actual Video Title", author_name: "Channel" }
   ```
3. Use oEmbed title as primary; fall back to "Video N" only if oEmbed fails
4. Filter out any link whose text matches junk patterns like "PLAY ALL"

Single file change. No frontend modifications needed.

