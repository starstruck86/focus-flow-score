import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildDecisionExplanation,
  formatExplanationSummary,
  computeHealthSnapshot,
  detectAnomalies,
  loadSteeringBias,
  saveSteeringBias,
  applySteeringToUrgency,
  applySteeringToPlaybookScore,
  buildTemporalContext,
  computeTemporalAdjustment,
  computeFullyAdjustedUrgency,
  recordHealthSnapshot,
  loadHealthHistory,
  DEFAULT_STEERING,
  acknowledgeAlert,
  resolveAlert,
  escalateAlert,
  autoEscalateStaleAlerts,
  persistAlerts,
  loadAlerts,
  computeAlertResolutionStats,
  computeSystemConfidence,
  determineSystemMode,
  evaluateAutoCorrections,
  loadSystemMode,
  loadCorrectionLog,
  evaluateFullSystemHealth,
  MODE_PROFILES,
  type HealthInputs,
  type HealthSnapshot,
  type SteeringBias,
  type DecisionFactor,
  type SystemAlert,
  type AlertState,
  type SystemConfidence,
} from '@/lib/systemIntelligence';

beforeEach(() => {
  localStorage.clear();
});

// ── Explainability ─────────────────────────────────────────

describe('Explainability', () => {
  it('builds decision explanation with sorted factors', () => {
    const e = buildDecisionExplanation({
      decisionType: 'next_best_action',
      chosenId: 'deal-1',
      chosenLabel: 'Close Acme deal',
      confidence: 85,
      factors: [
        { factor: 'ARR', weight: 0.3, impact: 'positive', value: '$120k' },
        { factor: 'Risk', weight: 0.8, impact: 'negative', value: 'High churn' },
        { factor: 'Stage', weight: 0.1, impact: 'neutral', value: 'Proposal' },
      ],
      alternatives: [
        { id: 'deal-2', label: 'Expand Beta Corp', reason: 'Lower urgency', score: 40 },
      ],
    });

    expect(e.decisionType).toBe('next_best_action');
    expect(e.topFactors[0].factor).toBe('Risk'); // highest weight first
    expect(e.suppressedAlternatives).toHaveLength(1);
    expect(e.confidenceDrivers.length).toBeGreaterThan(0);
    expect(e.confidenceDrivers[0]).toContain('High data coverage');
  });

  it('classifies low confidence correctly', () => {
    const e = buildDecisionExplanation({
      decisionType: 'playbook_selection',
      chosenId: 'pb-1',
      chosenLabel: 'Discovery playbook',
      confidence: 30,
      factors: [{ factor: 'Fit', weight: 0.5, impact: 'neutral', value: 'OK' }],
      alternatives: [],
    });
    expect(e.confidenceDrivers[0]).toContain('Limited data');
  });

  it('formats explanation summary', () => {
    const e = buildDecisionExplanation({
      decisionType: 'sequencing',
      chosenId: 'seq-1',
      chosenLabel: 'New Logo Sequence',
      confidence: 65,
      factors: [
        { factor: 'Stage match', weight: 0.6, impact: 'positive', value: 'Yes' },
        { factor: 'Memory', weight: 0.2, impact: 'negative', value: '2 failures' },
      ],
      alternatives: [{ id: 'seq-2', label: 'Recovery Seq', reason: 'Lower match', score: 30 }],
    });
    const summary = formatExplanationSummary(e);
    expect(summary).toContain('sequencing');
    expect(summary).toContain('New Logo Sequence');
    expect(summary).toContain('Stage match');
    expect(summary).toContain('Recovery Seq');
  });

  it('includes signal changes when provided', () => {
    const e = buildDecisionExplanation({
      decisionType: 'prioritization',
      chosenId: 'd1',
      chosenLabel: 'Deal X',
      confidence: 70,
      factors: [],
      alternatives: [],
      signalChanges: [
        { signal: 'churn_risk', previousValue: 'moderate', currentValue: 'high', changedAt: new Date().toISOString(), direction: 'degraded' },
      ],
    });
    expect(e.recentSignalChanges).toHaveLength(1);
    expect(e.recentSignalChanges[0].direction).toBe('degraded');
  });
});

// ── System Health Monitoring ───────────────────────────────

describe('System Health Monitoring', () => {
  const healthyInputs: HealthInputs = {
    enrichmentSuccessRate: 95,
    enrichmentFailureRate: 5,
    playbookRegenerationCount: 2,
    trustDegradationCount: 1,
    outcomeScoreTrend: 10,
    explorationWinRate: 25,
    exploitationWinRate: 30,
    daveFailureRate: 3,
    daveRetryRate: 5,
    singlePlaybookConcentration: 30,
  };

  it('reports healthy when all metrics are good', () => {
    const snap = computeHealthSnapshot(healthyInputs);
    expect(snap.overallStatus).toBe('healthy');
    expect(snap.alerts).toHaveLength(0);
    expect(snap.metrics.length).toBeGreaterThan(0);
  });

  it('generates warning for moderate enrichment failure', () => {
    const snap = computeHealthSnapshot({ ...healthyInputs, enrichmentFailureRate: 25 });
    expect(snap.overallStatus).toBe('degraded');
    const alert = snap.alerts.find(a => a.category === 'enrichment');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('warning');
  });

  it('generates critical for high enrichment failure', () => {
    const snap = computeHealthSnapshot({ ...healthyInputs, enrichmentFailureRate: 50 });
    expect(snap.overallStatus).toBe('critical');
    const alert = snap.alerts.find(a => a.category === 'enrichment');
    expect(alert!.severity).toBe('critical');
  });

  it('alerts on trust degradation spike', () => {
    const snap = computeHealthSnapshot({ ...healthyInputs, trustDegradationCount: 10 });
    const alert = snap.alerts.find(a => a.category === 'trust');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('critical');
  });

  it('alerts on outcome score decline', () => {
    const snap = computeHealthSnapshot({ ...healthyInputs, outcomeScoreTrend: -30 });
    const alert = snap.alerts.find(a => a.category === 'outcome');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('critical');
  });

  it('alerts on Dave failure rate', () => {
    const snap = computeHealthSnapshot({ ...healthyInputs, daveFailureRate: 35 });
    expect(snap.alerts.find(a => a.category === 'dave')).toBeDefined();
  });

  it('alerts on single playbook over-reliance', () => {
    const snap = computeHealthSnapshot({ ...healthyInputs, singlePlaybookConcentration: 85 });
    const alert = snap.alerts.find(a => a.category === 'playbook');
    expect(alert).toBeDefined();
    expect(alert!.message).toContain('Over-reliance');
  });

  it('tracks exploration vs exploitation', () => {
    const snap = computeHealthSnapshot(healthyInputs);
    const explMetric = snap.metrics.find(m => m.metric === 'exploration_win_rate');
    expect(explMetric).toBeDefined();
  });
});

// ── Health History & Anomaly Detection ─────────────────────

describe('Health History & Anomalies', () => {
  it('records and loads health snapshots', () => {
    const snap: HealthSnapshot = {
      timestamp: new Date().toISOString(),
      metrics: [{ metric: 'test', value: 10, threshold: 20, status: 'healthy', trend: 'stable', sampleWindow: '24h' }],
      alerts: [],
      overallStatus: 'healthy',
    };
    recordHealthSnapshot(snap);
    recordHealthSnapshot(snap);
    const history = loadHealthHistory();
    expect(history).toHaveLength(2);
  });

  it('detects anomalies when value deviates from history', () => {
    const makeSnap = (val: number): HealthSnapshot => ({
      timestamp: new Date().toISOString(),
      metrics: [{ metric: 'enrichment_failure_rate', value: val, threshold: 20, status: 'healthy', trend: 'stable', sampleWindow: '24h' }],
      alerts: [],
      overallStatus: 'healthy',
    });

    const history = [makeSnap(5), makeSnap(6), makeSnap(5), makeSnap(7), makeSnap(5)];
    const current = makeSnap(50); // huge spike

    const anomalies = detectAnomalies(current, history);
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0].message).toContain('Anomaly');
  });

  it('returns no anomalies when history is too short', () => {
    const snap: HealthSnapshot = {
      timestamp: new Date().toISOString(),
      metrics: [{ metric: 'test', value: 99, threshold: 20, status: 'healthy', trend: 'stable', sampleWindow: '24h' }],
      alerts: [],
      overallStatus: 'healthy',
    };
    expect(detectAnomalies(snap, [snap, snap])).toHaveLength(0);
  });

  it('returns no anomalies when values are stable', () => {
    const makeSnap = (val: number): HealthSnapshot => ({
      timestamp: new Date().toISOString(),
      metrics: [{ metric: 'test', value: val, threshold: 20, status: 'healthy', trend: 'stable', sampleWindow: '24h' }],
      alerts: [],
      overallStatus: 'healthy',
    });
    const history = [makeSnap(10), makeSnap(11), makeSnap(10), makeSnap(12), makeSnap(10)];
    const current = makeSnap(11);
    expect(detectAnomalies(current, history)).toHaveLength(0);
  });
});

// ── Strategic Steering ─────────────────────────────────────

describe('Strategic Steering', () => {
  it('loads default steering when none saved', () => {
    const bias = loadSteeringBias();
    expect(bias.aggressionLevel).toBe(1);
    expect(bias.newLogoVsExpansion).toBe(0);
  });

  it('saves and loads steering bias', () => {
    const custom: SteeringBias = { ...DEFAULT_STEERING, aggressionLevel: 2, newLogoVsExpansion: 0.5 };
    saveSteeringBias(custom);
    const loaded = loadSteeringBias();
    expect(loaded.aggressionLevel).toBe(2);
    expect(loaded.newLogoVsExpansion).toBe(0.5);
  });

  it('boosts new-logo urgency with positive bias', () => {
    const base = 50;
    const bias: SteeringBias = { ...DEFAULT_STEERING, newLogoVsExpansion: 0.8 };
    const adjusted = applySteeringToUrgency(base, { isNewLogo: true, arrK: 100, stage: 'Discovery' }, bias);
    expect(adjusted).toBeGreaterThan(base);
  });

  it('does not boost expansion with new-logo bias', () => {
    const base = 50;
    const bias: SteeringBias = { ...DEFAULT_STEERING, newLogoVsExpansion: 0.8 };
    const adjusted = applySteeringToUrgency(base, { isNewLogo: false, arrK: 100, stage: 'Discovery' }, bias);
    expect(adjusted).toBe(base);
  });

  it('aggressive mode increases urgency', () => {
    const base = 50;
    const bias: SteeringBias = { ...DEFAULT_STEERING, aggressionLevel: 2 };
    const adjusted = applySteeringToUrgency(base, { isNewLogo: false, arrK: 100, stage: 'Discovery' }, bias);
    expect(adjusted).toBeGreaterThan(base);
  });

  it('conservative mode decreases urgency', () => {
    const base = 50;
    const bias: SteeringBias = { ...DEFAULT_STEERING, aggressionLevel: 0 };
    const adjusted = applySteeringToUrgency(base, { isNewLogo: false, arrK: 100, stage: 'Discovery' }, bias);
    expect(adjusted).toBeLessThan(base);
  });

  it('filters below minimum ARR', () => {
    const base = 50;
    const bias: SteeringBias = { ...DEFAULT_STEERING, minimumDealArrK: 50 };
    const adjusted = applySteeringToUrgency(base, { isNewLogo: false, arrK: 20, stage: 'Discovery' }, bias);
    expect(adjusted).toBeLessThan(20);
  });

  it('applies stage priority overrides', () => {
    const base = 50;
    const bias: SteeringBias = { ...DEFAULT_STEERING, stagePriorityOverrides: { 'Proposal': 15 } };
    const adjusted = applySteeringToUrgency(base, { isNewLogo: false, arrK: 100, stage: 'Proposal' }, bias);
    expect(adjusted).toBe(65);
  });

  it('applies strategy preferences to playbook score', () => {
    const score = applySteeringToPlaybookScore(50, 'discovery', { ...DEFAULT_STEERING, strategyPreferences: { discovery: 10 } });
    expect(score).toBe(60);
  });

  it('aggressive bias boosts close-type playbooks', () => {
    const score = applySteeringToPlaybookScore(50, 'close', { ...DEFAULT_STEERING, aggressionLevel: 2 });
    expect(score).toBe(55);
  });

  it('conservative bias boosts discovery playbooks', () => {
    const score = applySteeringToPlaybookScore(50, 'discovery', { ...DEFAULT_STEERING, aggressionLevel: 0 });
    expect(score).toBe(55);
  });
});

// ── Time-Aware Strategy ────────────────────────────────────

describe('Time-Aware Strategy', () => {
  it('builds temporal context correctly', () => {
    const date = new Date(2026, 2, 25, 10, 30); // March 25, 2026, 10:30 AM (Wed)
    const ctx = buildTemporalContext(date);
    expect(ctx.hourOfDay).toBe(10);
    expect(ctx.dayOfWeek).toBe(3); // Wednesday
    expect(ctx.monthOfYear).toBe(3);
    expect(ctx.isEndOfQuarter).toBe(true); // March 25 > 15
    expect(ctx.isMonday).toBe(false);
    expect(ctx.isFriday).toBe(false);
  });

  it('calculates deal age', () => {
    const now = new Date(2026, 2, 25);
    const created = new Date(2026, 1, 25); // 28 days ago
    const ctx = buildTemporalContext(now, created);
    expect(ctx.dealAgeDays).toBe(28);
  });

  it('boosts urgency at end of quarter', () => {
    const date = new Date(2026, 2, 25, 10); // March 25, end of Q1
    const ctx = buildTemporalContext(date);
    const adj = computeTemporalAdjustment(ctx);
    expect(adj.urgencyModifier).toBeGreaterThan(0);
    expect(adj.reason).toContain('End of quarter');
    expect(adj.sequencingBias).toBe('close-focused');
  });

  it('boosts urgency on Monday morning', () => {
    const date = new Date(2026, 2, 23, 9); // Monday, March 23, 9 AM
    const ctx = buildTemporalContext(date);
    const adj = computeTemporalAdjustment(ctx);
    expect(adj.urgencyModifier).toBeGreaterThan(0);
  });

  it('reduces urgency on Friday afternoon', () => {
    const date = new Date(2026, 2, 27, 15); // Friday, March 27, 3 PM
    const ctx = buildTemporalContext(date);
    const adj = computeTemporalAdjustment(ctx);
    expect(adj.reason).toContain('Friday afternoon');
  });

  it('reduces urgency outside business hours', () => {
    const date = new Date(2026, 4, 5, 21); // Tuesday May 5, 9 PM (mid-Q2)
    const ctx = buildTemporalContext(date);
    const adj = computeTemporalAdjustment(ctx);
    expect(adj.urgencyModifier).toBeLessThan(0);
    expect(adj.reason).toContain('Outside business hours');
  });

  it('boosts old deals', () => {
    const now = new Date(2026, 2, 25, 12);
    const created = new Date(2025, 10, 25); // ~120 days ago
    const ctx = buildTemporalContext(now, created);
    const adj = computeTemporalAdjustment(ctx);
    expect(adj.urgencyModifier).toBeGreaterThan(0);
    expect(adj.reason).toContain('Deal age');
  });
});

// ── Fully Adjusted Urgency ─────────────────────────────────

describe('Fully Adjusted Urgency', () => {
  it('combines steering and temporal adjustments', () => {
    const bias: SteeringBias = { ...DEFAULT_STEERING, aggressionLevel: 2, newLogoVsExpansion: 0.5 };
    const date = new Date(2026, 2, 25, 10);
    const ctx = buildTemporalContext(date);
    const { urgency, explanation } = computeFullyAdjustedUrgency(
      50,
      { isNewLogo: true, arrK: 100, stage: 'Discovery' },
      bias,
      ctx,
    );
    expect(urgency).toBeGreaterThan(50);
    expect(explanation.length).toBeGreaterThanOrEqual(1);
  });

  it('returns factors explaining the adjustment', () => {
    const bias: SteeringBias = { ...DEFAULT_STEERING, aggressionLevel: 0 };
    const date = new Date(2026, 2, 24, 21); // off-hours
    const ctx = buildTemporalContext(date);
    const { urgency, explanation } = computeFullyAdjustedUrgency(
      60,
      { isNewLogo: false, arrK: 50, stage: 'Proposal' },
      bias,
      ctx,
    );
    expect(urgency).toBeLessThan(60);
    const steeringFactor = explanation.find(f => f.factor === 'Steering adjustment');
    expect(steeringFactor).toBeDefined();
    const temporalFactor = explanation.find(f => f.factor === 'Temporal context');
    expect(temporalFactor).toBeDefined();
  });

  it('clamps result to 0-100', () => {
    const bias: SteeringBias = { ...DEFAULT_STEERING, aggressionLevel: 2, stagePriorityOverrides: { 'Close': 50 } };
    const date = new Date(2026, 2, 25, 10);
    const ctx = buildTemporalContext(date);
    const { urgency } = computeFullyAdjustedUrgency(95, { isNewLogo: true, arrK: 500, stage: 'Close' }, bias, ctx);
    expect(urgency).toBeLessThanOrEqual(100);
    expect(urgency).toBeGreaterThanOrEqual(0);
  });
});

// ── Healthy defaults for reuse ─────────────────────────────

const healthyInputs: HealthInputs = {
  enrichmentSuccessRate: 95,
  enrichmentFailureRate: 5,
  playbookRegenerationCount: 2,
  trustDegradationCount: 1,
  outcomeScoreTrend: 10,
  explorationWinRate: 25,
  exploitationWinRate: 30,
  daveFailureRate: 3,
  daveRetryRate: 5,
  singlePlaybookConcentration: 30,
};

// ── Alert Lifecycle ────────────────────────────────────────

describe('Alert Lifecycle', () => {
  function makeAlert(overrides?: Partial<SystemAlert>): SystemAlert {
    return {
      id: `alert-test-${Date.now()}`,
      severity: 'warning',
      category: 'enrichment',
      message: 'Test alert',
      metric: 'test',
      currentValue: 50,
      threshold: 20,
      triggeredAt: new Date().toISOString(),
      acknowledged: false,
      state: 'active' as AlertState,
      ...overrides,
    };
  }

  it('acknowledges an active alert', () => {
    const a = makeAlert({ id: 'ack-1' });
    persistAlerts([a]);
    const result = acknowledgeAlert('ack-1', 'admin');
    expect(result).not.toBeNull();
    expect(result!.state).toBe('acknowledged');
    expect(result!.acknowledgedBy).toBe('admin');
    expect(result!.acknowledgedAt).toBeDefined();
  });

  it('resolves an alert with resolution text', () => {
    const a = makeAlert({ id: 'res-1' });
    persistAlerts([a]);
    acknowledgeAlert('res-1');
    const result = resolveAlert('res-1', 'Fixed enrichment pipeline');
    expect(result!.state).toBe('resolved');
    expect(result!.resolution).toBe('Fixed enrichment pipeline');
  });

  it('cannot resolve an already-resolved alert', () => {
    const a = makeAlert({ id: 'res-2' });
    persistAlerts([a]);
    resolveAlert('res-2', 'First fix');
    const second = resolveAlert('res-2', 'Second fix');
    expect(second).toBeNull();
  });

  it('escalates an active alert', () => {
    const a = makeAlert({ id: 'esc-1' });
    persistAlerts([a]);
    const result = escalateAlert('esc-1', 'Too critical');
    expect(result!.state).toBe('escalated');
    expect(result!.escalationReason).toBe('Too critical');
  });

  it('auto-escalates stale unresolved alerts', () => {
    const staleTime = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5h ago
    const a = makeAlert({ id: 'stale-1', triggeredAt: staleTime });
    persistAlerts([a]);
    const escalated = autoEscalateStaleAlerts();
    expect(escalated.length).toBe(1);
    expect(escalated[0].state).toBe('escalated');
  });

  it('computes resolution stats', () => {
    localStorage.clear();
    const a1 = makeAlert({ id: 'stat-1', triggeredAt: new Date(Date.now() - 60000).toISOString() });
    persistAlerts([a1]);
    resolveAlert('stat-1', 'done');
    const stats = computeAlertResolutionStats();
    expect(stats.totalResolved).toBe(1);
    expect(stats.avgResolutionMs).toBeGreaterThan(0);
  });

  it('alerts from computeHealthSnapshot have active state', () => {
    const snap = computeHealthSnapshot({ ...healthyInputs, enrichmentFailureRate: 30 });
    expect(snap.alerts.length).toBeGreaterThan(0);
    expect(snap.alerts[0].state).toBe('active');
  });
});

// ── System Confidence ──────────────────────────────────────

describe('System Confidence', () => {
  it('computes high confidence when all metrics healthy', () => {
    const conf = computeSystemConfidence(healthyInputs, 0);
    expect(conf.score).toBeGreaterThanOrEqual(70);
    expect(conf.label).toBe('high');
    expect(conf.components.length).toBe(6);
  });

  it('drops confidence with high failure rates', () => {
    const bad = { ...healthyInputs, enrichmentFailureRate: 60, daveFailureRate: 50 };
    const conf = computeSystemConfidence(bad, 3);
    expect(conf.score).toBeLessThan(50);
    expect(['low', 'critical']).toContain(conf.label);
  });

  it('anomalies reduce confidence', () => {
    const noAnomaly = computeSystemConfidence(healthyInputs, 0);
    const withAnomaly = computeSystemConfidence(healthyInputs, 4);
    expect(withAnomaly.score).toBeLessThan(noAnomaly.score);
  });
});

// ── System Modes ───────────────────────────────────────────

describe('System Modes', () => {
  it('enters recovery on critical thresholds', () => {
    const conf = computeSystemConfidence({ ...healthyInputs, enrichmentFailureRate: 55 }, 0);
    const mode = determineSystemMode({ ...healthyInputs, enrichmentFailureRate: 55 }, 0, conf);
    expect(mode.mode).toBe('recovery');
    expect(mode.adjustments.length).toBeGreaterThan(0);
  });

  it('enters degraded on elevated failures', () => {
    const inputs = { ...healthyInputs, enrichmentFailureRate: 30 };
    const conf = computeSystemConfidence(inputs, 0);
    const mode = determineSystemMode(inputs, 0, conf);
    expect(mode.mode).toBe('degraded');
  });

  it('enters exploration-heavy on declining outcomes with exploration outperforming', () => {
    const inputs = { ...healthyInputs, outcomeScoreTrend: -20, explorationWinRate: 40, exploitationWinRate: 20 };
    const conf = computeSystemConfidence(inputs, 0);
    const mode = determineSystemMode(inputs, 0, conf);
    expect(mode.mode).toBe('exploration-heavy');
  });

  it('enters conservative on high anomaly count', () => {
    const conf = computeSystemConfidence(healthyInputs, 4);
    const mode = determineSystemMode(healthyInputs, 4, conf);
    expect(mode.mode).toBe('conservative');
  });

  it('stays normal when everything healthy', () => {
    const conf = computeSystemConfidence(healthyInputs, 0);
    const mode = determineSystemMode(healthyInputs, 0, conf);
    expect(mode.mode).toBe('normal');
  });

  it('MODE_PROFILES have valid values for all modes', () => {
    for (const [name, profile] of Object.entries(MODE_PROFILES)) {
      expect(profile.maxConcurrency).toBeGreaterThan(0);
      expect(profile.explorationRate).toBeGreaterThanOrEqual(0);
      expect(profile.explorationRate).toBeLessThanOrEqual(1);
    }
  });

  it('persists and loads system mode', () => {
    const inputs = { ...healthyInputs, enrichmentFailureRate: 30 };
    const conf = computeSystemConfidence(inputs, 0);
    determineSystemMode(inputs, 0, conf);
    const loaded = loadSystemMode();
    expect(loaded.mode).toBe('degraded');
  });
});

// ── Auto-Correction ────────────────────────────────────────

describe('Auto-Correction', () => {
  it('reduces concurrency on high enrichment failure', () => {
    const actions = evaluateAutoCorrections({ ...healthyInputs, enrichmentFailureRate: 35 }, 'normal');
    const conc = actions.find(a => a.action === 'reduce_concurrency');
    expect(conc).toBeDefined();
    expect(conc!.to).toBe(2);
  });

  it('increases exploration on declining outcomes', () => {
    const actions = evaluateAutoCorrections({ ...healthyInputs, outcomeScoreTrend: -25 }, 'normal');
    expect(actions.find(a => a.action === 'increase_exploration')).toBeDefined();
  });

  it('reduces complexity on high Dave failure', () => {
    const actions = evaluateAutoCorrections({ ...healthyInputs, daveFailureRate: 30 }, 'normal');
    expect(actions.find(a => a.action === 'reduce_complexity')).toBeDefined();
  });

  it('reduces aggression on trust degradation spike', () => {
    const actions = evaluateAutoCorrections({ ...healthyInputs, trustDegradationCount: 7 }, 'normal');
    expect(actions.find(a => a.action === 'reduce_aggression')).toBeDefined();
  });

  it('logs corrections persistently', () => {
    localStorage.clear();
    evaluateAutoCorrections({ ...healthyInputs, daveFailureRate: 30 }, 'normal');
    const log = loadCorrectionLog();
    expect(log.length).toBeGreaterThan(0);
  });

  it('does not trigger corrections when healthy', () => {
    const actions = evaluateAutoCorrections(healthyInputs, 'normal');
    expect(actions).toHaveLength(0);
  });
});

// ── Full System Health Evaluation ──────────────────────────

describe('Full System Health Evaluation', () => {
  it('returns all layers in a single call', () => {
    const result = evaluateFullSystemHealth(healthyInputs);
    expect(result.snapshot).toBeDefined();
    expect(result.confidence).toBeDefined();
    expect(result.mode).toBeDefined();
    expect(result.corrections).toBeDefined();
    expect(result.anomalies).toBeDefined();
    expect(result.escalated).toBeDefined();
  });

  it('triggers corrections in degraded scenario', () => {
    const result = evaluateFullSystemHealth({ ...healthyInputs, enrichmentFailureRate: 55, daveFailureRate: 45 });
    expect(result.mode.mode).toBe('recovery');
    expect(result.confidence.score).toBeLessThan(50);
    expect(result.corrections.length).toBeGreaterThan(0);
  });
});
