// Admin probe: runs retrieveResourceContext for a given userId+message and
// returns the raw retrieval object. Gated by STRATEGY_VALIDATION_KEY.
// Purpose: prove whether retrieval is empty at the source vs lost in persistence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { retrieveResourceContext, inferTopicScopes } from "../_shared/strategy-core/resourceRetrieval.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-strategy-validation-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const key = req.headers.get("x-strategy-validation-key");
  const expected = Deno.env.get("STRATEGY_VALIDATION_KEY");
  if (!expected || key !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const userId: string = body?.userId;
  const prompts: string[] = Array.isArray(body?.prompts) ? body.prompts : [body?.prompt];
  if (!userId || !prompts?.length) {
    return new Response(JSON.stringify({ error: "userId and prompts[] required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const results = [];
  for (const p of prompts) {
    const topics = inferTopicScopes(p);
    let result: any = null;
    let err: string | null = null;
    try {
      const r = await retrieveResourceContext(sb as any, userId, { userMessage: p });
      result = {
        userAskedForResource: r.userAskedForResource,
        userAskedForTopic: r.userAskedForTopic,
        inferredTopics: r.inferredTopics,
        inferredCategories: r.inferredCategories,
        extractedPhrases: r.extractedPhrases,
        hits_count: r.hits.length,
        kiHits_count: r.kiHits.length,
        first_hits: r.hits.slice(0, 6).map((h) => ({
          id: h.id, title: h.title, matchKind: h.matchKind, matchReason: h.matchReason,
        })),
        first_kiHits: r.kiHits.slice(0, 6).map((h) => ({
          id: h.id, title: h.title, chapter: h.chapter, matchKind: h.matchKind, matchReason: h.matchReason,
        })),
        debug_resourceHits_count: r.debug.resourceHits.length,
        debug_kiHits_count: r.debug.kiHits.length,
      };
    } catch (e) {
      err = (e as Error).message;
    }
    results.push({ prompt: p, inferredTopicsPreCall: topics, error: err, retrieval: result });
  }

  return new Response(JSON.stringify({ ok: true, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
