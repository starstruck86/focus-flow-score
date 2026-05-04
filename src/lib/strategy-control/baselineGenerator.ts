/**
 * Phase 3.5B-Fix — Per-Case Clean Baseline Generator.
 *
 * Each skill gets its own baseline prompt that:
 *   1. Mirrors the skill request (what it's asking for)
 *   2. Enforces the same output contract (prose/structured, word budget, forbid)
 *   3. Uses ZERO Strategy context/library/memory
 *
 * This eliminates volume + format bias from shared generic prompts.
 */
import { supabase } from "@/integrations/supabase/client";

export interface BaselineRequest {
  account: string;
  persona: string;
  stage: string;
  topic: string;
  /** Additional inputs for skill-specific prompts */
  opportunity?: string;
  methodology?: string;
  industry?: string;
}

export interface BaselineOutputContract {
  shape: "prose" | "structured_artifact" | "executive_brief" | "list" | "unknown";
  targetWords?: { min: number; max: number };
  forbid?: string[];
  skillId?: string;
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
  systemPrompt: string;
  userPrompt: string;
}

export const BASELINE_PROMPT_VERSION = "2.0.0";

const CLEAN_TRACE: BaselineTrace = {
  baseline_mode: "clean_baseline",
  baseline_context_used: false,
  baseline_library_used: false,
  baseline_memory_used: false,
  model: "google/gemini-2.5-flash",
};

/**
 * Build a per-skill baseline system prompt that enforces the output contract.
 */
function buildBaselineSystemPrompt(contract?: BaselineOutputContract): string {
  const base = "You are a helpful sales strategy assistant. " +
    "Answer the user's question with actionable, specific advice. " +
    "Do not reference any internal library, playbook, or proprietary methodology. " +
    "Use only general sales knowledge.";

  if (!contract) return base;

  const constraints: string[] = [];

  // Output format contract
  if (contract.shape === "prose") {
    constraints.push("Write your response as continuous prose paragraphs.");
    if (contract.forbid?.includes("headings")) constraints.push("Do NOT use headings (no # or bold section titles).");
    if (contract.forbid?.includes("bullets")) constraints.push("Do NOT use bullet points or numbered lists.");
  } else if (contract.shape === "structured_artifact" || contract.shape === "executive_brief") {
    constraints.push("Return your response as a well-structured JSON object with semantically meaningful keys.");
  } else if (contract.shape === "list") {
    constraints.push("Return your response as a JSON array of items.");
  }

  // Word budget
  if (contract.targetWords) {
    constraints.push(`Keep your response between ${contract.targetWords.min} and ${contract.targetWords.max} words.`);
  }

  if (constraints.length === 0) return base;
  return base + "\n\nOutput constraints:\n" + constraints.map(c => `- ${c}`).join("\n");
}

/**
 * Build a skill-specific user prompt that mirrors what Strategy is asked to do.
 */
function buildBaselineUserPrompt(req: BaselineRequest, contract?: BaselineOutputContract): string {
  const skillId = contract?.skillId ?? "generic";

  switch (skillId) {
    case "conversation-pov":
      return `I'm preparing for a ${req.stage || "sales"} conversation with ${req.persona || "a stakeholder"} at ${req.account || "a prospect"}. The topic is ${req.topic || "their business challenges"}. Give me a concise, actionable point of view I can use in this conversation — including the current state, what needs to change, why it matters commercially, and how I should frame the conversation.`;

    case "commercial-insight":
      return `I need a sharp commercial insight about ${req.topic || "a business challenge"} for ${req.persona || "a stakeholder"} in the ${req.industry || "business"} industry during the ${req.stage || "sales"} stage. The insight should name the current state, a negative consequence of inaction, the desired outcome, and a specific capability needed — compressed into a single usable talking point.`;

    case "discovery-prep":
      return `Prepare a full discovery preparation artifact for a meeting with ${req.persona || "a stakeholder"} at ${req.account || "a prospect"} during the ${req.stage || "discovery"} stage. The topic is ${req.topic || "their business challenges"}. Include: verified signals about the account, current state reasoning, change vectors, commercial insight, strategic reasoning, friction points, and specific discovery questions.`;

    case "meddicc-review":
      return `Conduct a MEDDICC deal review for the ${req.opportunity || "deal"} opportunity at ${req.account || "the account"} using ${req.methodology || "MEDDICC"} methodology in the ${req.stage || "current"} stage. Assess each MEDDICC element: Metrics, Economic Buyer, Decision Criteria, Decision Process, Identified Pain, Champion, and Competition. Identify gaps and recommend next steps.`;

    case "executive-brief":
      return `Create an executive brief for ${req.account || "the account"} focused on ${req.persona || "the executive"} during the ${req.stage || "current"} stage. Topic: ${req.topic || "the engagement"}. Include: situation summary, commercial insight, risks, strategic reasoning, specific asks, and recommended next steps.`;

    default:
      // Fallback generic prompt
      return `I'm preparing for a conversation with ${req.persona || "a stakeholder"} at ${req.account || "a prospect"} during the ${req.stage || "sales"} stage about ${req.topic || "their business challenges"}. Give me actionable advice.`;
  }
}

export async function generateBaseline(
  req: BaselineRequest,
  contract?: BaselineOutputContract,
): Promise<BaselineResult> {
  const started = performance.now();
  const systemPrompt = buildBaselineSystemPrompt(contract);
  const userPrompt = buildBaselineUserPrompt(req, contract);

  try {
    const { data, error } = await supabase.functions.invoke("clean-baseline", {
      body: {
        prompt: userPrompt,
        systemPrompt,
      },
    });

    const latencyMs = Math.round(performance.now() - started);

    if (error) {
      return { text: "", latencyMs, error: error.message, trace: CLEAN_TRACE, systemPrompt, userPrompt };
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

    return { text, latencyMs, error: null, trace: serverTrace, systemPrompt, userPrompt };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - started);
    return {
      text: "",
      latencyMs,
      error: e instanceof Error ? e.message : String(e),
      trace: CLEAN_TRACE,
      systemPrompt,
      userPrompt,
    };
  }
}
