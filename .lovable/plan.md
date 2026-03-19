

## Plan: Deep Content-Aware Resource Reclassification, Deduplication & Folder Cleanup

### The Problem

74 resources across 29 folders. 41 unique URLs but 33 duplicates. Titles are generic guesses — the classifier never read the actual document content. Examples:
- A doc about "Sales Differentiation" strategy is stored 3 times with titles like "MEDDPICC Sales Qualification Framework", "MEDDICC Discovery Questions", and "MEDDICC Framework Overview" — none of which describe what's actually in it
- A Google Sheet about "Next Steps - How To Guide the Buying Process" is called "Google Sheets - Formulas and Functions Reference"
- Pavilion training recordings have no source attribution

### Solution: 3-Part Fix

**Part 1: Script — Fetch, read, and reclassify every resource (lov-exec)**

For each unique URL in the `resources` table:
1. Use `fetch_website` (via Python `requests`) to scrape the actual content from Google Docs/Sheets/Slides/Zoom pages
2. Send the real content to AI with a prompt that extracts:
   - **Accurate title** based on what the document actually says (not the URL pattern)
   - **Source/author** extracted from the URL domain or content (e.g., "Pavilion" from `joinpavilion.zoom.us`, "SamSales" from `samsales-shorts.thinkific.com`, or author names found in the doc)
   - **Proper resource type** and **tags** based on actual content
   - **Folder assignment** mapped to one of 8 consolidated folders
3. Format titles as: `"Descriptive Title — Source"` (e.g., "Sales Differentiation: 6 Categories of Competitive Advantage — Lee Salz")
4. Delete all duplicate rows (keep newest per URL)
5. Consolidate 29 folders → 8: Frameworks, Playbooks, Templates, Training, Presentations, Discovery, Personas, Tools & Reference
6. Update all resources with new titles, descriptions, tags, types, and folder assignments

**Part 2: Duplicate detection hook — `src/hooks/useResourceDuplicates.ts`**

New hook reusing `normalize`/`levenshtein`/`isSimilar` patterns from `useDuplicateDetection.ts`:
- `useResourceDuplicates()` — groups all resources by exact `file_url` match or fuzzy title similarity
- `useCheckDuplicate(title, url)` — checks a single incoming resource against existing ones

**Part 3: UI changes**

- **`src/components/prep/DuplicateResourcesModal.tsx`** — New modal showing duplicate groups with radio selection to keep one per group, bulk delete the rest
- **`src/components/prep/ResourceManager.tsx`** — Add "Find Duplicates" toolbar button with badge count; add yellow warning banner in upload confirmation dialog when a match is detected; show source attribution as a subtle badge on resource rows

### Execution Order

1. Run the deep reclassification script first (one-time, ~2 min for 41 URLs)
2. Apply code changes for ongoing duplicate detection

### Technical Details

- Script uses Firecrawl edge function (already deployed) to fetch Google Doc content, falling back to direct `requests` fetch
- AI reclassification uses the AI gateway script (`lovable_ai.py`) with structured output via `--schema`
- Folder consolidation: create 8 folders, UPDATE resources SET folder_id, DELETE empty old folders
- Duplicate deletion: `ROW_NUMBER() OVER (PARTITION BY file_url ORDER BY updated_at DESC)`, delete where rn > 1
- `DuplicateResourcesModal` reuses the same group/radio/bulk-delete pattern from `DuplicateDetector.tsx`

