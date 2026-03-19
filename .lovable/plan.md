

## Plan: Webpage Link Import (Toolkit/Resource Page Scraper)

### Problem
You want to bulk-import all the resource links from pages like `30mpc.com/toolkit`. The current Playlist Import only handles YouTube. This page has 80+ unique blog/tactics links across categories that should each become a resource.

### Solution
Build a **Webpage Import Modal** that uses Firecrawl to scrape any URL, extracts all meaningful links with their titles, lets you select which ones to import, then classifies and saves each one sequentially (same pattern as the playlist importer).

### Changes

**1. New Edge Function: `supabase/functions/import-webpage-links/index.ts`**
- Accepts a URL, calls Firecrawl with `formats: ['links', 'markdown']`
- Parses the markdown to extract `[title](url)` pairs for clean link titles
- Deduplicates by URL, filters out navigation/social/image links (CDN assets, `#` anchors, social media, same-page links)
- Groups links by section headings if present (Prospecting, Closing, etc.)
- Returns `{ success: true, links: [{ title, url, category? }] }`

**2. New Component: `src/components/prep/WebpageImportModal.tsx`**
- Same UX pattern as `PlaylistImportModal`: paste URL, fetch, select, import
- Shows extracted links with checkboxes, grouped by category when available
- Select All / Deselect All toggle
- Sequential import with progress bar (classify + add each URL)
- Reuses `useClassifyResource` and `useAddUrlResource` hooks

**3. Update: `src/components/prep/ResourceManager.tsx`**
- Add a "Import from Webpage" option in the existing dropdown/menu (next to the YouTube Playlist Import trigger)
- Wire up the new `WebpageImportModal`

### Link Filtering Logic
The edge function will exclude:
- Links to `#` (same-page anchors with no path)
- CDN/image URLs (`cdn.prod.website-files.com`, `.svg`, `.png`, `.avif`)
- Social media links (twitter, linkedin, instagram, facebook share URLs)
- Navigation links (privacy policy, sponsors, etc.)
- Duplicate URLs (keep first occurrence with best title)

For the 30MPC toolkit specifically, each resource appears twice (one `tactics.30mpc.com` link, one `30mpc.com/blog` link). The dedup logic will prefer the `blog` URL since it's the actual content page.

### Technical Details
- Edge function uses Firecrawl's `links` format for URL extraction + `markdown` format for title extraction via regex on `[title](url)` patterns
- Batch size: sequential import (1 at a time) to avoid overwhelming classify-resource edge function
- No new database tables needed

