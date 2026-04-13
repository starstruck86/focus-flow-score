/**
 * PDF OCR Edge Function
 * Receives base64-encoded page images and uses AI vision to extract text.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { images, page_start, page_end } = await req.json();

    if (!images || !Array.isArray(images) || images.length === 0) {
      return new Response(
        JSON.stringify({ error: "No images provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build vision messages with all page images
    const imageContents = images.map((dataUrl: string, idx: number) => ({
      type: "image_url" as const,
      image_url: { url: dataUrl },
    }));

    const pageRange = page_start === page_end
      ? `page ${page_start}`
      : `pages ${page_start}–${page_end}`;

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
            content: `You are an OCR text extraction assistant. Extract ALL readable text from the provided PDF page images (${pageRange}). 

Rules:
- Preserve the original structure: headings, paragraphs, bullet points, numbered lists
- Use markdown formatting for structure (# for headings, - for bullets, etc.)
- Include ALL text — titles, body text, captions, labels, headers, footers
- If a page has tables, format them as markdown tables
- If a page is mostly blank or has only graphics with no text, output "[No text on this page]"
- Do NOT add commentary or interpretation — only extract what's written
- Separate each page's content with "--- Page N ---" markers`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Extract all text from these ${images.length} PDF page image(s).` },
              ...imageContents,
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited — please try again in a moment" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted — please add funds in Settings > Workspace > Usage" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "AI vision OCR failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const text = result.choices?.[0]?.message?.content || "";

    return new Response(
      JSON.stringify({ text, pages: images.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("pdf-ocr error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
