

# Three Changes

## 1. Show "Last Updated" on mobile

**File**: `src/components/Layout.tsx` (line 251)

The build timestamp currently has `hidden sm:inline`, hiding it on mobile. Change to `inline` so it's always visible. Shorten the text on mobile to just the relative time (no "Updated" prefix) to save space.

## 2. Raise YouTube playlist cap to 1,000

The current bottleneck is Firecrawl — it scrapes the playlist page and only sees the videos loaded in the initial HTML (~100). To get up to 1,000 videos:

**File**: `supabase/functions/import-youtube-playlist/index.ts`
- Switch from single `scrape` to using Firecrawl's `scrape` with `scrollToBottom` or multiple paginated fetches
- Alternatively, use the YouTube Data API v3 `playlistItems.list` endpoint (supports pagination via `nextPageToken`, 50 items per page, up to 1,000 with 20 pages) — this is more reliable than scraping
- This requires a YouTube API key. Check if one exists, otherwise ask the user to add one.

Actually, let me reconsider. Firecrawl has `actions` support for scrolling. The simpler reliable path: use YouTube's RSS/API or Firecrawl with scroll actions to load more videos.

**Better approach**: Use Firecrawl with `actions: [{ type: "scroll", direction: "down", amount: 10000 }]` repeated multiple times to force-load more videos on the playlist page. This avoids needing a new API key.

**File**: `src/components/prep/PlaylistImportModal.tsx`
- Remove any client-side cap (there isn't one explicitly, but the edge function limits what comes back)

## 3. Podcast import (Apple Podcasts + Spotify) — up to 1,000

Create a new edge function and modal for podcast imports:

**New file**: `supabase/functions/import-podcast/index.ts`
- Accept a podcast URL (Apple Podcasts or Spotify show URL)
- For Apple Podcasts: use the iTunes Search/Lookup API (`https://itunes.apple.com/lookup?id=...&entity=podcastEpisode&limit=200`) — free, no API key. Paginate with offset to get up to 1,000.
- For Spotify: scrape the show page via Firecrawl to extract episode links and titles (Spotify API requires OAuth which is heavy for this use case)
- Return `{ success: true, episodes: [{ title, url }] }`

**New file**: `src/components/prep/PodcastImportModal.tsx`
- Similar UI to `PlaylistImportModal` — paste URL, fetch episodes, select/deselect, import with progress bar
- Support both Apple Podcasts and Spotify show URLs
- Icon: `Podcast` from lucide

**File**: `src/components/prep/ResourceManager.tsx` (or wherever the import menu lives)
- Add "Import Podcast" option alongside the existing YouTube playlist and webpage import options

---

## Technical Details

### YouTube 1,000 cap
Firecrawl's single scrape only gets initially-rendered videos (~100). To get more:
- Use Firecrawl `actions` to scroll the page multiple times before extracting links
- Each scroll loads ~20-30 more videos; 30+ scrolls should surface up to 1,000
- oEmbed title fetching stays the same but batch size increases to 30 for speed

### Apple Podcasts
- iTunes Lookup API: `https://itunes.apple.com/lookup?id={PODCAST_ID}&entity=podcastEpisode&limit=200`
- Max 200 per request. For more, the podcast's RSS feed URL is returned in the lookup response — parse the RSS XML to get all episodes (RSS feeds typically contain the full catalog)
- Extract RSS feed URL from iTunes API response, then fetch and parse the RSS XML for complete episode list

### Spotify
- Scrape via Firecrawl with scroll actions to load episode list
- Extract episode titles and Spotify URLs
- Each episode URL pattern: `https://open.spotify.com/episode/...`

### Files changed/created

| File | Change |
|------|--------|
| `src/components/Layout.tsx` | Remove `hidden sm:` from build timestamp |
| `supabase/functions/import-youtube-playlist/index.ts` | Add scroll actions, raise cap to 1,000 |
| `supabase/functions/import-podcast/index.ts` | New — fetch episodes from Apple/Spotify |
| `src/components/prep/PodcastImportModal.tsx` | New — podcast import UI |
| `src/components/prep/PlaylistImportModal.tsx` | Update count labels |
| Resource manager/menu file | Add podcast import trigger |

