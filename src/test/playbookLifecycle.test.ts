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
  type PlaybookModel,
  type PlaybookTrustScore,
  type ResourceCluster,
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
