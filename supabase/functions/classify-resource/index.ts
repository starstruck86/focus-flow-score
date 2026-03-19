import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CORE_FOLDERS = [
  "Frameworks",
  "Playbooks",
  "Templates",
  "Training",
  "Discovery",
  "Presentations",
  "Battlecards",
  "Tools & Reference",
] as const;

function isAuthGatedUrl(url: string): boolean {
  const gatedPatterns = [
    /drive\.google\.com/i, /docs\.google\.com/i, /sheets\.google\.com/i,
    /slides\.google\.com/i, /\.zoom\.us\//i, /thinkific\.com/i, /udemy\.com/i,
    /coursera\.org/i, /linkedin\.com\/learning/i, /loom\.com/i, /notion\.so/i,
    /dropbox\.com/i, /onedrive\.live\.com/i, /sharepoint\.com/i,
  ];
  return gatedPatterns.some((p) => p.test(url));
}

function shouldFetchSharedTitleDirectly(url: string): boolean {
  return [/drive\.google\.com/i, /docs\.google\.com/i, /sheets\.google\.com/i, /slides\.google\.com/i].some((p) => p.test(url));
}

function stripProviderSuffix(title: string): string {
  return title
    .replace(/\s*-\s*Google Drive$/i, "").replace(/\s*-\s*Google Docs$/i, "")
    .replace(/\s*-\s*Google Sheets$/i, "").replace(/\s*-\s*Google Slides$/i, "").trim();
}

function extractHtmlTitle(html: string): string {
  const ogTitleMatch = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const titleMatch = html.match(/<title>(.*?)<\/title>/is);
  const candidate = (ogTitleMatch?.[1] || titleMatch?.[1] || "").replace(/\s+/g, " ").trim();
  if (!candidate) return "";
  if (/^(google drive|google docs|google sheets|google slides|sign in|login)$/i.test(candidate)) return "";
  return stripProviderSuffix(candidate);
}

async function fetchDirectPageTitle(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html,application/xhtml+xml" },
    });
    if (!response.ok) return "";
    const html = await response.text();
    return extractHtmlTitle(html);
  } catch (e) {
    console.error("Direct title fetch failed:", e);
    return "";
  }
}

function extractUrlHints(url: string): { type: string; source: string } {
  const urlObj = new URL(url);
  const host = urlObj.hostname.replace('www.', '');
  let type = 'document';
  if (/docs\.google\.com\/document/.test(url)) type = 'document';
  else if (/docs\.google\.com\/spreadsheets/.test(url) || /sheets\.google\.com/.test(url)) type = 'spreadsheet';
  else if (/docs\.google\.com\/presentation/.test(url) || /slides\.google\.com/.test(url)) type = 'presentation';
  else if (/drive\.google\.com\/file/.test(url)) type = 'file';
  else if (/\.zoom\.us\/rec/.test(url)) type = 'recording';
  else if (/thinkific\.com/.test(url)) type = 'training course';
  else if (/loom\.com/.test(url)) type = 'video recording';
  let source = host.split('.')[0];
  if (host.includes('google.com')) source = 'Google Drive';
  else if (host.includes('zoom.us')) {
    const subdomain = host.split('.zoom.us')[0];
    source = subdomain !== 'us02web' ? subdomain : 'Zoom';
  } else if (host.includes('thinkific.com')) {
    const subdomain = host.split('.thinkific.com')[0];
    source = subdomain || 'Thinkific';
  }
  return { type, source };
}

async function scrapeUrl(url: string): Promise<{ pageTitle: string; content: string } | null> {
  const directTitle = shouldFetchSharedTitleDirectly(url) ? await fetchDirectPageTitle(url) : "";
  if (isAuthGatedUrl(url)) {
    console.log("Skipping deep scrape for auth-gated URL:", url);
    return directTitle ? { pageTitle: directTitle, content: "" } : null;
  }
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  if (!FIRECRAWL_API_KEY) {
    console.warn("FIRECRAWL_API_KEY not configured, skipping scrape");
    return directTitle ? { pageTitle: directTitle, content: "" } : null;
  }
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    });
    if (!response.ok) {
      console.error("Firecrawl scrape failed:", response.status);
      return directTitle ? { pageTitle: directTitle, content: "" } : null;
    }
    const data = await response.json();
    const markdown = data.data?.markdown || data.markdown || "";
    const metadata = data.data?.metadata || data.metadata || {};
    const pageTitle = stripProviderSuffix(metadata.title || metadata.ogTitle || directTitle || "");
    return { pageTitle, content: markdown.slice(0, 3000) };
  } catch (e) {
    console.error("Firecrawl scrape error:", e);
    return directTitle ? { pageTitle: directTitle, content: "" } : null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, filename, url, existingTitle, existingTags } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    let scrapedTitle = "";
    let scrapedContent = "";
    let urlHints = "";
    if (url) {
      if (isAuthGatedUrl(url)) {
        const hints = extractUrlHints(url);
        urlHints = `URL TYPE: ${hints.type} (from ${hints.source}). This is an auth-gated link that cannot be scraped. Classify based on the URL pattern, filename hints, and any provided text content. Do NOT use generic titles like "Google Drive" or "Sign In".`;
      }
      const scraped = await scrapeUrl(url);
      if (scraped) {
        scrapedTitle = scraped.pageTitle;
        scrapedContent = scraped.content;
      }
    }

    const contentHint = scrapedContent || text?.slice(0, 3000) || "";

    const prompt = `Classify this sales resource and assign it to the correct folder in our fixed taxonomy.

CORE FOLDER TAXONOMY (you MUST pick one of these for top_folder):
- Frameworks — MEDDICC, SPIN, value selling methodologies
- Playbooks — Repeatable motion guides, sequences
- Templates — Emails, cadences, follow-ups, reusable docs
- Training — Courses, certifications, learning materials
- Discovery — Research briefs, persona maps, ICP docs
- Presentations — Decks, slides, demos
- Battlecards — Competitive intel, objection handling
- Tools & Reference — Links, calculators, misc reference

${scrapedTitle ? `PAGE TITLE (ground truth — use this as the primary basis for the resource title): "${scrapedTitle}"` : ""}
${urlHints ? `\n${urlHints}` : ""}
${filename ? `Filename: ${filename}` : ""}
${url ? `URL: ${url}` : ""}
${existingTitle ? `Current title: ${existingTitle}` : ""}
${existingTags?.length ? `Current tags: ${existingTags.join(", ")}` : ""}

Content preview:
${contentHint}

CRITICAL NAMING RULES:
1. If a PAGE TITLE is provided above, USE IT as the primary basis for the resource title.
2. If no PAGE TITLE is provided but the content contains an explicit document title, heading, or page title, USE IT.
3. For auth-gated URLs with no scraped content: use any available text/filename context. If none, create a descriptive title from the URL path segments and domain. NEVER use "Google Drive", "Sign In", or other login page titles.
4. Append source/author attribution after an em dash (—).
5. Format: "Descriptive Title — Source/Author"
6. For training recordings, include session/class numbers if identifiable.
7. Do NOT hallucinate titles from transcript text or body content fragments.

FOLDER RULES:
1. top_folder MUST be one of the 8 core folders listed above (exact name match).
2. sub_folder is optional — use it for specificity (e.g., "MEDDICC" under Frameworks, "Cold Outreach" under Templates, "ROI Calculators" under Tools & Reference).
3. If no sub_folder is needed, omit it.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "You are a sales resource classifier. Analyze content and return structured classification using the provided tool. Always map resources into the 8-folder taxonomy.",
          },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "classify_resource",
              description: "Return structured classification for a sales resource",
              parameters: {
                type: "object",
                properties: {
                  title: {
                    type: "string",
                    description: "Clean, professional title. E.g. 'MEDDICC Framework — Deal Qualification Guide'",
                  },
                  description: {
                    type: "string",
                    description: "1-2 sentence summary of the resource content",
                  },
                  resource_type: {
                    type: "string",
                    enum: ["document", "playbook", "framework", "battlecard", "template", "training", "transcript", "presentation", "email"],
                    description: "Best matching resource type",
                  },
                  tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "3-8 relevant tags, lowercase",
                  },
                  top_folder: {
                    type: "string",
                    enum: ["Frameworks", "Playbooks", "Templates", "Training", "Discovery", "Presentations", "Battlecards", "Tools & Reference"],
                    description: "One of the 8 core top-level folders",
                  },
                  sub_folder: {
                    type: "string",
                    description: "Optional sub-folder name for specificity (e.g., 'MEDDICC', 'Cold Outreach', 'ROI Calculators'). Omit if not needed.",
                  },
                },
                required: ["title", "description", "resource_type", "tags", "top_folder"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "classify_resource" } },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", status, t);
      throw new Error("AI classification failed");
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No classification returned");

    const classification = typeof toolCall.function.arguments === "string"
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;

    // Backwards compat: also set suggested_folder for any old callers
    classification.suggested_folder = classification.top_folder;

    return new Response(JSON.stringify(classification), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classify-resource error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Classification failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
