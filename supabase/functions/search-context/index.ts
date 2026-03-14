import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { account_ids, opportunity_ids, renewal_ids } = await req.json();
    const contexts: Record<string, any> = {};

    // Enrich account contexts
    if (account_ids?.length) {
      const { data: accounts } = await supabase
        .from("accounts")
        .select("id, name, tier, account_status, last_touch_date, outreach_status, icp_fit_score, next_step, motion")
        .in("id", account_ids);

      const { data: acctOpps } = await supabase
        .from("opportunities")
        .select("id, name, account_id, stage, arr, close_date, status")
        .in("account_id", account_ids)
        .in("status", ["active", "stalled"]);

      const { data: acctRenewals } = await supabase
        .from("renewals")
        .select("id, account_id, arr, renewal_due, churn_risk, health_status")
        .in("account_id", account_ids);

      (accounts || []).forEach((a: any) => {
        const relatedOpps = (acctOpps || []).filter((o: any) => o.account_id === a.id);
        const relatedRenewals = (acctRenewals || []).filter((r: any) => r.account_id === a.id);
        const daysSinceTouch = a.last_touch_date
          ? Math.floor((Date.now() - new Date(a.last_touch_date).getTime()) / 86400000)
          : null;

        const snippets: string[] = [];
        if (daysSinceTouch !== null) snippets.push(`Touched ${daysSinceTouch}d ago`);
        else snippets.push("Never touched");
        if (a.tier) snippets.push(`Tier ${a.tier}`);
        if (relatedOpps.length > 0) {
          const totalArr = relatedOpps.reduce((s: number, o: any) => s + (o.arr || 0), 0);
          snippets.push(`${relatedOpps.length} opp${relatedOpps.length > 1 ? 's' : ''} · $${(totalArr / 1000).toFixed(0)}k`);
          const stages = [...new Set(relatedOpps.map((o: any) => o.stage).filter(Boolean))];
          if (stages.length) snippets.push(stages.join(', '));
        }
        if (relatedRenewals.length > 0) {
          const totalRenewalArr = relatedRenewals.reduce((s: number, r: any) => s + (r.arr || 0), 0);
          const nearestDue = relatedRenewals.sort((a: any, b: any) => a.renewal_due.localeCompare(b.renewal_due))[0];
          snippets.push(`Renewal $${(totalRenewalArr / 1000).toFixed(0)}k due ${nearestDue.renewal_due}`);
        }
        if (a.next_step) snippets.push(`Next: ${a.next_step.slice(0, 40)}`);

        contexts[`account:${a.id}`] = {
          type: 'account',
          id: a.id,
          name: a.name,
          snippet: snippets.join(' · '),
          tier: a.tier,
          status: a.account_status,
          daysSinceTouch,
          oppCount: relatedOpps.length,
          renewalCount: relatedRenewals.length,
        };
      });
    }

    // Enrich opportunity contexts
    if (opportunity_ids?.length) {
      const { data: opps } = await supabase
        .from("opportunities")
        .select("id, name, stage, arr, close_date, status, next_step, last_touch_date, deal_type, account_id")
        .in("id", opportunity_ids);

      const acctIds = [...new Set((opps || []).map((o: any) => o.account_id).filter(Boolean))];
      const { data: relAccounts } = acctIds.length > 0
        ? await supabase.from("accounts").select("id, name").in("id", acctIds)
        : { data: [] };

      (opps || []).forEach((o: any) => {
        const acct = (relAccounts || []).find((a: any) => a.id === o.account_id);
        const daysToClose = o.close_date
          ? Math.floor((new Date(o.close_date).getTime() - Date.now()) / 86400000)
          : null;
        const daysSinceTouch = o.last_touch_date
          ? Math.floor((Date.now() - new Date(o.last_touch_date).getTime()) / 86400000)
          : null;

        const snippets: string[] = [];
        if (o.arr) snippets.push(`$${(o.arr / 1000).toFixed(0)}k`);
        if (o.stage) snippets.push(o.stage);
        if (daysToClose !== null) snippets.push(`Closes in ${daysToClose}d`);
        if (daysSinceTouch !== null) snippets.push(`Touched ${daysSinceTouch}d ago`);
        if (o.next_step) snippets.push(`Next: ${o.next_step.slice(0, 30)}`);

        contexts[`opportunity:${o.id}`] = {
          type: 'opportunity',
          id: o.id,
          name: o.name,
          accountName: acct?.name,
          snippet: snippets.join(' · '),
          stage: o.stage,
          arr: o.arr,
          daysToClose,
          status: o.status,
        };
      });
    }

    // Enrich renewal contexts
    if (renewal_ids?.length) {
      const { data: renewals } = await supabase
        .from("renewals")
        .select("id, account_name, arr, renewal_due, churn_risk, health_status, next_step, renewal_stage")
        .in("id", renewal_ids);

      (renewals || []).forEach((r: any) => {
        const daysToRenewal = Math.floor((new Date(r.renewal_due).getTime() - Date.now()) / 86400000);
        const snippets: string[] = [];
        snippets.push(`$${(r.arr / 1000).toFixed(0)}k`);
        snippets.push(`Due in ${daysToRenewal}d`);
        if (r.churn_risk && r.churn_risk !== 'low') snippets.push(`Risk: ${r.churn_risk}`);
        if (r.health_status) snippets.push(`Health: ${r.health_status}`);
        if (r.next_step) snippets.push(`Next: ${r.next_step.slice(0, 30)}`);

        contexts[`renewal:${r.id}`] = {
          type: 'renewal',
          id: r.id,
          name: r.account_name,
          snippet: snippets.join(' · '),
          arr: r.arr,
          daysToRenewal,
          churnRisk: r.churn_risk,
        };
      });
    }

    return new Response(JSON.stringify({ contexts }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("search-context error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
