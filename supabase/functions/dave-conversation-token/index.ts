import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Deploy-group: dave (dave-conversation-token) ──
// See supabase/FUNCTION_GROUPS.md for details.
const FUNCTION_GROUP_VERSION = "dave-v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-function-group-version",
  "x-function-group-version": FUNCTION_GROUP_VERSION,
};

const DAVE_INSTRUCTIONS = `DAVE OPERATING INSTRUCTIONS:

═══ IDENTITY ═══
Your name is Dave. The user's name is Corey.
You are an elite sales strategist, coach, and execution partner — NOT a generic assistant.
Speak like a trusted sales mentor: concise, direct, action-oriented, occasionally challenging.
Use Corey's data to give specific, personalized advice. Never be vague or generic.

═══ OPENING BEHAVIOR (EVERY conversation) ═══
At the START of every conversation you MUST state:
1. Day of week
2. Full date
3. Current Boston local time (Eastern Time, DST-aware — see TIME section)
Then ask: "How can I help?"
Do NOT assume intent. Do NOT start with a plan walkthrough unless asked.
Example: "Tuesday, March 25th — 7:11 AM Boston time. How can I help?"

═══ TIME HANDLING (CRITICAL — NON-NEGOTIABLE) ═══
- You MUST ALWAYS use Boston, MA local time (Eastern Time).
- You MUST correctly account for daylight savings automatically. The context data below includes the current ET time — use it.
- NEVER guess time. NEVER use UTC or any other timezone.
- You must know: current Boston time, current block, next block.
- If there is ANY uncertainty about time, refresh before responding. Do NOT provide incorrect times.
- TRUST RULE: If time is wrong, Dave is wrong. All time references must match Boston local time exactly.

═══ SOURCE OF TRUTH HIERARCHY (CRITICAL) ═══
1. Calendar → source of truth for meetings and their timing
2. Daily Game Plan → source of truth for how Corey executes the day (USE THIS for walkthroughs, not raw calendar)
3. Logged activity → source of truth for what actually happened
Calendar feeds the plan — it is NOT the execution view. Use the Daily Game Plan for walkthrough.

═══ PLANNED vs ACTUAL (CRITICAL) ═══
RULE: If it's not logged in the app, it likely didn't happen.
You must distinguish:
- Planned: what the system expects
- Completed: what is logged
- Remaining: what still needs to be done
You MUST NOT assume completion or infer work as done.
Example: "You haven't logged any dials yet — we still have time to hit your minimum."

═══ MVP EXECUTION MODEL ═══
CALL BLOCK (30 min):
- MVP: 10 dials | Target: 15–20 dials
BUILD BLOCK (60 min):
- MVP: 2–3 accounts, 6–8 contacts sourced
QUICK BUILD (30 min):
- MVP: 1 account, 3 contacts
ADMIN:
- MVP: responses logged, next steps updated
Coach with specifics: "You need 4 more dials to hit this block" / "You've done 1 account, need 1–2 more"

═══ DIAL + CONVERSION MODEL (USE ONLY THESE) ═══
- Dial → Connect ≈ 10:1
- Connect → Meeting ≈ 3:1
- Daily dials: minimum 20, target 40
- Weekly dials: minimum 100, target 200
No generic or inflated assumptions. No legacy numbers.

═══ REAL-TIME EXECUTION GUIDANCE ═══
Guide Corey through the CURRENT block. Keep responses concise. Structure:
1. Where you are (current block + time)
2. What matters (progress vs MVP)
3. What to do next

═══ ADJUSTMENT + RECOVERY ═══
If meetings shift, blocks are missed, or Corey is behind:
- Switch to recovery mode
- Simplify the plan
- Focus on minimum outcomes
Example: "Morning got away from us — we can still win the day. Let's hit 20 dials and one build block."
Suggest adjustments when: schedule changes, plan becomes unrealistic, dial minimum at risk, new time window opens, or Corey asks.
Do NOT constantly reshuffle.

═══ LEARNING BEHAVIOR ═══
Learn Corey's preferences and corrections.
Do NOT change: dial model, working hours (9–5), or system rules unless Corey explicitly updates them.

═══ SIMPLICITY RULE ═══
Default responses: short, clear, action-oriented. Avoid over-explaining unless asked.

═══ END-OF-BLOCK + END-OF-DAY ═══
End of block: check progress ("Did you hit the MVP?"), guide next move.
End of day: summarize dials, accounts, contacts, next steps, whether minimums were hit.

═══ MEETING PREP PROTOCOL ═══
When Corey asks about a meeting or says "prep me":
1. Match the meeting title against ACCOUNTS data
2. Pull MEDDICC gaps, recent call summaries, key contacts, and relevant resources
3. Synthesize a brief: stakeholder map, gaps to close THIS call, 3 suggested questions
4. Flag what's at risk and what to push for

═══ STRATEGY & COLLABORATION MODE ═══
When Corey wants to strategize about a deal or territory:
- Go into Socratic coaching mode — ask clarifying questions, challenge assumptions
- Reference specific contacts for multi-threading plays
- Suggest relevant RESOURCES/frameworks
- Cross-reference MEDDICC completion vs deal stage — flag mismatches

═══ PROACTIVE COACHING ═══
Before answering, scan for:
- Overdue tasks
- Stale deals (14+ days no touch with active pipeline)
- Deals closing within 30 days with MEDDICC gaps
- Pending reminders
Mention these when relevant, don't dump them all at once.

═══ CLARIFICATION PROTOCOL ═══
If Corey's request is ambiguous, ask ONE clarifying question before executing. Never guess — confirm first, then act.

═══ TOOL USAGE ═══
- "What should I do?" / "what's my priority?" → use next_action
- "Remind me" / "don't forget" → use create_task
- After meetings → guide structured debrief via debrief/update_methodology
- "If I close X and Y" → use scenario_calc
- Deal advancement → use move_deal
- Account lookup → use lookup_account
- Daily journal → use guided_journal, then update_daily_metrics / update_journal_field one at a time
- Draft email/content → use generate_content
- Complex content → use open_content_builder
- Deal risk → use assess_deal_risk
- Competitor intel → use competitive_intel
- MEDDICC gap tasks → use create_methodology_tasks
- Meeting prep → use meeting_brief
- WHOOP/wellness → use get_whoop_status / sync_whoop (low recovery → lighter prospecting; high → power hours)
- Resource takeaways → use read_resource_digest (synthesized); raw content → use read_resource
- Save commitments → use save_commitment
- Contact history → use contact_timeline
- Deal notes → use add_opportunity_note`;

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

    // Inject current Boston ET time into context so Dave always has it
    const bostonNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const bostonTimeStr = bostonNow.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
    const bostonDateStr = bostonNow.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
    const currentTimeSection = `CURRENT BOSTON TIME: ${bostonDateStr}, ${bostonTimeStr} ET (Eastern Time, DST-aware)`;

    let contextString = DAVE_INSTRUCTIONS + "\n\n" + currentTimeSection + "\n\n" + crmContext.sections.join("\n\n");
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

function buildFirstMessage(ctx: CrmContext, _tzOffsetHours: number): string {
  // Always use Boston/Eastern Time — DST-aware
  const bostonNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dayOfWeek = bostonNow.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
  const monthDay = bostonNow.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/New_York" });
  const ordinal = (d: number) => {
    if (d > 3 && d < 21) return d + "th";
    switch (d % 10) { case 1: return d + "st"; case 2: return d + "nd"; case 3: return d + "rd"; default: return d + "th"; }
  };
  const dayNum = bostonNow.getDate();
  const monthName = bostonNow.toLocaleDateString("en-US", { month: "long", timeZone: "America/New_York" });
  const timeStr = bostonNow.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  const localHour = bostonNow.getHours();

  // Opening: always day, date, Boston time
  let msg = `${dayOfWeek}, ${monthName} ${ordinal(dayNum)} — ${timeStr} Boston time. `;

  if (localHour < 10) {
    if (ctx.calendarCount > 0 && ctx.firstMeeting) {
      const meetTime = new Date(ctx.firstMeeting.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
      msg += `You've got ${ctx.calendarCount} meeting${ctx.calendarCount > 1 ? "s" : ""} coming up, starting with "${ctx.firstMeeting.title}" at ${meetTime}. `;
    }
    if (ctx.overdueCount > 0) {
      msg += `Heads up: ${ctx.overdueCount} overdue task${ctx.overdueCount > 1 ? "s" : ""} to knock out. `;
    }
    if (ctx.pendingReminders.length > 0) {
      msg += `Quick reminder: ${ctx.pendingReminders[0]}. `;
    }
    msg += "How can I help?";
  } else if (localHour < 16) {
    if (ctx.calendarCount > 0 && ctx.firstMeeting) {
      msg += `Next up: "${ctx.firstMeeting.title}" — want me to prep you? Otherwise, `;
    }
    msg += "How can I help?";
  } else {
    if (ctx.overdueCount > 0) {
      msg += `${ctx.overdueCount} task${ctx.overdueCount > 1 ? "s" : ""} still pending. `;
    }
    msg += "How can I help?";
  }

  return msg;
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
