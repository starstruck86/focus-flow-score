// ════════════════════════════════════════════════════════════════
// progressiveDriver — small helpers that turn the existing 12-batch
// authoring ladder into INDEPENDENT, durable, per-batch jobs.
//
// Goals (per the progressive-execution doctrine):
//   1. No single edge isolate runs the entire 12-batch ladder.
//   2. Each batch executes in its own isolate (HTTP self-invoke).
//   3. Synthesis is computed ONCE per run and persisted to
//      task_runs.meta.progressive — every authoring step reads from
//      that artifact (single source of truth, no drift).
//   4. Per-batch state is durable in task_run_sections — failures of
//      one batch do not poison the whole document. Idempotent via
//      the (run_id, batch_index) unique constraint.
//   5. Claude remains the FIRST author per batch (sectionAuthor); the
//      OpenAI fallback is per-batch and exception-only.
//
// This file is intentionally additive. It does NOT replace runTask.ts
// — runTask is still the synchronous / monolithic-eligible entry point
// for non-discovery_prep task types. Discovery Prep uses this driver
// to fan out authoring across many small jobs and assemble the result.
// ════════════════════════════════════════════════════════════════

import { DISCOVERY_PREP_BATCHES, authorOneBatch, buildBatchUserPrompt } from "./sectionAuthor.ts";
import { DISCOVERY_PREP_SECTIONS } from "./handlers/discoveryPrepTemplate.ts";
import { callOpenAI, safeParseJSON } from "./providers.ts";
import { getHandler } from "./registry.ts";

/** Persist the synthesis artifact + prompt material into task_runs.meta
 *  so each subsequent step can reconstruct the authoring inputs without
 *  re-running research/synthesis. Single source of truth. */
export async function persistSynthesisArtifact(args: {
  supabase: any;
  runId: string;
  synthesis: any;
  systemPrompt: string;
  baseUserPrompt: string;
  libraryCounts: { kis: number; playbooks: number };
  researchChars: number;
}): Promise<void> {
  const { supabase, runId, synthesis, systemPrompt, baseUserPrompt, libraryCounts, researchChars } = args;
  const { error } = await supabase
    .from("task_runs")
    .update({
      meta: {
        progressive: {
          synthesis,
          system_prompt: systemPrompt,
          base_user_prompt: baseUserPrompt,
          library_counts: libraryCounts,
          research_chars: researchChars,
          persisted_at: new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) throw new Error(`persistSynthesisArtifact: ${error.message}`);
}

/** Pre-create one task_run_sections row per planned batch so the rest of
 *  the pipeline is purely UPDATE — no risk of partial inserts on retries.
 *  Idempotent via the (run_id, batch_index) unique constraint. */
export async function ensureSectionRows(args: {
  supabase: any;
  runId: string;
  userId: string;
}): Promise<{ created: number }> {
  const { supabase, runId, userId } = args;
  const rows = DISCOVERY_PREP_BATCHES.map((b, i) => ({
    run_id: runId,
    user_id: userId,
    batch_index: i,
    section_ids: b.ids,
    status: "pending",
  }));
  const { error, count } = await supabase
    .from("task_run_sections")
    .upsert(rows, { onConflict: "run_id,batch_index", ignoreDuplicates: true, count: "exact" });
  if (error) {
    // ignoreDuplicates can still race; treat unique-violation as a no-op.
    if (!String(error.message || "").toLowerCase().includes("duplicate")) {
      throw new Error(`ensureSectionRows: ${error.message}`);
    }
  }
  return { created: count ?? rows.length };
}

/** Process exactly ONE batch by index. Reads progressive context from
 *  task_runs.meta, calls authorOneBatch (Claude → ChatGPT fallback per
 *  batch), writes the section row, returns the outcome. */
export async function processOneBatch(args: {
  supabase: any;
  runId: string;
  userId: string;
  batchIndex: number;
  taskType: string;
}): Promise<{
  status: "completed" | "failed";
  primary_status: "success" | "failed";
  fallback_status?: "success" | "failed";
  sections_returned: number;
  error?: string;
}> {
  const { supabase, runId, batchIndex, taskType } = args;

  // ── Claim row (idempotent: only flip to running when still pending). ──
  const claimed = await supabase
    .from("task_run_sections")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      attempts: 1, // upsert; we don't increment to keep the path simple
      updated_at: new Date().toISOString(),
    })
    .eq("run_id", runId)
    .eq("batch_index", batchIndex)
    .eq("status", "pending")
    .select("id, section_ids")
    .maybeSingle();

  // If already running/completed/failed, treat as no-op (do not re-run).
  if (!claimed.data) {
    const { data: existing } = await supabase
      .from("task_run_sections")
      .select("status, primary_status, fallback_status, sections, error")
      .eq("run_id", runId)
      .eq("batch_index", batchIndex)
      .maybeSingle();
    if (!existing) throw new Error(`Section row missing for batch_index=${batchIndex}`);
    return {
      status: existing.status === "completed" ? "completed" : "failed",
      primary_status: (existing.primary_status as any) ?? "failed",
      fallback_status: existing.fallback_status as any,
      sections_returned: Array.isArray(existing.sections) ? existing.sections.length : 0,
      error: existing.error ?? "already terminal",
    };
  }

  const sectionIds = claimed.data.section_ids as string[];

  // ── Load progressive context from task_runs.meta ─────────────────
  const { data: runRow, error: runErr } = await supabase
    .from("task_runs")
    .select("meta")
    .eq("id", runId)
    .single();
  if (runErr || !runRow) throw new Error(`processOneBatch: run not found ${runId}`);
  const prog = (runRow.meta as any)?.progressive;
  if (!prog?.system_prompt || !prog?.base_user_prompt) {
    const msg = "progressive context missing on task_runs.meta (synthesis not persisted)";
    await supabase
      .from("task_run_sections")
      .update({
        status: "failed",
        primary_status: "failed",
        error: msg,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("run_id", runId)
      .eq("batch_index", batchIndex);
    throw new Error(msg);
  }

  // ── Author the batch (Claude first; OpenAI fallback per batch) ──
  const result = await authorOneBatch(
    {
      systemPrompt: prog.system_prompt,
      userPromptBuilder: (ids) => buildBatchUserPrompt(prog.base_user_prompt, ids),
      runId,
      taskType,
    },
    sectionIds,
  );

  const ok = result.sections.length > 0;
  // Standardized model attribution per batch:
  //   "claude"           → Claude authored on first try
  //   "openai_fallback"  → Claude failed, OpenAI fallback succeeded
  //   "none"             → both failed (placeholder will be assembled)
  const modelUsed: "claude" | "openai_fallback" | "none" =
    result.primary_status === "success"
      ? "claude"
      : result.fallback_status === "success"
        ? "openai_fallback"
        : "none";

  await supabase
    .from("task_run_sections")
    .update({
      status: ok ? "completed" : "failed",
      primary_status: result.primary_status,
      fallback_status: result.fallback_status ?? null,
      model_used: modelUsed,
      sections: result.sections,
      error: result.error ?? null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("run_id", runId)
    .eq("batch_index", batchIndex);

  // Heartbeat the parent run so the watchdog sees progress.
  await supabase
    .from("task_runs")
    .update({
      progress_step: `document_authoring:batch_${batchIndex + 1}_of_${DISCOVERY_PREP_BATCHES.length}`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);

  return {
    status: ok ? "completed" : "failed",
    primary_status: result.primary_status,
    fallback_status: result.fallback_status,
    sections_returned: result.sections.length,
    error: result.error,
  };
}

/** Invoked after the last batch completes. Aggregates every section row
 *  into the final draft_output, runs review, finalizes the task_runs row.
 *  Tolerates partial success — failed sections become structured
 *  placeholders so the document still renders. */
export async function assembleAndFinalize(args: {
  supabase: any;
  runId: string;
  taskType: string;
}): Promise<{ sections_completed: number; sections_total: number; assembled: boolean }> {
  const { supabase, runId, taskType } = args;
  const handler = getHandler(taskType);

  const { data: rows, error } = await supabase
    .from("task_run_sections")
    .select("batch_index, section_ids, status, sections, primary_status, fallback_status")
    .eq("run_id", runId)
    .order("batch_index", { ascending: true });
  if (error) throw new Error(`assembleAndFinalize: ${error.message}`);
  if (!rows || rows.length === 0) throw new Error("assembleAndFinalize: no section rows");

  // Collect by section id; insert structured placeholders for missing ones.
  const collected = new Map<string, any>();
  let claudeAuthored = 0;
  let fallbackAuthored = 0;
  let failedBatches = 0;
  for (const r of rows as any[]) {
    if (r.status === "completed" && Array.isArray(r.sections)) {
      for (const s of r.sections) {
        if (s?.id && (r.section_ids as string[]).includes(s.id) && !collected.has(s.id)) {
          collected.set(s.id, s);
        }
      }
      if (r.primary_status === "success") claudeAuthored += (r.section_ids as string[]).length;
      else if (r.fallback_status === "success") fallbackAuthored += (r.section_ids as string[]).length;
    } else if (r.status === "failed") {
      failedBatches++;
    }
  }

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
          _note: "Section authoring failed in progressive run.",
        },
      });
    }
  }

  // Pull synthesis sources for citation resolution.
  const { data: runRow } = await supabase.from("task_runs").select("meta").eq("id", runId).single();
  const synthesis = (runRow?.meta as any)?.progressive?.synthesis;
  const sources = Array.isArray(synthesis?.sources) ? synthesis.sources : undefined;
  const draftOutput = { sections: assembled, ...(sources ? { sources } : {}) };

  // ── Review (best-effort, non-fatal) ──
  let reviewOutput: any = { strengths: [], redlines: [], library_coverage: { used: [], gaps: [] } };
  try {
    if (collected.size > 0) {
      const reviewRaw = await callOpenAI([
        { role: "system", content: "You are a senior sales leader reviewing a prep document. Be specific, actionable, and grounded in the provided internal playbooks/KIs." },
        { role: "user", content: handler.buildReviewPrompt({} as any, draftOutput, { knowledgeItems: [], playbooks: [], contextString: "", counts: { kis: 0, playbooks: 0 } }) },
      ], { model: "gpt-5-mini", temperature: 0.4, maxTokens: 4000 });
      const parsed = safeParseJSON<any>(reviewRaw);
      if (parsed) reviewOutput = { ...reviewOutput, ...parsed };
    }
  } catch (e: any) {
    console.error("[progressive] review failed:", e?.message || e);
  }

  // Merge progressive metadata + authoring telemetry.
  const meta = (runRow?.meta as any) || {};
  const totalBatches = (rows as any[]).length;
  const fallbackBatches = (rows as any[]).filter((r) => r.fallback_status === "success").length;
  const fallbackPct = totalBatches > 0 ? fallbackBatches / totalBatches : 0;
  const driftWarning = fallbackPct > 0.30;
  if (driftWarning) {
    console.warn(JSON.stringify({
      tag: "[authoring:drift_warning]",
      run_id: runId,
      fallback_batches: fallbackBatches,
      total_batches: totalBatches,
      fallback_pct: Number(fallbackPct.toFixed(3)),
      threshold: 0.30,
    }));
  }
  const newMeta = {
    ...meta,
    authoring_progressive: {
      sections_total: DISCOVERY_PREP_SECTIONS.length,
      sections_completed: collected.size,
      sections_claude_authored: claudeAuthored,
      sections_fallback_authored: fallbackAuthored,
      batches_failed: failedBatches,
      batches_total: totalBatches,
      fallback_pct: Number(fallbackPct.toFixed(3)),
      drift_warning: driftWarning,
      assembled_at: new Date().toISOString(),
    },
  };

  await supabase
    .from("task_runs")
    .update({
      draft_output: draftOutput,
      review_output: reviewOutput,
      status: "completed",
      progress_step: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      meta: newMeta,
    })
    .eq("id", runId);

  return {
    sections_completed: collected.size,
    sections_total: DISCOVERY_PREP_SECTIONS.length,
    assembled: true,
  };
}

/** Fire-and-forget HTTP self-invoke for the next batch. Returns
 *  immediately (does not await the response) so the current isolate
 *  can finish cleanly. */
export function invokeNextStep(args: {
  runId: string;
  batchIndex: number;
  userId: string;
}): void {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/run-discovery-prep-step`;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const internalKey = Deno.env.get("STRATEGY_VALIDATION_KEY") ?? "";

  const body = JSON.stringify({
    run_id: args.runId,
    batch_index: args.batchIndex,
    user_id: args.userId,
    internal_key: internalKey,
  });

  const p = fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
      "x-internal-call": "1",
    },
    body,
  }).then(async (r) => {
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error(JSON.stringify({
        tag: "[progressive:invoke_next_failed]",
        run_id: args.runId,
        batch_index: args.batchIndex,
        status: r.status,
        body: t.slice(0, 200),
      }));
    }
  }).catch((e) => {
    console.error(JSON.stringify({
      tag: "[progressive:invoke_next_error]",
      run_id: args.runId,
      batch_index: args.batchIndex,
      error: String(e?.message || e).slice(0, 200),
    }));
  });

  // @ts-ignore — keep the fetch alive past the response if available.
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
    // @ts-ignore
    EdgeRuntime.waitUntil(p);
  }
}

export const TOTAL_BATCHES = DISCOVERY_PREP_BATCHES.length;
