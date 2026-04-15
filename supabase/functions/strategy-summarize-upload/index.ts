import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      userId = user?.id ?? null;
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { uploadId } = await req.json();
    if (!uploadId) {
      return new Response(JSON.stringify({ error: "uploadId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the upload record
    const { data: upload, error: fetchErr } = await supabase
      .from("strategy_uploaded_resources")
      .select("*")
      .eq("id", uploadId)
      .eq("user_id", userId)
      .single();

    if (fetchErr || !upload) {
      return new Response(JSON.stringify({ error: "Upload not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsedText = upload.parsed_text;
    if (!parsedText || parsedText.length < 50) {
      return new Response(JSON.stringify({ error: "No parsed text available for summarization" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Generate summary + key points + entities via tool calling
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You are analyzing an uploaded document. Extract a concise summary, key points, and named entities (companies, people, products)." },
          { role: "user", content: `Analyze this document:\n\n${parsedText.slice(0, 8000)}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "document_analysis",
            description: "Return structured document analysis.",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string", description: "2-3 sentence summary" },
                key_points: { type: "array", items: { type: "string" }, description: "5-8 key points" },
                entities: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      type: { type: "string", enum: ["company", "person", "product", "technology", "concept"] },
                    },
                    required: ["name", "type"],
                    additionalProperties: false,
                  },
                },
                document_type: { type: "string", enum: ["report", "email", "presentation", "spreadsheet", "article", "transcript", "notes", "other"] },
              },
              required: ["summary", "key_points", "entities", "document_type"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "document_analysis" } },
        temperature: 0.2,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI summarize error:", aiResp.status, errText);
      return new Response(JSON.stringify({ error: `Summarization failed: ${aiResp.status}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResp.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    let analysis: any = null;
    if (toolCall?.function?.arguments) {
      try {
        analysis = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error("Failed to parse analysis:", e);
      }
    }

    if (!analysis) {
      return new Response(JSON.stringify({ error: "Failed to generate analysis" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update the upload record
    const { error: updateErr } = await supabase
      .from("strategy_uploaded_resources")
      .update({
        summary: analysis.summary,
        metadata_json: {
          key_points: analysis.key_points,
          entities: analysis.entities,
          document_type: analysis.document_type,
          parse_quality: parsedText.length > 500 ? "good" : "partial",
          summarized_at: new Date().toISOString(),
        },
      })
      .eq("id", uploadId);

    if (updateErr) {
      console.error("Failed to save analysis:", updateErr);
      return new Response(JSON.stringify({ error: "Failed to save analysis" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[summarize-upload] ${uploadId}: summary=${analysis.summary?.length}chars entities=${analysis.entities?.length}`);

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("strategy-summarize-upload error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
