import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listAccounts from "./tools/list-accounts";
import getAccount from "./tools/get-account";
import listOpportunities from "./tools/list-opportunities";
import listStrategyThreads from "./tools/list-strategy-threads";
import searchKnowledgeItems from "./tools/search-knowledge-items";

// Build the Supabase auth issuer from the inlined project ref so this entry
// stays import-safe (no runtime env reads at module load).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "dynamic-mcp",
  title: "Dynamic (Branch AE)",
  version: "0.1.0",
  instructions:
    "Tools for Corey Hartin's Branch expansion territory in the Dynamic app. Use list_accounts / get_account / list_opportunities to inspect the 14 enterprise accounts and their strategic POVs. Use list_strategy_threads to find recent strategy conversations, and search_knowledge_items to look up captured Knowledge Items. All tools act as the signed-in user; RLS applies.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listAccounts, getAccount, listOpportunities, listStrategyThreads, searchKnowledgeItems],
});
