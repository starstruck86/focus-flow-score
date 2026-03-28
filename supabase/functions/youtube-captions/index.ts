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
      // /embed/ID or /v/ID
      const embedMatch = u.pathname.match(/\/(embed|v)\/([\w-]{11})/);
      if (embedMatch) return embedMatch[2];
    }
    return null;
  } catch {
    return null;
  }
}

// ── Caption extraction via innertube ───────────────────────
// YouTube exposes caption tracks in the player response.
// We fetch the watch page, extract the captions URL from ytInitialPlayerResponse,
// then fetch the timedtext XML and convert to plain text.

async function fetchPlayerResponse(videoId: string): Promise<any> {
  // Use innertube API — no key needed
  const body = {
    context: {
      client: {
        clientName: "WEB",
        clientVersion: "2.20240101.00.00",
        hl: "en",
      },
    },
    videoId,
  };

  const resp = await fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    throw new Error(`Innertube player request failed: ${resp.status}`);
  }

  return resp.json();
}

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

  // Prefer English manual captions, then English auto, then any manual, then any auto
  const enManual = tracks.find(t => t.lang.startsWith("en") && t.kind !== "asr");
  if (enManual) return enManual;

  const enAuto = tracks.find(t => t.lang.startsWith("en") && t.kind === "asr");
  if (enAuto) return enAuto;

  const anyManual = tracks.find(t => t.kind !== "asr");
  if (anyManual) return anyManual;

  return tracks[0];
}

async function fetchCaptionXml(captionUrl: string): Promise<string> {
  // Request plain text format (fmt=3 = srv3 JSON, but raw XML is default)
  const url = new URL(captionUrl);
  url.searchParams.set("fmt", "3"); // srv3 format — structured JSON
  
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Caption fetch failed: ${resp.status}`);
  return resp.text();
}

function parseSrv3ToText(srv3: string): string {
  // srv3 format is JSON with events array
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
    // Not JSON — try XML parsing
  }

  // Fallback: XML timedtext format
  // Extract text from <text> elements
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

// Fallback: fetch raw XML captions (fmt=1, default timedtext)
async function fetchCaptionRawXml(captionUrl: string): Promise<string> {
  const resp = await fetch(captionUrl);
  if (!resp.ok) throw new Error(`Caption raw XML fetch failed: ${resp.status}`);
  return resp.text();
}

// ── Title extraction ───────────────────────────────────────
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
    const authHeader = req.headers.get("Authorization");
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

    const body = await req.json();
    const { url, video_id, resource_id } = body;

    // Resolve video ID
    const resolvedVideoId = video_id || (url ? extractVideoId(url) : null);
    if (!resolvedVideoId) {
      return new Response(
        JSON.stringify({ error: "No valid YouTube URL or video_id provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[youtube-captions] Extracting captions for video: ${resolvedVideoId}`);

    // 1. Fetch player response via innertube
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
      // No captions available
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

    // Try srv3 JSON first
    try {
      const srv3 = await fetchCaptionXml(bestTrack.url);
      transcript = parseSrv3ToText(srv3);
    } catch (e) {
      console.log(`[youtube-captions] srv3 failed, trying raw XML: ${(e as Error).message}`);
    }

    // Fallback to raw XML
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
