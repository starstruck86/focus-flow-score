import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * All 36 Dave client tools in ElevenLabs format.
 * Each tool: { type: "client", name, description, parameters (JSON schema), expects_response }
 */
const DAVE_TOOLS = [
  // 1. navigate
  {
    type: "client" as const,
    name: "navigate",
    description: "Navigate to a page in the app",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The route path, e.g. /dashboard, /quota, /coach, /trends, /settings, /renewals, /outreach, /prep, /tasks",
        },
      },
      required: ["path"],
    },
    expects_response: true,
  },
  // 2. create_task
  {
    type: "client" as const,
    name: "create_task",
    description: "Create a new task for the user",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "The task title" },
        dueDate: { type: "string", description: "Due date in YYYY-MM-DD format" },
        priority: { type: "string", description: "Priority level", enum: ["high", "medium", "low"] },
        linkedAccount: { type: "string", description: "Account name to link the task to" },
      },
      required: ["title"],
    },
    expects_response: true,
  },
  // 3. update_account
  {
    type: "client" as const,
    name: "update_account",
    description: "Update a field on an account record",
    parameters: {
      type: "object",
      properties: {
        accountName: { type: "string", description: "The account name to update" },
        field: { type: "string", description: "The field to update, e.g. status, tier, owner, industry, next_step" },
        value: { type: "string", description: "The new value for the field" },
      },
      required: ["accountName", "field", "value"],
    },
    expects_response: true,
  },
  // 4. update_opportunity
  {
    type: "client" as const,
    name: "update_opportunity",
    description: "Update a field on an opportunity record",
    parameters: {
      type: "object",
      properties: {
        opportunityName: { type: "string", description: "The opportunity name" },
        field: { type: "string", description: "The field to update, e.g. stage, arr, close_date, next_step, status" },
        value: { type: "string", description: "The new value" },
      },
      required: ["opportunityName", "field", "value"],
    },
    expects_response: true,
  },
  // 5. update_methodology
  {
    type: "client" as const,
    name: "update_methodology",
    description: "Update a MEDDICC methodology field on an opportunity",
    parameters: {
      type: "object",
      properties: {
        opportunityName: { type: "string", description: "The opportunity name" },
        field: { type: "string", description: "MEDDICC field", enum: ["metrics", "economic_buyer", "decision_criteria", "decision_process", "identify_pain", "champion", "competition"] },
        value: { type: "string", description: "The updated value or notes" },
      },
      required: ["opportunityName", "field", "value"],
    },
    expects_response: true,
  },
  // 6. log_touch
  {
    type: "client" as const,
    name: "log_touch",
    description: "Log a touch or interaction with an account",
    parameters: {
      type: "object",
      properties: {
        accountName: { type: "string", description: "The account name" },
        touchType: { type: "string", description: "Type of touch", enum: ["call", "email", "meeting", "linkedin", "other"] },
        notes: { type: "string", description: "Notes about the interaction" },
      },
      required: ["accountName", "touchType"],
    },
    expects_response: true,
  },
  // 7. move_deal
  {
    type: "client" as const,
    name: "move_deal",
    description: "Move an opportunity to a new stage",
    parameters: {
      type: "object",
      properties: {
        opportunityName: { type: "string", description: "The opportunity name to move" },
        newStage: { type: "string", description: "The new stage number or name, e.g. 1, 2, 3, 4, 5, Closed Won, Closed Lost" },
      },
      required: ["opportunityName", "newStage"],
    },
    expects_response: true,
  },
  // 8. add_note
  {
    type: "client" as const,
    name: "add_note",
    description: "Add a note to an account or opportunity",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "The account or opportunity name" },
        note: { type: "string", description: "The note content" },
      },
      required: ["target", "note"],
    },
    expects_response: true,
  },
  // 9. lookup_account
  {
    type: "client" as const,
    name: "lookup_account",
    description: "Look up details about an account including contacts, opportunities, and recent activity",
    parameters: {
      type: "object",
      properties: {
        accountName: { type: "string", description: "The account name to look up" },
      },
      required: ["accountName"],
    },
    expects_response: true,
  },
  // 10. scenario_calc
  {
    type: "client" as const,
    name: "scenario_calc",
    description: "Run a what-if scenario calculation for quota attainment",
    parameters: {
      type: "object",
      properties: {
        arr: { type: "number", description: "The ARR amount to simulate" },
        description: { type: "string", description: "Description of the scenario" },
      },
      required: ["arr"],
    },
    expects_response: true,
  },
  // 11. pipeline_pulse
  {
    type: "client" as const,
    name: "pipeline_pulse",
    description: "Get a quick summary of the current pipeline health and key metrics",
    parameters: { type: "object", properties: {} },
    expects_response: true,
  },
  // 12. daily_briefing
  {
    type: "client" as const,
    name: "daily_briefing",
    description: "Get today's daily briefing including meetings, tasks, and priorities",
    parameters: { type: "object", properties: {} },
    expects_response: true,
  },
  // 13. debrief
  {
    type: "client" as const,
    name: "debrief",
    description: "Log a meeting or call debrief with key takeaways",
    parameters: {
      type: "object",
      properties: {
        accountName: { type: "string", description: "The account the meeting was about" },
        summary: { type: "string", description: "Summary of what happened" },
        nextSteps: { type: "string", description: "Agreed next steps" },
        sentiment: { type: "string", description: "How the meeting went", enum: ["positive", "neutral", "negative"] },
      },
      required: ["accountName", "summary"],
    },
    expects_response: true,
  },
  // 14. draft_email
  {
    type: "client" as const,
    name: "draft_email",
    description: "Draft a follow-up or outreach email",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient name or email" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body content" },
      },
      required: ["to", "subject", "body"],
    },
    expects_response: true,
  },
  // 15. set_reminder
  {
    type: "client" as const,
    name: "set_reminder",
    description: "Set a reminder for a future date and time",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "What to be reminded about" },
        dateTime: { type: "string", description: "When to remind, in YYYY-MM-DD or natural language like 'tomorrow at 3pm'" },
      },
      required: ["text", "dateTime"],
    },
    expects_response: true,
  },
  // 16. open_copilot
  {
    type: "client" as const,
    name: "open_copilot",
    description: "Open the AI copilot with a specific question or request",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The question or request to send to the copilot" },
      },
      required: ["query"],
    },
    expects_response: true,
  },
  // 17. prep_meeting
  {
    type: "client" as const,
    name: "prep_meeting",
    description: "Generate a meeting prep brief for an upcoming meeting",
    parameters: {
      type: "object",
      properties: {
        accountName: { type: "string", description: "The account the meeting is with" },
        meetingType: { type: "string", description: "Type of meeting", enum: ["discovery", "demo", "negotiation", "review", "check-in"] },
      },
      required: ["accountName"],
    },
    expects_response: true,
  },
  // 18. start_roleplay
  {
    type: "client" as const,
    name: "start_roleplay",
    description: "Start a mock call roleplay simulation for practice",
    parameters: {
      type: "object",
      properties: {
        scenario: { type: "string", description: "The scenario to practice, e.g. cold call, discovery, objection handling" },
        accountName: { type: "string", description: "Account to use as context" },
      },
    },
    expects_response: true,
  },
  // 19. start_drill
  {
    type: "client" as const,
    name: "start_drill",
    description: "Start an objection handling drill session",
    parameters: {
      type: "object",
      properties: {
        objectionType: { type: "string", description: "Type of objection to drill", enum: ["price", "timing", "competitor", "status_quo"] },
      },
    },
    expects_response: true,
  },
  // 20. grade_call
  {
    type: "client" as const,
    name: "grade_call",
    description: "Grade a call transcript for coaching feedback",
    parameters: {
      type: "object",
      properties: {
        accountName: { type: "string", description: "The account the call was with" },
      },
    },
    expects_response: true,
  },
  // 21. log_activity
  {
    type: "client" as const,
    name: "log_activity",
    description: "Log a sales activity",
    parameters: {
      type: "object",
      properties: {
        activityType: { type: "string", description: "Type of activity", enum: ["call", "email", "meeting", "linkedin", "research"] },
        accountName: { type: "string", description: "Account name if applicable" },
        notes: { type: "string", description: "Notes about the activity" },
      },
      required: ["activityType"],
    },
    expects_response: true,
  },
  // 22. update_daily_metrics
  {
    type: "client" as const,
    name: "update_daily_metrics",
    description: "Update the user's daily activity metrics like calls, connects, emails, meetings set. Use mode 'add' to increment or 'set' to replace the value.",
    parameters: {
      type: "object",
      properties: {
        metric: { type: "string", description: "The metric to update: calls, dials, connects, conversations, emails, manual_emails, meetings, meetings_set, prospects, prospects_added, customer_meetings, opps_created, opportunities_created, accounts_researched, contacts_prepped" },
        value: { type: "number", description: "The number to add or set" },
        mode: { type: "string", description: "Whether to add to or replace the current value", enum: ["add", "set"] },
      },
      required: ["metric", "value"],
    },
    expects_response: true,
  },
  // 23. get_daily_metrics
  {
    type: "client" as const,
    name: "get_daily_metrics",
    description: "Get the user's daily activity metrics for today including calls, connects, emails, meetings set, and more",
    parameters: { type: "object", properties: {} },
    expects_response: true,
  },
  // 24. add_contact
  {
    type: "client" as const,
    name: "add_contact",
    description: "Add a new contact to the CRM",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Full name of the contact" },
        accountName: { type: "string", description: "Account the contact belongs to" },
        title: { type: "string", description: "Job title" },
        email: { type: "string", description: "Email address" },
      },
      required: ["name"],
    },
    expects_response: true,
  },
  // 25. lookup_contact
  {
    type: "client" as const,
    name: "lookup_contact",
    description: "Look up contacts at a specific account",
    parameters: {
      type: "object",
      properties: {
        accountName: { type: "string", description: "The account name to look up contacts for" },
      },
      required: ["accountName"],
    },
    expects_response: true,
  },
  // 26. create_opportunity
  {
    type: "client" as const,
    name: "create_opportunity",
    description: "Create a new opportunity/deal in the pipeline",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Opportunity name" },
        accountName: { type: "string", description: "Account name" },
        arr: { type: "number", description: "Annual recurring revenue amount" },
        stage: { type: "string", description: "Deal stage, e.g. 1, 2, 3, discovery, negotiation" },
      },
      required: ["name", "accountName"],
    },
    expects_response: true,
  },
  // 27. lookup_renewal
  {
    type: "client" as const,
    name: "lookup_renewal",
    description: "Look up upcoming renewals, optionally filtered to a time range",
    parameters: {
      type: "object",
      properties: {
        timeRange: { type: "string", description: "Time range like 'this quarter', 'next 30 days', 'this month'. Defaults to this quarter." },
      },
    },
    expects_response: true,
  },
  // 28. update_renewal
  {
    type: "client" as const,
    name: "update_renewal",
    description: "Update a renewal record's health status or risk reason",
    parameters: {
      type: "object",
      properties: {
        accountName: { type: "string", description: "The account name for the renewal" },
        health: { type: "string", description: "Renewal health status", enum: ["green", "yellow", "red"] },
        riskReason: { type: "string", description: "Reason for the risk status" },
      },
      required: ["accountName"],
    },
    expects_response: true,
  },
  // 29. complete_task
  {
    type: "client" as const,
    name: "complete_task",
    description: "Mark a task as complete by searching for it by name",
    parameters: {
      type: "object",
      properties: {
        taskName: { type: "string", description: "The task title or partial match to find and complete" },
      },
      required: ["taskName"],
    },
    expects_response: true,
  },
  // 30. list_tasks
  {
    type: "client" as const,
    name: "list_tasks",
    description: "List the user's tasks for today or upcoming tasks",
    parameters: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Filter tasks", enum: ["today", "overdue", "upcoming", "all"] },
      },
    },
    expects_response: true,
  },
  // 31. get_calendar
  {
    type: "client" as const,
    name: "get_calendar",
    description: "Get the user's calendar events for today or tomorrow",
    parameters: {
      type: "object",
      properties: {
        day: { type: "string", description: "Which day to check", enum: ["today", "tomorrow"] },
      },
    },
    expects_response: true,
  },
  // 32. quota_status
  {
    type: "client" as const,
    name: "quota_status",
    description: "Get the user's current quota attainment, showing closed won vs target with percentage",
    parameters: { type: "object", properties: {} },
    expects_response: true,
  },
  // 33. log_reflection
  {
    type: "client" as const,
    name: "log_reflection",
    description: "Log a daily reflection including what worked, blockers, and lessons learned",
    parameters: {
      type: "object",
      properties: {
        whatWorked: { type: "string", description: "What went well today" },
        blocker: { type: "string", description: "Main blocker or challenge" },
        lesson: { type: "string", description: "Key lesson or takeaway" },
      },
    },
    expects_response: true,
  },
  // 34. check_in
  {
    type: "client" as const,
    name: "check_in",
    description: "Check the user in for today, marking their daily check-in as complete",
    parameters: { type: "object", properties: {} },
    expects_response: true,
  },
  // 35. lookup_transcript
  {
    type: "client" as const,
    name: "lookup_transcript",
    description: "Look up the most recent call transcript for an account",
    parameters: {
      type: "object",
      properties: {
        accountName: { type: "string", description: "The account name to find transcripts for" },
      },
      required: ["accountName"],
    },
    expects_response: true,
  },
  // 36. start_power_hour
  {
    type: "client" as const,
    name: "start_power_hour",
    description: "Start a power hour focused calling session",
    parameters: { type: "object", properties: {} },
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
    // Step 1: Fetch current agent config
    const getRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
      headers: { "xi-api-key": apiKey },
    });

    if (!getRes.ok) {
      const errText = await getRes.text();
      return new Response(
        JSON.stringify({ error: `Failed to fetch agent config: ${getRes.status}`, details: errText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const agentConfig = await getRes.json();

    // Step 2: Merge tools — replace existing client tools with our set
    const existingTools = agentConfig?.conversation_config?.agent?.prompt?.tools || [];
    // Keep any non-client tools (e.g. server tools, webhooks)
    const nonClientTools = existingTools.filter((t: any) => t.type !== "client");
    const mergedTools = [...nonClientTools, ...DAVE_TOOLS];

    // Step 3: PATCH the agent
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
        message: `Successfully registered ${clientToolCount} client tools on agent ${agentId}`,
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
