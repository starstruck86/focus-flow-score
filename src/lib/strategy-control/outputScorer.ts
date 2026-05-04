/**
 * Phase 3.5B — Deterministic Output Scorer.
 *
 * Scores a text output on 6 dimensions (1–5 each):
 *   1. Specificity     — concrete entities/numbers vs generic filler
 *   2. Actionability   — clear next steps, imperatives, calls-to-action
 *   3. Structure       — headings, bullets, sections, logical flow
 *   4. Evidence        — citations, KI references, data points
 *   5. Relevance       — input terms echoed meaningfully
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

function scoreActionability(text: string): number {
  const imperatives = countMatches(text, /(?:^|\n|•|[-*])\s*(?:Ask|Propose|Send|Schedule|Confirm|Validate|Map|Identify|Prepare|Draft|Review|Challenge|Test|Open|Frame|Position|Present|Quantify|Document|Follow[- ]up)\b/gi);
  const nextSteps = countMatches(text, /\b(?:next step|action item|to[- ]do|follow[- ]up|recommendation)\b/gi);
  const questions = countMatches(text, /\?/g);

  const signals = imperatives + nextSteps * 1.5 + questions * 0.5;

  if (signals >= 6) return 5;
  if (signals >= 4) return 4;
  if (signals >= 2) return 3;
  if (signals >= 1) return 2;
  return 1;
}

function scoreStructure(text: string): number {
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

function scoreRelevance(text: string, inputTerms: string[]): number {
  if (inputTerms.length === 0) return 3;
  const lower = text.toLowerCase();
  const matched = inputTerms.filter(t => t.length > 2 && lower.includes(t.toLowerCase()));
  const ratio = matched.length / inputTerms.length;

  if (ratio >= 0.8) return 5;
  if (ratio >= 0.6) return 4;
  if (ratio >= 0.4) return 3;
  if (ratio >= 0.2) return 2;
  return 1;
}

/**
 * Business Impact — Command of the Message / Value Framework alignment.
 *
 * Detects presence and density of:
 *   - Before/current state language
 *   - Negative consequences / cost-of-inaction
 *   - After state / positive business outcomes
 *   - Required capabilities
 *   - Metrics / ROI / quantified impact
 *   - MEDDPICC signals (champion, economic buyer, decision criteria)
 */
function scoreBusinessImpact(text: string): number {
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

  const totalSignals =
    Math.min(beforeState, 3) * 1 +
    Math.min(negConsequences, 4) * 1.5 +
    Math.min(afterState, 4) * 1 +
    Math.min(capabilities, 3) * 1 +
    Math.min(metrics + percentages + dollarAmounts, 5) * 1.5 +
    Math.min(meddpicc, 4) * 1 +
    Math.min(valueFramework, 3) * 1;

  if (totalSignals >= 15) return 5;
  if (totalSignals >= 10) return 4;
  if (totalSignals >= 5) return 3;
  if (totalSignals >= 2) return 2;
  return 1;
}

// ── Public API ──

export function scoreOutput(text: string, inputTerms: string[]): OutputScore {
  if (!text || text.trim().length === 0) {
    return { specificity: 1, actionability: 1, structure: 1, evidence: 1, relevance: 1, business_impact: 1, total: 6, normalized: 1 };
  }

  const specificity = scoreSpecificity(text);
  const actionability = scoreActionability(text);
  const structure = scoreStructure(text);
  const evidence = scoreEvidence(text);
  const relevance = scoreRelevance(text, inputTerms);
  const business_impact = scoreBusinessImpact(text);
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
): ComparisonResult {
  const strategy_score = scoreOutput(strategyText, inputTerms);
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
