

## Deep Content Ingestion Pipeline — Weapon-Grade Implementation

### The Problem in One Sentence

Every URL resource stores `[External Link: URL]` as content, so Operationalize hallucinates, Build Resource generates filler, and your 100+ imported resources are decorative bookmarks instead of weapons.

### What Gets Built (9 Changes)

#### 1. Database Migration — `content_status` Column

Add `content_status TEXT NOT NULL DEFAULT 'file'` to `resources`. Backfill existing rows: `'placeholder'` where content matches `[External Link:%`, `'file'` for everything else. Values: `placeholder`, `enriching`, `enriched`, `manual`, `file`.

#### 2. New Edge Function: `enrich-resource-content`

Source-aware Firecrawl scraping (15K char cap). Two modes:

- **Single**: `{ resource_id }` — enriches one resource
- **Batch**: `{ batch: true, limit?: 50 }` — queries all `content_status = 'placeholder'` resources with HTTP URLs, processes sequentially with 1s delay between scrapes

Source detection:
- **YouTube**: `waitFor: 5000`, captures description, chapters, transcript text
- **Podcast** (Spotify/Apple): `waitFor: 5000` for JS-heavy show notes
- **Generic web**: `onlyMainContent: true`, standard markdown
- **Auth-gated**: skip, keep `placeholder` status

After each scrape: updates `resources.content`, sets `content_status = 'enriched'`, deletes stale `resource_digests` so Operationalize re-runs fresh.

#### 3. Patch `classify-resource`

Line 111 truncates to 3K and discards. Return full `scraped_content` (up to 15K) in the response JSON alongside classification fields. Zero extra API calls — data already fetched.

#### 4. Patch `useAddUrlResource` Hook

- Accept `scraped_content` from classification response, store as `resource.content`
- Set `content_status` accordingly
- Fire-and-forget call to `enrich-resource-content` for deeper 15K background scrape

#### 5. Patch `operationalize-resource` — Auto-Enrich + Template Extraction

Before AI analysis: if content is placeholder and `file_url` is HTTP, scrape via Firecrawl inline, update DB, then proceed.

Expand the extraction schema to include `template_sections` — structured methodology steps that can seed a template (section name, purpose, example content). This makes Operationalize produce template-ready intelligence, not just generic takeaways.

#### 6. Patch `build-resource` — Add `template` Transform Type

New transform prompt that extracts the methodology/framework from content and produces a reusable Markdown template with `{{placeholder}}` variables, section headings from the source framework, guidance notes, and example content. This is the "watch a video about executive business cases → get a fill-in-the-blank template" use case.

Also improve all existing transform prompts: "Extract specific techniques, frameworks, and phrases from THIS content — not generic advice."

#### 7. Patch `suggest-resource-uses` — Content-Aware Suggestions

Currently only sends title/type/tags/description (line 55-57). Add first 2K chars of `resource.content` to the summary so suggestions are substance-based, not superficial.

#### 8. UI: ResourceManager.tsx — Enrichment Status + Bulk Enrich

- Status indicator on URL resources: spinner for `enriching`, checkmark for `enriched`, warning for `placeholder`
- "Enrich Content" dropdown action for individual placeholder resources
- **"Bulk Enrich All"** toolbar button — calls batch mode, shows progress toast, auto-enriches every existing placeholder resource in one click
- After bulk enrich completes, toast with count of enriched/failed

#### 9. Config

Add `enrich-resource-content` entry to `supabase/config.toml` with `verify_jwt = false`.

### Files Changed

| File | Change |
|------|--------|
| Migration | Add `content_status` column, backfill existing rows |
| `supabase/functions/enrich-resource-content/index.ts` | **NEW** — source-aware scraping with batch mode |
| `supabase/config.toml` | Add entry |
| `supabase/functions/classify-resource/index.ts` | Return full `scraped_content` in response |
| `supabase/functions/operationalize-resource/index.ts` | Auto-enrich + `template_sections` extraction |
| `supabase/functions/build-resource/index.ts` | Add `template` targetType, sharpen all prompts |
| `supabase/functions/suggest-resource-uses/index.ts` | Include content in AI context |
| `src/hooks/useResourceUpload.ts` | Persist scraped content, background enrich, content_status |
| `src/components/prep/ResourceManager.tsx` | Status badges, Enrich button, Bulk Enrich All |

### End-to-End: "Executive Business Case" Video

1. **Import** YouTube link → classify picks folder/tags fast, scraped content stored immediately
2. **Background enrich** captures 15K of description, chapters, transcript
3. **Operationalize** extracts "5-component executive business case framework" as specific takeaways + `template_sections` with methodology steps
4. **Transform → Template** produces a reusable business case doc with `{{company}}`, `{{pain_points}}`, `{{ROI_metrics}}`, `{{executive_sponsor}}` drawn from the actual methodology
5. **Transform → Checklist** produces exact pre-meeting steps from the video
6. **Grade Transcript** uses real scoring criteria from the methodology
7. **Suggest Uses** recommends "templatize for your Q2 enterprise deals" based on actual content
8. **Bulk Enrich All** — one click backfills every existing placeholder resource, then each becomes available for all the above

