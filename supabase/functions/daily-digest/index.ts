import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Map digest categories to trigger_event types for account write-back
const CATEGORY_TO_TRIGGER: Record<string, string> = {
  executive_hire: "executive_hire",
  job_posting: "job_posting",
  company_news: "company_news",
  tech_change: "tech_change",
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
    } catch { /* no body = process all */ }

    // Get ALL accounts with current trigger_events for merge
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

    // Group by user
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
      // Check existing digest
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

      // Prioritize by tier then ICP score
      const sorted = [...userAccts].sort((a, b) => {
        const tierOrder: Record<string, number> = { A: 0, B: 1, C: 2 };
        const ta = tierOrder[a.tier || "C"] ?? 2;
        const tb = tierOrder[b.tier || "C"] ?? 2;
        if (ta !== tb) return ta - tb;
        return (b.icp_fit_score || 0) - (a.icp_fit_score || 0);
      });

      const accountsToScan = sorted.slice(0, 30);

      // Batch into groups of 10
      const batches: typeof accountsToScan[] = [];
      for (let i = 0; i < accountsToScan.length; i += 10) {
        batches.push(accountsToScan.slice(i, i + 10));
      }

      const digestItems: any[] = [];
      // Track account updates to apply after all batches
      const accountUpdates = new Map<string, { triggers: any[]; techStack: string[]; marketingPlatform: string | null; notes: string[] }>();

      for (const batch of batches) {
        const accountList = batch
          .map((a) => `- ${a.name}${a.website ? ` (${a.website})` : ""}${a.industry ? ` [${a.industry}]` : ""}`)
          .join("\n");

        const prompt = `You are a sales intelligence analyst. For EACH of the following companies, find the most recent and relevant updates from the past 7 days. Focus on:

1. **Executive hires** (especially CMO, VP Marketing, Head of CRM/Lifecycle/Retention/Loyalty)
2. **Marketing job postings** (lifecycle, CRM, retention, loyalty, email marketing roles)
3. **Company news** (fundraising, acquisitions, product launches, expansions, rebrands)
4. **Technology changes** (new martech stack adoption, platform migrations, marketing tools)

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
    "relevance": 1-100 score,
    "is_actionable": true if this is a direct trigger for outreach,
    "suggested_action": "brief suggested next step for the sales rep",
    "detected_tech": "name of marketing/CRM platform mentioned if any, null otherwise",
    "detected_platform": "marketing platform name if a migration or adoption was detected, null otherwise"
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
            // Fuzzy match: exact first, then includes
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
              raw_data: { citations, detected_tech: item.detected_tech, detected_platform: item.detected_platform },
            });

            // --- Collect account-level updates ---
            if (!accountUpdates.has(matchedAccount.id)) {
              accountUpdates.set(matchedAccount.id, {
                triggers: (matchedAccount.trigger_events as any[]) || [],
                techStack: (matchedAccount.tech_stack as string[]) || [],
                marketingPlatform: matchedAccount.marketing_platform_detected || null,
                notes: [],
              });
            }

            const update = accountUpdates.get(matchedAccount.id)!;

            // Add trigger event
            const triggerType = CATEGORY_TO_TRIGGER[item.category];
            if (triggerType) {
              // Deduplicate by headline
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

            // Detect tech stack additions
            if (item.detected_tech && typeof item.detected_tech === "string") {
              const tech = item.detected_tech.trim();
              if (tech && !update.techStack.some((t) => t.toLowerCase() === tech.toLowerCase())) {
                update.techStack.push(tech);
              }
            }

            // Detect marketing platform
            if (item.detected_platform && typeof item.detected_platform === "string") {
              update.marketingPlatform = item.detected_platform.trim();
            }

            // Build note
            if (item.is_actionable && item.headline) {
              update.notes.push(`[${todayStr}] ${item.headline}`);
            }
          }
        } catch (batchErr) {
          console.error("Error processing batch:", batchErr);
        }

        // Rate limit between batches
        if (batches.length > 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // --- Write back account-level data ---
      for (const [accountId, update] of accountUpdates) {
        const originalAccount = userAccts.find((a) => a.id === accountId);
        if (!originalAccount) continue;

        const accountUpdate: Record<string, any> = {
          updated_at: new Date().toISOString(),
        };

        // Merge trigger events (keep last 20, newest first)
        if (update.triggers.length > 0) {
          const merged = update.triggers
            .sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""))
            .slice(0, 20);
          accountUpdate.trigger_events = merged;
          accountUpdate.triggered_account = true;
        }

        // Update tech stack if new items detected
        const origTech = (originalAccount.tech_stack as string[]) || [];
        if (update.techStack.length > origTech.length) {
          accountUpdate.tech_stack = update.techStack;
        }

        // Update marketing platform if detected
        if (update.marketingPlatform) {
          accountUpdate.marketing_platform_detected = update.marketingPlatform;
        }

        // Append digest notes to existing notes
        if (update.notes.length > 0) {
          const existingNotes = originalAccount.notes || "";
          const digestNotes = `\n\n--- 📰 Daily Digest (${todayStr}) ---\n${update.notes.join("\n")}`;
          // Only append if not already there
          if (!existingNotes.includes(`Daily Digest (${todayStr})`)) {
            accountUpdate.notes = existingNotes + digestNotes;
          }
        }

        // Apply update
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

      // Insert digest items
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
