// ════════════════════════════════════════════════════════════════
// Strategy Core — Server-side Context Assembly
//
// Mirror of the client-side buildPrepContext: pulls account, top
// contacts, and the most recent transcript for an account, and
// formats a compact text block ready to inject into any Strategy
// Core prompt.
//
// PR #1 scope: this file is INTRODUCED but NOT YET WIRED. Discovery
// Prep continues to receive its inputs from the caller (the existing
// run-discovery-prep edge function builds the inputs object). PR #2
// will use this from strategy-chat so chat assembles the same context
// the prep doc gets.
// ════════════════════════════════════════════════════════════════

export interface AssembledStrategyContext {
  account: {
    id: string;
    name: string;
    industry: string | null;
    website: string | null;
    techStack: string[];
    ecommerce: string | null;
    marTech: string | null;
    marketingPlatformDetected: string | null;
    notes: string | null;
  } | null;
  contacts: Array<{
    name: string;
    title: string | null;
    buyerRole: string | null;
    seniority: string | null;
    department: string | null;
    influenceLevel: string | null;
  }>;
  latestTranscript: {
    title: string;
    callDate: string;
    summary: string | null;
    content: string;
    callType: string | null;
    participants: string | null;
  } | null;
  /** Compact text block ready for prompt injection. Empty string when no signal. */
  contextBlock: string;
}

const EMPTY: AssembledStrategyContext = {
  account: null,
  contacts: [],
  latestTranscript: null,
  contextBlock: "",
};

/**
 * Build the standard Strategy Core context pack for a given account.
 *
 * Caller is responsible for passing a Supabase client with the
 * appropriate auth context. RLS is the trust boundary; we do not
 * second-guess it here.
 */
export async function assembleStrategyContext(args: {
  supabase: any;
  userId: string;
  accountId?: string | null;
}): Promise<AssembledStrategyContext> {
  const { supabase, userId, accountId } = args;
  if (!accountId) return EMPTY;

  try {
    const [accountRes, contactsRes, transcriptRes] = await Promise.all([
      supabase
        .from("accounts")
        .select(
          "id, name, industry, website, tech_stack, ecommerce, mar_tech, marketing_platform_detected, notes",
        )
        .eq("id", accountId)
        .maybeSingle(),
      supabase
        .from("contacts")
        .select("name, title, buyer_role, seniority, department, influence_level")
        .eq("account_id", accountId)
        .eq("user_id", userId)
        .order("influence_level", { ascending: false })
        .limit(10),
      supabase
        .from("call_transcripts")
        .select("title, call_date, summary, content, call_type, participants")
        .eq("account_id", accountId)
        .eq("user_id", userId)
        .order("call_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const acct = accountRes?.data ?? null;
    const account = acct
      ? {
          id: acct.id,
          name: acct.name,
          industry: acct.industry,
          website: acct.website,
          techStack: acct.tech_stack || [],
          ecommerce: acct.ecommerce,
          marTech: acct.mar_tech,
          marketingPlatformDetected: acct.marketing_platform_detected,
          notes: acct.notes,
        }
      : null;

    const contacts = (contactsRes?.data || []).map((c: any) => ({
      name: c.name,
      title: c.title,
      buyerRole: c.buyer_role,
      seniority: c.seniority,
      department: c.department,
      influenceLevel: c.influence_level,
    }));

    const t = transcriptRes?.data ?? null;
    const latestTranscript = t
      ? {
          title: t.title,
          callDate: t.call_date,
          summary: t.summary,
          content: t.content,
          callType: t.call_type,
          participants: t.participants,
        }
      : null;

    const contextBlock = buildContextBlock(account, contacts, latestTranscript);
    return { account, contacts, latestTranscript, contextBlock };
  } catch (e) {
    console.warn("[strategy-core/contextAssembly] failed:", (e as Error).message);
    return EMPTY;
  }
}

function buildContextBlock(
  account: AssembledStrategyContext["account"],
  contacts: AssembledStrategyContext["contacts"],
  transcript: AssembledStrategyContext["latestTranscript"],
): string {
  const parts: string[] = [];

  if (account) {
    const info: string[] = [`Account: ${account.name}`];
    if (account.industry) info.push(`Industry: ${account.industry}`);
    if (account.website) info.push(`Website: ${account.website}`);
    if (account.techStack.length) info.push(`Tech Stack: ${account.techStack.join(", ")}`);
    if (account.marTech) info.push(`MarTech: ${account.marTech}`);
    if (account.marketingPlatformDetected) {
      info.push(`Marketing Platform: ${account.marketingPlatformDetected}`);
    }
    if (account.ecommerce) info.push(`Ecommerce: ${account.ecommerce}`);
    parts.push(info.join("\n"));
    if (account.notes) parts.push(`Account Notes:\n${account.notes}`);
  }

  if (contacts.length) {
    const lines = contacts.map((c) => {
      const details = [c.title, c.buyerRole, c.department].filter(Boolean).join(" · ");
      return `- ${c.name}${details ? ` (${details})` : ""}`;
    });
    parts.push(`Key Contacts:\n${lines.join("\n")}`);
  }

  if (transcript) {
    const tParts = [`Latest Call: ${transcript.title} (${transcript.callDate})`];
    if (transcript.callType) tParts.push(`Type: ${transcript.callType}`);
    if (transcript.participants) tParts.push(`Participants: ${transcript.participants}`);
    if (transcript.summary) tParts.push(`Summary: ${transcript.summary}`);
    const preview = transcript.content.length > 2000
      ? transcript.content.slice(0, 2000) + "\n[...transcript truncated]"
      : transcript.content;
    tParts.push(`Transcript:\n${preview}`);
    parts.push(tParts.join("\n"));
  }

  return parts.join("\n\n");
}
