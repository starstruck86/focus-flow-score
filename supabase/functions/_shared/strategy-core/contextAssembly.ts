// ════════════════════════════════════════════════════════════════
// Strategy Core — Server-side Context Assembly
//
// Mirror of the client-side buildPrepContext: pulls account, top
// contacts, and the most recent transcript for an account, and
// formats a compact text block ready to inject into any Strategy
// Core prompt.
//
// W3 (Retrieval Enforcement) extension:
//   • Optionally accepts a resolved WorkspaceContract's retrievalRules.
//   • When provided, the rendered contextBlock is reordered per
//     `contextMode` (thread_first | draft_first | artifact_first |
//     project_first) using `orderContextBlocks` from
//     retrievalEnforcement.ts.
//   • When omitted, behavior is byte-identical to the pre-W3 output
//     (back-compat for existing strategy-chat / runTask callers that
//     have not yet threaded a contract through).
//
// W3 does NOT change library / web retrieval inside this file — those
// are gated by `decideLibraryQuery` / `decideWebQuery` at the call
// site. This module only owns account/contact/transcript context and
// its ordering.
// ════════════════════════════════════════════════════════════════

import type { RetrievalRules } from "./workspaceContractTypes.ts";
import {
  orderContextBlocks,
  type OrderableContextBlock,
} from "./retrievalEnforcement.ts";

export interface AssembledStrategyContext {
  account: {
    id: string;
    name: string;
    industry: string | null;
    website: string | null;
    techStack: string[];
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
  /**
   * Pre-fetched branch_footprint row for the linked account (the spine
   * already fetches this — we just inject it here so the assembled
   * context block is the single canonical source of account context).
   * Pass `null` or omit if not available; the BRANCH FOOTPRINT block is
   * then skipped silently.
   */
  branchFootprint?: Record<string, any> | null;
  /**
   * Optional W3 input. When supplied, the rendered `contextBlock`
   * orders its constituent sections per `contextMode`. Library/web
   * decisions are NOT made here — those are owned by the call site
   * via `retrievalEnforcement`.
   */
  retrievalRules?: RetrievalRules;
}): Promise<AssembledStrategyContext> {
  const { supabase, userId, accountId, branchFootprint, retrievalRules } = args;
  if (!accountId) return EMPTY;

  try {
    const [accountRes, contactsRes, transcriptRes] = await Promise.all([
      supabase
        .from("accounts")
        .select(
          "id, name, industry, website, tech_stack, notes",
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

    const contextBlock = buildContextBlock(
      account,
      contacts,
      latestTranscript,
      branchFootprint ?? null,
      retrievalRules,
    );
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
  branchFootprint: Record<string, any> | null,
  retrievalRules: RetrievalRules | undefined,
): string {
  // Pre-W3 behavior: account → contacts → transcript, joined.
  // The mapping below preserves that exact ordering when no
  // retrievalRules are supplied (back-compat).
  const blocks: OrderableContextBlock[] = [];

  if (account) {
    const info: string[] = [`Account: ${account.name}`];
    if (account.industry) info.push(`Industry: ${account.industry}`);
    if (account.website) info.push(`Website: ${account.website}`);
    if (account.techStack.length) info.push(`Tech Stack: ${account.techStack.join(", ")}`);
    let text = info.join("\n");
    if (account.notes) text += `\n\nAccount Notes:\n${account.notes}`;
    // Account record is part of the project/account stream — kind: "account".
    blocks.push({ kind: "account", label: "account", text });
  }

  // BRANCH FOOTPRINT — only injected when branch_footprint row exists for
  // the linked account. Per-product status lines, plus commercial metadata
  // (ARR, renewal, relationship owner) and notes. Each field skipped silently
  // when null/empty.
  if (branchFootprint) {
    const fp = branchFootprint;
    const has = (v: unknown) =>
      v !== null && v !== undefined && String(v).trim().length > 0;
    const PRODUCTS: Array<[string, string]> = [
      ["deep_linking", "Deep Linking"],
      ["universal_ads", "Universal Ads"],
      ["email_to_app", "Email-to-App"],
      ["sms_to_app", "SMS-to-App"],
      ["web_to_app", "Web-to-App"],
      ["qr", "QR"],
      ["aio", "AIO"],
      ["advanced_privacy", "Advanced Privacy"],
    ];
    const productLines: string[] = [];
    for (const [key, label] of PRODUCTS) {
      const status = fp[`${key}_status`];
      if (!has(status)) continue;
      const useCase = fp[`${key}_use_case`];
      productLines.push(
        `${label}: ${status}${has(useCase) ? ` — ${useCase}` : ""}`,
      );
    }
    const metaLines: string[] = [];
    if (has(fp.estimated_arr)) metaLines.push(`Estimated ARR: ${fp.estimated_arr}`);
    if (has(fp.contract_renewal_date)) metaLines.push(`Renewal: ${fp.contract_renewal_date}`);
    if (has(fp.relationship_owner)) metaLines.push(`Relationship owner: ${fp.relationship_owner}`);
    if (has(fp.notes)) metaLines.push(`Notes: ${fp.notes}`);

    const fpLines = [...productLines, ...metaLines];
    if (fpLines.length) {
      blocks.push({
        kind: "account",
        label: "branch_footprint",
        text: `## BRANCH FOOTPRINT\n${fpLines.join("\n")}`,
      });
    }
  }

  if (contacts.length) {
    const lines = contacts.map((c) => {
      const details = [c.title, c.buyerRole, c.department].filter(Boolean).join(" · ");
      return `- ${c.name}${details ? ` (${details})` : ""}`;
    });
    // Contacts continue the project/account picture.
    blocks.push({
      kind: "account",
      label: "contacts",
      text: `Key Contacts:\n${lines.join("\n")}`,
    });
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
    // Latest call transcript is the closest analog to "thread" within
    // the assembled-context stream, so it ranks under thread_first.
    blocks.push({
      kind: "thread",
      label: "latest_transcript",
      text: tParts.join("\n"),
    });
  }

  const ordered = retrievalRules
    ? orderContextBlocks(blocks, retrievalRules)
    : blocks;

  return ordered
    .map((b) => b.text)
    .filter((t) => t && t.length > 0)
    .join("\n\n");
}

