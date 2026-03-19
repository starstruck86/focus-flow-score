

## Plan: Fix Resource Naming with True Page-Title Extraction

### The Real Problem

The AI classifier is ignoring the actual page title from scraped HTML and instead hallucinating titles from partial transcript/body text. Proof:

- **Zoom recording page title**: "ESS Class #5: Mastering Your Message"
- **What we named it**: "Recruiting Account Executives in a Challenging Market"
- The user's screenshot confirms the actual content is "Class #3: Income and Business Planning"

This means the previous reclassification script fed the entire scraped page (including transcript text, Zoom nav chrome, etc.) to the AI without instructing it to prioritize the actual page title. The AI then guessed topic names from body text.

This likely affects all 5 Pavilion Zoom recordings and potentially other resources too.

### Solution: Two-Part Fix

**Part 1: Re-scrape and fix all resource titles via script (lov-exec)**

Run a script that:
1. Fetches each resource URL using `fetch_website`
2. **Extracts the actual HTML page title first** — for Zoom recordings this is the `<h1>` or `<title>` tag (e.g., "ESS Class #5: Mastering Your Message")
3. Sends the page title + first 500 chars of body to AI with strict instructions: "The page title is the ground truth. Use it as the primary source for naming. Only supplement with body content for context."
4. For Zoom recordings specifically, also extracts the date and instructor name from the page
5. Updates resources with corrected titles formatted as: `"ESS Class #5: Mastering Your Message — Pavilion (Ian Koniak)"`

The script will process all ~42 resources, not just Zoom ones, to ensure Google Docs/Sheets titles are also verified against their actual page titles.

**Part 2: Fix the classify-resource edge function for future uploads**

Update `supabase/functions/classify-resource/index.ts` to add explicit instructions to the AI prompt:
- "If a page title or document title is present in the content, use it as the primary basis for the resource title"
- "Do not infer or guess a topic from body text when a clear title exists"
- "Append source/author attribution after a dash"

### Files Changed

- **1 script** via lov-exec — re-scrapes and corrects all resource titles in the database
- **`supabase/functions/classify-resource/index.ts`** — Updated prompt to prioritize page titles over body content guessing

### What You'll See After

- "Recruiting Account Executives in a Challenging Market — Pavilion" becomes something like "ESS Class #5: Mastering Your Message — Pavilion (Ian Koniak)" (or whatever the actual page title says for that specific URL)
- All other resources verified against their actual document/page titles
- Future uploads will also respect source document titles

