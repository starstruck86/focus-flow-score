import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

interface HygieneIssue {
  type: string;
  severity: "critical" | "warning" | "info";
  record_type: "opportunity" | "account" | "renewal";
  record_id: string;
  record_name: string;
  message: string;
  suggested_action: string;
  days_stale?: number;
  arr_at_risk?: number;
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

    const today = new Date().toISOString().split("T")[0];
    const issues: HygieneIssue[] = [];

    // Fetch all data in parallel
    const [oppsRes, accountsRes, renewalsRes] = await Promise.all([
      supabase.from("opportunities").select("*").eq("status", "active"),
      supabase.from("accounts").select("*").in("account_status", ["active", "prepped", "researching", "1-researching", "2-prepped", "3-active", "4-meeting_booked", "5-opportunity"]),
      supabase.from("renewals").select("*"),
    ]);

    const opps = oppsRes.data || [];
    const accounts = accountsRes.data || [];
    const renewals = renewalsRes.data || [];

    const daysSince = (dateStr: string | null): number => {
      if (!dateStr) return 999;
      return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    };

    // --- Opportunity Issues ---
    for (const opp of opps) {
      const staleDays = daysSince(opp.last_touch_date);
      
      // Stale deal (no touch in 14+ days)
      if (staleDays >= 14) {
        issues.push({
          type: "stale_deal",
          severity: staleDays >= 30 ? "critical" : "warning",
          record_type: "opportunity",
          record_id: opp.id,
          record_name: opp.name,
          message: `No activity in ${staleDays} days`,
          suggested_action: staleDays >= 30
            ? "This deal may be dead. Schedule a re-engagement call or close it out."
            : "Schedule a touchpoint this week to keep momentum.",
          days_stale: staleDays,
          arr_at_risk: opp.arr || 0,
        });
      }

      // Missing next step
      if (!opp.next_step || opp.next_step.trim() === "") {
        issues.push({
          type: "missing_next_step",
          severity: "critical",
          record_type: "opportunity",
          record_id: opp.id,
          record_name: opp.name,
          message: "No next step defined",
          suggested_action: "Every active opp needs a clear next step. Define one now.",
          arr_at_risk: opp.arr || 0,
        });
      }

      // Close date in the past
      if (opp.close_date && opp.close_date < today) {
        issues.push({
          type: "past_close_date",
          severity: "critical",
          record_type: "opportunity",
          record_id: opp.id,
          record_name: opp.name,
          message: `Close date was ${opp.close_date} — needs update`,
          suggested_action: "Update the close date or mark this deal as closed lost.",
          arr_at_risk: opp.arr || 0,
        });
      }

      // Missing ARR
      if (!opp.arr || opp.arr === 0) {
        issues.push({
          type: "missing_arr",
          severity: "warning",
          record_type: "opportunity",
          record_id: opp.id,
          record_name: opp.name,
          message: "No ARR value set",
          suggested_action: "Add an ARR estimate to accurately track pipeline value.",
        });
      }
    }

    // --- Account Issues ---
    for (const acct of accounts) {
      const staleDays = daysSince(acct.last_touch_date);
      const status = acct.account_status || "";
      
      // Active account with no recent touch
      if ((status.includes("active") || status.includes("3-") || status.includes("4-") || status.includes("5-")) && staleDays >= 7) {
        issues.push({
          type: "stale_account",
          severity: staleDays >= 21 ? "critical" : "warning",
          record_type: "account",
          record_id: acct.id,
          record_name: acct.name,
          message: `Active account untouched for ${staleDays} days`,
          suggested_action: "Schedule outreach to maintain cadence.",
          days_stale: staleDays,
        });
      }
    }

    // --- Renewal Issues ---
    for (const renewal of renewals) {
      const daysToRenewal = Math.floor((new Date(renewal.renewal_due).getTime() - Date.now()) / 86400000);
      
      // Upcoming renewal with no next step
      if (daysToRenewal <= 60 && daysToRenewal > 0 && (!renewal.next_step || renewal.next_step.trim() === "")) {
        issues.push({
          type: "renewal_no_next_step",
          severity: daysToRenewal <= 30 ? "critical" : "warning",
          record_type: "renewal",
          record_id: renewal.id,
          record_name: renewal.account_name,
          message: `Renewal in ${daysToRenewal} days with no next step`,
          suggested_action: "Define a clear next step for this renewal immediately.",
          arr_at_risk: renewal.arr || 0,
        });
      }

      // High risk renewal approaching
      if (daysToRenewal <= 45 && (renewal.churn_risk === "high" || renewal.churn_risk === "certain")) {
        issues.push({
          type: "high_risk_renewal",
          severity: "critical",
          record_type: "renewal",
          record_id: renewal.id,
          record_name: renewal.account_name,
          message: `High-risk renewal in ${daysToRenewal} days (${renewal.churn_risk})`,
          suggested_action: "Escalate. Get CS involved and schedule exec alignment.",
          arr_at_risk: renewal.arr || 0,
        });
      }
    }

    // Sort by severity (critical first), then by ARR at risk
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    issues.sort((a, b) => {
      const sev = severityOrder[a.severity] - severityOrder[b.severity];
      if (sev !== 0) return sev;
      return (b.arr_at_risk || 0) - (a.arr_at_risk || 0);
    });

    const criticalCount = issues.filter(i => i.severity === "critical").length;
    const warningCount = issues.filter(i => i.severity === "warning").length;
    const totalArrAtRisk = issues.reduce((sum, i) => sum + (i.arr_at_risk || 0), 0);

    // Calculate health score (100 = perfect, deduct for issues)
    const healthScore = Math.max(0, Math.min(100,
      100 - (criticalCount * 15) - (warningCount * 5)
    ));

    const summary = {
      critical: criticalCount,
      warnings: warningCount,
      total_arr_at_risk: totalArrAtRisk,
      active_opps: opps.length,
      active_accounts: accounts.length,
      upcoming_renewals: renewals.filter(r => {
        const d = Math.floor((new Date(r.renewal_due).getTime() - Date.now()) / 86400000);
        return d > 0 && d <= 90;
      }).length,
    };

    // Upsert scan result
    const { data: saved, error: saveError } = await supabase
      .from("pipeline_hygiene_scans")
      .upsert({
        user_id: user.id,
        scan_date: today,
        issues,
        summary,
        health_score: healthScore,
        total_issues: issues.length,
        critical_issues: criticalCount,
      }, { onConflict: "user_id,scan_date" })
      .select()
      .single();

    if (saveError) throw saveError;

    return new Response(JSON.stringify(saved), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pipeline-hygiene error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
