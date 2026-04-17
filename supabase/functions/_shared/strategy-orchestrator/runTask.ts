// ════════════════════════════════════════════════════════════════
// runTask — shared Strategy task orchestration pipeline.
//
// Stage 0: Library retrieval (KIs + playbooks)         [shared]
// Stage 1: Perplexity research                         [shared]
// Stage 2: OpenAI synthesis (uses library)             [shared]
// Stage 3: Claude document author (locked template)    [shared]
// Stage 4: Lovable AI review (playbook-grounded)       [shared]
// Stage 5: Persist run                                 [shared]
//
// All task-specific behavior lives in the TaskHandler. The pipeline
// itself is generic so future tasks (recap email, follow-up, etc.)
// reuse the same orchestration without forking it.
// ════════════════════════════════════════════════════════════════

import { retrieveLibraryContext } from "./libraryRetrieval.ts";
import { callClaude, callLovableAI, callPerplexity, safeParseJSON } from "./providers.ts";
import { getHandler } from "./registry.ts";
import type { OrchestrationContext, OrchestrationResult, ResearchBundle } from "./types.ts";

export async function runStrategyTask(ctx: OrchestrationContext): Promise<OrchestrationResult> {
  const { supabase, userId, inputs, taskType } = ctx;
  const handler = getHandler(taskType);
  console.log(`[orchestrator] task=${taskType} company=${inputs.company_name || "(none)"} user=${userId.slice(0, 8)}`);

  // ── Stage 0: Library retrieval ────────────────────────────────
  const library = await retrieveLibraryContext(supabase, userId, inputs, {
    scopes: handler.libraryScopes(inputs),
    maxKIs: 12,
    maxPlaybooks: 6,
  });

  // ── Stage 1: External research (Perplexity, parallel) ────────
  const queries = handler.buildResearchQueries(inputs);
  const research: ResearchBundle = { results: {}, totalChars: 0 };

  if (queries.length) {
    console.log(`[stage-1] ${queries.length} parallel research queries...`);
    const settled = await Promise.allSettled(
      queries.map(async (q) => {
        try {
          const result = await callPerplexity([
            { role: "system", content: "You are a sales research analyst. Provide specific, sourced facts. Include dates and numbers when available. If information is not found, say so explicitly." },
            { role: "user", content: q.prompt },
          ]);
          return { key: q.key, result };
        } catch (e) {
          console.error(`[stage-1] ${q.key} failed:`, (e as Error).message);
          return { key: q.key, result: { text: "", citations: [] } };
        }
      }),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") research.results[s.value.key] = s.value.result;
    }
    research.totalChars = Object.values(research.results).reduce((sum, r) => sum + r.text.length, 0);
    console.log(`[stage-1] research complete: ${research.totalChars} chars`);
  }

  // ── Stage 2: Synthesis via Lovable AI Gateway (gpt-5) ────────
  console.log(`[stage-2] synthesis via Lovable AI (gpt-5)...`);
  const synthesisRaw = await callLovableAI([
    { role: "system", content: "You are a senior sales strategist. Synthesize research + internal IP into actionable intelligence. Return structured JSON only. No markdown fences, no preamble." },
    { role: "user", content: handler.buildSynthesisPrompt(inputs, research, library) },
  ], { model: "openai/gpt-5", temperature: 0.4, maxTokens: 8192 });
  const synthesis = safeParseJSON<any>(synthesisRaw) ?? { raw: synthesisRaw };
  console.log(`[stage-2] synthesis fields: ${Object.keys(synthesis).length}`);

  // ── Stage 3: Claude document authoring (locked template) ─────
  console.log(`[stage-3] Claude document authoring...`);
  const documentRaw = await callClaude([
    { role: "system", content: handler.buildDocumentSystemPrompt() },
    { role: "user", content: handler.buildDocumentUserPrompt(inputs, synthesis, library) },
  ], { model: "claude-sonnet-4-20250514", maxTokens: 12000, temperature: 0.3 });
  const draftOutput = safeParseJSON<any>(documentRaw) ?? { sections: [], raw: documentRaw };
  const sectionCount = draftOutput.sections?.length || 0;
  console.log(`[stage-3] document authored: ${sectionCount} sections`);

  // ── Stage 4: Review (Lovable AI, playbook-grounded) ──────────
  let reviewOutput: any = { strengths: [], redlines: [], library_coverage: { used: [], gaps: [] } };
  if (sectionCount > 0) {
    console.log("[stage-4] generating playbook-grounded review...");
    try {
      const reviewRaw = await callLovableAI([
        { role: "system", content: "You are a senior sales leader reviewing a prep document. Be specific, actionable, and grounded in the provided internal playbooks/KIs." },
        { role: "user", content: handler.buildReviewPrompt(inputs, draftOutput, library) },
      ], { model: "google/gemini-2.5-flash", temperature: 0.4, maxTokens: 4000 });
      const parsed = safeParseJSON<any>(reviewRaw);
      if (parsed) reviewOutput = { ...reviewOutput, ...parsed };
    } catch (e: any) {
      console.error("[stage-4] review failed:", e?.message || e);
      if (e?.status === 429 || e?.status === 402) throw e;
    }
  }

  // ── Stage 5: Persist run ─────────────────────────────────────
  const { data: run, error: insertErr } = await supabase
    .from("task_runs")
    .insert({
      user_id: userId,
      task_type: taskType,
      inputs,
      draft_output: draftOutput,
      review_output: reviewOutput,
      status: "completed",
      thread_id: inputs.thread_id || null,
      account_id: inputs.account_id || null,
      opportunity_id: inputs.opportunity_id || null,
    })
    .select("id")
    .single();

  if (insertErr) {
    console.error("[orchestrator] insert error:", insertErr);
    throw insertErr;
  }

  const meta = {
    research_chars: research.totalChars,
    library_kis: library.counts.kis,
    library_playbooks: library.counts.playbooks,
    sections: sectionCount,
    redlines: reviewOutput.redlines?.length || 0,
  };
  console.log(`[orchestrator] complete run=${run.id} ${JSON.stringify(meta)}`);

  return { run_id: run.id, draft: draftOutput, review: reviewOutput, meta };
}

/** Apply a single section-level redline to an existing run. Shared across tasks. */
export async function applyRedline(
  supabase: any,
  userId: string,
  runId: string,
  sectionId: string,
  proposedText: any,
): Promise<{ draft_output: any; review_output: any }> {
  const { data: run, error: fetchErr } = await supabase
    .from("task_runs").select("*").eq("id", runId).eq("user_id", userId).single();
  if (fetchErr || !run) throw new Error("Run not found");

  const draft = run.draft_output as any;
  if (draft?.sections) {
    const idx = draft.sections.findIndex((s: any) => s.id === sectionId);
    if (idx >= 0) draft.sections[idx].content = proposedText;
  }

  const review = run.review_output as any;
  if (review?.redlines) {
    review.redlines = review.redlines.map((r: any) =>
      r.section_id === sectionId ? { ...r, status: "accepted" } : r,
    );
  }

  const { error: updateErr } = await supabase
    .from("task_runs")
    .update({ draft_output: draft, review_output: review, updated_at: new Date().toISOString() })
    .eq("id", runId);
  if (updateErr) throw updateErr;

  return { draft_output: draft, review_output: review };
}
