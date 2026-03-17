import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EASTERN_TIMEZONE = "America/New_York";

function extractEasternTime(dateString: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(dateString));

  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function overlaps(a: { start_time: string; end_time: string }, b: { start_time: string; end_time: string }) {
  return toMinutes(a.start_time) < toMinutes(b.end_time) && toMinutes(b.start_time) < toMinutes(a.end_time);
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mergeLockedCalendarBlocks(
  aiBlocks: Array<Record<string, any>>,
  lockedBlocks: Array<Record<string, any>>,
) {
  const lockedKeys = new Set(
    lockedBlocks.map((block) => `${block.start_time}-${block.end_time}-${block.label.trim().toLowerCase()}`),
  );

  // Also build a set of normalized locked labels to catch duplicate meetings at wrong times
  const lockedLabelSet = new Set(lockedBlocks.map((block) => normalizeLabel(block.label)));

  const filteredAiBlocks = aiBlocks.filter((block) => {
    if (!block?.start_time || !block?.end_time || !block?.label) return false;

    const key = `${block.start_time}-${block.end_time}-${String(block.label).trim().toLowerCase()}`;
    if (lockedKeys.has(key)) return false;

    // Drop AI-generated meeting blocks that duplicate a locked meeting (same name, different time)
    if (block.type === "meeting" && lockedLabelSet.has(normalizeLabel(block.label))) return false;

    if (block.type === "meeting") {
      return !lockedBlocks.some((lockedBlock) => overlaps(block, lockedBlock));
    }

    return true;
  });

  return [...filteredAiBlocks, ...lockedBlocks].sort(
    (a, b) => toMinutes(a.start_time) - toMinutes(b.start_time),
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader! } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { date, confirmedScreenshotEvents } = await req.json();
    const targetDate = date || new Date().toISOString().split("T")[0];

    // Determine week boundaries (Mon-Fri) for the target date
    const targetDateObj = new Date(targetDate + 'T12:00:00');
    const dayOfWeek = targetDateObj.getDay(); // 0=Sun, 1=Mon, ...
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekMonday = new Date(targetDateObj);
    weekMonday.setDate(targetDateObj.getDate() + mondayOffset);
    const weekFriday = new Date(weekMonday);
    weekFriday.setDate(weekMonday.getDate() + 4);
    const weekMondayStr = weekMonday.toISOString().split('T')[0];
    const weekFridayStr = weekFriday.toISOString().split('T')[0];

    // Gather context in parallel
    const [
      calendarRes,
      journalRes,
      workQueueRes,
      feedbackRes,
      quotaRes,
      prevPlansRes,
      oppsRes,
      renewalsRes,
      tasksRes,
      prefsRes,
      weekJournalRes,
      weekCalendarRes,
      battlePlanRes,
    ] = await Promise.all([
      // Convert EST day boundaries to UTC for correct timezone filtering
      (() => {
        const d = new Date(targetDate + 'T00:00:00');
        const month = d.getMonth();
        const offsetHours = (month >= 2 && month <= 10) ? 4 : 5;
        const dayStartUTC = new Date(d.getTime() + offsetHours * 60 * 60 * 1000).toISOString();
        const dayEndUTC = new Date(d.getTime() + offsetHours * 60 * 60 * 1000 + 24 * 60 * 60 * 1000 - 1000).toISOString();
        return supabase.from("calendar_events").select("*")
          .gte("start_time", dayStartUTC)
          .lte("start_time", dayEndUTC)
          .order("start_time");
      })(),
      supabase.from("daily_journal_entries").select("*")
        .eq("date", targetDate).maybeSingle(),
      supabase.from("accounts").select("id, name, tier, account_status, last_touch_date, cadence_name, contact_status, motion")
        .in("account_status", ["active", "prepped", "researching"])
        .order("priority_score", { ascending: false }).limit(15),
      supabase.from("ai_feedback").select("*")
        .eq("feature", "time_blocks")
        .order("created_at", { ascending: false }).limit(10),
      supabase.from("quota_targets").select("*").maybeSingle(),
      supabase.from("daily_time_blocks").select("blocks, block_feedback, feedback_rating, feedback_text, plan_date")
        .order("plan_date", { ascending: false }).limit(3),
      supabase.from("opportunities").select("id, name, stage, status, arr, close_date, next_step, next_step_date, deal_type, account_id")
        .in("status", ["active", "stalled"])
        .order("close_date", { ascending: true }).limit(20),
      supabase.from("renewals").select("id, account_name, arr, renewal_due, next_step, health_status, churn_risk")
        .order("renewal_due", { ascending: true }).limit(15),
      supabase.from("tasks").select("id, title, priority, due_date, motion, category, status")
        .in("status", ["next", "in-progress"])
        .order("due_date", { ascending: true }).limit(20),
      supabase.from("daily_plan_preferences").select("*").maybeSingle(),
      // This week's journal entries (to know what's already been done)
      supabase.from("daily_journal_entries").select("date, dials, conversations, meetings_set, opportunities_created, daily_score")
        .gte("date", weekMondayStr)
        .lte("date", weekFridayStr)
        .order("date"),
      // Rest of week calendar (to understand meeting load distribution)
      (() => {
        const d = new Date(weekMondayStr + 'T00:00:00');
        const month = d.getMonth();
        const offsetHours = (month >= 2 && month <= 10) ? 4 : 5;
        const weekStartUTC = new Date(d.getTime() + offsetHours * 60 * 60 * 1000).toISOString();
        const fridayEnd = new Date(weekFriday.getTime() + offsetHours * 60 * 60 * 1000 + 24 * 60 * 60 * 1000 - 1000).toISOString();
        return supabase.from("calendar_events").select("start_time, end_time, all_day, title")
          .gte("start_time", weekStartUTC)
          .lte("start_time", fridayEnd)
          .order("start_time");
      })(),
      // Weekly battle plan
      supabase.from("weekly_battle_plans").select("*")
        .gte("week_start", weekMondayStr)
        .lte("week_start", weekFridayStr)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const events = calendarRes.data || [];
    const recentFeedback = feedbackRes.data || [];
    const topAccounts = workQueueRes.data || [];
    const userPrefs = prefsRes.data as any;

    // Calculate meeting load and build locked meeting anchors
    const meetings = events.filter((e: any) => !e.all_day && e.end_time);
    const meetingMinutes = meetings.reduce((sum: number, e: any) => {
      const start = new Date(e.start_time).getTime();
      const end = new Date(e.end_time).getTime();
      return sum + Math.max(0, (end - start) / 60000);
    }, 0);
    const meetingHours = Math.round(meetingMinutes / 60 * 10) / 10;
    const focusHoursAvailable = Math.max(0, 8 - meetingHours);

    const baseLockedCalendarBlocks = meetings.map((event: any) => ({
      start_time: extractEasternTime(event.start_time),
      end_time: extractEasternTime(event.end_time),
      label: event.title,
      type: "meeting",
      workstream: "general",
      goals: [`Attend ${event.title}`],
      reasoning: "Fixed calendar meeting — this time is locked.",
    }));

    const screenshotMeetingBlocks = Array.isArray(confirmedScreenshotEvents)
      ? confirmedScreenshotEvents
          .filter((event: any) => event.category === "work_meeting")
          .map((event: any) => ({
            start_time: event.start_time,
            end_time: event.end_time,
            label: event.title,
            type: "meeting",
            workstream: "general",
            goals: [`Attend ${event.title}`],
            reasoning: "Screenshot-confirmed meeting — this time is locked.",
          }))
      : [];

    const lockedCalendarBlocks = screenshotMeetingBlocks.length > 0
      ? mergeLockedCalendarBlocks(baseLockedCalendarBlocks, screenshotMeetingBlocks)
      : baseLockedCalendarBlocks;

    // Build feedback context (day-level + block-level)
    const prevPlans = prevPlansRes.data || [];
    let feedbackContext = "";
    if (recentFeedback.length > 0) {
      feedbackContext += `\n\nRECENT USER FEEDBACK ON TIME BLOCKS (learn from this - adjust accordingly):\n${recentFeedback.map((f: any) =>
        `- Date: ${f.context_date}, Rating: ${f.rating}/5, Feedback: "${f.feedback_text}"`
      ).join("\n")}`;
    }
    const plansWithBlockFb = prevPlans.filter((p: any) => p.block_feedback?.length > 0);
    if (plansWithBlockFb.length > 0) {
      feedbackContext += `\n\nBLOCK-LEVEL FEEDBACK (thumbs up/down on specific blocks):\n`;
      plansWithBlockFb.forEach((p: any) => {
        const blocks = p.blocks || [];
        (p.block_feedback || []).forEach((fb: any) => {
          const block = blocks[fb.blockIdx];
          if (block) {
            feedbackContext += `- ${p.plan_date}: "${block.label}" (${block.type}) got 👎${fb.thumbs === 'down' ? ' DISLIKED' : ' 👍 LIKED'}\n`;
          }
        });
      });
    }

    // Build personal context from screenshot-confirmed events
    let screenshotContext = "";
    if (Array.isArray(confirmedScreenshotEvents) && confirmedScreenshotEvents.length > 0) {
      const personalBlocks = confirmedScreenshotEvents.filter((e: any) => e.is_personal_block);

      if (personalBlocks.length > 0) {
        screenshotContext += `\n\nPERSONAL/FAMILY COMMITMENTS (MUST block these times — DO NOT schedule work during these):\n`;
        screenshotContext += personalBlocks.map((e: any) =>
          `- ${e.start_time}–${e.end_time}: ${e.title}${e.family_member ? ` (${e.family_member})` : ''}${e.notes ? ` — ${e.notes}` : ''}`
        ).join('\n');
      }
    }

    const calendarContext = lockedCalendarBlocks.length > 0
      ? lockedCalendarBlocks.map((block: any) => {
          const dur = toMinutes(block.end_time) - toMinutes(block.start_time);
          return `- ${block.start_time}–${block.end_time} EST (${dur}min): ${block.label}`;
        }).join("\n")
      : "No meetings scheduled today.";

    // Extract user preferences EARLY (needed for weekly context math below)
    const workStart = userPrefs?.work_start_time?.slice(0, 5) || '09:00';
    const workEnd = userPrefs?.work_end_time?.slice(0, 5) || '17:00';
    const noMeetingsBefore = userPrefs?.no_meetings_before?.slice(0, 5) || workStart;
    const noMeetingsAfter = userPrefs?.no_meetings_after?.slice(0, 5) || workEnd;
    const minBlockMin = userPrefs?.min_block_minutes || 25;
    const preferNewLogoMorning = userPrefs?.prefer_new_logo_morning !== false;
    const maxBackToBack = userPrefs?.max_back_to_back_meetings || 3;
    const personalRules: string[] = Array.isArray(userPrefs?.personal_rules) ? userPrefs.personal_rules : [];

    // Quota targets context
    const targets = quotaRes.data;
    const weeklyDialTarget = (targets?.target_dials_per_day || 60) * 5; // e.g., 300/week
    const weeklyConnectsTarget = (targets?.target_connects_per_day || 6) * 5;

    // Build weekly context: what's been done + what's left
    const weekJournals = weekJournalRes.data || [];
    const weekCalEvents = weekCalendarRes.data || [];
    const battlePlan = battlePlanRes.data;

    const weekDialsSoFar = weekJournals.reduce((sum: number, j: any) => sum + (j.dials || 0), 0);
    const weekConvosSoFar = weekJournals.reduce((sum: number, j: any) => sum + (j.conversations || 0), 0);
    const weekMeetingsSetSoFar = weekJournals.reduce((sum: number, j: any) => sum + (j.meetings_set || 0), 0);
    const daysLoggedThisWeek = weekJournals.filter((j: any) => j.date < targetDate).length;

    // Calculate meeting load per day for rest of week
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekDayMeetingMinutes: Record<string, number> = {};
    weekCalEvents.forEach((evt: any) => {
      if (evt.all_day || !evt.end_time) return;
      const evtDate = new Date(evt.start_time);
      const dateStr = evtDate.toISOString().split('T')[0];
      const dur = Math.max(0, (new Date(evt.end_time).getTime() - evtDate.getTime()) / 60000);
      weekDayMeetingMinutes[dateStr] = (weekDayMeetingMinutes[dateStr] || 0) + dur;
    });

    // Determine remaining workdays this week (including today)
    const remainingDays: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekMonday);
      d.setDate(weekMonday.getDate() + i);
      const ds = d.toISOString().split('T')[0];
      if (ds >= targetDate) remainingDays.push(ds);
    }

    const remainingDialsNeeded = Math.max(0, weeklyDialTarget - weekDialsSoFar);
    const remainingDaysCount = remainingDays.length || 1;

    // Calculate today's adjusted target based on meeting load relative to other days
    const todayMeetingMin = weekDayMeetingMinutes[targetDate] || 0;
    const totalWorkMinPerDay = toMinutes(workEnd) - toMinutes(workStart);
    const todayFocusMin = Math.max(0, totalWorkMinPerDay - todayMeetingMin);

    // Distribute remaining dials weighted by available focus time
    const remainingDaysFocus = remainingDays.map(d => ({
      date: d,
      focusMin: Math.max(0, totalWorkMinPerDay - (weekDayMeetingMinutes[d] || 0)),
    }));
    const totalRemainingFocusMin = remainingDaysFocus.reduce((s, d) => s + d.focusMin, 0) || 1;
    const todayDialTarget = Math.round(remainingDialsNeeded * (todayFocusMin / totalRemainingFocusMin));
    const todayConvoTarget = Math.round((weeklyConnectsTarget - weekConvosSoFar) * (todayFocusMin / totalRemainingFocusMin));

    const weeklyContext = `
WEEKLY CONTEXT (this day fits into a bigger picture):
- Week: ${weekMondayStr} to ${weekFridayStr}
- Weekly targets: ${weeklyDialTarget} dials, ${weeklyConnectsTarget} connects, ${targets?.target_meetings_set_per_week || 3} meetings set
- Progress so far this week (${daysLoggedThisWeek} days logged): ${weekDialsSoFar} dials, ${weekConvosSoFar} convos, ${weekMeetingsSetSoFar} meetings set
- Remaining needed: ${remainingDialsNeeded} dials across ${remainingDaysCount} remaining days
- TODAY'S ADJUSTED TARGETS (based on available focus time vs rest of week): ~${todayDialTarget} dials, ~${Math.max(1, todayConvoTarget)} convos
- Today's meeting load: ${Math.round(todayMeetingMin / 60 * 10) / 10}h — ${todayMeetingMin > 180 ? 'HEAVY meeting day, lower activity targets are expected' : todayMeetingMin > 90 ? 'moderate meeting day' : 'light meeting day — push hard on dials'}
${remainingDays.map(d => `  ${dayNames[new Date(d + 'T12:00:00').getDay()]}: ${Math.round((weekDayMeetingMinutes[d] || 0) / 60 * 10) / 10}h meetings`).join('\n')}
${battlePlan?.strategy_summary ? `\nWEEKLY BATTLE PLAN STRATEGY:\n${battlePlan.strategy_summary}` : ''}
${battlePlan?.moves?.length ? `\nTOP WEEKLY MOVES:\n${(battlePlan.moves as any[]).slice(0, 5).map((m: any) => `- ${m.action || m.title || m.description}`).join('\n')}` : ''}`;

    const quotaContext = targets
      ? `WEEKLY targets: ${weeklyDialTarget} dials, ${weeklyConnectsTarget} connects. TODAY'S adjusted targets: ${todayDialTarget} dials, ${Math.max(1, todayConvoTarget)} convos, ${targets.target_accounts_researched_per_day} accounts researched, ${targets.target_contacts_prepped_per_day} contacts prepped.`
      : `Default weekly targets: 300 dials, 30 connects. Adjust daily based on meeting load.`;

    // Build pipeline context
    const activeOpps = oppsRes.data || [];
    const renewals = renewalsRes.data || [];
    const activeTasks = tasksRes.data || [];

    // Identify ALL accounts that have ANY active opportunity (new logo OR renewal)
    const allOppAccountIds = new Set(activeOpps.map((o: any) => o.account_id).filter(Boolean));
    // Also identify accounts linked to upcoming renewals
    const allRenewalAccountNames = new Set(renewals.map((r: any) => r.account_name?.toLowerCase()).filter(Boolean));

    const newLogoOpps = activeOpps.filter((o: any) => o.deal_type !== 'renewal');
    const renewalOpps = activeOpps.filter((o: any) => o.deal_type === 'renewal');

    const newLogoTasks = activeTasks.filter((t: any) => t.motion !== 'renewal');
    const renewalTasks = activeTasks.filter((t: any) => t.motion === 'renewal');

    // PURE prospecting accounts: no active opp AND not a renewal/current customer account
    const prospectingAccounts = topAccounts.filter((a: any) => {
      if (allOppAccountIds.has(a.id)) return false; // Has an active opp — not prospecting
      if (a.motion === 'renewal') return false; // Renewal motion — not prospecting
      if (allRenewalAccountNames.has(a.name?.toLowerCase())) return false; // Has a renewal — current customer
      return true;
    });

    const pipelineContext = `
NEW LOGO PROSPECTING ACCOUNTS (NO active opportunity, NOT current customers — these need Prep→Call Blitz cycles):
${prospectingAccounts.slice(0, 8).map((a: any) => `- ${a.name} (Tier ${a.tier}, ${a.account_status}, cadence: ${a.cadence_name || 'none'})`).join('\n') || '(none)'}

ACTIVE NEW LOGO OPPORTUNITIES (TASK & MEETING oriented — NOT research/cadence work):
${newLogoOpps.slice(0, 8).map((o: any) => `- ${o.name}: ${o.stage}, $${o.arr || 0}, close ${o.close_date || 'TBD'}, next step: ${o.next_step || 'none'}${o.next_step_date ? ` (due ${o.next_step_date})` : ''}`).join('\n') || '(none)'}

RENEWAL COUNT: ${renewals.length} upcoming renewals (user manages these independently — do NOT list specific accounts)

OPEN TASKS:
New Logo: ${newLogoTasks.slice(0, 5).map((t: any) => `${t.title} (${t.priority})`).join(', ') || '(none)'}
Renewal: ${renewalTasks.slice(0, 5).map((t: any) => `${t.title} (${t.priority})`).join(', ') || '(none)'}`;

    // Build user preferences context
    const workStart = userPrefs?.work_start_time?.slice(0, 5) || '09:00';
    const workEnd = userPrefs?.work_end_time?.slice(0, 5) || '17:00';
    const noMeetingsBefore = userPrefs?.no_meetings_before?.slice(0, 5) || workStart;
    const noMeetingsAfter = userPrefs?.no_meetings_after?.slice(0, 5) || workEnd;
    const lunchStart = userPrefs?.lunch_start?.slice(0, 5) || '12:00';
    const lunchEnd = userPrefs?.lunch_end?.slice(0, 5) || '13:00';
    const minBlockMin = userPrefs?.min_block_minutes || 25;
    const preferNewLogoMorning = userPrefs?.prefer_new_logo_morning !== false;
    const maxBackToBack = userPrefs?.max_back_to_back_meetings || 3;
    const personalRules: string[] = Array.isArray(userPrefs?.personal_rules) ? userPrefs.personal_rules : [];

    let prefsContext = `\n\nUSER SCHEDULING PREFERENCES (MUST FOLLOW — these override default rules):
- Working hours: ${workStart} to ${workEnd} EST. ABSOLUTELY NO work or meeting blocks outside these hours.
- No meetings before ${noMeetingsBefore} EST or after ${noMeetingsAfter} EST.
- NO lunch break blocks. Do NOT schedule lunch, break, or downtime blocks. Use that time for Prep→Call Blitz cycles instead.
- Minimum block duration: ${minBlockMin} minutes. No shorter blocks.
- Max back-to-back meetings: ${maxBackToBack}. Insert breaks if needed.
- Workstream strategy: ${preferNewLogoMorning ? 'New logo work in the morning, renewal work in the afternoon' : 'No specific morning/afternoon workstream preference'}.`;

    if (personalRules.length > 0) {
      prefsContext += `\n\nPERSONAL RULES (user-defined, MUST be respected):`;
      personalRules.forEach((rule, i) => {
        prefsContext += `\n${i + 1}. ${rule}`;
      });
    }

    const prompt = `You are an elite sales time management coach for a B2B SaaS account executive. The PRIMARY GOAL of each day is to maximize time spent on NEW LOGO prospecting — the work required to create more new logo opportunities. Everything else is secondary.

THIS DAY IS PART OF A WEEKLY PLAN. Today's targets are ADJUSTED based on meeting load and what's already been accomplished this week. On heavy meeting days, lower dial targets are expected — but lighter days should compensate. The weekly target MUST be hit across all 5 days combined.
${prefsContext}

${weeklyContext}

CRITICAL RULES:
1. NO time blocks shorter than ${minBlockMin} minutes.
2. NEW LOGO IS THE PRIORITY. Use TODAY'S ADJUSTED TARGETS (from weekly context above) — NOT the raw daily averages. Schedule enough Prep→Call Blitz cycles to hit TODAY'S target.
3. Use "workstream" field to tag each block as "new_logo" or "renewal" or "general"
4. Goals must be REALISTIC and ACHIEVABLE. Use these realistic pacing rates:
   - DIAL RATE: ~15 dials per 30 minutes (1 dial every 2 min including voicemail/notes). A 45-min Call Blitz = ~22 dials. A 60-min blitz = ~30 dials.
   - PREP RATE: 2-3 accounts per 25-30 min prep block
   - Do the math: if today's target is ${todayDialTarget} dials, you need ~${Math.ceil(todayDialTarget / 25)} Call Blitz blocks of 45-50 min each
5. ${preferNewLogoMorning ? 'Account for energy patterns: deep prospecting/new logo work in the morning, renewal tasks in the afternoon' : 'Distribute new logo and renewal work based on meeting gaps'}
6. Include buffer time around meetings (5-10 min)
7. If feedback says past suggestions were unrealistic, SIGNIFICANTLY dial back goals
8. DO NOT schedule an EOD wrap-up or journal block. The user handles reflection during their morning check-in the next day.
9. DO NOT schedule lunch breaks, mid-morning breaks, or mid-afternoon breaks. Every available minute should be Prep→Call Blitz or meeting prep.
10. NAME SPECIFIC ACCOUNTS in Prep and Call Blitz block goals (from prospecting list only)
11. PERSONAL/FAMILY blocks are NON-NEGOTIABLE — the user has children (Quinn, Emmett). School drop-offs, pickups, and activities MUST be respected.
12. If screenshot-confirmed meetings differ from calendar DB, TRUST the screenshot.
13. CALENDAR MEETINGS ARE FIXED ANCHORS. Do NOT generate your own meeting blocks — they are provided as locked blocks and merged automatically.
14. DO NOT duplicate a meeting that already exists.
15. DO NOT schedule ANY blocks before ${workStart} or after ${workEnd}. This is a HARD boundary.
16. ONLY use accounts from the NEW LOGO PROSPECTING list in Prep→Execute cycles. Current customers are NOT prospecting targets.
17. CONSOLIDATE all non-prospecting admin work (pipeline opp tasks, renewal tasks, email, CRM updates) into ONE short "Admin & Pipeline Tasks" block (30 min max). New Logo Prep and Call Blitz blocks are NOT admin.
18. Internal meetings like "Deal Desk" are OPTIONAL — do not treat them as locked anchors. Only external customer/prospect meetings are mandatory.

WORKSTREAM WORKFLOW DIFFERENCES (CRITICAL):

**NEW LOGO PROSPECTING — THIS IS THE CORE OF THE DAY:**
- This is research + cadence + cold outreach work — high-energy hunter mode
- Use PREP → EXECUTE paired cycles:
  - "Prep" block (type: "prep", 25-35 min): Research 2-3 specific accounts, review contacts, build call notes
  - Immediately followed by "Call Blitz" block (type: "prospecting", 45-60 min): Dial into those prepped accounts
  - Label prep blocks like: "Account Prep (Tessitura, Privy)"
  - Label execute blocks like: "Call Blitz #1 (~22 dials)" — use realistic math: 45min ≈ 22 dials, 60min ≈ 30 dials
  - Each Prep block must be immediately followed by its Call Blitz — no gaps between a specific pair
  - BUT it's fine to have MULTIPLE separate Prep→Blitz cycles throughout the day, split around meetings (e.g., Prep→Blitz #1 in the morning, meeting, Prep→Blitz #2 after)
- Schedule enough cycles to hit TODAY'S ADJUSTED dial target (from weekly context), NOT the raw daily average
- Fill ALL available non-meeting time with new logo Prep→Execute cycles

**ACTIVE NEW LOGO OPPORTUNITIES (deals already in pipeline):**
- TASK-ORIENTED and MEETING-DRIVEN only — NOT research/cadence work
- Do NOT give these their own time block unless there is a specific urgent task
- Roll any pipeline tasks into the single "Admin & Pipeline Tasks" block

**RENEWALS — EXACTLY 30 MINUTES, ONCE PER DAY:**
- Schedule ONE "Renewal Review" block, exactly 30 minutes, in the afternoon
- Purpose: look closer at 1-2 customer accounts with upcoming renewals
- Goals: "Review 1-2 upcoming renewal accounts" and "Work through renewal task queue" — keep it generic
- DO NOT name specific renewal accounts, opportunities, or tasks
- DO NOT create any other renewal blocks. All other renewal work happens in meetings or the admin block
- This is the ONLY non-prospecting, non-admin block allowed

**MEETING PREP (for any upcoming customer/prospect meeting):**
- If there's a customer meeting today, schedule a short prep block (type: "prep") 30-60 min before it
- Goals: review account history, prep talking points, check latest activity

LOCKED CALENDAR MEETINGS (EXACT EST TIMES):
${calendarContext}
${screenshotContext}

MEETING LOAD: ${meetingHours}h of meetings, ${focusHoursAvailable}h available for focused work

${quotaContext}

${pipelineContext}

${journalRes.data ? `TODAY'S JOURNAL SO FAR: ${journalRes.data.dials || 0} dials, ${journalRes.data.conversations || 0} conversations, ${journalRes.data.meetings_set || 0} meetings set` : "No journal entry yet today."}

${feedbackContext}

Generate a daily time-blocked schedule. For each block provide:
- start_time (HH:MM in 24h EST)
- end_time (HH:MM in 24h EST)
- label (short title, 3-5 words)
- type: one of "prospecting", "meeting", "research", "admin", "break", "pipeline", "prep"
- workstream: "new_logo" or "renewal" or "general"
- goals: array of 1-3 specific, realistic goals for that block (NAME ACCOUNTS for new logo prospecting blocks only — NOT for renewal blocks)
- reasoning: one sentence on why this block matters

Also provide an overall "day_strategy" (2-3 sentences: how today fits into the weekly plan, what makes today different from other days this week) and "key_metric_targets" object with TODAY'S ADJUSTED targets (not raw daily averages).`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a sales productivity coach. Return structured data via the tool call." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "create_daily_plan",
            description: "Create a daily time-blocked plan",
            parameters: {
              type: "object",
              properties: {
                day_strategy: { type: "string", description: "2-3 sentence overview of the day's approach" },
                blocks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      start_time: { type: "string", description: "HH:MM in 24h format" },
                      end_time: { type: "string", description: "HH:MM in 24h format" },
                      label: { type: "string" },
                      type: { type: "string", enum: ["prospecting", "meeting", "research", "admin", "break", "pipeline", "prep"] },
                      workstream: { type: "string", enum: ["new_logo", "renewal", "general"], description: "Which workstream this block belongs to" },
                      goals: { type: "array", items: { type: "string" } },
                      reasoning: { type: "string" },
                    },
                    required: ["start_time", "end_time", "label", "type", "workstream", "goals", "reasoning"],
                    additionalProperties: false,
                  },
                },
                key_metric_targets: {
                  type: "object",
                  properties: {
                    dials: { type: "number" },
                    conversations: { type: "number" },
                    accounts_researched: { type: "number" },
                    contacts_prepped: { type: "number" },
                  },
                  additionalProperties: false,
                },
              },
              required: ["day_strategy", "blocks", "key_metric_targets"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "create_daily_plan" } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

    const plan = JSON.parse(toolCall.function.arguments);
    const mergedBlocks = mergeLockedCalendarBlocks(plan.blocks || [], lockedCalendarBlocks);

    // Upsert the plan with all data persisted
    const { data: saved, error: saveError } = await supabase
      .from("daily_time_blocks")
      .upsert({
        user_id: user.id,
        plan_date: targetDate,
        blocks: mergedBlocks,
        meeting_load_hours: meetingHours,
        focus_hours_available: focusHoursAvailable,
        ai_reasoning: plan.day_strategy,
        key_metric_targets: plan.key_metric_targets || {},
        completed_goals: [],
        block_feedback: [],
      }, { onConflict: "user_id,plan_date" })
      .select()
      .single();

    if (saveError) throw saveError;

    return new Response(JSON.stringify(saved), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-time-blocks error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
