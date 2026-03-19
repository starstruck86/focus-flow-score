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
    // Parse body once at the top
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

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let userId: string | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    // Run ElevenLabs token fetch AND CRM context queries in parallel
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

    // Build response
    let contextString = "";
    let firstMessage: string | null = null;

    if (crmContext) {
      contextString = crmContext.sections.join("\n\n");
      firstMessage = buildFirstMessage(crmContext, tzOffsetHours);
    }

    console.log(`dave-conversation-token completed in ${Date.now() - t0}ms`);

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

  const [calendarRes, accountsRes, tasksRes, oppsRes, remindersRes] = await Promise.all([
    supabase
      .from("calendar_events")
      .select("title, start_time, end_time, description, location")
      .eq("user_id", userId)
      .gte("start_time", now.toISOString())
      .lte("start_time", fourHoursLater.toISOString())
      .order("start_time")
      .limit(8),
    supabase
      .from("accounts")
      .select("name, next_step, last_touch_date, priority, account_status, tier")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(15),
    supabase
      .from("tasks")
      .select("title, due_date, priority, status, account_name")
      .eq("user_id", userId)
      .in("status", ["todo", "in_progress"])
      .order("due_date", { ascending: true })
      .limit(15),
    supabase
      .from("opportunities")
      .select("name, stage, arr, close_date, next_step")
      .eq("user_id", userId)
      .not("status", "eq", "closed-lost")
      .order("close_date", { ascending: true })
      .limit(20),
    supabase
      .from("voice_reminders")
      .select("id, message, remind_at")
      .eq("user_id", userId)
      .eq("delivered", false)
      .lte("remind_at", now.toISOString())
      .order("remind_at")
      .limit(5),
  ]);

  const sections: string[] = [];
  let calendarCount = 0;
  let firstMeeting: any = null;
  let overdueCount = 0;
  const pendingReminders: string[] = [];

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

  if (accountsRes.data?.length) {
    sections.push(
      "RECENT ACCOUNTS:\n" +
      accountsRes.data.map((a: any) =>
        `- ${a.name} [${a.tier || "—"}/${a.priority || "—"}] status:${a.account_status || "—"}${a.next_step ? ` next:${a.next_step}` : ""}`
      ).join("\n")
    );
  }

  if (tasksRes.data?.length) {
    const overdue = (tasksRes.data as any[]).filter((t: any) => t.due_date && t.due_date < today);
    const todayTasks = (tasksRes.data as any[]).filter((t: any) => t.due_date === today);
    const upcoming = (tasksRes.data as any[]).filter((t: any) => t.due_date && t.due_date > today);
    overdueCount = overdue.length;

    const lines: string[] = [];
    if (overdue.length) lines.push(`⚠️ ${overdue.length} OVERDUE: ${overdue.map((t: any) => t.title).join(", ")}`);
    if (todayTasks.length) lines.push(`Today: ${todayTasks.map((t: any) => t.title).join(", ")}`);
    if (upcoming.length) lines.push(`Upcoming: ${upcoming.slice(0, 5).map((t: any) => t.title).join(", ")}`);
    if (lines.length) sections.push("TASKS:\n" + lines.join("\n"));
  }

  if (oppsRes.data?.length) {
    const totalPipeline = (oppsRes.data as any[]).reduce((sum: number, o: any) => sum + (o.arr || 0), 0);
    sections.push(
      `PIPELINE (${oppsRes.data.length} deals, $${Math.round(totalPipeline / 1000)}k total):\n` +
      (oppsRes.data as any[]).slice(0, 10).map((o: any) =>
        `- ${o.name}: ${o.stage || "—"} $${Math.round((o.arr || 0) / 1000)}k close:${o.close_date || "TBD"}${o.next_step ? ` → ${o.next_step}` : ""}`
      ).join("\n")
    );
  }

  if (remindersRes.data?.length) {
    for (const r of remindersRes.data as any[]) {
      pendingReminders.push(r.message);
    }
    sections.push("PENDING REMINDERS:\n" + pendingReminders.map((m: string) => `- ${m}`).join("\n"));

    // Batch mark reminders as delivered
    const reminderIds = (remindersRes.data as any[]).map((r: any) => r.id);
    if (reminderIds.length) {
      await supabase
        .from("voice_reminders")
        .update({ delivered: true })
        .in("id", reminderIds);
    }
  }

  return { sections, calendarCount, firstMeeting, overdueCount, pendingReminders };
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

  // Midday greeting — always speak first so the user knows connection is live
  if (ctx.calendarCount) {
    return `Hey! You've got ${ctx.calendarCount} meetings coming up. Need help prepping, or is there something else on your mind?`;
  }
  return "Hey! I'm here whenever you need me. What can I help with?";
}
