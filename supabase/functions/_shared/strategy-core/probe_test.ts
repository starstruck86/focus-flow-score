// Probe: run retrieveResourceContext against real DB for failing prompts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { retrieveResourceContext, inferTopicScopes } from "./resourceRetrieval.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const USER_ID = Deno.env.get("PROBE_USER_ID")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const PROMPTS = [
  "Using my cold-call and discovery resources, build me a framework for opening enterprise calls.",
  "Using my resources, build a framework for detecting fake executive confidence in biotech M&A sales cycles.",
  "Using my resources, write a CFO-facing renewal memo for healthcare.",
];

Deno.test({
  name: "PROBE: retrieveResourceContext on failing prompts",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    for (const p of PROMPTS) {
      const topics = inferTopicScopes(p);
      const r = await retrieveResourceContext(sb as any, USER_ID, { userMessage: p });
      console.log("\n=== PROMPT ===\n" + p);
      console.log("inferredTopics:", topics);
      console.log("hits:", r.hits.length, "kiHits:", r.kiHits.length);
      console.log("first 5 hits:", r.hits.slice(0, 5).map((h) => ({ t: h.title.slice(0, 60), kind: h.matchKind, reason: h.matchReason })));
      console.log("first 5 KIs:", r.kiHits.slice(0, 5).map((h) => ({ t: h.title.slice(0, 60), ch: h.chapter, kind: h.matchKind })));
      console.log("debug.kiHits.length:", r.debug.kiHits.length, "debug.resourceHits.length:", r.debug.resourceHits.length);
    }
  },
});
