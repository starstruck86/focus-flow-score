import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

// Quality thresholds
const MIN_CHARS_SUCCESS = 100;
const MIN_LETTERS = 30;

// ── MIME / extension mapping ──────────────────────────────
type FileCategory = "pdf" | "text" | "unsupported";

function categoriseFile(storagePath: string, mimeType?: string): { category: FileCategory; ext: string } {
  const ext = storagePath.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf" || mimeType === "application/pdf") return { category: "pdf", ext };
  if (["txt", "md", "csv", "json", "xml", "html", "htm", "log", "rtf"].includes(ext)) return { category: "text", ext };
  // DOCX / PPTX would need specialised parsing — flag as unsupported for now
  // (browser-side JS can't parse these reliably; future: add server-side parser)
  return { category: "unsupported", ext };
}

// ── PDF text extraction via Gemini Vision ─────────────────
async function extractPdfViaVision(pdfBytes: Uint8Array, apiKey: string): Promise<{ text: string; method: string }> {
  const base64 = btoa(String.fromCharCode(...pdfBytes));

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "Extract ALL text from this document. Preserve headings, bullet points, and paragraph structure. Output plain text only — no markdown formatting, no commentary." },
            { inline_data: { mime_type: "application/pdf", data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0.1 },
      }),
    },
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini Vision API error ${resp.status}: ${err.slice(0, 300)}`);
  }

  const result = await resp.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return { text, method: "gemini_vision_ocr" };
}

// ── Quality check ─────────────────────────────────────────
function checkQuality(text: string): { passed: boolean; reason?: string; charCount: number; letterCount: number } {
  const charCount = text.length;
  const letterCount = (text.match(/[a-zA-Z]/g) || []).length;

  if (charCount < MIN_CHARS_SUCCESS) return { passed: false, reason: "extracted_text_too_short", charCount, letterCount };
  if (letterCount < MIN_LETTERS) return { passed: false, reason: "insufficient_letter_content", charCount, letterCount };

  // Check for junk patterns
  const junkRatio = (text.match(/[^\x20-\x7E\n\r\t]/g) || []).length / charCount;
  if (junkRatio > 0.4) return { passed: false, reason: "corrupted_or_binary_content", charCount, letterCount };

  return { passed: true, charCount, letterCount };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { resource_id } = await req.json();
    if (!resource_id) {
      return new Response(JSON.stringify({ error: "resource_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Load resource
    const { data: resource, error: resErr } = await supabase
      .from("resources")
      .select("id, user_id, title, file_url, enrichment_status, resource_type")
      .eq("id", resource_id)
      .single();

    if (resErr || !resource) {
      return new Response(JSON.stringify({ error: "Resource not found", details: resErr?.message }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const storagePath = resource.file_url;
    if (!storagePath || storagePath.startsWith("http")) {
      return new Response(JSON.stringify({
        error: "not_uploaded_file",
        message: "This resource is URL-backed, not an uploaded file. Use web enrichment instead.",
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const diagnostics: Record<string, unknown> = {
      resource_id,
      storage_path: storagePath,
      started_at: new Date().toISOString(),
    };

    // 2. Categorise file
    const { category, ext } = categoriseFile(storagePath);
    diagnostics.file_extension = ext;
    diagnostics.file_category = category;

    if (category === "unsupported") {
      // Update resource with specific quarantine reason
      await supabase.from("resources").update({
        failure_reason: `Unsupported file type: .${ext}. Only PDF and text files are currently supported for parsing.`,
        enrichment_status: "failed",
      }).eq("id", resource_id);

      diagnostics.result = "unsupported_type";
      return new Response(JSON.stringify({ success: false, diagnostics }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Download file from storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("resource-files")
      .download(storagePath);

    if (dlErr || !fileData) {
      await supabase.from("resources").update({
        failure_reason: "File missing from storage. The original upload may have been deleted or corrupted.",
        enrichment_status: "failed",
      }).eq("id", resource_id);

      diagnostics.result = "file_missing_from_storage";
      diagnostics.error = dlErr?.message;
      return new Response(JSON.stringify({ success: false, diagnostics }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    diagnostics.file_size_bytes = fileBytes.length;

    // 4. Parse based on category
    let extractedText = "";
    let parserUsed = "none";
    let ocrAttempted = false;

    if (category === "text") {
      extractedText = new TextDecoder().decode(fileBytes);
      parserUsed = "text_decoder";
    } else if (category === "pdf") {
      // Use Gemini Vision for PDF extraction (handles both native text and scanned PDFs)
      const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
      if (!lovableApiKey) {
        // Fallback: try basic text extraction from PDF bytes
        const rawText = new TextDecoder("utf-8", { fatal: false }).decode(fileBytes);
        // Try to extract text between stream markers (very basic)
        const streams = rawText.match(/stream\r?\n([\s\S]*?)\r?\nendstream/g) || [];
        extractedText = streams.map(s => s.replace(/stream\r?\n/, "").replace(/\r?\nendstream/, "")).join("\n");
        parserUsed = "basic_pdf_stream";
      } else {
        try {
          // Use Gemini Vision via Lovable AI proxy for PDF parsing
          const visionResp = await fetch("https://ai.lovable.dev/api/chat", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${lovableApiKey}`,
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [{
                role: "user",
                content: [
                  { type: "text", text: "Extract ALL text from this PDF document. Preserve headings, bullet points, numbered lists, and paragraph structure. Output plain text only — no markdown formatting, no commentary, no summaries. Just the raw text content." },
                  { type: "file", data: btoa(String.fromCharCode(...fileBytes)), mime_type: "application/pdf" },
                ],
              }],
              temperature: 0.1,
            }),
          });

          if (visionResp.ok) {
            const visionResult = await visionResp.json();
            extractedText = visionResult?.choices?.[0]?.message?.content || "";
            parserUsed = "gemini_vision_pdf";
            ocrAttempted = true; // Vision handles both native and scanned
          } else {
            const errText = await visionResp.text();
            console.error("[parse-uploaded-file] Vision API error:", errText.slice(0, 300));
            parserUsed = "vision_failed";
          }
        } catch (visionErr) {
          console.error("[parse-uploaded-file] Vision extraction error:", visionErr);
          parserUsed = "vision_exception";
        }
      }
    }

    diagnostics.parser_used = parserUsed;
    diagnostics.ocr_attempted = ocrAttempted;
    diagnostics.extracted_length = extractedText.length;

    // 5. Quality gate
    const quality = checkQuality(extractedText);
    diagnostics.quality = quality;

    if (!quality.passed) {
      const reasonMap: Record<string, string> = {
        extracted_text_too_short: `PDF parser returned insufficient text (${quality.charCount} chars). The file may be scanned/image-based or password-protected.`,
        insufficient_letter_content: `Extracted content has very few readable characters. The file may be corrupted or image-based.`,
        corrupted_or_binary_content: `Extracted content appears corrupted or contains mostly non-text data.`,
      };

      await supabase.from("resources").update({
        failure_reason: reasonMap[quality.reason || ""] || `Parse failed: ${quality.reason}`,
        enrichment_status: "failed",
      }).eq("id", resource_id);

      diagnostics.result = "quality_gate_failed";

      // Log the attempt
      await supabase.from("enrichment_attempts").insert({
        resource_id,
        user_id: resource.user_id,
        attempt_type: "file_parse",
        strategy: parserUsed,
        result: "failed",
        content_found: false,
        content_length_extracted: quality.charCount,
        error_message: quality.reason,
        failure_category: "failed_quality",
        started_at: diagnostics.started_at as string,
        completed_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({ success: false, diagnostics }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 6. Success — update resource
    const trimmedContent = extractedText.slice(0, 60000); // Cap content

    await supabase.from("resources").update({
      content: trimmedContent,
      content_length: trimmedContent.length,
      enrichment_status: "deep_enriched",
      failure_reason: null,
      content_status: "content",
    }).eq("id", resource_id);

    // Log successful attempt
    await supabase.from("enrichment_attempts").insert({
      resource_id,
      user_id: resource.user_id,
      attempt_type: "file_parse",
      strategy: parserUsed,
      result: "success",
      content_found: true,
      content_length_extracted: trimmedContent.length,
      started_at: diagnostics.started_at as string,
      completed_at: new Date().toISOString(),
    });

    diagnostics.result = "success";
    diagnostics.content_length = trimmedContent.length;

    return new Response(JSON.stringify({
      success: true,
      content_length: trimmedContent.length,
      parser_used: parserUsed,
      ocr_attempted: ocrAttempted,
      diagnostics,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[parse-uploaded-file] Unhandled error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
