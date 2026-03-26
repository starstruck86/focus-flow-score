import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CONTENT_CAP = 60000;
const ENRICHMENT_VERSION = 1;
const VALIDATION_VERSION = 1;

// ── Quality thresholds (must match src/lib/resourceQuality.ts) ──
const MIN_CONTENT_CHARS = 500;
const GOOD_CONTENT_CHARS = 2000;
const MIN_UNIQUE_WORDS = 50;
const COMPLETE_MIN_SCORE = 70;

const BOILERPLATE_PATTERNS = [
  /cookie\s*(policy|consent|notice)/i,
  /privacy\s*policy/i,
  /terms\s*(of\s*service|and\s*conditions)/i,
  /subscribe\s*(to\s*our|now)/i,
  /sign\s*up\s*for/i,
  /all\s*rights\s*reserved/i,
  /©\s*\d{4}/,
  /skip\s*to\s*(main\s*)?content/i,
];

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

// ── Post-enrichment quality validator (CRITICAL GATE) ──────
interface QualityValidation {
  score: number;
  tier: 'complete' | 'shallow' | 'incomplete' | 'failed';
  violations: string[];
  passes: boolean;
}

function validateContentQuality(content: string | null, enrichmentVersion: number): QualityValidation {
  const violations: string[] = [];
  const text = content || '';
  const len = text.length;
  let score = 0;

  // Content depth (0-25)
  if (len === 0) {
    violations.push('No content extracted');
  } else if (len < MIN_CONTENT_CHARS) {
    violations.push(`Content too short: ${len} chars (min ${MIN_CONTENT_CHARS})`);
    score += Math.round((len / MIN_CONTENT_CHARS) * 10);
  } else if (len < GOOD_CONTENT_CHARS) {
    score += 15;
  } else {
    score += 25;
  }

  // Structural (0-25) — content + version + timestamp assumed
  if (len > 0) score += 8;
  if (enrichmentVersion >= ENRICHMENT_VERSION) score += 7;
  score += 10; // enriched_at and file_url always present at this point

  // Semantic usefulness (0-25)
  if (len > 0) {
    if (text.startsWith('[External Link:') || text.startsWith('[Placeholder')) {
      violations.push('Content is a placeholder stub');
    } else {
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      const boilerplateLines = lines.filter(line => BOILERPLATE_PATTERNS.some(p => p.test(line)));
      const boilerplateRatio = lines.length > 0 ? boilerplateLines.length / lines.length : 0;
      if (boilerplateRatio > 0.5) {
        violations.push(`High boilerplate: ${Math.round(boilerplateRatio * 100)}%`);
        score += 5;
      } else {
        score += 10;
      }

      const words = new Set(text.toLowerCase().match(/\b[a-z]{3,}\b/g) || []);
      if (words.size < MIN_UNIQUE_WORDS) {
        violations.push(`Low vocabulary: ${words.size} words`);
        score += 3;
      } else {
        score += 10;
      }
      score += 5;
    }
  }

  // Extraction confidence (0-15) — no failure flag at this point
  score += 10;
  if (len >= MIN_CONTENT_CHARS) score += 5;

  // Freshness (0-10)
  score += 10; // both versions current

  // Determine tier
  let tier: QualityValidation['tier'];
  if (score >= COMPLETE_MIN_SCORE && violations.length === 0) tier = 'complete';
  else if (score >= 40) tier = 'shallow';
  else if (score >= 10) tier = 'incomplete';
  else tier = 'failed';

  return { score, tier, violations, passes: tier === 'complete' };
}

/** Update enrichment_status with audit trail and quality metadata */
async function setEnrichmentStatus(
  supabase: any,
  resourceId: string,
  status: string,
  extra: Record<string, any> = {},
) {
  const now = new Date().toISOString();
  const update: Record<string, any> = {
    enrichment_status: status,
    last_status_change_at: now,
    last_enrichment_attempt_at: now,
    ...extra,
  };

  // Also keep legacy content_status in sync
  if (status === 'deep_enriched') update.content_status = 'enriched';
  else if (status === 'deep_enrich_in_progress' || status === 'reenrich_in_progress') update.content_status = 'enriching';
  else if (status === 'failed' || status === 'incomplete') update.content_status = 'placeholder';
  else if (status === 'not_enriched') update.content_status = 'placeholder';

  await supabase.from("resources").update(update).eq("id", resourceId);
}

/** Process a single resource with quality validation gate */
async function enrichSingleResource(
  supabase: any,
  resource: any,
  apiKey: string,
  force: boolean,
): Promise<{ status: string; chars: number; quality_tier?: string; quality_score?: number; violations?: string[] }> {
  const url = resource.file_url;
  if (!url || !url.startsWith("http")) {
    return { status: "skipped", chars: 0 };
  }

  const source = detectSource(url);
  if (source === "auth-gated") {
    return { status: "auth-gated", chars: 0 };
  }

  // Only allow re-enrichment when force=true
  if (resource.enrichment_status === "deep_enriched" && !force) {
    return { status: "already_enriched", chars: 0 };
  }

  const isReenrich = force && resource.enrichment_status === "deep_enriched";
  const inProgressStatus = isReenrich ? "reenrich_in_progress" : "deep_enrich_in_progress";

  await setEnrichmentStatus(supabase, resource.id, inProgressStatus);

  const content = await scrapeUrl(url, apiKey);

  // ── QUALITY VALIDATION GATE (CRITICAL) ──────────────────
  const qv = validateContentQuality(content, ENRICHMENT_VERSION);

  console.log(`[QualityGate] resource=${resource.id} score=${qv.score} tier=${qv.tier} violations=${qv.violations.join('; ')} chars=${content?.length || 0}`);

  if (qv.passes) {
    // Quality contract met → deep_enriched
    await supabase.from("resources").update({ content }).eq("id", resource.id);
    await setEnrichmentStatus(supabase, resource.id, "deep_enriched", {
      enriched_at: new Date().toISOString(),
      content_length: content!.length,
      enrichment_version: ENRICHMENT_VERSION,
      validation_version: VALIDATION_VERSION,
      failure_reason: null,
      last_quality_score: qv.score,
      last_quality_tier: qv.tier,
    });
    await supabase.from("resource_digests").delete().eq("resource_id", resource.id);
    return { status: "enriched", chars: content!.length, quality_tier: qv.tier, quality_score: qv.score };
  }

  // Quality contract NOT met
  if (content && content.length > 0) {
    // Save the content we got, but mark as incomplete/failed
    await supabase.from("resources").update({ content, content_length: content.length }).eq("id", resource.id);
  }

  const newStatus = qv.tier === 'shallow' || qv.tier === 'incomplete' ? 'incomplete' : 'failed';

  // On re-enrich failure, increment failure_count
  const failureCount = (resource.failure_count || 0) + 1;

  await setEnrichmentStatus(supabase, resource.id, isReenrich && resource.enrichment_status === 'deep_enriched' ? resource.enrichment_status : newStatus, {
    failure_reason: qv.violations.join('; ') || (content ? `Quality too low (score ${qv.score})` : "Scrape returned no content"),
    last_quality_score: qv.score,
    last_quality_tier: qv.tier,
    validation_version: VALIDATION_VERSION,
    failure_count: failureCount,
  });

  return { status: newStatus, chars: content?.length || 0, quality_tier: qv.tier, quality_score: qv.score, violations: qv.violations };
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
        .select("id, file_url, enrichment_status, content_status, failure_count")
        .in("id", resource_ids.slice(0, 50));

      if (qErr) throw new Error("Query failed");

      const results: any[] = [];
      for (const resource of resources || []) {
        const result = await enrichSingleResource(supabase, resource, FIRECRAWL_API_KEY, !!force);
        results.push({ id: resource.id, ...result });
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
        .select("id, file_url, content, enrichment_status, content_status, failure_count")
        .eq("id", resource_id)
        .single();
      if (rErr || !resource) throw new Error("Resource not found");

      const result = await enrichSingleResource(supabase, resource, FIRECRAWL_API_KEY, !!force);

      if (result.status === 'skipped' || result.status === 'already_enriched' || result.status === 'auth-gated') {
        return new Response(JSON.stringify({ error: result.status === 'already_enriched' ? "Already enriched. Use force:true to re-enrich." : result.status, skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (result.status === 'failed' || result.status === 'incomplete') {
        return new Response(JSON.stringify({
          error: `Quality validation failed: ${result.violations?.join('; ') || 'unknown'}`,
          skipped: true,
          quality_tier: result.quality_tier,
          quality_score: result.quality_score,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        resource_id,
        chars: result.chars,
        quality_tier: result.quality_tier,
        quality_score: result.quality_score,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Batch mode (all not_enriched) ──
    if (batch) {
      const batchLimit = Math.min(limit || 50, 50);
      const { data: placeholders, error: qErr } = await supabase
        .from("resources")
        .select("id, file_url, enrichment_status, failure_count")
        .in("enrichment_status", ["not_enriched", "incomplete"])
        .like("file_url", "http%")
        .limit(batchLimit);

      if (qErr) throw new Error("Query failed");

      const results = { enriched: 0, failed: 0, skipped: 0, incomplete: 0, total: placeholders?.length || 0 };

      for (const resource of placeholders || []) {
        const result = await enrichSingleResource(supabase, resource, FIRECRAWL_API_KEY, false);
        if (result.status === 'enriched') results.enriched++;
        else if (result.status === 'incomplete') results.incomplete++;
        else if (result.status === 'failed') results.failed++;
        else results.skipped++;
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
