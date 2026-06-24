/**
 * Behavior Intent Routing
 * ════════════════════════════════════════════════════════════════════
 * Coarse intent classification that maps a user prompt to ONE of four
 * mutually-exclusive behaviors. Each behavior owns its own visible
 * output shape; all other behaviors are explicitly suppressed.
 *
 * Intents:
 *   - conversation_strategy : "what should I say / ask"
 *   - idea_generation       : "give me a few ways / brainstorm / options"
 *   - research_analysis     : "what do we know / analyze / facts"
 *   - artifact_creation     : "write / draft / build the thing"
 *
 * Used by strategy-chat to:
 *   1. inject a single Behavior Contract into the system prompt
 *   2. run a hard guard on the model output (rewrite once if violated)
 *   3. emit structured telemetry (intent_detected / suppressed / guard)
 *
 * This layer sits ABOVE the existing fine-grained ChatIntent classifier.
 * It is intentionally narrow: format/behavior only — not content rules.
 */

export type BehaviorIntent =
  | "conversation_strategy"
  | "idea_generation"
  | "research_analysis"
  | "artifact_creation";

export interface BehaviorIntentResult {
  intent: BehaviorIntent;
  suppressed: BehaviorIntent[];
  matched_signal: string;
  confidence: "high" | "medium" | "low";
}

const ALL_INTENTS: BehaviorIntent[] = [
  "conversation_strategy",
  "idea_generation",
  "research_analysis",
  "artifact_creation",
];

// ─── Pattern banks ──────────────────────────────────────────────────

const CONVERSATION_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(prep(?:aring)?|preparing|prepping)\s+(?:for\s+)?(?:an?\s+)?(?:initial|first|discovery|intro|kickoff|exec(?:utive)?)?\s*(?:call|meeting|conversation|convo|chat|discussion)/i, label: "prep_for_call" },
  { re: /\b(what|how)\s+(should|do|would|could)\s+i\s+(say|ask|open|lead|approach|frame|position|push|challenge)/i, label: "what_should_i_say" },
  { re: /\bhow\s+(?:do|should|would)\s+i\s+(?:approach|handle|navigate|run|frame)\s+(?:this|the|a|an)\s+(?:call|meeting|conversation|convo|discussion|conv)/i, label: "how_to_approach_convo" },
  { re: /\b(approach|approach(?:es)?)\s+(?:to\s+)?(?:this\s+)?conversation\b/i, label: "approach_to_convo" },
  { re: /\bso\s+i\s+don'?t\s+sound\s+(generic|salesy|pitchy|robotic)/i, label: "dont_sound_generic" },
  { re: /\b(point\s+of\s+view|POV|angle)\s+(?:on|for|about)\b/i, label: "point_of_view" },
  { re: /\bwhat\s+(?:is\s+)?my\s+(?:opening|opener|entry|hook|lead)\b/i, label: "opening_move" },
  { re: /\b(challenge|push back on|reframe for)\s+(?:the|this)\s+(?:customer|prospect|buyer|champion)\b/i, label: "challenge_customer" },
];

const IDEA_GENERATION_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(brainstorm|ideate|generate ideas|come up with|riff on|spitball)\b/i, label: "brainstorm_verb" },
  { re: /\bgive me (?:a few|some|several|3|five|5|10) (?:ideas|angles|options|ways|approaches|hooks)\b/i, label: "give_me_ideas" },
  { re: /\bwhat are (?:some|a few|several) (?:ideas|angles|ways|approaches)\b/i, label: "what_are_some" },
  { re: /\b(?:list|enumerate)\s+(?:out\s+)?(?:the\s+)?(?:ideas|options|angles|ways)\b/i, label: "list_ideas" },
];

const RESEARCH_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(research|analyze|analysis|deep dive|dig into|investigate)\b/i, label: "research_verb" },
  { re: /\bwhat (?:do we|do i) know about\b/i, label: "what_do_we_know" },
  { re: /\b(facts|background|context|landscape|history|overview)\s+(?:on|of|about)\b/i, label: "facts_on" },
  { re: /\b(?:tell|brief)\s+me\s+(?:about|on)\s+(?:this|the)\s+(?:account|company|market|space)\b/i, label: "brief_me_on" },
  { re: /\b(market|competitive)\s+(?:analysis|landscape|context)\b/i, label: "market_analysis" },
];

const ARTIFACT_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(write|draft|compose|build|create|generate|produce)\s+(?:me\s+)?(?:a|an|the)\s+(email|message|sms|note|script|voicemail|sequence|cadence|plan|brief|deck|doc|document|template|outline|agenda|summary|memo|one[-\s]?pager|proposal)\b/i, label: "write_an_artifact" },
  { re: /\b(rewrite|reword|tighten|sharpen|punch up|tailor|adapt)\s+(?:this|that|the\s+(?:following|below|above)|it)\b/i, label: "rewrite_artifact" },
  { re: /\b(account|territory|opportunity)\s+(brief|plan|summary)\b/i, label: "named_artifact" },
  { re: /\b(?:30[-/\s]?60[-/\s]?90|ninety[-\s]?day)\s+plan\b/i, label: "named_plan" },
];

// ─── Classifier ─────────────────────────────────────────────────────

function firstMatch(
  text: string,
  bank: { re: RegExp; label: string }[],
): string | null {
  for (const p of bank) if (p.re.test(text)) return p.label;
  return null;
}

/**
 * Classify a user prompt into ONE behavior intent.
 *
 * Precedence (when multiple match):
 *   1. artifact_creation     — most concrete ("write me an email")
 *   2. conversation_strategy — operator-facing ("what should I say")
 *   3. research_analysis     — informational
 *   4. idea_generation       — open-ended
 *
 * Default when nothing matches: conversation_strategy when an account
 * is attached (Corey is in operator mode), otherwise research_analysis.
 */
export function classifyBehaviorIntent(
  userContent: string,
  ctx?: { hasAccountContext?: boolean },
): BehaviorIntentResult {
  const text = (userContent || "").trim();
  const hasAccount = ctx?.hasAccountContext === true;

  const artifact = firstMatch(text, ARTIFACT_PATTERNS);
  const convo = firstMatch(text, CONVERSATION_PATTERNS);
  const research = firstMatch(text, RESEARCH_PATTERNS);
  const idea = firstMatch(text, IDEA_GENERATION_PATTERNS);

  // Resolve in precedence order. "Approach to conversation" beats
  // "give me a few ways" because the framing is operator-facing.
  let intent: BehaviorIntent;
  let matched: string;
  let confidence: BehaviorIntentResult["confidence"];

  if (artifact) {
    intent = "artifact_creation";
    matched = artifact;
    confidence = "high";
  } else if (convo) {
    intent = "conversation_strategy";
    matched = convo;
    confidence = "high";
  } else if (research) {
    intent = "research_analysis";
    matched = research;
    confidence = "medium";
  } else if (idea) {
    intent = "idea_generation";
    matched = idea;
    confidence = "medium";
  } else {
    intent = hasAccount ? "conversation_strategy" : "research_analysis";
    matched = hasAccount ? "default_account_attached" : "default_no_account";
    confidence = "low";
  }

  const suppressed = ALL_INTENTS.filter((i) => i !== intent);
  return { intent, suppressed, matched_signal: matched, confidence };
}

// ─── Prompt contract ────────────────────────────────────────────────

/**
 * One short contract appended to the system prompt. Mutually exclusive
 * by construction: only the selected intent's rules are present.
 */
export function renderBehaviorContract(intent: BehaviorIntent): string {
  switch (intent) {
    case "conversation_strategy":
      return `═══ BEHAVIOR LOCK — CONVERSATION STRATEGY (exclusive) ═══
Intent: conversation_strategy. All other behaviors are SUPPRESSED for this turn.
Output is what Corey should SAY or ASK in the upcoming conversation.

══ DEPTH PRESERVATION (read this BEFORE the format rules below) ══
This contract changes HOW the answer is delivered. It does NOT change HOW the
answer is thought through. The full reasoning stack above this block —
verified signals, current-state intelligence, change vectors (X→Y→Z),
commercial insight (3 WHYs + AI impact + risk), strategic why, friction —
MUST remain active in your thinking and MUST show up as substance in the
prose. Compression ≠ simplification. If your draft is shorter but weaker,
shorter but more generic, or shorter but less specific, you have failed
this contract — regenerate.

Required substance density per path (must all be present, woven into prose,
NOT labeled as sections):
  1. A specific anchor — a verified signal or current-state fact about the
     account (cite it inline, not as a bibliography). No anchor = invalid.
  2. A change vector — what is moving from X to Y, expressed as direction of
     travel ("they're shifting from … toward …"). Generic verbs without a
     from/to don't count.
  3. A commercial insight or friction — the non-obvious reframe OR the hard
     problem this creates. Must be specific to this account, not a category.
  4. A move — what Corey actually says or leads with, in his voice.
  5. A question — the validation question Corey asks the customer.
All five must be present. Missing any one = regenerate.

Format rules (delivery only — these never override depth):
  • 1 primary path. Optional 1 backup path only if materially different. Hard cap: 2.
  • Each path 90–180 words. Tight, but long enough to carry all 5 substance elements.
  • Natural prose in Corey's first-person voice. No headings. No bullet lists.
    No numbered lists. No category buckets. No "Option A / Option B".
    No "Here are a few ways…". No "Idea 1 / Idea 2".
  • Use Branch product names directly when relevant (deep linking, deferred deep linking, Universal Ads,
    Web-to-App, Email-to-App, SMS-to-App, QR, AIO, Advanced Privacy) and name the competitive dynamic
    (Adjust, AppsFlyer, Kochava, Singular) when it sharpens the call. Avoid generic
    "analytics / attribution / engagement" when a specific Branch capability fits.
  • Specificity test before sending: would this paragraph still make sense if
    you swapped the company name for any other Branch account? If yes, it's too
    generic — rewrite with the verified signal / current-state fact made load-bearing.
  • Suppressed behaviors: idea_generation (no idea lists), research_analysis
    (no facts dump as separate section), artifact_creation (no email/doc/plan).
    BUT: the underlying reasoning from those layers IS still required as
    substance inside the prose.`;

    case "idea_generation":
      return `═══ BEHAVIOR LOCK — IDEA GENERATION (exclusive) ═══
Intent: idea_generation. All other behaviors are SUPPRESSED for this turn.

Rules:
  • Multiple ideas allowed. Labeled blocks OK ("Idea 1: …"). Creative breadth prioritized.
  • Each idea: one sentence frame + one sentence why it could work.
  • Suppressed behaviors: conversation_strategy (do not collapse into a single POV), artifact_creation (do not write the asset itself).`;

    case "research_analysis":
      return `═══ BEHAVIOR LOCK — RESEARCH / ANALYSIS (exclusive) ═══
Intent: research_analysis. All other behaviors are SUPPRESSED for this turn.

Rules:
  • Structured output OK: short headings, fact lines, source tags.
  • Lead with what is verified; mark inferences as "Likely:" / "Assumption:".
  • Suppressed behaviors: conversation_strategy (do not pivot into "what to say"), artifact_creation (do not produce the deliverable), idea_generation (do not brainstorm options).`;

    case "artifact_creation":
      return `═══ BEHAVIOR LOCK — ARTIFACT CREATION (exclusive) ═══
Intent: artifact_creation. All other behaviors are SUPPRESSED for this turn.

Rules:
  • Produce the deliverable the user asked for (email, message, plan, brief, doc).
  • Structured sections appropriate to the artifact type.
  • Suppressed behaviors: conversation_strategy (do not coach Corey on what to say next), idea_generation (do not list alternatives), research_analysis (do not dump background).`;
  }
}

// ─── Hard guard (post-processing) ───────────────────────────────────

export interface BehaviorGuardResult {
  triggered: boolean;
  text: string;
  violations: string[];
  rewrite_applied: boolean;
  /**
   * Depth-floor audit (conversation_strategy only). Flag-only — the
   * guard NEVER strips substance. If `depth_floor_passed` is false,
   * the model dropped reasoning while compressing format. Telemetry
   * surfaces it so we can detect "shorter but weaker" regressions.
   */
  depth_floor_passed?: boolean;
  depth_signals?: {
    has_change_vector: boolean;
    has_friction_or_insight: boolean;
    has_question: boolean;
    has_specific_anchor: boolean;
    word_count: number;
    generic_phrase_hits: string[];
  };
}

/**
 * Detect behavior violations in the model's visible output and rewrite
 * once if the intent is conversation_strategy (the strictest mode).
 *
 * For other intents we only flag — we don't mutate, because their
 * shape is intentionally permissive.
 */
export function enforceBehaviorContract(
  intent: BehaviorIntent,
  text: string,
): BehaviorGuardResult {
  const violations: string[] = [];
  let out = text || "";

  if (intent !== "conversation_strategy") {
    return { triggered: false, text: out, violations, rewrite_applied: false };
  }

  // ── Detect violations ────────────────────────────────────────────
  // 1. Markdown headings (#, ##, ###)
  const HEADING_RE = /^\s{0,3}#{1,6}\s+\S/m;
  if (HEADING_RE.test(out)) violations.push("markdown_heading");

  // 2. Bold-line headings used as category labels (e.g. "**Acquisition:**")
  const BOLD_LABEL_RE = /^\s*\*\*[A-Z][\w &/\-]{2,40}:?\*\*\s*$/m;
  if (BOLD_LABEL_RE.test(out)) violations.push("bold_label_heading");

  // 3. Numbered or bulleted idea lists with 2+ items
  const lines = out.split(/\r?\n/);
  const bulletCount = lines.filter((l) => /^\s*([-*•]|\d+[.)])\s+\S/.test(l)).length;
  if (bulletCount >= 2) violations.push(`list_items=${bulletCount}`);

  // 4. Idea-pitch lead-ins
  const LEADIN_RE = /\b(here\s+are\s+(?:a\s+few|some|several|three|3|five|5)\s+(?:ways|ideas|angles|options|approaches)|here'?s\s+a\s+few\s+(?:ways|ideas|angles|options|approaches)|a\s+few\s+ways\s+(?:to|you\s+could)|some\s+(?:ideas|angles|options)\s+(?:to|you\s+could))\b/i;
  if (LEADIN_RE.test(out)) violations.push("idea_leadin_phrase");

  // 5. (Removed) Generic martech category-bucket labels. Branch-positive
  //    vocabulary (deep linking, Universal Ads, web-to-app, MMP, QBR,
  //    footprint, whitespace, expansion, renewal, Adjust, AppsFlyer, etc.)
  //    is a SIGNAL we want, not something to strip.


  // ── Depth-floor audit (FLAG-ONLY — never strips, never blocks) ───
  // Detects "shorter but weaker" — when format compression dropped
  // the underlying reasoning. Telemetry-only signal so we can spot
  // the failure mode the user explicitly called out.
  const auditDepth = (sample: string) => {
    const lower = sample.toLowerCase();
    const wordCount = (sample.match(/\b\w+\b/g) || []).length;
    const has_change_vector =
      /\b(from\s+[a-z][\w\- ]{1,40}\s+to\s+[a-z]|moving\s+from|shifting\s+from|pivot(?:ing)?\s+from|transitioning\s+from|→|->|–>|—>)/i.test(sample);
    const has_friction_or_insight =
      /\b(the\s+(?:hard|harder|real)\s+(?:problem|part)|the\s+challenge\s+(?:for|is|with)|what'?s\s+broken|the\s+reframe|the\s+thing\s+(?:i'?d|we'?d)\s+(?:focus|push|press)|the\s+tension|the\s+risk\s+(?:is|here)|the\s+trap)/i.test(sample);
    const has_question = /\?\s*$/m.test(sample.trim()) || /\?\s/.test(sample);
    // Specific anchor proxy: a proper noun OR a quoted/numeric specifier
    // that isn't a generic marketing term. We flag absence, not presence.
    const properNounMatches = sample.match(/\b[A-Z][a-zA-Z0-9]{2,}(?:\s+[A-Z][a-zA-Z0-9]+)?\b/g) || [];
    const has_specific_anchor = properNounMatches.length >= 2 || /\b(\d{1,3}%|\$\d|Q[1-4]|FY\d{2,4}|H[12])\b/.test(sample);
    // Generic-LLM/SaaS fluff phrases that signal a non-Branch, non-operator
    // response. Branch-positive vocabulary (deep linking, deferred deep
    // linking, Universal Ads, Web-to-App, Email-to-App, SMS-to-App, QR,
    // AIO, Advanced Privacy, MMP, QBR, footprint, whitespace, expansion,
    // renewal, Adjust, AppsFlyer, Kochava, Singular, attribution,
    // sub-entity) is a SIGNAL — never penalize it.
    const GENERIC = [
      "data-driven", "best practice", "best-in-class", "thought leadership",
      "single source of truth", "synergy", "synergies", "holistic",
      "leverage our platform", "drive engagement", "drive value",
      "unlock value", "move the needle", "north star metric",
      "customer-centric", "world-class",
    ];
    const generic_phrase_hits = GENERIC.filter((g) => lower.includes(g));
    return {
      has_change_vector,
      has_friction_or_insight,
      has_question,
      has_specific_anchor,
      word_count: wordCount,
      generic_phrase_hits,
    };
  };

  const depth_signals = auditDepth(out);
  // Floor: must have a question AND at least 3 of the 4 substance signals,
  // AND no more than 1 generic-marketing phrase, AND not absurdly short
  // (under 60 words for conversation_strategy almost always = stripped).
  const substanceCount = [
    depth_signals.has_change_vector,
    depth_signals.has_friction_or_insight,
    depth_signals.has_question,
    depth_signals.has_specific_anchor,
  ].filter(Boolean).length;
  const depth_floor_passed =
    depth_signals.has_question &&
    substanceCount >= 3 &&
    depth_signals.generic_phrase_hits.length <= 1 &&
    depth_signals.word_count >= 60;

  if (!depth_floor_passed) violations.push("depth_floor_below_threshold");

  if (violations.length === 0 || (violations.length === 1 && violations[0] === "depth_floor_below_threshold")) {
    // Format is clean. Depth issues are flagged only — never mutate
    // the text, because mutating would make "shorter but weaker" worse.
    return {
      triggered: !depth_floor_passed,
      text: out,
      violations,
      rewrite_applied: false,
      depth_floor_passed,
      depth_signals,
    };
  }

  // ── Rewrite once: collapse to prose ──────────────────────────────
  // Strip headings, bold-labels, list markers, idea lead-ins, and
  // category labels. Re-flow into paragraphs. This is a deterministic
  // last-resort pass — the model is also instructed not to emit these
  // shapes via the BEHAVIOR LOCK contract. We do NOT touch substance:
  // every word the model emitted is preserved; only structural
  // scaffolding is removed. Depth-floor is reported separately.
  let rewritten = out;

  // Remove markdown headings
  rewritten = rewritten.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  // Remove bold-label-only lines
  rewritten = rewritten.replace(/^\s*\*\*[A-Z][\w &/\-]{2,40}:?\*\*\s*$\n?/gm, "");
  // Strip leading bullet/number markers
  rewritten = rewritten.replace(/^\s*([-*•]|\d+[.)])\s+/gm, "");
  // Strip idea-pitch lead-ins (replace with empty so the next clause carries)
  rewritten = rewritten.replace(LEADIN_RE, "").replace(/^\s*[,.;:]\s*/gm, "");
  // Strip "Idea N:" / "Option A:" prefixes
  rewritten = rewritten.replace(/^\s*(idea|option|approach|angle|way)\s+\d+\s*:\s*/gim, "");
  rewritten = rewritten.replace(/^\s*(option|approach)\s+[A-Z]\s*:\s*/gm, "");
  // (Removed) Acoustic category-bucket stripping — Branch vocabulary is a
  // signal we want to keep.
  // Collapse multiple blank lines into a single paragraph break
  rewritten = rewritten.replace(/\n{3,}/g, "\n\n").trim();

  return {
    triggered: true,
    text: rewritten,
    violations,
    rewrite_applied: true,
    depth_floor_passed,
    depth_signals,
  };
}
