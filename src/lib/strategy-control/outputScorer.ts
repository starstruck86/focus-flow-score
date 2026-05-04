/**
 * Phase 3.5A — Deterministic Output Scorer.
 *
 * Scores a text output on 5 dimensions (1–5 each):
 *   1. Specificity  — concrete entities/numbers vs generic filler
 *   2. Actionability — clear next steps, imperatives, calls-to-action
 *   3. Structure     — headings, bullets, sections, logical flow
 *   4. Evidence      — citations, KI references, data points
 *   5. Relevance     — input terms echoed meaningfully
 *
 * All scoring is deterministic (regex / counting). No LLM judge.
 */

export interface OutputScore {
  specificity: number;
  actionability: number;
  structure: number;
  evidence: number;
  relevance: number;
  total: number;        // sum /25
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

  // Concrete signals: numbers, percentages, proper nouns (capitalized mid-sentence), quoted terms
  const numbers = countMatches(text, /\b\d[\d,.]*%?\b/g);
  const properNouns = countMatches(text, /(?<=[.!?]\s+|^)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/gm);
  const quotedTerms = countMatches(text, /"[^"]{2,}"/g);

  // Generic filler penalties
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

  let score = 2; // baseline
  if (densityPer100 > 3) score = 4;
  else if (densityPer100 > 1.5) score = 3;
  if (genericCount > 3) score -= 1;
  if (genericCount === 0 && concreteSignal > 5) score += 1;

  return clamp(score, 1, 5);
}

function scoreActionability(text: string): number {
  // Imperative verbs at start of sentences/bullets
  const imperatives = countMatches(text, /(?:^|\n|•|[-*])\s*(?:Ask|Propose|Send|Schedule|Confirm|Validate|Map|Identify|Prepare|Draft|Review|Challenge|Test|Open|Frame|Position|Present|Quantify|Document|Follow[- ]up)\b/gi);
  // "Next step" / "action item" patterns
  const nextSteps = countMatches(text, /\b(?:next step|action item|to[- ]do|follow[- ]up|recommendation)\b/gi);
  // Question marks (discovery questions count)
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
  // KI/playbook references
  const kiRefs = countMatches(text, /\b(?:KI|Knowledge Item|playbook|framework|methodology|MEDDICC|SPIN|Challenger|Sandler)\b/gi);
  // Citation patterns
  const citations = countMatches(text, /\[(?:source|ref|KI|PB)[^\]]*\]/gi);
  // "According to" / "Based on" patterns
  const attributions = countMatches(text, /\b(?:according to|based on|per the|from the|as outlined in|as defined in)\b/gi);
  // Quoted best practices
  const quotedEvidence = countMatches(text, /"[^"]{10,}"/g);

  const total = kiRefs * 0.5 + citations * 2 + attributions + quotedEvidence;

  if (total >= 6) return 5;
  if (total >= 4) return 4;
  if (total >= 2) return 3;
  if (total >= 1) return 2;
  return 1;
}

function scoreRelevance(text: string, inputTerms: string[]): number {
  if (inputTerms.length === 0) return 3; // neutral if no terms
  const lower = text.toLowerCase();
  const matched = inputTerms.filter(t => t.length > 2 && lower.includes(t.toLowerCase()));
  const ratio = matched.length / inputTerms.length;

  if (ratio >= 0.8) return 5;
  if (ratio >= 0.6) return 4;
  if (ratio >= 0.4) return 3;
  if (ratio >= 0.2) return 2;
  return 1;
}

// ── Public API ──

export function scoreOutput(text: string, inputTerms: string[]): OutputScore {
  if (!text || text.trim().length === 0) {
    return { specificity: 1, actionability: 1, structure: 1, evidence: 1, relevance: 1, total: 5, normalized: 1 };
  }

  const specificity = scoreSpecificity(text);
  const actionability = scoreActionability(text);
  const structure = scoreStructure(text);
  const evidence = scoreEvidence(text);
  const relevance = scoreRelevance(text, inputTerms);
  const total = specificity + actionability + structure + evidence + relevance;

  return {
    specificity,
    actionability,
    structure,
    evidence,
    relevance,
    total,
    normalized: Math.round((total / 5) * 10) / 10,
  };
}

export function compareOutputs(
  strategyText: string,
  baselineText: string,
  inputTerms: string[],
): ComparisonResult {
  const strategy_score = scoreOutput(strategyText, inputTerms);
  const baseline_score = scoreOutput(baselineText, inputTerms);

  const dims = ["specificity", "actionability", "structure", "evidence", "relevance"] as const;
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
    ? `Tied at ${strategy_score.total}/25. Strategy won ${strategyWins} dimensions, baseline won ${baselineWins}.`
    : `${winner === "strategy" ? "Strategy" : "Baseline"} wins ${strategy_score.total} vs ${baseline_score.total} (${Math.abs(diff)} point${Math.abs(diff) !== 1 ? "s" : ""}). Strategy won ${strategyWins}/5 dimensions, baseline won ${baselineWins}/5.`;

  return { strategy_score, baseline_score, winner, reasoning, dimension_winners };
}
