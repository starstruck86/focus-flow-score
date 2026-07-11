// ════════════════════════════════════════════════════════════════
// Strategy Output Mode — universal selector.
//
// Strategy supports four output modes that cut across every
// workspace. Mode is computed ONCE per turn (in buildPromptOnce)
// and consumed by:
//   - the response-format contract (workspace body block)
//   - the conversation-mode HARD RULES enforcement block
//   - structured logs
//
// Modes:
//   conversation → no headings, no titled sections, prose / light
//                  bullets, sounds like an operator talking to Corey.
//   structured   → ## headings, bullets, tables, citations OK.
//   preserve     → keep input shape; rewrite-first; no added headings.
//   adaptive     → match the ask; mode collapses to one of the above
//                  in the contract block based on intent shape.
//
// Selection priority (highest wins):
//   1. explicit user format override (one sentence, table, brief, …)
//      → maps to structured / preserve / structured-tight as needed.
//   2. conversation triggers in user content ("talk me through",
//      "help me think through", "how should I approach", …) → conversation
//      in ANY workspace.
//   3. workspace default.
// ════════════════════════════════════════════════════════════════

export type OutputMode = "conversation" | "structured" | "preserve" | "adaptive";

export type ExplicitFormatKind =
  | "one_sentence"
  | "one_line"
  | "short"
  | "table"
  | "bullets"
  | "brief"
  | "headings"
  | "rewrite";

export interface OutputModeDecision {
  mode: OutputMode;
  reason: string;
  workspace_default_mode: OutputMode;
  explicit_format_override: ExplicitFormatKind | null;
  conversation_trigger_matched: string | null;
}

const WORKSPACE_DEFAULTS: Record<string, OutputMode> = {
  brainstorm: "conversation",
  deep_research: "structured",
  refine: "preserve",
  artifacts: "structured",
  library: "structured",
  work: "adaptive",
  projects: "adaptive",
};

// Trigger phrases that flip ANY workspace into conversation mode.
// Stored as lowercase substrings or simple regex sources for clarity.
const CONVERSATION_TRIGGERS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\btalk\s+me\s+through\b/i, label: "talk_me_through" },
  { pattern: /\bwalk\s+me\s+through\b/i, label: "walk_me_through" },
  { pattern: /\bhelp\s+me\s+think\s+through\b/i, label: "help_me_think_through" },
  { pattern: /\b(i'?m|i\s+am)\s+trying\s+to\s+think\s+through\b/i, label: "trying_to_think_through" },
  { pattern: /\bthink\s+(this|it|that|something)\s+through\b/i, label: "think_it_through" },
  { pattern: /\bhow\s+should\s+i\s+(approach|think\s+about|frame|open|position)\b/i, label: "how_should_i_x" },
  { pattern: /\bhow\s+would\s+you\s+(open|approach|frame|position|come\s+at)\b/i, label: "how_would_you_x" },
  { pattern: /\bbefore\s+(we|i)\s+(build|write|create|draft|make)\b/i, label: "before_we_build" },
  { pattern: /\bwhat'?s\s+the\s+(angle|pov|point\s+of\s+view|take|frame|story)\b/i, label: "whats_the_angle" },
  { pattern: /\bgive\s+me\s+(a\s+few\s+)?ways\s+to\s+approach\b/i, label: "ways_to_approach" },
  { pattern: /\b(what|which)\s+questions\s+should\s+i\s+ask\b/i, label: "questions_to_ask" },
  { pattern: /\bquestions\s+i\s+should\s+ask\b/i, label: "questions_i_should_ask" },
  { pattern: /\bhow\s+(do|would)\s+i\s+(open|frame|position|approach)\b/i, label: "how_do_i_open" },
  { pattern: /\bbrainstorm\s+with\s+me\b/i, label: "brainstorm_with_me" },
  { pattern: /\bthink\s+out\s+loud\b/i, label: "think_out_loud" },
];

function detectConversationTrigger(userContent: string): string | null {
  const text = userContent || "";
  if (!text.trim()) return null;
  for (const { pattern, label } of CONVERSATION_TRIGGERS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

/**
 * Map an explicit format override (from detectExplicitFormatOverride)
 * to an OutputMode. Returning null means the override is mode-neutral
 * (e.g. "in bullets" inside a conversation is fine).
 */
function explicitOverrideToMode(kind: ExplicitFormatKind | null): OutputMode | null {
  switch (kind) {
    case "brief":
    case "headings":
    case "table":
      return "structured";
    case "rewrite":
      return "preserve";
    // one_sentence / one_line / short / bullets do not, on their own,
    // dictate mode — they are length/shape constraints layered on top.
    default:
      return null;
  }
}

export interface SelectOutputModeArgs {
  workspace: string | null | undefined;
  /** Optional intent classifier output; not required. */
  intent?: { intent?: string | null } | null;
  /** Result of detectExplicitFormatOverride (already computed once). */
  explicitFormat: ExplicitFormatKind | null;
  userContent: string;
}

export function selectOutputMode(args: SelectOutputModeArgs): OutputModeDecision {
  const ws = (args.workspace || "work").toLowerCase();
  const workspace_default_mode: OutputMode = WORKSPACE_DEFAULTS[ws] ?? "adaptive";

  const explicitMode = explicitOverrideToMode(args.explicitFormat);
  const trigger = detectConversationTrigger(args.userContent || "");

  // 1. Explicit format override wins.
  if (explicitMode) {
    return {
      mode: explicitMode,
      reason: `explicit_user_format:${args.explicitFormat}`,
      workspace_default_mode,
      explicit_format_override: args.explicitFormat,
      conversation_trigger_matched: trigger,
    };
  }

  // 2. Conversation triggers flip ANY workspace into conversation mode.
  if (trigger) {
    return {
      mode: "conversation",
      reason: `conversation_trigger:${trigger}`,
      workspace_default_mode,
      explicit_format_override: args.explicitFormat,
      conversation_trigger_matched: trigger,
    };
  }

  // 3. Workspace default.
  return {
    mode: workspace_default_mode,
    reason: `workspace_default:${ws}`,
    workspace_default_mode,
    explicit_format_override: args.explicitFormat,
    conversation_trigger_matched: null,
  };
}

// ─────────────────────────────────────────────────────────────────
// Mode → contract body block.
//
// Returned string slots into the RESPONSE FORMAT CONTRACT in place
// of the previous workspace switch. Workspace is still passed in so
// the structured/adaptive variants can flavor the purpose line.
// ─────────────────────────────────────────────────────────────────
export function renderModeContractBody(
  mode: OutputMode,
  workspace: string | null | undefined,
): string {
  const ws = (workspace || "work").toLowerCase();

  if (mode === "conversation") {
    return [
      "OUTPUT MODE: CONVERSATION.",
      "PURPOSE: think with Corey out loud — give him things he could actually say, ask, or push on. Not a structured deliverable.",
      "STYLE: conversational prose (or very light dashes/bullets if it truly aids reading). First-person is welcome ('I\\'d…', 'I might…', 'One way I\\'d…').",
      "DO NOT use ## headings, titled sections, named ideas, category labels, or generic buckets.",
      "Each idea should sound like a strategic operator talking — anchored in this specific situation, with a real point of view, tension, or provocation.",
      "Length: enough to be useful, no padding. 3–5 distinct entries is typical, but match the ask.",
    ].join("\n");
  }

  if (mode === "preserve") {
    return [
      "OUTPUT MODE: PRESERVE.",
      "PURPOSE: improve content the user provided — keep its shape.",
      "STYLE: return the rewritten/improved version FIRST in the same shape as the input (email → email, paragraph → paragraph, bullets → bullets).",
      "DO NOT add ## headings unless the input had them or the user explicitly asked.",
      "Optional: a short rationale (2–4 lines) AFTER the rewrite, separated by a blank line.",
      "Prioritize sharper wording, tighter structure, and a stronger POV over visible reformatting.",
    ].join("\n");
  }

  if (mode === "structured") {
    const purpose =
      ws === "deep_research"
        ? "evidence, synthesis, implications. Cite sources/library evidence inline when used."
        : ws === "library"
          ? "turn library knowledge into reusable assets and guidance. Preserve resource names verbatim."
          : ws === "artifacts"
            ? "produce a usable deliverable (brief, doc, plan, table). The output should be ready to paste/share with minimal editing."
            : "produce a structured response optimized for skim and reuse.";
    return [
      "OUTPUT MODE: STRUCTURED.",
      `PURPOSE: ${purpose}`,
      "STYLE: ## headings, sub-sections, bullets, and tables are all allowed where they aid scanning.",
      "Encouraged sections (when they fit): Facts / Inferences / Unknowns / Questions / Next step.",
      "End with '→ Next step: <one concrete action>' only when there is a real follow-on action.",
    ].join("\n");
  }

  // adaptive
  return [
    "OUTPUT MODE: ADAPTIVE — match the shape of the ask.",
    "If the ask is quick/direct ('quick answer', 'what should I say'), reply concisely with no headings.",
    "If the ask is to think/talk through something, switch to conversational prose (no headings, no named ideas).",
    "If the ask is for a doc/brief/analysis/table, structure it with ## headings, bullets, or a table.",
    "If the ask is to rewrite something, preserve the input's shape and lead with the rewrite.",
    "Do NOT force ## headings by default. Let the shape of the ask drive the shape of the answer.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Conversation-mode HARD RULES.
//
// Appended at the FINAL prompt stage (after Global Instructions) so
// they cannot be softened. Universal — fires whenever mode is
// 'conversation', regardless of workspace. Replaces the prior
// brainstorm-only enforcement block.
// ─────────────────────────────────────────────────────────────────
export interface ConversationEnforcementOpts {
  /**
   * @deprecated Retained for call-site compatibility. Current State stays in
   * retrieved-evidence segments and is never copied into fixed instructions.
   */
  currentStateDigest?: string | null;
  /** True when Current State Intelligence ran and produced a usable block. */
  currentStateUsed?: boolean;
  /** Resolved behavior route; reconciles one-path strategy with brainstorm breadth. */
  behaviorIntent?:
    | "conversation_strategy"
    | "idea_generation"
    | "research_analysis"
    | "artifact_creation";
  /** Explicit user-requested number of options/angles/ideas, when present. */
  requestedEntryCount?: number | null;
}

export function detectRequestedEntryCount(
  userContent: string | null | undefined,
): number | null {
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  const match = (userContent || "").toLowerCase().match(
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:(?:distinct|different|expansion|commercial|creative|strategic|conversation|discovery)\s+){0,3}(?:ideas?|angles?|options?|ways?|hooks?|openers?|questions?|entries)\b/,
  );
  if (!match) return null;
  const parsed = /^\d+$/.test(match[1]) ? Number(match[1]) : words[match[1]];
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 20
    ? parsed
    : null;
}

export function renderConversationEnforcementBlock(
  workspace: string | null | undefined,
  opts: ConversationEnforcementOpts = {},
): string {
  const ws = (workspace || "work").toLowerCase();
  const csUsed = !!opts.currentStateUsed;
  const contextClause = csUsed
    ? "Use the Current State evidence above. Every path must visibly reflect at least one specific verified fact, hypothesis, change, or tension from it."
    : "No Current State evidence is attached. Use other account/thread evidence; if none exists, state the one material unknown instead of inventing specificity.";
  const requestedCount = opts.requestedEntryCount;
  const countRule = requestedCount
    ? `Return exactly ${requestedCount} distinct conversational entries; the user's explicit count wins.`
    : opts.behaviorIntent === "idea_generation" && ws === "brainstorm"
    ? "Return at least five genuinely distinct conversational entries because Brainstorm owns breadth."
    : opts.behaviorIntent === "idea_generation"
    ? "Return 3–5 genuinely distinct conversational entries because this turn asks for breadth."
    : opts.behaviorIntent === "conversation_strategy"
    ? "Return one primary path and at most one materially different backup; each path is 90–180 words."
    : "Match the ask: one primary path by default, with additional entries only when distinct options are genuinely requested.";
  const substanceRule = opts.behaviorIntent === "idea_generation"
    ? "Each entry needs a genuinely different angle, one specific account/evidence anchor when available, and a concrete why-it-could-work. After all entries give one overall recommended next move; do not force a full script or validation question into every idea."
    : opts.behaviorIntent === "research_analysis"
    ? "Each entry carries verified fact or labeled inference, decision implication, and the material unknown. Keep it analysis—not a coaching script, finished artifact, or forced say/do move."
    : opts.behaviorIntent === "artifact_creation"
    ? "The resolved artifact contract owns substance and visible shape. Deliver that copy/paste-ready asset; do not add competing conversation paths or analysis commentary."
    : "Each path weaves together a specific evidence anchor, from→to change, non-obvious friction, Corey's actual words/move, and the validation question.";
  const shapeRule = opts.behaviorIntent === "artifact_creation"
    ? "The resolved artifact remains authoritative; conversation mode cannot replace it."
    : "Do not produce a brief, structured strategy list, email, doc, or plan.";

  return `

━━━ CONVERSATION MODE ENFORCEMENT (HARD RULES) ━━━

OUTPUT MODE: CONVERSATION (workspace: ${ws}).
This final segment is the last word on conversation delivery. ${shapeRule}

- ${countRule}
- Natural first-person prose only. No ## headings, titles, bold labels, named angles, cards, category buckets, "Option A," or idea-list lead-ins. A bare divider between prose paths is allowed.
- ${substanceRule}
- ${contextClause}
- Use a Branch capability or competitor only when it sharpens the call. Replace generic analytics/engagement language and consultant verbs with the actual tension and move.
- Library evidence may sharpen the POV, but do not announce retrieval or turn a play/framework title into a heading. Follow the active citation posture only when attribution is material.

Before sending, silently verify the path is specific, conversational, complete, and usable in a real pre-call note. Rewrite once if not. This is not optional.
`;
}
