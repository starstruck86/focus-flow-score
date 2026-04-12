/**
 * V5 Arc-Level Scoring
 *
 * Aggregates turn-level scores into a conversation-flow verdict.
 * Deterministic — no AI calls.
 */

import type { DojoScoreResult } from '../types';

// ── Types ─────────────────────────────────────────────────────────

export interface ArcTurnResult {
  turnIndex: number;
  score: number;
  topMistake: string;
  feedback: string;
  focusApplied?: string;
}

export interface ArcScore {
  averageTurnScore: number;
  flowControlScore: number;
  consistencyScore: number;
  closingScore: number;
  overallScore: number;
  arcTopMistake: string | null;
  summary: string;
  strongestTurn: number;
  weakestTurn: number;
  controlHeld: boolean;
}

// ── Compute Arc Score ─────────────────────────────────────────────

export function computeArcScore(turnResults: ArcTurnResult[]): ArcScore {
  if (turnResults.length === 0) {
    return {
      averageTurnScore: 0, flowControlScore: 0, consistencyScore: 0,
      closingScore: 0, overallScore: 0, arcTopMistake: null,
      summary: 'No turns completed.', strongestTurn: 0, weakestTurn: 0,
      controlHeld: false,
    };
  }

  const scores = turnResults.map(t => t.score);
  const n = scores.length;

  // Average
  const averageTurnScore = Math.round(scores.reduce((a, b) => a + b, 0) / n);

  // Consistency (lower variance = higher score)
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  let consistencyScore: number;
  if (stdDev <= 5) consistencyScore = 95;
  else if (stdDev <= 10) consistencyScore = 80;
  else if (stdDev <= 15) consistencyScore = 60;
  else consistencyScore = 40;

  // Flow control: penalize severe drops between consecutive turns
  let flowControlScore = 100;
  for (let i = 1; i < n; i++) {
    const drop = scores[i - 1] - scores[i];
    if (drop >= 20) flowControlScore -= 30;
    else if (drop >= 12) flowControlScore -= 20;
    else if (drop >= 8) flowControlScore -= 10;
  }
  flowControlScore = Math.max(0, Math.min(100, flowControlScore));

  // Closing score: final turn quality
  const closingScore = scores[n - 1];

  // Overall: weighted blend
  const overallScore = Math.round(
    averageTurnScore * 0.4 +
    flowControlScore * 0.2 +
    consistencyScore * 0.2 +
    closingScore * 0.2
  );

  // Strongest / weakest
  const strongestTurn = scores.indexOf(Math.max(...scores));
  const weakestTurn = scores.indexOf(Math.min(...scores));

  // Arc-level top mistake: the mistake from the weakest turn
  const arcTopMistake = turnResults[weakestTurn]?.topMistake || null;

  // Control held?
  const maxDrop = Math.max(0, ...scores.slice(1).map((s, i) => scores[i] - s));
  const controlHeld = maxDrop < 12 && closingScore >= 60;

  // Summary
  const summary = generateSummary(scores, flowControlScore, controlHeld, closingScore, strongestTurn, weakestTurn);

  return {
    averageTurnScore,
    flowControlScore,
    consistencyScore,
    closingScore,
    overallScore,
    arcTopMistake,
    summary,
    strongestTurn,
    weakestTurn,
    controlHeld,
  };
}

// ── Summary Generation ────────────────────────────────────────────

function generateSummary(
  scores: number[],
  flowControl: number,
  controlHeld: boolean,
  closingScore: number,
  strongestTurn: number,
  weakestTurn: number,
): string {
  const parts: string[] = [];

  if (controlHeld && flowControl >= 80) {
    parts.push('Flow held across all turns. That\'s rare — strong rep.');
  } else if (flowControl >= 60) {
    parts.push('Decent flow, but some control slippage between turns.');
  } else {
    parts.push('Flow broke down mid-conversation. Control was lost.');
  }

  if (strongestTurn !== weakestTurn) {
    parts.push(`Turn ${strongestTurn + 1} was your strongest response. Turn ${weakestTurn + 1} is where things broke.`);
  }

  if (closingScore < 55) {
    parts.push('Weak close — failed to convert into a clear next step.');
  } else if (closingScore >= 75) {
    parts.push('Strong close with a concrete next step.');
  }

  return parts.join(' ');
}

// ── Helpers ───────────────────────────────────────────────────────

/** Convert DojoScoreResult to ArcTurnResult */
export function toArcTurnResult(turnIndex: number, result: DojoScoreResult): ArcTurnResult {
  return {
    turnIndex,
    score: result.score,
    topMistake: result.topMistake,
    feedback: result.feedback,
    focusApplied: result.focusApplied,
  };
}
