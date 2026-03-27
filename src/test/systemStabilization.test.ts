import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordBaseline,
  loadBaselines,
  computeDrift,
  detectBaselineDrift,
  recordCounterfactual,
  loadCounterfactuals,
  computeRegretScore,
  computeAggregateRegret,
  startRollout,
  promoteRollout,
  recordRolloutOutcome,
  getRolloutStage,
  shouldApplyStrategy,
  protectPlaybook,
  unprotectPlaybook,
  loadProtectedPlaybooks,
  isPlaybookProtected,
  guardWeightChange,
  recordPersonalOutcome,
  loadPersonalRecords,
  computePersonalProfile,
  applyPersonalBoost,
  loadAlerts,
  type BaselineSnapshot,
  type CounterfactualRecord,
  type PersonalPerformanceRecord,
} from '@/lib/systemIntelligence';

beforeEach(() => {
  localStorage.clear();
});

// ── Baseline Drift Detection ──────────────────────────────

function makeBaseline(overrides?: Partial<BaselineSnapshot>): BaselineSnapshot {
  return {
    timestamp: new Date().toISOString(),
    playbookWeights: { revenueWeight: 0.30, riskWeight: 0.25, momentumWeight: 0.20 },
    trustDistribution: { trusted: 60, limited: 30, experimental: 10 },
    outcomeRates: { winRate: 35, stageProgressionRate: 50 },
    ...overrides,
  };
}

describe('Baseline Drift Detection', () => {
  it('records and loads baselines', () => {
    recordBaseline(makeBaseline());
    recordBaseline(makeBaseline());
    expect(loadBaselines()).toHaveLength(2);
  });

  it('caps stored baselines at 12', () => {
    for (let i = 0; i < 15; i++) recordBaseline(makeBaseline());
    expect(loadBaselines()).toHaveLength(12);
  });

  it('detects no drift when identical', () => {
    const a = makeBaseline();
    const b = makeBaseline();
    const report = computeDrift(a, b);
    expect(report.overallDrift).toBe(0);
    expect(report.alertTriggered).toBe(false);
  });

  it('detects significant drift in weights', () => {
    const baseline = makeBaseline();
    const current = makeBaseline({
      playbookWeights: { revenueWeight: 0.50, riskWeight: 0.10, momentumWeight: 0.40 },
    });
    const report = computeDrift(baseline, current);
    expect(report.alertTriggered).toBe(true);
    const sigDrifts = report.drifts.filter(d => d.severity !== 'none');
    expect(sigDrifts.length).toBeGreaterThan(0);
  });

  it('detects drift in trust distribution', () => {
    const baseline = makeBaseline();
    const current = makeBaseline({ trustDistribution: { trusted: 20, limited: 50, experimental: 30 } });
    const report = computeDrift(baseline, current);
    expect(report.alertTriggered).toBe(true);
  });

  it('detectBaselineDrift returns null with no baselines', () => {
    expect(detectBaselineDrift(makeBaseline())).toBeNull();
  });

  it('detectBaselineDrift triggers alert on drift', () => {
    recordBaseline(makeBaseline());
    const current = makeBaseline({
      playbookWeights: { revenueWeight: 0.60, riskWeight: 0.05, momentumWeight: 0.35 },
    });
    const report = detectBaselineDrift(current);
    expect(report).not.toBeNull();
    expect(report!.alertTriggered).toBe(true);
    const alerts = loadAlerts();
    expect(alerts.some(a => a.metric === 'baseline_drift')).toBe(true);
  });

  it('does not alert on minor drift', () => {
    recordBaseline(makeBaseline());
    const current = makeBaseline({
      playbookWeights: { revenueWeight: 0.31, riskWeight: 0.24, momentumWeight: 0.21 },
    });
    const report = detectBaselineDrift(current);
    expect(report!.alertTriggered).toBe(false);
  });
});

// ── Counterfactual Validation ─────────────────────────────

describe('Counterfactual Validation', () => {
  function makeCF(overrides?: Partial<CounterfactualRecord>): CounterfactualRecord {
    return {
      dealId: 'deal-1',
      timestamp: new Date().toISOString(),
      chosenPlaybookId: 'pb-a',
      alternativePlaybookIds: ['pb-b', 'pb-c'],
      chosenOutcome: 'negative',
      alternativeEstimatedScores: { 'pb-b': 0.8, 'pb-c': 0.3 },
      ...overrides,
    };
  }

  it('records and loads counterfactuals', () => {
    recordCounterfactual(makeCF());
    expect(loadCounterfactuals()).toHaveLength(1);
  });

  it('computes regret when alternative was better', () => {
    const cf = makeCF({ chosenOutcome: 'negative' });
    const regret = computeRegretScore(cf);
    expect(regret.regret).toBeGreaterThan(0);
    expect(regret.bestAlternativeId).toBe('pb-b');
    expect(regret.bestAlternativeScore).toBe(0.8);
  });

  it('computes zero regret when chosen was best', () => {
    const cf = makeCF({
      chosenOutcome: 'positive',
      alternativeEstimatedScores: { 'pb-b': 0.5, 'pb-c': 0.3 },
    });
    const regret = computeRegretScore(cf);
    expect(regret.regret).toBe(0);
  });

  it('computes aggregate regret across records', () => {
    recordCounterfactual(makeCF({ dealId: 'd1', chosenOutcome: 'negative', alternativeEstimatedScores: { 'pb-b': 0.8 } }));
    recordCounterfactual(makeCF({ dealId: 'd2', chosenOutcome: 'negative', alternativeEstimatedScores: { 'pb-b': 0.9 } }));
    recordCounterfactual(makeCF({ dealId: 'd3', chosenOutcome: 'positive', alternativeEstimatedScores: { 'pb-b': 0.5 } }));
    const agg = computeAggregateRegret();
    expect(agg.count).toBe(3);
    expect(agg.totalRegret).toBeGreaterThan(0);
    expect(agg.avgRegret).toBeGreaterThan(0);
  });

  it('identifies high-regret playbooks', () => {
    // pb-a chosen but fails 3 times with better alternatives
    for (let i = 0; i < 3; i++) {
      recordCounterfactual(makeCF({
        dealId: `d-${i}`,
        chosenPlaybookId: 'pb-bad',
        chosenOutcome: 'negative',
        alternativeEstimatedScores: { 'pb-good': 0.9 },
      }));
    }
    const agg = computeAggregateRegret();
    expect(agg.highRegretPlaybooks).toContain('pb-bad');
  });

  it('skips pending outcomes in aggregate', () => {
    recordCounterfactual(makeCF({ chosenOutcome: 'pending' }));
    const agg = computeAggregateRegret();
    expect(agg.count).toBe(0);
  });
});

// ── System Authority Guardrails ───────────────────────────

describe('System Authority Guardrails', () => {
  describe('Staged Rollout', () => {
    it('starts a rollout at canary (10%)', () => {
      const stage = startRollout('new-strategy-1');
      expect(stage.stage).toBe('canary');
      expect(stage.percentage).toBe(10);
    });

    it('does not promote with insufficient attempts', () => {
      startRollout('s1');
      recordRolloutOutcome('s1', true);
      const result = promoteRollout('s1');
      expect(result!.stage).toBe('canary'); // still canary
    });

    it('promotes canary → partial with enough successes', () => {
      startRollout('s2');
      for (let i = 0; i < 3; i++) recordRolloutOutcome('s2', true);
      const result = promoteRollout('s2');
      expect(result!.stage).toBe('partial');
      expect(result!.percentage).toBe(50);
    });

    it('promotes partial → full with enough successes', () => {
      startRollout('s3');
      for (let i = 0; i < 3; i++) recordRolloutOutcome('s3', true);
      promoteRollout('s3'); // canary → partial
      for (let i = 0; i < 5; i++) recordRolloutOutcome('s3', true);
      const result = promoteRollout('s3');
      expect(result!.stage).toBe('full');
      expect(result!.percentage).toBe(100);
    });

    it('does not promote with low success rate', () => {
      startRollout('s4');
      recordRolloutOutcome('s4', true);
      recordRolloutOutcome('s4', false);
      recordRolloutOutcome('s4', false);
      const result = promoteRollout('s4');
      expect(result!.stage).toBe('canary'); // stays
    });

    it('shouldApplyStrategy respects rollout percentage', () => {
      startRollout('s5');
      expect(shouldApplyStrategy('s5', 0.05)).toBe(true);  // 5% < 10%
      expect(shouldApplyStrategy('s5', 0.15)).toBe(false); // 15% > 10%
    });

    it('shouldApplyStrategy returns true when no rollout exists', () => {
      expect(shouldApplyStrategy('unknown', 0.5)).toBe(true);
    });

    it('getRolloutStage returns null for unknown', () => {
      expect(getRolloutStage('nope')).toBeNull();
    });
  });

  describe('Protected Playbooks', () => {
    it('protects and unprotects playbooks', () => {
      protectPlaybook('pb-star');
      expect(isPlaybookProtected('pb-star')).toBe(true);
      unprotectPlaybook('pb-star');
      expect(isPlaybookProtected('pb-star')).toBe(false);
    });

    it('does not duplicate protected entries', () => {
      protectPlaybook('pb-x');
      protectPlaybook('pb-x');
      expect(loadProtectedPlaybooks().filter(id => id === 'pb-x')).toHaveLength(1);
    });
  });

  describe('Weight Change Guard', () => {
    it('caps weight increase at max %', () => {
      expect(guardWeightChange(0.30, 0.50, 0.10)).toBeCloseTo(0.33, 2);
    });

    it('caps weight decrease at max %', () => {
      expect(guardWeightChange(0.30, 0.10, 0.10)).toBeCloseTo(0.27, 2);
    });

    it('allows small changes within limit', () => {
      expect(guardWeightChange(0.30, 0.31, 0.10)).toBeCloseTo(0.31, 2);
    });
  });
});

// ── Personal Performance Layer ────────────────────────────

describe('Personal Performance Layer', () => {
  function recordMany(playbookId: string, wins: number, losses: number, opts?: Partial<PersonalPerformanceRecord>) {
    for (let i = 0; i < wins; i++) {
      recordPersonalOutcome({ playbookId, outcome: 'positive', timestamp: new Date().toISOString(), ...opts });
    }
    for (let i = 0; i < losses; i++) {
      recordPersonalOutcome({ playbookId, outcome: 'negative', timestamp: new Date().toISOString(), ...opts });
    }
  }

  it('records and loads personal outcomes', () => {
    recordPersonalOutcome({ playbookId: 'pb-1', outcome: 'positive', timestamp: new Date().toISOString() });
    expect(loadPersonalRecords()).toHaveLength(1);
  });

  it('computes empty profile with no data', () => {
    const profile = computePersonalProfile();
    expect(profile.totalRecords).toBe(0);
    expect(profile.topPlaybooks).toHaveLength(0);
  });

  it('computes playbook win rates', () => {
    recordMany('pb-a', 3, 1);
    recordMany('pb-b', 1, 3);
    const profile = computePersonalProfile();
    expect(profile.playbookWinRates['pb-a'].rate).toBe(0.75);
    expect(profile.playbookWinRates['pb-b'].rate).toBe(0.25);
  });

  it('identifies top playbooks', () => {
    recordMany('pb-star', 5, 0);
    recordMany('pb-ok', 3, 2);
    recordMany('pb-bad', 1, 4);
    const profile = computePersonalProfile();
    expect(profile.topPlaybooks[0]).toBe('pb-star');
  });

  it('finds best time of day', () => {
    for (let i = 0; i < 5; i++) {
      recordPersonalOutcome({ playbookId: 'pb-1', outcome: 'positive', timestamp: new Date().toISOString(), hourOfDay: 10 });
    }
    for (let i = 0; i < 5; i++) {
      recordPersonalOutcome({ playbookId: 'pb-1', outcome: 'negative', timestamp: new Date().toISOString(), hourOfDay: 16 });
    }
    const profile = computePersonalProfile();
    expect(profile.bestTimeOfDay).toBe(10);
  });

  it('finds best day of week', () => {
    for (let i = 0; i < 4; i++) {
      recordPersonalOutcome({ playbookId: 'pb-1', outcome: 'positive', timestamp: new Date().toISOString(), dayOfWeek: 2 });
    }
    for (let i = 0; i < 4; i++) {
      recordPersonalOutcome({ playbookId: 'pb-1', outcome: 'negative', timestamp: new Date().toISOString(), dayOfWeek: 4 });
    }
    const profile = computePersonalProfile();
    expect(profile.bestDayOfWeek).toBe(2);
  });

  it('computes conversion signals from stage data', () => {
    for (let i = 0; i < 3; i++) {
      recordPersonalOutcome({ playbookId: 'pb-1', outcome: 'positive', timestamp: new Date().toISOString(), dealStage: 'proposal' });
    }
    for (let i = 0; i < 3; i++) {
      recordPersonalOutcome({ playbookId: 'pb-1', outcome: 'negative', timestamp: new Date().toISOString(), dealStage: 'discovery' });
    }
    const profile = computePersonalProfile();
    expect(profile.conversionSignals[0].signal).toBe('proposal');
    expect(profile.conversionSignals[0].strength).toBe(1);
  });

  it('applies personal boost to high-performing playbook', () => {
    recordMany('pb-good', 4, 1);
    const profile = computePersonalProfile();
    const boosted = applyPersonalBoost(50, 'pb-good', profile);
    expect(boosted).toBeGreaterThan(50);
  });

  it('applies personal penalty to poor playbook', () => {
    recordMany('pb-bad', 1, 4);
    const profile = computePersonalProfile();
    const penalized = applyPersonalBoost(50, 'pb-bad', profile);
    expect(penalized).toBeLessThan(50);
  });

  it('does not boost with insufficient data', () => {
    recordMany('pb-new', 1, 0);
    const profile = computePersonalProfile();
    const unchanged = applyPersonalBoost(50, 'pb-new', profile);
    expect(unchanged).toBe(50);
  });
});
