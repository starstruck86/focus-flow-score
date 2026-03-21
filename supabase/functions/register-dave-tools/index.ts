import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
function arr(desc: string, itemType: any) {
  return { type: "array", description: desc, items: { ...itemType, description: itemType.description || "Item" } };
}

// ═══════════════════════════════════════════════════════════════
// ALL 67 TOOLS — Parameter schemas EXACTLY match clientTools.ts
// ═══════════════════════════════════════════════════════════════

const DAVE_TOOLS: ToolDef[] = [
  // ── Navigation ───────────────────────────────────────────────
  { name: "navigate", description: "Navigate to a page in the app", parameters: { path: str("The route path, e.g. /dashboard, /quota, /coach, /trends, /settings, /renewals, /outreach, /prep, /tasks") }, required: ["path"] },

  // ── Task Management ──────────────────────────────────────────
  { name: "create_task", description: "Create a new task for the user", parameters: { title: str("The task title"), priority: str("Priority level", ["P1", "P2", "P3"]), accountName: str("Account name to link the task to"), dueDate: str("Due date — YYYY-MM-DD, or 'today', 'tomorrow', or a weekday name"), dueTime: str("Time of day like '3pm' or '14:00' for a reminder") }, required: ["title"] },
  { name: "complete_task", description: "Mark a task as complete by searching for it by name", parameters: { taskTitle: str("The task title or partial match to find and complete") }, required: ["taskTitle"] },
  { name: "list_tasks", description: "List the user's tasks for today or upcoming tasks", parameters: { filter: str("Filter tasks", ["today", "overdue", "upcoming", "all"]) } },

  // ── Account CRUD ─────────────────────────────────────────────
  { name: "create_account", description: "Create a new account in the CRM", parameters: { name: str("Account/company name"), tier: str("Account tier", ["A", "B", "C", "D"]), motion: str("Sales motion", ["new-logo", "expansion", "renewal"]), industry: str("Industry vertical"), website: str("Company website URL") }, required: ["name"] },
  { name: "update_account", description: "Update a field on an account record", parameters: { accountName: str("The account name to update"), field: str("The field to update, e.g. status, tier, priority, motion, notes, next_step, industry, outreach"), value: str("The new value for the field") }, required: ["accountName", "field", "value"] },
  { name: "lookup_account", description: "Look up details about an account including contacts, opportunities, and recent activity", parameters: { accountName: str("The account name to look up") }, required: ["accountName"] },
  { name: "enrich_account", description: "Trigger AI enrichment for an account — analyzes website, detects tech stack, scores ICP fit", parameters: { accountName: str("The account name to enrich") }, required: ["accountName"] },

  // ── Opportunity Management ───────────────────────────────────
  { name: "create_opportunity", description: "Create a new opportunity/deal in the pipeline", parameters: { name: str("Opportunity name"), accountName: str("Account name"), arr: num("Annual recurring revenue amount"), stage: str("Deal stage"), dealType: str("Deal type", ["new-logo", "expansion", "renewal"]) }, required: ["name"] },
  { name: "update_opportunity", description: "Update a field on an opportunity record", parameters: { opportunityName: str("The opportunity name"), field: str("The field to update, e.g. stage, arr, close_date, next_step, status, notes"), value: str("The new value") }, required: ["opportunityName", "field", "value"] },
  { name: "move_deal", description: "Move an opportunity to a new stage", parameters: { opportunityName: str("The opportunity name"), newStage: str("The new stage") }, required: ["opportunityName", "newStage"] },
  { name: "update_methodology", description: "Update a MEDDICC methodology field on an opportunity", parameters: { opportunityName: str("The opportunity name"), field: str("MEDDICC field", ["metrics", "economic_buyer", "decision_criteria", "decision_process", "identify_pain", "champion", "competition"]), confirmed: { type: "boolean", description: "Whether this field is confirmed" }, notes: str("Notes or evidence for this field") }, required: ["opportunityName", "field"] },

  // ── Contact Management ───────────────────────────────────────
  { name: "add_contact", description: "Add a new contact to the CRM", parameters: { name: str("Full name of the contact"), accountName: str("Account the contact belongs to"), title: str("Job title"), email: str("Email address"), department: str("Department") }, required: ["name"] },
  { name: "lookup_contact", description: "Look up contacts at a specific account", parameters: { accountName: str("The account name to look up contacts for") }, required: ["accountName"] },

  // ── Touch Logging ────────────────────────────────────────────
  { name: "log_touch", description: "Log a touch or interaction with an account", parameters: { accountName: str("The account name"), touchType: str("Type of touch", ["call", "email", "meeting", "linkedin", "other"]), notes: str("Notes about the interaction") }, required: ["accountName", "touchType"] },
  { name: "add_note", description: "Add a note to an account", parameters: { accountName: str("The account name"), note: str("The note content") }, required: ["accountName", "note"] },

  // ── Daily Metrics ────────────────────────────────────────────
  { name: "update_daily_metrics", description: "Update the user's daily activity metrics. Use mode 'add' to increment or 'set' to replace the value.", parameters: { metric: str("The metric: dials, connects, emails, meetings, prospects, customer meetings, opps created, accounts researched, contacts prepped"), value: num("The number to add or set"), mode: str("Whether to add to or replace the current value", ["add", "set"]) }, required: ["metric", "value"] },
  { name: "get_daily_metrics", description: "Get the user's daily activity metrics for today", parameters: {} },

  // ── Scenario & Pipeline ──────────────────────────────────────
  { name: "scenario_calc", description: "Run a what-if scenario calculation — pass deal names to simulate closing them", parameters: { dealNames: arr("Array of deal/opportunity names to simulate closing", { type: "string" }) }, required: ["dealNames"] },
  { name: "pipeline_pulse", description: "Get a quick summary of the current pipeline health and key metrics", parameters: {} },

  // ── Calendar ─────────────────────────────────────────────────
  { name: "get_calendar", description: "Get the user's calendar events for today or tomorrow", parameters: { day: str("Which day to check", ["today", "tomorrow"]) } },

  // ── Quota & Commission ───────────────────────────────────────
  { name: "quota_status", description: "Get the user's current quota attainment showing closed won vs target with percentage", parameters: {} },
  { name: "commission_detail", description: "Get detailed commission pacing including attainment breakdown, gap to quota, and accelerator status", parameters: {} },

  // ── Debrief & Reflection ─────────────────────────────────────
  { name: "debrief", description: "Log a meeting debrief with key takeaways (simple version, no auto-tasks)", parameters: { accountName: str("The account the meeting was about"), keyTakeaways: str("Key takeaways from the meeting"), nextSteps: str("Agreed next steps") }, required: ["accountName"] },
  { name: "smart_debrief", description: "Log a meeting debrief AND auto-create follow-up tasks from next steps. Use this instead of debrief when the user mentions action items.", parameters: { accountName: str("The account the meeting was about"), summary: str("Summary of what happened"), nextSteps: str("Next steps — each step separated by commas will become a task"), sentiment: str("How the meeting went", ["positive", "neutral", "negative"]) }, required: ["accountName", "summary"] },
  { name: "log_reflection", description: "Log a daily reflection including what worked, blockers, and tomorrow's priority", parameters: { whatWorked: str("What went well today"), blocker: str("Main blocker or challenge"), tomorrowPriority: str("Top priority for tomorrow"), reflection: str("General reflection or thoughts") } },

  // ── Journal & Check-in ───────────────────────────────────────
  { name: "check_in", description: "Check the user in for today, marking their daily check-in as complete", parameters: {} },
  { name: "daily_briefing", description: "Get today's daily briefing including meetings, tasks, and priorities", parameters: {} },

  // ── Email & Reminders ────────────────────────────────────────
  { name: "draft_email", description: "Draft a follow-up or outreach email and copy to clipboard", parameters: { to: str("Recipient name or email"), subject: str("Email subject line"), body: str("Email body content") }, required: ["to", "subject", "body"] },
  { name: "set_reminder", description: "Set a reminder for a number of minutes from now", parameters: { message: str("What to be reminded about"), minutes_from_now: num("Minutes from now to trigger the reminder") }, required: ["message", "minutes_from_now"] },

  // ── Copilot ──────────────────────────────────────────────────
  { name: "open_copilot", description: "Open the AI copilot with a specific question or request", parameters: { question: str("The question or request to send to the copilot"), mode: str("Copilot mode", ["quick", "meeting", "research"]) }, required: ["question"] },
  { name: "prep_meeting", description: "Generate a meeting prep brief for an upcoming meeting", parameters: { accountName: str("The account the meeting is with"), meetingTitle: str("Title or type of the meeting") } },

  // ── Renewal Intelligence ─────────────────────────────────────
  { name: "lookup_renewal", description: "Look up upcoming renewals optionally filtered by timeframe", parameters: { timeframe: str("Time range like 'this quarter', 'next 30 days', 'this month'") } },
  { name: "update_renewal", description: "Update a renewal record's field (health, risk, stage, next step, notes)", parameters: { accountName: str("The account name for the renewal"), field: str("Field to update", ["health", "risk", "risk reason", "stage", "next step", "notes"]), value: str("The new value") }, required: ["accountName", "field", "value"] },

  // ── Transcript Lookup ────────────────────────────────────────
  { name: "lookup_transcript", description: "Look up recent call transcripts for an account", parameters: { accountName: str("The account name to find transcripts for") }, required: ["accountName"] },

  // ── Coaching ─────────────────────────────────────────────────
  { name: "start_roleplay", description: "Start a mock call roleplay simulation for practice", parameters: { call_type: str("The type of call to practice"), difficulty: num("Difficulty level 1-5"), industry: str("Industry context") } },
  { name: "start_drill", description: "Start an objection handling drill session", parameters: {} },
  { name: "grade_call", description: "Grade the latest call transcript for coaching feedback", parameters: {} },
  { name: "log_activity", description: "Open the quick activity log", parameters: {} },

  // ── Power Hour & Focus ───────────────────────────────────────
  { name: "start_power_hour", description: "Start a power hour focused calling session", parameters: {} },
  { name: "start_focus_timer", description: "Start a configurable focus timer with type and duration", parameters: { duration_minutes: num("Duration in minutes (default 25)"), focus_type: str("Type of focus block", ["prospecting", "research", "admin", "deep-work", "follow-ups"]), accountName: str("Account to focus on") } },

  // ── Search & Intel ───────────────────────────────────────────
  { name: "search_crm", description: "Search across accounts, deals, contacts, and transcripts", parameters: { query: str("Search query — matches names, notes, content across all entities") }, required: ["query"] },
  { name: "stakeholder_query", description: "Query stakeholders and org chart at an account, optionally filtered by role", parameters: { accountName: str("The account name"), role: str("Filter by buyer role or title keyword like 'VP', 'champion', 'economic buyer'") }, required: ["accountName"] },
  { name: "search_resources", description: "Search the prep hub for resources, templates, and training materials", parameters: { query: str("Search query for resource title or content") }, required: ["query"] },

  // ── Strategy & Analytics ─────────────────────────────────────
  { name: "weekly_battle_plan", description: "Get or generate this week's battle plan with prioritized moves", parameters: {} },
  { name: "weekly_review", description: "Run a weekly review analyzing patterns and performance", parameters: {} },
  { name: "account_prioritize", description: "AI-rank accounts by priority with reasoning", parameters: {} },
  { name: "territory_analysis", description: "Analyze territory balance — coverage, stale accounts, tier distribution", parameters: {} },
  { name: "trend_query", description: "Query activity trends for a specific metric over time", parameters: { metric: str("The metric to trend: dials, connects, meetings, emails, prospects, customer meetings, opps, accounts researched, score"), period: str("Time period", ["week", "month", "quarter"]) }, required: ["metric"] },
  { name: "pipeline_hygiene", description: "Run pipeline hygiene scan — finds stale deals, missing close dates, MEDDICC gaps", parameters: {} },

  // ── Bulk Operations ──────────────────────────────────────────
  { name: "bulk_update", description: "Update a field across multiple records matching a filter", parameters: { entity: str("Entity type", ["accounts", "opportunities", "tasks"]), filter_field: str("Field to filter by, e.g. tier, status, name"), filter_value: str("Value to match"), update_field: str("Field to update"), update_value: str("New value to set") }, required: ["entity", "filter_field", "filter_value", "update_field", "update_value"] },

  // ── Recurring Tasks ──────────────────────────────────────────
  { name: "create_recurring_task", description: "Create a recurring task with a schedule", parameters: { title: str("Task title"), recurrence: str("Recurrence rule like 'every Monday', 'daily', 'weekly', 'biweekly'"), accountName: str("Account to link to"), priority: str("Priority", ["P1", "P2", "P3"]) }, required: ["title", "recurrence"] },

  // ── Guided Journal ───────────────────────────────────────────
  { name: "guided_journal", description: "Get a checklist of today's journal fields — shows what's completed vs missing. Use this to walk the user through their daily journal step by step.", parameters: {} },
  { name: "update_journal_field", description: "Update a qualitative or wellness field in the daily journal (what_worked_today, biggest_blocker, tomorrow_priority, daily_reflection, energy, focus_quality, stress, personal_development, clarity, what_drained_you)", parameters: { field: str("The journal field to update", ["what_worked_today", "biggest_blocker", "tomorrow_priority", "daily_reflection", "energy", "focus_quality", "stress", "personal_development", "clarity", "what_drained_you"]), value: str("The value to set — text for reflections, number 1-5 for wellness, yes/no for booleans") }, required: ["field", "value"] },

  // ── Task Reminders ───────────────────────────────────────────
  { name: "set_task_reminder", description: "Set a reminder on an existing task so the user gets notified at a specific time", parameters: { taskTitle: str("The task title or partial match to find"), reminderTime: str("When to remind — 'in 30 minutes', '3pm', or ISO datetime") }, required: ["taskTitle", "reminderTime"] },

  // ═══════════════════════════════════════════════════════════════
  // SYNTHESIS TOOLS — Cross-entity intelligence layer
  // ═══════════════════════════════════════════════════════════════
  { name: "add_opportunity_note", description: "Add a note to an opportunity/deal record (not an account)", parameters: { opportunityName: str("The opportunity name"), note: str("The note content to add") }, required: ["opportunityName", "note"] },
  { name: "read_resource", description: "Read the content of a resource from the prep hub library by title match. Returns up to 3000 chars.", parameters: { title: str("The resource title or partial match") }, required: ["title"] },
  { name: "methodology_gaps", description: "Analyze MEDDICC gaps across ALL active deals. Returns ranked list of unconfirmed elements weighted by ARR and close date urgency.", parameters: {} },
  { name: "next_action", description: "Synthesize the single highest-impact thing the user should do right now, considering overdue tasks, upcoming meetings, stale deals, methodology gaps, and journal status.", parameters: {} },
  { name: "contact_timeline", description: "Get engagement history for a specific contact — cross-references call transcripts, calendar events, and touch dates to show when and how you last engaged.", parameters: { contactName: str("The contact's name to look up") }, required: ["contactName"] },
  { name: "save_commitment", description: "Save a verbal commitment or promise made during conversation. Creates a task and optionally appends to account notes.", parameters: { commitment: str("What was committed to"), accountName: str("Account to link this commitment to"), dueDate: str("When this is due — YYYY-MM-DD, today, tomorrow, or weekday name") }, required: ["commitment"] },

  // ═══════════════════════════════════════════════════════════════
  // PHASE 4: Advanced Synthesis & Workflow Tools
  // ═══════════════════════════════════════════════════════════════
  { name: "generate_content", description: "Generate AI content (email, business case, ROI analysis, etc.) using full deal context — transcripts, MEDDICC, contacts. Copies result to clipboard.", parameters: { contentType: str("Type of content to generate", ["email", "business_case", "roi", "follow_up", "qbr_prep", "proposal", "executive_summary"]), accountName: str("Account name for context"), opportunityName: str("Opportunity name for deal context"), contactName: str("Contact name to personalize to"), customInstructions: str("Additional instructions or specifics for the content") }, required: ["contentType"] },
  { name: "open_content_builder", description: "Open the Prep Hub content builder with pre-filled context for complex content creation that needs user refinement.", parameters: { accountName: str("Account name to pre-fill"), opportunityName: str("Opportunity to pre-fill"), contentType: str("Content type to pre-select"), customInstructions: str("Instructions to pre-fill") } },
  { name: "assess_deal_risk", description: "Deep AI risk assessment on one deal or across the full portfolio. Analyzes staleness, MEDDICC gaps, close date proximity, and activity cadence.", parameters: { opportunityName: str("Specific deal to assess — omit for portfolio-wide analysis") } },
  { name: "competitive_intel", description: "Search across all transcripts, account notes, and deal notes for mentions of a competitor or topic. Shows where and when it came up.", parameters: { query: str("Competitor name or topic to search for") }, required: ["query"] },
  { name: "create_methodology_tasks", description: "Convert unconfirmed MEDDICC gaps on a deal into specific, actionable tasks with talk tracks and due dates based on close date.", parameters: { opportunityName: str("The opportunity to create MEDDICC tasks for") }, required: ["opportunityName"] },
  { name: "meeting_brief", description: "Get a concise inline prep brief for an upcoming meeting. Auto-matches calendar title to account and pulls deal context, MEDDICC gaps, contacts, and last call summary.", parameters: { meetingTitle: str("Meeting title to match — omit for the next upcoming meeting") } },

  // ── WHOOP & Resource Intelligence ────────────────────────────
  { name: "get_whoop_status", description: "Get the user's WHOOP biometric data — recovery, sleep, and strain scores with coaching context", parameters: {} },
  { name: "sync_whoop", description: "Trigger a manual WHOOP data sync to fetch the latest biometric data", parameters: {} },
  { name: "read_resource_digest", description: "Read the operationalized intelligence digest of a resource — takeaways, use cases, grading criteria. Use when the user asks about a framework, playbook, or training material's key points.", parameters: { title: str("The resource title or partial match to find") }, required: ["title"] },
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
    // ── Step 0: Delete existing tools from agent ──────────────
    const agentRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
      headers: { "xi-api-key": apiKey },
    });
    const agentData = await agentRes.json();
    const existingToolIds: string[] = agentData?.conversation_config?.agent?.prompt?.tool_ids || [];

    const deleteResults: { id: string; ok: boolean }[] = [];
    for (const toolId of existingToolIds) {
      const delRes = await fetch(`https://api.elevenlabs.io/v1/convai/tools/${toolId}`, {
        method: "DELETE",
        headers: { "xi-api-key": apiKey },
      });
      deleteResults.push({ id: toolId, ok: delRes.ok || delRes.status === 404 });
    }

    // ── Step 1: Create each tool ─────────────────────────────
    const results: { name: string; toolId?: string; error?: string }[] = [];
    const toolIds: string[] = [];

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

      if (res.ok && data?.id) {
        toolIds.push(data.id);
        results.push({ name: t.name, toolId: data.id });
      } else {
        results.push({ name: t.name, error: JSON.stringify(data) });
      }
    }

    // ── Step 2: PATCH agent with new tool_ids ────────────────
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

    return new Response(
      JSON.stringify({
        success: successCount > 0,
        message: `Deleted ${deleteResults.length} old tools, created ${successCount}/${DAVE_TOOLS.length} new tools, linked to agent`,
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
