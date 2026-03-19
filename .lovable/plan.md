

## Plan: AI Resource Discovery & Competitive Intelligence Engine

### What This Adds

A new "AI Discovery" feature in the Prep Hub's Resource Manager that lets you:
1. **Search & discover** elite sales resources (books, podcasts, YouTube videos, articles) via AI-powered web search
2. **Deep-scrape competitors** — crawl an entire website (e.g., Klaviyo.com) including help docs, and compile a structured competitive intelligence battlecard
3. Auto-classify, organize, and save all discovered resources into the existing folder/tag system

### Architecture

```text
┌─────────────────────────────────┐
│   ResourceManager.tsx           │
│   ┌───────────────────────────┐ │
│   │ "AI Discover" button      │ │
│   │  ┌─────────────────────┐  │ │
│   │  │ Mode: Resources     │  │ │
│   │  │ "Find top 1% cold   │  │ │
│   │  │  calling resources"  │  │ │
│   │  ├─────────────────────┤  │ │
│   │  │ Mode: Competitor    │  │ │
│   │  │ Intel               │  │ │
│   │  │ "Scrape klaviyo.com │  │ │
│   │  │  — build battlecard"│  │ │
│   │  └─────────────────────┘  │ │
│   └───────────────────────────┘ │
└─────────┬───────────────────────┘
          │ supabase.functions.invoke
          ▼
┌─────────────────────────────────┐
│ Edge: discover-resources        │
│                                 │
│ Mode A: Resource Search         │
│  1. Perplexity search (sonar)   │
│  2. AI ranks & curates results  │
│  3. Returns structured list     │
│                                 │
│ Mode B: Competitor Intel        │
│  1. Firecrawl /map → get URLs   │
│  2. Firecrawl /crawl key pages  │
│  3. AI synthesizes battlecard   │
│  4. Returns battlecard + sources│
└─────────────────────────────────┘
```

### Files Changed

**1. New edge function: `supabase/functions/discover-resources/index.ts`**

Two modes via `type` param:

- **`resource-search`**: Takes a natural language query (e.g., "best enterprise sales books and podcasts for complex deal cycles"). Uses Perplexity `sonar-pro` to find high-quality resources across the web. Then passes results through Lovable AI (Gemini) to curate the top items with structured metadata (title, URL, description, resource_type, tags, suggested_folder). Returns an array of classified resources ready for the batch review panel.

- **`competitor-intel`**: Takes a company name + website URL + optional context (your product, your ICP). Uses Firecrawl `/map` to discover all pages on the site, then `/crawl` on the most relevant pages (product, pricing, features, help docs — up to 50 pages). Feeds the crawled content to Lovable AI (Gemini 2.5 Pro for the large context) with a battlecard-generation prompt. Returns a structured battlecard (strengths, weaknesses, pricing, common objections, how to pitch against them) plus source URLs. The battlecard is saved as a `battlecard` resource type.

**2. Updated: `src/components/prep/ResourceManager.tsx`**

- Add an "AI Discover" button to the toolbar (next to Reorganize)
- Opens a dialog with two tabs: "Find Resources" and "Competitor Intel"
  - **Find Resources tab**: Textarea for a natural language prompt (e.g., "Top 1% cold calling techniques, podcasts, and frameworks for enterprise SaaS"). Submit triggers the edge function. Results flow into the existing `pendingItems` batch review panel with editable titles before saving.
  - **Competitor Intel tab**: Input for company name + website URL. Optional textarea for context ("I sell X, my prospect uses Klaviyo for Y"). Submit triggers crawl. Shows a progress indicator. Result creates a battlecard resource with the full analysis as content.

**3. Updated: `supabase/config.toml`**

- Add `[functions.discover-resources]` with `verify_jwt = false`

### Edge Function Details

**Resource Search flow:**
1. Call Perplexity search API with the user's query, using `sonar-pro` for multi-step reasoning
2. Get back ~10 results with URLs, titles, descriptions
3. Pass results to Gemini 2.5 Flash via Lovable AI gateway with tool calling to return structured `ClassificationResult[]` (title, description, resource_type, tags, suggested_folder)
4. Return the curated list to the frontend

**Competitor Intel flow:**
1. Firecrawl `/map` the competitor website to discover all URLs (limit 200)
2. Filter URLs to prioritize: product pages, pricing, features, integrations, help/docs, about, case studies
3. Firecrawl `/crawl` the filtered URLs (limit 50 pages)
4. Feed all crawled markdown to Gemini 2.5 Pro (handles large context) with a structured battlecard prompt
5. Use tool calling to extract: company overview, product capabilities, pricing model, target market, strengths, weaknesses, common objections buyers raise, how to position against them, key differentiators, and source URLs
6. Return as a single battlecard document

### UI Flow

```text
User clicks "AI Discover" →
├─ Tab 1: Find Resources
│   "Find the best MEDDICC training resources,
│    podcasts, and books for enterprise sales"
│   [Discover →]
│   → Results appear in batch review panel
│   → User edits titles, confirms all
│
├─ Tab 2: Competitor Intel
│   Company: [Klaviyo]
│   Website: [https://klaviyo.com]
│   Context: [I sell Attentive, prospect uses
│             Klaviyo for email/SMS marketing]
│   [Build Battlecard →]
│   → Progress bar during crawl
│   → Battlecard saved to "Battlecards" folder
│   → Opens in ResourceEditor for review
```

### Secrets Required
All secrets are already configured:
- `PERPLEXITY_API_KEY` — for web search
- `FIRECRAWL_API_KEY` — for website crawling
- `LOVABLE_API_KEY` — for AI synthesis

