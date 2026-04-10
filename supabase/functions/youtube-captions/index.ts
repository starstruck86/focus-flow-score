import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

// ── Video ID extraction ────────────────────────────────────
function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const embedMatch = u.pathname.match(/\/(embed|v)\/([\w-]{11})/);
      if (embedMatch) return embedMatch[2];
    }
    return null;
  } catch {
    return null;
  }
}

// ── Fetch player response by scraping watch page HTML ──────
// The innertube API returns UNPLAYABLE from server environments,
// so we fetch the watch page and extract ytInitialPlayerResponse.
async function fetchPlayerResponse(videoId: string): Promise<any> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  // Try multiple approaches to get the watch page with full player response
  // YouTube may serve consent pages from EU — use bot-like headers and consent cookie
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Cookie": "CONSENT=PENDING+987; SOCS=CAESEwgDEgk2NjI1MjcyNjAaAmVuIAEaBgiA_L2aBg",
  };

  let resp = await fetch(watchUrl, { headers, redirect: "follow" });

  if (!resp.ok) {
    throw new Error(`Watch page fetch failed: ${resp.status}`);
  }

  const html = await resp.text();
  console.log(`[youtube-captions] Watch page fetched: ${html.length} chars`);

  // Extract ytInitialPlayerResponse — find the JSON by tracking brace depth
  const startMarker = "ytInitialPlayerResponse = ";
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error("Could not find ytInitialPlayerResponse in watch page");
  }

  // Extract JSON using semicolon-based boundary detection
  // ytInitialPlayerResponse ends with `};` — find the matching end
  const jsonStart = startIdx + startMarker.length;
  
  // Find the end by looking for the pattern `;\nvar ` or `};` at depth 0
  // Use a simpler approach: find `var ytInitialData` or end-of-script which comes after
  const endMarkers = [";\nvar ", ";var ", ";</script>"];
  let jsonEnd = -1;
  for (const marker of endMarkers) {
    // Search from a reasonable offset (player response is usually 50k-500k chars)
    let searchFrom = jsonStart + 1000;
    while (searchFrom < html.length && searchFrom < jsonStart + 1_000_000) {
      const idx = html.indexOf(marker, searchFrom);
      if (idx === -1) break;
      // Try to parse from jsonStart to idx
      const candidate = html.slice(jsonStart, idx);
      try {
        JSON.parse(candidate);
        jsonEnd = idx;
        break;
      } catch {
        searchFrom = idx + 1;
      }
    }
    if (jsonEnd > 0) break;
  }

  if (jsonEnd <= 0) {
    throw new Error("Could not find end of ytInitialPlayerResponse JSON");
  }

  const jsonStr = html.slice(jsonStart, jsonEnd);
  console.log(`[youtube-captions] Extracted JSON: ${jsonStr.length} chars`);
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse player response JSON: ${(e as Error).message}`);
  }
}

// ── Caption track extraction ──────────────────────────────
function extractCaptionTracksFromPlayer(playerResponse: any): Array<{ url: string; lang: string; name: string; kind?: string }> {
  const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(captions)) return [];

  return captions.map((t: any) => ({
    url: t.baseUrl,
    lang: t.languageCode || "unknown",
    name: t.name?.simpleText || t.name?.runs?.[0]?.text || "",
    kind: t.kind || undefined,
  }));
}

function pickBestTrack(tracks: Array<{ url: string; lang: string; name: string; kind?: string }>): { url: string; lang: string } | null {
  if (tracks.length === 0) return null;

  const enManual = tracks.find(t => t.lang.startsWith("en") && t.kind !== "asr");
  if (enManual) return enManual;

  const enAuto = tracks.find(t => t.lang.startsWith("en") && t.kind === "asr");
  if (enAuto) return enAuto;

  const anyManual = tracks.find(t => t.kind !== "asr");
  if (anyManual) return anyManual;

  return tracks[0];
}

// ── Caption text parsing ──────────────────────────────────
async function fetchCaptionXml(captionUrl: string): Promise<string> {
  const url = new URL(captionUrl);
  url.searchParams.set("fmt", "3"); // srv3 format
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Caption fetch failed: ${resp.status}`);
  return resp.text();
}

function parseSrv3ToText(srv3: string): string {
  // Try JSON (srv3) first
  try {
    const data = JSON.parse(srv3);
    if (data.events && Array.isArray(data.events)) {
      const lines: string[] = [];
      for (const event of data.events) {
        if (event.segs) {
          const text = event.segs.map((s: any) => s.utf8 || "").join("");
          if (text.trim()) lines.push(text.trim());
        }
      }
      return lines.join(" ").replace(/\s+/g, " ").trim();
    }
  } catch {
    // Not JSON — try XML
  }

  // Fallback: XML timedtext format
  const textMatches = srv3.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi);
  const lines: string[] = [];
  for (const match of textMatches) {
    const decoded = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (decoded) lines.push(decoded);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

async function fetchCaptionRawXml(captionUrl: string): Promise<string> {
  const resp = await fetch(captionUrl);
  if (!resp.ok) throw new Error(`Caption raw XML fetch failed: ${resp.status}`);
  return resp.text();
}

// ── Metadata extraction ───────────────────────────────────
function extractVideoTitle(playerResponse: any): string | null {
  return playerResponse?.videoDetails?.title || null;
}

function extractVideoAuthor(playerResponse: any): string | null {
  return playerResponse?.videoDetails?.author || null;
}

function extractVideoDuration(playerResponse: any): number | null {
  const secs = parseInt(playerResponse?.videoDetails?.lengthSeconds, 10);
  return isNaN(secs) ? null : secs;
}

// ── Main handler ───────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Support both authenticated (user) and service-role calls
    const authHeader = req.headers.get("Authorization");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const isServiceRole = authHeader?.includes(serviceRoleKey);

    let userId: string | null = null;

    if (!isServiceRole) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader! } } }
      );

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    const body = await req.json();
    const { url, video_id, resource_id } = body;

    const resolvedVideoId = video_id || (url ? extractVideoId(url) : null);
    if (!resolvedVideoId) {
      return new Response(
        JSON.stringify({ error: "No valid YouTube URL or video_id provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[youtube-captions] Extracting captions for video: ${resolvedVideoId}`);

    // 1. Fetch player response via watch page scraping
    const playerResponse = await fetchPlayerResponse(resolvedVideoId);

    // Check playability
    const playability = playerResponse?.playabilityStatus;
    if (playability?.status === "ERROR" || playability?.status === "UNPLAYABLE") {
      const reason = playability?.reason || "Video unavailable";
      console.log(`[youtube-captions] Video unavailable: ${reason}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: "video_unavailable",
          reason,
          video_id: resolvedVideoId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Extract caption tracks
    const tracks = extractCaptionTracksFromPlayer(playerResponse);
    const title = extractVideoTitle(playerResponse);
    const author = extractVideoAuthor(playerResponse);
    const durationSecs = extractVideoDuration(playerResponse);

    console.log(`[youtube-captions] Found ${tracks.length} caption tracks for "${title}"`);

    if (tracks.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "no_captions",
          reason: "No caption tracks available for this video",
          video_id: resolvedVideoId,
          title,
          author,
          duration_seconds: durationSecs,
          has_captions: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Pick best track and fetch
    const bestTrack = pickBestTrack(tracks)!;
    console.log(`[youtube-captions] Using track: lang=${bestTrack.lang}`);

    let transcript = "";

    try {
      const srv3 = await fetchCaptionXml(bestTrack.url);
      transcript = parseSrv3ToText(srv3);
    } catch (e) {
      console.log(`[youtube-captions] srv3 failed, trying raw XML: ${(e as Error).message}`);
    }

    if (!transcript || transcript.length < 100) {
      try {
        const rawXml = await fetchCaptionRawXml(bestTrack.url);
        transcript = parseSrv3ToText(rawXml);
      } catch (e) {
        console.log(`[youtube-captions] Raw XML also failed: ${(e as Error).message}`);
      }
    }

    if (!transcript || transcript.length < 50) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "caption_parse_failed",
          reason: "Captions found but could not be parsed into usable text",
          video_id: resolvedVideoId,
          title,
          tracks_found: tracks.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. If resource_id provided, update the resource directly
    if (resource_id) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        isServiceRole ? serviceRoleKey : Deno.env.get("SUPABASE_ANON_KEY")!,
        isServiceRole ? {} : { global: { headers: { Authorization: authHeader! } } }
      );

      const now = new Date().toISOString();
      await supabase.from("resources").update({
        content: transcript.slice(0, 60_000),
        content_length: transcript.length,
        content_status: "enriched",
        enrichment_status: "deep_enriched",
        enriched_at: now,
        last_enrichment_attempt_at: now,
        last_status_change_at: now,
        failure_reason: null,
        author_or_speaker: author || undefined,
      }).eq("id", resource_id);

      console.log(`[youtube-captions] Updated resource ${resource_id} with ${transcript.length} chars`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        video_id: resolvedVideoId,
        title,
        author,
        duration_seconds: durationSecs,
        transcript_length: transcript.length,
        transcript_language: bestTrack.lang,
        caption_type: tracks.find(t => t.url === bestTrack.url)?.kind === "asr" ? "auto_generated" : "manual",
        tracks_available: tracks.length,
        transcript: resource_id ? undefined : transcript.slice(0, 60_000),
        resource_updated: !!resource_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[youtube-captions] Error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
