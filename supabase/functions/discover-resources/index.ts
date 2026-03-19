import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function searchResources(query: string) {
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  if (!PERPLEXITY_API_KEY) throw new Error("PERPLEXITY_API_KEY not configured");

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [
        {
          role: "system",
          content: `You are an elite sales resource curator. Find the absolute best, top 1% resources for the given topic. Include books, podcasts, YouTube videos, articles, frameworks, courses, and tools. For each resource provide the direct URL. Focus on highly actionable, respected, and proven resources used by top-performing sales professionals. Return 8-15 resources.`,
        },
        { role: "user", content: query },
      ],
    }),
  });

  if (!response.ok) {
    const t = await response.text();
    console.error("Perplexity error:", response.status, t);
    throw new Error(`Perplexity search failed: ${response.status}`);
  }

  const data = await response.json();
  const searchContent = data.choices?.[0]?.message?.content || "";
  const citations = data.citations || [];

  // Now pass through Lovable AI to structure the results
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const structureResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
          content: "You are a sales resource classifier. Structure the search results into classified resources.",
        },
        {
          role: "user",
          content: `Structure these search results into classified sales resources. Each resource needs a title, URL, description, resource_type, tags, and suggested_folder.

Search results:
${searchContent}

Source URLs: ${citations.join(", ")}

RULES:
- Title format: "Resource Name — Author/Source"
- resource_type must be one of: document, playbook, framework, battlecard, template, training, transcript, presentation, email
- Use "training" for courses, podcasts, videos
- Use "framework" for methodologies
- Use "document" for articles and books
- suggested_folder should be one of: Frameworks, Playbooks, Templates, Training, Discovery, Personas, Presentations, Tools & Reference
- Tags should be lowercase, 3-6 per resource
- Include the direct URL for each resource`,
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "structure_resources",
            description: "Return structured classified resources from search results",
            parameters: {
              type: "object",
              properties: {
                resources: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      url: { type: "string" },
                      description: { type: "string" },
                      resource_type: {
                        type: "string",
                        enum: ["document", "playbook", "framework", "battlecard", "template", "training", "transcript", "presentation", "email"],
                      },
                      tags: { type: "array", items: { type: "string" } },
                      suggested_folder: { type: "string" },
                    },
                    required: ["title", "url", "description", "resource_type", "tags", "suggested_folder"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["resources"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "structure_resources" } },
    }),
  });

  if (!structureResponse.ok) {
    const status = structureResponse.status;
    if (status === 429) throw new Error("Rate limit exceeded, please try again later.");
    if (status === 402) throw new Error("AI credits exhausted. Please add credits.");
    throw new Error("AI structuring failed");
  }

  const structureResult = await structureResponse.json();
  const toolCall = structureResult.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("No structured results returned");

  const parsed = typeof toolCall.function.arguments === "string"
    ? JSON.parse(toolCall.function.arguments)
    : toolCall.function.arguments;

  return parsed.resources;
}

async function buildCompetitorIntel(companyName: string, websiteUrl: string, context: string) {
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  let formattedUrl = websiteUrl.trim();
  if (!formattedUrl.startsWith("http://") && !formattedUrl.startsWith("https://")) {
    formattedUrl = `https://${formattedUrl}`;
  }

  // Step 1: Map the website
  console.log("Mapping website:", formattedUrl);
  const mapResponse = await fetch("https://api.firecrawl.dev/v1/map", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: formattedUrl,
      limit: 200,
      includeSubdomains: true,
    }),
  });

  if (!mapResponse.ok) {
    const t = await mapResponse.text();
    console.error("Firecrawl map error:", mapResponse.status, t);
    throw new Error(`Website mapping failed: ${mapResponse.status}`);
  }

  const mapData = await mapResponse.json();
  const allUrls: string[] = mapData.links || [];
  console.log(`Found ${allUrls.length} URLs`);

  // Step 2: Filter to priority pages
  const priorityPatterns = [
    /\/(product|features?|platform|solutions?|capabilities)/i,
    /\/(pricing|plans?|packages)/i,
    /\/(about|company|team|leadership)/i,
    /\/(integrations?|partners?|ecosystem)/i,
    /\/(case.?stud|customers?|success.?stor|testimonial)/i,
    /\/(help|docs?|documentation|support|knowledge|guide|tutorial|how.?to)/i,
    /\/(blog|resources?|library|learn)/i,
    /\/(comparison|vs|alternative|compete)/i,
    /\/(security|compliance|privacy)/i,
    /\/(api|developer)/i,
  ];

  // Always include homepage
  const priorityUrls = [formattedUrl];
  for (const url of allUrls) {
    if (priorityUrls.length >= 50) break;
    if (url === formattedUrl) continue;
    if (priorityPatterns.some(p => p.test(url))) {
      priorityUrls.push(url);
    }
  }

  // If we have fewer than 20, add some more general pages
  if (priorityUrls.length < 20) {
    for (const url of allUrls) {
      if (priorityUrls.length >= 30) break;
      if (!priorityUrls.includes(url)) {
        priorityUrls.push(url);
      }
    }
  }

  console.log(`Scraping ${priorityUrls.length} priority pages`);

  // Step 3: Batch scrape pages (scrape each individually, 5 at a time)
  const allContent: { url: string; title: string; content: string }[] = [];
  
  for (let i = 0; i < priorityUrls.length; i += 5) {
    const batch = priorityUrls.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
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
        if (!resp.ok) return null;
        const d = await resp.json();
        const markdown = d.data?.markdown || d.markdown || "";
        const title = d.data?.metadata?.title || d.metadata?.title || url;
        return { url, title, content: markdown.slice(0, 4000) };
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        allContent.push(r.value);
      }
    }
    // Small delay between batches
    if (i + 5 < priorityUrls.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`Successfully scraped ${allContent.length} pages`);

  // Step 4: Synthesize battlecard with Gemini 2.5 Pro (large context)
  const crawledText = allContent
    .map((p) => `## ${p.title}\nURL: ${p.url}\n\n${p.content}`)
    .join("\n\n---\n\n");

  const battlecardPrompt = `You are a competitive intelligence analyst for enterprise B2B sales. Analyze the following scraped content from ${companyName} (${formattedUrl}) and create a comprehensive competitive battlecard.

${context ? `SELLER'S CONTEXT: ${context}` : ""}

SCRAPED CONTENT (${allContent.length} pages):
${crawledText.slice(0, 120000)}

Create an exhaustive competitive intelligence battlecard. Be specific with facts, numbers, and direct quotes from their site.`;

  const battlecardResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        {
          role: "system",
          content: "You are an elite competitive intelligence analyst. Create detailed, actionable battlecards that help sales reps win deals against competitors.",
        },
        { role: "user", content: battlecardPrompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "create_battlecard",
            description: "Create a structured competitive intelligence battlecard",
            parameters: {
              type: "object",
              properties: {
                company_overview: { type: "string", description: "2-3 paragraph company overview including founding, size, funding, market position" },
                product_capabilities: {
                  type: "array",
                  items: { type: "object", properties: { capability: { type: "string" }, details: { type: "string" } }, required: ["capability", "details"], additionalProperties: false },
                  description: "Key product capabilities and features",
                },
                pricing_model: { type: "string", description: "Detailed pricing information, tiers, and packaging" },
                target_market: { type: "string", description: "Their ideal customer profile, verticals, and company sizes" },
                strengths: {
                  type: "array",
                  items: { type: "string" },
                  description: "Key competitive strengths (5-10 items)",
                },
                weaknesses: {
                  type: "array",
                  items: { type: "string" },
                  description: "Known weaknesses, gaps, and limitations (5-10 items)",
                },
                common_objections: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      objection: { type: "string" },
                      response: { type: "string" },
                    },
                    required: ["objection", "response"],
                    additionalProperties: false,
                  },
                  description: "Common objections prospects raise about switching FROM this competitor, with suggested responses",
                },
                how_to_pitch_against: { type: "string", description: "Detailed strategy for positioning against this competitor. Include specific talking points, questions to ask prospects, and trap-setting techniques." },
                key_differentiators: {
                  type: "array",
                  items: { type: "string" },
                  description: "What they claim differentiates them",
                },
                integration_ecosystem: { type: "string", description: "Key integrations and technology partners" },
                customer_proof_points: { type: "string", description: "Notable customers, case studies, and results they claim" },
                landmines: {
                  type: "array",
                  items: { type: "string" },
                  description: "Questions or topics to raise with prospects that expose this competitor's weaknesses",
                },
              },
              required: [
                "company_overview", "product_capabilities", "pricing_model",
                "target_market", "strengths", "weaknesses", "common_objections",
                "how_to_pitch_against", "key_differentiators", "integration_ecosystem",
                "customer_proof_points", "landmines",
              ],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "create_battlecard" } },
    }),
  });

  if (!battlecardResponse.ok) {
    const status = battlecardResponse.status;
    if (status === 429) throw new Error("Rate limit exceeded, please try again later.");
    if (status === 402) throw new Error("AI credits exhausted. Please add credits.");
    const t = await battlecardResponse.text();
    console.error("Battlecard generation error:", status, t);
    throw new Error("Battlecard generation failed");
  }

  const battlecardResult = await battlecardResponse.json();
  const bcToolCall = battlecardResult.choices?.[0]?.message?.tool_calls?.[0];
  if (!bcToolCall) throw new Error("No battlecard generated");

  const battlecard = typeof bcToolCall.function.arguments === "string"
    ? JSON.parse(bcToolCall.function.arguments)
    : bcToolCall.function.arguments;

  // Format battlecard as markdown
  const markdown = formatBattlecardMarkdown(companyName, battlecard, allContent.map(c => c.url));

  return {
    battlecard,
    markdown,
    pages_scraped: allContent.length,
    source_urls: allContent.map(c => c.url),
  };
}

function formatBattlecardMarkdown(companyName: string, bc: any, sourceUrls: string[]): string {
  let md = `# Competitive Battlecard: ${companyName}\n\n`;
  md += `*Generated ${new Date().toLocaleDateString()} — ${sourceUrls.length} pages analyzed*\n\n`;

  md += `## Company Overview\n\n${bc.company_overview}\n\n`;

  md += `## Product Capabilities\n\n`;
  for (const cap of bc.product_capabilities || []) {
    md += `### ${cap.capability}\n${cap.details}\n\n`;
  }

  md += `## Pricing Model\n\n${bc.pricing_model}\n\n`;
  md += `## Target Market\n\n${bc.target_market}\n\n`;

  md += `## Strengths\n\n`;
  for (const s of bc.strengths || []) md += `- ✅ ${s}\n`;

  md += `\n## Weaknesses\n\n`;
  for (const w of bc.weaknesses || []) md += `- ❌ ${w}\n`;

  md += `\n## How to Pitch Against ${companyName}\n\n${bc.how_to_pitch_against}\n\n`;

  md += `## Common Objections & Responses\n\n`;
  for (const obj of bc.common_objections || []) {
    md += `**"${obj.objection}"**\n> ${obj.response}\n\n`;
  }

  md += `## Landmine Questions\n\n`;
  md += `*Questions to ask prospects that expose ${companyName}'s weaknesses:*\n\n`;
  for (const l of bc.landmines || []) md += `- 💣 ${l}\n`;

  md += `\n## Key Differentiators (Their Claims)\n\n`;
  for (const d of bc.key_differentiators || []) md += `- ${d}\n`;

  md += `\n## Integration Ecosystem\n\n${bc.integration_ecosystem}\n\n`;
  md += `## Customer Proof Points\n\n${bc.customer_proof_points}\n\n`;

  md += `---\n\n## Sources\n\n`;
  for (const url of sourceUrls.slice(0, 20)) md += `- ${url}\n`;

  return md;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { type, query, companyName, websiteUrl, context } = await req.json();

    if (type === "resource-search") {
      if (!query) throw new Error("Query is required");
      const resources = await searchResources(query);
      return new Response(JSON.stringify({ resources }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "competitor-intel") {
      if (!companyName || !websiteUrl) throw new Error("Company name and website URL are required");
      const result = await buildCompetitorIntel(companyName, websiteUrl, context || "");
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Invalid type. Use 'resource-search' or 'competitor-intel'");
  } catch (e) {
    console.error("discover-resources error:", e);
    const message = e instanceof Error ? e.message : "Discovery failed";
    const status = message.includes("Rate limit") ? 429 : message.includes("credits") ? 402 : 500;
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
