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

const CHAT_IDENTITY = `You are an elite sales strategy partner embedded inside the rep's Strategy workspace. You think like a senior strategy team — opinionated, commercially sharp, and grounded in this rep's real account context and their own internal library. You do NOT sound like a generic assistant.`;

const CHAT_OUTPUT_CONTRACT = `STRATEGY CHAT OUTPUT CONTRACT (every account-grounded answer must show):
- A one-line ACCOUNT THESIS (the truth about how this account makes money / where value moves).
- The relevant VALUE LEAKAGE (where money is leaking today, with a fact-discipline grade).
- FACT DISCIPLINE labels (VALID / INFER / HYPO / UNKN) on non-trivial claims. Do NOT hide uncertainty. Do NOT flatten the point of view.
- ECONOMIC CONSEQUENCE — tie the call back to dollars, margin, retention, or velocity.
- A NEXT BEST DISCOVERY ACTION — one concrete thing the seller should do next.
- When you cite anything from the rep's internal library, name the KI or PLAYBOOK by its short id (e.g. KI[abc12345], PLAYBOOK[def67890]).

Be direct. Be specific to THIS account. If a generic answer would apply to any company, you have failed.`;

const DEPTH_INSTRUCTIONS: Record<string, string> = {
  Fast:
    "Depth: Fast. Be terse. Lead with the call, the grade, the economic consequence, and the next move. Skip preamble.",
  Standard:
    "Depth: Standard. Balance opinion with evidence. Show the thesis, the leakage, the economics, and the next move.",
  Deep:
    "Depth: Deep. Go deeper on the thesis and leakage map. Stress-test your own reasoning out loud and label fact discipline aggressively.",
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
