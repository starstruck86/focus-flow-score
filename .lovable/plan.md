

## Plan: Fix Build Error + Add YouTube Playlist Import

Two items to address: a blocking build error and the YouTube playlist import feature.

---

### Part 1: Fix Build Error

The `RichTextEditor.tsx` imports 4 TipTap packages not listed in `package.json`:
- `@tiptap/extension-table-row`
- `@tiptap/extension-placeholder`
- `@tiptap/extension-task-list`
- `@tiptap/extension-task-item`

**Fix**: Add all four as dependencies in `package.json` at the same version (`^3.20.4`) as the other TipTap packages already listed.

---

### Part 2: YouTube Playlist Import

Build a feature in the Resources tab that accepts a YouTube playlist URL, scrapes it for video links via Firecrawl (already connected), classifies each video, and bulk-adds them as resources.

**How it works:**

1. User clicks "Import Playlist" button in ResourceManager (or a new icon button in the header)
2. A modal opens with a URL input field
3. On submit, the app calls a new `import-youtube-playlist` edge function that:
   - Uses Firecrawl's **scrape** endpoint on the playlist URL with `formats: ['links', 'markdown']`
   - Extracts all YouTube video URLs and their titles from the scraped content
   - Returns the list of `{ title, url }` pairs
4. The frontend displays a preview list with checkboxes so the user can deselect unwanted videos
5. On confirm, each selected video is added as a URL resource via the existing `useAddUrlResource` hook (which handles classification and folder assignment automatically)
6. Progress indicator shows how many have been processed

**Files:**

| Action | File | Change |
|--------|------|--------|
| Add deps | `package.json` | Add 4 missing TipTap packages |
| Create | `supabase/functions/import-youtube-playlist/index.ts` | Scrape playlist via Firecrawl, extract video URLs + titles |
| Create | `src/components/prep/PlaylistImportModal.tsx` | Modal with URL input, preview list, confirm button |
| Update | `src/components/prep/ResourceManager.tsx` | Add "Import Playlist" button to header |
| Update | `supabase/config.toml` | Add `[functions.import-youtube-playlist]` |

**Edge function logic:**
- Calls Firecrawl scrape on the playlist URL with `formats: ['markdown', 'links']`
- Filters links to only YouTube video URLs (`youtube.com/watch`, `youtu.be/`)
- Extracts titles from the markdown content (playlist pages list video titles)
- Returns deduplicated `{ title, url }[]` array

**Modal UI:**
```text
┌─────────────────────────────────────────┐
│ Import YouTube Playlist                 │
├─────────────────────────────────────────┤
│ Paste playlist URL:                     │
│ [https://youtube.com/playlist?list=...] │
│                              [Fetch]    │
│                                         │
│ Found 12 videos:                        │
│ ☑ How to Build ROI Decks               │
│ ☑ MEDDICC Masterclass Part 1            │
│ ☑ Cold Call Framework                   │
│ ☐ Channel Intro (deselected)            │
│ ...                                     │
│                                         │
│           [Cancel]  [Import 11 Videos]  │
└─────────────────────────────────────────┘
```

