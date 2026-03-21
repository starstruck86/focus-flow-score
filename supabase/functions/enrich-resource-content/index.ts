import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CONTENT_CAP = 60000;
const SHALLOW_THRESHOLD = 5000;

const AUTH_GATED_PATTERNS = [
  /drive\.google\.com/i, /docs\.google\.com/i, /sheets\.google\.com/i,
  /slides\.google\.com/i, /\.zoom\.us\//i, /thinkific\.com/i, /udemy\.com/i,
  /coursera\.org/i, /linkedin\.com\/learning/i, /loom\.com/i, /notion\.so/i,
  /dropbox\.com/i, /onedrive\.live\.com/i, /sharepoint\.com/i,
];

function isAuthGated(url: string): boolean {
  return AUTH_GATED_PATTERNS.some(p => p.test(url));
}

function detectSource(url: string): "youtube" | "podcast" | "generic" | "auth-gated" {
  if (isAuthGated(url)) return "auth-gated";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/spotify\.com|podcasts\.apple\.com|anchor\.fm/i.test(url)) return "podcast";
  return "generic";
}

async function scrapeUrl(url: string, apiKey: string): Promise<string | null> {
  const source = detectSource(url);
  if (source === "auth-gated") return null;

  // YouTube needs longer wait for transcript loading
  const waitFor = source === "youtube" ? 8000 : source === "podcast" ? 5000 : undefined;

  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        ...(waitFor ? { waitFor } : {}),
      }),
    });

    if (!response.ok) {
      console.error(`Firecrawl error for ${url}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const markdown = data.data?.markdown || data.markdown || "";
    return markdown.slice(0, CONTENT_CAP) || null;
  } catch (e) {
    console.error(`Scrape failed for ${url}:`, e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "Firecrawl not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { resource_id, batch, limit, force, resource_ids } = body;

    // ── Batch-by-IDs mode ──
    if (resource_ids && Array.isArray(resource_ids) && resource_ids.length > 0) {
      const { data: resources, error: qErr } = await supabase
        .from("resources")
        .select("id, file_url, content_status")
        .in("id", resource_ids.slice(0, 50));

      if (qErr) throw new Error("Query failed");

      const results: { id: string; status: string; chars: number }[] = [];
      for (const resource of resources || []) {
        const url = resource.file_url;
        if (!url || !url.startsWith("http")) {
          results.push({ id: resource.id, status: "skipped", chars: 0 });
          continue;
        }

        const source = detectSource(url);
        if (source === "auth-gated") {
          results.push({ id: resource.id, status: "auth-gated", chars: 0 });
          continue;
        }

        await supabase.from("resources").update({ content_status: "enriching" }).eq("id", resource.id);

        const content = await scrapeUrl(url, FIRECRAWL_API_KEY);
        if (content) {
          await supabase.from("resources").update({
            content,
            content_status: "enriched",
            enriched_at: new Date().toISOString(),
            content_length: content.length,
          }).eq("id", resource.id);
          await supabase.from("resource_digests").delete().eq("resource_id", resource.id);
          results.push({ id: resource.id, status: "enriched", chars: content.length });
        } else {
          await supabase.from("resources").update({ content_status: "placeholder" }).eq("id", resource.id);
          results.push({ id: resource.id, status: "failed", chars: 0 });
        }

        await new Promise(r => setTimeout(r, 1000));
      }

      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Single mode ──
    if (resource_id && !batch) {
      const { data: resource, error: rErr } = await supabase
        .from("resources")
        .select("id, file_url, content, content_status")
        .eq("id", resource_id)
        .single();
      if (rErr || !resource) throw new Error("Resource not found");

      const url = resource.file_url;
      if (!url || !url.startsWith("http")) {
        return new Response(JSON.stringify({ error: "Not a URL resource", skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Only allow re-enrichment when force=true
      if (resource.content_status === "enriched" && !force) {
        return new Response(JSON.stringify({ error: "Already enriched. Use force:true to re-enrich.", skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("resources").update({ content_status: "enriching" }).eq("id", resource_id);

      const content = await scrapeUrl(url, FIRECRAWL_API_KEY);
      if (!content) {
        await supabase.from("resources").update({ content_status: resource.content_status === "enriched" ? "enriched" : "placeholder" }).eq("id", resource_id);
        return new Response(JSON.stringify({ error: "Could not scrape URL", skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("resources").update({
        content,
        content_status: "enriched",
        enriched_at: new Date().toISOString(),
        content_length: content.length,
      }).eq("id", resource_id);

      await supabase.from("resource_digests").delete().eq("resource_id", resource_id);

      return new Response(JSON.stringify({ success: true, resource_id, chars: content.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Batch mode (all placeholders) ──
    if (batch) {
      const batchLimit = Math.min(limit || 50, 50);
      const { data: placeholders, error: qErr } = await supabase
        .from("resources")
        .select("id, file_url")
        .eq("content_status", "placeholder")
        .like("file_url", "http%")
        .limit(batchLimit);

      if (qErr) throw new Error("Query failed");

      const results = { enriched: 0, failed: 0, skipped: 0, total: placeholders?.length || 0 };

      for (const resource of placeholders || []) {
        const source = detectSource(resource.file_url || "");
        if (source === "auth-gated") {
          results.skipped++;
          continue;
        }

        await supabase.from("resources").update({ content_status: "enriching" }).eq("id", resource.id);

        const content = await scrapeUrl(resource.file_url!, FIRECRAWL_API_KEY);
        if (content) {
          await supabase.from("resources").update({
            content,
            content_status: "enriched",
            enriched_at: new Date().toISOString(),
            content_length: content.length,
          }).eq("id", resource.id);
          await supabase.from("resource_digests").delete().eq("resource_id", resource.id);
          results.enriched++;
        } else {
          await supabase.from("resources").update({ content_status: "placeholder" }).eq("id", resource.id);
          results.failed++;
        }

        await new Promise(r => setTimeout(r, 1000));
      }

      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Provide resource_id, resource_ids, or batch: true" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("enrich-resource-content error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
