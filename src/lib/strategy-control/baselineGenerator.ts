/**
 * Phase 3.5A — Clean Baseline Output Generator.
 *
 * AUDIT RESULT (Phase 3.5A pre-flight):
 * The previous implementation called strategy-chat default path, which includes:
 *   ❌ Library retrieval (KIs + playbooks)
 *   ❌ Account/opportunity memory (assembleStrategyContext)
 *   ❌ Strategy Core system prompts (buildStrategyChatSystemPrompt)
 *   ❌ SOP/workspace contracts (resolveServerWorkspaceContract)
 *   ❌ Working thesis state (loadWorkingThesisState)
 *   ❌ Resource retrieval (retrieveResourceContext)
 *   ❌ V2 reasoning (buildV2Prompt, synthesisAddendum)
 *   ❌ Citation audit, escalation, enforcement layers
 *
 * This was comparing Strategy vs Strategy-lite, NOT Strategy vs ChatGPT.
 *
 * FIXED: Now calls a dedicated clean-baseline edge function that hits
 * the Lovable AI gateway directly with ZERO Strategy context — only
 * the raw user prompt and a minimal generic assistant instruction.
 */
import { supabase } from "@/integrations/supabase/client";

export interface BaselineRequest {
  account: string;
  persona: string;
  stage: string;
  topic: string;
}

export interface BaselineTrace {
  baseline_mode: "clean_baseline";
  baseline_context_used: false;
  baseline_library_used: false;
  baseline_memory_used: false;
  model: string;
}

export interface BaselineResult {
  text: string;
  latencyMs: number;
  error: string | null;
  trace: BaselineTrace;
  /** The exact system prompt sent to the baseline LLM */
  systemPrompt: string;
  /** The exact user prompt sent to the baseline LLM */
  userPrompt: string;
}

const BASELINE_SYSTEM_PROMPT =
  "You are a helpful sales strategy assistant. " +
  "Answer the user's question with actionable, specific advice. " +
  "Do not reference any internal library, playbook, or proprietary methodology. " +
  "Use only general sales knowledge.";

const CLEAN_TRACE: BaselineTrace = {
  baseline_mode: "clean_baseline",
  baseline_context_used: false,
  baseline_library_used: false,
  baseline_memory_used: false,
  model: "google/gemini-2.5-flash",
};

function buildBaselinePrompt(req: BaselineRequest): string {
  const parts: string[] = [];
  parts.push(`I'm preparing for a conversation with ${req.persona || "a stakeholder"}`);
  if (req.account) parts.push(`at ${req.account}`);
  if (req.stage) parts.push(`during the ${req.stage} stage`);
  parts.push(".");
  if (req.topic) parts.push(`The topic is ${req.topic}.`);
  parts.push("Give me a concise, actionable POV for this conversation. Include specific talking points, key questions to ask, and potential objections to prepare for.");
  return parts.join(" ");
}

export async function generateBaseline(req: BaselineRequest): Promise<BaselineResult> {
  const started = performance.now();
  const prompt = buildBaselinePrompt(req);

  try {
    const { data, error } = await supabase.functions.invoke("clean-baseline", {
      body: { prompt },
    });

    const latencyMs = Math.round(performance.now() - started);

    if (error) {
      return { text: "", latencyMs, error: error.message, trace: CLEAN_TRACE };
    }

    const d = data as Record<string, unknown> | null;
    const text = typeof d?.text === "string" ? d.text : "";
    const serverTrace: BaselineTrace = {
      baseline_mode: "clean_baseline",
      baseline_context_used: d?.baseline_context_used === true,
      baseline_library_used: d?.baseline_library_used === true,
      baseline_memory_used: d?.baseline_memory_used === true,
      model: typeof d?.model === "string" ? d.model : "unknown",
    } as BaselineTrace;

    return { text, latencyMs, error: null, trace: serverTrace };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - started);
    return {
      text: "",
      latencyMs,
      error: e instanceof Error ? e.message : String(e),
      trace: CLEAN_TRACE,
    };
  }
}
