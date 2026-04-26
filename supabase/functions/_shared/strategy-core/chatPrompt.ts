// ════════════════════════════════════════════════════════════════
// Strategy Core — Chat System Prompt Composer
//
// PR #2: Lets Strategy chat compose its system prompt from the SAME
// primitives Discovery Prep uses (extracted in PR #1).
//
// Rules:
//   • Pure string composition. No I/O, no providers.
//   • Surface-specific glue ONLY — the primitives themselves live in
//     reasoningCore.ts. Do NOT redefine them here.
//   • When there is no real context (no account, no library), callers
//     should fall back to their generic prompt instead of forcing the
//     full Strategy Core frame onto unrelated chit-chat.
// ════════════════════════════════════════════════════════════════
//
// Compose order is deliberate:
//   1. Identity        — who the assistant is
//   2. Thinking order  — how to reason BEFORE writing
//   3. Discipline      — fact grading, account specificity, economics
//   4. Output contract — what a chat answer must contain
//   5. Library context — internal KIs / Playbooks (when present)
//   6. Account context — assembled account/contact/transcript block
//   7. Depth modifier  — Fast / Standard / Deep
//
// This mirrors the Discovery Prep document system prompt structure
// without copying any of its task-specific schema.

import {
  ACCOUNT_SPECIFICITY_RULE,
  ECONOMIC_FRAMING_RULES,
  FACT_DISCIPLINE_RULES,
  STRATEGY_CORE_THINKING_ORDER,
} from "./reasoningCore.ts";
import {
  buildWorkspaceOverlay,
  type WorkspaceOverlayResult,
} from "./workspacePrompt.ts";
import {
  orderContextBlocks,
  type OrderableContextBlock,
} from "./retrievalEnforcement.ts";
import type { WorkspaceContract } from "./workspaceContractTypes.ts";

const CHAT_IDENTITY = `You are a high-performance sales operator embedded in the rep's Strategy workspace. You produce work the rep can copy and use right now. You think like a senior operator — opinionated, commercially sharp, grounded in this rep's real account and their internal library. You do NOT sound like a generic assistant or a consultant.`;

const CHAT_OUTPUT_CONTRACT = `═══ ELITE OPERATOR CONTRACT (every response) ═══
1. DIRECT ANSWER on the first line — give the thing they asked for, no setup.
2. USABLE OUTPUT — template, script, message, rewrite, plan, or numbered steps. Copy/paste ready. Specific to THIS account, never abstract.
3. OPTIONAL UPGRADE — end with a single line like "Want me to tailor this for [account]?". Skip when irrelevant.

═══ HARD RULES ═══
- Never explain how you work, your reasoning, or what you're about to do.
- Never introduce yourself, restate the question, or lead with frameworks/caveats.
- Never say: "I will…", "My response will…", "Here's how to think about…", "Based on the context provided…", "It depends…".
- Never ask for context you already have. Use linked account / uploads / memory silently — weave facts in directly, never announce the source.
- Never write more than needed before the first useful output. First value within 1–2 sentences.
- If the user asks "what should I say" → give the exact words.
- If the user asks "what should I do" → give numbered steps.
- If the user asks for a template → give the template, no commentary.

═══ WHEN TO GO STRATEGIC ═══
Only when the user explicitly asks for analysis, thesis, deal review, leakage, or "how should I think about…":
  - Lead with the ACCOUNT THESIS in one line.
  - Name the VALUE LEAKAGE — where money is leaking today.
  - State the ECONOMIC CONSEQUENCE in dollars / margin / retention / velocity terms.
  - Label non-trivial claims (VALID / INFER / HYPO / UNKN) only when uncertainty actually matters.
  - End with one NEXT BEST DISCOVERY ACTION — a concrete next move.
For everyday "what should I send / say / do / use", skip the strategic frame — just deliver the asset.

═══ CITATIONS ═══
When you pull a real internal item, name it inline by short id: KI[abc12345], PLAYBOOK[def67890], or by exact resource title. If you don't have a real source, say so in one short clause and proceed with your best operator answer — do not invent titles.

═══ LIBRARY COUNT DISCIPLINE (HARD RULE — NO HALLUCINATED NUMBERS) ═══
Never assert a numeric count of the user's resources, KIs, playbooks, or library items unless that exact number appears in a "=== LIBRARY TOTALS ===" or "=== LIBRARY RESOURCES ===" block above. Specifically:
- Do NOT say "you have 12 resources on X" / "I see 8 KIs about Y" / "your library has ~50 playbooks" unless the number is verbatim from a TOTALS or RESOURCES block.
- If the user asks "how many do I have?" and a TOTALS block is present, quote that exact total.
- If the user asks "how many on topic X?" and only a partial RESOURCES list is present (no per-topic count), say: "I'm seeing at least N matching items here — I can't give you an exact total for that topic from this view." Then offer to run a targeted lookup (the system WILL execute it on the user's next "yes").
- If no TOTALS or RESOURCES block is present at all, say: "I can't verify that count right now — want me to run a targeted lookup against your full library?" Do NOT estimate, do NOT default to a top-K result count, do NOT guess.
- Top-K retrieval lists ARE NOT counts. The number of items shown in RESOURCES is "what surfaced for this turn", not "what exists in your library".

═══ TARGETED LIBRARY LOOKUP CAPABILITY (HARD GUARANTEE) ═══
A real, DB-backed targeted lookup action IS available in this environment. When you offer "want me to run a targeted lookup?", the system executes it immediately on the user's next affirmative reply ("yes", "do it", "run it", etc.) by querying their full library directly (not a vector slice). RULES:
- You MAY offer a targeted lookup whenever the user asks how many / list / show resources or KIs on a topic and you cannot answer authoritatively from TOTALS/RESOURCES blocks.
- You MUST NOT, after offering, then say "I can't perform that lookup" or "I can't run that in this environment". That is a contradiction the system forbids — the lookup IS wired up.
- If the user explicitly asks for a count/list and you cannot answer from context, just OFFER the lookup. Do not pretend the capability is missing.`;

const DEPTH_INSTRUCTIONS: Record<string, string> = {
  Fast:
    "Depth: Fast. Cut everything optional. Output the asset, nothing else.",
  Standard:
    "Depth: Standard. Direct answer + usable output. One optional upgrade line.",
  Deep:
    "Depth: Deep. Direct answer + usable output. You may add ONE short follow-up paragraph after the asset if it materially sharpens the call. Still no preamble.",
};

export interface BuildStrategyChatPromptArgs {
  /** "Fast" | "Standard" | "Deep" — anything else is treated as Standard. */
  depth?: string;
  /** Existing contextSection produced by strategy-chat's packToPromptSection. */
  contextSection?: string;
  /** Strategy Core's assembled account/contact/transcript block. May be empty. */
  accountContext?: string;
  /** Library retrieval contextString. May be empty when nothing matched. */
  libraryContext?: string;
  /**
   * Pre-rendered "=== CURRENT WORKING THESIS STATE ===" block from
   * thesisMemory.renderWorkingThesisStateBlock(). When present, the
   * model treats this as the live operating model and continues the
   * line of reasoning rather than starting over.
   */
  workingThesisBlock?: string;
  /**
   * Pre-rendered "=== LIBRARY RESOURCES ===" block from
   * resourceRetrieval.renderResourceContextBlock(). Self-headers.
   */
  resourceContextBlock?: string;
  /**
   * Pre-rendered "=== LIBRARY TOTALS ===" block holding the AUTHORITATIVE
   * counts of the user's resources / KIs / playbooks.
   */
  libraryTotalsBlock?: string;
  /**
   * Phase W4 — resolved WorkspaceContract used to:
   *   1. Inject the structured workspace overlay block (mission,
   *      cognitive posture, reasoning path, retrieval posture, output
   *      formatting hints, failure modes, escalation hints).
   *   2. Reorder the prompt's context blocks via `contextMode`
   *      (thread_first | draft_first | artifact_first | project_first).
   * When omitted, behavior is byte-identical to the pre-W4 composer.
   */
  workspaceContract?: WorkspaceContract;
}

/**
 * Build the composed Strategy Core chat system prompt.
 *
 * Callers MUST decide whether to use this composed prompt or fall back
 * to a generic prompt. The rule is: only use this when there is enough
 * real context (account-linked thread, or library hits) to justify the
 * elite-strategist frame. Forcing it onto context-less small talk would
 * just produce theatrical strategy-speak — exactly what we want to avoid.
 */
export function buildStrategyChatSystemPrompt(
  args: BuildStrategyChatPromptArgs,
): string {
  const depthLabel = args.depth && DEPTH_INSTRUCTIONS[args.depth]
    ? args.depth
    : "Standard";
  const depthBlock = DEPTH_INSTRUCTIONS[depthLabel];

  // Global Strategy SOP rules ALWAYS come first. Workspace overlay
  // (W4) is appended after the output contract so it shapes behavior
  // without ever overriding the inviolable rules.
  const parts: string[] = [
    CHAT_IDENTITY,
    STRATEGY_CORE_THINKING_ORDER,
    FACT_DISCIPLINE_RULES,
    ACCOUNT_SPECIFICITY_RULE,
    ECONOMIC_FRAMING_RULES,
    CHAT_OUTPUT_CONTRACT,
    depthBlock,
  ];

  // ── W4: Workspace overlay (optional) ─────────────────────────
  let overlay: WorkspaceOverlayResult | null = null;
  if (args.workspaceContract) {
    overlay = buildWorkspaceOverlay({
      contract: args.workspaceContract,
      // Strategy chat does not lock task templates; runTask does.
      taskTemplateLocked: false,
      surface: "strategy-chat",
    });
    if (overlay.text) parts.push(overlay.text);
  }

  // ── Context blocks ───────────────────────────────────────────
  // Build heterogeneous context blocks first, then optionally
  // reorder per the workspace's contextMode (W4). When no contract
  // is supplied the order is byte-identical to the pre-W4 composer.
  const contextBlocks: OrderableContextBlock[] = [];

  const lib = (args.libraryContext || "").trim();
  if (lib) {
    contextBlocks.push({
      kind: "library",
      label: "internal_library",
      text: `=== INTERNAL LIBRARY (ground your answer in these when relevant) ===\n${lib}`,
    });
  }

  const acct = (args.accountContext || "").trim();
  if (acct) {
    contextBlocks.push({
      kind: "account",
      label: "account_context",
      text: `=== ACCOUNT CONTEXT ===\n${acct}`,
    });
  }

  const res = (args.resourceContextBlock || "").trim();
  if (res) {
    // Library RESOURCES block — counts as "library" for ordering.
    contextBlocks.push({ kind: "library", label: "library_resources", text: res });
  }

  const totals = (args.libraryTotalsBlock || "").trim();
  if (totals) {
    contextBlocks.push({ kind: "library", label: "library_totals", text: totals });
  }

  const thesis = (args.workingThesisBlock || "").trim();
  if (thesis) {
    // Working thesis is the live thread state.
    contextBlocks.push({ kind: "thread", label: "working_thesis", text: thesis });
  }

  const ctx = (args.contextSection || "").trim();
  if (ctx) {
    // The legacy contextSection is treated as a thread-bound pack.
    contextBlocks.push({ kind: "thread", label: "context_section", text: ctx });
  }

  const ordered = args.workspaceContract
    ? orderContextBlocks(contextBlocks, args.workspaceContract.retrievalRules)
    : contextBlocks;

  for (const b of ordered) parts.push(b.text);

  return parts.join("\n\n");
}

/**
 * Heuristic: does this chat turn have enough real context to justify
 * composing the full Strategy Core prompt? If false, callers should
 * fall back to their generic prompt and avoid forcing strategy theater
 * onto small talk.
 */
export function shouldUseStrategyCorePrompt(args: {
  hasAccount: boolean;
  libraryCounts?: { kis: number; playbooks: number };
  contextSectionLength?: number;
}): boolean {
  if (args.hasAccount) return true;
  const libHits = (args.libraryCounts?.kis ?? 0) +
    (args.libraryCounts?.playbooks ?? 0);
  if (libHits >= 2) return true;
  if ((args.contextSectionLength ?? 0) > 800) return true;
  return false;
}
