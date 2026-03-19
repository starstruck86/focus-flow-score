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
When asked about a specific account in depth, use lookup_account tool for full context.`;

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
        JSON.stringify({ error: "ElevenLabs not configured. Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID." }),
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

    const tokenPromise = fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${ELEVENLABS_AGENT_ID}`,
      { headers: { "xi-api-key": ELEVENLABS_API_KEY } }
    );

    const contextPromise = userId ? fetchCrmContext(supabase, userId, conversationHistory) : Promise.resolve(null);

    const [tokenResp, crmContext] = await Promise.all([tokenPromise, contextPromise]);

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      console.error("ElevenLabs token error:", errBody);
      return new Response(
        JSON.stringify({ error: "Failed to generate conversation token", detail: errBody }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { token } = await tokenResp.json();

    let contextString = "";
    let firstMessage: string | null = null;

    if (crmContext) {
      contextString = DAVE_INSTRUCTIONS + "\n\n" + crmContext.sections.join("\n\n");
      firstMessage = buildFirstMessage(crmContext, tzOffsetHours);
    }

    console.log(`dave-conversation-token completed in ${Date.now() - t0}ms, context ${contextString.length} chars`);

    return new Response(
      JSON.stringify({ token, context: contextString, firstMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("dave-conversation-token error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
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

  // All queries in parallel (including previous session)
  const [
    calendarRes, accountsRes, tasksRes, oppsRes, remindersRes,
    renewalsRes, contactsRes, resourcesRes, quotaRes, benchmarksRes,
    streakRes, transcriptsRes, gradesRes, battlePlanRes, journalRes,
    timeBlocksRes, methodologyRes, lastSessionRes,
  ] = await Promise.all([
    // 1. Calendar events (next 4 hours)
    supabase
      .from("calendar_events")
      .select("title, start_time, end_time, description, location")
      .eq("user_id", userId)
      .gte("start_time", now.toISOString())
      .lte("start_time", fourHoursLater.toISOString())
      .order("start_time")
      .limit(15),
    // 2. Accounts (expanded)
    supabase
      .from("accounts")
      .select("id, name, next_step, last_touch_date, priority, account_status, tier, website, industry, motion, notes, tech_stack, icp_fit_score, outreach_status")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(30),
    // 3. Tasks (expanded)
    supabase
      .from("tasks")
      .select("title, due_date, priority, status, account_name, notes")
      .eq("user_id", userId)
      .in("status", ["next", "in-progress"])
      .order("due_date", { ascending: true })
      .limit(30),
    // 4. Opportunities (expanded)
    supabase
      .from("opportunities")
      .select("id, name, stage, arr, close_date, next_step, deal_type, notes, status, term_months, last_touch_date, account_id")
      .eq("user_id", userId)
      .not("status", "eq", "closed-lost")
      .order("close_date", { ascending: true })
      .limit(50),
    // 5. Voice reminders
    supabase
      .from("voice_reminders")
      .select("id, message, remind_at")
      .eq("user_id", userId)
      .eq("delivered", false)
      .lte("remind_at", now.toISOString())
      .order("remind_at")
      .limit(5),
    // 6. Renewals
    supabase
      .from("renewals")
      .select("account_name, arr, renewal_due, churn_risk, health_status, renewal_stage, next_step, owner, notes")
      .eq("user_id", userId)
      .order("renewal_due", { ascending: true })
      .limit(30),
    // 7. Contacts
    supabase
      .from("contacts")
      .select("name, title, email, buyer_role, influence_level, department, seniority, status, account_id")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50),
    // 8. Resources (battlecards, frameworks, methodology docs)
    supabase
      .from("resources")
      .select("id, title, resource_type, description, content, tags")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(30),
    // 9. Quota targets
    supabase
      .from("quota_targets")
      .select("*")
      .eq("user_id", userId)
      .limit(1),
    // 10. Conversion benchmarks
    supabase
      .from("conversion_benchmarks")
      .select("*")
      .eq("user_id", userId)
      .limit(1),
    // 11. Streak events (last 7 days)
    supabase
      .from("streak_events")
      .select("date, checked_in, goal_met, daily_score")
      .eq("user_id", userId)
      .gte("date", sevenDaysAgo)
      .order("date", { ascending: false })
      .limit(7),
    // 12. Call transcripts (recent)
    supabase
      .from("call_transcripts")
      .select("title, call_date, call_type, summary, account_id")
      .eq("user_id", userId)
      .order("call_date", { ascending: false })
      .limit(15),
    // 13. Transcript grades (recent)
    supabase
      .from("transcript_grades")
      .select("overall_score, overall_grade, coaching_issue, strengths, improvements, coaching_why")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
    // 14. Weekly battle plan (most recent)
    supabase
      .from("weekly_battle_plans")
      .select("strategy_summary, moves, quota_gap, week_start")
      .eq("user_id", userId)
      .order("week_start", { ascending: false })
      .limit(1),
    // 15. Daily journal entries (last 5 days)
    supabase
      .from("daily_journal_entries")
      .select("date, dials, conversations, meetings_set, opportunities_created, daily_score, sentiment_label, what_worked_today, biggest_blocker, focus_mode")
      .eq("user_id", userId)
      .gte("date", fiveDaysAgo)
      .order("date", { ascending: false })
      .limit(5),
    // 16. Daily time blocks (today)
    supabase
      .from("daily_time_blocks")
      .select("blocks, ai_reasoning, key_metric_targets")
      .eq("user_id", userId)
      .eq("plan_date", today)
      .limit(1),
    // 17. Opportunity methodology (all active opps)
    supabase
      .from("opportunity_methodology")
      .select("opportunity_id, metrics_confirmed, metrics_notes, economic_buyer_confirmed, economic_buyer_notes, decision_criteria_confirmed, decision_criteria_notes, decision_process_confirmed, decision_process_notes, identify_pain_confirmed, identify_pain_notes, champion_confirmed, champion_notes, competition_confirmed, competition_notes, before_state_notes, after_state_notes, negative_consequences_notes, positive_business_outcomes_notes, required_capabilities_notes, metrics_value_notes, call_goals")
      .eq("user_id", userId),
    // 18. Last Dave session (within 24h)
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

  // --- Last Session Recall ---
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

  // --- Current Session Context ---
  if (conversationHistory) {
    sections.push("CURRENT SESSION CONTEXT:\n" + conversationHistory);
  }

  // --- Calendar ---
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

  // --- Accounts ---
  const accounts = accountsRes.data || [];
  if (accounts.length) {
    sections.push(
      `ACCOUNTS (${accounts.length}):\n` +
      accounts.map((a: any) =>
        `- ${a.name} [id:${a.id}] [${a.tier || "—"}/${a.priority || "—"}] status:${a.account_status || "—"} motion:${a.motion || "—"}${a.industry ? ` ind:${a.industry}` : ""}${a.icp_fit_score ? ` icp:${a.icp_fit_score}` : ""}${a.last_touch_date ? ` lastTouch:${a.last_touch_date}` : ""}${a.next_step ? ` next:${a.next_step}` : ""}${a.notes ? ` notes:${trunc(a.notes, 80)}` : ""}`
      ).join("\n")
    );
  }

  // --- Tasks ---
  if (tasksRes.data?.length) {
    const tasks = tasksRes.data as any[];
    const overdue = tasks.filter((t: any) => t.due_date && t.due_date < today);
    const todayTasks = tasks.filter((t: any) => t.due_date === today);
    const upcoming = tasks.filter((t: any) => t.due_date && t.due_date > today);
    overdueCount = overdue.length;

    const lines: string[] = [];
    if (overdue.length) lines.push(`⚠️ ${overdue.length} OVERDUE: ${overdue.map((t: any) => `${t.title}${t.account_name ? ` (${t.account_name})` : ""}`).join(", ")}`);
    if (todayTasks.length) lines.push(`Today: ${todayTasks.map((t: any) => `${t.title}${t.account_name ? ` (${t.account_name})` : ""}`).join(", ")}`);
    if (upcoming.length) lines.push(`Upcoming: ${upcoming.slice(0, 8).map((t: any) => `${t.title} due:${t.due_date}`).join(", ")}`);
    if (lines.length) sections.push("TASKS:\n" + lines.join("\n"));
  }

  // --- Opportunities ---
  const opps = oppsRes.data || [];
  if (opps.length) {
    const totalPipeline = opps.reduce((sum: number, o: any) => sum + (o.arr || 0), 0);
    sections.push(
      `PIPELINE (${opps.length} deals, $${Math.round(totalPipeline / 1000)}k total):\n` +
      opps.slice(0, 20).map((o: any) =>
        `- ${o.name} [id:${o.id}]: ${o.stage || "—"} $${Math.round((o.arr || 0) / 1000)}k close:${o.close_date || "TBD"} type:${o.deal_type || "—"} acct:${o.account_id || "—"}${o.last_touch_date ? ` lastTouch:${o.last_touch_date}` : ""}${o.next_step ? ` → ${o.next_step}` : ""}${o.notes ? ` notes:${trunc(o.notes, 60)}` : ""}`
      ).join("\n")
    );
  }

  // --- Voice reminders ---
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

  // --- Renewals ---
  if (renewalsRes.data?.length) {
    sections.push(
      `RENEWALS (${renewalsRes.data.length}):\n` +
      (renewalsRes.data as any[]).map((r: any) =>
        `- ${r.account_name}: $${Math.round((r.arr || 0) / 1000)}k due:${r.renewal_due} health:${r.health_status || "—"} risk:${r.churn_risk || "—"} stage:${r.renewal_stage || "—"}${r.next_step ? ` → ${r.next_step}` : ""}`
      ).join("\n")
    );
  }

  // --- Contacts ---
  const contacts = contactsRes.data || [];
  if (contacts.length) {
    sections.push(
      `CONTACTS (${contacts.length}):\n` +
      contacts.slice(0, 30).map((c: any) =>
        `- ${c.name}${c.title ? ` (${c.title})` : ""} role:${c.buyer_role || "—"} influence:${c.influence_level || "—"} status:${c.status || "—"}${c.department ? ` dept:${c.department}` : ""} acct:${c.account_id || "—"}`
      ).join("\n")
    );
  }

  // --- Resources (prefer digests over raw content) ---
  if (resourcesRes.data?.length) {
    const resourceIds = (resourcesRes.data as any[]).map((r: any) => r.id || "").filter(Boolean);
    let digestMap: Record<string, any> = {};
    if (resourceIds.length) {
      const { data: digests } = await supabase
        .from("resource_digests")
        .select("resource_id, takeaways, use_cases, summary")
        .in("resource_id", resourceIds);
      if (digests?.length) {
        for (const d of digests as any[]) {
          digestMap[d.resource_id] = d;
        }
      }
    }

    sections.push(
      `RESOURCES & FRAMEWORKS (${resourcesRes.data.length}):\n` +
      (resourcesRes.data as any[]).map((r: any) => {
        const digest = digestMap[r.id];
        if (digest) {
          const takeaways = (digest.takeaways || []).map((t: string) => `• ${t}`).join(" ");
          const useCases = (digest.use_cases || []).join(", ");
          return `- [${r.resource_type}] ${r.title}${r.tags?.length ? ` tags:${r.tags.join(",")}` : ""}\n  TAKEAWAYS: ${takeaways}\n  USE WHEN: ${useCases}`;
        }
        return `- [${r.resource_type}] ${r.title}${r.tags?.length ? ` tags:${r.tags.join(",")}` : ""}${r.description ? ` — ${trunc(r.description, 100)}` : ""}${r.content ? `\n  CONTENT: ${trunc(r.content, 500)}` : ""}`;
      }).join("\n")
    );
  }

  // --- Quota targets ---
  if (quotaRes.data?.length) {
    const q = quotaRes.data[0];
    sections.push(
      `QUOTA TARGETS:\n` +
      `New ARR: $${Math.round(q.new_arr_quota / 1000)}k | Renewal ARR: $${Math.round(q.renewal_arr_quota / 1000)}k\n` +
      `Daily targets: ${q.target_dials_per_day} dials, ${q.target_connects_per_day} connects\n` +
      `Weekly targets: ${q.target_meetings_set_per_week} meetings, ${q.target_opps_created_per_week} opps, ${q.target_customer_meetings_per_week} customer meetings\n` +
      `FY: ${q.fiscal_year_start} to ${q.fiscal_year_end}`
    );
  }

  // --- Conversion benchmarks ---
  if (benchmarksRes.data?.length) {
    const b = benchmarksRes.data[0];
    sections.push(
      `CONVERSION RATES:\n` +
      `Dial→Connect: ${(b.dials_to_connect_rate * 100).toFixed(0)}% | Connect→Meeting: ${(b.connect_to_meeting_rate * 100).toFixed(0)}% | Meeting→Opp: ${(b.meeting_to_opp_rate * 100).toFixed(0)}% | Opp→Close: ${(b.opp_to_close_rate * 100).toFixed(0)}%\n` +
      `Avg new logo ARR: $${Math.round(b.avg_new_logo_arr / 1000)}k | Avg cycle: ${b.avg_sales_cycle_days}d`
    );
  }

  // --- Streak events ---
  if (streakRes.data?.length) {
    const streaks = streakRes.data as any[];
    const checkedIn = streaks.filter((s: any) => s.checked_in).length;
    const goalsMet = streaks.filter((s: any) => s.goal_met).length;
    const avgScore = streaks.reduce((s: number, e: any) => s + (e.daily_score || 0), 0) / streaks.length;
    sections.push(
      `STREAK (last 7d): ${checkedIn}/${streaks.length} check-ins, ${goalsMet} goals met, avg score: ${avgScore.toFixed(0)}`
    );
  }

  // --- Call transcripts ---
  const transcripts = transcriptsRes.data || [];
  if (transcripts.length) {
    sections.push(
      `RECENT CALLS (${transcripts.length}):\n` +
      transcripts.slice(0, 10).map((t: any) =>
        `- ${t.call_date}: ${t.title} [${t.call_type || "—"}] acct:${t.account_id || "—"}${t.summary ? ` — ${trunc(t.summary, 120)}` : ""}`
      ).join("\n")
    );
  }

  // --- Transcript grades / coaching ---
  if (gradesRes.data?.length) {
    const grades = gradesRes.data as any[];
    const avgScore = grades.reduce((s: number, g: any) => s + (g.overall_score || 0), 0) / grades.length;
    const issues = grades.map((g: any) => g.coaching_issue).filter(Boolean);
    const allStrengths = grades.flatMap((g: any) => g.strengths || []).slice(0, 5);
    const allImprovements = grades.flatMap((g: any) => g.improvements || []).slice(0, 5);
    sections.push(
      `COACHING HISTORY (${grades.length} graded calls, avg score: ${avgScore.toFixed(0)}):\n` +
      (issues.length ? `Key issues: ${[...new Set(issues)].join(", ")}\n` : "") +
      (allStrengths.length ? `Strengths: ${allStrengths.join(", ")}\n` : "") +
      (allImprovements.length ? `Areas to improve: ${allImprovements.join(", ")}` : "")
    );
  }

  // --- Weekly battle plan ---
  if (battlePlanRes.data?.length) {
    const bp = battlePlanRes.data[0];
    sections.push(
      `WEEKLY BATTLE PLAN (week of ${bp.week_start}):\n` +
      (bp.strategy_summary ? `Strategy: ${bp.strategy_summary}\n` : "") +
      (bp.quota_gap != null ? `Quota gap: $${Math.round(bp.quota_gap / 1000)}k\n` : "") +
      (Array.isArray(bp.moves) && bp.moves.length ? `Moves: ${bp.moves.slice(0, 5).map((m: any) => typeof m === 'string' ? m : m.text || m.title || JSON.stringify(m)).join("; ")}` : "")
    );
  }

  // --- Journal entries ---
  if (journalRes.data?.length) {
    sections.push(
      `RECENT JOURNAL (last ${journalRes.data.length}d):\n` +
      (journalRes.data as any[]).map((j: any) =>
        `- ${j.date}: score:${j.daily_score || "—"} dials:${j.dials} convos:${j.conversations} mtgs:${j.meetings_set} opps:${j.opportunities_created} mood:${j.sentiment_label || "—"}${j.what_worked_today ? ` win:${trunc(j.what_worked_today, 60)}` : ""}${j.biggest_blocker ? ` blocker:${trunc(j.biggest_blocker, 60)}` : ""}`
      ).join("\n")
    );
  }

  // --- Today's time blocks ---
  if (timeBlocksRes.data?.length) {
    const tb = timeBlocksRes.data[0];
    if (Array.isArray(tb.blocks) && tb.blocks.length) {
      sections.push(
        `TODAY'S PLAN:\n` +
        tb.blocks.slice(0, 10).map((b: any) => `- ${b.start || ""}–${b.end || ""}: ${b.label || b.title || "block"}${b.type ? ` [${b.type}]` : ""}`).join("\n") +
        (tb.ai_reasoning ? `\nAI reasoning: ${trunc(tb.ai_reasoning, 150)}` : "")
      );
    }
  }

  // --- Opportunity methodology (MEDDICC / CotM) ---
  const methodologyData = methodologyRes.data || [];
  if (methodologyData.length && opps.length) {
    const oppMap = new Map(opps.map((o: any) => [o.id, o]));
    const methodRows = methodologyData.filter((m: any) => oppMap.has(m.opportunity_id));
    if (methodRows.length) {
      sections.push(
        `METHODOLOGY (MEDDICC/CotM) per deal:\n` +
        methodRows.slice(0, 10).map((m: any) => {
          const opp = oppMap.get(m.opportunity_id);
          const oppName = opp?.name || m.opportunity_id;
          const confirmed = [
            m.metrics_confirmed && "Metrics",
            m.economic_buyer_confirmed && "EconBuyer",
            m.decision_criteria_confirmed && "DecCriteria",
            m.decision_process_confirmed && "DecProcess",
            m.identify_pain_confirmed && "Pain",
            m.champion_confirmed && "Champion",
            m.competition_confirmed && "Competition",
          ].filter(Boolean);
          const missing = [
            !m.metrics_confirmed && "Metrics",
            !m.economic_buyer_confirmed && "EconBuyer",
            !m.decision_criteria_confirmed && "DecCriteria",
            !m.decision_process_confirmed && "DecProcess",
            !m.identify_pain_confirmed && "Pain",
            !m.champion_confirmed && "Champion",
            !m.competition_confirmed && "Competition",
          ].filter(Boolean);
          let line = `- ${oppName}: ✅${confirmed.join(",")} | ❌${missing.join(",")}`;
          if (m.before_state_notes) line += ` before:${trunc(m.before_state_notes, 60)}`;
          if (m.after_state_notes) line += ` after:${trunc(m.after_state_notes, 60)}`;
          if (m.negative_consequences_notes) line += ` neg:${trunc(m.negative_consequences_notes, 60)}`;
          if (m.positive_business_outcomes_notes) line += ` pos:${trunc(m.positive_business_outcomes_notes, 60)}`;
          if (m.required_capabilities_notes) line += ` caps:${trunc(m.required_capabilities_notes, 60)}`;
          if (m.champion_notes) line += ` champ:${trunc(m.champion_notes, 60)}`;
          if (m.identify_pain_notes) line += ` pain:${trunc(m.identify_pain_notes, 60)}`;
          return line;
        }).join("\n")
      );
    }
  }

  // --- MEETING PREP CROSS-REFERENCING ---
  if (calendarRes.data?.length && accounts.length) {
    const meetingPreps: string[] = [];
    for (const event of calendarRes.data as any[]) {
      const titleLower = (event.title || "").toLowerCase();
      const matchedAccount = accounts.find((a: any) =>
        titleLower.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(titleLower.replace(/meeting|call|sync|check-in|review/gi, "").trim())
      );
      if (!matchedAccount) continue;

      const acctOpps = opps.filter((o: any) => o.account_id === matchedAccount.id);
      const acctContacts = contacts.filter((c: any) => c.account_id === matchedAccount.id);
      const acctTranscripts = transcripts.filter((t: any) => t.account_id === matchedAccount.id).slice(0, 3);
      const acctMethodology = methodologyData.filter((m: any) => acctOpps.some((o: any) => o.id === m.opportunity_id));

      let prep = `📋 MEETING PREP — ${event.title} (${new Date(event.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}):\n`;
      prep += `  Account: ${matchedAccount.name} [${matchedAccount.tier || "—"}] ${matchedAccount.industry || ""}\n`;

      if (acctOpps.length) {
        prep += `  Pipeline: ${acctOpps.map((o: any) => `${o.name} ${o.stage || "—"} $${Math.round((o.arr || 0) / 1000)}k close:${o.close_date || "TBD"}`).join("; ")}\n`;
      }

      if (acctMethodology.length) {
        for (const m of acctMethodology) {
          const missing = [
            !m.metrics_confirmed && "Metrics", !m.economic_buyer_confirmed && "EconBuyer",
            !m.decision_criteria_confirmed && "DecCriteria", !m.decision_process_confirmed && "DecProcess",
            !m.identify_pain_confirmed && "Pain", !m.champion_confirmed && "Champion",
            !m.competition_confirmed && "Competition",
          ].filter(Boolean);
          if (missing.length) prep += `  MEDDICC gaps: ${missing.join(", ")}\n`;
        }
      }

      if (acctContacts.length) {
        prep += `  Key contacts: ${acctContacts.slice(0, 5).map((c: any) => `${c.name}${c.title ? ` (${c.title})` : ""} ${c.buyer_role || ""}`).join("; ")}\n`;
      }

      if (acctTranscripts.length) {
        prep += `  Recent calls: ${acctTranscripts.map((t: any) => `${t.call_date}: ${t.title}${t.summary ? ` — ${trunc(t.summary, 80)}` : ""}`).join("; ")}\n`;
      }

      meetingPreps.push(prep);
    }
    if (meetingPreps.length) {
      sections.push(meetingPreps.join("\n"));
    }
  }

  // --- DEALS NEEDING ATTENTION ---
  if (opps.length) {
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const attentionItems: string[] = [];

    for (const o of opps as any[]) {
      if (o.status === "closed-won") continue;
      const methodology = methodologyData.find((m: any) => m.opportunity_id === o.id);
      const issues: string[] = [];

      if (methodology) {
        const gapCount = [
          !methodology.metrics_confirmed, !methodology.economic_buyer_confirmed,
          !methodology.decision_criteria_confirmed, !methodology.decision_process_confirmed,
          !methodology.identify_pain_confirmed, !methodology.champion_confirmed,
          !methodology.competition_confirmed,
        ].filter(Boolean).length;
        if (gapCount >= 3) issues.push(`${gapCount} MEDDICC gaps`);
      }

      if (o.close_date && o.close_date <= thirtyDaysFromNow && methodology) {
        const hasGaps = !methodology.champion_confirmed || !methodology.economic_buyer_confirmed || !methodology.identify_pain_confirmed;
        if (hasGaps) issues.push(`closes ${o.close_date} with critical gaps`);
      }

      const acct = accounts.find((a: any) => a.id === o.account_id);
      if (acct && acct.last_touch_date && acct.last_touch_date < fourteenDaysAgo) {
        issues.push(`no touch in 14+ days (last: ${acct.last_touch_date})`);
      }

      if (issues.length) {
        attentionItems.push(`- ${o.name} ($${Math.round((o.arr || 0) / 1000)}k): ${issues.join(", ")}`);
      }
    }

    // Also check renewals at risk
    if (renewalsRes.data?.length) {
      for (const r of renewalsRes.data as any[]) {
        if ((r.churn_risk === "high" || r.churn_risk === "certain") || r.health_status === "red") {
          attentionItems.push(`- RENEWAL: ${r.account_name} ($${Math.round((r.arr || 0) / 1000)}k) risk:${r.churn_risk} health:${r.health_status}`);
        }
      }
    }

    if (attentionItems.length) {
      sections.push("⚠️ DEALS NEEDING ATTENTION:\n" + attentionItems.join("\n"));
    }
  }

  return { sections, calendarCount, firstMeeting, overdueCount, pendingReminders, hasLastSession };
}

function trunc(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function buildFirstMessage(ctx: CrmContext, tzOffsetHours: number): string {
  const now = new Date();
  const hour = now.getUTCHours();
  const localHour = (hour - tzOffsetHours + 24) % 24;

  const lastSessionNote = ctx.hasLastSession ? " I remember our last conversation, so feel free to pick up where we left off." : "";

  if (localHour < 10) {
    const parts: string[] = ["Good morning — it's Dave. Here's your quick briefing:"];
    if (ctx.calendarCount) {
      parts.push(`You have ${ctx.calendarCount} meetings in the next 4 hours.`);
      if (ctx.firstMeeting) {
        parts.push(`First up: ${ctx.firstMeeting.title} at ${new Date(ctx.firstMeeting.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`);
      }
    }
    if (ctx.overdueCount) parts.push(`Heads up — you have ${ctx.overdueCount} overdue tasks.`);
    if (ctx.pendingReminders.length) parts.push(`Reminder: ${ctx.pendingReminders[0]}`);
    parts.push("What do you want to tackle first?" + lastSessionNote);
    return parts.join(" ");
  } else if (localHour >= 16) {
    return `Hey, it's Dave. Wrapping up the day? I can help with a debrief, update your pipeline, or prep for tomorrow. What do you need?${lastSessionNote}`;
  }

  if (ctx.calendarCount) {
    return `Hey, it's Dave. You've got ${ctx.calendarCount} meetings coming up — want me to prep you, or is there something else on your mind?${lastSessionNote}`;
  }
  return `Hey, it's Dave. I'm here whenever you need me — strategy, pipeline, prep, whatever you need.${lastSessionNote}`;
}
