import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_opportunities",
  title: "List opportunities",
  description: "List the signed-in user's opportunities, optionally filtered by account or stage.",
  inputSchema: {
    account_id: z.string().uuid().optional().describe("Optional account UUID filter."),
    stage: z.string().optional().describe("Optional exact stage match."),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ account_id, stage, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = supabaseForUser(ctx)
      .from("opportunities")
      .select("id, name, account_id, stage, amount, close_date, next_step")
      .eq("user_id", ctx.getUserId())
      .order("close_date", { ascending: true })
      .limit(limit ?? 50);
    if (account_id) q = q.eq("account_id", account_id);
    if (stage) q = q.eq("stage", stage);
    const { data, error } = await q;
    return error
      ? { content: [{ type: "text", text: error.message }], isError: true }
      : { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { rows: data ?? [] } };
  },
});
