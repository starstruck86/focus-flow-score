import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const perplexityKey = Deno.env.get("PERPLEXITY_API_KEY");
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    if (!perplexityKey) {
      throw new Error("PERPLEXITY_API_KEY not configured");
    }

    // Optional: target a specific user (for manual trigger) or process all
    let targetUserId: string | null = null;
    let forceRegenerate = false;
    try {
      const body = await req.json();
      targetUserId = body?.userId || null;
      forceRegenerate = !!targetUserId; // Manual triggers always regenerate
    } catch { /* no body = process all */ }

    // Get ALL accounts (not just enriched ones)
    let query = supabase
      .from("accounts")
      .select("id, user_id, name, website, industry, lifecycle_tier, icp_fit_score, tier");

    if (targetUserId) {
      query = query.eq("user_id", targetUserId);
    }

    const { data: accounts, error: acctError } = await query;
    if (acctError) throw acctError;
    if (!accounts || accounts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No accounts to scan", itemsCreated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Group accounts by user
    const userAccounts = new Map<string, typeof accounts>();
    for (const acct of accounts) {
      const list = userAccounts.get(acct.user_id) || [];
      list.push(acct);
      userAccounts.set(acct.user_id, list);
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    let totalItems = 0;

    for (const [userId, userAccts] of userAccounts) {
      // Check if digest already generated today for this user
      const { count } = await supabase
        .from("daily_digest_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("digest_date", todayStr);

      if (count && count > 0 && !forceRegenerate) {
        console.log(`Digest already generated for user ${userId} on ${todayStr}, skipping`);
        continue;
      }

      // If regenerating, delete old items first
      if (count && count > 0 && forceRegenerate) {
        await supabase
          .from("daily_digest_items")
          .delete()
          .eq("user_id", userId)
          .eq("digest_date", todayStr);
        console.log(`Cleared existing digest for user ${userId} to regenerate`);
      }

      // Prioritize: sort by tier (A first), then by ICP score
      const sorted = [...userAccts].sort((a, b) => {
        const tierOrder: Record<string, number> = { A: 0, B: 1, C: 2 };
        const ta = tierOrder[a.tier || 'C'] ?? 2;
        const tb = tierOrder[b.tier || 'C'] ?? 2;
        if (ta !== tb) return ta - tb;
        return (b.icp_fit_score || 0) - (a.icp_fit_score || 0);
      });

      // Cap at 30 accounts to avoid excessive API calls
      const accountsToScan = sorted.slice(0, 30);

      // Batch accounts into groups of 10 for Perplexity queries
      const batches: typeof userAccts[] = [];
      for (let i = 0; i < userAccts.length; i += 10) {
        batches.push(userAccts.slice(i, i + 10));
      }

      const digestItems: any[] = [];

      for (const batch of batches) {
        const accountList = batch.map(a => `- ${a.name}${a.website ? ` (${a.website})` : ''}${a.industry ? ` [${a.industry}]` : ''}`).join('\n');

        const prompt = `You are a sales intelligence analyst. For EACH of the following companies, find the most recent and relevant updates from the past 7 days. Focus on:

1. **Executive hires** (especially CMO, VP Marketing, Head of CRM/Lifecycle/Retention/Loyalty)
2. **Marketing job postings** (lifecycle, CRM, retention, loyalty, email marketing roles)
3. **Company news** (fundraising, acquisitions, product launches, expansions, rebrands)
4. **Technology changes** (new martech stack adoption, platform migrations)

Companies:
${accountList}

For each company where you find something, respond in this exact JSON format (array):
[
  {
    "company": "exact company name from list",
    "category": "executive_hire" | "job_posting" | "company_news" | "tech_change",
    "headline": "short headline (under 100 chars)",
    "summary": "2-3 sentence summary of what happened and why it matters for a sales rep selling marketing/CRM/lifecycle software",
    "source_url": "URL if available, null otherwise",
    "relevance": 1-100 score of how relevant this is for someone selling lifecycle marketing software,
    "is_actionable": true if this is a direct trigger for outreach,
    "suggested_action": "brief suggested next step for the sales rep"
  }
]

If no recent updates found for a company, omit it. Return ONLY the JSON array, no other text. If nothing found for any company, return [].`;

        try {
          const response = await fetch("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${perplexityKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "sonar",
              messages: [
                { role: "system", content: "You are a precise sales intelligence analyst. Return ONLY valid JSON arrays. No markdown, no explanation." },
                { role: "user", content: prompt },
              ],
              temperature: 0.1,
              search_recency_filter: "week",
            }),
          });

          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "[]";
          const citations = data.citations || [];

          // Parse the JSON response
          let items: any[] = [];
          try {
            // Strip markdown code fences if present
            const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
            items = JSON.parse(cleaned);
          } catch (parseErr) {
            console.error("Failed to parse Perplexity response:", content);
            continue;
          }

          if (!Array.isArray(items)) continue;

          for (const item of items) {
            const matchedAccount = batch.find(
              a => a.name.toLowerCase() === item.company?.toLowerCase()
            );
            if (!matchedAccount) continue;

            digestItems.push({
              user_id: userId,
              account_id: matchedAccount.id,
              account_name: matchedAccount.name,
              digest_date: todayStr,
              category: item.category || "news",
              headline: item.headline?.slice(0, 200) || "Update found",
              summary: item.summary || null,
              source_url: item.source_url || null,
              relevance_score: Math.min(100, Math.max(0, item.relevance || 50)),
              is_read: false,
              is_actionable: item.is_actionable || false,
              suggested_action: item.suggested_action || null,
              raw_data: { citations },
            });
          }
        } catch (batchErr) {
          console.error("Error processing batch:", batchErr);
        }

        // Rate limit between batches
        if (batches.length > 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // Insert all digest items for this user
      if (digestItems.length > 0) {
        const { error: insertError } = await supabase
          .from("daily_digest_items")
          .insert(digestItems);

        if (insertError) {
          console.error(`Failed to insert digest items for user ${userId}:`, insertError);
        } else {
          totalItems += digestItems.length;
          console.log(`Created ${digestItems.length} digest items for user ${userId}`);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, itemsCreated: totalItems, usersProcessed: userAccounts.size }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Daily digest error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
