/**
 * Pipeline Impact Engine
 *
 * Connects strategy usage to pipeline outcomes: meetings, opportunities,
 * deal progression, and revenue influence.
 */
import { supabase } from '@/integrations/supabase/client';
import type { StrategyOutcomeRow } from './strategy-outcomes';

// ── Types ───────────────────────────────────────────────────────

export type PipelineOutcomeType =
  | 'meeting_booked'
  | 'opportunity_created'
  | 'stage_progression'
  | 'deal_value_influenced';

export interface PipelineEvent {
  insightId: string;
  outcomeType: PipelineOutcomeType;
  opportunityId?: string;
  dealValue?: number;
  fromStage?: string;
  toStage?: string;
  timestamp: string;
}

export interface StrategyPipelineImpact {
  insightId: string;
  meetingsGenerated: number;
  opportunitiesCreated: number;
  stageProgressions: number;
  pipelineValueInfluenced: number;
  lastImpactDate: string | null;
  weightedScore: number;
}

export interface AggregatedPipelineImpact {
  totalMeetings: number;
  totalOpportunities: number;
  totalProgressions: number;
  totalPipelineValue: number;
  totalWeightedScore: number;
  topStrategies: StrategyPipelineImpact[];
  byContext: Map<string, StrategyPipelineImpact>;
}

// ── Outcome quality weights ─────────────────────────────────────

const OUTCOME_QUALITY_WEIGHT: Record<PipelineOutcomeType, number> = {
  meeting_booked: 0.4,
  opportunity_created: 0.7,
  stage_progression: 0.8,
  deal_value_influenced: 1.0,
};

// ── Recency decay ───────────────────────────────────────────────

const HALF_LIFE_DAYS = 30;

function recencyMultiplier(eventDateStr: string): number {
  const ageDays = Math.max(0, (Date.now() - new Date(eventDateStr).getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

// ── Outcome-to-pipeline type mapping ────────────────────────────

const OUTCOME_TO_PIPELINE: Record<string, PipelineOutcomeType | null> = {
  meeting_booked: 'meeting_booked',
  deal_progressed: 'stage_progression',
  opportunity_created: 'opportunity_created',
  no_change: null,
  negative: null,
};

// ── Record pipeline-linked outcome ──────────────────────────────

export async function recordPipelineOutcome(
  userId: string,
  event: PipelineEvent,
): Promise<void> {
  const { error } = await (supabase as any)
    .from('strategy_outcomes')
    .insert({
      user_id: userId,
      insight_id: event.insightId,
      insight_text: '',
      insight_maturity: '',
      event_type: 'outcome_recorded',
      outcome: event.outcomeType,
      deal_stage: event.toStage || event.fromStage,
      context_metadata: {
        pipeline_event: true,
        opportunity_id: event.opportunityId || null,
        deal_value: event.dealValue || 0,
        from_stage: event.fromStage || null,
        to_stage: event.toStage || null,
      },
    });
  if (error) throw error;
}

// ── Compute pipeline impact from existing outcomes ──────────────

export function computePipelineImpact(
  outcomes: StrategyOutcomeRow[],
): Map<string, StrategyPipelineImpact> {
  const map = new Map<string, StrategyPipelineImpact>();

  for (const o of outcomes) {
    if (o.event_type !== 'outcome_recorded' || !o.outcome) continue;

    const pipelineType = OUTCOME_TO_PIPELINE[o.outcome] ?? inferPipelineType(o);
    if (!pipelineType) continue;

    if (!map.has(o.insight_id)) {
      map.set(o.insight_id, {
        insightId: o.insight_id,
        meetingsGenerated: 0,
        opportunitiesCreated: 0,
        stageProgressions: 0,
        pipelineValueInfluenced: 0,
        lastImpactDate: null,
      });
    }

    const impact = map.get(o.insight_id)!;
    const meta = (o.context_metadata || {}) as Record<string, any>;
    const dealValue = meta.deal_value || 0;

    switch (pipelineType) {
      case 'meeting_booked':
        impact.meetingsGenerated++;
        break;
      case 'opportunity_created':
        impact.opportunitiesCreated++;
        impact.pipelineValueInfluenced += dealValue;
        break;
      case 'stage_progression':
        impact.stageProgressions++;
        impact.pipelineValueInfluenced += dealValue;
        break;
      case 'deal_value_influenced':
        impact.pipelineValueInfluenced += dealValue;
        break;
    }

    if (!impact.lastImpactDate || o.created_at > impact.lastImpactDate) {
      impact.lastImpactDate = o.created_at;
    }
  }

  return map;
}

/**
 * Infer pipeline type from context_metadata when outcome string
 * doesn't directly map (graceful/inferred linkage).
 */
function inferPipelineType(o: StrategyOutcomeRow): PipelineOutcomeType | null {
  const meta = (o.context_metadata || {}) as Record<string, any>;
  if (meta.pipeline_event) return meta.outcome_type || null;
  if (meta.opportunity_id) return 'deal_value_influenced';
  if (meta.deal_value && meta.deal_value > 0) return 'deal_value_influenced';
  return null;
}

// ── Aggregate across all strategies ─────────────────────────────

export function aggregatePipelineImpact(
  impactMap: Map<string, StrategyPipelineImpact>,
): AggregatedPipelineImpact {
  let totalMeetings = 0;
  let totalOpportunities = 0;
  let totalProgressions = 0;
  let totalPipelineValue = 0;

  const entries = [...impactMap.values()];
  for (const e of entries) {
    totalMeetings += e.meetingsGenerated;
    totalOpportunities += e.opportunitiesCreated;
    totalProgressions += e.stageProgressions;
    totalPipelineValue += e.pipelineValueInfluenced;
  }

  const topStrategies = entries
    .sort((a, b) => b.pipelineValueInfluenced - a.pipelineValueInfluenced
      || (b.meetingsGenerated + b.opportunitiesCreated) - (a.meetingsGenerated + a.opportunitiesCreated))
    .slice(0, 10);

  return {
    totalMeetings,
    totalOpportunities,
    totalProgressions,
    totalPipelineValue,
    topStrategies,
    byContext: new Map(), // populated by caller if needed
  };
}

// ── Fetch and compute for a user ────────────────────────────────

export async function getUserPipelineImpact(
  userId: string,
): Promise<AggregatedPipelineImpact> {
  const { data, error } = await (supabase as any)
    .from('strategy_outcomes')
    .select('*')
    .eq('user_id', userId)
    .eq('event_type', 'outcome_recorded')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;
  const impactMap = computePipelineImpact((data || []) as StrategyOutcomeRow[]);
  return aggregatePipelineImpact(impactMap);
}

// ── Format pipeline impact for Dave ─────────────────────────────

export function formatPipelineImpact(impact: StrategyPipelineImpact): string {
  const parts: string[] = [];
  if (impact.meetingsGenerated > 0) parts.push(`${impact.meetingsGenerated} meeting${impact.meetingsGenerated > 1 ? 's' : ''}`);
  if (impact.opportunitiesCreated > 0) parts.push(`${impact.opportunitiesCreated} opp${impact.opportunitiesCreated > 1 ? 's' : ''} created`);
  if (impact.stageProgressions > 0) parts.push(`${impact.stageProgressions} stage advance${impact.stageProgressions > 1 ? 's' : ''}`);
  if (impact.pipelineValueInfluenced > 0) parts.push(`$${Math.round(impact.pipelineValueInfluenced / 1000)}k influenced`);
  return parts.length ? parts.join(' · ') : 'No pipeline impact yet';
}

export function formatAggregatedImpact(agg: AggregatedPipelineImpact): string {
  const lines: string[] = ['📊 **Pipeline Impact Summary**\n'];
  lines.push(`Meetings generated: **${agg.totalMeetings}**`);
  lines.push(`Opportunities created: **${agg.totalOpportunities}**`);
  lines.push(`Stage progressions: **${agg.totalProgressions}**`);
  lines.push(`Pipeline influenced: **$${Math.round(agg.totalPipelineValue / 1000)}k**`);

  if (agg.topStrategies.length) {
    lines.push('\n**Top strategies by impact:**');
    for (const s of agg.topStrategies.slice(0, 5)) {
      lines.push(`  → \`${s.insightId.slice(0, 12)}…\` — ${formatPipelineImpact(s)}`);
    }
  }

  return lines.join('\n');
}
