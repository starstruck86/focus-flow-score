// Probe: run retrieveResourceContext against real DB for failing prompts.
//
// W11 — env-safe guard:
//   This probe is only meaningful when SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY, and PROBE_USER_ID are all set. In CI /
//   local runs without those vars, the previous version crashed at
//   module load (`Deno.env.get(...)!`), which broke unrelated tests in
//   the same suite. We now defer all env access into the test body and
//   `ignore` the test when prerequisites are missing so the broader
//   strategy-core suite can run cleanly without live Supabase access.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { retrieveResourceContext, inferTopicScopes } from "./resourceRetrieval.ts";

const PROMPTS = [
  "Using my cold-call and discovery resources, build me a framework for opening enterprise calls.",
  "Using my resources, build a framework for detecting fake executive confidence in biotech M&A sales cycles.",
  "Using my resources, write a CFO-facing renewal memo for healthcare.",
];

function readEnv(): {
  url: string | undefined;
  key: string | undefined;
  userId: string | undefined;
} {
  return {
    url: Deno.env.get("SUPABASE_URL") ?? undefined,
    key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? undefined,
    userId: Deno.env.get("PROBE_USER_ID") ?? undefined,
  };
}

const env = readEnv();
const hasEnv = Boolean(env.url && env.key && env.userId);

Deno.test({
  name: "PROBE: retrieveResourceContext on failing prompts",
  ignore: !hasEnv,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const sb = createClient(env.url!, env.key!, {
      auth: { persistSession: false },
    });
    for (const p of PROMPTS) {
      const topics = inferTopicScopes(p);
      const r = await retrieveResourceContext(sb as any, env.userId!, { userMessage: p });
      console.log("\n=== PROMPT ===\n" + p);
      console.log("inferredTopics:", topics);
      console.log("hits:", r.hits.length, "kiHits:", r.kiHits.length);
      console.log("first 5 hits:", r.hits.slice(0, 5).map((h) => ({ t: h.title.slice(0, 60), kind: h.matchKind, reason: h.matchReason })));
      console.log("first 5 KIs:", r.kiHits.slice(0, 5).map((h) => ({ t: h.title.slice(0, 60), ch: h.chapter, kind: h.matchKind })));
      console.log("debug.kiHits.length:", r.debug.kiHits.length, "debug.resourceHits.length:", r.debug.resourceHits.length);
    }
  },
});

// W11 — Always-on safety test: confirms the probe module loads without
// env vars and degrades to `ignore` instead of throwing.
Deno.test("PROBE: env-safe load (no live Supabase required)", () => {
  const e = readEnv();
  // Module loaded successfully — assertion is implicit. We also assert
  // the env reader returns a defined object even when vars are absent.
  if (typeof e !== "object" || e === null) {
    throw new Error("readEnv() must return an object");
  }
});
