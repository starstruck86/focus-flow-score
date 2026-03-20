import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ToolDef {
  name: string;
  description: string;
  parameters?: Record<string, any>;
  required?: string[];
}

function str(desc: string, enumVals?: string[]) {
  const s: any = { type: "string", description: desc };
  if (enumVals) s.enum = enumVals;
  return s;
}
function num(desc: string) {
  return { type: "number", description: desc };
}

const DAVE_TOOLS: ToolDef[] = [
  { name: "navigate", description: "Navigate to a page in the app", parameters: { path: str("The route path, e.g. /dashboard, /quota, /coach, /trends, /settings, /renewals, /outreach, /prep, /tasks") }, required: ["path"] },
  { name: "create_task", description: "Create a new task for the user", parameters: { title: str("The task title"), dueDate: str("Due date in YYYY-MM-DD format"), priority: str("Priority level", ["high", "medium", "low"]), linkedAccount: str("Account name to link the task to") }, required: ["title"] },
  { name: "update_account", description: "Update a field on an account record", parameters: { accountName: str("The account name to update"), field: str("The field to update, e.g. status, tier, owner, industry, next_step"), value: str("The new value for the field") }, required: ["accountName", "field", "value"] },
  { name: "update_opportunity", description: "Update a field on an opportunity record", parameters: { opportunityName: str("The opportunity name"), field: str("The field to update, e.g. stage, arr, close_date, next_step, status"), value: str("The new value") }, required: ["opportunityName", "field", "value"] },
  { name: "update_methodology", description: "Update a MEDDICC methodology field on an opportunity", parameters: { opportunityName: str("The opportunity name"), field: str("MEDDICC field", ["metrics", "economic_buyer", "decision_criteria", "decision_process", "identify_pain", "champion", "competition"]), value: str("The updated value or notes") }, required: ["opportunityName", "field", "value"] },
  { name: "log_touch", description: "Log a touch or interaction with an account", parameters: { accountName: str("The account name"), touchType: str("Type of touch", ["call", "email", "meeting", "linkedin", "other"]), notes: str("Notes about the interaction") }, required: ["accountName", "touchType"] },
  { name: "move_deal", description: "Move an opportunity to a new stage", parameters: { opportunityName: str("The opportunity name to move"), newStage: str("The new stage number or name, e.g. 1, 2, 3, 4, 5, Closed Won, Closed Lost") }, required: ["opportunityName", "newStage"] },
  { name: "add_note", description: "Add a note to an account or opportunity", parameters: { target: str("The account or opportunity name"), note: str("The note content") }, required: ["target", "note"] },
  { name: "lookup_account", description: "Look up details about an account including contacts, opportunities, and recent activity", parameters: { accountName: str("The account name to look up") }, required: ["accountName"] },
  { name: "scenario_calc", description: "Run a what-if scenario calculation for quota attainment", parameters: { arr: num("The ARR amount to simulate"), description: str("Description of the scenario") }, required: ["arr"] },
  { name: "pipeline_pulse", description: "Get a quick summary of the current pipeline health and key metrics", parameters: {} },
  { name: "daily_briefing", description: "Get today's daily briefing including meetings, tasks, and priorities", parameters: {} },
  { name: "debrief", description: "Log a meeting or call debrief with key takeaways", parameters: { accountName: str("The account the meeting was about"), summary: str("Summary of what happened"), nextSteps: str("Agreed next steps"), sentiment: str("How the meeting went", ["positive", "neutral", "negative"]) }, required: ["accountName", "summary"] },
  { name: "draft_email", description: "Draft a follow-up or outreach email", parameters: { to: str("Recipient name or email"), subject: str("Email subject line"), body: str("Email body content") }, required: ["to", "subject", "body"] },
  { name: "set_reminder", description: "Set a reminder for a future date and time", parameters: { text: str("What to be reminded about"), dateTime: str("When to remind, in YYYY-MM-DD or natural language like tomorrow at 3pm") }, required: ["text", "dateTime"] },
  { name: "open_copilot", description: "Open the AI copilot with a specific question or request", parameters: { query: str("The question or request to send to the copilot") }, required: ["query"] },
  { name: "prep_meeting", description: "Generate a meeting prep brief for an upcoming meeting", parameters: { accountName: str("The account the meeting is with"), meetingType: str("Type of meeting", ["discovery", "demo", "negotiation", "review", "check-in"]) }, required: ["accountName"] },
  { name: "start_roleplay", description: "Start a mock call roleplay simulation for practice", parameters: { scenario: str("The scenario to practice, e.g. cold call, discovery, objection handling"), accountName: str("Account to use as context") } },
  { name: "start_drill", description: "Start an objection handling drill session", parameters: { objectionType: str("Type of objection to drill", ["price", "timing", "competitor", "status_quo"]) } },
  { name: "grade_call", description: "Grade a call transcript for coaching feedback", parameters: { accountName: str("The account the call was with") } },
  { name: "log_activity", description: "Log a sales activity", parameters: { activityType: str("Type of activity", ["call", "email", "meeting", "linkedin", "research"]), accountName: str("Account name if applicable"), notes: str("Notes about the activity") }, required: ["activityType"] },
  { name: "update_daily_metrics", description: "Update the user's daily activity metrics like calls, connects, emails, meetings set. Use mode add to increment or set to replace the value.", parameters: { metric: str("The metric to update: calls, dials, connects, conversations, emails, manual_emails, meetings, meetings_set, prospects, prospects_added, customer_meetings, opps_created, opportunities_created, accounts_researched, contacts_prepped"), value: num("The number to add or set"), mode: str("Whether to add to or replace the current value", ["add", "set"]) }, required: ["metric", "value"] },
  { name: "get_daily_metrics", description: "Get the user's daily activity metrics for today including calls, connects, emails, meetings set, and more", parameters: {} },
  { name: "add_contact", description: "Add a new contact to the CRM", parameters: { name: str("Full name of the contact"), accountName: str("Account the contact belongs to"), title: str("Job title"), email: str("Email address") }, required: ["name"] },
  { name: "lookup_contact", description: "Look up contacts at a specific account", parameters: { accountName: str("The account name to look up contacts for") }, required: ["accountName"] },
  { name: "create_opportunity", description: "Create a new opportunity/deal in the pipeline", parameters: { name: str("Opportunity name"), accountName: str("Account name"), arr: num("Annual recurring revenue amount"), stage: str("Deal stage, e.g. 1, 2, 3, discovery, negotiation") }, required: ["name", "accountName"] },
  { name: "lookup_renewal", description: "Look up upcoming renewals, optionally filtered to a time range", parameters: { timeRange: str("Time range like this quarter, next 30 days, this month. Defaults to this quarter.") } },
  { name: "update_renewal", description: "Update a renewal record's health status or risk reason", parameters: { accountName: str("The account name for the renewal"), health: str("Renewal health status", ["green", "yellow", "red"]), riskReason: str("Reason for the risk status") }, required: ["accountName"] },
  { name: "complete_task", description: "Mark a task as complete by searching for it by name", parameters: { taskName: str("The task title or partial match to find and complete") }, required: ["taskName"] },
  { name: "list_tasks", description: "List the user's tasks for today or upcoming tasks", parameters: { filter: str("Filter tasks", ["today", "overdue", "upcoming", "all"]) } },
  { name: "get_calendar", description: "Get the user's calendar events for today or tomorrow", parameters: { day: str("Which day to check", ["today", "tomorrow"]) } },
  { name: "quota_status", description: "Get the user's current quota attainment, showing closed won vs target with percentage", parameters: {} },
  { name: "log_reflection", description: "Log a daily reflection including what worked, blockers, and lessons learned", parameters: { whatWorked: str("What went well today"), blocker: str("Main blocker or challenge"), lesson: str("Key lesson or takeaway") } },
  { name: "check_in", description: "Check the user in for today, marking their daily check-in as complete", parameters: {} },
  { name: "lookup_transcript", description: "Look up the most recent call transcript for an account", parameters: { accountName: str("The account name to find transcripts for") }, required: ["accountName"] },
  { name: "start_power_hour", description: "Start a power hour focused calling session", parameters: {} },
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
    const results: { name: string; toolId?: string; error?: string }[] = [];
    const toolIds: string[] = [];

    // Step 1: Create each tool via POST /v1/convai/tools
    for (const t of DAVE_TOOLS) {
      const params: any = { type: "object", properties: t.parameters || {} };
      if (t.required && t.required.length > 0) params.required = t.required;

      const body = {
        tool_config: {
          type: "client",
          name: t.name,
          description: t.description,
          parameters: params,
          expects_response: true,
        },
      };

      const res = await fetch("https://api.elevenlabs.io/v1/convai/tools", {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (res.ok && data?.tool_id) {
        toolIds.push(data.tool_id);
        results.push({ name: t.name, toolId: data.tool_id });
      } else {
        results.push({ name: t.name, error: JSON.stringify(data) });
      }
    }

    // Step 2: PATCH agent with collected tool_ids
    let patchResult: any = null;
    if (toolIds.length > 0) {
      const patchBody = {
        conversation_config: {
          agent: {
            prompt: {
              tool_ids: toolIds,
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

      patchResult = await patchRes.json();
      if (!patchRes.ok) {
        patchResult = { error: `PATCH failed: ${patchRes.status}`, details: patchResult };
      }
    }

    const successCount = results.filter(r => r.toolId).length;
    const failCount = results.filter(r => r.error).length;

    return new Response(
      JSON.stringify({
        success: successCount > 0,
        message: `Created ${successCount}/${DAVE_TOOLS.length} tools, linked ${toolIds.length} to agent`,
        failedTools: results.filter(r => r.error),
        patchResult,
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
