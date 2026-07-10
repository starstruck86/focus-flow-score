import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Extract the "STRATEGIC POV" (and preceding "KEY NUMBERS") sections
// from an account dossier, matching the strategy-chat extraction shape.
function extractPov(md: string | null): string | null {
  if (!md) return null;
  const lines = md.split(/\r?\n/);
  const povIdx = lines.findIndex((l) => /^##\s+(00\s+[—-]\s+)?strategic pov\b/i.test(l));
  if (povIdx < 0) return null;
  let endIdx = lines.length;
  for (let i = povIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { endIdx = i; break; }
  }
  let startIdx = povIdx;
  for (let i = povIdx - 1; i >= 0; i--) {
    if (/^##\s+key numbers\b/i.test(lines[i])) { startIdx = i; break; }
    if (/^##\s+/.test(lines[i])) break;
  }
  return lines.slice(startIdx, endIdx).join("\n").slice(0, 5000);
}

export default defineTool({
  name: "get_account",
  title: "Get account",
  description: "Fetch a single account with its open opportunities and the Strategic POV excerpt from its current dossier.",
  inputSchema: {
    account_id: z.string().uuid().describe("Account UUID (use list_accounts to discover)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ account_id }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const sb = supabaseForUser(ctx);
    const userId = ctx.getUserId();
    const [{ data: acct, error: aErr }, { data: opps }, { data: dossier }] = await Promise.all([
      sb.from("active_accounts").select("id, name, industry, tier, motion, arr, notes").eq("user_id", userId).eq("id", account_id).maybeSingle(),
      sb.from("opportunities").select("id, name, stage, amount, close_date").eq("user_id", userId).eq("account_id", account_id).order("close_date", { ascending: true }),
      sb.from("account_dossiers").select("markdown, updated_at").eq("user_id", userId).eq("account_id", account_id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (aErr) return { content: [{ type: "text", text: aErr.message }], isError: true };
    if (!acct) return { content: [{ type: "text", text: "Account not found" }], isError: true };
    const pov = extractPov(dossier?.markdown ?? null);
    const payload = { account: acct, opportunities: opps ?? [], strategic_pov: pov, dossier_updated_at: dossier?.updated_at ?? null };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  },
});
