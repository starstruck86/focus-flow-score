import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ARTIFACT_TOOLS: Record<string, any> = {
  email: {
    type: "function",
    function: {
      name: "email_artifact",
      description: "Generate a polished outbound email artifact.",
      parameters: {
        type: "object",
        properties: {
          subject_line: { type: "string" },
          body: { type: "string" },
          cta: { type: "string" },
          tone: { type: "string" },
          personalization_notes: { type: "string" },
        },
        required: ["subject_line", "body", "cta"],
        additionalProperties: false,
      },
    },
  },
  account_plan: {
    type: "function",
    function: {
      name: "account_plan_artifact",
      description: "Generate a polished executive-ready account plan.",
      parameters: {
        type: "object",
        properties: {
          executive_summary: { type: "string" },
          account_overview: { type: "string" },
          objectives: { type: "array", items: { type: "string" } },
          stakeholders: { type: "array", items: { type: "string" } },
          action_plan: { type: "array", items: { type: "string" } },
          timeline: { type: "string" },
          risks: { type: "array", items: { type: "string" } },
          success_metrics: { type: "array", items: { type: "string" } },
        },
        required: ["executive_summary", "account_overview", "objectives", "action_plan"],
        additionalProperties: false,
      },
    },
  },
  call_prep: {
    type: "function",
    function: {
      name: "call_prep_artifact",
      description: "Generate a call prep document.",
      parameters: {
        type: "object",
        properties: {
          objectives: { type: "array", items: { type: "string" } },
          talking_points: { type: "array", items: { type: "string" } },
          questions: { type: "array", items: { type: "string" } },
          objections: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
          desired_outcome: { type: "string" },
        },
        required: ["objectives", "talking_points", "questions"],
        additionalProperties: false,
      },
    },
  },
  memo: {
    type: "function",
    function: {
      name: "memo_artifact",
      description: "Generate a concise strategic memo.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          key_points: { type: "array", items: { type: "string" } },
          recommendations: { type: "array", items: { type: "string" } },
          next_steps: { type: "array", items: { type: "string" } },
        },
        required: ["title", "summary", "key_points"],
        additionalProperties: false,
      },
    },
  },
  next_steps: {
    type: "function",
    function: {
      name: "next_steps_artifact",
      description: "Generate a prioritized list of next steps.",
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: { type: "string" },
                priority: { type: "string", enum: ["high", "medium", "low"] },
                owner: { type: "string" },
                due: { type: "string" },
              },
              required: ["action", "priority"],
              additionalProperties: false,
            },
          },
          context_summary: { type: "string" },
        },
        required: ["steps"],
        additionalProperties: false,
      },
    },
  },
};

const TRANSFORM_PROMPTS: Record<string, string> = {
  email: "Transform the source analysis into a polished, personalized outbound email. Include a compelling subject line, professional body with clear value proposition, and a strong CTA. If account context is available, personalize heavily.",
  account_plan: "Transform the source analysis into an executive-ready account plan with clear structure: executive summary, account overview, strategic objectives, stakeholder map, action plan, timeline, risks, and success metrics.",
  call_prep: "Transform the source analysis into a practical call prep document. Include clear objectives, talking points ordered by priority, discovery questions, anticipated objections with responses, risks to watch for, and the desired outcome.",
  memo: "Transform the source analysis into a concise strategic memo suitable for sharing with leadership or team. Clear title, executive summary, key points, recommendations, and next steps.",
  next_steps: "Transform the source analysis into a prioritized action list. Each step should have a clear action, priority level, optional owner, and timeline. Order by priority and impact.",
};

function renderArtifact(type: string, data: any): string {
  switch (type) {
    case "email":
      return `Subject: ${data.subject_line || ""}\n\n${data.body || ""}\n\n${data.cta || ""}`;
    case "account_plan":
      return `# Account Plan\n\n## Executive Summary\n${data.executive_summary || ""}\n\n## Account Overview\n${data.account_overview || ""}\n\n## Objectives\n${(data.objectives || []).map((o: string) => `- ${o}`).join("\n")}\n\n## Stakeholders\n${(data.stakeholders || []).map((s: string) => `- ${s}`).join("\n")}\n\n## Action Plan\n${(data.action_plan || []).map((a: string) => `- ${a}`).join("\n")}\n\n## Timeline\n${data.timeline || ""}\n\n## Risks\n${(data.risks || []).map((r: string) => `- ${r}`).join("\n")}\n\n## Success Metrics\n${(data.success_metrics || []).map((m: string) => `- ${m}`).join("\n")}`;
    case "call_prep":
      return `# Call Prep\n\n## Objectives\n${(data.objectives || []).map((o: string) => `- ${o}`).join("\n")}\n\n## Talking Points\n${(data.talking_points || []).map((t: string) => `- ${t}`).join("\n")}\n\n## Questions\n${(data.questions || []).map((q: string) => `- ${q}`).join("\n")}\n\n## Anticipated Objections\n${(data.objections || []).map((o: string) => `- ${o}`).join("\n")}\n\n## Risks\n${(data.risks || []).map((r: string) => `- ${r}`).join("\n")}\n\n## Desired Outcome\n${data.desired_outcome || ""}`;
    case "memo":
      return `# ${data.title || "Strategic Memo"}\n\n## Summary\n${data.summary || ""}\n\n## Key Points\n${(data.key_points || []).map((k: string) => `- ${k}`).join("\n")}\n\n## Recommendations\n${(data.recommendations || []).map((r: string) => `- ${r}`).join("\n")}\n\n## Next Steps\n${(data.next_steps || []).map((n: string) => `- ${n}`).join("\n")}`;
    case "next_steps":
      return `# Next Steps\n\n${data.context_summary ? `## Context\n${data.context_summary}\n\n` : ""}## Actions\n${(data.steps || []).map((s: any) => `- [${(s.priority || "medium").toUpperCase()}] ${s.action}${s.owner ? ` (${s.owner})` : ""}${s.due ? ` — by ${s.due}` : ""}`).join("\n")}`;
    default:
      return JSON.stringify(data, null, 2);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
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

    const { sourceOutputId, targetArtifactType, threadId, parentArtifactId, refineInstructions } = body;

    if (!targetArtifactType || !ARTIFACT_TOOLS[targetArtifactType]) {
      return new Response(JSON.stringify({ error: "Invalid targetArtifactType" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch source data
    let sourceData: any = null;
    let sourceTitle = "";
    let linkedAccountId: string | null = null;
    let linkedOpportunityId: string | null = null;

    if (sourceOutputId) {
      const { data: output } = await supabase
        .from("strategy_outputs")
        .select("*")
        .eq("id", sourceOutputId)
        .eq("user_id", userId)
        .single();
      if (output) {
        sourceData = output.content_json;
        sourceTitle = output.title || "";
        linkedAccountId = output.linked_account_id;
        linkedOpportunityId = output.linked_opportunity_id;
      }
    }

    if (parentArtifactId) {
      const { data: parent } = await supabase
        .from("strategy_artifacts")
        .select("*")
        .eq("id", parentArtifactId)
        .eq("user_id", userId)
        .single();
      if (parent) {
        sourceData = parent.content_json;
        sourceTitle = parent.title || "";
        linkedAccountId = linkedAccountId || parent.linked_account_id;
        linkedOpportunityId = linkedOpportunityId || parent.linked_opportunity_id;
      }
    }

    if (!sourceData) {
      return new Response(JSON.stringify({ error: "Source output not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load account context if available
    let accountContext = "";
    if (linkedAccountId) {
      const { data: acct } = await supabase
        .from("accounts")
        .select("name, industry, tier, website, notes, outreach_status")
        .eq("id", linkedAccountId)
        .single();
      if (acct) {
        accountContext = `\n\nAccount Context:\nName: ${acct.name}\nIndustry: ${acct.industry || "Unknown"}\nTier: ${acct.tier || "Unset"}\nStatus: ${acct.outreach_status || "None"}${acct.notes ? `\nNotes: ${acct.notes.slice(0, 300)}` : ""}`;
      }
    }

    const tool = ARTIFACT_TOOLS[targetArtifactType];
    const prompt = TRANSFORM_PROMPTS[targetArtifactType] || TRANSFORM_PROMPTS.memo;

    const gateway = "https://ai.gateway.lovable.dev/v1/chat/completions";
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;

    const refineClause = refineInstructions
      ? `\n\nThe user has requested specific refinements:\n"${refineInstructions}"\n\nApply these instructions while preserving the overall structure and quality.`
      : "";

    const aiResp = await fetch(gateway, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a strategic sales writing assistant. ${prompt}${accountContext}${refineClause}\n\nYou MUST call the provided tool function with your structured result.`,
          },
          {
            role: "user",
            content: `Source analysis:\n${JSON.stringify(sourceData, null, 2)}`,
          },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: tool.function.name } },
        temperature: 0.5,
        max_tokens: 4096,
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `AI error: ${status}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await aiResp.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    let artifactData: any = null;
    if (toolCall?.function?.arguments) {
      try { artifactData = JSON.parse(toolCall.function.arguments); } catch {}
    }

    if (!artifactData) {
      const fallbackText = aiData.choices?.[0]?.message?.content || "";
      artifactData = { text: fallbackText };
    }

    const renderedText = renderArtifact(targetArtifactType, artifactData);
    const artifactTitle = artifactData.title || `${targetArtifactType.replace(/_/g, " ")} — ${sourceTitle}`.slice(0, 200);

    // Determine version
    let version = 1;
    if (parentArtifactId) {
      const { data: siblings } = await supabase
        .from("strategy_artifacts")
        .select("version")
        .eq("parent_artifact_id", parentArtifactId)
        .order("version", { ascending: false })
        .limit(1);
      if (siblings?.[0]) version = siblings[0].version + 1;
    }

    // Insert artifact
    const { data: artifact, error: insertErr } = await supabase
      .from("strategy_artifacts")
      .insert({
        user_id: userId,
        thread_id: threadId || null,
        source_output_id: sourceOutputId || null,
        artifact_type: targetArtifactType,
        title: artifactTitle,
        content_json: artifactData,
        rendered_text: renderedText,
        version,
        parent_artifact_id: parentArtifactId || null,
        linked_account_id: linkedAccountId,
        linked_opportunity_id: linkedOpportunityId,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // Save artifact message in thread
    if (threadId) {
      await supabase.from("strategy_messages").insert({
        thread_id: threadId,
        user_id: userId,
        role: "assistant",
        message_type: "artifact",
        content_json: {
          text: renderedText,
          structured: artifactData,
          artifactId: artifact.id,
          artifactType: targetArtifactType,
          sourceOutputId,
        },
      });
    }

    console.log(`[transform] ${targetArtifactType} created artifact=${artifact.id} from output=${sourceOutputId}`);

    return new Response(JSON.stringify({ artifact }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("strategy-transform-output error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
