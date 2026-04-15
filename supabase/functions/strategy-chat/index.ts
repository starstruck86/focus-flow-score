import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
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
    const { action, threadId, content, workflowType, linkedContext, uploadedResources, depth } = body;

    // ── Workflow execution ──────────────────────────────────
    if (action === "workflow") {
      // Create workflow run
      const { data: run, error: runErr } = await supabase
        .from("strategy_workflow_runs")
        .insert({ user_id: userId, thread_id: threadId, workflow_type: workflowType, status: "running", input_json: body })
        .select().single();
      if (runErr) throw runErr;

      // Append workflow start message
      await supabase.from("strategy_messages").insert({
        thread_id: threadId, user_id: userId, role: "system",
        message_type: "workflow_update",
        content_json: { text: `Running ${workflowType} workflow…` },
      });

      const systemPrompt = buildWorkflowPrompt(workflowType, linkedContext, uploadedResources);
      const userPrompt = content || `Execute ${workflowType} workflow.`;

      const aiResp = await fetch(GATEWAY, {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!aiResp.ok) {
        const status = aiResp.status;
        await supabase.from("strategy_workflow_runs").update({ status: "failed", error_json: { status } }).eq("id", run.id);
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted. Add funds in Settings." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error(`AI gateway error: ${status}`);
      }

      const aiData = await aiResp.json();
      const resultText = aiData.choices?.[0]?.message?.content || "No result generated.";

      // Update workflow run
      await supabase.from("strategy_workflow_runs").update({ status: "completed", result_json: { text: resultText } }).eq("id", run.id);

      // Save result message
      const { data: resultMsg } = await supabase.from("strategy_messages").insert({
        thread_id: threadId, user_id: userId, role: "assistant",
        message_type: "workflow_result",
        content_json: { text: resultText },
      }).select().single();

      // Create output
      const { data: output } = await supabase.from("strategy_outputs").insert({
        user_id: userId, thread_id: threadId, workflow_run_id: run.id,
        output_type: workflowTypeToOutputType(workflowType),
        title: `${workflowType} Result`,
        content_json: { text: resultText },
        rendered_text: resultText,
      }).select().single();

      // Update thread
      await supabase.from("strategy_threads").update({
        updated_at: new Date().toISOString(),
        summary: resultText.slice(0, 200),
      }).eq("id", threadId);

      return new Response(JSON.stringify({ resultMessage: resultMsg, output, workflowRun: run }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Standard chat ───────────────────────────────────────
    // Save user message
    await supabase.from("strategy_messages").insert({
      thread_id: threadId, user_id: userId, role: "user",
      message_type: "chat", content_json: { text: content },
    });

    // Build context
    const systemPrompt = buildChatPrompt(linkedContext, uploadedResources, depth);

    // Fetch recent thread messages for context
    const { data: recentMsgs } = await supabase
      .from("strategy_messages")
      .select("role, content_json")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(30);

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...(recentMsgs || []).map((m: any) => ({
        role: m.role === "user" ? "user" as const : "assistant" as const,
        content: (m.content_json as any)?.text || "",
      })),
    ];

    // Stream response
    const aiResp = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages, stream: true }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted. Add funds in Settings." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway error: ${status}`);
    }

    // We need to collect the full response to save it, while streaming to client
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

            // Parse chunks to collect full response
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

          // Save assistant response after stream completes
          await supabase.from("strategy_messages").insert({
            thread_id: threadId, user_id: userId, role: "assistant",
            message_type: "chat", content_json: { text: fullResponse },
          });
          await supabase.from("strategy_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
        } catch (e) {
          controller.error(e);
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("strategy-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function buildChatPrompt(linkedContext: any, uploads: any, depth: string): string {
  let prompt = `You are a strategic sales advisor embedded in a Strategy workspace. You help with deep account research, email evaluation, opportunity strategy, territory planning, and brainstorming.

Be specific, actionable, and grounded. When analyzing accounts or opportunities, reference concrete details. When evaluating emails, give specific improvements. When building strategy, structure your response clearly.

Depth mode: ${depth || "Standard"}. ${depth === "Deep" ? "Provide comprehensive, detailed analysis." : depth === "Fast" ? "Be concise and direct." : "Balance detail with clarity."}`;

  if (linkedContext) {
    if (linkedContext.account) {
      prompt += `\n\nLinked Account: ${linkedContext.account.name}${linkedContext.account.industry ? ` | Industry: ${linkedContext.account.industry}` : ""}${linkedContext.account.tier ? ` | Tier: ${linkedContext.account.tier}` : ""}`;
    }
    if (linkedContext.opportunity) {
      prompt += `\n\nLinked Opportunity: ${linkedContext.opportunity.name}${linkedContext.opportunity.stage ? ` | Stage: ${linkedContext.opportunity.stage}` : ""}${linkedContext.opportunity.amount ? ` | Amount: $${linkedContext.opportunity.amount}` : ""}`;
    }
    if (linkedContext.memories?.length) {
      prompt += `\n\nRelevant strategic memory:\n${linkedContext.memories.map((m: any) => `- [${m.memory_type}] ${m.content}`).join("\n")}`;
    }
  }

  if (uploads?.length) {
    prompt += `\n\nUploaded resources available:\n${uploads.map((u: any) => `- ${u.file_name}${u.summary ? `: ${u.summary}` : ""}${u.parsed_text ? `\nContent: ${u.parsed_text.slice(0, 2000)}` : ""}`).join("\n")}`;
  }

  return prompt;
}

function buildWorkflowPrompt(workflowType: string, linkedContext: any, uploads: any): string {
  const base = buildChatPrompt(linkedContext, uploads, "Deep");
  const workflows: Record<string, string> = {
    deep_research: "Conduct deep research on the linked account or topic. Analyze their business, industry trends, competitive landscape, technology stack, key stakeholders, and potential pain points. Structure findings as a research brief with sections: Overview, Key Findings, Strategic Implications, Recommended Actions.",
    account_plan: "Create a comprehensive account plan. Include: Executive Summary, Account Overview, Stakeholder Map, Current State Assessment, Strategic Objectives, Action Plan with Timeline, Risk Factors, Success Metrics.",
    territory_tiering: "Analyze and tier accounts in the territory. Evaluate each by: ICP fit, revenue potential, engagement level, competitive position, timing signals. Output a structured tiering result with Tier 1/2/3 classifications and rationale.",
    email_evaluation: "Evaluate the provided email or messaging. Analyze: subject line effectiveness, opening hook, value proposition clarity, call-to-action strength, tone alignment with buyer persona, personalization depth. Provide a scored assessment and rewritten version.",
    opportunity_strategy: "Build an opportunity strategy. Cover: Deal Summary, Decision Process Map, Champion Status, Competition Analysis, Value Proposition Alignment, Risk Mitigation, Next Best Actions, Close Plan.",
    brainstorm: "Facilitate a strategic brainstorm. Generate creative ideas, challenge assumptions, identify non-obvious angles, and propose unconventional approaches. Structure output as: Key Insights, Bold Ideas, Quick Wins, Strategic Bets.",
  };
  return base + "\n\n" + (workflows[workflowType] || workflows.brainstorm);
}

function workflowTypeToOutputType(wt: string): string {
  const map: Record<string, string> = {
    deep_research: "brief",
    account_plan: "account_plan",
    territory_tiering: "tiering_result",
    email_evaluation: "email",
    opportunity_strategy: "opportunity_plan",
    brainstorm: "memo",
  };
  return map[wt] || "memo";
}
