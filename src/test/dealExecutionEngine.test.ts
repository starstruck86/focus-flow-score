import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
} as Storage;
vi.stubGlobal('localStorage', localStorageMock);

import {
  computeDealUrgency,
  classifyRisk,
  determineRecommendedAction,
  prioritizeDeals,
  loadDealMemory,
  recordDealEvent,
  clearDealMemory,
  shouldAvoidPlaybook,
  getMemoryAdjustments,
  startSequence,
  advanceSequence,
  getCurrentSequenceStep,
  selectBestSequence,
  analyzeWeightCorrelations,
  applyWeightAdjustments,
  loadLearnedWeights,
  computeEngineStats,
  applyTimeDecay,
  computeVariance,
  countDealDiversity,
  clampWeightChange,
  shouldExploreWithSeed,
  recordExploration,
  loadExplorationLog,
  computeExplorationPerformance,
  assignControlGroupWithSeed,
  recordControlOutcome,
  computeControlComparison,
  computeDecayedMemoryWeight,
  getDecayedPlaybookScore,
  type DealSignals,
  type PrioritizationWeights,
  type ExplorationRecord,
} from '../lib/dealExecutionEngine';

function makeDeal(overrides: Partial<DealSignals> = {}): DealSignals {
  return {
    dealId: 'deal-1',
    dealName: 'Acme Corp',
    arrK: 100,
    stage: 'discovery',
    daysSinceLastTouch: 3,
    daysUntilClose: 30,
    hasNextStep: true,
    churnRisk: null,
    stakeholderCount: 2,
    competitionPresent: false,
    meddiccCoverage: 50,
    isNewLogo: true,
    ...overrides,
  };
}

beforeEach(() => localStorageMock.clear());

describe('Global Prioritization', () => {
  it('computes urgency between 0-100', () => {
    const u = computeDealUrgency(makeDeal());
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThanOrEqual(100);
  });

  it('high ARR + high risk = higher urgency', () => {
    const low = computeDealUrgency(makeDeal({ arrK: 10, churnRisk: null }));
    const high = computeDealUrgency(makeDeal({ arrK: 300, churnRisk: 'high' }));
    expect(high).toBeGreaterThan(low);
  });

  it('stale deals are more urgent', () => {
    const fresh = computeDealUrgency(makeDeal({ daysSinceLastTouch: 1 }));
    const stale = computeDealUrgency(makeDeal({ daysSinceLastTouch: 20 }));
    expect(stale).toBeGreaterThan(fresh);
  });

  it('classifies risk correctly', () => {
    expect(classifyRisk(85)).toBe('critical');
    expect(classifyRisk(65)).toBe('high');
    expect(classifyRisk(40)).toBe('moderate');
    expect(classifyRisk(20)).toBe('low');
  });

  it('prioritizeDeals sorts by urgency desc', () => {
    const deals = [
      makeDeal({ dealId: 'a', arrK: 10, churnRisk: null }),
      makeDeal({ dealId: 'b', arrK: 300, churnRisk: 'high' }),
    ];
    const result = prioritizeDeals(deals);
    expect(result[0].dealId).toBe('b');
  });
});

describe('Recommended Action', () => {
  it('prioritizes close prep for near close dates', () => {
    const memory = loadDealMemory('deal-1');
    const { action } = determineRecommendedAction(makeDeal({ daysUntilClose: 5 }), memory);
    expect(action).toContain('Close preparation');
  });

  it('prioritizes re-engagement for stale deals', () => {
    const memory = loadDealMemory('deal-1');
    const { action } = determineRecommendedAction(makeDeal({ daysSinceLastTouch: 15, daysUntilClose: 60 }), memory);
    expect(action).toContain('Re-engage');
  });

  it('suggests multithreading for single-threaded deals', () => {
    const memory = loadDealMemory('deal-1');
    const { action } = determineRecommendedAction(
      makeDeal({ stakeholderCount: 1, meddiccCoverage: 70, daysUntilClose: 60, daysSinceLastTouch: 3 }),
      memory,
    );
    expect(action).toContain('Multithread');
  });

  it('suggests strategy pivot after multiple failures', () => {
    recordDealEvent('deal-1', { type: 'approach_failed', detail: 'cold email' });
    recordDealEvent('deal-1', { type: 'approach_failed', detail: 'linkedin' });
    const memory = loadDealMemory('deal-1');
    const { action } = determineRecommendedAction(
      makeDeal({ stakeholderCount: 3, meddiccCoverage: 70, daysUntilClose: 60, daysSinceLastTouch: 3 }),
      memory,
    );
    expect(action).toContain('Pivot strategy');
  });
});

describe('Deal Memory', () => {
  it('creates empty memory for new deal', () => {
    const m = loadDealMemory('new-deal');
    expect(m.dealId).toBe('new-deal');
    expect(m.entries).toHaveLength(0);
  });

  it('records and aggregates events', () => {
    recordDealEvent('d1', { type: 'objection_seen', detail: 'price too high' });
    recordDealEvent('d1', { type: 'objection_seen', detail: 'timing bad' });
    recordDealEvent('d1', { type: 'objection_seen', detail: 'price too high' }); // duplicate
    const m = loadDealMemory('d1');
    expect(m.objectionsEncountered).toHaveLength(2);
    expect(m.entries).toHaveLength(3);
  });

  it('tracks stakeholders without duplicates', () => {
    recordDealEvent('d2', { type: 'stakeholder_engaged', detail: '', stakeholder: 'Alice' });
    recordDealEvent('d2', { type: 'stakeholder_engaged', detail: '', stakeholder: 'Alice' });
    recordDealEvent('d2', { type: 'stakeholder_engaged', detail: '', stakeholder: 'Bob' });
    expect(loadDealMemory('d2').stakeholdersEngaged).toEqual(['Alice', 'Bob']);
  });

  it('tracks fatigue signals', () => {
    recordDealEvent('d3', { type: 'fatigue_signal', detail: 'same playbook' });
    recordDealEvent('d3', { type: 'fatigue_signal', detail: 'same playbook' });
    expect(loadDealMemory('d3').fatigueSignals).toBe(2);
  });

  it('clears memory', () => {
    recordDealEvent('d4', { type: 'objection_seen', detail: 'x' });
    clearDealMemory('d4');
    expect(loadDealMemory('d4').entries).toHaveLength(0);
  });

  it('caps entries at 200', () => {
    for (let i = 0; i < 210; i++) {
      recordDealEvent('d5', { type: 'objection_seen', detail: `obj-${i}` });
    }
    expect(loadDealMemory('d5').entries.length).toBeLessThanOrEqual(200);
  });
});

describe('Playbook Avoidance', () => {
  it('avoids playbook after 2 failures on same deal', () => {
    recordDealEvent('d6', { type: 'approach_failed', detail: 'failed', playbookId: 'pb-1' });
    recordDealEvent('d6', { type: 'approach_failed', detail: 'failed again', playbookId: 'pb-1' });
    const { avoid, reason } = shouldAvoidPlaybook('d6', 'pb-1');
    expect(avoid).toBe(true);
    expect(reason).toContain('failed');
  });

  it('does not avoid playbook with only 1 failure', () => {
    recordDealEvent('d7', { type: 'approach_failed', detail: 'failed', playbookId: 'pb-2' });
    expect(shouldAvoidPlaybook('d7', 'pb-2').avoid).toBe(false);
  });

  it('avoids overused playbook in 14 days', () => {
    for (let i = 0; i < 3; i++) {
      recordDealEvent('d8', { type: 'playbook_used', detail: '', playbookId: 'pb-3' });
    }
    expect(shouldAvoidPlaybook('d8', 'pb-3').avoid).toBe(true);
  });
});

describe('Memory Adjustments', () => {
  it('boosts playbooks with more successes than failures', () => {
    recordDealEvent('d9', { type: 'playbook_used', detail: '', playbookId: 'pb-4' });
    recordDealEvent('d9', { type: 'approach_succeeded', detail: 'worked', playbookId: 'pb-4' });
    recordDealEvent('d9', { type: 'approach_succeeded', detail: 'worked again', playbookId: 'pb-4' });
    const adj = getMemoryAdjustments('d9');
    expect(adj['pb-4']).toBeGreaterThan(0);
  });

  it('penalizes playbooks with more failures', () => {
    recordDealEvent('d10', { type: 'playbook_used', detail: '', playbookId: 'pb-5' });
    recordDealEvent('d10', { type: 'approach_failed', detail: 'nope', playbookId: 'pb-5' });
    recordDealEvent('d10', { type: 'approach_failed', detail: 'nope2', playbookId: 'pb-5' });
    const adj = getMemoryAdjustments('d10');
    expect(adj['pb-5']).toBeLessThan(0);
  });
});

describe('Playbook Sequencing', () => {
  it('starts and tracks a sequence', () => {
    const state = startSequence('deal-seq', 'seq-new-logo-full');
    expect(state.currentStepIndex).toBe(0);
    expect(state.sequenceId).toBe('seq-new-logo-full');
  });

  it('advances through steps', () => {
    startSequence('deal-seq2', 'seq-new-logo-full');
    advanceSequence('deal-seq2', 'completed');
    const step = getCurrentSequenceStep('deal-seq2');
    expect(step?.position).toBe(2);
  });

  it('tracks completed and skipped steps', () => {
    startSequence('deal-seq3', 'seq-stalled-recovery');
    advanceSequence('deal-seq3', 'completed');
    advanceSequence('deal-seq3', 'skipped');
    const state = JSON.parse(localStorage.getItem('deal-sequence-states') || '{}')['deal-seq3'];
    expect(state.completedSteps).toContain(0);
    expect(state.skippedSteps).toContain(1);
  });

  it('branches on failure when configured', () => {
    startSequence('deal-seq4', 'seq-new-logo-full');
    // Advance to champion building step (index 2)
    advanceSequence('deal-seq4', 'completed'); // 0 → 1
    advanceSequence('deal-seq4', 'completed'); // 1 → 2
    // Fail at champion building — branchOnFailure points to pb-multithreading
    // which isn't a step in the sequence, so it advances to next step (index 3)
    advanceSequence('deal-seq4', 'failed');
    const step = getCurrentSequenceStep('deal-seq4');
    // Falls through to next step since branch target not found in sequence
    expect(step?.step.playbookId).toBe('pb-demo-execution');
    expect(step?.position).toBe(4);
  });

  it('selects stalled recovery for stale deals', () => {
    const seq = selectBestSequence(makeDeal({ daysSinceLastTouch: 20 }));
    expect(seq?.id).toBe('seq-stalled-recovery');
  });

  it('selects competitive for competitive deals', () => {
    const seq = selectBestSequence(makeDeal({ competitionPresent: true, daysSinceLastTouch: 3 }));
    expect(seq?.id).toBe('seq-competitive');
  });

  it('selects new logo full cycle for new logos', () => {
    const seq = selectBestSequence(makeDeal({ isNewLogo: true, daysSinceLastTouch: 3 }));
    expect(seq?.id).toBe('seq-new-logo-full');
  });
});

describe('Meta-Learning', () => {
  it('returns empty correlations with insufficient data', () => {
    const outcomes = Array.from({ length: 5 }, (_, i) => ({
      signals: makeDeal({ dealId: `d-${i}` }),
      positiveOutcome: i % 2 === 0,
    }));
    expect(analyzeWeightCorrelations(outcomes)).toHaveLength(0);
  });

  it('computes correlations with sufficient data', () => {
    const outcomes = Array.from({ length: 20 }, (_, i) => ({
      signals: makeDeal({ dealId: `d-${i}`, arrK: i * 20 }),
      positiveOutcome: i > 10, // higher ARR → positive
    }));
    const correlations = analyzeWeightCorrelations(outcomes);
    expect(correlations.length).toBe(5);
    // Revenue should have positive correlation with outcomes
    const rev = correlations.find(c => c.field === 'revenueWeight');
    expect(rev).toBeDefined();
    expect(rev!.correlation).toBeGreaterThan(0);
  });

  it('applies adjustments only when thresholds met', () => {
    const correlations = [
      { field: 'revenueWeight' as const, currentWeight: 0.30, suggestedWeight: 0.35, correlation: 0.25, sampleSize: 20 },
      { field: 'riskWeight' as const, currentWeight: 0.25, suggestedWeight: 0.26, correlation: 0.05, sampleSize: 20 }, // below min correlation
    ];
    const learned = applyWeightAdjustments(correlations);
    expect(learned.adjustmentHistory.length).toBe(1);
    expect(learned.adjustmentHistory[0].field).toBe('revenueWeight');
  });

  it('normalizes weights to sum to ~1', () => {
    const correlations = [
      { field: 'revenueWeight' as const, currentWeight: 0.30, suggestedWeight: 0.50, correlation: 0.30, sampleSize: 20 },
    ];
    const learned = applyWeightAdjustments(correlations);
    const sum = Object.values(learned.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 1);
  });

  it('persists and loads learned weights', () => {
    const correlations = [
      { field: 'revenueWeight' as const, currentWeight: 0.30, suggestedWeight: 0.40, correlation: 0.20, sampleSize: 25 },
    ];
    applyWeightAdjustments(correlations);
    const loaded = loadLearnedWeights();
    expect(loaded.adjustmentHistory.length).toBeGreaterThan(0);
  });
});

describe('Engine Stats', () => {
  it('computes stats from actions', () => {
    recordDealEvent('stat-deal', { type: 'objection_seen', detail: 'price' });
    startSequence('stat-deal', 'seq-new-logo-full');

    const actions = prioritizeDeals([makeDeal({ dealId: 'stat-deal' })]);
    const stats = computeEngineStats(actions);
    expect(stats.totalDealsTracked).toBe(1);
    expect(stats.activeSequences).toBe(1);
    expect(stats.totalMemoryEntries).toBeGreaterThan(0);
    expect(stats.topRiskDeal).toBe('Acme Corp');
  });
});
