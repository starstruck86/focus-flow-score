import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { Buffer } from "node:buffer";
import pdfParse from "npm:pdf-parse@1.1.1/lib/pdf-parse.js";

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

// Quality thresholds
const MIN_CHARS_SUCCESS = 100;
const MIN_LETTERS = 30;
const NATIVE_PDF_MIN_CHARS = 500;
const NATIVE_PDF_MIN_LETTERS = 100;
const PAGES_PER_CHUNK = 20;
const MIN_PAGES_PER_CHUNK = 1;
const BASE64_CHUNK_SIZE = 0x8000;

// ── MIME / extension mapping ──────────────────────────────
type FileCategory = "pdf" | "text" | "unsupported";

function categoriseFile(storagePath: string, mimeType?: string): { category: FileCategory; ext: string } {
  const ext = storagePath.split(".").pop()?.toLowerCase() || "";
  // Handle Kajabi-style slugs where extension is encoded as suffix (e.g., "filename-pdf")
  const slugMatch = storagePath.match(/[-_](pdf|docx?|pptx?|txt|md|csv)$/i);
  const inferredExt = slugMatch ? slugMatch[1].toLowerCase() : "";
  const effectiveExt = ext.length <= 5 && ext.match(/^[a-z]+$/) ? ext : inferredExt;
  if (effectiveExt === "pdf" || mimeType === "application/pdf") return { category: "pdf", ext: effectiveExt || "pdf" };
  if (["txt", "md", "csv", "json", "xml", "html", "htm", "log", "rtf"].includes(effectiveExt)) return { category: "text", ext: effectiveExt };
  return { category: "unsupported", ext: effectiveExt || ext };
}

// ── Split PDF into chunks of N pages ──────────────────────
async function createPdfChunk(srcDoc: PDFDocument, startPage: number, endPage: number): Promise<Uint8Array> {
  const chunkDoc = await PDFDocument.create();
  const pageIndexes = Array.from({ length: endPage - startPage }, (_, i) => startPage + i);
  const pages = await chunkDoc.copyPages(srcDoc, pageIndexes);

  for (const page of pages) {
    chunkDoc.addPage(page);
  }

  return chunkDoc.save();
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }

  return btoa(binary);
}

function extractTextFromAiResponse(result: any): string {
  const content = result?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function extractBasicPdfStreams(fileBytes: Uint8Array): string {
  const rawText = new TextDecoder("utf-8", { fatal: false }).decode(fileBytes);
  const streams = rawText.match(/stream\r?\n([\s\S]*?)\r?\nendstream/g) || [];

  return streams
    .map((stream) => stream.replace(/stream\r?\n/, "").replace(/\r?\nendstream/, ""))
    .join("\n")
    .trim();
}

function passesNativePdfQuality(text: string): boolean {
  const quality = checkQuality(text);
  return quality.passed && quality.charCount >= NATIVE_PDF_MIN_CHARS && quality.letterCount >= NATIVE_PDF_MIN_LETTERS;
}

async function extractPdfTextNatively(fileBytes: Uint8Array): Promise<string> {
  const result = await pdfParse(Buffer.from(fileBytes));
  return (result?.text || "").trim();
}

// ── Extract text from a single PDF chunk via Gemini Vision ──
async function extractChunkViaVision(
  chunkBytes: Uint8Array,
  apiKey: string,
  chunkLabel: string,
): Promise<string> {
  const base64 = uint8ArrayToBase64(chunkBytes);

  const resp = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Extract ALL text from this PDF document. Preserve headings, bullet points, numbered lists, and paragraph structure. Output plain text only — no markdown formatting, no commentary, no summaries. Just the raw text content." },
          { type: "file", data: base64, mime_type: "application/pdf" },
        ],
      }],
      temperature: 0.1,
      max_tokens: 12000,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[parse-uploaded-file] Vision API error for ${chunkLabel}:`, errText.slice(0, 300));
    throw new Error(`Vision API error for ${chunkLabel}: ${resp.status}`);
  }

  const result = await resp.json();
  return extractTextFromAiResponse(result);
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function shouldRetryWithSmallerChunk(error: unknown): boolean {
  const message = normalizeErrorMessage(error).toLowerCase();
  return ["500", "413", "429", "timeout", "too large", "memory", "limit"].some((token) => message.includes(token));
}

async function extractPdfRangeViaVision(params: {
  srcDoc: PDFDocument;
  apiKey: string;
  startPage: number;
  endPage: number;
  diagnostics: Record<string, unknown>;
}): Promise<string> {
  const { srcDoc, apiKey, startPage, endPage, diagnostics } = params;
  const pageCount = endPage - startPage;
  const label = `pages ${startPage + 1}-${endPage}`;
  const chunkBytes = await createPdfChunk(srcDoc, startPage, endPage);

  try {
    console.log(`[parse-uploaded-file] Extracting ${label} (${pageCount} page${pageCount === 1 ? "" : "s"})...`);
    return await extractChunkViaVision(chunkBytes, apiKey, label);
  } catch (error) {
    const message = normalizeErrorMessage(error);
    const failures = Array.isArray(diagnostics.vision_failures) ? diagnostics.vision_failures as string[] : [];
    failures.push(`${label}: ${message}`);
    diagnostics.vision_failures = failures.slice(-10);

    if (pageCount <= MIN_PAGES_PER_CHUNK || !shouldRetryWithSmallerChunk(error)) {
      throw error;
    }

    const mid = startPage + Math.ceil(pageCount / 2);
    console.log(`[parse-uploaded-file] Retrying ${label} as smaller ranges`);

    const left = await extractPdfRangeViaVision({ srcDoc, apiKey, startPage, endPage: mid, diagnostics });
    const right = await extractPdfRangeViaVision({ srcDoc, apiKey, startPage: mid, endPage, diagnostics });

    return [left, right].filter(Boolean).join("\n\n");
  }
}

// ── Quality check ─────────────────────────────────────────
function checkQuality(text: string): { passed: boolean; reason?: string; charCount: number; letterCount: number } {
  const charCount = text.length;
  const letterCount = (text.match(/[a-zA-Z]/g) || []).length;

  if (charCount < MIN_CHARS_SUCCESS) return { passed: false, reason: "extracted_text_too_short", charCount, letterCount };
  if (letterCount < MIN_LETTERS) return { passed: false, reason: "insufficient_letter_content", charCount, letterCount };

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
      const basicPdfText = extractBasicPdfStreams(fileBytes);
      diagnostics.basic_pdf_stream_length = basicPdfText.length;

      let nativePdfText = "";
      try {
        nativePdfText = await extractPdfTextNatively(fileBytes);
        diagnostics.native_pdf_length = nativePdfText.length;
        diagnostics.native_pdf_quality_passed = passesNativePdfQuality(nativePdfText);
      } catch (nativeErr) {
        diagnostics.native_pdf_error = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
      }

      if (passesNativePdfQuality(nativePdfText)) {
        extractedText = nativePdfText;
        parserUsed = "native_pdf_parse";
      }

      const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
      if (!extractedText && !lovableApiKey) {
        // Fallback: basic stream extraction
        extractedText = basicPdfText;
        parserUsed = "basic_pdf_stream";
      } else if (!extractedText) {
        try {
          const srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
          const totalPages = srcDoc.getPageCount();
          const totalChunks = Math.ceil(totalPages / PAGES_PER_CHUNK);
          diagnostics.total_pages = totalPages;
          diagnostics.chunks_used = totalChunks;

          console.log(`[parse-uploaded-file] Processing ${totalChunks} chunk(s) for resource ${resource_id}`);

          const chunkTexts: string[] = [];
          for (let startPage = 0; startPage < totalPages; startPage += PAGES_PER_CHUNK) {
            const endPage = Math.min(startPage + PAGES_PER_CHUNK, totalPages);
            const text = await extractPdfRangeViaVision({
              srcDoc,
              apiKey: lovableApiKey,
              startPage,
              endPage,
              diagnostics,
            });
            if (text) chunkTexts.push(text);
          }

          extractedText = chunkTexts.join("\n\n");
          parserUsed = totalChunks > 1 ? `gemini_vision_pdf_chunked_${totalChunks}` : "gemini_vision_pdf";
          ocrAttempted = true;

          if (!extractedText.trim() && basicPdfText) {
            extractedText = basicPdfText;
            parserUsed = "basic_pdf_stream_fallback";
          }
        } catch (visionErr) {
          console.error("[parse-uploaded-file] Vision extraction error:", visionErr);
          diagnostics.vision_error = visionErr instanceof Error ? visionErr.message : String(visionErr);
          extractedText = basicPdfText;
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

    // 6. Success — update resource with parsed text, but do NOT mark as enriched.
    // The resource must go through the normal enrichment pipeline to earn deep_enriched.
    await supabase.from("resources").update({
      content: extractedText,
      content_length: extractedText.length,
      enrichment_status: "not_enriched",
      failure_reason: null,
      content_status: "full",
    }).eq("id", resource_id);

    // Log successful attempt
    await supabase.from("enrichment_attempts").insert({
      resource_id,
      user_id: resource.user_id,
      attempt_type: "file_parse",
      strategy: parserUsed,
      result: "success",
      content_found: true,
      content_length_extracted: extractedText.length,
      started_at: diagnostics.started_at as string,
      completed_at: new Date().toISOString(),
    });

    diagnostics.result = "success";
    diagnostics.content_length = extractedText.length;

    return new Response(JSON.stringify({
      success: true,
      content_length: extractedText.length,
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
