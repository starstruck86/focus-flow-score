

## Plan: Fix Classification to Scrape URLs + Add Inline Rename for Resources

Two changes: (1) make the classify-resource edge function actually fetch page content before classifying, and (2) add a "Rename" option to each resource's dropdown menu plus an editable title in the classification confirmation panel.

### Part 1: Edge Function — Scrape URL Before Classifying

**File: `supabase/functions/classify-resource/index.ts`**

When a `url` is provided, before calling the AI:
1. Call Firecrawl API (`https://api.firecrawl.dev/v1/scrape`) with the URL to get markdown content + metadata
2. Extract `metadata.title` as the ground-truth page title
3. Pass the page title and first 3000 chars of markdown to the AI prompt, clearly separated:
   ```
   PAGE TITLE (ground truth — use as primary name): "ESS Class #3: ..."
   PAGE CONTENT (for context only): ...first 3000 chars...
   URL: https://...
   ```
4. If Firecrawl fails (auth wall, timeout), fall back to URL-only classification as today

This uses the existing `FIRECRAWL_API_KEY` secret.

### Part 2: Inline Resource Rename

**File: `src/components/prep/ResourceManager.tsx`**

1. Add a "Rename" option to the resource row's `...` dropdown menu (between Edit and Version History)
2. Clicking it opens a small inline edit state (similar to folder rename) — shows an Input pre-filled with the current title
3. On confirm, calls `useUpdateResource` to update the title
4. Also make the title in the classification confirmation panel editable (replace the static `<span>` with an `<Input>`) so users can correct AI-suggested titles before saving

### Part 3: One-time fix for existing misnamed resources

Run a `lov-exec` script that:
1. Queries all resources with external URLs (`file_url LIKE 'http%'`)
2. For each, calls the updated `classify-resource` edge function (which now scrapes via Firecrawl)
3. Updates only the `title` and `description` in the database with the corrected values
4. Logs before/after for review

### Files Changed

- `supabase/functions/classify-resource/index.ts` — Add Firecrawl scrape step
- `src/components/prep/ResourceManager.tsx` — Add Rename dropdown item + editable title in classification panel

