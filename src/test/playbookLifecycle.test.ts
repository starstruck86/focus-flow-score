/**
 * Playbook Lifecycle Canary / Regression Tests
 */
import { describe, it, expect } from 'vitest';
import {
  isValidPlaybookTransition,
  scorePlaybookTrust,
  classifyPlaybookTrust,
  isPlaybookEligible,
  getPlaybookEligibility,
  clusterResources,
  detectRegenerationNeeds,
  detectDecompositionNeeds,
  computeUsefulnessScore,
  isClusterReadyForPlaybook,
  computeSnapshotHash,
  computePlaybookOutcomeScore,
  blendOutcomeIntoTrust,
  determineOutcomeTrustAction,
  scorePlaybookContextFit,
  detectPlaybookFatigue,
  computeFatigueDiscount,
  rankPlaybooksForContext,
  type PlaybookModel,
  type PlaybookTrustScore,
  type ResourceCluster,
  type PlaybookOutcomeEvent,
  type DealContext,
} from '@/lib/playbookLifecycle';

// ── Helpers ────────────────────────────────────────────────
function makeTrustScore(overall: number): PlaybookTrustScore {
  return { overall, evidenceStrength: overall / 4, evidenceDiversity: overall / 4, usageSuccess: overall / 4, stability: overall / 4 };
}

function makePlaybook(overrides: Partial<PlaybookModel> = {}): PlaybookModel {
  return {
    id: 'pb-1',
    title: 'Test Playbook',
    problem_type: 'create urgency',
    trigger_conditions: '',
    use_cases: [],
    target_personas: ['VP Sales'],
    applicable_stages: ['Discovery'],
    talk_tracks: ['Track 1'],
    questions: ['Q1'],
    objection_handles: [],
    pressure_tactics: ['P1'],
    minimum_effective_version: 'Just do it',
    success_criteria: 'Works',
    failure_consequences: [],
    common_mistakes: [],
    what_great_looks_like: [],
    anti_patterns: [],
    confidence_score: 80,
    trust_status: 'trusted',
    trust_score: makeTrustScore(75),
    status: 'active',
    version: 1,
    usage_count: 5,
    acceptance_rate: 60,
    derived_from_resource_ids: ['r1', 'r2', 'r3'],
    derived_from_cluster_id: null,
    last_generated_at: new Date().toISOString(),
    last_reconciled_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── State Transitions ──────────────────────────────────────
describe('Playbook State Transitions', () => {
  it('allows candidate → draft_generated', () => {
    expect(isValidPlaybookTransition('candidate', 'draft_generated')).toBe(true);
  });
  it('allows active → stale', () => {
    expect(isValidPlaybookTransition('active', 'stale')).toBe(true);
  });
  it('blocks draft_generated → candidate', () => {
    expect(isValidPlaybookTransition('draft_generated', 'candidate')).toBe(false);
  });
  it('allows retired → candidate (revival)', () => {
    expect(isValidPlaybookTransition('retired', 'candidate')).toBe(true);
  });
  it('blocks active → candidate', () => {
    expect(isValidPlaybookTransition('active', 'candidate')).toBe(false);
  });
});

// ── Trust Scoring ──────────────────────────────────────────
describe('Playbook Trust Scoring', () => {
  it('returns higher score for many trusted resources', () => {
    const strong = scorePlaybookTrust(
      [{ trustScore: 90, trustStatus: 'trusted' }, { trustScore: 85, trustStatus: 'trusted' }, { trustScore: 80, trustStatus: 'trusted' }],
      { usageCount: 10, acceptanceRate: 70, roleplaysCompleted: 3 },
      0, 0, new Date().toISOString(),
    );
    const weak = scorePlaybookTrust(
      [{ trustScore: 30, trustStatus: 'suspect' }],
      { usageCount: 0, acceptanceRate: 0, roleplaysCompleted: 0 },
      2, 0, null,
    );
    expect(strong.overall).toBeGreaterThan(weak.overall);
  });

  it('classifies trusted with enough resources and score', () => {
    const score = makeTrustScore(75);
    expect(classifyPlaybookTrust(score, 3, 'active')).toBe('trusted');
  });

  it('classifies experimental with low score', () => {
    const score = makeTrustScore(25);
    expect(classifyPlaybookTrust(score, 1, 'active')).toBe('experimental');
  });

  it('classifies retired for retired status', () => {
    expect(classifyPlaybookTrust(makeTrustScore(90), 5, 'retired')).toBe('retired');
  });
});

// ── Eligibility Gating ─────────────────────────────────────
describe('Playbook Eligibility', () => {
  it('allows trusted+active for dave_suggestion', () => {
    expect(isPlaybookEligible(
      { trust_status: 'trusted', status: 'active', trust_score: makeTrustScore(70) },
      'dave_suggestion'
    )).toBe(true);
  });

  it('blocks experimental from dave_grounding', () => {
    expect(isPlaybookEligible(
      { trust_status: 'experimental', status: 'active', trust_score: makeTrustScore(30) },
      'dave_grounding'
    )).toBe(false);
  });

  it('allows experimental for library_display', () => {
    expect(isPlaybookEligible(
      { trust_status: 'experimental', status: 'draft_generated', trust_score: makeTrustScore(10) },
      'library_display'
    )).toBe(true);
  });

  it('blocks stale from strategic_recommendations', () => {
    expect(isPlaybookEligible(
      { trust_status: 'stale', status: 'stale', trust_score: makeTrustScore(40) },
      'strategic_recommendations'
    )).toBe(false);
  });

  it('getPlaybookEligibility returns all purposes', () => {
    const result = getPlaybookEligibility({ trust_status: 'trusted', status: 'active', trust_score: makeTrustScore(80) });
    expect(Object.keys(result)).toHaveLength(8);
    expect(result.library_display).toBe(true);
    expect(result.dave_grounding).toBe(true);
  });
});

// ── Clustering ─────────────────────────────────────────────
describe('Resource Clustering', () => {
  it('clusters resources by keyword themes', () => {
    const resources = [
      { id: 'r1', tags: ['urgency', 'deadline'], use_cases: ['create urgency in stalled deals'], summary: 'compelling event training', trust_status: 'trusted' as const, trust_score: 80 },
      { id: 'r2', tags: ['fomo', 'time-sensitive'], use_cases: ['cost of delay framework'], summary: 'urgency creation', trust_status: 'trusted' as const, trust_score: 75 },
    ];
    const clusters = clusterResources(resources);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    expect(clusters[0].theme).toBe('create_urgency');
  });

  it('excludes suspect resources from clusters', () => {
    const resources = [
      { id: 'r1', tags: ['urgency', 'deadline'], use_cases: ['create urgency'], summary: 'compelling event', trust_status: 'suspect' as const, trust_score: 20 },
    ];
    const clusters = clusterResources(resources);
    const urgencyCluster = clusters.find(c => c.theme === 'create_urgency');
    expect(urgencyCluster).toBeUndefined();
  });
});

// ── Regeneration Detection ─────────────────────────────────
describe('Regeneration Triggers', () => {
  it('triggers on stale trust with active status', () => {
    const pb = makePlaybook({ trust_status: 'stale', status: 'active' });
    const trigger = detectRegenerationNeeds(pb, null, { usageCount: 0, acceptanceRate: 0 });
    expect(trigger).not.toBeNull();
    expect(trigger!.priority).toBe('high');
  });

  it('triggers on low acceptance rate', () => {
    const pb = makePlaybook();
    const trigger = detectRegenerationNeeds(pb, null, { usageCount: 10, acceptanceRate: 10 });
    expect(trigger).not.toBeNull();
    expect(trigger!.reason).toContain('acceptance');
  });

  it('returns null for healthy playbook', () => {
    const pb = makePlaybook();
    const trigger = detectRegenerationNeeds(pb, null, { usageCount: 5, acceptanceRate: 60 });
    expect(trigger).toBeNull();
  });
});

// ── Decomposition ──────────────────────────────────────────
describe('Decomposition Detection', () => {
  it('detects merge candidates with same problem_type', () => {
    const pbs = [
      makePlaybook({ id: 'pb-1', problem_type: 'create urgency' }),
      makePlaybook({ id: 'pb-2', problem_type: 'create urgency' }),
    ];
    const decomps = detectDecompositionNeeds(pbs);
    const merges = decomps.filter(d => d.type === 'merge');
    expect(merges.length).toBeGreaterThanOrEqual(1);
  });

  it('detects split candidates for overly broad playbooks', () => {
    const pbs = [
      makePlaybook({
        id: 'pb-1',
        applicable_stages: ['Prospecting', 'Discovery', 'Demo', 'Negotiation', 'Closing'],
        target_personas: ['VP', 'Dir', 'Manager', 'IC'],
      }),
    ];
    const decomps = detectDecompositionNeeds(pbs);
    const splits = decomps.filter(d => d.type === 'split');
    expect(splits.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Usefulness ─────────────────────────────────────────────
describe('Usefulness Scoring', () => {
  it('scores highly used playbook higher', () => {
    const high = computeUsefulnessScore({ shownCount: 20, acceptedCount: 15, ignoredCount: 5, usedInDave: 5, usedInRoleplay: 3, usedInPrep: 2, positiveFeedback: 4, negativeFeedback: 1 });
    const low = computeUsefulnessScore({ shownCount: 20, acceptedCount: 2, ignoredCount: 18, usedInDave: 0, usedInRoleplay: 0, usedInPrep: 0, positiveFeedback: 0, negativeFeedback: 3 });
    expect(high).toBeGreaterThan(low);
  });

  it('returns neutral for unshown playbook', () => {
    expect(computeUsefulnessScore({ shownCount: 0, acceptedCount: 0, ignoredCount: 0, usedInDave: 0, usedInRoleplay: 0, usedInPrep: 0, positiveFeedback: 0, negativeFeedback: 0 })).toBe(50);
  });
});

// ── Cluster Readiness ──────────────────────────────────────
describe('Cluster Readiness', () => {
  it('requires minimum resources', () => {
    const cluster: ResourceCluster = {
      id: 'c1', theme: 'urgency', problem_type: 'urgency',
      resource_ids: ['r1'], resource_weights: { r1: 0.8 },
      stage_relevance: [], persona_relevance: [],
      support_strength: 40, coherence_score: 70, last_updated: '',
    };
    expect(isClusterReadyForPlaybook(cluster, [])).toBe(false);
  });

  it('passes with sufficient support', () => {
    const cluster: ResourceCluster = {
      id: 'c1', theme: 'urgency', problem_type: 'urgency',
      resource_ids: ['r1', 'r2'], resource_weights: { r1: 0.8, r2: 0.7 },
      stage_relevance: [], persona_relevance: [],
      support_strength: 50, coherence_score: 70, last_updated: '',
    };
    expect(isClusterReadyForPlaybook(cluster, [])).toBe(true);
  });
});

// ── Snapshot Hash ──────────────────────────────────────────
describe('Snapshot Hash', () => {
  it('produces same hash for same content', () => {
    const a = computeSnapshotHash({ problem_type: 'urgency', talk_tracks: ['a'], questions: ['b'], pressure_tactics: ['c'] });
    const b = computeSnapshotHash({ problem_type: 'urgency', talk_tracks: ['a'], questions: ['b'], pressure_tactics: ['c'] });
    expect(a).toBe(b);
  });

  it('produces different hash for different content', () => {
    const a = computeSnapshotHash({ problem_type: 'urgency', talk_tracks: ['a'], questions: ['b'], pressure_tactics: ['c'] });
    const b = computeSnapshotHash({ problem_type: 'pricing', talk_tracks: ['x'], questions: ['y'], pressure_tactics: ['z'] });
    expect(a).not.toBe(b);
  });
});

// ══════════════════════════════════════════════════════════════
// Outcome-Driven Learning Tests
// ══════════════════════════════════════════════════════════════

describe('Playbook Outcome Scoring', () => {
  it('returns zero for empty events', () => {
    const score = computePlaybookOutcomeScore([]);
    expect(score.overall).toBe(0);
    expect(score.confidence).toBe('insufficient');
  });

  it('scores stage progression events', () => {
    const events: PlaybookOutcomeEvent[] = Array.from({ length: 5 }, (_, i) => ({
      playbookId: 'pb-1',
      eventType: 'stage_progressed',
      timestamp: new Date(Date.now() - i * 86400000).toISOString(),
    }));
    const score = computePlaybookOutcomeScore(events);
    expect(score.stageProgression).toBeGreaterThan(0);
    expect(score.confidence).toBe('moderate');
  });

  it('recent events weigh more than old', () => {
    const recent: PlaybookOutcomeEvent[] = [{ playbookId: 'pb-1', eventType: 'deal_won', timestamp: new Date().toISOString() }];
    const old: PlaybookOutcomeEvent[] = [{ playbookId: 'pb-1', eventType: 'deal_won', timestamp: new Date(Date.now() - 120 * 86400000).toISOString() }];
    const recentScore = computePlaybookOutcomeScore(recent);
    const oldScore = computePlaybookOutcomeScore(old);
    expect(recentScore.winCorrelation).toBeGreaterThan(oldScore.winCorrelation);
  });

  it('high confidence requires 10+ events', () => {
    const events: PlaybookOutcomeEvent[] = Array.from({ length: 12 }, (_, i) => ({
      playbookId: 'pb-1',
      eventType: 'meeting_converted',
      timestamp: new Date(Date.now() - i * 86400000).toISOString(),
    }));
    expect(computePlaybookOutcomeScore(events).confidence).toBe('high');
  });
});

describe('Outcome-Weighted Trust Blending', () => {
  it('boosts trust for high-outcome playbooks', () => {
    const base = makeTrustScore(60);
    const outcome = computePlaybookOutcomeScore(
      Array.from({ length: 10 }, (_, i) => ({
        playbookId: 'pb-1', eventType: 'stage_progressed' as const,
        timestamp: new Date(Date.now() - i * 86400000).toISOString(),
      }))
    );
    const blended = blendOutcomeIntoTrust(base, outcome);
    expect(blended.overall).toBeGreaterThanOrEqual(base.overall);
  });

  it('does not change trust for insufficient data', () => {
    const base = makeTrustScore(60);
    const outcome = computePlaybookOutcomeScore([]);
    const blended = blendOutcomeIntoTrust(base, outcome);
    expect(blended.overall).toBe(base.overall);
  });
});

describe('Outcome Trust Actions', () => {
  it('promotes high-outcome playbooks', () => {
    const outcome = { overall: 70, stageProgression: 15, stagnationReduction: 10, meetingConversion: 15, replyRate: 10, nextStepAdherence: 8, winCorrelation: 8, sampleSize: 10, confidence: 'high' as const };
    expect(determineOutcomeTrustAction(outcome, 'limited')).toBe('promote');
  });

  it('monitors insufficient data', () => {
    const outcome = { overall: 0, stageProgression: 0, stagnationReduction: 0, meetingConversion: 0, replyRate: 0, nextStepAdherence: 0, winCorrelation: 0, sampleSize: 0, confidence: 'insufficient' as const };
    expect(determineOutcomeTrustAction(outcome, 'trusted')).toBe('monitor');
  });

  it('downgrades low-outcome playbooks', () => {
    const outcome = { overall: 10, stageProgression: 5, stagnationReduction: 0, meetingConversion: 5, replyRate: 0, nextStepAdherence: 0, winCorrelation: 0, sampleSize: 8, confidence: 'high' as const };
    expect(determineOutcomeTrustAction(outcome, 'trusted')).toBe('downgrade');
  });

  it('suggests split for zero-progression low-outcome', () => {
    const outcome = { overall: 10, stageProgression: 0, stagnationReduction: 5, meetingConversion: 0, replyRate: 5, nextStepAdherence: 0, winCorrelation: 0, sampleSize: 6, confidence: 'moderate' as const };
    expect(determineOutcomeTrustAction(outcome, 'trusted')).toBe('split_review');
  });
});

describe('Context-Aware Playbook Matching', () => {
  const context: DealContext = {
    dealSize: 'large',
    stage: 'Discovery',
    persona: 'VP Sales',
    urgency: 'high',
    competitionPresent: true,
    stakeholderCount: 4,
    productComplexity: 'complex',
  };

  it('gives context bonus for stage affinity', () => {
    const pb = makePlaybook({ derived_from_cluster_id: 'cluster_discovery_depth' });
    const fit = scorePlaybookContextFit(pb, context, null, 0);
    expect(fit.contextBonus).toBeGreaterThan(0);
    expect(fit.contextReasons.some(r => r.includes('stage'))).toBe(true);
  });

  it('gives persona match bonus', () => {
    const pb = makePlaybook({ target_personas: ['VP Sales'] });
    const fit = scorePlaybookContextFit(pb, context, null, 0);
    expect(fit.contextReasons.some(r => r.includes('Persona'))).toBe(true);
  });

  it('applies fatigue discount', () => {
    const pb = makePlaybook();
    const fresh = scorePlaybookContextFit(pb, context, null, 0);
    const fatigued = scorePlaybookContextFit(pb, context, null, 5);
    expect(fatigued.finalScore).toBeLessThan(fresh.finalScore);
    expect(fatigued.fatigueDiscount).toBeGreaterThan(0);
  });
});

describe('Fatigue Detection', () => {
  it('detects same-deal fatigue at threshold', () => {
    const usages = Array.from({ length: 4 }, () => ({ dealId: 'deal-1', timestamp: new Date().toISOString() }));
    const signals = detectPlaybookFatigue('pb-1', usages);
    const dealSignal = signals.find(s => s.dealId === 'deal-1');
    expect(dealSignal?.isFatigued).toBe(true);
    expect(dealSignal?.suggestion).toContain('different approach');
  });

  it('does not flag low usage', () => {
    const usages = [{ dealId: 'deal-1', timestamp: new Date().toISOString() }];
    const signals = detectPlaybookFatigue('pb-1', usages);
    expect(signals.every(s => !s.isFatigued)).toBe(true);
  });

  it('detects global fatigue', () => {
    const usages = Array.from({ length: 12 }, (_, i) => ({ dealId: `deal-${i}`, timestamp: new Date().toISOString() }));
    const signals = detectPlaybookFatigue('pb-1', usages);
    const global = signals.find(s => s.dealId === '__global__');
    expect(global?.isFatigued).toBe(true);
  });

  it('fatigue discount scales with usage', () => {
    expect(computeFatigueDiscount(0)).toBe(0);
    expect(computeFatigueDiscount(1)).toBe(0);
    expect(computeFatigueDiscount(3)).toBe(10);
    expect(computeFatigueDiscount(6)).toBeGreaterThan(20);
  });
});

describe('Playbook Ranking for Context', () => {
  it('ranks eligible playbooks by final score', () => {
    const pbs = [
      makePlaybook({ id: 'pb-1', trust_score: makeTrustScore(80), derived_from_cluster_id: 'cluster_discovery_depth' }),
      makePlaybook({ id: 'pb-2', trust_score: makeTrustScore(50), derived_from_cluster_id: 'cluster_pricing_pushback' }),
    ];
    const context: DealContext = { dealSize: 'medium', stage: 'Discovery', persona: 'Manager', urgency: 'medium', competitionPresent: false, stakeholderCount: 1, productComplexity: 'simple' };
    const ranked = rankPlaybooksForContext(pbs, context, new Map(), new Map(), 'dave_suggestion');
    expect(ranked.length).toBe(2);
    expect(ranked[0].playbookId).toBe('pb-1');
    expect(ranked[0].finalScore).toBeGreaterThan(ranked[1].finalScore);
  });

  it('filters out ineligible playbooks', () => {
    const pbs = [
      makePlaybook({ id: 'pb-1', trust_status: 'quarantined', status: 'quarantined' }),
    ];
    const context: DealContext = { dealSize: 'small', stage: 'Prospecting', persona: 'IC', urgency: 'low', competitionPresent: false, stakeholderCount: 1, productComplexity: 'simple' };
    const ranked = rankPlaybooksForContext(pbs, context, new Map(), new Map(), 'dave_suggestion');
    expect(ranked.length).toBe(0);
  });
});
