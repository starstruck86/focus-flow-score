/**
 * Phase 3.5B-Fix — Format-Aware Deterministic Output Scorer.
 *
 * Scores a text output on 6 dimensions (1–5 each):
 *   1. Specificity     — concrete entities/numbers vs generic filler
 *   2. Actionability   — clear next steps, imperatives, calls-to-action
 *   3. Structure       — contract-aware: prose clarity OR artifact depth
 *   4. Evidence        — citations, KI references, data points
 *   5. Relevance       — input terms echoed meaningfully (with generic penalty)
 *   6. Business Impact — before/after, neg consequences, required capabilities, metrics
 *
 * All scoring is deterministic (regex / counting). No LLM judge.
 */

export interface OutputScore {
  specificity: number;
  actionability: number;
  structure: number;
  evidence: number;
  relevance: number;
  business_impact: number;
  total: number;        // sum /30
  normalized: number;   // 0–5 avg
}

export interface ScoringContext {
  shape?: "prose" | "list" | "structured_artifact" | "executive_brief" | "unknown";
  forbid?: string[];
  skillId?: string;
  mustHave?: string[];
}

export interface ComparisonResult {
  strategy_score: OutputScore;
  baseline_score: OutputScore;
  winner: "strategy" | "baseline" | "tie";
  reasoning: string;
  dimension_winners: Record<string, "strategy" | "baseline" | "tie">;
}

// ── Helpers ──

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function isJsonLike(text: string): boolean {
  const t = text.trim();
  return t.startsWith("{") || t.startsWith("[") || t.includes("```json");
}

function extractJsonContent(text: string): string {
  // Extract JSON from code fences or raw JSON
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1];
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return t;
  return "";
}

// ── Dimension scorers ──

function scoreSpecificity(text: string): number {
  const words = text.split(/\s+/).length;
  if (words < 10) return 1;

  const numbers = countMatches(text, /\b\d[\d,.]*%?\b/g);
  const properNouns = countMatches(text, /(?<=[.!?]\s+|^)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/gm);
  const quotedTerms = countMatches(text, /"[^"]{2,}"/g);

  const GENERIC = [
    /\bleverage\b/gi, /\bbest practices?\b/gi, /\bsynerg/gi,
    /\bholistic\b/gi, /\bscalable\b/gi, /\binnovative\b/gi,
    /\bworld[- ]class\b/gi, /\bcutting[- ]edge\b/gi, /\bgame[- ]changer\b/gi,
    /\bbuild rapport\b/gi, /\badd value\b/gi, /\bunderstand their needs\b/gi,
    /\bkey stakeholders?\b/gi, /\bmove the needle\b/gi,
  ];
  const genericCount = GENERIC.reduce((n, p) => n + countMatches(text, p), 0);

  const concreteSignal = numbers + properNouns * 0.5 + quotedTerms;
  const densityPer100 = (concreteSignal / words) * 100;

  let score = 2;
  if (densityPer100 > 3) score = 4;
  else if (densityPer100 > 1.5) score = 3;
  if (genericCount > 3) score -= 1;
  if (genericCount === 0 && concreteSignal > 5) score += 1;

  return clamp(score, 1, 5);
}

function scoreActionability(text: string, ctx?: ScoringContext): number {
  // Standard imperative/line-start detection (works for prose/baseline)
  const imperatives = countMatches(text, /(?:^|\n|•|[-*])\s*(?:Ask|Propose|Send|Schedule|Confirm|Validate|Map|Identify|Prepare|Draft|Review|Challenge|Test|Open|Frame|Position|Present|Quantify|Document|Follow[- ]up)\b/gi);
  const nextSteps = countMatches(text, /\b(?:next step|action item|to[- ]do|follow[- ]up|recommendation)\b/gi);
  const questions = countMatches(text, /\?/g);

  let signals = imperatives + nextSteps * 1.5 + questions * 0.5;

  // Format-aware: detect embedded action language in prose
  const embeddedActions = countMatches(text, /\b(?:should|must|need to|recommend|ensure|prioritize|leverage|execute|implement|deploy|establish|secure|drive|accelerate|align|address|mitigate|explore|investigate|pursue|negotiate|articulate)\b/gi);
  signals += embeddedActions * 0.3;

  // Format-aware: detect structured artifact action fields
  if (ctx?.shape === "structured_artifact" || ctx?.shape === "list" || isJsonLike(text)) {
    const jsonContent = extractJsonContent(text);
    const lower = (jsonContent || text).toLowerCase();

    // Count action-bearing JSON fields
    const actionFields = countMatches(lower, /["'](?:next_steps?|recommendations?|specific_asks?|action_items?|gaps?|risks?|questions_to_ask|discovery_questions|follow_ups?)["']\s*:/g);
    signals += actionFields * 2;

    // Count items in JSON arrays that look like actions/questions
    const arrayItems = countMatches(text, /["'][^"']{10,}\?["']/g); // questions in arrays
    signals += arrayItems * 0.5;
  }

  if (signals >= 6) return 5;
  if (signals >= 4) return 4;
  if (signals >= 2) return 3;
  if (signals >= 1) return 2;
  return 1;
}

function scoreStructureProse(text: string): number {
  // For prose: paragraph clarity, sentence density, logical flow
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const sentences = countMatches(text, /[.!?]\s/g) + 1;
  const words = text.split(/\s+/).length;

  let score = 2;

  // Multiple coherent paragraphs = good structure
  if (paragraphs.length >= 4) score += 1;
  else if (paragraphs.length >= 2) score += 0.5;

  // Reasonable sentence density (not a wall of text)
  const avgWordsPerSentence = words / Math.max(sentences, 1);
  if (avgWordsPerSentence >= 10 && avgWordsPerSentence <= 30) score += 1;

  // Transition/flow signals
  const transitions = countMatches(text, /\b(?:however|therefore|specifically|because|given that|as a result|in contrast|for example|notably|critically|importantly|additionally|furthermore|meanwhile)\b/gi);
  if (transitions >= 3) score += 1;
  else if (transitions >= 1) score += 0.5;

  return clamp(Math.round(score), 1, 5);
}

function scoreStructureArtifact(text: string): number {
  const jsonContent = extractJsonContent(text);
  if (!jsonContent) {
    // Fallback to markdown structure if no JSON
    return scoreStructureMarkdown(text);
  }

  try {
    const parsed = JSON.parse(jsonContent);
    return scoreJsonDepth(parsed);
  } catch {
    // Might be partial JSON or code-fenced non-JSON
    return scoreStructureMarkdown(text);
  }
}

function scoreJsonDepth(obj: unknown, depth = 0): number {
  if (depth > 5) return 5;
  if (obj === null || obj === undefined) return 1;

  if (Array.isArray(obj)) {
    if (obj.length === 0) return 2;
    const maxChild = Math.max(...obj.map(item => scoreJsonDepth(item, depth + 1)));
    return clamp(Math.min(obj.length, 3) + maxChild - 1, 2, 5);
  }

  if (typeof obj === "object") {
    const keys = Object.keys(obj as Record<string, unknown>);
    if (keys.length === 0) return 2;

    // Unwrap single-key root wrappers (e.g. {"discovery_prep": {...}})
    // so the actual content depth is scored, not just the wrapper.
    if (keys.length === 1 && depth === 0) {
      const inner = (obj as Record<string, unknown>)[keys[0]];
      if (typeof inner === "object" && inner !== null && !Array.isArray(inner)) {
        return scoreJsonDepth(inner, depth);
      }
    }

    let score = 2;
    // Named sections / keys
    if (keys.length >= 5) score += 1;
    if (keys.length >= 8) score += 1;

    // Nested depth
    const hasNested = keys.some(k => {
      const v = (obj as Record<string, unknown>)[k];
      return typeof v === "object" && v !== null;
    });
    if (hasNested) score += 1;

    return clamp(score, 2, 5);
  }

  return 2;
}

function scoreStructureMarkdown(text: string): number {
  const headings = countMatches(text, /^#+\s+.+$/gm) + countMatches(text, /^[A-Z][A-Z\s&]+:?\s*$/gm);
  const bullets = countMatches(text, /^[\s]*[-•*]\s+/gm);
  const numberedItems = countMatches(text, /^\s*\d+[.)]\s+/gm);
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;

  const structureSignals = headings * 2 + bullets + numberedItems + Math.min(paragraphs, 5);

  if (structureSignals >= 10) return 5;
  if (structureSignals >= 6) return 4;
  if (structureSignals >= 3) return 3;
  if (structureSignals >= 1) return 2;
  return 1;
}

function scoreStructure(text: string, ctx?: ScoringContext): number {
  const shape = ctx?.shape ?? "unknown";
  const forbid = ctx?.forbid ?? [];

  // Structured artifact: score JSON depth, not markdown
  if (shape === "structured_artifact" || shape === "executive_brief") {
    if (isJsonLike(text)) return scoreStructureArtifact(text);
    // If artifact shape but no JSON, check markdown
    return scoreStructureMarkdown(text);
  }

  // Prose with forbidden formatting: score prose quality, not markdown
  if (shape === "prose" && (forbid.includes("headings") || forbid.includes("bullets"))) {
    return scoreStructureProse(text);
  }

  // List shape: could be markdown bullets or JSON array
  if (shape === "list") {
    if (isJsonLike(text)) return scoreStructureArtifact(text);
    return scoreStructureMarkdown(text);
  }

  // Default / unknown / baseline: use markdown scoring
  return scoreStructureMarkdown(text);
}

function scoreEvidence(text: string): number {
  const kiRefs = countMatches(text, /\b(?:KI|Knowledge Item|playbook|framework|methodology|MEDDICC|SPIN|Challenger|Sandler)\b/gi);
  const citations = countMatches(text, /\[(?:source|ref|KI|PB)[^\]]*\]/gi);
  const attributions = countMatches(text, /\b(?:according to|based on|per the|from the|as outlined in|as defined in)\b/gi);
  const quotedEvidence = countMatches(text, /"[^"]{10,}"/g);

  const total = kiRefs * 0.5 + citations * 2 + attributions + quotedEvidence;

  if (total >= 6) return 5;
  if (total >= 4) return 4;
  if (total >= 2) return 3;
  if (total >= 1) return 2;
  return 1;
}

function scoreRelevance(text: string, inputTerms: string[], ctx?: ScoringContext): number {
  if (inputTerms.length === 0) return 3;
  const lower = text.toLowerCase();
  const matched = inputTerms.filter(t => t.length > 2 && lower.includes(t.toLowerCase()));
  const ratio = matched.length / inputTerms.length;

  let baseScore: number;
  if (ratio >= 0.8) baseScore = 5;
  else if (ratio >= 0.6) baseScore = 4;
  else if (ratio >= 0.4) baseScore = 3;
  else if (ratio >= 0.2) baseScore = 2;
  else baseScore = 1;

  // Generic repetition penalty: if input terms are repeated many times
  // without evidence/business-impact/action specificity, penalize
  if (inputTerms.length > 0 && baseScore >= 4) {
    const totalMentions = inputTerms.reduce((sum, t) => {
      if (t.length <= 2) return sum;
      const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      return sum + countMatches(lower, re);
    }, 0);

    const avgMentions = totalMentions / Math.max(matched.length, 1);

    // High repetition with low substance = generic padding
    if (avgMentions > 4) {
      const evidenceCount = countMatches(text, /\b(?:according to|based on|per the|KI|playbook|framework|methodology|data shows|research)\b/gi);
      const actionCount = countMatches(text, /\b(?:must|recommend|propose|validate|schedule|prepare|draft|challenge|quantify|map|identify)\b/gi);
      const bizImpactCount = countMatches(lower, /\b(?:risk|cost|roi|revenue|churn|metric|pain|gap|savings|retention|conversion)\b/g);

      const substanceSignals = evidenceCount + actionCount + bizImpactCount;
      // Need meaningful substance, not just one incidental word
      if (substanceSignals < 3) {
        baseScore = clamp(baseScore - 1, 1, 5);
      }
    }
  }

  return baseScore;
}

/**
 * Business Impact — Command of the Message / Value Framework alignment.
 *
 * Detects presence and density of business impact signals in both
 * prose text AND structured JSON fields.
 */
function scoreBusinessImpact(text: string, ctx?: ScoringContext): number {
  const lower = text.toLowerCase();

  // Before / current state
  const beforeState = countMatches(lower, /\b(?:current state|today|currently|existing|as[- ]is|before|status quo|right now|at present)\b/g);

  // Negative consequences / cost-of-inaction
  const negConsequences = countMatches(lower, /\b(?:risk|cost of (?:inaction|delay)|consequence|losing|churn|attrition|leakage|erosion|pain|problem|challenge|gap|miss(?:ed|ing)|threat|exposure|vulnerability|downside|failure)\b/g);

  // After state / positive business outcomes
  const afterState = countMatches(lower, /\b(?:after|future state|ideal state|outcome|result|improvement|uplift|increase|growth|gain|benefit|advantage|opportunity|transform|achieve|goal|target|vision|aspiration)\b/g);

  // Required capabilities
  const capabilities = countMatches(lower, /\b(?:require|capability|need|must have|essential|critical|prerequisite|enable|unlock|differentiat)/g);

  // Metrics / ROI / quantified impact
  const metrics = countMatches(lower, /\b(?:roi|revenue|margin|cost|savings|efficiency|conversion|retention|ltv|lifetime value|arpu|aov|nrr|arr|mrr|pipeline|quota|close rate|win rate|cycle time|payback|irr)\b/g);
  const percentages = countMatches(text, /\d+(?:\.\d+)?%/g);
  const dollarAmounts = countMatches(text, /\$[\d,.]+[kKmMbB]?\b/g);

  // MEDDPICC signals
  const meddpicc = countMatches(lower, /\b(?:champion|economic buyer|decision criteria|decision process|identified pain|paper process|competition|metrics)\b/g);

  // Value framework sections
  const valueFramework = countMatches(lower, /\b(?:make[- ]money|save[- ]money|reduce[- ]risk|value driver|business case|commercial insight|pov|point of view|hypothesis)\b/g);

  // JSON/artifact field detection for structured outputs
  let artifactFieldBonus = 0;
  if (ctx?.shape === "structured_artifact" || ctx?.shape === "executive_brief" || ctx?.shape === "list" || isJsonLike(text)) {
    const fieldPatterns = [
      /["'](?:strategic_why|strategic_reasoning)["']\s*:/gi,
      /["'](?:commercial_insight|commercial_pov)["']\s*:/gi,
      /["'](?:change_vectors?|transformation_drivers?)["']\s*:/gi,
      /["'](?:risks?|risk_factors?)["']\s*:\s*[\[{]/gi,
      /["'](?:metrics|kpis?|measurements?)["']\s*:/gi,
      /["'](?:value|business_value|value_drivers?)["']\s*:/gi,
      /["'](?:business_case|justification)["']\s*:/gi,
      /["'](?:quantified_pain|pain_points?)["']\s*:/gi,
      /["'](?:current_state(?:_reasoning)?|before_state)["']\s*:/gi,
      /["'](?:negative_consequences?|cost_of_inaction)["']\s*:/gi,
    ];
    for (const p of fieldPatterns) {
      if (p.test(text)) artifactFieldBonus += 1.5;
    }
  }

  const totalSignals =
    Math.min(beforeState, 3) * 1 +
    Math.min(negConsequences, 4) * 1.5 +
    Math.min(afterState, 4) * 1 +
    Math.min(capabilities, 3) * 1 +
    Math.min(metrics + percentages + dollarAmounts, 5) * 1.5 +
    Math.min(meddpicc, 4) * 1 +
    Math.min(valueFramework, 3) * 1 +
    artifactFieldBonus;

  if (totalSignals >= 15) return 5;
  if (totalSignals >= 10) return 4;
  if (totalSignals >= 5) return 3;
  if (totalSignals >= 2) return 2;
  return 1;
}

// ── Public API ──

export function scoreOutput(text: string, inputTerms: string[], ctx?: ScoringContext): OutputScore {
  if (!text || text.trim().length === 0) {
    return { specificity: 1, actionability: 1, structure: 1, evidence: 1, relevance: 1, business_impact: 1, total: 6, normalized: 1 };
  }

  const specificity = scoreSpecificity(text);
  const actionability = scoreActionability(text, ctx);
  const structure = scoreStructure(text, ctx);
  const evidence = scoreEvidence(text);
  const relevance = scoreRelevance(text, inputTerms, ctx);
  const business_impact = scoreBusinessImpact(text, ctx);
  const total = specificity + actionability + structure + evidence + relevance + business_impact;

  return {
    specificity,
    actionability,
    structure,
    evidence,
    relevance,
    business_impact,
    total,
    normalized: Math.round((total / 6) * 10) / 10,
  };
}

export function compareOutputs(
  strategyText: string,
  baselineText: string,
  inputTerms: string[],
  strategyCtx?: ScoringContext,
): ComparisonResult {
  // Strategy scored with its manifest context; baseline always scored as generic prose
  const strategy_score = scoreOutput(strategyText, inputTerms, strategyCtx);
  const baseline_score = scoreOutput(baselineText, inputTerms);

  const dims = ["specificity", "actionability", "structure", "evidence", "relevance", "business_impact"] as const;
  const dimension_winners: Record<string, "strategy" | "baseline" | "tie"> = {};

  for (const d of dims) {
    if (strategy_score[d] > baseline_score[d]) dimension_winners[d] = "strategy";
    else if (strategy_score[d] < baseline_score[d]) dimension_winners[d] = "baseline";
    else dimension_winners[d] = "tie";
  }

  let winner: "strategy" | "baseline" | "tie";
  const diff = strategy_score.total - baseline_score.total;
  if (diff > 0) winner = "strategy";
  else if (diff < 0) winner = "baseline";
  else winner = "tie";

  const strategyWins = Object.values(dimension_winners).filter(w => w === "strategy").length;
  const baselineWins = Object.values(dimension_winners).filter(w => w === "baseline").length;

  const reasoning = winner === "tie"
    ? `Tied at ${strategy_score.total}/30. Strategy won ${strategyWins} dimensions, baseline won ${baselineWins}.`
    : `${winner === "strategy" ? "Strategy" : "Baseline"} wins ${strategy_score.total} vs ${baseline_score.total} (${Math.abs(diff)} point${Math.abs(diff) !== 1 ? "s" : ""}). Strategy won ${strategyWins}/6 dimensions, baseline won ${baselineWins}/6.`;

  return { strategy_score, baseline_score, winner, reasoning, dimension_winners };
}
