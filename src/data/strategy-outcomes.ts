/**
 * Data access + performance scoring for strategy outcome tracking.
 */
import { supabase } from '@/integrations/supabase/client';

// ── Types ───────────────────────────────────────────────────────

export type OutcomeEventType = 'shown' | 'acted' | 'outcome_recorded';
export type OutcomeResult = 'meeting_booked' | 'deal_progressed' | 'no_change' | 'negative';

export interface StrategyOutcomeInsert {
  user_id: string;
  insight_id: string;
  insight_text: string;
  insight_maturity: string;
  event_type: OutcomeEventType;
  deal_stage?: string;
  execution_state?: string;
  account_type?: string;
  outcome?: OutcomeResult | string;
  user_feedback?: string;
  score_at_recommendation?: number;
  context_metadata?: Record<string, any>;
}

export interface StrategyOutcomeRow extends StrategyOutcomeInsert {
  id: string;
  created_at: string;
}

// ── CRUD ────────────────────────────────────────────────────────

export async function recordStrategyEvent(payload: StrategyOutcomeInsert): Promise<void> {
  const { error } = await (supabase as any)
    .from('strategy_outcomes')
    .insert(payload);
  if (error) throw error;
}

export async function getStrategyOutcomes(
  userId: string,
  filters?: { insightId?: string; limit?: number },
): Promise<StrategyOutcomeRow[]> {
  let query = (supabase as any)
    .from('strategy_outcomes')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (filters?.insightId) query = query.eq('insight_id', filters.insightId);
  query = query.limit(filters?.limit || 200);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as StrategyOutcomeRow[];
}

// ── Performance Scoring ─────────────────────────────────────────

export interface StrategyPerformance {
  insightId: string;
  timesShown: number;
  timesActed: number;
  outcomes: { positive: number; neutral: number; negative: number };
  successRate: number;        // 0-1
  personalBoost: number;      // -0.15 to +0.15
  summary: string;            // human-readable
}

const POSITIVE_OUTCOMES = new Set<string>(['meeting_booked', 'deal_progressed']);
const NEGATIVE_OUTCOMES = new Set<string>(['negative']);

export function computePerformance(outcomes: StrategyOutcomeRow[]): Map<string, StrategyPerformance> {
  const byInsight = new Map<string, StrategyOutcomeRow[]>();
  for (const o of outcomes) {
    if (!byInsight.has(o.insight_id)) byInsight.set(o.insight_id, []);
    byInsight.get(o.insight_id)!.push(o);
  }

  const result = new Map<string, StrategyPerformance>();

  for (const [insightId, events] of byInsight) {
    const shown = events.filter(e => e.event_type === 'shown').length;
    const acted = events.filter(e => e.event_type === 'acted').length;
    const withOutcome = events.filter(e => e.event_type === 'outcome_recorded' && e.outcome);

    const positive = withOutcome.filter(e => POSITIVE_OUTCOMES.has(e.outcome!)).length;
    const negative = withOutcome.filter(e => NEGATIVE_OUTCOMES.has(e.outcome!)).length;
    const neutral = withOutcome.length - positive - negative;

    const successRate = withOutcome.length >= 2
      ? positive / withOutcome.length
      : 0.5; // neutral default until enough data

    // Personal boost: ±0.15 max, requires ≥3 outcome events for signal
    let personalBoost = 0;
    if (withOutcome.length >= 3) {
      personalBoost = (successRate - 0.5) * 0.3; // maps 0-1 range to -0.15..+0.15
      personalBoost = Math.max(-0.15, Math.min(0.15, personalBoost));
    }

    // Summary
    let summary: string;
    if (withOutcome.length < 2) {
      summary = 'Not enough data yet';
    } else if (successRate >= 0.7) {
      summary = `Strong performer — ${positive}/${withOutcome.length} positive outcomes`;
    } else if (successRate >= 0.4) {
      summary = `Mixed results — ${positive} positive, ${neutral} neutral, ${negative} negative`;
    } else {
      summary = `Underperforming — ${positive}/${withOutcome.length} positive outcomes recently`;
    }

    result.set(insightId, {
      insightId,
      timesShown: shown,
      timesActed: acted,
      outcomes: { positive, neutral, negative },
      successRate,
      personalBoost,
      summary,
    });
  }

  return result;
}

/**
 * Fetch and compute performance map for a user (cached per session via caller).
 */
export async function getUserPerformanceMap(userId: string): Promise<Map<string, StrategyPerformance>> {
  const outcomes = await getStrategyOutcomes(userId, { limit: 500 });
  return computePerformance(outcomes);
}
