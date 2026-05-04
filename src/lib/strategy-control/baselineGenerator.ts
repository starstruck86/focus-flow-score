/**
 * Phase 3.5A — Baseline Output Generator.
 *
 * Produces a "ChatGPT-style" baseline for the same skill inputs,
 * WITHOUT library grounding, expansion, or skill envelope.
 *
 * Uses the existing strategy-chat endpoint but:
 *   - NO x-skill-debug header
 *   - NO skill envelope (plain freeform message)
 *   - Simulates what a user would get from a generic LLM
 *
 * Returns the raw text response for scoring.
 */
import { supabase } from "@/integrations/supabase/client";

export interface BaselineRequest {
  account: string;
  persona: string;
  stage: string;
  topic: string;
}

export interface BaselineResult {
  text: string;
  latencyMs: number;
  error: string | null;
}

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
    const { data, error } = await supabase.functions.invoke("strategy-chat", {
      body: {
        threadId: `baseline-eval-${Date.now()}`,
        content: prompt,
        action: "chat",
      },
      // NO x-skill-debug header — forces default (non-skill) path
    });

    const latencyMs = Math.round(performance.now() - started);

    if (error) {
      return { text: "", latencyMs, error: error.message };
    }

    // Extract text from the response
    const text = extractText(data);
    return { text, latencyMs, error: null };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - started);
    return { text: "", latencyMs, error: e instanceof Error ? e.message : String(e) };
  }
}

function extractText(data: unknown): string {
  if (!data || typeof data !== "object") return String(data ?? "");

  const d = data as Record<string, unknown>;

  // Standard strategy-chat returns { content: "..." } or { text: "..." }
  if (typeof d.content === "string") return d.content;
  if (typeof d.text === "string") return d.text;

  // May be nested in a message
  if (d.message && typeof d.message === "object") {
    const msg = d.message as Record<string, unknown>;
    if (typeof msg.content === "string") return msg.content;
    if (typeof msg.text === "string") return msg.text;
  }

  // Envelope shape from skill branch (shouldn't happen without header, but handle)
  if (d.envelope && typeof d.envelope === "object") {
    const env = d.envelope as Record<string, unknown>;
    if (typeof env.content === "string") return env.content;
    if (typeof env.text === "string") return env.text;
  }

  // Fallback
  return JSON.stringify(data).slice(0, 2000);
}
