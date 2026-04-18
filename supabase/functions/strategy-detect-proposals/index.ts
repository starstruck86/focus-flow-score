// strategy-detect-proposals
// Phase 3 detector: scans assistant content / artifact content and surfaces
// promotable discoveries as `strategy_promotion_proposals` rows.
//
// Hard rules:
//   - NEVER writes to shared system-of-record tables. That is Phase 4 (promoter).
//   - NEVER auto-confirms. All proposals are status='pending'.
//   - Always preserves provenance (thread_id, source_message_id or source_artifact_id).
//   - Dedupes per (thread, type, dedupe_key) so re-runs don't spam.
//   - If thread is freeform (no linked account/opp), proposals still get created
//     but with target_account_id/target_opportunity_id NULL — the review UI then
//     forces explicit target selection before confirmation.
//
// Detection model: structured-output extraction via Lovable AI gateway.
// Deterministic-ish: temperature 0, schema-validated, and we slug dedupe keys.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DETECTOR_VERSION = "v1";

// ── Types ────────────────────────────────────────────────────────────────────

type ProposalType =
  | "contact"
  | "account_note"
  | "account_intelligence"
  | "opportunity_note"
  | "opportunity_intelligence"
  | "transcript"
  | "resource_promotion"
  | "artifact_promotion"
  | "stakeholder"
  | "risk"
  | "blocker"
  | "champion";

type Scope = "account" | "opportunity" | "both";

interface DetectedProposal {
  proposal_type: ProposalType;
  target_scope: Scope;
  payload: Record<string, unknown>;
  rationale: string;
  scope_rationale: string;
  dedupe_seed: string;        // we hash this into dedupe_key
  detector_confidence: number; // 0..1
}

interface DetectorRequest {
  thread_id: string;
  source_message_id?: string;
  source_artifact_id?: string;
  content: string;          // text the detector should scan
  artifact_type?: string;   // if scanning an artifact
  artifact_title?: string;
}

// ── Mapping: proposal_type -> target_table ───────────────────────────────────
// (target_table is what the Phase 4 promoter will use; we just record intent here.)
const TARGET_TABLE: Record<ProposalType, string> = {
  contact: "contacts",
  account_note: "accounts",          // appended to accounts.notes by promoter
  account_intelligence: "account_strategy_memory",
  opportunity_note: "opportunities",
  opportunity_intelligence: "opportunity_strategy_memory",
  transcript: "call_transcripts",
  resource_promotion: "resources",
  artifact_promotion: "resources",
  stakeholder: "contacts",
  risk: "opportunity_strategy_memory",
  blocker: "opportunity_strategy_memory",
  champion: "contacts",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function sha1(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function buildDetectorPrompt(input: DetectorRequest, threadCtx: { hasAccount: boolean; hasOpp: boolean; accountName?: string; oppName?: string }) {
  const scopeHint = !threadCtx.hasAccount && !threadCtx.hasOpp
    ? "This thread is FREEFORM (no linked account or opportunity). Propose scope based on content alone; the user will confirm the target later."
    : `Linked context: ${threadCtx.hasAccount ? `account="${threadCtx.accountName}"` : "no account"}, ${threadCtx.hasOpp ? `opportunity="${threadCtx.oppName}"` : "no opportunity"}.`;

  return `You are a discovery detector for a sales-intelligence system. Read the SALES STRATEGY CONTENT below and extract EVERY concrete, promotable discovery a rep would want pushed back into shared CRM tables.

${scopeHint}

# CRITICAL EXTRACTION RULES

1. NAMED PEOPLE ARE ALWAYS A SEPARATE PROPOSAL.
   - Whenever a real person is named (first + last, or first + role), emit a "contact" or "stakeholder" or "champion" proposal for that person — EVEN IF that person also appears in a risk, blocker, or note.
   - A risk like "Matthew said this is not a fit" must produce TWO proposals: (a) contact "Matthew <Lastname>" with title if known, and (b) the risk itself.
   - Never collapse a named person into a risk-only record. Names are first-class.
   - Use "champion" only with explicit positive signal. Use "stakeholder" for buying-committee members. Default to "contact" otherwise.

2. EACH FACT IS ONE PROPOSAL. Don't merge unrelated facts.

3. SKIP:
   - generic sales advice
   - rep's own questions/plans (those are workflow, not intelligence)
   - speculation ("they might…", "they could…")
   - rephrasing of context already in the conversation

4. PAYLOAD SHAPES (be exact):
   - contact / stakeholder / champion: { name, title?, email?, department?, seniority?, notes? }
   - account_note / account_intelligence / opportunity_note / opportunity_intelligence: { content, memory_type? }
   - risk / blocker: { content }
   - transcript: { title, content, summary?, call_date? }
   - resource_promotion / artifact_promotion: { title, content, description?, resource_type?, tags? }

5. SCOPE DISCIPLINE:
   - Use "account" for tech stack, company strategy, org structure — anything true about the company independent of a single deal.
   - Use "opportunity" only when clearly about ONE deal (specific timeline, pricing, single buying motion).
   - Use "both" sparingly — only when the fact is materially needed at both levels.

6. RATIONALE / SCOPE_RATIONALE: each ONE short sentence (<140 chars).

7. dedupe_seed: stable identifier — for contacts use lowercased "name|title"; for notes use the first 80 chars of the content; for risks use the risk subject.

8. detector_confidence: be honest. Named contacts pulled from clear text → 0.85+. Inferred facts → 0.5-0.7.

Return JSON: { "proposals": [...] }. Empty array if nothing meaningful.

# CONTENT
"""
${input.content.slice(0, 8000)}
"""`;
}

async function callLLMForExtraction(prompt: string): Promise<DetectedProposal[]> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    console.warn("[detector] LOVABLE_API_KEY missing; returning empty proposals");
    return [];
  }

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You output strict JSON. No prose." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  if (!resp.ok) {
    console.error("[detector] LLM call failed", resp.status, await resp.text().catch(() => ""));
    return [];
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content ?? "{}";
  console.log("[detector] raw LLM output (first 2k):", text.slice(0, 2000));
  try {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
    console.log("[detector] parsed proposals count:", arr.length);
    return arr.filter((p: any) =>
      p && typeof p.proposal_type === "string" &&
      typeof p.target_scope === "string" &&
      p.payload && typeof p.dedupe_seed === "string"
    );
  } catch (e) {
    console.error("[detector] JSON parse failed", e, "raw:", text.slice(0, 500));
    return [];
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as DetectorRequest;
    if (!body?.thread_id || !body?.content) {
      return new Response(JSON.stringify({ error: "thread_id and content required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load thread + linked context
    const { data: thread, error: threadErr } = await supabase
      .from("strategy_threads")
      .select("id, user_id, linked_account_id, linked_opportunity_id")
      .eq("id", body.thread_id)
      .maybeSingle();

    if (threadErr || !thread) {
      return new Response(JSON.stringify({ error: "thread not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accountName: string | undefined;
    let oppName: string | undefined;
    if (thread.linked_account_id) {
      const { data: a } = await supabase.from("accounts").select("name").eq("id", thread.linked_account_id).maybeSingle();
      accountName = a?.name;
    }
    if (thread.linked_opportunity_id) {
      const { data: o } = await supabase.from("opportunities").select("name").eq("id", thread.linked_opportunity_id).maybeSingle();
      oppName = o?.name;
    }

    const prompt = buildDetectorPrompt(body, {
      hasAccount: !!thread.linked_account_id,
      hasOpp: !!thread.linked_opportunity_id,
      accountName, oppName,
    });

    const detected = await callLLMForExtraction(prompt);

    if (detected.length === 0) {
      return new Response(JSON.stringify({ created: 0, proposals: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build rows
    const rows = await Promise.all(detected.map(async (d) => {
      const dedupe_key = await sha1(`${d.proposal_type}:${d.dedupe_seed.toLowerCase().trim()}`);

      // Scope-aware target IDs (only when linked AND scope agrees)
      let target_account_id: string | null = null;
      let target_opportunity_id: string | null = null;
      if (d.target_scope === "account" || d.target_scope === "both") {
        target_account_id = thread.linked_account_id ?? null;
      }
      if (d.target_scope === "opportunity" || d.target_scope === "both") {
        target_opportunity_id = thread.linked_opportunity_id ?? null;
      }

      return {
        user_id: thread.user_id,
        thread_id: thread.id,
        source_message_id: body.source_message_id ?? null,
        source_artifact_id: body.source_artifact_id ?? null,
        proposal_type: d.proposal_type,
        target_table: TARGET_TABLE[d.proposal_type] ?? "unknown",
        target_scope: d.target_scope,
        target_account_id,
        target_opportunity_id,
        payload_json: d.payload ?? {},
        rationale: d.rationale ?? null,
        scope_rationale: d.scope_rationale ?? null,
        dedupe_key,
        detector_version: DETECTOR_VERSION,
        detector_confidence: typeof d.detector_confidence === "number"
          ? Math.max(0, Math.min(1, d.detector_confidence))
          : null,
        status: "pending" as const,
      };
    }));

    // Pre-filter against the partial unique index
    // (thread_id, proposal_type, dedupe_key) WHERE status IN ('pending','confirmed').
    // We cannot use ON CONFLICT against a partial index, so we check first.
    const dedupeKeys = rows.map((r) => r.dedupe_key);
    const { data: existing } = await supabase
      .from("strategy_promotion_proposals")
      .select("proposal_type, dedupe_key")
      .eq("thread_id", thread.id)
      .in("status", ["pending", "confirmed"])
      .in("dedupe_key", dedupeKeys);

    const existingSet = new Set((existing ?? []).map((r: any) => `${r.proposal_type}|${r.dedupe_key}`));
    const fresh = rows.filter((r) => !existingSet.has(`${r.proposal_type}|${r.dedupe_key}`));

    if (fresh.length === 0) {
      return new Response(JSON.stringify({ created: 0, proposals: [], skipped_duplicates: rows.length }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("strategy_promotion_proposals")
      .insert(fresh)
      .select("id, proposal_type, target_scope, dedupe_key");

    if (insertErr) {
      console.error("[detector] insert failed", insertErr);
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ created: inserted?.length ?? 0, proposals: inserted ?? [], skipped_duplicates: rows.length - fresh.length }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[detector] unhandled", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
