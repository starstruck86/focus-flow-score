/**
 * Playbook Recommendation Engine
 * 
 * Read-only context engine that evaluates the current workflow moment
 * and selects ONE best playbook from the library.
 */
import { useMemo } from 'react';
import { usePlaybooks, type Playbook } from './usePlaybooks';
import { useStore } from '@/store/useStore';

export interface WorkflowContext {
  blockType?: 'prospecting' | 'meeting' | 'research' | 'admin' | 'break' | 'pipeline' | 'prep' | 'build';
  accountId?: string;
  opportunityId?: string;
  dealStage?: string;
  dealStatus?: string;
  daysSinceTouch?: number | null;
  arrValue?: number;
}

export interface PlaybookRecommendation {
  playbook: Playbook;
  reason: string;
  confidence: number;
  cta: 'use' | 'practice' | 'prep';
}

const STAGE_MAP: Record<string, string> = {
  '': 'Prospecting',
  'Prospect': 'Prospecting',
  'Discover': 'Discovery',
  'Demo': 'Demo',
  'Proposal': 'Negotiation',
  'Negotiate': 'Negotiation',
  'Closing': 'Closing',
  'Closed Won': 'Closing',
  'Closed Lost': 'Closing',
};

const BLOCK_TO_STAGES: Record<string, string[]> = {
  prospecting: ['Prospecting'],
  meeting: ['Discovery', 'Demo', 'Negotiation', 'Closing'],
  prep: ['Discovery', 'Demo', 'Negotiation'],
  build: ['Prospecting', 'Discovery'],
  pipeline: ['Negotiation', 'Closing', 'Renewal'],
  research: ['Prospecting', 'Discovery'],
};

function scorePlaybook(playbook: Playbook, ctx: WorkflowContext): number {
  let score = playbook.confidence_score / 100; // 0-1 base from confidence

  // Stage fit bonus
  const contextStages: string[] = [];
  if (ctx.dealStage) {
    const mapped = STAGE_MAP[ctx.dealStage];
    if (mapped) contextStages.push(mapped);
  }
  if (ctx.blockType && BLOCK_TO_STAGES[ctx.blockType]) {
    contextStages.push(...BLOCK_TO_STAGES[ctx.blockType]);
  }

  if (contextStages.length > 0) {
    const stageMatch = playbook.stage_fit.some(s =>
      contextStages.some(cs => cs.toLowerCase() === s.toLowerCase())
    );
    if (stageMatch) score += 0.35;
  }

  // Risk/stagnation signals boost urgency-related playbooks
  if (ctx.daysSinceTouch != null && ctx.daysSinceTouch > 7) {
    const pt = playbook.problem_type.toLowerCase();
    if (pt.includes('stall') || pt.includes('urgency') || pt.includes('recover') || pt.includes('next step')) {
      score += 0.25;
    }
  }

  // Deal status signals
  if (ctx.dealStatus === 'stalled') {
    const pt = playbook.problem_type.toLowerCase();
    if (pt.includes('stall') || pt.includes('recover') || pt.includes('urgency')) {
      score += 0.3;
    }
  }

  // Block type specific boosts
  if (ctx.blockType === 'prospecting') {
    const pt = playbook.problem_type.toLowerCase();
    if (pt.includes('opener') || pt.includes('prospect') || pt.includes('connect')) {
      score += 0.2;
    }
  }
  if (ctx.blockType === 'meeting' || ctx.blockType === 'prep') {
    const pt = playbook.problem_type.toLowerCase();
    if (pt.includes('discovery') || pt.includes('objection') || pt.includes('multi-thread') || pt.includes('demo')) {
      score += 0.2;
    }
  }

  return score;
}

function buildReason(playbook: Playbook, ctx: WorkflowContext): string {
  if (ctx.dealStatus === 'stalled') {
    return `This deal is stalled — ${playbook.title.toLowerCase()} can drive movement.`;
  }
  if (ctx.daysSinceTouch != null && ctx.daysSinceTouch > 7) {
    return `No touch in ${ctx.daysSinceTouch}d — use this to re-engage.`;
  }
  if (ctx.blockType === 'prospecting') {
    return `You're in a prospecting block — this sharpens your approach.`;
  }
  if (ctx.blockType === 'meeting' || ctx.blockType === 'prep') {
    return `Prep for your upcoming conversation with this playbook.`;
  }
  if (ctx.dealStage) {
    return `Matched to your ${ctx.dealStage} stage — high relevance now.`;
  }
  return playbook.when_to_use;
}

function pickCta(ctx: WorkflowContext): 'use' | 'practice' | 'prep' {
  if (ctx.blockType === 'meeting') return 'use';
  if (ctx.blockType === 'prep' || ctx.blockType === 'research') return 'prep';
  return 'practice';
}

export function selectPlaybook(
  playbooks: Playbook[],
  ctx: WorkflowContext
): PlaybookRecommendation | null {
  if (!playbooks.length) return null;

  let best: Playbook | null = null;
  let bestScore = -1;

  for (const p of playbooks) {
    const s = scorePlaybook(p, ctx);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }

  if (!best) return null;

  return {
    playbook: best,
    reason: buildReason(best, ctx),
    confidence: Math.round(bestScore * 100),
    cta: pickCta(ctx),
  };
}

/**
 * Hook: returns ONE playbook recommendation for the given workflow context.
 */
export function usePlaybookRecommendation(ctx: WorkflowContext): PlaybookRecommendation | null {
  const { data: playbooks = [] } = usePlaybooks();

  return useMemo(() => {
    if (!playbooks.length) return null;
    return selectPlaybook(playbooks, ctx);
  }, [playbooks, ctx.blockType, ctx.accountId, ctx.opportunityId, ctx.dealStage, ctx.dealStatus, ctx.daysSinceTouch]);
}

/**
 * Hook for opportunity detail page: auto-builds context from opp data.
 */
export function useOppPlaybookRecommendation(oppId?: string) {
  const { opportunities } = useStore();
  const opp = opportunities.find(o => o.id === oppId);

  const ctx = useMemo<WorkflowContext>(() => {
    if (!opp) return {};
    const daysSinceTouch = opp.lastTouchDate
      ? Math.floor((Date.now() - new Date(opp.lastTouchDate).getTime()) / 86400000)
      : null;
    return {
      opportunityId: opp.id,
      accountId: opp.accountId ?? undefined,
      dealStage: opp.stage ?? undefined,
      dealStatus: opp.status ?? undefined,
      daysSinceTouch,
      arrValue: typeof opp.arr === 'number' ? opp.arr : undefined,
    };
  }, [opp]);

  return usePlaybookRecommendation(ctx);
}
