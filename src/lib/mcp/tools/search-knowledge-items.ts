import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "search_knowledge_items",
  title: "Search knowledge items",
  description: "Case-insensitive substring search across the user's Knowledge Items (title + summary).",
  inputSchema: {
    query: z.string().min(2).describe("Search term."),
    limit: z.number().int().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const like = `%${query}%`;
    const { data, error } = await supabaseForUser(ctx)
      .from("knowledge_items")
      .select("id, title, summary, category, confidence_score")
      .eq("user_id", ctx.getUserId())
      .or(`title.ilike.${like},summary.ilike.${like}`)
      .order("confidence_score", { ascending: false, nullsFirst: false })
      .limit(limit ?? 20);
    return error
      ? { content: [{ type: "text", text: error.message }], isError: true }
      : { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { rows: data ?? [] } };
  },
});
