// ════════════════════════════════════════════════════════════════
// Strategy V2 — Operator Dispatcher
//
// Single source of truth for per-turn classification. Replaces the
// rigid mode-lock branching in strategy-chat/index.ts with one
// dispatcher that returns:
//
//   { mode, askShape, override, signalScore, reasoning }
//
// Two axes drive the decision:
//   1. Library signal strength (strong / partial / thin / not-needed)
//   2. Ask shape (first-class taxonomy — not a generic classifier)
//
// First-class ask shapes (constraint #2 from product brief):
//   - account_brief
//   - ninety_day_plan
//   - synthesis_framework
//   - rewrite_audience
//   - evaluation_grading
//   - short_form
//   - general (fallback for Mode C — not a dumping ground)
//
// Modes (constraint from product brief):
//   - A_strong   → grounded answer, library leads, model deepens
//   - B_partial  → grounded foundation + flagged extension
//   - C_general  → natural answer, no library theater, no badge
//   - D_thin     → best-effort answer + extension flag + clarifier + gap
//
// User overrides via composer slash-commands:
//   /grounded → forces Mode A treatment if any signal exists
//   /extended → forces Mode B treatment, allows model to range
//   /fast     → forces short_form ask shape, bypasses heavy rubric
// ════════════════════════════════════════════════════════════════

export type V2Mode = "A_strong" | "B_partial" | "C_general" | "D_thin";

export type V2AskShape =
  | "account_brief"
  | "ninety_day_plan"
  | "synthesis_framework"
  | "rewrite_audience"
  | "evaluation_grading"
  | "short_form"
  | "general";

export type V2Override = "grounded" | "extended" | "fast" | null;

export interface DispatchSignals {
  /** Number of resources matched at >0.55 score (or your retrieval floor). */
  strongResourceHits: number;
  /** Number of KIs matched at >0.55 score. */
  strongKiHits: number;
  /** Total raw hits (any score). */
  totalHits: number;
  /** Whether the thread is linked to an account/opportunity. */
  hasEntityContext: boolean;
  /** Whether the user prompt mentions a known account/contact by name. */
  mentionsKnownEntity: boolean;
}

export interface DispatchInput {
  rawUserText: string;
  signals: DispatchSignals;
}

export interface DispatchDecision {
  version: "v2";
  mode: V2Mode;
  askShape: V2AskShape;
  override: V2Override;
  signalScore: number; // 0-100, deterministic
  /** Short human-readable reason — persisted for debugging. */
  reasoning: string;
  /** Stripped user text after slash-command removal. */
  cleanedUserText: string;
}

// ═══ Slash-command parsing ═══
const OVERRIDE_REGEX = /^\s*\/(grounded|extended|fast)\b\s*/i;

export function parseOverride(
  rawText: string,
): { override: V2Override; cleanedText: string } {
  const m = rawText.match(OVERRIDE_REGEX);
  if (!m) return { override: null, cleanedText: rawText };
  const override = m[1].toLowerCase() as V2Override;
  return { override, cleanedText: rawText.replace(OVERRIDE_REGEX, "").trim() };
}

// ═══ Ask-shape classification ═══
// First-class shapes. Order matters — most specific first.
// Each shape has a tight pattern so we don't collapse into "general".

interface ShapeMatcher {
  shape: V2AskShape;
  test: (text: string) => boolean;
}

const SHAPE_MATCHERS: ShapeMatcher[] = [
  // 90-day plan / onboarding / ramp plan — high specificity
  {
    shape: "ninety_day_plan",
    test: (t) =>
      /\b(30|60|90|first\s+(?:30|60|90))[\s-]?day\b/i.test(t) ||
      /\b(ramp|onboarding|first\s+(?:week|month|quarter))\s+(plan|playbook)\b/i
        .test(t) ||
      /\b(new\s+ae|new\s+rep|just\s+(?:started|joined))\b.*\b(plan|do|approach|focus)\b/i
        .test(t) ||
      /\bbuild\s+me\s+a\b.*\b(plan|playbook|roadmap)\b/i.test(t),
  },
  // Account brief / "tell me about <X>" / account research
  {
    shape: "account_brief",
    test: (t) =>
      /\b(tell\s+me\s+about|what\s+(?:do\s+you\s+know|can\s+you\s+tell\s+me)|brief\s+me\s+on|summarize)\b/i
        .test(t) ||
      /\b(account\s+brief|account\s+summary|account\s+overview|account\s+research)\b/i
        .test(t) ||
      /\bwho\s+(?:is|are)\b.*\b(this\s+account|this\s+company|the\s+(?:buyer|stakeholder|champion))\b/i
        .test(t),
  },
  // Rewrite / adapt for audience
  {
    shape: "rewrite_audience",
    test: (t) =>
      /\b(rewrite|reframe|adapt|tailor|adjust|tighten|punch\s+up|sharpen)\b/i
        .test(t) &&
      /\b(for\s+(?:a\s+)?(?:cfo|ceo|coo|cto|vp|director|champion|economic\s+buyer|technical\s+buyer)|in\s+(?:healthcare|fintech|retail|manufacturing|saas)|during\s+(?:a\s+)?(?:renewal|negotiation|discovery))\b/i
        .test(t),
  },
  // Evaluation / grading / critique
  {
    shape: "evaluation_grading",
    test: (t) =>
      /\b(grade|score|critique|evaluate|review|rate|audit|judge|where\s+(?:does\s+this|is\s+this)\s+(?:fail|weak|miss))\b/i
        .test(t) ||
      /\b(against\s+(?:my|the)\s+(?:standards|library|framework|playbook)|how\s+would\s+you\s+rate)\b/i
        .test(t),
  },
  // Synthesis / framework / patterns — Phase 2.6: tightened so high-signal
  // synthesis asks no longer escape into "general".
  {
    shape: "synthesis_framework",
    test: (t) =>
      /\b(synthesize|synthesis|patterns?|framework|model|recurring|across\s+(?:my|these|the)|common\s+(?:threads|themes|failures))\b/i
        .test(t) ||
      /\b(what\s+(?:are|do\s+you\s+see)|how\s+should\s+i\s+think\s+about|recurring\s+failure\s+modes|build\s+me\s+a\s+(?:framework|model))\b/i
        .test(t) ||
      /\b(prioritize|tradeoffs?|weighted)\b.*\b(across|between|among)\b/i.test(t) ||
      // Phase 2.6 additions — these phrasings were collapsing into "general"
      /\bwhat\s+do\s+(?:the\s+)?best\b.*\bhave\s+in\s+common\b/i.test(t) ||
      /\bwhat\s+do\s+mediocre\b.*\b(?:overweight|miss|get\s+wrong)\b/i.test(t) ||
      /\bwhat\s+patterns?\s+(?:do\s+you\s+see|emerge|show\s+up)\b/i.test(t) ||
      /\b(?:where|how)\s+do\s+operators?\s+(?:converge|diverge|differ|agree|disagree)\b/i.test(t) ||
      /\bwhat\s+actually\s+matters\b/i.test(t) ||
      /\bbuild\s+me\s+a\s+(?:framework|model|playbook|rubric|mental\s+model)\b/i.test(t) ||
      /\b(?:cite|citing|with\s+citations?)\b.*\b(?:specific\s+)?resources?\b/i.test(t),
  },
  // Short-form: openers, subject lines, snippets, hooks
  {
    shape: "short_form",
    test: (t) => {
      const wc = t.trim().split(/\s+/).length;
      const isShortAsk = wc <= 25;
      const shortFormKeyword =
        /\b(opener|cold\s+call|subject\s+line|hook|one[\s-]liner|tagline|snippet|talk[\s-]?track\s+(?:line|snippet)|elevator\s+pitch|first\s+line|opening\s+line)\b/i
          .test(t);
      return shortFormKeyword || (isShortAsk && /\b(give\s+me|write|draft)\b/i.test(t));
    },
  },
];

export function classifyAskShape(text: string): V2AskShape {
  for (const m of SHAPE_MATCHERS) {
    if (m.test(text)) return m.shape;
  }
  return "general";
}

// ═══ Library signal scoring ═══
// 0–100. Deterministic. Used for both mode selection and persisted evidence.
export function scoreLibrarySignal(s: DispatchSignals): number {
  let score = 0;
  score += Math.min(s.strongResourceHits, 5) * 12; // up to 60
  score += Math.min(s.strongKiHits, 5) * 6; // up to 30
  if (s.hasEntityContext) score += 5;
  if (s.mentionsKnownEntity) score += 5;
  return Math.min(score, 100);
}

// ═══ Mode selection ═══
// Library signal × ask shape → mode.
// "general" ask shape with no entity context → Mode C regardless of signal.
// Override always wins, but is bounded by what's possible.
function selectMode(
  askShape: V2AskShape,
  signalScore: number,
  signals: DispatchSignals,
  override: V2Override,
): V2Mode {
  // Hard override path
  if (override === "grounded") {
    return signalScore >= 20 ? "A_strong" : "B_partial";
  }
  if (override === "extended") {
    return signalScore >= 40 ? "B_partial" : "D_thin";
  }
  if (override === "fast") {
    // Fast = short answer, mode is whatever the signal supports but rubric is lighter
    return signalScore >= 50 ? "A_strong" : signalScore >= 15 ? "B_partial" : "C_general";
  }

  // Mode C: pure general ask with no signal and no entity → answer naturally
  if (
    askShape === "general" &&
    signalScore < 15 &&
    !signals.hasEntityContext &&
    !signals.mentionsKnownEntity
  ) {
    return "C_general";
  }

  // Strong signal → A
  if (signalScore >= 50) return "A_strong";
  // Partial signal → B
  if (signalScore >= 20) return "B_partial";
  // Thin signal — but the user is asking for something serious. Mode D.
  if (askShape !== "general") return "D_thin";
  // General ask, weak signal, but some entity context → B
  if (signals.hasEntityContext || signals.mentionsKnownEntity) return "B_partial";
  // Fallback
  return "C_general";
}

// ═══ Public dispatcher ═══
export function dispatch(input: DispatchInput): DispatchDecision {
  const { override, cleanedText } = parseOverride(input.rawUserText);
  const askShape = classifyAskShape(cleanedText);
  const signalScore = scoreLibrarySignal(input.signals);
  const mode = selectMode(askShape, signalScore, input.signals, override);

  const reasoning = [
    `shape=${askShape}`,
    `signal=${signalScore}`,
    `hits=r${input.signals.strongResourceHits}/k${input.signals.strongKiHits}`,
    input.signals.hasEntityContext ? "entity=yes" : "entity=no",
    override ? `override=${override}` : null,
    `→ ${mode}`,
  ].filter(Boolean).join(" ");

  return {
    version: "v2",
    mode,
    askShape,
    override,
    signalScore,
    reasoning,
    cleanedUserText: cleanedText,
  };
}
