import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CATEGORY_TO_TRIGGER: Record<string, string> = {
  executive_hire: "executive_hire",
  job_posting: "job_posting",
  company_news: "company_news",
  tech_change: "tech_change",
  podcast: "podcast",
  company_goal: "company_goal",
  competitive_displacement: "competitive_displacement",
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

    let targetUserId: string | null = null;
    let forceRegenerate = false;
    try {
      const body = await req.json();
      targetUserId = body?.userId || null;
      forceRegenerate = !!targetUserId;
      // Validate userId format to prevent injection
      if (targetUserId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
        return new Response(
          JSON.stringify({ error: "Invalid userId format" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch { /* no body = process all */ }

    let query = supabase
      .from("accounts")
      .select("id, user_id, name, website, industry, lifecycle_tier, icp_fit_score, tier, trigger_events, notes, marketing_platform_detected, tech_stack");

    if (targetUserId) {
      query = query.eq("user_id", targetUserId);
    }

    const { data: accounts, error: acctError } = await query;
    if (acctError) throw acctError;
    if (!accounts || accounts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No accounts to scan", itemsCreated: 0, accountsUpdated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userAccounts = new Map<string, typeof accounts>();
    for (const acct of accounts) {
      const list = userAccounts.get(acct.user_id) || [];
      list.push(acct);
      userAccounts.set(acct.user_id, list);
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    let totalItems = 0;
    let totalAccountsUpdated = 0;

    for (const [userId, userAccts] of userAccounts) {
      const { count } = await supabase
        .from("daily_digest_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("digest_date", todayStr);

      if (count && count > 0 && !forceRegenerate) {
        console.log(`Digest already exists for ${userId}, skipping`);
        continue;
      }

      if (count && count > 0 && forceRegenerate) {
        await supabase
          .from("daily_digest_items")
          .delete()
          .eq("user_id", userId)
          .eq("digest_date", todayStr);
      }

      const sorted = [...userAccts].sort((a, b) => {
        const tierOrder: Record<string, number> = { A: 0, B: 1, C: 2 };
        const ta = tierOrder[a.tier || "C"] ?? 2;
        const tb = tierOrder[b.tier || "C"] ?? 2;
        if (ta !== tb) return ta - tb;
        return (b.icp_fit_score || 0) - (a.icp_fit_score || 0);
      });

      const accountsToScan = sorted.slice(0, 30);
      const batches: typeof accountsToScan[] = [];
      for (let i = 0; i < accountsToScan.length; i += 10) {
        batches.push(accountsToScan.slice(i, i + 10));
      }

      const digestItems: any[] = [];
      const accountUpdates = new Map<string, { triggers: any[]; techStack: string[]; marketingPlatform: string | null; notes: string[] }>();

      for (const batch of batches) {
        const accountList = batch
          .map((a) => {
            const currentPlatform = a.marketing_platform_detected ? ` [Current platform: ${a.marketing_platform_detected}]` : '';
            return `- ${a.name}${a.website ? ` (${a.website})` : ""}${a.industry ? ` [${a.industry}]` : ""}${currentPlatform}`;
          })
          .join("\n");

        const prompt = `You are a sales intelligence analyst for a rep selling lifecycle marketing / CRM / marketing automation software. For EACH company, find the most recent and relevant updates from the past 7 days. Be EXHAUSTIVE — never miss a signal.

Search for ALL of these categories:

1. **Executive hires** (CMO, VP Marketing, Head of CRM/Lifecycle/Retention/Loyalty, CDO, Chief Digital Officer)
2. **Marketing job postings** (lifecycle, CRM, retention, loyalty, email marketing, growth marketing roles — indicate seniority)
3. **Company news** (fundraising, acquisitions, product launches, expansions, rebrands, IPO, partnerships)
4. **Technology changes** (new martech stack adoption, platform migrations, marketing tool changes)
5. **Podcast appearances** (executives on podcasts, webinars, conference talks about marketing strategy, growth, customer retention)
6. **Company goals** (publicly stated goals like "increase retention by X%", "grow DTC by X%", strategic initiatives mentioned in earnings calls, press releases, interviews)
7. **Competitive displacement** (if a company's CURRENT marketing platform is listed, look for signals they are switching away from it or evaluating alternatives — job postings mentioning different platforms, case studies with new vendors, etc.)

Companies:
${accountList}

For each finding, respond in this exact JSON array format:
[
  {
    "company": "exact company name from list",
    "category": "executive_hire" | "job_posting" | "company_news" | "tech_change" | "podcast" | "company_goal" | "competitive_displacement",
    "headline": "factual headline — what happened, who was involved, key details (under 120 chars)",
    "summary": "one sentence with the key fact and any numbers/names — no fluff, no sales spin",
    "source_url": "URL where this was found (required if possible)",
    "relevance": 1-100 score (100 = strongest buying signal),
    "is_actionable": true if this is a direct trigger for outreach,
    "suggested_action": "specific suggested next step for the sales rep",
    "detected_tech": "name of marketing/CRM platform mentioned if any, null otherwise",
    "detected_platform": "marketing platform name if a migration or adoption was detected, null otherwise"
  }
]

IMPORTANT: Headlines should be factual and specific — include names, numbers, and dates. Do NOT summarize or editorialize. If no recent updates found for a company, omit it. Return ONLY the JSON array. If nothing found, return [].`;

        try {
          const response = await fetch("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${perplexityKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "sonar-pro",
              messages: [
                { role: "system", content: "You are a precise sales intelligence analyst. Return ONLY valid JSON arrays. No markdown, no explanation. Be thorough — never miss a signal." },
                { role: "user", content: prompt },
              ],
              temperature: 0.1,
              search_recency_filter: "week",
            }),
          });

          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "[]";
          const citations = data.citations || [];

          let items: any[] = [];
          try {
            const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
            items = JSON.parse(cleaned);
          } catch {
            console.error("Failed to parse Perplexity response:", content.slice(0, 200));
            continue;
          }

          if (!Array.isArray(items)) continue;

          for (const item of items) {
            let matchedAccount = batch.find(
              (a) => a.name.toLowerCase() === item.company?.toLowerCase()
            );
            if (!matchedAccount) {
              matchedAccount = batch.find(
                (a) => a.name.toLowerCase().includes(item.company?.toLowerCase()) ||
                  item.company?.toLowerCase().includes(a.name.toLowerCase())
              );
            }
            if (!matchedAccount) continue;

            // Deduplicate: skip if we already have this headline for this account
            const isDuplicate = digestItems.some(
              (d) => d.account_id === matchedAccount!.id && d.headline === item.headline?.slice(0, 200)
            );
            if (isDuplicate) continue;

            digestItems.push({
              user_id: userId,
              account_id: matchedAccount.id,
              account_name: matchedAccount.name,
              digest_date: todayStr,
              category: item.category || "company_news",
              headline: item.headline?.slice(0, 200) || "Update found",
              summary: item.summary || null,
              source_url: item.source_url || null,
              relevance_score: Math.min(100, Math.max(0, item.relevance || 50)),
              is_read: false,
              is_actionable: item.is_actionable || false,
              suggested_action: item.suggested_action || null,
              raw_data: { citations, detected_tech: item.detected_tech, detected_platform: item.detected_platform },
            });

            if (!accountUpdates.has(matchedAccount.id)) {
              accountUpdates.set(matchedAccount.id, {
                triggers: (matchedAccount.trigger_events as any[]) || [],
                techStack: (matchedAccount.tech_stack as string[]) || [],
                marketingPlatform: matchedAccount.marketing_platform_detected || null,
                notes: [],
              });
            }

            const update = accountUpdates.get(matchedAccount.id)!;

            const triggerType = CATEGORY_TO_TRIGGER[item.category];
            if (triggerType) {
              const exists = update.triggers.some(
                (t: any) => t.headline === item.headline
              );
              if (!exists) {
                update.triggers.push({
                  type: triggerType,
                  headline: item.headline?.slice(0, 200),
                  date: todayStr,
                  source: item.source_url || "daily_digest",
                  relevance: item.relevance || 50,
                });
              }
            }

            if (item.detected_tech && typeof item.detected_tech === "string") {
              const tech = item.detected_tech.trim();
              if (tech && !update.techStack.some((t) => t.toLowerCase() === tech.toLowerCase())) {
                update.techStack.push(tech);
              }
            }

            if (item.detected_platform && typeof item.detected_platform === "string") {
              update.marketingPlatform = item.detected_platform.trim();
            }

            if (item.headline) {
              const sourceLink = item.source_url ? ` [${item.source_url}]` : '';
              update.notes.push(`[${todayStr}] ${item.headline}${sourceLink}`);
            }
          }
        } catch (batchErr) {
          console.error("Error processing batch:", batchErr);
        }

        if (batches.length > 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // Write back account-level data
      for (const [accountId, update] of accountUpdates) {
        const originalAccount = userAccts.find((a) => a.id === accountId);
        if (!originalAccount) continue;

        const accountUpdate: Record<string, any> = {
          updated_at: new Date().toISOString(),
        };

        if (update.triggers.length > 0) {
          const merged = update.triggers
            .sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""))
            .slice(0, 20);
          accountUpdate.trigger_events = merged;
          accountUpdate.triggered_account = true;
        }

        const origTech = (originalAccount.tech_stack as string[]) || [];
        if (update.techStack.length > origTech.length) {
          accountUpdate.tech_stack = update.techStack;
        }

        if (update.marketingPlatform) {
          accountUpdate.marketing_platform_detected = update.marketingPlatform;
        }

        if (update.notes.length > 0) {
          const existingNotes = originalAccount.notes || "";
          const digestNotes = `\n\n--- 📰 Daily Digest (${todayStr}) ---\n${update.notes.join("\n")}`;
          if (!existingNotes.includes(`Daily Digest (${todayStr})`)) {
            accountUpdate.notes = existingNotes + digestNotes;
          }
        }

        const { error: updateError } = await supabase
          .from("accounts")
          .update(accountUpdate)
          .eq("id", accountId);

        if (updateError) {
          console.error(`Failed to update account ${accountId}:`, updateError);
        } else {
          totalAccountsUpdated++;
          console.log(`Updated account ${originalAccount.name}: triggers=${update.triggers.length}, tech=${update.techStack.length}`);
        }
      }

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
      JSON.stringify({
        success: true,
        itemsCreated: totalItems,
        accountsUpdated: totalAccountsUpdated,
        usersProcessed: userAccounts.size,
      }),
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
