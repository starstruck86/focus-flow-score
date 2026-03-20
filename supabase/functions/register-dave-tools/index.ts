import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Helper to build a parameter object in ElevenLabs format
function p(name: string, type: string, description: string, required: boolean, enumValues?: string[]) {
  const param: any = { name, type, description, required };
  if (enumValues) param.enum = enumValues;
  return param;
}

/**
 * All 36 Dave client tools in ElevenLabs array-parameter format.
 */
const DAVE_TOOLS = [
  {
    type: "client",
    name: "navigate",
    description: "Navigate to a page in the app",
    parameters: [
      p("path", "string", "The route path, e.g. /dashboard, /quota, /coach, /trends, /settings, /renewals, /outreach, /prep, /tasks", true),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "create_task",
    description: "Create a new task for the user",
    parameters: [
      p("title", "string", "The task title", true),
      p("dueDate", "string", "Due date in YYYY-MM-DD format", false),
      p("priority", "string", "Priority level", false, ["high", "medium", "low"]),
      p("linkedAccount", "string", "Account name to link the task to", false),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "update_account",
    description: "Update a field on an account record",
    parameters: [
      p("accountName", "string", "The account name to update", true),
      p("field", "string", "The field to update, e.g. status, tier, owner, industry, next_step", true),
      p("value", "string", "The new value for the field", true),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "update_opportunity",
    description: "Update a field on an opportunity record",
    parameters: [
      p("opportunityName", "string", "The opportunity name", true),
      p("field", "string", "The field to update, e.g. stage, arr, close_date, next_step, status", true),
      p("value", "string", "The new value", true),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "update_methodology",
    description: "Update a MEDDICC methodology field on an opportunity",
    parameters: [
      p("opportunityName", "string", "The opportunity name", true),
      p("field", "string", "MEDDICC field", true, ["metrics", "economic_buyer", "decision_criteria", "decision_process", "identify_pain", "champion", "competition"]),
      p("value", "string", "The updated value or notes", true),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "log_touch",
    description: "Log a touch or interaction with an account",
    parameters: [
      p("accountName", "string", "The account name", true),
      p("touchType", "string", "Type of touch", true, ["call", "email", "meeting", "linkedin", "other"]),
      p("notes", "string", "Notes about the interaction", false),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "move_deal",
    description: "Move an opportunity to a new stage",
    parameters: [
      p("opportunityName", "string", "The opportunity name to move", true),
      p("newStage", "string", "The new stage number or name, e.g. 1, 2, 3, 4, 5, Closed Won, Closed Lost", true),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "add_note",
    description: "Add a note to an account or opportunity",
    parameters: [
      p("target", "string", "The account or opportunity name", true),
      p("note", "string", "The note content", true),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "lookup_account",
    description: "Look up details about an account including contacts, opportunities, and recent activity",
    parameters: [
      p("accountName", "string", "The account name to look up", true),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "scenario_calc",
    description: "Run a what-if scenario calculation for quota attainment",
    parameters: [
      p("arr", "number", "The ARR amount to simulate", true),
      p("description", "string", "Description of the scenario", false),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "pipeline_pulse",
    description: "Get a quick summary of the current pipeline health and key metrics",
    parameters: [],
    expects_response: true,
  },
  {
    type: "client",
    name: "daily_briefing",
    description: "Get today's daily briefing including meetings, tasks, and priorities",
    parameters: [],
    expects_response: true,
  },
  {
    type: "client",
    name: "debrief",
    description: "Log a meeting or call debrief with key takeaways",
    parameters: [
      p("accountName", "string", "The account the meeting was about", true),
      p("summary", "string", "Summary of what happened", true),
      p("nextSteps", "string", "Agreed next steps", false),
      p("sentiment", "string", "How the meeting went", false, ["positive", "neutral", "negative"]),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "draft_email",
    description: "Draft a follow-up or outreach email",
    parameters: [
      p("to", "string", "Recipient name or email", true),
      p("subject", "string", "Email subject line", true),
      p("body", "string", "Email body content", true),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "set_reminder",
    description: "Set a reminder for a future date and time",
    parameters: [
      p("text", "string", "What to be reminded about", true),
      p("dateTime", "string", "When to remind, in YYYY-MM-DD or natural language like tomorrow at 3pm", true),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "open_copilot",
    description: "Open the AI copilot with a specific question or request",
    parameters: [
      p("query", "string", "The question or request to send to the copilot", true),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "prep_meeting",
    description: "Generate a meeting prep brief for an upcoming meeting",
    parameters: [
      p("accountName", "string", "The account the meeting is with", true),
      p("meetingType", "string", "Type of meeting", false, ["discovery", "demo", "negotiation", "review", "check-in"]),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "start_roleplay",
    description: "Start a mock call roleplay simulation for practice",
    parameters: [
      p("scenario", "string", "The scenario to practice, e.g. cold call, discovery, objection handling", false),
      p("accountName", "string", "Account to use as context", false),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "start_drill",
    description: "Start an objection handling drill session",
    parameters: [
      p("objectionType", "string", "Type of objection to drill", false, ["price", "timing", "competitor", "status_quo"]),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "grade_call",
    description: "Grade a call transcript for coaching feedback",
    parameters: [
      p("accountName", "string", "The account the call was with", false),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "log_activity",
    description: "Log a sales activity",
    parameters: [
      p("activityType", "string", "Type of activity", true, ["call", "email", "meeting", "linkedin", "research"]),
      p("accountName", "string", "Account name if applicable", false),
      p("notes", "string", "Notes about the activity", false),
    ],
    expects_response: true,
  },
  // === NEW TOOLS (22-36) ===
  {
    type: "client",
    name: "update_daily_metrics",
    description: "Update the user's daily activity metrics like calls, connects, emails, meetings set. Use mode add to increment or set to replace the value.",
    parameters: [
      p("metric", "string", "The metric to update: calls, dials, connects, conversations, emails, manual_emails, meetings, meetings_set, prospects, prospects_added, customer_meetings, opps_created, opportunities_created, accounts_researched, contacts_prepped", true),
      p("value", "number", "The number to add or set", true),
      p("mode", "string", "Whether to add to or replace the current value", false, ["add", "set"]),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "get_daily_metrics",
    description: "Get the user's daily activity metrics for today including calls, connects, emails, meetings set, and more",
    parameters: [],
    expects_response: true,
  },
  {
    type: "client",
    name: "add_contact",
    description: "Add a new contact to the CRM",
    parameters: [
      p("name", "string", "Full name of the contact", true),
      p("accountName", "string", "Account the contact belongs to", false),
      p("title", "string", "Job title", false),
      p("email", "string", "Email address", false),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "lookup_contact",
    description: "Look up contacts at a specific account",
    parameters: [
      p("accountName", "string", "The account name to look up contacts for", true),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "create_opportunity",
    description: "Create a new opportunity/deal in the pipeline",
    parameters: [
      p("name", "string", "Opportunity name", true),
      p("accountName", "string", "Account name", true),
      p("arr", "number", "Annual recurring revenue amount", false),
      p("stage", "string", "Deal stage, e.g. 1, 2, 3, discovery, negotiation", false),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "lookup_renewal",
    description: "Look up upcoming renewals, optionally filtered to a time range",
    parameters: [
      p("timeRange", "string", "Time range like this quarter, next 30 days, this month. Defaults to this quarter.", false),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "update_renewal",
    description: "Update a renewal record's health status or risk reason",
    parameters: [
      p("accountName", "string", "The account name for the renewal", true),
      p("health", "string", "Renewal health status", false, ["green", "yellow", "red"]),
      p("riskReason", "string", "Reason for the risk status", false),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "complete_task",
    description: "Mark a task as complete by searching for it by name",
    parameters: [
      p("taskName", "string", "The task title or partial match to find and complete", true),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "list_tasks",
    description: "List the user's tasks for today or upcoming tasks",
    parameters: [
      p("filter", "string", "Filter tasks", false, ["today", "overdue", "upcoming", "all"]),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "get_calendar",
    description: "Get the user's calendar events for today or tomorrow",
    parameters: [
      p("day", "string", "Which day to check", false, ["today", "tomorrow"]),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "quota_status",
    description: "Get the user's current quota attainment, showing closed won vs target with percentage",
    parameters: [],
    expects_response: true,
  },
  {
    type: "client",
    name: "log_reflection",
    description: "Log a daily reflection including what worked, blockers, and lessons learned",
    parameters: [
      p("whatWorked", "string", "What went well today", false),
      p("blocker", "string", "Main blocker or challenge", false),
      p("lesson", "string", "Key lesson or takeaway", false),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "check_in",
    description: "Check the user in for today, marking their daily check-in as complete",
    parameters: [],
    expects_response: true,
  },
  {
    type: "client",
    name: "lookup_transcript",
    description: "Look up the most recent call transcript for an account",
    parameters: [
      p("accountName", "string", "The account name to find transcripts for", true),
    ],
    expects_response: true,
  },
  {
    type: "client",
    name: "start_power_hour",
    description: "Start a power hour focused calling session",
    parameters: [],
    expects_response: true,
  },
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
    // Step 1: Fetch current agent config to preserve non-client tools
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
    // Keep any non-client tools (webhook, mcp, system, etc.)
    const nonClientTools = existingTools.filter((t: any) => t.type !== "client");
    const mergedTools = [...nonClientTools, ...DAVE_TOOLS];

    // Step 2: PATCH the agent with all tools
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
        JSON.stringify({ error: `Failed to patch agent: ${patchRes.status}`, details: errText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const patchData = await patchRes.json();
    const registeredTools = patchData?.conversation_config?.agent?.prompt?.tools || [];
    const clientToolCount = registeredTools.filter((t: any) => t.type === "client").length;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully registered ${clientToolCount} client tools on agent`,
        toolNames: DAVE_TOOLS.map((t) => t.name),
        totalToolsOnAgent: registeredTools.length,
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
