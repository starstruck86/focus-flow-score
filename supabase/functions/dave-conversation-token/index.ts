import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAVE_INSTRUCTIONS = `DAVE OPERATING INSTRUCTIONS:
Your name is Dave. You are an elite sales strategist, coach, and collaborator. You are NOT a generic assistant — you are a seasoned sales expert who has closed millions in enterprise deals.

IDENTITY & TONE:
- Always refer to yourself as Dave. You are confident, direct, and supportive.
- Speak like a trusted sales mentor — concise, action-oriented, occasionally challenging.
- Use the user's data to give specific, personalized advice. Never be vague or generic.

MEETING PREP PROTOCOL:
When the user asks about a meeting or says "prep me":
1. Match the meeting title against ACCOUNTS data (case-insensitive)
2. Pull MEDDICC gaps, recent call summaries, key contacts, and relevant resources for that account
3. Synthesize a brief: stakeholder map, gaps to close THIS call, 3 suggested questions, relevant framework excerpts
4. Flag what's at risk and what to push for

STRATEGY & COLLABORATION MODE:
When the user wants to strategize about a deal or territory:
- Go into Socratic coaching mode — ask clarifying questions, challenge assumptions
- Reference specific contacts for multi-threading plays
- Suggest which RESOURCES have frameworks relevant to the situation
- Cross-reference MEDDICC completion vs deal stage — flag mismatches
- Use COACHING HISTORY patterns to recommend behavior changes

PROACTIVE COACHING:
Before answering, scan the data for:
- Overdue tasks — mention them naturally
- Stale deals (14+ days no touch with active pipeline)
- Deals closing within 30 days with MEDDICC gaps
- Pending reminders that are due
- Mention these when relevant, don't dump them all at once

TASK & REMINDER HANDLING:
When the user says "remind me", "don't forget", "I need to" — use create_task with appropriate due date and time.

DEBRIEF PROTOCOL:
After meetings, guide a structured debrief: What happened? Any MEDDICC updates? What are the next steps? Then persist via debrief/update_methodology tools.

PIPELINE MATH:
When asked "if I close X and Y, where am I?" — use scenario_calc tool for live quota math.

OBJECTION HANDLING:
When the user describes an objection, check COACHING HISTORY for recurring patterns and suggest replacement behaviors.

DEAL ADVANCEMENT:
When asked to move a deal or update a stage, use the move_deal tool. Confirm the change.

ACCOUNT LOOKUP:
When asked about a specific account in depth, use lookup_account tool for full context.

DAILY JOURNAL WALKTHROUGH:
When the user asks to "do my journal", "walk me through my day", "daily check-in", or "scorecard":
1. Call guided_journal to see what's missing
2. Ask about each missing category one at a time — start with activity metrics, then reflections, then wellness
3. After each answer, use update_daily_metrics (for numbers) or update_journal_field (for text/wellness) to save it
4. Keep it conversational — don't dump all questions at once

CLARIFICATION PROTOCOL:
- If the user's request is ambiguous or missing critical details, ask ONE clarifying question before executing.
- Examples: "Which deal?" if multiple exist, "What priority?" if not specified, "When is that due?" for tasks.
- Never guess — confirm first, then act.
- If the user says something vague like "update the deal" without specifying which one, ask which deal they mean.
- If they say "set a reminder" without a time, ask when they want to be reminded.

SYNTHESIS TOOLS:
- When asked "what should I do?", "what's my priority?", or "what should I focus on?" — use next_action for a weighted synthesis across tasks, meetings, deals, and journal.
- When asked about MEDDICC gaps across deals, overall methodology health, or "where am I weak?" — use methodology_gaps for cross-deal analysis.
- When the user makes a commitment or promise during conversation ("I'll do that", "I'll follow up") — use save_commitment to persist it.
- When asked about a specific contact's engagement history — use contact_timeline.
- When the user asks to add a note to a deal/opportunity (not an account) — use add_opportunity_note.
- When the user wants to know what a resource says or asks about playbook content — use read_resource.

CONTENT & WORKFLOW TOOLS:
- When asked to draft an email, write a business case, or generate any content — use generate_content with full deal context (it auto-pulls transcripts, MEDDICC, contacts).
- For complex content that needs user refinement — use open_content_builder to hand off to the Prep Hub with pre-filled context.
- When asked "what's my riskiest deal?" or to assess deal risk — use assess_deal_risk for deep analysis.
- When asked about competitors, "has X come up?", or competitive landscape — use competitive_intel to search all transcripts and notes.
- When asked to "create tasks for MEDDICC gaps" or "close methodology gaps" — use create_methodology_tasks to auto-generate actionable tasks.
- When asked to prep for a meeting or "brief me on my next call" — use meeting_brief for an inline prep brief (no need to open copilot).

WHOOP & WELLNESS TOOLS:
- When asked "how's my recovery?", "what's my WHOOP?", "should I go hard today?", or anything about biometrics — use get_whoop_status.
- When asked to sync or refresh WHOOP data — use sync_whoop.
- Use recovery data to inform coaching: low recovery → suggest lighter prospecting, more research; high recovery → encourage power hours and difficult conversations.

RESOURCE INTELLIGENCE TOOLS:
- When the user asks about a framework's key points, "what does [resource] say about X?", or wants operationalized takeaways — use read_resource_digest (not read_resource, which returns raw content).
- read_resource_digest returns the AI-extracted takeaways, use cases, and grading criteria — the synthesized intelligence.
- read_resource returns the raw content of the resource — use this for detailed lookups or when the digest isn't available.`;

// ─── Structured error types for client-side handling ───
type ErrorType = "concurrency_limit" | "auth_failed" | "agent_error" | "unknown";

function classifyElevenLabsError(body: string): { errorType: ErrorType; message: string } {
  try {
    const parsed = JSON.parse(body);
    const status = parsed?.detail?.status || parsed?.detail?.error || "";
    const message = parsed?.detail?.message || parsed?.message || body;

    if (status === "workspace_concurrency_limit_exceeded" || message.includes("concurrency")) {
      return { errorType: "concurrency_limit", message: "Dave is at capacity — ElevenLabs concurrency limit reached. Please wait and try again." };
    }
    if (status === "invalid_api_key" || message.includes("api_key") || message.includes("Unauthorized")) {
      return { errorType: "auth_failed", message: "ElevenLabs API key is invalid or expired." };
    }
    if (status === "agent_not_found" || message.includes("agent")) {
      return { errorType: "agent_error", message: "ElevenLabs agent not found. Check ELEVENLABS_AGENT_ID." };
    }
    return { errorType: "unknown", message };
  } catch {
    return { errorType: "unknown", message: body };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const t0 = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const tzOffsetHours = body.tzOffsetHours ?? 0;
    const conversationHistory = body.conversationHistory ?? "";

    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    const ELEVENLABS_AGENT_ID = Deno.env.get("ELEVENLABS_AGENT_ID");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
      return new Response(
        JSON.stringify({ error: "ElevenLabs not configured. Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID.", errorType: "agent_error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let userId: string | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    if (!userId) {
      console.error("dave-conversation-token: No authenticated user — refusing to start empty session");
      return new Response(
        JSON.stringify({ error: "Authentication required. Please sign in first.", errorType: "auth_failed" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenPromise = fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${ELEVENLABS_AGENT_ID}`,
      { headers: { "xi-api-key": ELEVENLABS_API_KEY } }
    );

    const contextPromise = fetchCrmContext(supabase, userId, conversationHistory);

    const [tokenResp, crmContext] = await Promise.all([tokenPromise, contextPromise]);

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      console.error("ElevenLabs token error:", errBody);
      const classified = classifyElevenLabsError(errBody);
      return new Response(
        JSON.stringify({ error: classified.message, errorType: classified.errorType, detail: errBody }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { token } = await tokenResp.json();

    let contextString = DAVE_INSTRUCTIONS + "\n\n" + crmContext.sections.join("\n\n");
    if (contextString.length > 20000) {
      contextString = contextString.slice(0, 20000) + "\n\n[Context trimmed for performance]";
    }
    const firstMessage = buildFirstMessage(crmContext, tzOffsetHours);

    console.log(`dave-conversation-token completed in ${Date.now() - t0}ms | user: ${userId} | context: ${contextString.length} chars | firstMessage: ${firstMessage.length} chars`);

    return new Response(
      JSON.stringify({ token, context: contextString, firstMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("dave-conversation-token error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error", errorType: "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

interface CrmContext {
  sections: string[];
  calendarCount: number;
  firstMeeting: any;
  overdueCount: number;
  pendingReminders: string[];
  hasLastSession: boolean;
}

async function fetchCrmContext(supabase: any, userId: string, conversationHistory: string): Promise<CrmContext> {
  const now = new Date();
  const fourHoursLater = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const today = now.toISOString().split("T")[0];
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [
    calendarRes, accountsRes, tasksRes, oppsRes, remindersRes,
    renewalsRes, contactsRes, resourcesRes, quotaRes, benchmarksRes,
    streakRes, transcriptsRes, gradesRes, battlePlanRes, journalRes,
    timeBlocksRes, methodologyRes, lastSessionRes,
  ] = await Promise.all([
    supabase
      .from("calendar_events")
      .select("title, start_time, end_time, description, location")
      .eq("user_id", userId)
      .gte("start_time", now.toISOString())
      .lte("start_time", fourHoursLater.toISOString())
      .order("start_time")
      .limit(15),
    supabase
      .from("accounts")
      .select("id, name, next_step, last_touch_date, priority, account_status, tier, website, industry, motion, notes, tech_stack, icp_fit_score, outreach_status")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(30),
    supabase
      .from("tasks")
      .select("title, due_date, priority, status, linked_account_id, notes")
      .eq("user_id", userId)
      .in("status", ["next", "in-progress"])
      .order("due_date", { ascending: true })
      .limit(30),
    supabase
      .from("opportunities")
      .select("id, name, stage, arr, close_date, next_step, deal_type, notes, status, term_months, last_touch_date, account_id")
      .eq("user_id", userId)
      .not("status", "eq", "closed-lost")
      .order("close_date", { ascending: true })
      .limit(50),
    supabase
      .from("voice_reminders")
      .select("id, message, remind_at")
      .eq("user_id", userId)
      .eq("delivered", false)
      .lte("remind_at", now.toISOString())
      .order("remind_at")
      .limit(5),
    supabase
      .from("renewals")
      .select("account_name, arr, renewal_due, churn_risk, health_status, renewal_stage, next_step, owner, notes")
      .eq("user_id", userId)
      .order("renewal_due", { ascending: true })
      .limit(30),
    supabase
      .from("contacts")
      .select("name, title, email, buyer_role, influence_level, department, seniority, status, account_id")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(25),
    supabase
      .from("resources")
      .select("id, title, resource_type, description, content, tags")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(30),
    supabase
      .from("quota_targets")
      .select("*")
      .eq("user_id", userId)
      .limit(1),
    supabase
      .from("conversion_benchmarks")
      .select("*")
      .eq("user_id", userId)
      .limit(1),
    supabase
      .from("streak_events")
      .select("date, checked_in, goal_met, daily_score")
      .eq("user_id", userId)
      .gte("date", sevenDaysAgo)
      .order("date", { ascending: false })
      .limit(7),
    supabase
      .from("call_transcripts")
      .select("title, call_date, call_type, summary, account_id")
      .eq("user_id", userId)
      .order("call_date", { ascending: false })
      .limit(15),
    supabase
      .from("transcript_grades")
      .select("overall_score, overall_grade, coaching_issue, strengths, improvements, coaching_why")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("weekly_battle_plans")
      .select("strategy_summary, moves, quota_gap, week_start")
      .eq("user_id", userId)
      .order("week_start", { ascending: false })
      .limit(1),
    supabase
      .from("daily_journal_entries")
      .select("date, dials, conversations, meetings_set, opportunities_created, daily_score, sentiment_label, what_worked_today, biggest_blocker, focus_mode")
      .eq("user_id", userId)
      .gte("date", fiveDaysAgo)
      .order("date", { ascending: false })
      .limit(5),
    supabase
      .from("daily_time_blocks")
      .select("blocks, ai_reasoning, key_metric_targets")
      .eq("user_id", userId)
      .eq("plan_date", today)
      .limit(1),
    supabase
      .from("opportunity_methodology")
      .select("opportunity_id, metrics_confirmed, metrics_notes, economic_buyer_confirmed, economic_buyer_notes, decision_criteria_confirmed, decision_criteria_notes, decision_process_confirmed, decision_process_notes, identify_pain_confirmed, identify_pain_notes, champion_confirmed, champion_notes, competition_confirmed, competition_notes, before_state_notes, after_state_notes, negative_consequences_notes, positive_business_outcomes_notes, required_capabilities_notes, metrics_value_notes, call_goals")
      .eq("user_id", userId),
    supabase
      .from("dave_transcripts")
      .select("messages, created_at")
      .eq("user_id", userId)
      .gte("created_at", twentyFourHoursAgo)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const sections: string[] = [];
  let calendarCount = 0;
  let firstMeeting: any = null;
  let overdueCount = 0;
  const pendingReminders: string[] = [];
  let hasLastSession = false;

  if (lastSessionRes.data?.length) {
    const lastMessages = lastSessionRes.data[0].messages;
    if (Array.isArray(lastMessages) && lastMessages.length > 0) {
      hasLastSession = true;
      const recent = lastMessages.slice(-10);
      sections.push(
        "LAST SESSION (previous conversation):\n" +
        recent.map((m: any) => `${m.role === 'user' ? 'User' : 'Dave'}: ${trunc(m.text || m.content || '', 150)}`).join("\n")
      );
    }
  }

  if (conversationHistory) {
    sections.push("CURRENT SESSION CONTEXT:\n" + conversationHistory);
  }

  if (calendarRes.data?.length) {
    calendarCount = calendarRes.data.length;
    firstMeeting = calendarRes.data[0];
    sections.push(
      "UPCOMING MEETINGS:\n" +
      calendarRes.data.map((e: any) => {
        const time = new Date(e.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        return `- ${time}: ${e.title}${e.location ? ` (${e.location})` : ""}`;
      }).join("\n")
    );
  }

  const accounts = accountsRes.data || [];
  // Build account ID→name map early so pipeline, contacts, and transcripts can all use it
  const accountIdMap: Record<string, string> = {};
  for (const a of accounts) accountIdMap[(a as any).id] = (a as any).name;
  if (accounts.length) {
    sections.push(
      `ACCOUNTS (${accounts.length}):\n` +
      accounts.map((a: any) =>
        `- ${a.name} [id:${a.id}] [${a.tier || "—"}/${a.priority || "—"}] status:${a.account_status || "—"} motion:${a.motion || "—"}${a.industry ? ` ind:${a.industry}` : ""}${a.icp_fit_score ? ` icp:${a.icp_fit_score}` : ""}${a.last_touch_date ? ` lastTouch:${a.last_touch_date}` : ""}${a.next_step ? ` next:${a.next_step}` : ""}${a.notes ? ` notes:${trunc(a.notes, 80)}` : ""}`
      ).join("\n")
    );
  }

  if (tasksRes.data?.length) {
    const tasks = tasksRes.data as any[];
    // Resolve linked_account_id to account name using already-fetched accounts
    const accountMap = new Map(accounts.map((a: any) => [a.id, a.name]));
    const resolveAcct = (t: any) => t.linked_account_id ? accountMap.get(t.linked_account_id) || null : null;

    const overdue = tasks.filter((t: any) => t.due_date && t.due_date < today);
    const todayTasks = tasks.filter((t: any) => t.due_date === today);
    const upcoming = tasks.filter((t: any) => t.due_date && t.due_date > today);
    overdueCount = overdue.length;

    const lines: string[] = [];
    if (overdue.length) lines.push(`⚠️ ${overdue.length} OVERDUE: ${overdue.map((t: any) => { const acct = resolveAcct(t); return `${t.title}${acct ? ` (${acct})` : ""}`; }).join(", ")}`);
    if (todayTasks.length) lines.push(`Today: ${todayTasks.map((t: any) => { const acct = resolveAcct(t); return `${t.title}${acct ? ` (${acct})` : ""}`; }).join(", ")}`);
    if (upcoming.length) lines.push(`Upcoming: ${upcoming.slice(0, 8).map((t: any) => `${t.title} due:${t.due_date}`).join(", ")}`);
    if (lines.length) sections.push("TASKS:\n" + lines.join("\n"));
  }

  const opps = oppsRes.data || [];
  if (opps.length) {
    const totalPipeline = opps.reduce((sum: number, o: any) => sum + (o.arr || 0), 0);
    sections.push(
      `PIPELINE (${opps.length} deals, $${Math.round(totalPipeline / 1000)}k total):\n` +
      opps.slice(0, 20).map((o: any) =>
        `- ${o.name} [id:${o.id}]: ${o.stage || "—"} $${Math.round((o.arr || 0) / 1000)}k close:${o.close_date || "TBD"} type:${o.deal_type || "—"} acct:${(o.account_id && accountIdMap[o.account_id]) || "—"}${o.last_touch_date ? ` lastTouch:${o.last_touch_date}` : ""}${o.next_step ? ` → ${o.next_step}` : ""}${o.notes ? ` notes:${trunc(o.notes, 60)}` : ""}`
      ).join("\n")
    );
  }

  if (remindersRes.data?.length) {
    for (const r of remindersRes.data as any[]) {
      pendingReminders.push(r.message);
    }
    sections.push("PENDING REMINDERS:\n" + pendingReminders.map((m: string) => `- ${m}`).join("\n"));
    const reminderIds = (remindersRes.data as any[]).map((r: any) => r.id);
    if (reminderIds.length) {
      await supabase.from("voice_reminders").update({ delivered: true }).in("id", reminderIds);
    }
  }

  if (renewalsRes.data?.length) {
    sections.push(
      `RENEWALS (${renewalsRes.data.length}):\n` +
      (renewalsRes.data as any[]).map((r: any) =>
        `- ${r.account_name}: $${Math.round((r.arr || 0) / 1000)}k due:${r.renewal_due} health:${r.health_status || "—"} risk:${r.churn_risk || "—"} stage:${r.renewal_stage || "—"}${r.next_step ? ` → ${r.next_step}` : ""}`
      ).join("\n")
    );
  }

  const contacts = contactsRes.data || [];
  if (contacts.length) {
    sections.push(
      `CONTACTS (${contacts.length}):\n` +
      contacts.slice(0, 30).map((c: any) =>
        `- ${c.name}${c.title ? ` (${c.title})` : ""} role:${c.buyer_role || "—"} influence:${c.influence_level || "—"} status:${c.status || "—"}${c.department ? ` dept:${c.department}` : ""} acct:${(c.account_id && accountIdMap[c.account_id]) || "—"}`
      ).join("\n")
    );
  }

  if (resourcesRes.data?.length) {
    const resourceIds = (resourcesRes.data as any[]).map((r: any) => r.id || "").filter(Boolean);
    let digestMap: Record<string, any> = {};
    if (resourceIds.length) {
      const { data: digests } = await supabase
        .from("resource_digests")
        .select("resource_id, takeaways, use_cases, summary")
        .in("resource_id", resourceIds);
      if (digests) {
        for (const d of digests) digestMap[d.resource_id] = d;
      }
    }

    sections.push(
      `RESOURCES & FRAMEWORKS (${resourcesRes.data.length}):\n` +
      (resourcesRes.data as any[]).map((r: any) => {
        const digest = digestMap[r.id];
        if (digest) {
          return `- [${r.resource_type}] ${r.title}: ${digest.summary || trunc(r.description || "", 100)}${digest.takeaways ? `\n  Takeaways: ${digest.takeaways}` : ""}${digest.use_cases ? `\n  Use cases: ${digest.use_cases}` : ""}`;
        }
        const contentPreview = r.content ? trunc(r.content, 200) : "";
        return `- [${r.resource_type}] ${r.title}: ${trunc(r.description || "", 100)}${r.tags?.length ? ` tags:${r.tags.join(",")}` : ""}${contentPreview ? `\n  Content: ${contentPreview}` : ""}`;
      }).join("\n")
    );
  }

  if (quotaRes.data?.length) {
    const q = quotaRes.data[0] as any;
    const totalQuota = (q.new_arr_quota || 0) + (q.renewal_arr_quota || 0);
    sections.push(`QUOTA: total=$${totalQuota.toLocaleString()} new_logo=$${(q.new_arr_quota || 0).toLocaleString()} renewal=$${(q.renewal_arr_quota || 0).toLocaleString()} FY:${q.fiscal_year_start || "—"} to ${q.fiscal_year_end || "—"}`);
  }

  if (benchmarksRes.data?.length) {
    const b = benchmarksRes.data[0];
    sections.push(`CONVERSION BENCHMARKS: dials→connect:${(b.dials_to_connect_rate * 100).toFixed(0)}% connect→meeting:${(b.connect_to_meeting_rate * 100).toFixed(0)}% meeting→opp:${(b.meeting_to_opp_rate * 100).toFixed(0)}% opp→close:${(b.opp_to_close_rate * 100).toFixed(0)}% avg_cycle:${b.avg_sales_cycle_days}d avg_new_logo:$${b.avg_new_logo_arr} avg_renewal:$${b.avg_renewal_arr}`);
  }

  if (streakRes.data?.length) {
    sections.push(
      "STREAK (last 7d):\n" +
      (streakRes.data as any[]).map((s: any) =>
        `${s.date}: ${s.checked_in ? "✓" : "✗"} score:${s.daily_score ?? "—"} goal:${s.goal_met ? "✓" : "✗"}`
      ).join(" | ")
    );
  }

  if (transcriptsRes.data?.length) {
    // accountIdMap already built above — reuse it

    sections.push(
      `RECENT CALLS (${transcriptsRes.data.length}):\n` +
      (transcriptsRes.data as any[]).map((t: any) =>
        `- ${t.call_date}: ${t.title}${t.call_type ? ` [${t.call_type}]` : ""}${t.account_id && accountIdMap[t.account_id] ? ` (${accountIdMap[t.account_id]})` : ""}${t.summary ? `\n  Summary: ${trunc(t.summary, 150)}` : ""}`
      ).join("\n")
    );
  }

  if (gradesRes.data?.length) {
    sections.push(
      "COACHING HISTORY (transcript grades):\n" +
      (gradesRes.data as any[]).map((g: any) =>
        `- ${g.overall_grade || "—"} (${g.overall_score || "—"}/100): issue=${g.coaching_issue || "—"} why=${trunc(g.coaching_why || "", 80)} strengths=${trunc(g.strengths || "", 60)} improve=${trunc(g.improvements || "", 60)}`
      ).join("\n")
    );
  }

  if (battlePlanRes.data?.length) {
    const bp = battlePlanRes.data[0];
    sections.push(
      `WEEKLY BATTLE PLAN (${bp.week_start}):\n${bp.strategy_summary || ""}${bp.quota_gap ? `\nQuota gap: $${bp.quota_gap}` : ""}${bp.moves ? `\nMoves: ${JSON.stringify(bp.moves)}` : ""}`
    );
  }

  if (journalRes.data?.length) {
    sections.push(
      "DAILY JOURNAL (last 5d):\n" +
      (journalRes.data as any[]).map((j: any) =>
        `${j.date}: dials=${j.dials} convos=${j.conversations} meetings=${j.meetings_set} opps=${j.opportunities_created} score=${j.daily_score ?? "—"} mood=${j.sentiment_label || "—"} focus=${j.focus_mode || "—"}${j.what_worked_today ? ` worked="${trunc(j.what_worked_today, 60)}"` : ""}${j.biggest_blocker ? ` blocker="${trunc(j.biggest_blocker, 60)}"` : ""}`
      ).join("\n")
    );
  }

  if (timeBlocksRes.data?.length) {
    const tb = timeBlocksRes.data[0];
    sections.push(`TODAY'S PLAN: ${tb.ai_reasoning || ""}${tb.key_metric_targets ? `\nTargets: ${JSON.stringify(tb.key_metric_targets)}` : ""}`);
  }

  if (methodologyRes.data?.length) {
    const oppIdMap: Record<string, string> = {};
    for (const o of opps) oppIdMap[o.id] = o.name;

    sections.push(
      `MEDDICC STATUS (${methodologyRes.data.length} deals):\n` +
      (methodologyRes.data as any[]).map((m: any) => {
        const oppName = oppIdMap[m.opportunity_id] || m.opportunity_id;
        const fields = [
          m.metrics_confirmed ? "M✓" : "M✗",
          m.economic_buyer_confirmed ? "E✓" : "E✗",
          m.decision_criteria_confirmed ? "D✓" : "D✗",
          m.decision_process_confirmed ? "D✓" : "D✗",
          m.identify_pain_confirmed ? "I✓" : "I✗",
          m.champion_confirmed ? "C✓" : "C✗",
          m.competition_confirmed ? "C✓" : "C✗",
        ].join("");
        const gaps: string[] = [];
        if (!m.metrics_confirmed) gaps.push("Metrics");
        if (!m.economic_buyer_confirmed) gaps.push("EB");
        if (!m.decision_criteria_confirmed) gaps.push("DC");
        if (!m.decision_process_confirmed) gaps.push("DP");
        if (!m.identify_pain_confirmed) gaps.push("Pain");
        if (!m.champion_confirmed) gaps.push("Champion");
        if (!m.competition_confirmed) gaps.push("Competition");
        return `- ${oppName}: ${fields}${gaps.length ? ` GAPS: ${gaps.join(", ")}` : " COMPLETE"}${m.call_goals ? ` goals:${JSON.stringify(m.call_goals)}` : ""}`;
      }).join("\n")
    );
  }

  return { sections, calendarCount, firstMeeting, overdueCount, pendingReminders, hasLastSession };
}

function buildFirstMessage(ctx: CrmContext, tzOffsetHours: number): string {
  const localHour = (new Date().getUTCHours() + tzOffsetHours + 24) % 24;

  if (localHour < 10) {
    let msg = "Good morning — it's Dave. ";
    if (ctx.calendarCount > 0 && ctx.firstMeeting) {
      const time = new Date(ctx.firstMeeting.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      msg += `You've got ${ctx.calendarCount} meeting${ctx.calendarCount > 1 ? "s" : ""} coming up, starting with "${ctx.firstMeeting.title}" at ${time}. `;
    }
    if (ctx.overdueCount > 0) {
      msg += `Heads up: ${ctx.overdueCount} overdue task${ctx.overdueCount > 1 ? "s" : ""} to knock out. `;
    }
    if (ctx.pendingReminders.length > 0) {
      msg += `Quick reminder: ${ctx.pendingReminders[0]}. `;
    }
    if (ctx.hasLastSession) {
      msg += "I've got context from our last session too. ";
    }
    msg += "What do you want to tackle first?";
    return msg;
  } else if (localHour < 16) {
    let msg = "Hey, it's Dave. ";
    if (ctx.calendarCount > 0 && ctx.firstMeeting) {
      msg += `Next up: "${ctx.firstMeeting.title}" — want me to prep you? `;
    }
    if (ctx.pendingReminders.length > 0) {
      msg += `Reminder: ${ctx.pendingReminders[0]}. `;
    }
    msg += "How can I help?";
    return msg;
  } else {
    let msg = "Hey, Dave here for your day-wrap. ";
    if (ctx.overdueCount > 0) {
      msg += `${ctx.overdueCount} task${ctx.overdueCount > 1 ? "s" : ""} still pending. `;
    }
    msg += "Want to debrief on today or plan for tomorrow?";
    return msg;
  }
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
