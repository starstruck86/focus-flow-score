// ════════════════════════════════════════════════════════════════
// Section-batched authoring — Stage 3 reliability layer.
//
// Purpose: when the monolithic one-shot authoring call (Claude → ChatGPT
// fallback) fully fails (typically due to wall-clock timeouts on 19
// sections in a single 12k-token response), we *don't* fail the run.
// Instead we author the document in small batches (≤3 sections each),
// trying Claude per batch and falling back to ChatGPT (OpenAI GPT-5)
// per batch. Each batch is small enough to comfortably finish inside
// its inner timeout budget. Surviving batches assemble into the same
// `{ sections: [...] }` draft_output shape the rest of the pipeline
// already expects.
//
// MODEL POLICY: only Claude + OpenAI ChatGPT are used. Gemini / Lovable AI
// are explicitly NOT part of this path.
//
// This is purely additive: the public draft_output contract is identical,
// task types are unchanged, the registry/handler API is untouched. The
// only entry point is `authorBySectionBatches`, called from runTask.ts
// after the existing authoring ladder has exhausted itself.
// ════════════════════════════════════════════════════════════════

import { callClaude, callOpenAI, safeParseJSON } from "./providers.ts";
import { DISCOVERY_PREP_SECTIONS } from "./handlers/discoveryPrepTemplate.ts";

/** A small, fixed grouping of section ids. Tightened to ≤2 sections per
 *  batch so each Claude-first authoring call lands inside its inner
 *  timeout on the first attempt — fallback (ChatGPT) stays exception-only
 *  per the model policy. Larger groupings starved fallback / forced the
 *  per-batch ladder to lean on retries. */
// Heavy batches identified from run b206f346 telemetry: any 2-section group
// that combined two analytically dense sections forced Claude past the 60s
// inner timeout (batches 4, 8, 9, 10 all needed fallback at 100s+). The fix
// is to keep light pairs together (cover+participants, cx_audit etc.) and
// split heavy pairs into singletons so each Claude call is bounded by ONE
// section's worth of analysis. Singletons that previously timed out
// (cockpit, appendix) remain singletons — see PRIMARY_MODEL_HEAVY policy
// below if they continue to fall back. Section order preserved for assembly.
// ── STANDARDIZED BATCH MAP (LOCKED) ──────────────────────────────
// Validated by canary a66b3dec (2025-04): 16/16 batches completed,
// 19/19 sections assembled, Claude-primary 13/16, fallback 3/16, 0
// duplicates / 0 orphans. This is the canonical, repeatable plan for
// discovery_prep deep research. Do NOT reshape per-run. Any future
// change requires a new canary + standardization pass.
export const DISCOVERY_PREP_BATCHES: ReadonlyArray<{ ids: readonly string[] }> = Object.freeze([
  Object.freeze({ ids: Object.freeze(["cockpit"]) }),                                 // heavy singleton
  Object.freeze({ ids: Object.freeze(["cover", "participants"]) }),                   // light pair
  Object.freeze({ ids: Object.freeze(["cx_audit"]) }),
  Object.freeze({ ids: Object.freeze(["executive_snapshot"]) }),
  Object.freeze({ ids: Object.freeze(["value_selling"]) }),
  Object.freeze({ ids: Object.freeze(["discovery_questions"]) }),
  Object.freeze({ ids: Object.freeze(["customer_examples", "pivot_statements"]) }),   // light pair
  Object.freeze({ ids: Object.freeze(["objection_handling"]) }),
  Object.freeze({ ids: Object.freeze(["marketing_team", "exit_criteria"]) }),         // light pair
  Object.freeze({ ids: Object.freeze(["revenue_pathway"]) }),
  Object.freeze({ ids: Object.freeze(["metrics_intelligence"]) }),
  Object.freeze({ ids: Object.freeze(["loyalty_analysis"]) }),
  Object.freeze({ ids: Object.freeze(["tech_stack"]) }),
  Object.freeze({ ids: Object.freeze(["competitive_war_game"]) }),                    // heavy singleton
  Object.freeze({ ids: Object.freeze(["hypotheses_risks"]) }),
  Object.freeze({ ids: Object.freeze(["appendix"]) }),                                // heavy singleton
]) as ReadonlyArray<{ ids: readonly string[] }>;

const SECTION_INNER_TIMEOUT_MS = 60_000;
const SECTION_OUTER_TIMEOUT_MS = 70_000;
// Heavy-singleton override: these three sections consistently exceed the
// default 60s/70s budget on Claude (telemetry: cockpit ~112s, appendix
// ~120s, competitive_war_game ~111s). They remain singletons in the batch
// map; we only extend the per-batch timeout when the batch IS exactly one
// of these. All other batches keep the default budget. Fallback gets the
// same extended budget for these singletons so it can actually finish.
const HEAVY_SINGLETON_SECTIONS = new Set(["cockpit", "competitive_war_game", "appendix"]);
const HEAVY_SINGLETON_INNER_TIMEOUT_MS = 140_000;
const HEAVY_SINGLETON_OUTER_TIMEOUT_MS = 150_000;
function timeoutsForBatch(sectionIds: string[]): { inner: number; outer: number; heavy: boolean } {
  if (sectionIds.length === 1 && HEAVY_SINGLETON_SECTIONS.has(sectionIds[0])) {
    return { inner: HEAVY_SINGLETON_INNER_TIMEOUT_MS, outer: HEAVY_SINGLETON_OUTER_TIMEOUT_MS, heavy: true };
  }
  return { inner: SECTION_INNER_TIMEOUT_MS, outer: SECTION_OUTER_TIMEOUT_MS, heavy: false };
}
const PRIMARY_MODEL = "claude-sonnet-4-5-20250929";
// NATIVE OpenAI model id (no "openai/" gateway prefix). callOpenAI hits
// api.openai.com directly and rejects gateway-style ids with 400.
const FALLBACK_MODEL = "gpt-5"; // OpenAI ChatGPT — Gemini explicitly excluded

export interface SectionBatchResult {
  /** Assembled `{ sections: [...] }` draft. Always returned, even if some
   *  batches failed — failed sections become a structured placeholder so
   *  downstream review/persist code never blows up on a missing id. */
  draft: { sections: any[]; sources?: any[] };
  /** Per-batch outcome telemetry, persisted into task_runs.meta. */
  batchOutcomes: {
    section_ids: string[];
    primary_status: "success" | "failed";
    fallback_status?: "success" | "failed";
    error?: string;
  }[];
  /** True if at least one batch's fallback path produced sections. Used by
   *  the validation canary's "fallback_success" assertion. */
  any_fallback_success: boolean;
  /** Count of sections successfully authored by either model. */
  sections_authored: number;
}

export interface AuthorBatchArgs {
  systemPrompt: string;
  userPromptBuilder: (sectionIds: string[]) => string;
  runId: string;
  taskType: string;
}

function isFallbackEligible(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  if (err?.status === 429 || err?.status === 402) return true;
  if (/\b(404|408|409|429|5\d{2})\b/.test(msg)) return true;
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("aborted")) return true;
  if (msg.includes("credits exhausted") || msg.includes("rate limited")) return true;
  if (msg.includes("unavailable") || msg.includes("overloaded")) return true;
  return false;
}

/** Race a provider call against a wall-clock deadline. */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Author a single batch. Returns the parsed sections array on success.
 *  Tries Claude first; on transient failure, falls back to OpenAI ChatGPT.
 *  Gemini is intentionally NOT used. */
export async function authorOneBatch(
  args: AuthorBatchArgs,
  sectionIds: string[],
): Promise<{ sections: any[]; primary_status: "success" | "failed"; fallback_status?: "success" | "failed"; error?: string }> {
  const userPrompt = args.userPromptBuilder(sectionIds);
  const messages = [
    { role: "system", content: args.systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const { inner: innerMs, outer: outerMs, heavy } = timeoutsForBatch(sectionIds);
  if (heavy) {
    console.log(JSON.stringify({
      tag: "[section-author:heavy_singleton_override]",
      run_id: args.runId,
      batch: sectionIds,
      inner_ms: innerMs,
      outer_ms: outerMs,
    }));
  }

  // Primary: Claude
  try {
    const raw = await withTimeout(
      callClaude(messages, {
        model: PRIMARY_MODEL,
        maxTokens: 8000,
        temperature: 0.3,
        timeoutMs: innerMs,
        maxAttempts: 1,
      }),
      outerMs,
      `[section-author:claude] batch=${sectionIds.join(",")}`,
    );
    const parsed = safeParseJSON<any>(raw);
    if (parsed && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
      return { sections: parsed.sections, primary_status: "success" };
    }
    throw new Error("Claude returned no sections array");
  } catch (claudeErr: any) {
    const claudeMsg = String(claudeErr?.message || claudeErr).slice(0, 300);
    if (!isFallbackEligible(claudeErr)) {
      return { sections: [], primary_status: "failed", error: `claude: ${claudeMsg}` };
    }
    console.warn(JSON.stringify({
      tag: "[section-author:fallback_triggered]",
      run_id: args.runId,
      batch: sectionIds,
      primary_error: claudeMsg,
      fallback_provider: "openai",
      fallback_model: FALLBACK_MODEL,
    }));

    // Fallback: OpenAI ChatGPT (gpt-5). Gemini is explicitly NOT used.
    try {
      const raw = await withTimeout(
        callOpenAI(messages, {
          model: FALLBACK_MODEL,
          temperature: 0.3,
          maxTokens: 8000,
        }),
        outerMs,
        `[section-author:openai] batch=${sectionIds.join(",")}`,
      );
      const parsed = safeParseJSON<any>(raw);
      if (parsed && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
        console.log(JSON.stringify({
          tag: "[section-author:fallback_success]",
          run_id: args.runId,
          batch: sectionIds,
          fallback_model: FALLBACK_MODEL,
        }));
        return { sections: parsed.sections, primary_status: "failed", fallback_status: "success", error: claudeMsg };
      }
      return {
        sections: [],
        primary_status: "failed",
        fallback_status: "failed",
        error: `claude: ${claudeMsg} | fallback(${FALLBACK_MODEL}): no sections array`,
      };
    } catch (fbErr: any) {
      const fbMsg = String(fbErr?.message || fbErr).slice(0, 300);
      console.error(JSON.stringify({
        tag: "[section-author:fallback_failed]",
        run_id: args.runId,
        batch: sectionIds,
        fallback_model: FALLBACK_MODEL,
        fallback_error: fbMsg,
      }));
      return {
        sections: [],
        primary_status: "failed",
        fallback_status: "failed",
        error: `claude: ${claudeMsg} | fallback(${FALLBACK_MODEL}): ${fbMsg}`,
      };
    }
  }
}

/** Build a per-batch user prompt by extracting the relevant section schema
 *  fragments from the full discovery_prep schema. Keeps the contract — the
 *  model still returns `{ sections: [...] }` — but only for the requested
 *  section ids, so each call is small and fast. */
export function buildBatchUserPrompt(
  baseUserPrompt: string,
  sectionIds: string[],
): string {
  const allowedNames = sectionIds
    .map((id) => DISCOVERY_PREP_SECTIONS.find((s) => s.id === id)?.name || id)
    .join(", ");
  return `${baseUserPrompt}

═══ BATCH AUTHORING — RELIABILITY MODE ═══
Author ONLY the following sections in this response (skip all others):
  ${sectionIds.map((id, i) => `${i + 1}. id="${id}" (${DISCOVERY_PREP_SECTIONS.find((s) => s.id === id)?.name || id})`).join("\n  ")}

Return JSON in this exact shape (no other sections, no markdown fences):
{
  "sections": [
    ${sectionIds.map((id) => `{ "id": "${id}", "name": "<name>", "grounded_by": ["<ids>"], "content": { ... } }`).join(",\n    ")}
  ]
}

Use the SAME schema, depth, citation discipline, and pov_block requirements that the full template requires for these specific sections (${allowedNames}). Do not abbreviate. Do not omit pov_blocks. Do not invent facts — use only the provided synthesis + library + sources registry.`;
}

/** Public entry point. Authors all batches sequentially (parallelism would
 *  hammer rate limits on top of an already-degraded run). Returns whatever
 *  sections survived, in template order. */
export async function authorBySectionBatches(args: {
  runId: string;
  taskType: string;
  systemPrompt: string;
  baseUserPrompt: string;
  synthesis: any;
  /** Optional Supabase client used to heartbeat task_runs.updated_at
   *  between batches so the stage watchdog doesn't reap a healthy run
   *  mid-ladder. Best-effort; failures are swallowed. */
  supabase?: any;
}): Promise<SectionBatchResult> {
  // Only discovery_prep has a defined batch plan today. Other task types
  // can plug in by exporting their own batch list later — for now we just
  // refuse to batch them (caller treats this as "not eligible" and lets
  // the original failure stand).
  if (args.taskType !== "discovery_prep") {
    return {
      draft: { sections: [] },
      batchOutcomes: [],
      any_fallback_success: false,
      sections_authored: 0,
    };
  }

  const userPromptBuilder = (ids: string[]) => buildBatchUserPrompt(args.baseUserPrompt, ids);

  const collected: Map<string, any> = new Map();
  const outcomes: SectionBatchResult["batchOutcomes"] = [];
  let anyFallbackSuccess = false;

  console.log(JSON.stringify({
    tag: "[section-author:start]",
    run_id: args.runId,
    batches: DISCOVERY_PREP_BATCHES.length,
    sections_total: DISCOVERY_PREP_SECTIONS.length,
    primary_model: PRIMARY_MODEL,
    fallback_model: FALLBACK_MODEL,
  }));

  let batchIndex = 0;
  for (const batch of DISCOVERY_PREP_BATCHES) {
    batchIndex++;
    // ── Heartbeat: refresh updated_at + progress_step between batches so
    // the document_authoring stale-run watchdog (which only sees elapsed
    // time on updated_at) doesn't reap a healthy long-running batch
    // sequence as stalled. Best-effort; failures are swallowed so the
    // ladder always continues.
    if (args.supabase) {
      try {
        await args.supabase
          .from("task_runs")
          .update({
            progress_step: `document_authoring:batch_${batchIndex}_of_${DISCOVERY_PREP_BATCHES.length}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", args.runId);
      } catch (e) {
        console.warn(JSON.stringify({
          tag: "[section-author:heartbeat_failed]",
          run_id: args.runId,
          batch_index: batchIndex,
          error: String((e as Error)?.message || e).slice(0, 200),
        }));
      }
    }
    const startedAt = Date.now();
    const result = await authorOneBatch(
      {
        systemPrompt: args.systemPrompt,
        userPromptBuilder,
        runId: args.runId,
        taskType: args.taskType,
      },
      [...batch.ids],
    );
    const durationMs = Date.now() - startedAt;
    console.log(JSON.stringify({
      tag: "[section-author:batch_done]",
      run_id: args.runId,
      batch: batch.ids,
      duration_ms: durationMs,
      primary_status: result.primary_status,
      fallback_status: result.fallback_status ?? null,
      sections_returned: result.sections.length,
    }));
    outcomes.push({
      section_ids: [...batch.ids],
      primary_status: result.primary_status,
      fallback_status: result.fallback_status,
      error: result.error,
    });
    if (result.fallback_status === "success") anyFallbackSuccess = true;
    for (const s of result.sections) {
      if (s?.id && batch.ids.includes(s.id) && !collected.has(s.id)) {
        collected.set(s.id, s);
      }
    }
  }

  // Assemble in template order; insert structured placeholders for any
  // sections that failed both primary and fallback so the document still
  // renders and the operator can see exactly what was lost.
  const assembled: any[] = [];
  for (const tpl of DISCOVERY_PREP_SECTIONS) {
    if (collected.has(tpl.id)) {
      assembled.push(collected.get(tpl.id));
    } else {
      assembled.push({
        id: tpl.id,
        name: tpl.name,
        grounded_by: [],
        content: {
          _authoring_failed: true,
          _note: "Section authoring failed (both primary and fallback). Content unavailable.",
        },
      });
    }
  }

  // Carry the synthesis sources registry through so citations resolve.
  const sources = Array.isArray(args.synthesis?.sources) ? args.synthesis.sources : undefined;

  console.log(JSON.stringify({
    tag: "[section-author:end]",
    run_id: args.runId,
    sections_authored: collected.size,
    sections_total: DISCOVERY_PREP_SECTIONS.length,
    any_fallback_success: anyFallbackSuccess,
    primary_model: PRIMARY_MODEL,
    fallback_model: FALLBACK_MODEL,
  }));

  return {
    draft: { sections: assembled, ...(sources ? { sources } : {}) },
    batchOutcomes: outcomes,
    any_fallback_success: anyFallbackSuccess,
    sections_authored: collected.size,
  };
}
