/**
 * Capability Awareness Engine
 *
 * Surfaces exactly one high-signal capability prompt during Prep,
 * tied to the current deal/playbook context. Uses staged intelligence:
 * best_practice → emerging_pattern → data_confirmed.
 *
 * Feature-flagged via ENABLE_CAPABILITY_AWARENESS.
 */

import { isCapabilityAwarenessEnabled } from './featureFlags';
import { shouldSuppressIntervention, recordIntervention } from './interventionGuard';
import { getLedgerMetrics } from './recommendationLedger';
import { getFrictionSummary } from './frictionSignals';
import { computePersonalProfile, type PersonalProfile } from './systemIntelligence';
import { getCapabilityEventHistory } from './capabilityEvents';

// ── Types ──────────────────────────────────────────────────

export type CapabilityTier = 'best_practice' | 'emerging_pattern' | 'data_confirmed';

export interface CapabilityPrompt {
  id: string;
  type: CapabilityTier;
  message: string;
  skillFocus: string;
  confidence: number;
  ctaType: 'practice' | 'apply' | null;
  whyNow: string;
  suppressionKey: string;
}

export interface CapabilityContext {
  dealStage?: string;
  dealName?: string;
  dealRisk?: 'low' | 'medium' | 'high';
  accountName?: string;
  recommendedPlaybookTitle?: string;
  recommendedPlaybookType?: string;
  hasRoleplayedRecently?: boolean;
}

// ── Suppression ────────────────────────────────────────────

const SUPPRESSION_KEY = 'capability-prompt-history';
const MAX_IGNORES_BEFORE_SUPPRESS = 3;

function getRecentSuppressions(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SUPPRESSION_KEY) || '{}'); } catch { return {}; }
}

function isPromptSuppressed(key: string): boolean {
  const history = getCapabilityEventHistory(14 * 24 * 3600 * 1000);
  const ignored = history.filter(e => e.promptId === key && e.eventType === 'ignored').length;
  return ignored >= MAX_IGNORES_BEFORE_SUPPRESS;
}

// ── Data Maturity ──────────────────────────────────────────

interface DataMaturity {
  tier: CapabilityTier;
  profileRecords: number;
  ledgerEntries: number;
}

function assessMaturity(profile: PersonalProfile): DataMaturity {
  const ledger = getLedgerMetrics();
  const records = profile.totalRecords;
  const entries = ledger.totalEntries;

  if (records >= 15 && entries >= 10) {
    return { tier: 'data_confirmed', profileRecords: records, ledgerEntries: entries };
  }
  if (records >= 5 || entries >= 5) {
    return { tier: 'emerging_pattern', profileRecords: records, ledgerEntries: entries };
  }
  return { tier: 'best_practice', profileRecords: records, ledgerEntries: entries };
}

// ── Prompt Generation ──────────────────────────────────────

function generateBestPracticePrompt(ctx: CapabilityContext): CapabilityPrompt | null {
  const prompts: CapabilityPrompt[] = [];

  if (ctx.dealStage && ['proposal', 'negotiation', 'contract'].includes(ctx.dealStage.toLowerCase())) {
    prompts.push({
      id: `bp-stakeholder-${ctx.dealStage}`,
      type: 'best_practice',
      message: 'Strong reps typically validate stakeholder alignment before a proposal call.',
      skillFocus: 'stakeholder mapping',
      confidence: 55,
      ctaType: 'practice',
      whyNow: `You're at ${ctx.dealStage} stage — alignment gaps surface here.`,
      suppressionKey: `bp-stakeholder-${ctx.dealStage}`,
    });
  }

  if (ctx.recommendedPlaybookTitle && ctx.dealStage) {
    prompts.push({
      id: `bp-playbook-prep-${ctx.recommendedPlaybookType || 'general'}`,
      type: 'best_practice',
      message: `At this stage, it often helps to practice the key questions from "${ctx.recommendedPlaybookTitle}" before the call.`,
      skillFocus: 'call preparation',
      confidence: 50,
      ctaType: 'practice',
      whyNow: 'Playbook practice before calls improves discovery quality.',
      suppressionKey: `bp-playbook-prep-${ctx.recommendedPlaybookType || 'general'}`,
    });
  }

  if (ctx.dealRisk === 'high') {
    prompts.push({
      id: `bp-risk-prep-${ctx.dealStage || 'unknown'}`,
      type: 'best_practice',
      message: 'High-risk deals benefit from objection rehearsal before the next touch.',
      skillFocus: 'objection handling',
      confidence: 60,
      ctaType: 'practice',
      whyNow: `This deal is flagged high-risk — preparation reduces surprise.`,
      suppressionKey: `bp-risk-objection`,
    });
  }

  // Return highest confidence prompt
  return prompts.sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

function generateEmergingPatternPrompt(ctx: CapabilityContext, profile: PersonalProfile): CapabilityPrompt | null {
  const prompts: CapabilityPrompt[] = [];

  // Check if user hasn't roleplayed recently for late-stage deals
  if (!ctx.hasRoleplayedRecently && ctx.dealStage &&
      ['proposal', 'negotiation', 'contract', 'closing'].includes(ctx.dealStage.toLowerCase())) {
    prompts.push({
      id: `ep-roleplay-${ctx.dealStage}`,
      type: 'emerging_pattern',
      message: `You haven't used roleplay in recent late-stage deals like this.`,
      skillFocus: 'roleplay practice',
      confidence: 65,
      ctaType: 'practice',
      whyNow: 'Practicing objection scenarios before late-stage calls improves outcomes.',
      suppressionKey: `ep-roleplay-latestage`,
    });
  }

  // Check for weak conversion signals at current stage
  const stageSignal = profile.conversionSignals.find(s => s.signal === ctx.dealStage);
  if (stageSignal && stageSignal.strength < 0.4) {
    prompts.push({
      id: `ep-weak-stage-${ctx.dealStage}`,
      type: 'emerging_pattern',
      message: `Your conversion rate at ${ctx.dealStage} stage has been below average in recent deals.`,
      skillFocus: `${ctx.dealStage} execution`,
      confidence: 60,
      ctaType: 'practice',
      whyNow: `Focused practice on ${ctx.dealStage} scenarios could improve conversion.`,
      suppressionKey: `ep-weak-stage-${ctx.dealStage}`,
    });
  }

  // Recommend best playbook from personal data
  if (profile.topPlaybooks.length > 0 && ctx.recommendedPlaybookTitle) {
    const ledger = getLedgerMetrics();
    if (ledger.ignoredHighConfidenceRate > 0.3) {
      prompts.push({
        id: `ep-ignored-recs`,
        type: 'emerging_pattern',
        message: `You've been skipping high-confidence recommendations. The system learns better when you try them.`,
        skillFocus: 'recommendation engagement',
        confidence: 55,
        ctaType: 'apply',
        whyNow: 'Engaging with recommendations helps the system personalize for you.',
        suppressionKey: `ep-ignored-recs`,
      });
    }
  }

  return prompts.sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

function generateDataConfirmedPrompt(ctx: CapabilityContext, profile: PersonalProfile): CapabilityPrompt | null {
  const prompts: CapabilityPrompt[] = [];
  const ledger = getLedgerMetrics();

  // Roleplay skip pattern with outcome data
  if (!ctx.hasRoleplayedRecently && profile.totalRecords >= 10) {
    const hasRoleplayData = profile.conversionSignals.length > 0;
    if (hasRoleplayData) {
      prompts.push({
        id: `dc-roleplay-skip-${ctx.dealStage || 'any'}`,
        type: 'data_confirmed',
        message: `You skipped roleplay in your last similar deals. Deals where you practiced first advanced faster.`,
        skillFocus: 'roleplay practice',
        confidence: 80,
        ctaType: 'practice',
        whyNow: 'Your own data shows practice correlates with better outcomes.',
        suppressionKey: `dc-roleplay-skip`,
      });
    }
  }

  // Playbook effectiveness signal
  if (ctx.recommendedPlaybookType && profile.playbookWinRates[ctx.recommendedPlaybookType]) {
    const stats = profile.playbookWinRates[ctx.recommendedPlaybookType];
    if (stats.total >= 5 && stats.rate > 0.6) {
      prompts.push({
        id: `dc-playbook-strength-${ctx.recommendedPlaybookType}`,
        type: 'data_confirmed',
        message: `You win ${Math.round(stats.rate * 100)}% of deals using this playbook type. Apply it with confidence.`,
        skillFocus: ctx.recommendedPlaybookType,
        confidence: 85,
        ctaType: 'apply',
        whyNow: `Strong personal track record with ${ctx.recommendedPlaybookType} approach.`,
        suppressionKey: `dc-playbook-${ctx.recommendedPlaybookType}`,
      });
    }
  }

  // Outcome lift from accepted recs
  if (ledger.outcomeLift > 0.15 && ledger.totalEntries >= 15) {
    prompts.push({
      id: `dc-rec-lift`,
      type: 'data_confirmed',
      message: `Deals where you followed system recommendations had ${Math.round(ledger.outcomeLift * 100)}% better outcomes.`,
      skillFocus: 'system engagement',
      confidence: 75,
      ctaType: 'apply',
      whyNow: 'Your outcome data confirms the value of following recommendations.',
      suppressionKey: `dc-rec-lift`,
    });
  }

  return prompts.sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

// ── Main API ───────────────────────────────────────────────

export function getCapabilityPrompt(ctx: CapabilityContext): CapabilityPrompt | null {
  // Feature flag gate
  if (!isCapabilityAwarenessEnabled()) return null;

  // Intervention guard gate
  if (shouldSuppressIntervention('coach_nudge')) return null;

  // Friction overload gate
  const friction = getFrictionSummary();
  if (friction.shouldReduceNudges) return null;

  // Compute maturity
  const profile = computePersonalProfile();
  const maturity = assessMaturity(profile);

  // Generate prompt based on tier
  let prompt: CapabilityPrompt | null = null;

  if (maturity.tier === 'data_confirmed') {
    prompt = generateDataConfirmedPrompt(ctx, profile);
  }
  if (!prompt && (maturity.tier === 'data_confirmed' || maturity.tier === 'emerging_pattern')) {
    prompt = generateEmergingPatternPrompt(ctx, profile);
  }
  if (!prompt) {
    prompt = generateBestPracticePrompt(ctx);
  }

  // Suppression check
  if (prompt && isPromptSuppressed(prompt.suppressionKey)) return null;

  // Low confidence filter
  if (prompt && prompt.confidence < 40) return null;

  // Record intervention if we're going to show it
  if (prompt) {
    recordIntervention('coach_nudge');
  }

  return prompt;
}
