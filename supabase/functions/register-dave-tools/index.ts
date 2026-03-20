import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function tool(name: string, description: string, properties: Record<string, any>, required?: string[]) {
  const params: any = { type: "object", properties };
  if (required && required.length > 0) params.required = required;
  return {
    type: "client",
    name,
    description,
    client: {
      parameters: params,
      expects_response: true,
    },
  };
}

function str(desc: string, enumVals?: string[]) {
  const s: any = { type: "string", description: desc };
  if (enumVals) s.enum = enumVals;
  return s;
}
function num(desc: string) {
  return { type: "number", description: desc };
}

const DAVE_TOOLS = [
  tool("navigate", "Navigate to a page in the app", {
    path: str("The route path, e.g. /dashboard, /quota, /coach, /trends, /settings, /renewals, /outreach, /prep, /tasks"),
  }, ["path"]),
  tool("create_task", "Create a new task for the user", {
    title: str("The task title"),
    dueDate: str("Due date in YYYY-MM-DD format"),
    priority: str("Priority level", ["high", "medium", "low"]),
    linkedAccount: str("Account name to link the task to"),
  }, ["title"]),
  tool("update_account", "Update a field on an account record", {
    accountName: str("The account name to update"),
    field: str("The field to update, e.g. status, tier, owner, industry, next_step"),
    value: str("The new value for the field"),
  }, ["accountName", "field", "value"]),
  tool("update_opportunity", "Update a field on an opportunity record", {
    opportunityName: str("The opportunity name"),
    field: str("The field to update, e.g. stage, arr, close_date, next_step, status"),
    value: str("The new value"),
  }, ["opportunityName", "field", "value"]),
  tool("update_methodology", "Update a MEDDICC methodology field on an opportunity", {
    opportunityName: str("The opportunity name"),
    field: str("MEDDICC field", ["metrics", "economic_buyer", "decision_criteria", "decision_process", "identify_pain", "champion", "competition"]),
    value: str("The updated value or notes"),
  }, ["opportunityName", "field", "value"]),
  tool("log_touch", "Log a touch or interaction with an account", {
    accountName: str("The account name"),
    touchType: str("Type of touch", ["call", "email", "meeting", "linkedin", "other"]),
    notes: str("Notes about the interaction"),
  }, ["accountName", "touchType"]),
  tool("move_deal", "Move an opportunity to a new stage", {
    opportunityName: str("The opportunity name to move"),
    newStage: str("The new stage number or name, e.g. 1, 2, 3, 4, 5, Closed Won, Closed Lost"),
  }, ["opportunityName", "newStage"]),
  tool("add_note", "Add a note to an account or opportunity", {
    target: str("The account or opportunity name"),
    note: str("The note content"),
  }, ["target", "note"]),
  tool("lookup_account", "Look up details about an account including contacts, opportunities, and recent activity", {
    accountName: str("The account name to look up"),
  }, ["accountName"]),
  tool("scenario_calc", "Run a what-if scenario calculation for quota attainment", {
    arr: num("The ARR amount to simulate"),
    description: str("Description of the scenario"),
  }, ["arr"]),
  tool("pipeline_pulse", "Get a quick summary of the current pipeline health and key metrics", {}),
  tool("daily_briefing", "Get today's daily briefing including meetings, tasks, and priorities", {}),
  tool("debrief", "Log a meeting or call debrief with key takeaways", {
    accountName: str("The account the meeting was about"),
    summary: str("Summary of what happened"),
    nextSteps: str("Agreed next steps"),
    sentiment: str("How the meeting went", ["positive", "neutral", "negative"]),
  }, ["accountName", "summary"]),
  tool("draft_email", "Draft a follow-up or outreach email", {
    to: str("Recipient name or email"),
    subject: str("Email subject line"),
    body: str("Email body content"),
  }, ["to", "subject", "body"]),
  tool("set_reminder", "Set a reminder for a future date and time", {
    text: str("What to be reminded about"),
    dateTime: str("When to remind, in YYYY-MM-DD or natural language like tomorrow at 3pm"),
  }, ["text", "dateTime"]),
  tool("open_copilot", "Open the AI copilot with a specific question or request", {
    query: str("The question or request to send to the copilot"),
  }, ["query"]),
  tool("prep_meeting", "Generate a meeting prep brief for an upcoming meeting", {
    accountName: str("The account the meeting is with"),
    meetingType: str("Type of meeting", ["discovery", "demo", "negotiation", "review", "check-in"]),
  }, ["accountName"]),
  tool("start_roleplay", "Start a mock call roleplay simulation for practice", {
    scenario: str("The scenario to practice, e.g. cold call, discovery, objection handling"),
    accountName: str("Account to use as context"),
  }),
  tool("start_drill", "Start an objection handling drill session", {
    objectionType: str("Type of objection to drill", ["price", "timing", "competitor", "status_quo"]),
  }),
  tool("grade_call", "Grade a call transcript for coaching feedback", {
    accountName: str("The account the call was with"),
  }),
  tool("log_activity", "Log a sales activity", {
    activityType: str("Type of activity", ["call", "email", "meeting", "linkedin", "research"]),
    accountName: str("Account name if applicable"),
    notes: str("Notes about the activity"),
  }, ["activityType"]),
  // === NEW TOOLS (22-36) ===
  tool("update_daily_metrics", "Update the user's daily activity metrics like calls, connects, emails, meetings set. Use mode add to increment or set to replace the value.", {
    metric: str("The metric to update: calls, dials, connects, conversations, emails, manual_emails, meetings, meetings_set, prospects, prospects_added, customer_meetings, opps_created, opportunities_created, accounts_researched, contacts_prepped"),
    value: num("The number to add or set"),
    mode: str("Whether to add to or replace the current value", ["add", "set"]),
  }, ["metric", "value"]),
  tool("get_daily_metrics", "Get the user's daily activity metrics for today including calls, connects, emails, meetings set, and more", {}),
  tool("add_contact", "Add a new contact to the CRM", {
    name: str("Full name of the contact"),
    accountName: str("Account the contact belongs to"),
    title: str("Job title"),
    email: str("Email address"),
  }, ["name"]),
  tool("lookup_contact", "Look up contacts at a specific account", {
    accountName: str("The account name to look up contacts for"),
  }, ["accountName"]),
  tool("create_opportunity", "Create a new opportunity/deal in the pipeline", {
    name: str("Opportunity name"),
    accountName: str("Account name"),
    arr: num("Annual recurring revenue amount"),
    stage: str("Deal stage, e.g. 1, 2, 3, discovery, negotiation"),
  }, ["name", "accountName"]),
  tool("lookup_renewal", "Look up upcoming renewals, optionally filtered to a time range", {
    timeRange: str("Time range like this quarter, next 30 days, this month. Defaults to this quarter."),
  }),
  tool("update_renewal", "Update a renewal record's health status or risk reason", {
    accountName: str("The account name for the renewal"),
    health: str("Renewal health status", ["green", "yellow", "red"]),
    riskReason: str("Reason for the risk status"),
  }, ["accountName"]),
  tool("complete_task", "Mark a task as complete by searching for it by name", {
    taskName: str("The task title or partial match to find and complete"),
  }, ["taskName"]),
  tool("list_tasks", "List the user's tasks for today or upcoming tasks", {
    filter: str("Filter tasks", ["today", "overdue", "upcoming", "all"]),
  }),
  tool("get_calendar", "Get the user's calendar events for today or tomorrow", {
    day: str("Which day to check", ["today", "tomorrow"]),
  }),
  tool("quota_status", "Get the user's current quota attainment, showing closed won vs target with percentage", {}),
  tool("log_reflection", "Log a daily reflection including what worked, blockers, and lessons learned", {
    whatWorked: str("What went well today"),
    blocker: str("Main blocker or challenge"),
    lesson: str("Key lesson or takeaway"),
  }),
  tool("check_in", "Check the user in for today, marking their daily check-in as complete", {}),
  tool("lookup_transcript", "Look up the most recent call transcript for an account", {
    accountName: str("The account name to find transcripts for"),
  }, ["accountName"]),
  tool("start_power_hour", "Start a power hour focused calling session", {}),
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  const agentId = Deno.env.get("ELEVENLABS_AGENT_ID");

  if (!apiKey || !agentId) {
    return new Response(
      JSON.stringify({ error: "Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    // Fetch current agent to preserve non-client tools
    const getRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
      headers: { "xi-api-key": apiKey },
    });
    if (!getRes.ok) {
      const errText = await getRes.text();
      return new Response(
        JSON.stringify({ error: `Failed to fetch agent: ${getRes.status}`, details: errText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const agentConfig = await getRes.json();
    const existingTools = agentConfig?.conversation_config?.agent?.prompt?.tools || [];
    const nonClientTools = existingTools.filter((t: any) => t.type !== "client");
    const mergedTools = [...nonClientTools, ...DAVE_TOOLS];

    // PATCH the agent
    const patchBody = {
      conversation_config: {
        agent: {
          prompt: {
            tools: mergedTools,
          },
        },
      },
    };

    const patchRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
      method: "PATCH",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patchBody),
    });

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      return new Response(
        JSON.stringify({ error: `PATCH failed: ${patchRes.status}`, details: errText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Consume patch response
    await patchRes.text();

    // Verify by re-fetching agent
    const verifyRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
      headers: { "xi-api-key": apiKey },
    });
    const verifyData = await verifyRes.json();
    const finalTools = verifyData?.conversation_config?.agent?.prompt?.tools || [];
    const clientToolCount = finalTools.filter((t: any) => t.type === "client").length;
    const clientToolNames = finalTools.filter((t: any) => t.type === "client").map((t: any) => t.client?.name || t.name);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Registered ${clientToolCount} client tools on agent`,
        registeredTools: clientToolNames,
        totalToolsOnAgent: finalTools.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Unexpected error: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
