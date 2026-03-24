import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EASTERN_TIMEZONE = "America/New_York";

function normalizeStageLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function blockSignature(blocks: Array<Record<string, any>>) {
  return blocks
    .map((block) => `${block.start_time}-${block.end_time}-${normalizeStageLabel(String(block.label || ''))}-${block.type || 'unknown'}`)
    .join('|');
}

function summarizePlanDelta(beforeBlocks: Array<Record<string, any>>, afterBlocks: Array<Record<string, any>>) {
  if (!beforeBlocks.length && afterBlocks.length) return `created ${afterBlocks.length} blocks`;
  if (blockSignature(beforeBlocks) === blockSignature(afterBlocks)) return 'plan unchanged';

  const before = new Set(beforeBlocks.map((block) => `${block.start_time}-${block.end_time}-${normalizeStageLabel(String(block.label || ''))}-${block.type || 'unknown'}`));
  const after = new Set(afterBlocks.map((block) => `${block.start_time}-${block.end_time}-${normalizeStageLabel(String(block.label || ''))}-${block.type || 'unknown'}`));

  let changed = 0;
  for (const key of after) if (!before.has(key)) changed += 1;
  if (!changed) {
    for (const key of before) if (!after.has(key)) changed += 1;
  }
  return changed > 0 ? `${changed} block${changed === 1 ? '' : 's'} changed` : 'plan updated';
}

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
    const traceId = req.headers.get("x-trace-id") || crypto.randomUUID().slice(0, 8);
    const stages: Array<{ stage: string; detail: string; at: string }> = [];
    const logStage = (stage: string, detail: string, extra?: Record<string, unknown>) => {
      const entry = { stage, detail, at: new Date().toISOString() };
      stages.push(entry);
      console.info(JSON.stringify({ traceId, ...entry, ...(extra || {}) }));
    };

    logStage("request_received", "generate-time-blocks request received");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Support service-role calls (from scheduled function) with x-supabase-user-id header
    const impersonatedUserId = req.headers.get("x-supabase-user-id");
    const isServiceRole = authHeader?.includes(serviceRoleKey);

    let userId: string;

    if (isServiceRole && impersonatedUserId) {
      // Scheduled call — use the impersonated user ID and service role client
      userId = impersonatedUserId;
    } else {
      // Normal user call
      const supabase = createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Authorization: authHeader! } },
      });
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    // Use service role client for all DB operations (works for both paths)
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { date, confirmedScreenshotEvents, rebuildContext } = await req.json();
    const targetDate = date || new Date().toISOString().split("T")[0];
    const requestSource = rebuildContext?.source || "generate";
    logStage("request_parsed", `request parsed for ${requestSource}`, {
      dismissedCount: Array.isArray(rebuildContext?.dismissed_blocks) ? rebuildContext.dismissed_blocks.length : 0,
      linkedCount: Array.isArray(rebuildContext?.linked_opportunities) ? rebuildContext.linked_opportunities.length : 0,
    });

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
    // Helper: get UTC boundaries for a local ET day using proper Intl timezone conversion
    function getEasternDayBoundsUTC(dateStr: string): { start: string; end: string } {
      // Create wall-clock midnight and end-of-day in ET, then convert to UTC
      const [y, m, d] = dateStr.split('-').map(Number);
      
      // Use Intl to find the actual UTC offset for this specific date (handles DST correctly)
      const midnightET = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // noon UTC as reference
      const etParts = new Intl.DateTimeFormat('en-US', {
        timeZone: EASTERN_TIMEZONE,
        timeZoneName: 'shortOffset',
      }).formatToParts(midnightET);
      const offsetLabel = etParts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT-5';
      const offsetMatch = offsetLabel.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/i);
      const offsetHours = offsetMatch ? -parseInt(offsetMatch[1], 10) : 5;
      
      // midnight ET in UTC = midnight + offset hours
      const dayStartUTC = new Date(Date.UTC(y, m - 1, d, offsetHours, 0, 0)).toISOString();
      const dayEndUTC = new Date(Date.UTC(y, m - 1, d, offsetHours + 24, 0, 0) - 1000).toISOString();
      return { start: dayStartUTC, end: dayEndUTC };
    }

    const todayBounds = getEasternDayBoundsUTC(targetDate);

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
      supabase.from("calendar_events").select("*")
        .gte("start_time", todayBounds.start)
        .lte("start_time", todayBounds.end)
        .order("start_time"),
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
        const weekStartBounds = getEasternDayBoundsUTC(weekMondayStr);
        const weekEndBounds = getEasternDayBoundsUTC(weekFridayStr);
        return supabase.from("calendar_events").select("start_time, end_time, all_day, title")
          .gte("start_time", weekStartBounds.start)
          .lte("start_time", weekEndBounds.end)
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

    const dismissedMeetingKeys = new Set(
      (Array.isArray(rebuildContext?.dismissed_blocks) ? rebuildContext.dismissed_blocks : [])
        .filter((block: any) => block?.type === 'meeting')
        .map((block: any) => `${block.start_time}-${block.end_time}-${normalizeStageLabel(String(block.label || ''))}`),
    );

    const activeLockedCalendarBlocks = lockedCalendarBlocks.filter((block: any) => {
      const key = `${block.start_time}-${block.end_time}-${normalizeStageLabel(String(block.label || ''))}`;
      return !dismissedMeetingKeys.has(key);
    });

    logStage("request_context_ready", "calendar context prepared", {
      lockedMeetings: activeLockedCalendarBlocks.length,
      dismissedMeetingsApplied: dismissedMeetingKeys.size,
    });

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

    const calendarContext = activeLockedCalendarBlocks.length > 0
      ? activeLockedCalendarBlocks.map((block: any) => {
          const dur = toMinutes(block.end_time) - toMinutes(block.start_time);
          return `- ${block.start_time}–${block.end_time} EST (${dur}min): ${block.label}`;
        }).join("\n")
      : "No meetings scheduled today.";

    // Extract user preferences EARLY (needed for weekly context math below)
    const workStart = userPrefs?.work_start_time?.slice(0, 5) || '09:00';
    const workEnd = userPrefs?.work_end_time?.slice(0, 5) || '17:00';
    const noMeetingsBefore = userPrefs?.no_meetings_before?.slice(0, 5) || workStart;
    const noMeetingsAfter = userPrefs?.no_meetings_after?.slice(0, 5) || workEnd;
    const minBlockMin = Math.max(userPrefs?.min_block_minutes || 30, 30);
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

    // Build user preferences context (variables already extracted above)

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

    const rebuildContextText = requestSource !== 'generate'
      ? `\n\nMANUAL REBUILD CONTEXT:
- Source: ${requestSource}
- Dismissed meetings already removed from the working schedule: ${dismissedMeetingKeys.size}
- Linked opportunity hints: ${Array.isArray(rebuildContext?.linked_opportunities) && rebuildContext.linked_opportunities.length > 0
          ? rebuildContext.linked_opportunities.map((item: any) => `${item.block_label || 'block'} → ${item.opportunity_name}`).join('; ')
          : 'none'}
- Current visible plan before rebuild: ${Array.isArray(rebuildContext?.current_visible_blocks) && rebuildContext.current_visible_blocks.length > 0
          ? rebuildContext.current_visible_blocks.map((block: any) => `${block.start_time}-${block.end_time} ${block.label}`).join(' | ')
          : 'none'}
- This rebuild MUST materially change the plan when meetings were dismissed or priorities changed.`
      : '';

    const prompt = `You are an elite sales time management coach for a B2B SaaS account executive. The PRIMARY GOAL of each day is to maximize time spent on NEW LOGO prospecting — the work required to create more new logo opportunities. Everything else is secondary.

THIS DAY IS PART OF A WEEKLY PLAN. Today's targets are ADJUSTED based on meeting load and what's already been accomplished this week. On heavy meeting days, lower dial targets are expected — but lighter days should compensate. The weekly target MUST be hit across all 5 days combined.
${prefsContext}

${weeklyContext}

CRITICAL RULES:
0. TASK DEPENDENCY ORDER (NON-NEGOTIABLE): For new logo work, blocks MUST follow this sequence: Account Research/Build → Contact Sourcing/Admin → Outreach (calls/emails). NEVER schedule a Call Blitz or Email Blitz unless a Build or Admin block has been completed first. If no prep exists, INSERT a 30-60 min Admin block for research, contact sourcing, and cadence loading BEFORE any outreach.
1. DEFAULT BLOCK DURATION: All meaningful work blocks (prospecting, build, research, pipeline) should be 60 minutes by default. This is the ideal flow unit.
2. MINIMUM BLOCK DURATION: Meaningful work blocks MUST be at least 30 minutes. NEVER schedule prospecting, build, research, or pipeline work in blocks shorter than 30 minutes.
3. SHORT BLOCKS (under 30 min): ONLY allowed for start-of-day prep, end-of-day wrap, or light admin/cleanup. Do NOT assign meaningful work to short windows — leave them empty or use for admin only.
4. NEW LOGO IS THE PRIORITY. Use TODAY'S ADJUSTED TARGETS (from weekly context above) — NOT the raw daily averages. Schedule a New Logo Build block + enough Prep→Call Blitz + Email Outreach cycles to hit TODAY'S target.
5. FILL ALL AVAILABLE TIME: Every minute between ${workStart} and ${workEnd} must be accounted for. No idle gaps > 15 minutes. Stack meaningful blocks back-to-back. If a gap exists, fill it with the next appropriate workflow step.
5. Use "workstream" field to tag each block as "new_logo" or "renewal" or "general"
6. Goals must be REALISTIC and ACHIEVABLE. Use these realistic pacing rates:
   - DIAL RATE: ~15 dials per 30 minutes (1 dial every 2 min including voicemail/notes). A 60-min Call Blitz = ~30 dials.
   - BUILD RATE: 3 accounts per 60 min build block (selecting + researching + finding contacts + adding to cadence)
   - PREP RATE: 2-3 accounts per 30 min prep block
   - EMAIL RATE: ~8-10 personalized emails per 30 minutes
   - Do the math: if today's target is ${todayDialTarget} dials, you need ~${Math.ceil(todayDialTarget / 30)} Call Blitz blocks of 60 min each
7. ${preferNewLogoMorning ? 'Account for energy patterns: deep prospecting/new logo work in the morning, renewal tasks in the afternoon' : 'Distribute new logo and renewal work based on meeting gaps'}
8. Include buffer time around meetings (5-10 min)
9. If feedback says past suggestions were unrealistic, SIGNIFICANTLY dial back goals
10. DO NOT schedule an EOD wrap-up or journal block. The user handles reflection during their morning check-in the next day.
11. DO NOT schedule lunch breaks, mid-morning breaks, or mid-afternoon breaks. Every available minute should be productive.
12. NAME SPECIFIC ACCOUNTS in Prep, Build, and Call Blitz block goals (from prospecting list only)
13. PERSONAL/FAMILY blocks are NON-NEGOTIABLE — the user has children (Quinn, Emmett). School drop-offs, pickups, and activities MUST be respected.
14. If screenshot-confirmed meetings differ from calendar DB, TRUST the screenshot.
15. CALENDAR MEETINGS ARE FIXED ANCHORS. Do NOT generate your own meeting blocks — they are provided as locked blocks and merged automatically.
16. DO NOT duplicate a meeting that already exists.
17. DO NOT schedule ANY blocks before ${workStart} or after ${workEnd}. This is a HARD boundary.
18. ONLY use accounts from the NEW LOGO PROSPECTING list in Prep→Execute cycles. Current customers are NOT prospecting targets.
19. CONSOLIDATE all non-prospecting admin work (pipeline opp tasks, renewal tasks, email, CRM updates) into ONE short "Admin & Pipeline Tasks" block (30 min max). New Logo Prep and Call Blitz blocks are NOT admin.
20. Internal meetings like "Deal Desk" are OPTIONAL — do not treat them as locked anchors. Only external customer/prospect meetings are mandatory.
21. MINIMUM Call Blitz block is 30 minutes. Prefer 60 minutes for momentum. NO 15-minute call blitzes to targeted/prepped accounts. Exception: a short 15-min "Rust Buster" dial block (type: "prospecting") is OK ONCE at the start of the day to warm up on LOW-PREP targets — NOT targeted prospecting accounts.
22. EMAIL OUTREACH is part of prospecting, not just calling. Schedule dedicated "Email Blitz" blocks (type: "prospecting", 30 min) for personalized outbound emails to prospects. Alternate between Call Blitz and Email Blitz for variety and multi-channel coverage.
23. On HEAVY MEETING DAYS (${todayMeetingMin > 180 ? 'TODAY IS ONE' : 'not today'}): SKIP the Renewal Review block entirely — those 30 minutes are better spent on prospecting. Catch up on renewals on lighter days.
24. THINK LIKE A WORLD-CLASS SDR/AE: Cold calling works best with MOMENTUM. Schedule longer, uninterrupted Call Blitz blocks (60 min preferred) rather than scattered short ones. But a quick "Rust Buster" warm-up to shake off daily hesitation is a proven tactic.
25. PRIORITIZE FLOW over filling every minute. If a gap between meetings is under 30 minutes, assign light admin or leave it as buffer — do NOT cram meaningful work into it.

WORKSTREAM WORKFLOW DIFFERENCES (CRITICAL):

**NEW LOGO BUILD — SOURCING & CADENCE SETUP (FIRST-CLASS BLOCK):**
- type: "build", workstream: "new_logo"
- This is the structured work BEFORE you can dial. Without it, your call blitz has no fresh targets.
- DEFAULT DAILY TARGET: 3 new accounts sourced, researched, contacts found, and added to cadence
- A "New Logo Build" block (60 min default, 30 min minimum on heavy days) is a REQUIRED part of the daily plan — NOT optional
- The build block has 5 sequential steps the user tracks:
  1. Select 3 target accounts (from ICP-fit sourced list or prospecting accounts)
  2. Research company (website, news, tech stack, pain points)
  3. Identify contacts (buying committee, champions, influencers)
  4. Find emails/phone numbers (LinkedIn, ZoomInfo, Apollo, manual research)
  5. Add to cadence (email + phone sequences ready to execute)
- Label like: "New Logo Build (3 accounts)"
- Goals should reference specific accounts from the prospecting list
- Schedule this BEFORE the main Prep→Call Blitz cycle so newly built accounts feed into today's or tomorrow's calls
- On HEAVY meeting days: reduce to 1-2 accounts but DO NOT skip entirely — pipeline sourcing cannot be zero

**NEW LOGO PROSPECTING — EXECUTION (CALLS & EMAILS):**
- This is research + cadence + cold outreach work — high-energy hunter mode
- WARM-UP: Start the day with a short "Rust Buster" block (15-20 min, type: "prospecting"): quick dials to LOW-PREP targets — old leads, closed-lost re-engagements, prebuilt lists. Purpose: build momentum and shake off hesitation before the main blitz.
- Then use PREP → EXECUTE paired cycles for TARGETED prospecting:
   - "Prep" block (type: "prep", 30 min): Research 2-3 specific accounts, review contacts, build call notes + email drafts
   - Immediately followed by "Call Blitz" block (type: "prospecting", 60 min preferred, 30 min minimum): Dial into those prepped accounts. NEVER below 30 minutes.
  - Label prep blocks like: "Account Prep (Tessitura, Privy)"
  - Label call blocks like: "Call Blitz #1 (~22 dials)" — use realistic math: 45min ≈ 22 dials, 60min ≈ 30 dials
  - Each Prep block must be immediately followed by its Call Blitz — no gaps between a specific pair
  - BUT it's fine to have MULTIPLE separate Prep→Blitz cycles throughout the day, split around meetings
- EMAIL OUTREACH is equally important — schedule "Email Blitz" blocks (type: "prospecting", 25-30 min) for personalized outbound. Multi-channel (call + email) is how top AEs operate.
  - Label like: "Email Blitz (~10 personalized emails)"
  - Can follow a Call Blitz (call first, then email the ones who didn't pick up) or stand alone
- Schedule enough cycles to hit TODAY'S ADJUSTED dial + email target, NOT the raw daily average
- Fill ALL available non-meeting time with prospecting activity (calls, emails, prep, build)

**ACTIVE NEW LOGO OPPORTUNITIES (deals already in pipeline):**
- TASK-ORIENTED and MEETING-DRIVEN only — NOT research/cadence work
- Do NOT give these their own time block unless there is a specific urgent task
- Roll any pipeline tasks into the single "Admin & Pipeline Tasks" block

**RENEWALS — CONDITIONAL, 30 MINUTES MAX:**
- On LIGHT/MODERATE meeting days (under 3h of meetings): Schedule ONE "Renewal Review" block, exactly 30 minutes, in the afternoon
- On HEAVY meeting days (3h+ of meetings): SKIP Renewal Review entirely. Use that time for prospecting. Catch up on renewals on lighter days.
- Purpose: look closer at 1-2 customer accounts with upcoming renewals
- Goals: "Review 1-2 upcoming renewal accounts" and "Work through renewal task queue" — keep it generic
- DO NOT name specific renewal accounts, opportunities, or tasks
- DO NOT create any other renewal blocks. All other renewal work happens in meetings or the admin block

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
${rebuildContextText}

Generate a daily time-blocked schedule. For each block provide:
- start_time (HH:MM in 24h EST)
- end_time (HH:MM in 24h EST)
- label (short title, 3-5 words)
- type: one of "prospecting", "meeting", "research", "admin", "break", "pipeline", "prep"
- workstream: "new_logo" or "renewal" or "general"
- goals: array of 1-3 specific, realistic goals for that block (NAME ACCOUNTS for new logo prospecting blocks only — NOT for renewal blocks). Use specific workflow labels like "Send emails to newly sourced contacts" instead of generic "Email Blitz", and "Call newly added prospects" instead of "Call Block".
- reasoning: one sentence on why this block matters

Also provide an overall "day_strategy" (2-3 sentences: how today fits into the weekly plan, what makes today different from other days this week) and "key_metric_targets" object with TODAY'S ADJUSTED targets (not raw daily averages).

READINESS CHECK: Before scheduling any Call Blitz or Email Blitz, verify: Do contacts exist? Are they loaded into the system? Is outreach actually possible? If NOT, replace with an Admin block for research and contact sourcing.`;

    const [wsh, wsm] = workStart.split(':').map(Number);
    const [weh, wem] = workEnd.split(':').map(Number);
    const workStartMin = wsh * 60 + wsm;
    const workEndMin = weh * 60 + wem;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const minToTime = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

    // ── MVP dial constants ──
    const DIALS_PER_30_MIN = 10;
    const DIALS_TARGET_PER_30_MIN = 15;

    // ── OUTREACH TYPES that require prep to have been done first ──
    const OUTREACH_TYPES = new Set(['prospecting']);
    const READINESS_TYPES = new Set(['admin', 'prep', 'build']);

    function createPrepBlock(startMin: number, duration: number) {
      return {
        start_time: minToTime(startMin),
        end_time: minToTime(startMin + duration),
        label: duration >= 45 ? 'New Logo Prep (3 accounts)' : 'New Logo Prep',
        type: 'prep',
        workstream: 'new_logo',
        goals: [
          'Research target accounts',
          'Find contacts + source emails/phone numbers',
          'Load contacts into cadence',
        ],
        reasoning: 'Prep is required before any outreach block.',
      };
    }

    function createCallBlock(startMin: number, duration: number, sequence: number) {
      const halfHours = duration / 30;
      const estDials = Math.round(halfHours * DIALS_PER_30_MIN);
      return {
        start_time: minToTime(startMin),
        end_time: minToTime(startMin + duration),
        label: sequence === 1 ? `Call Block (~${estDials} dials)` : `Call Block #${sequence} (~${estDials} dials)`,
        type: 'prospecting',
        workstream: 'new_logo',
        goals: [
          `Make ~${estDials} dials to sourced contacts`,
          'Log responses and next steps',
        ],
        reasoning: 'Execution block paired with prep.',
      };
    }

    function createShortAdminBlock(startMin: number, endMin: number) {
      return {
        start_time: minToTime(startMin),
        end_time: minToTime(endMin),
        label: 'Admin & CRM Updates',
        type: 'admin',
        workstream: 'general',
        goals: ['Log activity', 'Update CRM'],
        reasoning: 'Use short window productively.',
      };
    }

    /** Clamp non-meeting blocks to working hours */
    function clampWorkBlocks(blocks: any[]) {
      return blocks.filter((b: any) => {
        if (b.type === 'meeting') return true;
        const startMin = toMinutes(b.start_time);
        const endMin = toMinutes(b.end_time);
        if (endMin <= workStartMin || startMin >= workEndMin) return false;
        return true;
      }).map((b: any) => {
        if (b.type === 'meeting') return b;
        let startMin = toMinutes(b.start_time);
        let endMin = toMinutes(b.end_time);
        startMin = Math.max(startMin, workStartMin);
        endMin = Math.min(endMin, workEndMin);
        if (endMin - startMin < 15) return null;
        return { ...b, start_time: minToTime(startMin), end_time: minToTime(endMin) };
      }).filter(Boolean);
    }

    function fillTimeGaps(blocks: any[]) {
      const sorted = [...blocks].sort((a: any, b: any) => toMinutes(a.start_time) - toMinutes(b.start_time));
      const filled: any[] = [];
      let cursor = workStartMin;
      let outreachSequence = 0;

      for (const block of sorted) {
        const blockStart = toMinutes(block.start_time);
        let gapStart = cursor;
        let gapRemaining = blockStart - gapStart;

        while (gapRemaining > 15) {
          if (gapRemaining >= 60) {
            filled.push(createPrepBlock(gapStart, 30));
            gapStart += 30;
            gapRemaining -= 30;

            const activityDuration = Math.min(60, gapRemaining);
            if (activityDuration >= 30) {
              outreachSequence += 1;
              filled.push(createCallBlock(gapStart, activityDuration, outreachSequence));
              gapStart += activityDuration;
              gapRemaining -= activityDuration;
            }
          } else if (gapRemaining >= 30) {
            filled.push(createPrepBlock(gapStart, gapRemaining));
            gapStart += gapRemaining;
            gapRemaining = 0;
          } else {
            filled.push(createShortAdminBlock(gapStart, blockStart));
            gapRemaining = 0;
          }
        }

        filled.push(block);
        cursor = Math.max(cursor, toMinutes(block.end_time));
      }

      let tailStart = cursor;
      let tailRemaining = workEndMin - tailStart;
      while (tailRemaining > 15) {
        if (tailRemaining >= 60) {
          filled.push(createPrepBlock(tailStart, 30));
          tailStart += 30;
          tailRemaining -= 30;

          const activityDuration = Math.min(60, tailRemaining);
          if (activityDuration >= 30) {
            outreachSequence += 1;
            filled.push(createCallBlock(tailStart, activityDuration, outreachSequence));
            tailStart += activityDuration;
            tailRemaining -= activityDuration;
          }
        } else if (tailRemaining >= 30) {
          filled.push(createPrepBlock(tailStart, tailRemaining));
          tailStart += tailRemaining;
          tailRemaining = 0;
        } else {
          filled.push(createShortAdminBlock(tailStart, workEndMin));
          tailRemaining = 0;
        }
      }

      return filled.sort((a: any, b: any) => toMinutes(a.start_time) - toMinutes(b.start_time));
    }

    function validatePlanDependencies(blocks: any[]) {
      const sorted = [...blocks].sort((a: any, b: any) => toMinutes(a.start_time) - toMinutes(b.start_time));
      const validated: any[] = [];
      let segmentHasReadiness = false;

      for (const block of sorted) {
        if (block.type === 'meeting') {
          validated.push(block);
          segmentHasReadiness = false;
          continue;
        }

        // Standardize AI label variants to canonical names
        const normalizedLabel = String(block.label || '').toLowerCase();
        if (normalizedLabel.includes('email blitz') || normalizedLabel.includes('call blitz') || normalizedLabel === 'call block') {
          const dur = toMinutes(block.end_time) - toMinutes(block.start_time);
          const halfHours = dur / 30;
          const estDials = Math.round(halfHours * DIALS_PER_30_MIN);
          block.label = `Call Block (~${estDials} dials)`;
        }

        if (READINESS_TYPES.has(block.type)) {
          segmentHasReadiness = true;
          validated.push(block);
          continue;
        }

        if (OUTREACH_TYPES.has(block.type) && !segmentHasReadiness) {
          const startMin = toMinutes(block.start_time);
          const endMin = toMinutes(block.end_time);
          const totalDuration = endMin - startMin;
          const prepDuration = totalDuration >= 60 ? 30 : Math.max(30, Math.floor(totalDuration / 2));
          const activityDuration = totalDuration - prepDuration;

          validated.push(createPrepBlock(startMin, prepDuration));
          if (activityDuration >= 30) {
            validated.push(createCallBlock(startMin + prepDuration, activityDuration, 1));
          }
          segmentHasReadiness = true;
          continue;
        }

        validated.push(block);
      }

      return fillTimeGaps(validated);
    }

    // ── Helper: build a deterministic fallback plan without AI ──
    // Follows strict dependency ordering: prep/readiness before every activity block
    function buildFallbackPlan(reason: string) {
      const blocks: any[] = [];

      // Collect locked meetings as immovable anchors
      const meetingSlots = activeLockedCalendarBlocks.map((m: any) => ({
        ...m,
        startMin: toMinutes(m.start_time),
        endMin: toMinutes(m.end_time),
      })).sort((a: any, b: any) => a.startMin - b.startMin);

      // Add all meetings
      meetingSlots.forEach((m: any) => blocks.push(m));

      // Find gaps between meetings (and before/after)
      const gaps: { startMin: number; endMin: number }[] = [];
      let cursor = workStartMin;
      for (const m of meetingSlots) {
        if (m.startMin > cursor) gaps.push({ startMin: cursor, endMin: m.startMin });
        cursor = Math.max(cursor, m.endMin);
      }
      if (cursor < workEndMin) gaps.push({ startMin: cursor, endMin: workEndMin });

      // Follow dependency order: 1) Build, 2) Admin/Prep, 3) Outreach
      let buildPlaced = false;
      let adminPlaced = false;
      let callPlaced = false;
      let prospectingCount = 0;

      for (const gap of gaps) {
        let gapCursor = gap.startMin;
        const gapLen = gap.endMin - gap.startMin;
        if (gapLen < 30) continue;

        // Phase 1: Build block (sourcing new accounts)
        if (!buildPlaced) {
          const dur = gapLen >= 60 ? 60 : 30;
          const acctCount = dur >= 60 ? 3 : 2;
          const topNames = prospectingAccounts.slice(0, acctCount).map((a: any) => a.name).join(', ') || 'target accounts';
          blocks.push({
            start_time: minToTime(gapCursor),
            end_time: minToTime(gapCursor + dur),
            label: `New Logo Build (${acctCount} accounts)`,
            type: 'build',
            workstream: 'new_logo',
            goals: [
              `Select & research ${acctCount} accounts (${topNames})`,
              'Identify contacts in buying committee',
              'Find emails/phone numbers',
            ],
            reasoning: 'Step 1 — source and research accounts before any outreach.',
          });
          gapCursor += dur;
          buildPlaced = true;
        }

        // Phase 2: Admin/Prep block (contact sourcing & cadence loading)
        if (!adminPlaced && gap.endMin - gapCursor >= 30) {
          const dur = Math.min(45, gap.endMin - gapCursor);
          blocks.push({
            start_time: minToTime(gapCursor),
            end_time: minToTime(gapCursor + dur),
            label: 'Account Research & Contact Sourcing',
            type: 'admin',
            workstream: 'new_logo',
            goals: [
              'Source email addresses & phone numbers',
              'Load contacts into cadence system',
              'Verify contact data quality',
            ],
            reasoning: 'Step 2 — contacts must be sourced and loaded before outreach begins.',
          });
          gapCursor += dur;
          adminPlaced = true;
        }

        // Phase 3: Outreach blocks (only after prep is done)
        while (gap.endMin - gapCursor >= 30 && (buildPlaced || adminPlaced)) {
          const remaining = gap.endMin - gapCursor;
          const callDur = Math.min(60, remaining);
          const estDials = Math.round(callDur / 2);
          prospectingCount++;
          const label = prospectingCount === 1
            ? `Call newly added prospects (~${estDials} dials)`
            : `Follow up on yesterday's outreach (~${estDials} dials)`;
          blocks.push({
            start_time: minToTime(gapCursor),
            end_time: minToTime(gapCursor + callDur),
            label,
            type: 'prospecting',
            workstream: 'new_logo',
            goals: [`Make ~${estDials} dials to sourced contacts`, 'Log conversations and outcomes'],
            reasoning: `Step 3 — outreach to prepped contacts.`,
          });
          gapCursor += callDur;
          callPlaced = true;
        }
      }

      blocks.sort((a: any, b: any) => toMinutes(a.start_time) - toMinutes(b.start_time));

      return {
        blocks,
        day_strategy: `Fallback plan generated — ${reason}. Follows strict dependency order: Build → Prep → Outreach. All available time utilized.`,
        key_metric_targets: {
          dials: todayDialTarget || 30,
          conversations: Math.max(1, todayConvoTarget || 3),
          accounts_sourced: 3,
          accounts_researched: 3,
          contacts_prepped: 3,
        },
        is_fallback: true,
      };
    }

    function injectCoreBlock(blocks: any[], block: any) {
      const sorted = [...blocks].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
      const anchors = sorted.map((item) => ({ start: toMinutes(item.start_time), end: toMinutes(item.end_time), type: item.type }));
      let cursor = workStartMin;

      for (const anchor of anchors) {
        if (anchor.start - cursor >= 30) {
          const end = Math.min(anchor.start, cursor + 30);
          sorted.push({ ...block, start_time: minToTime(cursor), end_time: minToTime(end) });
          return sorted.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
        }
        cursor = Math.max(cursor, anchor.end);
      }

      if (workEndMin - cursor >= 30) {
        sorted.push({ ...block, start_time: minToTime(cursor), end_time: minToTime(Math.min(workEndMin, cursor + 30)) });
        return sorted.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
      }

      const repurposeIdx = sorted.findIndex((item) => item.type !== 'meeting');
      if (repurposeIdx >= 0) {
        sorted[repurposeIdx] = {
          ...sorted[repurposeIdx],
          ...block,
          start_time: sorted[repurposeIdx].start_time,
          end_time: sorted[repurposeIdx].end_time,
        };
      }
      return sorted.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
    }

    function ensureCoreBlocks(blocks: any[]) {
      let next = [...blocks].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));

      if (!next.some((block) => block.type === 'build')) {
        next = injectCoreBlock(next, {
          label: 'New Logo Build (2 accounts)',
          type: 'build',
          workstream: 'new_logo',
          goals: ['Select & research 2 accounts', 'Find contacts & add to cadence'],
          reasoning: 'Safety fallback — ensured at least one build block.',
        });
      }

      if (!next.some((block) => block.type === 'prospecting')) {
        next = injectCoreBlock(next, {
          label: 'Call Blitz (~15 dials)',
          type: 'prospecting',
          workstream: 'new_logo',
          goals: ['Make ~15 dials', 'Log conversations'],
          reasoning: 'Safety fallback — ensured at least one call block.',
        });
      }

      return next.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
    }

    // ── AI call with fallback ──
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    let plan: any;
    let isFallback = false;
    let fallbackReason: string | null = null;

    try {
      logStage("plan_generation_started", "calling AI planner");
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
                        type: { type: "string", enum: ["prospecting", "meeting", "research", "admin", "break", "pipeline", "prep", "build"] },
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
                      accounts_sourced: { type: "number", description: "New logo accounts sourced and added to cadence (default 3)" },
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
          throw new Error("AI planner rate limited");
        }
        if (status === 402) {
          throw new Error("AI planner credits exhausted");
        }
        throw new Error(`AI gateway error: ${status}`);
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error("No tool call in AI response");

      plan = JSON.parse(toolCall.function.arguments);

      // Validate essential structure
      if (!Array.isArray(plan.blocks) || plan.blocks.length === 0) {
        throw new Error("AI returned empty blocks array");
      }

      logStage("plan_generation_completed", "AI planner returned blocks", { blockCount: plan.blocks.length });
    } catch (aiError) {
      // AI failed — use deterministic fallback
      console.error("AI plan generation failed, using fallback:", aiError);
      fallbackReason = aiError instanceof Error ? aiError.message : "AI unavailable";
      plan = buildFallbackPlan(fallbackReason);
      isFallback = true;
      logStage("plan_generation_failed", `using fallback: ${fallbackReason}`);
    }

    let mergedBlocks = isFallback
      ? plan.blocks
      : mergeLockedCalendarBlocks(plan.blocks || [], activeLockedCalendarBlocks);

    // SAFETY NET: If AI omitted a "build" block and there are prospecting accounts, inject one
    if (!isFallback) {
      const hasBuildBlock = mergedBlocks.some((b: any) => b.type === 'build');
      if (!hasBuildBlock && prospectingAccounts.length > 0) {
        const buildDuration = todayMeetingMin > 180 ? 30 : 60;
        const firstNonMeeting = mergedBlocks.findIndex((b: any) => b.type !== 'meeting');
        const insertIdx = firstNonMeeting >= 0 ? firstNonMeeting : 0;
        const buildStart = insertIdx > 0 ? mergedBlocks[insertIdx - 1].end_time : workStart;
        const [bh, bm] = buildStart.split(':').map(Number);
        const buildEndMin = bh * 60 + bm + buildDuration;
        const buildEnd = `${Math.floor(buildEndMin / 60).toString().padStart(2, '0')}:${(buildEndMin % 60).toString().padStart(2, '0')}`;
        const topNames = prospectingAccounts.slice(0, 3).map((a: any) => a.name).join(', ');
        mergedBlocks.splice(insertIdx, 0, {
          start_time: buildStart,
          end_time: buildEnd,
          label: `New Logo Build (3 accounts)`,
          type: 'build',
          workstream: 'new_logo',
          goals: [
            `Select 3 target accounts (${topNames})`,
            'Research companies & identify contacts',
            'Find contact info & add to cadence',
          ],
          reasoning: `Pipeline sourcing cannot be zero — injected ${buildDuration}-min build block because AI plan omitted it.`,
        });
        mergedBlocks.sort((a: any, b: any) => toMinutes(a.start_time) - toMinutes(b.start_time));
      }
    }

    mergedBlocks = ensureCoreBlocks(mergedBlocks);

    // CRITICAL: Validate task dependencies and fill all time gaps
    mergedBlocks = validatePlanDependencies(mergedBlocks);
    logStage("dependencies_validated", "task dependencies enforced, gaps filled", { finalBlockCount: mergedBlocks.length });

    const previousVisibleBlocks = Array.isArray(rebuildContext?.current_visible_blocks)
      ? rebuildContext.current_visible_blocks.filter((block: any) => !!block?.start_time && !!block?.end_time)
      : [];

    const changeSummary = summarizePlanDelta(previousVisibleBlocks, mergedBlocks);

    if (requestSource === 'manual_rebuild' && previousVisibleBlocks.length > 0 && blockSignature(previousVisibleBlocks) === blockSignature(mergedBlocks)) {
      fallbackReason = 'Manual rebuild returned unchanged plan';
      isFallback = true;
      plan = buildFallbackPlan(fallbackReason);
      mergedBlocks = ensureCoreBlocks(plan.blocks || []);
      logStage("plan_generation_failed", fallbackReason);
    }

    logStage("response_validated", "plan validated and normalized", {
      blockCount: mergedBlocks.length,
      changeSummary,
      usedFallback: isFallback,
    });

    // Upsert the plan with all data persisted — reset dismissals on rebuild
    logStage("plan_persist_started", "writing rebuilt plan to database");
    const { data: saved, error: saveError } = await supabase
      .from("daily_time_blocks")
      .upsert({
        user_id: userId,
        plan_date: targetDate,
        blocks: mergedBlocks,
        meeting_load_hours: meetingHours,
        focus_hours_available: focusHoursAvailable,
        ai_reasoning: (isFallback ? '[FALLBACK] ' : '') + (plan.day_strategy || ''),
        key_metric_targets: plan.key_metric_targets || {},
        completed_goals: [],
        block_feedback: [],
        dismissed_block_indices: [],
        recast_at: null,
      }, { onConflict: "user_id,plan_date" })
      .select()
      .single();

    if (saveError) throw saveError;

    logStage("plan_persist_completed", "rebuilt plan saved successfully", { planId: saved.id });

    return new Response(JSON.stringify({
      ...saved,
      is_fallback: isFallback,
      rebuild_diagnostics: {
        trace_id: traceId,
        request_source: requestSource,
        stages,
        used_fallback: isFallback,
        fallback_reason: fallbackReason,
        failure_stage: isFallback ? 'plan_generation' : null,
        exact_failure_reason: fallbackReason,
        change_summary: changeSummary,
        preserved_state: {
          dismissed_meetings: 'reset_after_apply',
          recast_state: 'reset_to_null',
          weekly_queue_progress: 'preserved',
        },
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-time-blocks error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
