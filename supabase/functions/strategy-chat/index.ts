import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

// ── Model Routing ──────────────────────────────────────────
type TaskType = "chat_general" | "deep_research" | "email_evaluation" | "territory_tiering" | "account_plan" | "opportunity_strategy" | "brainstorm";

interface ModelRoute {
  model: string;
  temperature: number;
  maxTokens: number;
  reasoning?: { effort: string };
}

const MODEL_ROUTES: Record<TaskType, ModelRoute> = {
  chat_general:        { model: "google/gemini-3-flash-preview", temperature: 0.7, maxTokens: 4096 },
  deep_research:       { model: "google/gemini-2.5-pro",         temperature: 0.3, maxTokens: 8192 },
  email_evaluation:    { model: "google/gemini-3-flash-preview", temperature: 0.4, maxTokens: 4096 },
  territory_tiering:   { model: "google/gemini-2.5-pro",         temperature: 0.2, maxTokens: 8192 },
  account_plan:        { model: "google/gemini-2.5-flash",       temperature: 0.5, maxTokens: 8192 },
  opportunity_strategy:{ model: "google/gemini-2.5-flash",       temperature: 0.5, maxTokens: 8192 },
  brainstorm:          { model: "google/gemini-3-flash-preview", temperature: 0.9, maxTokens: 4096 },
};

// ── Workflow Tool Schemas ──────────────────────────────────
const WORKFLOW_TOOLS: Record<string, any> = {
  deep_research: {
    type: "function",
    function: {
      name: "deep_research_result",
      description: "Return structured deep research findings.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          company_overview: { type: "string" },
          key_findings: { type: "array", items: { type: "string" } },
          strategic_implications: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
          opportunities: { type: "array", items: { type: "string" } },
          recommended_actions: { type: "array", items: { type: "string" } },
          cited_sources: { type: "array", items: { type: "string" } },
        },
        required: ["summary", "company_overview", "key_findings", "strategic_implications", "risks", "opportunities", "recommended_actions", "cited_sources"],
        additionalProperties: false,
      },
    },
  },
  email_evaluation: {
    type: "function",
    function: {
      name: "email_evaluation_result",
      description: "Return structured email evaluation.",
      parameters: {
        type: "object",
        properties: {
          overall_score: { type: "number" },
          strengths: { type: "array", items: { type: "string" } },
          weaknesses: { type: "array", items: { type: "string" } },
          subject_line_feedback: { type: "string" },
          opening_feedback: { type: "string" },
          value_prop_feedback: { type: "string" },
          cta_feedback: { type: "string" },
          rewrite: { type: "string" },
        },
        required: ["overall_score", "strengths", "weaknesses", "subject_line_feedback", "opening_feedback", "value_prop_feedback", "cta_feedback", "rewrite"],
        additionalProperties: false,
      },
    },
  },
  territory_tiering: {
    type: "function",
    function: {
      name: "territory_tiering_result",
      description: "Return structured territory tiering analysis.",
      parameters: {
        type: "object",
        properties: {
          methodology: { type: "string" },
          tiers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                account_name: { type: "string" },
                tier: { type: "string", enum: ["Tier 1", "Tier 2", "Tier 3", "Tier 4"] },
                rationale: { type: "string" },
                next_action: { type: "string" },
              },
              required: ["account_name", "tier", "rationale", "next_action"],
              additionalProperties: false,
            },
          },
          summary: { type: "string" },
        },
        required: ["methodology", "tiers", "summary"],
        additionalProperties: false,
      },
    },
  },
  account_plan: {
    type: "function",
    function: {
      name: "account_plan_result",
      description: "Return structured account plan.",
      parameters: {
        type: "object",
        properties: {
          executive_summary: { type: "string" },
          account_overview: { type: "string" },
          stakeholder_map: { type: "array", items: { type: "string" } },
          strategic_objectives: { type: "array", items: { type: "string" } },
          action_plan: { type: "array", items: { type: "string" } },
          risk_factors: { type: "array", items: { type: "string" } },
          success_metrics: { type: "array", items: { type: "string" } },
        },
        required: ["executive_summary", "account_overview", "stakeholder_map", "strategic_objectives", "action_plan", "risk_factors", "success_metrics"],
        additionalProperties: false,
      },
    },
  },
  opportunity_strategy: {
    type: "function",
    function: {
      name: "opportunity_strategy_result",
      description: "Return structured opportunity strategy.",
      parameters: {
        type: "object",
        properties: {
          deal_summary: { type: "string" },
          decision_process: { type: "string" },
          champion_status: { type: "string" },
          competition_analysis: { type: "string" },
          value_alignment: { type: "string" },
          risks: { type: "array", items: { type: "string" } },
          next_actions: { type: "array", items: { type: "string" } },
          close_plan: { type: "string" },
        },
        required: ["deal_summary", "decision_process", "champion_status", "competition_analysis", "value_alignment", "risks", "next_actions", "close_plan"],
        additionalProperties: false,
      },
    },
  },
  brainstorm: {
    type: "function",
    function: {
      name: "brainstorm_result",
      description: "Return structured brainstorm output.",
      parameters: {
        type: "object",
        properties: {
          key_insights: { type: "array", items: { type: "string" } },
          bold_ideas: { type: "array", items: { type: "string" } },
          quick_wins: { type: "array", items: { type: "string" } },
          strategic_bets: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
        required: ["key_insights", "bold_ideas", "quick_wins", "strategic_bets", "summary"],
        additionalProperties: false,
      },
    },
  },
};

const ROLLUP_TOOL = {
  type: "function",
  function: {
    name: "generate_rollup",
    description: "Generate a structured thread rollup.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string" },
        key_facts: { type: "array", items: { type: "string" } },
        hypotheses: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        open_questions: { type: "array", items: { type: "string" } },
        next_steps: { type: "array", items: { type: "string" } },
        memory_suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              memory_type: { type: "string", enum: ["fact", "hypothesis", "risk", "priority", "stakeholder_note", "messaging_note", "next_step"] },
              content: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["memory_type", "content", "confidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "key_facts", "hypotheses", "risks", "open_questions", "next_steps", "memory_suggestions"],
      additionalProperties: false,
    },
  },
};

// ── Retrieval Layer ────────────────────────────────────────
const MAX_CONTEXT_CHARS = 12000;

interface ContextPack {
  account?: any;
  opportunity?: any;
  memories: any[];
  uploads: any[];
  outputs: any[];
  recentMessages: any[];
  sourceCount: number;
}

async function buildContextPack(
  supabase: any,
  threadId: string,
  userId: string,
  userQuery?: string,
): Promise<ContextPack> {
  const pack: ContextPack = { memories: [], uploads: [], outputs: [], recentMessages: [], sourceCount: 0 };

  // 1. Get thread metadata
  const { data: thread } = await supabase
    .from("strategy_threads")
    .select("linked_account_id, linked_opportunity_id, linked_territory_id")
    .eq("id", threadId)
    .single();
  if (!thread) return pack;

  const queryTerms = (userQuery || "").toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);

  // 2. Load linked object + memories (parallel)
  const promises: Promise<void>[] = [];

  if (thread.linked_account_id) {
    promises.push((async () => {
      const { data: acct } = await supabase
        .from("accounts")
        .select("id, name, industry, tier, website, notes, outreach_status")
        .eq("id", thread.linked_account_id)
        .single();
      pack.account = acct;

      const { data: mem } = await supabase
        .from("account_strategy_memory")
        .select("id, memory_type, content, is_pinned, created_at")
        .eq("account_id", thread.linked_account_id)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (mem) pack.memories.push(...mem.map((m: any) => ({ ...m, source: "account" })));
    })());
  }

  if (thread.linked_opportunity_id) {
    promises.push((async () => {
      const { data: opp } = await supabase
        .from("opportunities")
        .select("id, name, stage, close_date, notes")
        .eq("id", thread.linked_opportunity_id)
        .single();
      pack.opportunity = opp ? { ...opp, amount: null } : null;

      const { data: mem } = await supabase
        .from("opportunity_strategy_memory")
        .select("id, memory_type, content, is_pinned, created_at")
        .eq("opportunity_id", thread.linked_opportunity_id)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (mem) pack.memories.push(...mem.map((m: any) => ({ ...m, source: "opportunity" })));
    })());
  }

  if (thread.linked_territory_id) {
    promises.push((async () => {
      const { data: mem } = await supabase
        .from("territory_strategy_memory")
        .select("id, memory_type, content, is_pinned, created_at")
        .eq("territory_id", thread.linked_territory_id)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (mem) pack.memories.push(...mem.map((m: any) => ({ ...m, source: "territory" })));
    })());
  }

  // 3. Uploads for this thread
  promises.push((async () => {
    const { data: ups } = await supabase
      .from("strategy_uploaded_resources")
      .select("id, file_name, parsed_text, summary")
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (ups) pack.uploads = ups.filter((u: any) => u.parsed_text || u.summary);
  })());

  // 4. Outputs for this thread
  promises.push((async () => {
    const { data: outs } = await supabase
      .from("strategy_outputs")
      .select("id, output_type, title, rendered_text")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (outs) pack.outputs = outs;
  })());

  // 5. Recent thread messages
  promises.push((async () => {
    const { data: msgs } = await supabase
      .from("strategy_messages")
      .select("id, role, content_json")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (msgs) {
      pack.recentMessages = msgs.reverse().map((m: any) => ({
        id: m.id,
        role: m.role,
        text: (m.content_json?.text || "").slice(0, 500),
      }));
    }
  })());

  await Promise.all(promises);

  // 6. Score and rank memories
  pack.memories = scoreAndRank(pack.memories, queryTerms);
  pack.sourceCount = (pack.account ? 1 : 0) + (pack.opportunity ? 1 : 0)
    + pack.memories.length + pack.uploads.length + pack.outputs.length;

  console.log(`[retrieval] sources: ${pack.sourceCount} (memories: ${pack.memories.length}, uploads: ${pack.uploads.length}, outputs: ${pack.outputs.length}, messages: ${pack.recentMessages.length})`);

  return pack;
}

function scoreAndRank(memories: any[], queryTerms: string[]): any[] {
  return memories
    .map((m) => {
      let score = 1;
      if (m.is_pinned) score += 3;
      const age = Date.now() - new Date(m.created_at).getTime();
      if (age < 7 * 86400000) score += 2; // recent week
      else if (age < 30 * 86400000) score += 1;
      if (queryTerms.length > 0) {
        const content = m.content.toLowerCase();
        const overlap = queryTerms.filter((t: string) => content.includes(t)).length;
        score += overlap * 2;
      }
      return { ...m, score };
    })
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 15);
}

function packToPromptSection(pack: ContextPack): string {
  const sections: string[] = [];
  let charBudget = MAX_CONTEXT_CHARS;

  if (pack.account) {
    const s = `\n### Linked Account: ${pack.account.name}\nIndustry: ${pack.account.industry || "Unknown"} | Tier: ${pack.account.tier || "Unset"} | Status: ${pack.account.outreach_status || "None"}${pack.account.notes ? `\nNotes: ${pack.account.notes.slice(0, 300)}` : ""}`;
    sections.push(s);
    charBudget -= s.length;
  }

  if (pack.opportunity) {
    const s = `\n### Linked Opportunity: ${pack.opportunity.name}\nStage: ${pack.opportunity.stage || "Unknown"}${pack.opportunity.close_date ? ` | Close: ${pack.opportunity.close_date}` : ""}${pack.opportunity.notes ? `\nNotes: ${pack.opportunity.notes.slice(0, 300)}` : ""}`;
    sections.push(s);
    charBudget -= s.length;
  }

  if (pack.memories.length > 0) {
    let memSection = "\n### Strategic Memory:";
    for (const m of pack.memories) {
      const line = `\n- [${m.memory_type}${m.is_pinned ? " 📌" : ""}] ${m.content.slice(0, 200)}`;
      if (charBudget - line.length < 0) break;
      memSection += line;
      charBudget -= line.length;
    }
    sections.push(memSection);
  }

  if (pack.uploads.length > 0) {
    let upSection = "\n### Uploaded Resources:";
    for (const u of pack.uploads) {
      const text = u.summary || (u.parsed_text || "").slice(0, 500);
      const line = `\n- ${u.file_name}: ${text}`;
      if (charBudget - line.length < 0) break;
      upSection += line;
      charBudget -= line.length;
    }
    sections.push(upSection);
  }

  if (pack.outputs.length > 0) {
    let outSection = "\n### Prior Outputs:";
    for (const o of pack.outputs) {
      const text = (o.rendered_text || "").slice(0, 300);
      const line = `\n- [${o.output_type}] ${o.title}: ${text}`;
      if (charBudget - line.length < 0) break;
      outSection += line;
      charBudget -= line.length;
    }
    sections.push(outSection);
  }

  return sections.join("\n");
}

// ── Rendered text from structured output ───────────────────
function renderStructuredOutput(workflowType: string, data: any): string {
  switch (workflowType) {
    case "deep_research":
      return `# Deep Research\n\n## Summary\n${data.summary}\n\n## Company Overview\n${data.company_overview}\n\n## Key Findings\n${(data.key_findings || []).map((f: string) => `- ${f}`).join("\n")}\n\n## Strategic Implications\n${(data.strategic_implications || []).map((s: string) => `- ${s}`).join("\n")}\n\n## Risks\n${(data.risks || []).map((r: string) => `- ${r}`).join("\n")}\n\n## Opportunities\n${(data.opportunities || []).map((o: string) => `- ${o}`).join("\n")}\n\n## Recommended Actions\n${(data.recommended_actions || []).map((a: string) => `- ${a}`).join("\n")}\n\n## Sources\n${(data.cited_sources || []).map((s: string) => `- ${s}`).join("\n")}`;
    case "email_evaluation":
      return `# Email Evaluation\n\n**Score: ${data.overall_score}/10**\n\n## Strengths\n${(data.strengths || []).map((s: string) => `- ${s}`).join("\n")}\n\n## Weaknesses\n${(data.weaknesses || []).map((w: string) => `- ${w}`).join("\n")}\n\n## Subject Line\n${data.subject_line_feedback}\n\n## Opening\n${data.opening_feedback}\n\n## Value Proposition\n${data.value_prop_feedback}\n\n## CTA\n${data.cta_feedback}\n\n## Suggested Rewrite\n${data.rewrite}`;
    case "territory_tiering":
      return `# Territory Tiering\n\n## Methodology\n${data.methodology}\n\n## Results\n${(data.tiers || []).map((t: any) => `### ${t.account_name} — ${t.tier}\n${t.rationale}\n**Next:** ${t.next_action}`).join("\n\n")}\n\n## Summary\n${data.summary}`;
    case "account_plan":
      return `# Account Plan\n\n## Executive Summary\n${data.executive_summary}\n\n## Overview\n${data.account_overview}\n\n## Stakeholders\n${(data.stakeholder_map || []).map((s: string) => `- ${s}`).join("\n")}\n\n## Strategic Objectives\n${(data.strategic_objectives || []).map((o: string) => `- ${o}`).join("\n")}\n\n## Action Plan\n${(data.action_plan || []).map((a: string) => `- ${a}`).join("\n")}\n\n## Risk Factors\n${(data.risk_factors || []).map((r: string) => `- ${r}`).join("\n")}\n\n## Success Metrics\n${(data.success_metrics || []).map((m: string) => `- ${m}`).join("\n")}`;
    case "opportunity_strategy":
      return `# Opportunity Strategy\n\n## Deal Summary\n${data.deal_summary}\n\n## Decision Process\n${data.decision_process}\n\n## Champion Status\n${data.champion_status}\n\n## Competition\n${data.competition_analysis}\n\n## Value Alignment\n${data.value_alignment}\n\n## Risks\n${(data.risks || []).map((r: string) => `- ${r}`).join("\n")}\n\n## Next Actions\n${(data.next_actions || []).map((a: string) => `- ${a}`).join("\n")}\n\n## Close Plan\n${data.close_plan}`;
    case "brainstorm":
      return `# Brainstorm\n\n## Key Insights\n${(data.key_insights || []).map((i: string) => `- ${i}`).join("\n")}\n\n## Bold Ideas\n${(data.bold_ideas || []).map((i: string) => `- ${i}`).join("\n")}\n\n## Quick Wins\n${(data.quick_wins || []).map((w: string) => `- ${w}`).join("\n")}\n\n## Strategic Bets\n${(data.strategic_bets || []).map((b: string) => `- ${b}`).join("\n")}\n\n## Summary\n${data.summary}`;
    default:
      return JSON.stringify(data, null, 2);
  }
}

function workflowTypeToOutputType(wt: string): string {
  const map: Record<string, string> = {
    deep_research: "brief", account_plan: "account_plan", territory_tiering: "tiering_result",
    email_evaluation: "email", opportunity_strategy: "opportunity_plan", brainstorm: "memo",
  };
  return map[wt] || "memo";
}

// ── Main Handler ───────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      userId = user?.id ?? null;
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, threadId, content, workflowType, depth } = body;

    // ── Build retrieval context pack ──────────────────────
    const contextPack = await buildContextPack(supabase, threadId, userId, content);
    const contextSection = packToPromptSection(contextPack);

    // ── ROLLUP action ─────────────────────────────────────
    if (action === "rollup") {
      return await handleRollup(supabase, LOVABLE_API_KEY, threadId, userId, contextPack);
    }

    // ── WORKFLOW action ───────────────────────────────────
    if (action === "workflow") {
      return await handleWorkflow(supabase, LOVABLE_API_KEY, threadId, userId, workflowType, content, contextSection, contextPack);
    }

    // ── CHAT action ───────────────────────────────────────
    return await handleChat(supabase, LOVABLE_API_KEY, threadId, userId, content, depth, contextSection, contextPack);
  } catch (e) {
    console.error("strategy-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Chat Handler ──────────────────────────────────────────
async function handleChat(
  supabase: any, apiKey: string, threadId: string, userId: string,
  content: string, depth: string, contextSection: string, pack: ContextPack,
) {
  // Save user message
  await supabase.from("strategy_messages").insert({
    thread_id: threadId, user_id: userId, role: "user",
    message_type: "chat", content_json: { text: content },
  });

  const route = MODEL_ROUTES.chat_general;
  const systemPrompt = `You are a strategic sales advisor embedded in a Strategy workspace. You help with deep account research, email evaluation, opportunity strategy, territory planning, and brainstorming.

Be specific, actionable, and grounded. Reference concrete details from the context provided. When citing information from strategic memory or uploaded resources, note the source.

Depth mode: ${depth || "Standard"}. ${depth === "Deep" ? "Provide comprehensive, detailed analysis." : depth === "Fast" ? "Be concise and direct." : "Balance detail with clarity."}
${contextSection}`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...pack.recentMessages.map((m) => ({
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: m.text,
    })),
  ];

  const aiResp = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: route.model,
      messages,
      stream: true,
      temperature: route.temperature,
      max_tokens: route.maxTokens,
    }),
  });

  if (!aiResp.ok) return handleAIError(aiResp.status);

  const reader = aiResp.body!.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          controller.enqueue(new TextEncoder().encode(chunk));
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) fullResponse += delta;
            } catch {}
          }
        }
        controller.close();

        // Save assistant response
        await supabase.from("strategy_messages").insert({
          thread_id: threadId, user_id: userId, role: "assistant",
          message_type: "chat",
          content_json: { text: fullResponse, sources_used: pack.sourceCount },
        });
        await supabase.from("strategy_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);

        // Check if rollup needed (every 8 messages)
        const { count } = await supabase
          .from("strategy_messages")
          .select("id", { count: "exact", head: true })
          .eq("thread_id", threadId);
        if (count && count % 8 === 0) {
          console.log(`[auto-rollup] triggering for thread ${threadId} at ${count} messages`);
          triggerRollupAsync(supabase, Deno.env.get("LOVABLE_API_KEY")!, threadId, userId);
        }
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}

// ── Workflow Handler ──────────────────────────────────────
async function handleWorkflow(
  supabase: any, apiKey: string, threadId: string, userId: string,
  workflowType: string, content: string, contextSection: string, pack: ContextPack,
) {
  const route = MODEL_ROUTES[workflowType as TaskType] || MODEL_ROUTES.chat_general;
  const tool = WORKFLOW_TOOLS[workflowType];

  // Create workflow run
  const { data: run, error: runErr } = await supabase
    .from("strategy_workflow_runs")
    .insert({ user_id: userId, thread_id: threadId, workflow_type: workflowType, status: "running", input_json: { content, workflowType } })
    .select().single();
  if (runErr) throw runErr;

  // Save workflow start message
  await supabase.from("strategy_messages").insert({
    thread_id: threadId, user_id: userId, role: "system",
    message_type: "workflow_update",
    content_json: { text: `Running ${workflowType.replace(/_/g, " ")}…`, workflowType, runId: run.id },
  });

  const workflowPrompts: Record<string, string> = {
    deep_research: "Conduct deep research on the linked account or topic. Analyze business, industry trends, competitive landscape, technology stack, key stakeholders, and potential pain points.",
    account_plan: "Create a comprehensive account plan including executive summary, stakeholder map, strategic objectives, action plan, risks, and success metrics.",
    territory_tiering: "Analyze and tier accounts in the territory by ICP fit, revenue potential, engagement level, competitive position, and timing signals.",
    email_evaluation: "Evaluate the provided email or messaging for subject line, opening, value prop, CTA strength, tone, and personalization. Provide scored assessment and rewrite.",
    opportunity_strategy: "Build an opportunity strategy covering deal summary, decision process, champion status, competition, value alignment, risks, next actions, and close plan.",
    brainstorm: "Facilitate a strategic brainstorm. Generate creative ideas, challenge assumptions, identify non-obvious angles, and propose unconventional approaches.",
  };

  const systemPrompt = `You are a strategic sales advisor. Use the context below to produce a thorough, grounded analysis.
${contextSection}

${workflowPrompts[workflowType] || workflowPrompts.brainstorm}

You MUST call the provided tool function with your structured result.`;

  const userPrompt = content || `Execute ${workflowType.replace(/_/g, " ")} workflow.`;

  const reqBody: any = {
    model: route.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: route.temperature,
    max_tokens: route.maxTokens,
  };

  if (tool) {
    reqBody.tools = [tool];
    reqBody.tool_choice = { type: "function", function: { name: tool.function.name } };
  }

  if (route.reasoning) {
    reqBody.reasoning = route.reasoning;
  }

  console.log(`[workflow] ${workflowType} using model=${route.model}`);

  const aiResp = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });

  if (!aiResp.ok) {
    await supabase.from("strategy_workflow_runs").update({ status: "failed", error_json: { status: aiResp.status } }).eq("id", run.id);
    return handleAIError(aiResp.status);
  }

  const aiData = await aiResp.json();

  // Extract structured output from tool call
  let structuredData: any = null;
  let renderedText = "";

  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    try {
      structuredData = JSON.parse(toolCall.function.arguments);
      renderedText = renderStructuredOutput(workflowType, structuredData);
    } catch (e) {
      console.error("[workflow] Failed to parse tool call:", e);
    }
  }

  // Fallback to plain text if tool call failed
  if (!structuredData) {
    renderedText = aiData.choices?.[0]?.message?.content || "No result generated.";
    structuredData = { text: renderedText };
  }

  // Update workflow run
  await supabase.from("strategy_workflow_runs")
    .update({ status: "completed", result_json: structuredData })
    .eq("id", run.id);

  // Save result message with structured data
  const { data: resultMsg } = await supabase.from("strategy_messages").insert({
    thread_id: threadId, user_id: userId, role: "assistant",
    message_type: "workflow_result",
    content_json: {
      text: renderedText,
      structured: structuredData,
      workflowType,
      runId: run.id,
      sources_used: pack.sourceCount,
    },
  }).select().single();

  // Create durable output
  const { data: output } = await supabase.from("strategy_outputs").insert({
    user_id: userId, thread_id: threadId, workflow_run_id: run.id,
    output_type: workflowTypeToOutputType(workflowType),
    title: `${workflowType.replace(/_/g, " ")} — ${new Date().toLocaleDateString()}`,
    content_json: structuredData,
    rendered_text: renderedText,
    linked_account_id: pack.account?.id || null,
    linked_opportunity_id: pack.opportunity?.id || null,
  }).select().single();

  // Update thread
  await supabase.from("strategy_threads").update({
    updated_at: new Date().toISOString(),
    summary: (structuredData.summary || structuredData.executive_summary || renderedText || "").slice(0, 200),
  }).eq("id", threadId);

  console.log(`[workflow] ${workflowType} completed. output=${output?.id}`);

  // Trigger auto-rollup after workflow
  triggerRollupAsync(supabase, Deno.env.get("LOVABLE_API_KEY")!, threadId, userId);

  return new Response(JSON.stringify({
    resultMessage: resultMsg,
    output,
    workflowRun: run,
    structured: structuredData,
    sourceCount: pack.sourceCount,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Rollup Handler ────────────────────────────────────────
async function handleRollup(
  supabase: any, apiKey: string, threadId: string, userId: string, pack?: ContextPack,
) {
  if (!pack) {
    pack = await buildContextPack(supabase, threadId, userId);
  }

  if (pack.recentMessages.length < 3) {
    return new Response(JSON.stringify({ rollup: null, reason: "Not enough messages" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const conversationText = pack.recentMessages
    .map((m) => `${m.role}: ${m.text}`)
    .join("\n")
    .slice(0, 8000);

  const route = MODEL_ROUTES.chat_general;

  const aiResp = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: route.model,
      messages: [
        { role: "system", content: "You are analyzing a strategy conversation thread. Summarize the key points, identify hypotheses, risks, open questions, and next steps. Also suggest memory entries that should be saved." },
        { role: "user", content: conversationText },
      ],
      tools: [ROLLUP_TOOL],
      tool_choice: { type: "function", function: { name: "generate_rollup" } },
      temperature: 0.3,
    }),
  });

  if (!aiResp.ok) return handleAIError(aiResp.status);

  const aiData = await aiResp.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

  let rollup: any = null;
  if (toolCall?.function?.arguments) {
    try {
      rollup = JSON.parse(toolCall.function.arguments);
      rollup.updated_at = new Date().toISOString();
    } catch (e) {
      console.error("[rollup] parse error:", e);
    }
  }

  if (rollup) {
    // Save to thread
    await supabase.from("strategy_threads").update({
      latest_rollup: rollup,
      updated_at: new Date().toISOString(),
    }).eq("id", threadId);

    // Save to strategy_rollups
    await supabase.from("strategy_rollups").insert({
      object_type: "thread",
      object_id: threadId,
      rollup_type: "summary",
      content_json: rollup,
      generated_from_thread_ids: [threadId],
      user_id: userId,
    });

    console.log(`[rollup] saved for thread ${threadId}`);
  }

  return new Response(JSON.stringify({ rollup }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Fire-and-forget rollup (doesn't block the response)
function triggerRollupAsync(supabase: any, apiKey: string, threadId: string, userId: string) {
  handleRollup(supabase, apiKey, threadId, userId).catch((e) =>
    console.error("[auto-rollup] failed:", e)
  );
}

function handleAIError(status: number) {
  if (status === 429) return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted. Add funds in Settings." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ error: `AI gateway error: ${status}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
