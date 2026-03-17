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

function mergeLockedCalendarBlocks(
  aiBlocks: Array<Record<string, any>>,
  lockedBlocks: Array<Record<string, any>>,
) {
  const lockedKeys = new Set(
    lockedBlocks.map((block) => `${block.start_time}-${block.end_time}-${block.label.trim().toLowerCase()}`),
  );

  const filteredAiBlocks = aiBlocks.filter((block) => {
    if (!block?.start_time || !block?.end_time || !block?.label) return false;

    const key = `${block.start_time}-${block.end_time}-${String(block.label).trim().toLowerCase()}`;
    if (lockedKeys.has(key)) return false;

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

    // Quota targets context
    const targets = quotaRes.data;
    const quotaContext = targets
      ? `Daily targets: ${targets.target_dials_per_day} dials, ${targets.target_connects_per_day} connects, ${targets.target_accounts_researched_per_day} accounts researched, ${targets.target_contacts_prepped_per_day} contacts prepped. Weekly: ${targets.target_meetings_set_per_week} meetings set, ${targets.target_opps_created_per_week} opps created, ${targets.target_customer_meetings_per_week} customer meetings.`
      : "Default targets: 60 dials/day, 6 connects/day, 3 accounts researched/day.";

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
- Protected lunch break: ${lunchStart} to ${lunchEnd} EST — no work blocks during this time.
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
${prefsContext}

CRITICAL RULES:
1. NO time blocks shorter than ${minBlockMin} minutes.
2. NEW LOGO IS THE PRIORITY. Maximize the number and duration of new logo Prep→Execute cycles. Keep as much of the day open for new logo focus as possible.
3. Use "workstream" field to tag each block as "new_logo" or "renewal" or "general"
4. Goals must be REALISTIC and specific - not aspirational fantasies
5. ${preferNewLogoMorning ? 'Account for energy patterns: deep prospecting/new logo work in the morning, renewal tasks in the afternoon' : 'Distribute new logo and renewal work based on meeting gaps'}
6. Include buffer time around meetings (5-10 min)
7. If feedback says past suggestions were unrealistic, SIGNIFICANTLY dial back goals
8. Leave 30 min for daily journal/EOD wrap-up
9. Never schedule prospecting calls during lunch (${lunchStart}-${lunchEnd})
10. Build in at least one 15-min break mid-morning and mid-afternoon
11. NAME SPECIFIC ACCOUNTS in goals when possible
12. PERSONAL/FAMILY blocks are NON-NEGOTIABLE — the user has children (Quinn, Emmett). School drop-offs, pickups, and activities MUST be respected.
13. If screenshot-confirmed meetings differ from calendar DB, TRUST the screenshot.
14. CALENDAR MEETINGS ARE FIXED ANCHORS. Every meeting listed below must appear as its own block at the exact EST start and end time shown. Do NOT move, round, combine, rename, or replace them.
15. DO NOT schedule ANY blocks before ${workStart} or after ${workEnd}. This is a HARD boundary.

WORKSTREAM WORKFLOW DIFFERENCES (CRITICAL):

**NEW LOGO PROSPECTING (accounts with NO active opportunity) — THIS IS THE CORE OF THE DAY:**
- This is research + cadence + cold outreach work — high-energy hunter mode
- Use PREP → EXECUTE paired cycles:
  - "Prep" block (type: "prep"): Research 2-3 specific accounts, review contacts, build call notes
  - Immediately followed by "Call Blitz" block (type: "prospecting"): Dial into those exact accounts while context is fresh
  - Label prep blocks like: "Tessitura Prep (2 accounts - 6 contacts)"
  - Label execute blocks like: "Call Blitz #1 (8-10 Calls)"
  - NEVER separate a Prep from its Call Blitz with a meeting or break — they must be adjacent
- Aim for 2-3 Prep→Execute cycles per day depending on meeting load
- Fill ALL available non-meeting time with new logo work

**ACTIVE NEW LOGO OPPORTUNITIES (deals already in pipeline):**
- These are TASK-ORIENTED and MEETING-DRIVEN — NOT more research/cadence work
- Only schedule a block if there are specific urgent tasks (proposals, follow-ups, discovery prep)
- Keep these blocks SHORT and focused — don't let them eat into prospecting time
- Block types should be "pipeline", NOT "research" or "prospecting"

**RENEWALS — KEEP IT MINIMAL:**
- Schedule ONE single "Renewal Review" block per day, 30-45 minutes MAX
- Purpose: review 1-2 upcoming renewal accounts, check health, handle any urgent tasks the user has already created
- DO NOT suggest specific renewal tasks, accounts, or opportunities in goals — the user manages their own renewal task list
- DO NOT create multiple renewal blocks or expand renewal time
- Label it simply: "Renewal Review" with goals like "Review upcoming renewals, work through renewal task queue"
- This is NOT prospecting or research — it's admin/task execution time
- Renewals should NEVER crowd out new logo prospecting time

**MEETING PREP (for any upcoming customer/prospect meeting):**
- If there's a customer meeting today, schedule a short prep block (type: "prep") 30-60 min before it
- Goals: review account history, prep talking points, check latest activity

LOCKED CALENDAR MEETINGS (EXACT EST TIMES):
${calendarContext}
${screenshotContext}

MEETING LOAD: ${meetingHours}h of meetings, ${focusHoursAvailable}h available for focused work

${quotaContext}

NEW LOGO PROSPECTING ACCOUNTS (these are the focus — use in Prep→Execute cycles):
${prospectingAccounts.slice(0, 8).map((a: any) => `- ${a.name} (Tier ${a.tier}, ${a.account_status}, cadence: ${a.cadence_name || 'none'})`).join("\n") || '(none)'}

${pipelineContext}

${journalRes.data ? `TODAY'S JOURNAL SO FAR: ${journalRes.data.dials || 0} dials, ${journalRes.data.conversations || 0} conversations, ${journalRes.data.meetings_set || 0} meetings set` : "No journal entry yet today."}

${feedbackContext}

Generate a daily time-blocked schedule. For each block provide:
- start_time (HH:MM in 24h EST)
- end_time (HH:MM in 24h EST)
- label (short title, 3-5 words)
- type: one of "prospecting", "meeting", "research", "admin", "break", "pipeline", "prep"
- workstream: "new_logo" or "renewal" or "general"
- goals: array of 1-3 specific, realistic goals for that block (NAME ACCOUNTS when possible)
- reasoning: one sentence on why this block matters

Also provide an overall "day_strategy" (2-3 sentences distinguishing the new logo vs renewal focus for the day) and "key_metric_targets" object with realistic targets.`;

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
