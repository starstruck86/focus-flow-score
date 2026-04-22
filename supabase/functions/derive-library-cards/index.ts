// ════════════════════════════════════════════════════════════════
// derive-library-cards — batch derivation of LibraryCard rows
// from knowledge_items and playbooks. Idempotent, rerunnable.
//
// Body:
//   { user_id?: string, source_type?: "knowledge_item"|"playbook"|"both",
//     limit?: number, derivation_version?: number }
//
// Behavior:
//   - Defaults to caller's user_id, source_type="both", limit=50.
//   - Skips rows that already have library_role set AND a card at
//     the current derivation_version.
//   - On model failure for a row, logs and continues (never throws).
//   - Returns counts of processed/upserted/skipped/failed.
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLovableAI, safeParseJSON } from "../_shared/strategy-orchestrator/providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

type LibraryRole = "standard" | "tactic" | "pattern" | "exemplar";
type SourceType = "knowledge_item" | "playbook";

const CURRENT_DERIVATION_VERSION = 1;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT =
  `You convert ONE sales knowledge source into ONE Library Card.

Output MUST be valid JSON matching the schema. No prose, no markdown fences, no preamble.

Be concrete and action-oriented. Avoid generic SaaS platitudes. The "the_move" field
is the operational verb — what to do, in <=120 words. "example_snippet" must be a
short verbatim quote (<=40 words) from the source if and only if a useful one exists.

Library role definitions:
- "tactic":   a specific repeatable move (e.g. "anchor pricing on outcome", "qualify with PPP").
- "pattern":  a recurring buyer/deal/objection pattern with a recommended response.
- "exemplar": a concrete worked example or transcript snippet illustrating a move.
- "standard": general guidance / framework / principle that doesn't fit the above.

Confidence: 0..1. Use 0.4 if the source is thin or ambiguous; 0.9 if it contains a
named, repeatable move with clear when-to-use.`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "library_role",
    "title",
    "when_to_use",
    "the_move",
    "why_it_works",
    "anti_patterns",
    "example_snippet",
    "applies_to_contexts",
    "confidence",
  ],
  properties: {
    library_role: { type: "string", enum: ["standard", "tactic", "pattern", "exemplar"] },
    title: { type: "string", minLength: 3, maxLength: 160 },
    when_to_use: { type: ["string", "null"], maxLength: 400 },
    the_move: { type: "string", minLength: 8, maxLength: 1200 },
    why_it_works: { type: ["string", "null"], maxLength: 600 },
    anti_patterns: { type: ["array", "null"], items: { type: "string", maxLength: 200 }, maxItems: 6 },
    example_snippet: { type: ["string", "null"], maxLength: 320 },
    applies_to_contexts: { type: ["array", "null"], items: { type: "string", maxLength: 80 }, maxItems: 12 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

function buildUserPrompt(sourceType: SourceType, row: Record<string, unknown>): string {
  // Compact serialization — only fields that actually carry signal.
  const pickKnowledge = [
    "title", "chapter", "knowledge_type", "tactic_summary", "why_it_matters",
    "when_to_use", "how_to_execute", "framework", "anti_patterns", "key_questions",
    "confidence_score",
  ];
  const pickPlaybook = [
    "title", "problem_type", "when_to_use", "why_it_matters", "tactic_steps",
    "talk_tracks", "key_questions", "traps", "anti_patterns",
    "what_great_looks_like", "common_mistakes", "confidence_score",
  ];
  const keys = sourceType === "knowledge_item" ? pickKnowledge : pickPlaybook;
  const compact: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (row as any)[k];
    if (v !== null && v !== undefined && v !== "") compact[k] = v;
  }

  return `SOURCE_TYPE: ${sourceType}
SOURCE_ID: ${(row as any).id}
SOURCE_BODY:
${JSON.stringify(compact, null, 2)}

Return ONLY the JSON object conforming to the schema.`;
}

interface DerivedCard {
  library_role: LibraryRole;
  title: string;
  when_to_use: string | null;
  the_move: string;
  why_it_works: string | null;
  anti_patterns: string[] | null;
  example_snippet: string | null;
  applies_to_contexts: string[] | null;
  confidence: number;
}

function validateDerived(parsed: unknown): DerivedCard | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  const role = p.library_role;
  if (role !== "standard" && role !== "tactic" && role !== "pattern" && role !== "exemplar") return null;
  if (typeof p.title !== "string" || p.title.length < 3) return null;
  if (typeof p.the_move !== "string" || p.the_move.length < 8) return null;
  const conf = typeof p.confidence === "number" ? p.confidence : 0.5;
  return {
    library_role: role,
    title: p.title.slice(0, 160),
    when_to_use: typeof p.when_to_use === "string" ? p.when_to_use.slice(0, 400) : null,
    the_move: p.the_move.slice(0, 1200),
    why_it_works: typeof p.why_it_works === "string" ? p.why_it_works.slice(0, 600) : null,
    anti_patterns: Array.isArray(p.anti_patterns)
      ? p.anti_patterns.filter((s) => typeof s === "string").slice(0, 6) as string[]
      : null,
    example_snippet: typeof p.example_snippet === "string" ? p.example_snippet.slice(0, 320) : null,
    applies_to_contexts: Array.isArray(p.applies_to_contexts)
      ? p.applies_to_contexts.filter((s) => typeof s === "string").slice(0, 12) as string[]
      : null,
    confidence: Math.max(0, Math.min(1, conf)),
  };
}

async function deriveOne(sourceType: SourceType, row: Record<string, unknown>): Promise<DerivedCard | null> {
  try {
    // NOTE: callLovableAI does not surface response_format; schema is enforced via
    // (a) explicit JSON-only system prompt and (b) validateDerived() below.
    // RESPONSE_SCHEMA is kept inline as documentation + future strict-mode upgrade.
    void RESPONSE_SCHEMA;
    const raw = await callLovableAI([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(sourceType, row) },
    ], {
      model: "google/gemini-2.5-flash",
      temperature: 0.2,
      maxTokens: 1200,
    });
    const parsed = safeParseJSON<unknown>(raw);
    return validateDerived(parsed);
  } catch (e) {
    console.warn(`[derive-library-cards] model error for ${sourceType} ${(row as any).id}:`, (e as Error).message);
    return null;
  }
}

interface ProcessOutcome {
  processed: number;
  upserted: number;
  skipped: number;
  failed: number;
}

async function processSourceType(
  supabase: any,
  userId: string,
  sourceType: SourceType,
  limit: number,
  derivationVersion: number,
): Promise<ProcessOutcome> {
  const tableName = sourceType === "knowledge_item" ? "knowledge_items" : "playbooks";
  const selectCols = sourceType === "knowledge_item"
    ? "id, title, chapter, knowledge_type, tactic_summary, why_it_matters, when_to_use, how_to_execute, framework, anti_patterns, key_questions, confidence_score, library_role, active"
    : "id, title, problem_type, when_to_use, why_it_matters, tactic_steps, talk_tracks, key_questions, traps, anti_patterns, what_great_looks_like, common_mistakes, confidence_score, library_role";

  let query = supabase.from(tableName).select(selectCols).eq("user_id", userId).limit(limit);
  if (sourceType === "knowledge_item") query = query.eq("active", true);

  const { data: rows, error } = await query;
  if (error) {
    console.warn(`[derive-library-cards] fetch ${tableName} error:`, error.message);
    return { processed: 0, upserted: 0, skipped: 0, failed: 0 };
  }
  if (!rows || rows.length === 0) return { processed: 0, upserted: 0, skipped: 0, failed: 0 };

  // Determine which rows already have a card at the current derivation_version.
  const rowIds = rows.map((r: any) => r.id);
  const { data: existing } = await supabase
    .from("library_cards")
    .select("source_type, source_ids, derivation_version")
    .eq("user_id", userId)
    .eq("source_type", sourceType)
    .eq("derivation_version", derivationVersion)
    .overlaps("source_ids", rowIds);

  const alreadyDone = new Set<string>();
  for (const c of existing || []) {
    for (const sid of (c as any).source_ids || []) alreadyDone.add(sid);
  }

  const outcome: ProcessOutcome = { processed: 0, upserted: 0, skipped: 0, failed: 0 };
  for (const row of rows as any[]) {
    outcome.processed += 1;
    if (alreadyDone.has(row.id) && row.library_role) {
      outcome.skipped += 1;
      continue;
    }

    const derived = await deriveOne(sourceType, row);
    if (!derived) {
      outcome.failed += 1;
      continue;
    }

    // Upsert card.
    const { error: insertErr } = await supabase.from("library_cards").insert({
      user_id: userId,
      source_type: sourceType,
      source_ids: [row.id],
      library_role: derived.library_role,
      title: derived.title,
      when_to_use: derived.when_to_use,
      the_move: derived.the_move,
      why_it_works: derived.why_it_works,
      anti_patterns: derived.anti_patterns,
      example_snippet: derived.example_snippet,
      applies_to_contexts: derived.applies_to_contexts,
      confidence: derived.confidence,
      derivation_version: derivationVersion,
    });
    if (insertErr) {
      console.warn(`[derive-library-cards] insert error for ${sourceType} ${row.id}:`, insertErr.message);
      outcome.failed += 1;
      continue;
    }

    // Backfill library_role on the source row if missing.
    if (!row.library_role) {
      const { error: roleErr } = await supabase
        .from(tableName)
        .update({ library_role: derived.library_role })
        .eq("id", row.id)
        .eq("user_id", userId);
      if (roleErr) {
        console.warn(`[derive-library-cards] role backfill error for ${tableName} ${row.id}:`, roleErr.message);
      }
    }

    outcome.upserted += 1;
  }
  return outcome;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const targetUserId = (typeof (body as any).user_id === "string" && (body as any).user_id) || user.id;
    if (targetUserId !== user.id) {
      // Only allow self-derivation in this cycle; admin variants belong to a separate function.
      return jsonResponse({ error: "Cross-user derivation not permitted" }, 403);
    }

    const requestedSource = (body as any).source_type;
    const sources: SourceType[] =
      requestedSource === "knowledge_item" ? ["knowledge_item"] :
      requestedSource === "playbook" ? ["playbook"] :
      ["knowledge_item", "playbook"];

    const limitRaw = Number((body as any).limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;

    const versionRaw = Number((body as any).derivation_version);
    const derivationVersion = Number.isFinite(versionRaw) && versionRaw > 0 ? Math.floor(versionRaw) : CURRENT_DERIVATION_VERSION;

    const totals: Record<SourceType, ProcessOutcome> = {
      knowledge_item: { processed: 0, upserted: 0, skipped: 0, failed: 0 },
      playbook:       { processed: 0, upserted: 0, skipped: 0, failed: 0 },
    };

    for (const s of sources) {
      totals[s] = await processSourceType(supabase, targetUserId, s, limit, derivationVersion);
    }

    const summary = {
      user_id: targetUserId,
      derivation_version: derivationVersion,
      knowledge_items: totals.knowledge_item,
      playbooks: totals.playbook,
      cards_upserted: totals.knowledge_item.upserted + totals.playbook.upserted,
    };
    console.log(`[derive-library-cards] done ${JSON.stringify(summary)}`);
    return jsonResponse(summary);
  } catch (e: any) {
    console.error("[derive-library-cards] error:", e);
    return jsonResponse({ error: e?.message || "Internal error" }, 500);
  }
});
