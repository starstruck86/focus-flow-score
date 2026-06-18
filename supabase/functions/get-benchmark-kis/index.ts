import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const DIMENSIONS = [
  'discovery', 'internal_prospecting', 'stakeholder_navigation',
  'messaging', 'deal_control', 'objection_handling',
  'expansion_strategy', 'c_suite_engagement', 'competitive', 'qualification'
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const benchmarkKIs: Record<string, unknown> = {};

    for (const dim of DIMENSIONS) {
      const { data } = await admin
        .from("knowledge_items")
        .select("id, title, tactic_summary, why_it_matters, when_to_use, example_usage, chapter, spider_dimension, confidence_score")
        .eq("spider_dimension", dim)
        .eq("is_core_ae", true)
        .eq("active", true)
        .order("confidence_score", { ascending: false })
        .limit(100);

      if (data && data.length > 0) {
        const randomIdx = Math.floor(Math.random() * data.length);
        benchmarkKIs[dim] = data[randomIdx];
      }
    }

    return new Response(JSON.stringify({ benchmarkKIs }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("get-benchmark-kis error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
