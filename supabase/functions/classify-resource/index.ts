import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// URLs that are auth-gated and can't be scraped
function isAuthGatedUrl(url: string): boolean {
  const gatedPatterns = [
    /drive\.google\.com/i,
    /docs\.google\.com/i,
    /sheets\.google\.com/i,
    /slides\.google\.com/i,
    /\.zoom\.us\//i,
    /thinkific\.com/i,
    /udemy\.com/i,
    /coursera\.org/i,
    /linkedin\.com\/learning/i,
    /loom\.com/i,
    /notion\.so/i,
    /dropbox\.com/i,
    /onedrive\.live\.com/i,
    /sharepoint\.com/i,
  ];
  return gatedPatterns.some(p => p.test(url));
}

// Extract hints from URL patterns for auth-gated URLs
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

  // Extract source from domain
  let source = host.split('.')[0];
  if (host.includes('google.com')) source = 'Google Drive';
  else if (host.includes('zoom.us')) {
    const subdomain = host.split('.zoom.us')[0];
    source = subdomain !== 'us02web' ? subdomain : 'Zoom';
  }
  else if (host.includes('thinkific.com')) {
    const subdomain = host.split('.thinkific.com')[0];
    source = subdomain || 'Thinkific';
  }

  return { type, source };
}

async function scrapeUrl(url: string): Promise<{ pageTitle: string; content: string } | null> {
  // Skip scraping for auth-gated URLs — Firecrawl will get a login page
  if (isAuthGatedUrl(url)) {
    console.log("Skipping scrape for auth-gated URL:", url);
    return null;
  }

  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  if (!FIRECRAWL_API_KEY) {
    console.warn("FIRECRAWL_API_KEY not configured, skipping scrape");
    return null;
  }

  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });

    if (!response.ok) {
      console.error("Firecrawl scrape failed:", response.status);
      return null;
    }

    const data = await response.json();
    const markdown = data.data?.markdown || data.markdown || "";
    const metadata = data.data?.metadata || data.metadata || {};
    const pageTitle = metadata.title || metadata.ogTitle || "";

    return { pageTitle, content: markdown.slice(0, 3000) };
  } catch (e) {
    console.error("Firecrawl scrape error:", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, filename, url, existingTitle, existingTags } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // If URL provided, scrape it first for ground-truth content
    let scrapedTitle = "";
    let scrapedContent = "";
    let urlHints = "";
    if (url) {
      // For auth-gated URLs, extract hints from URL pattern instead of scraping
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

    const prompt = `Classify this sales resource.
${scrapedTitle ? `PAGE TITLE (ground truth — use this as the primary basis for the resource title): "${scrapedTitle}"` : ""}
${filename ? `Filename: ${filename}` : ""}
${url ? `URL: ${url}` : ""}
${existingTitle ? `Current title: ${existingTitle}` : ""}
${existingTags?.length ? `Current tags: ${existingTags.join(", ")}` : ""}

Content preview:
${contentHint}

CRITICAL NAMING RULES:
1. If a PAGE TITLE is provided above, USE IT as the primary basis for the resource title. It is the official document/page title and must be respected.
2. If no PAGE TITLE is provided but the content contains an explicit document title, heading, or page title, USE IT as the primary basis for the resource title.
3. Do NOT infer or guess a topic from body text or URL patterns when a clear title exists.
4. Append source/author attribution after an em dash (—). Extract from URL domain (e.g., "Pavilion" from joinpavilion.zoom.us, "SamSales" from samsales-shorts.thinkific.com) or from author names found in the content.
5. Format: "Descriptive Title — Source/Author"
6. For training recordings, include session/class numbers if identifiable.
7. Do NOT hallucinate titles from transcript text or body content fragments.

Suggest a clear, professional title, a short description, the best resource type, relevant tags, and the most logical folder name.`;

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
            content: "You are a sales resource classifier. Analyze content and return structured classification using the provided tool.",
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
                    description: "Clean, professional title. E.g. 'MEDDICC Framework - Deal Qualification Guide'",
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
                    description: "3-8 relevant tags, lowercase, e.g. ['meddicc', 'deal-qualification', 'enterprise']",
                  },
                  suggested_folder: {
                    type: "string",
                    description: "Logical folder name, e.g. 'Frameworks', 'Training Courses', 'Battlecards', 'Templates'",
                  },
                },
                required: ["title", "description", "resource_type", "tags", "suggested_folder"],
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

    if (!toolCall) {
      throw new Error("No classification returned");
    }

    const classification = typeof toolCall.function.arguments === "string"
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;

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
