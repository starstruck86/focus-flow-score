/**
 * V6 Multi-Thread Injection Selector
 *
 * Decides whether to attach multi-thread stakeholder complexity
 * to a given scenario. Purely deterministic — no AI calls.
 *
 * Frequency targets by stage:
 *   Foundation: 5–10%
 *   Integration: 15–25%
 *   Enterprise: 25–40%
 *   Friday: highest density
 */

import type { BlockStage, BlockPhase } from '../v3/blockManager';
import type { DayAnchor } from '../v3/dayAnchors';
import type { MultiThreadContext, StakeholderSignal } from './multiThreadTypes';

// ── Input ─────────────────────────────────────────────────────────

export interface MultiThreadInput {
  blockStage: BlockStage;
  blockPhase: BlockPhase;
  dayAnchor: DayAnchor;
  recentAvg: number;
  recentMultiThreadCount: number; // multi-thread reps in last 7 days
  isBenchmarkOrRetest: boolean;
}

// ── Decision ──────────────────────────────────────────────────────

export function shouldInjectMultiThread(input: MultiThreadInput): boolean {
  const { blockStage, blockPhase, dayAnchor, recentAvg, recentMultiThreadCount, isBenchmarkOrRetest } = input;

  // Never on benchmark/retest
  if (isBenchmarkOrRetest) return false;

  // Never if scores too low (need foundational proficiency first)
  if (recentAvg < 55) return false;

  // Cap: max 3 multi-thread reps per week to avoid overload
  if (recentMultiThreadCount >= 3) return false;

  // Stage-based probability thresholds
  const anchorWeight = getAnchorWeight(dayAnchor);
  const stageThreshold = getStageThreshold(blockStage, blockPhase);

  // Deterministic: use anchor weight * stage threshold
  // A rep gets multi-thread if the product exceeds 0.5
  const score = anchorWeight * stageThreshold;
  return score >= 0.5;
}

// ── Anchor weights (how natural is multi-thread for this day) ────

function getAnchorWeight(anchor: DayAnchor): number {
  switch (anchor) {
    case 'opening_cold_call':         return 0.15;  // rare
    case 'discovery_qualification':   return 0.55;  // common
    case 'objection_pricing':         return 0.55;  // common
    case 'deal_control_negotiation':  return 0.75;  // very common
    case 'executive_roi_mixed':       return 0.90;  // most common
    default: return 0.3;
  }
}

// ── Stage thresholds ─────────────────────────────────────────────

function getStageThreshold(stage: BlockStage, phase: BlockPhase): number {
  // Foundation stage: very selective (5-10%)
  if (stage === 'foundation') {
    if (phase === 'peak') return 0.6;   // allow on peak
    return 0.3;                          // very rare otherwise
  }

  // Integration stage: moderate (15-25%)
  if (stage === 'integration') {
    if (phase === 'peak') return 0.85;
    if (phase === 'build') return 0.7;
    return 0.55;
  }

  // Enterprise stage: common (25-40%)
  if (phase === 'peak') return 1.0;
  if (phase === 'build') return 0.85;
  return 0.7;
}

// ── Stakeholder Context Generation ───────────────────────────────

/** Generate appropriate multi-thread context for a given anchor */
export function generateMultiThreadContext(
  dayAnchor: DayAnchor,
): MultiThreadContext {
  const templates = ANCHOR_TEMPLATES[dayAnchor] ?? ANCHOR_TEMPLATES.deal_control_negotiation;
  // Pick template based on simple rotation
  const template = templates[Math.floor(Math.random() * templates.length)];
  return {
    active: true,
    ...template,
  };
}

// ── Stakeholder Templates by Anchor ──────────────────────────────

interface ContextTemplate {
  stakeholders: StakeholderSignal[];
  tensionType: MultiThreadContext['tensionType'];
}

const ANCHOR_TEMPLATES: Record<DayAnchor, ContextTemplate[]> = {
  opening_cold_call: [
    {
      tensionType: 'status_quo_defense',
      stakeholders: [
        { id: 'sh-1', role: 'end_user', stance: 'neutral', priority: 'speed', influenceLevel: 'low', perspective: 'Current tool works fine for my daily tasks.' },
        { id: 'sh-2', role: 'manager', stance: 'skeptical', priority: 'stability', influenceLevel: 'medium', perspective: 'We just finished onboarding our current solution.' },
      ],
    },
  ],
  discovery_qualification: [
    {
      tensionType: 'competing_priorities',
      stakeholders: [
        { id: 'sh-1', role: 'marketing', stance: 'supportive', priority: 'growth', influenceLevel: 'high', perspective: 'We need better segmentation to hit revenue targets.' },
        { id: 'sh-2', role: 'ops', stance: 'skeptical', priority: 'efficiency', influenceLevel: 'medium', perspective: 'Another tool means another integration to maintain.' },
      ],
    },
    {
      tensionType: 'internal_misalignment',
      stakeholders: [
        { id: 'sh-1', role: 'lifecycle', stance: 'supportive', priority: 'growth', influenceLevel: 'medium', perspective: 'Churn is our biggest problem and we need new tooling.' },
        { id: 'sh-2', role: 'analytics', stance: 'neutral', priority: 'efficiency', influenceLevel: 'low', perspective: 'We can probably solve this with better dashboards.' },
        { id: 'sh-3', role: 'vp_marketing', stance: 'neutral', priority: 'risk', influenceLevel: 'high', perspective: 'I need to see clear ROI before committing budget.' },
      ],
    },
  ],
  objection_pricing: [
    {
      tensionType: 'build_vs_buy',
      stakeholders: [
        { id: 'sh-1', role: 'marketing', stance: 'supportive', priority: 'growth', influenceLevel: 'medium', perspective: 'We need this capability now, not in 6 months.' },
        { id: 'sh-2', role: 'engineering', stance: 'status_quo_champion', priority: 'stability', influenceLevel: 'high', perspective: 'We can build 80% of this in-house for less.' },
      ],
    },
    {
      tensionType: 'competing_priorities',
      stakeholders: [
        { id: 'sh-1', role: 'lifecycle', stance: 'supportive', priority: 'growth', influenceLevel: 'medium', perspective: 'The current tool is limiting our retention programs.' },
        { id: 'sh-2', role: 'finance', stance: 'skeptical', priority: 'risk', influenceLevel: 'high', perspective: 'The price difference needs to be justified in hard numbers.' },
      ],
    },
  ],
  deal_control_negotiation: [
    {
      tensionType: 'internal_misalignment',
      stakeholders: [
        { id: 'sh-1', role: 'champion', stance: 'supportive', priority: 'growth', influenceLevel: 'medium', perspective: 'I believe in this solution but I need help getting buy-in.' },
        { id: 'sh-2', role: 'procurement', stance: 'neutral', priority: 'efficiency', influenceLevel: 'medium', perspective: 'We need to evaluate at least two alternatives.' },
        { id: 'sh-3', role: 'vp_ops', stance: 'skeptical', priority: 'stability', influenceLevel: 'high', perspective: 'Last platform migration cost us 3 months of productivity.' },
      ],
    },
    {
      tensionType: 'status_quo_defense',
      stakeholders: [
        { id: 'sh-1', role: 'director_crm', stance: 'supportive', priority: 'growth', influenceLevel: 'high', perspective: 'We need to move now — renewal is in 60 days.' },
        { id: 'sh-2', role: 'team_lead', stance: 'status_quo_champion', priority: 'stability', influenceLevel: 'medium', perspective: 'My team built all their workflows in the current tool.' },
      ],
    },
  ],
  executive_roi_mixed: [
    {
      tensionType: 'competing_priorities',
      stakeholders: [
        { id: 'sh-1', role: 'cmo', stance: 'supportive', priority: 'growth', influenceLevel: 'high', perspective: 'Revenue growth is the board mandate. I need tools that move the needle.' },
        { id: 'sh-2', role: 'cto', stance: 'skeptical', priority: 'stability', influenceLevel: 'high', perspective: 'We have 14 tools in the stack already. Every new one adds risk.' },
        { id: 'sh-3', role: 'cfo', stance: 'neutral', priority: 'risk', influenceLevel: 'high', perspective: 'Show me the payback period. If it is under 9 months, we can talk.' },
      ],
    },
    {
      tensionType: 'internal_misalignment',
      stakeholders: [
        { id: 'sh-1', role: 'vp_marketing', stance: 'supportive', priority: 'growth', influenceLevel: 'high', perspective: 'We are leaving money on the table every quarter without this.' },
        { id: 'sh-2', role: 'director_it', stance: 'status_quo_champion', priority: 'stability', influenceLevel: 'medium', perspective: 'Integration complexity is being underestimated.' },
        { id: 'sh-3', role: 'head_of_analytics', stance: 'neutral', priority: 'efficiency', influenceLevel: 'medium', perspective: 'We need unified data before adding more sources.' },
      ],
    },
  ],
};
