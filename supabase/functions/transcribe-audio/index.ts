import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

// 25 MB chunk size for ElevenLabs (their limit is ~25MB per request)
const CHUNK_SIZE_BYTES = 24 * 1024 * 1024;
// Max total file we'll attempt: 500MB
const MAX_FILE_BYTES = 500 * 1024 * 1024;

interface AudioMeta {
  contentType: string | null;
  contentLength: number | null;
  reachable: boolean;
  statusCode: number;
}

interface ChunkResult {
  chunkIndex: number;
  text: string;
  wordCount: number;
  startByte: number;
  endByte: number;
}

interface TranscribeResult {
  success: boolean;
  transcript: string | null;
  segments: ChunkResult[];
  totalWords: number;
  provider: string;
  chunksTotal: number;
  chunksCompleted: number;
  chunksFailed: number;
  failureCode: string | null;
  failureReason: string | null;
  stage: string;
  durationMs: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      return jsonResp(
        { success: false, failureCode: "TRANSCRIPTION_PROVIDER_ERROR", failureReason: "ELEVENLABS_API_KEY not configured", stage: "init" },
        500,
      );
    }

    const body = await req.json();
    const { audio_url, resource_id, job_id } = body as {
      audio_url: string;
      resource_id?: string;
      job_id?: string;
    };

    if (!audio_url) {
      return jsonResp({ success: false, failureCode: "AUDIO_UNREACHABLE", failureReason: "No audio_url provided", stage: "init" }, 400);
    }

    // ── STAGE 1: HEAD check ──────────────────────────────
    const meta = await headCheck(audio_url);
    if (!meta.reachable) {
      return jsonResp({
        success: false,
        failureCode: "AUDIO_UNREACHABLE",
        failureReason: `HEAD returned ${meta.statusCode}`,
        stage: "resolving_source",
      }, 200);
    }

    const ct = (meta.contentType || "").toLowerCase();
    const isAudio = ct.includes("audio") || ct.includes("mpeg") || ct.includes("octet-stream") || ct.includes("mp3") || ct.includes("ogg") || ct.includes("wav") || ct.includes("webm");
    // Some CDNs return generic content types for audio — if the URL has an audio extension, allow it
    const urlLooksAudio = /\.(mp3|m4a|wav|ogg|aac|flac|opus|webm)(\?|#|$)/i.test(audio_url);
    if (!isAudio && !urlLooksAudio) {
      return jsonResp({
        success: false,
        failureCode: "INVALID_CONTENT_TYPE",
        failureReason: `Content-Type is "${meta.contentType}", not audio`,
        stage: "resolving_source",
        meta,
      }, 200);
    }

    const fileSize = meta.contentLength || 0;
    if (fileSize > MAX_FILE_BYTES) {
      return jsonResp({
        success: false,
        failureCode: "AUDIO_TOO_LARGE_UNCHUNKED",
        failureReason: `File is ${Math.round(fileSize / 1024 / 1024)}MB, max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB`,
        stage: "downloading_audio",
        meta,
      }, 200);
    }

    // ── STAGE 2: Download audio ──────────────────────────
    let audioBytes: Uint8Array;
    try {
      const dlResp = await fetch(audio_url, {
        headers: { "User-Agent": "SalesBrain-AudioPipeline/1.0" },
      });
      if (!dlResp.ok) {
        return jsonResp({
          success: false,
          failureCode: "DOWNLOAD_FAILED",
          failureReason: `Download returned ${dlResp.status}`,
          stage: "downloading_audio",
        }, 200);
      }
      audioBytes = new Uint8Array(await dlResp.arrayBuffer());
    } catch (e) {
      return jsonResp({
        success: false,
        failureCode: "DOWNLOAD_FAILED",
        failureReason: `Download error: ${e instanceof Error ? e.message : String(e)}`,
        stage: "downloading_audio",
      }, 200);
    }

    console.log(`Downloaded ${audioBytes.length} bytes from ${audio_url}`);

    // ── STAGE 3: Chunk if needed ─────────────────────────
    const chunks: { index: number; data: Uint8Array; startByte: number; endByte: number }[] = [];
    if (audioBytes.length <= CHUNK_SIZE_BYTES) {
      chunks.push({ index: 0, data: audioBytes, startByte: 0, endByte: audioBytes.length });
    } else {
      let offset = 0;
      let idx = 0;
      while (offset < audioBytes.length) {
        const end = Math.min(offset + CHUNK_SIZE_BYTES, audioBytes.length);
        chunks.push({ index: idx, data: audioBytes.slice(offset, end), startByte: offset, endByte: end });
        offset = end;
        idx++;
      }
      console.log(`Split into ${chunks.length} chunks`);
    }

    // ── STAGE 4: Transcribe each chunk ───────────────────
    const results: ChunkResult[] = [];
    let chunksFailed = 0;
    const failedChunkErrors: string[] = [];

    for (const chunk of chunks) {
      const ext = guessExtension(audio_url, ct);
      const file = new File([chunk.data], `chunk_${chunk.index}.${ext}`, {
        type: ct || "audio/mpeg",
      });

      const fd = new FormData();
      fd.append("file", file);
      fd.append("model_id", "scribe_v2");
      fd.append("language_code", "eng");

      let retries = 0;
      let chunkText: string | null = null;

      while (retries < 3 && chunkText === null) {
        try {
          const sttResp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
            method: "POST",
            headers: { "xi-api-key": ELEVENLABS_API_KEY },
            body: fd,
          });

          if (sttResp.ok) {
            const sttJson = await sttResp.json();
            chunkText = sttJson.text || "";
          } else if (sttResp.status === 429) {
            // Rate limited — wait and retry
            retries++;
            console.log(`Rate limited on chunk ${chunk.index}, retry ${retries}`);
            await delay(2000 * retries);
          } else {
            const errBody = await sttResp.text().catch(() => "");
            console.error(`STT error chunk ${chunk.index}: ${sttResp.status} ${errBody}`);
            retries++;
            if (retries >= 3) {
              failedChunkErrors.push(`Chunk ${chunk.index}: HTTP ${sttResp.status}`);
            }
            await delay(1000);
          }
        } catch (e) {
          retries++;
          console.error(`STT fetch error chunk ${chunk.index}:`, e);
          if (retries >= 3) {
            failedChunkErrors.push(`Chunk ${chunk.index}: ${e instanceof Error ? e.message : String(e)}`);
          }
          await delay(1000);
        }
      }

      if (chunkText !== null) {
        results.push({
          chunkIndex: chunk.index,
          text: chunkText,
          wordCount: chunkText.split(/\s+/).filter(Boolean).length,
          startByte: chunk.startByte,
          endByte: chunk.endByte,
        });
      } else {
        chunksFailed++;
      }
    }

    // ── STAGE 5: Merge transcript ────────────────────────
    if (results.length === 0) {
      return jsonResp({
        success: false,
        failureCode: "TRANSCRIPTION_PROVIDER_ERROR",
        failureReason: `All ${chunks.length} chunks failed. Errors: ${failedChunkErrors.join("; ")}`,
        stage: "transcribing",
        chunksTotal: chunks.length,
        chunksFailed,
      }, 200);
    }

    results.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const fullTranscript = results.map((r) => r.text).join("\n\n");
    const totalWords = fullTranscript.split(/\s+/).filter(Boolean).length;

    // ── STAGE 6: Persist to DB if we have auth ──────────
    let persisted = false;
    try {
      const authHeader = req.headers.get("Authorization");
      if (authHeader && (resource_id || job_id)) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const sb = createClient(supabaseUrl, supabaseKey);

        // Get user from JWT
        const token = authHeader.replace("Bearer ", "");
        const { data: { user } } = await sb.auth.getUser(token);

        if (user && job_id) {
          await sb.from("audio_jobs").update({
            stage: "completed",
            transcript_text: fullTranscript,
            transcript_segments: results,
            transcript_word_count: totalWords,
            has_transcript: true,
            provider_used: "elevenlabs_scribe_v2",
            chunk_metadata: chunks.map(c => ({ index: c.index, startByte: c.startByte, endByte: c.endByte, size: c.data.length })),
            last_successful_stage: "transcribing",
            attempts_count: 1,
            updated_at: new Date().toISOString(),
          }).eq("id", job_id).eq("user_id", user.id);
          persisted = true;
        }

        if (user && resource_id) {
          // Also update the resource with the transcript
          await sb.from("resources").update({
            content: fullTranscript.substring(0, 500000), // cap at 500k chars
            content_status: "transcript",
            enrichment_status: "enriched",
            enriched_at: new Date().toISOString(),
            content_length: totalWords,
          }).eq("id", resource_id).eq("user_id", user.id);
        }
      }
    } catch (e) {
      console.error("DB persist error (non-fatal):", e);
    }

    const result: TranscribeResult = {
      success: true,
      transcript: fullTranscript,
      segments: results,
      totalWords,
      provider: "elevenlabs_scribe_v2",
      chunksTotal: chunks.length,
      chunksCompleted: results.length,
      chunksFailed,
      failureCode: null,
      failureReason: chunksFailed > 0 ? `${chunksFailed}/${chunks.length} chunks failed but transcript assembled` : null,
      stage: "completed",
      durationMs: Date.now() - startTime,
    };

    return jsonResp({ ...result, persisted }, 200);
  } catch (e) {
    console.error("transcribe-audio fatal:", e);
    return jsonResp({
      success: false,
      failureCode: "TRANSCRIPTION_PROVIDER_ERROR",
      failureReason: e instanceof Error ? e.message : String(e),
      stage: "init",
      durationMs: Date.now() - startTime,
    }, 500);
  }
});

async function headCheck(url: string): Promise<AudioMeta> {
  try {
    // Try HEAD first
    let resp = await fetch(url, { method: "HEAD", headers: { "User-Agent": "SalesBrain-AudioPipeline/1.0" } });
    // Some servers don't support HEAD, fallback to GET with range
    if (resp.status === 405 || resp.status === 403) {
      resp = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0", "User-Agent": "SalesBrain-AudioPipeline/1.0" } });
    }
    return {
      contentType: resp.headers.get("content-type"),
      contentLength: Number(resp.headers.get("content-length")) || null,
      reachable: resp.ok || resp.status === 206,
      statusCode: resp.status,
    };
  } catch {
    return { contentType: null, contentLength: null, reachable: false, statusCode: 0 };
  }
}

function guessExtension(url: string, contentType: string): string {
  const match = url.match(/\.(mp3|m4a|wav|ogg|aac|flac|opus|webm)/i);
  if (match) return match[1].toLowerCase();
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("webm")) return "webm";
  return "mp3";
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function jsonResp(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
