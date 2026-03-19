import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const t0 = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const tzOffsetHours = body.tzOffsetHours ?? 0;

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

    const contextPromise = userId ? fetchCrmContext(supabase, userId) : Promise.resolve(null);

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
      contextString = crmContext.sections.join("\n\n");
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
}

async function fetchCrmContext(supabase: any, userId: string): Promise<CrmContext> {
  const now = new Date();
  const fourHoursLater = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const today = now.toISOString().split("T")[0];
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  // All 18 queries in parallel
  const [
    calendarRes, accountsRes, tasksRes, oppsRes, remindersRes,
    renewalsRes, contactsRes, resourcesRes, quotaRes, benchmarksRes,
    streakRes, transcriptsRes, gradesRes, battlePlanRes, journalRes,
    timeBlocksRes, methodologyRes,
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
      .select("name, next_step, last_touch_date, priority, account_status, tier, website, industry, motion, notes, tech_stack, icp_fit_score, outreach_status")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50),
    // 3. Tasks (expanded)
    supabase
      .from("tasks")
      .select("title, due_date, priority, status, account_name, notes")
      .eq("user_id", userId)
      .in("status", ["todo", "in_progress"])
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
      .select("title, resource_type, description, content, tags")
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
  ]);

  const sections: string[] = [];
  let calendarCount = 0;
  let firstMeeting: any = null;
  let overdueCount = 0;
  const pendingReminders: string[] = [];

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
  if (accountsRes.data?.length) {
    sections.push(
      `ACCOUNTS (${accountsRes.data.length}):\n` +
      accountsRes.data.map((a: any) =>
        `- ${a.name} [${a.tier || "—"}/${a.priority || "—"}] status:${a.account_status || "—"} motion:${a.motion || "—"}${a.industry ? ` ind:${a.industry}` : ""}${a.icp_fit_score ? ` icp:${a.icp_fit_score}` : ""}${a.next_step ? ` next:${a.next_step}` : ""}${a.notes ? ` notes:${trunc(a.notes, 80)}` : ""}`
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
  if (oppsRes.data?.length) {
    const opps = oppsRes.data as any[];
    const totalPipeline = opps.reduce((sum: number, o: any) => sum + (o.arr || 0), 0);
    sections.push(
      `PIPELINE (${opps.length} deals, $${Math.round(totalPipeline / 1000)}k total):\n` +
      opps.slice(0, 20).map((o: any) =>
        `- ${o.name}: ${o.stage || "—"} $${Math.round((o.arr || 0) / 1000)}k close:${o.close_date || "TBD"} type:${o.deal_type || "—"}${o.next_step ? ` → ${o.next_step}` : ""}${o.notes ? ` notes:${trunc(o.notes, 60)}` : ""}`
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
  if (contactsRes.data?.length) {
    sections.push(
      `CONTACTS (${contactsRes.data.length}):\n` +
      (contactsRes.data as any[]).slice(0, 30).map((c: any) =>
        `- ${c.name}${c.title ? ` (${c.title})` : ""} role:${c.buyer_role || "—"} influence:${c.influence_level || "—"} status:${c.status || "—"}${c.department ? ` dept:${c.department}` : ""}`
      ).join("\n")
    );
  }

  // --- Resources (battlecards, frameworks, methodology) ---
  if (resourcesRes.data?.length) {
    sections.push(
      `RESOURCES & FRAMEWORKS (${resourcesRes.data.length}):\n` +
      (resourcesRes.data as any[]).map((r: any) =>
        `- [${r.resource_type}] ${r.title}${r.tags?.length ? ` tags:${r.tags.join(",")}` : ""}${r.description ? ` — ${trunc(r.description, 100)}` : ""}${r.content ? `\n  CONTENT: ${trunc(r.content, 500)}` : ""}`
      ).join("\n")
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
  if (transcriptsRes.data?.length) {
    sections.push(
      `RECENT CALLS (${transcriptsRes.data.length}):\n` +
      (transcriptsRes.data as any[]).slice(0, 10).map((t: any) =>
        `- ${t.call_date}: ${t.title} [${t.call_type || "—"}]${t.summary ? ` — ${trunc(t.summary, 120)}` : ""}`
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
  if (methodologyRes.data?.length && oppsRes.data?.length) {
    const oppMap = new Map((oppsRes.data as any[]).map((o: any) => [o.id, o.name]));
    const methodRows = (methodologyRes.data as any[]).filter((m: any) => oppMap.has(m.opportunity_id));
    if (methodRows.length) {
      sections.push(
        `METHODOLOGY (MEDDICC/CotM) per deal:\n` +
        methodRows.slice(0, 10).map((m: any) => {
          const oppName = oppMap.get(m.opportunity_id) || m.opportunity_id;
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

  return { sections, calendarCount, firstMeeting, overdueCount, pendingReminders };
}

function trunc(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function buildFirstMessage(ctx: CrmContext, tzOffsetHours: number): string {
  const now = new Date();
  const hour = now.getUTCHours();
  const localHour = (hour - tzOffsetHours + 24) % 24;

  if (localHour < 10) {
    const parts: string[] = ["Good morning! Here's your quick briefing:"];
    if (ctx.calendarCount) {
      parts.push(`You have ${ctx.calendarCount} meetings in the next 4 hours.`);
      if (ctx.firstMeeting) {
        parts.push(`First up: ${ctx.firstMeeting.title} at ${new Date(ctx.firstMeeting.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`);
      }
    }
    if (ctx.overdueCount) parts.push(`Heads up — you have ${ctx.overdueCount} overdue tasks.`);
    if (ctx.pendingReminders.length) parts.push(`Reminder: ${ctx.pendingReminders[0]}`);
    parts.push("What do you want to tackle first?");
    return parts.join(" ");
  } else if (localHour >= 16) {
    return "Hey — wrapping up the day? I can help with a debrief, update your pipeline, or prep for tomorrow. What do you need?";
  }

  if (ctx.calendarCount) {
    return `Hey! You've got ${ctx.calendarCount} meetings coming up. Need help prepping, or is there something else on your mind?`;
  }
  return "Hey! I'm here whenever you need me. What can I help with?";
}
