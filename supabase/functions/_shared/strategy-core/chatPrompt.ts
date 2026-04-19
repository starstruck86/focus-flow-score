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
  - Lead with the account thesis in one line.
  - Name the value leakage in dollars/margin/retention/velocity terms.
  - Label non-trivial claims (VALID / INFER / HYPO / UNKN) only when uncertainty actually matters.
  - End with one concrete next discovery action.
For everyday "what should I send / say / do / use", skip the strategic frame — just deliver the asset.

═══ CITATIONS ═══
When you pull a real internal item, name it inline by short id: KI[abc12345], PLAYBOOK[def67890], or by exact resource title. If you don't have a real source, say so in one short clause and proceed with your best operator answer — do not invent titles.`;

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
   * When present, it forces the model to either cite an exact title
   * or admit absence — never to invent a template/example/calculator.
   */
  resourceContextBlock?: string;
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

  const parts: string[] = [
    CHAT_IDENTITY,
    STRATEGY_CORE_THINKING_ORDER,
    FACT_DISCIPLINE_RULES,
    ACCOUNT_SPECIFICITY_RULE,
    ECONOMIC_FRAMING_RULES,
    CHAT_OUTPUT_CONTRACT,
    depthBlock,
  ];

  const lib = (args.libraryContext || "").trim();
  if (lib) {
    parts.push(
      `=== INTERNAL LIBRARY (ground your answer in these when relevant) ===\n${lib}`,
    );
  }

  const acct = (args.accountContext || "").trim();
  if (acct) {
    parts.push(`=== ACCOUNT CONTEXT ===\n${acct}`);
  }

  // Library resources block — already self-headers ("=== LIBRARY
  // RESOURCES ==="). Placed alongside other context so the model
  // sees both the entity context and the retrieved artifact list.
  const res = (args.resourceContextBlock || "").trim();
  if (res) {
    parts.push(res);
  }

  // Working thesis state — placed AFTER static context so the live
  // operating model is the last thing the model sees before the user
  // turn. Already self-headers ("=== CURRENT WORKING THESIS STATE ===").
  const thesis = (args.workingThesisBlock || "").trim();
  if (thesis) {
    parts.push(thesis);
  }

  const ctx = (args.contextSection || "").trim();
  if (ctx) {
    parts.push(ctx);
  }

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
