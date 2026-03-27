/**
 * Playbook Recommendation Engine
 * 
 * Read-only context engine that evaluates the current workflow moment
 * and selects ONE best playbook from the library.
 * 
 * Hardened: confidence gating, stickiness, suppression, precise reasoning.
 */
import { useMemo, useRef } from 'react';
import { usePlaybooks, type Playbook } from './usePlaybooks';
import { useStore } from '@/store/useStore';

export interface WorkflowContext {
  blockType?: 'prospecting' | 'meeting' | 'research' | 'admin' | 'break' | 'pipeline' | 'prep' | 'build' | 'roleplay';
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

/** Minimum confidence (0-100) required to surface a recommendation */
const CONFIDENCE_THRESHOLD = 45;

/** Minimum score improvement required to unseat a sticky recommendation */
const STICKINESS_MARGIN = 15;

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

/** Blocks that carry enough signal to warrant a recommendation */
const ACTIONABLE_BLOCKS = new Set<string>(['prospecting', 'meeting', 'prep', 'build', 'pipeline', 'research']);

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
  // Build specific, context-tied reasoning — never generic
  if (ctx.dealStatus === 'stalled' && ctx.daysSinceTouch != null) {
    return `Deal stalled with no activity in ${ctx.daysSinceTouch}d — "${playbook.title}" forces movement by ${playbook.deal_impact || 'creating urgency'}.`;
  }
  if (ctx.dealStatus === 'stalled') {
    return `Deal stalled — "${playbook.title}" drives movement: ${playbook.deal_impact || 'surfaces blockers and forces next step'}.`;
  }
  if (ctx.daysSinceTouch != null && ctx.daysSinceTouch > 14) {
    return `${ctx.daysSinceTouch}d since last touch — high risk of going dark. Use this to re-engage before the deal dies.`;
  }
  if (ctx.daysSinceTouch != null && ctx.daysSinceTouch > 7) {
    return `No touch in ${ctx.daysSinceTouch}d — momentum fading. This playbook re-establishes engagement and forces a next step.`;
  }
  if (ctx.blockType === 'prospecting') {
    return `Prospecting block active — this sharpens your opener and increases connect-to-conversation rate.`;
  }
  if (ctx.blockType === 'meeting') {
    return `Live call context — use this to control the conversation and drive a clear outcome.`;
  }
  if (ctx.blockType === 'prep') {
    return `Prep block — rehearse this framework so you execute with precision on the call.`;
  }
  if (ctx.dealStage) {
    const mapped = STAGE_MAP[ctx.dealStage] || ctx.dealStage;
    return `${mapped} stage — this playbook addresses the key risk at this point in the deal cycle.`;
  }
  return playbook.when_to_use;
}

function pickCta(ctx: WorkflowContext): 'use' | 'practice' | 'prep' {
  if (ctx.blockType === 'meeting') return 'use';
  if (ctx.blockType === 'prep' || ctx.blockType === 'research') return 'prep';
  return 'practice';
}

/**
 * Determine if the current context has enough signal to warrant a recommendation.
 */
function hasActionableSignal(ctx: WorkflowContext): boolean {
  // Must have at least one meaningful signal
  if (ctx.dealStatus === 'stalled') return true;
  if (ctx.daysSinceTouch != null && ctx.daysSinceTouch > 5) return true;
  if (ctx.dealStage && ctx.dealStage !== '') return true;
  if (ctx.blockType && ACTIONABLE_BLOCKS.has(ctx.blockType)) return true;
  if (ctx.opportunityId) return true;
  return false;
}

export function selectPlaybook(
  playbooks: Playbook[],
  ctx: WorkflowContext
): PlaybookRecommendation | null {
  if (!playbooks.length) return null;

  // Suppression: no recommendation without actionable signal
  if (!hasActionableSignal(ctx)) return null;

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

  const confidence = Math.round(bestScore * 100);

  // Confidence gating: suppress weak recommendations
  if (confidence < CONFIDENCE_THRESHOLD) return null;

  return {
    playbook: best,
    reason: buildReason(best, ctx),
    confidence,
    cta: pickCta(ctx),
  };
}

/**
 * Hook: returns ONE playbook recommendation for the given workflow context.
 * Includes stickiness: won't flip unless a new recommendation is significantly stronger.
 */
export function usePlaybookRecommendation(ctx: WorkflowContext): PlaybookRecommendation | null {
  const { data: playbooks = [] } = usePlaybooks();
  const lastRecRef = useRef<PlaybookRecommendation | null>(null);

  const result = useMemo(() => {
    if (!playbooks.length) return null;

    const candidate = selectPlaybook(playbooks, ctx);
    const prev = lastRecRef.current;

    // Stickiness: keep previous recommendation unless new one is meaningfully better
    if (prev && candidate) {
      const isSamePlaybook = prev.playbook.id === candidate.playbook.id;
      if (!isSamePlaybook && candidate.confidence - prev.confidence < STICKINESS_MARGIN) {
        // New recommendation isn't strong enough to unseat current — keep current
        return prev;
      }
    }

    return candidate;
  }, [playbooks, ctx.blockType, ctx.accountId, ctx.opportunityId, ctx.dealStage, ctx.dealStatus, ctx.daysSinceTouch]);

  // Update sticky ref after render
  lastRecRef.current = result;

  return result;
}

/**
 * Hook for opportunity detail page: auto-builds context from opp data.
 * Suppressed for closed deals.
 */
export function useOppPlaybookRecommendation(oppId?: string) {
  const { opportunities } = useStore();
  const opp = opportunities.find(o => o.id === oppId);

  const ctx = useMemo<WorkflowContext>(() => {
    if (!opp) return {};
    // Suppress for closed deals — no recommendation needed
    if (opp.status === 'closed-won' || opp.status === 'closed-lost') return {};
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
