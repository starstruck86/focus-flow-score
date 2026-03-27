/**
 * System Intelligence Layer
 *
 * 1. Explainability — every decision returns contributing factors, suppressed alternatives, signal changes
 * 2. System health monitoring — tracks rates, detects anomalies, generates alerts
 * 3. Strategic steering — bias controls that influence prioritization without rewriting logic
 * 4. Time-aware strategy — adjusts behavior based on time of day, day of week, quarter timing
 */

import { createLogger } from './logger';

const log = createLogger('SystemIntelligence');

// ── Section 1: Explainability ──────────────────────────────

export interface DecisionFactor {
  factor: string;
  weight: number;    // 0-1
  impact: 'positive' | 'negative' | 'neutral';
  value: string;     // human-readable
}

export interface SuppressedAlternative {
  id: string;
  label: string;
  reason: string;
  score: number;
}

export interface SignalChange {
  signal: string;
  previousValue: string;
  currentValue: string;
  changedAt: string;
  direction: 'improved' | 'degraded' | 'unchanged';
}

export interface DecisionExplanation {
  decisionType: 'next_best_action' | 'playbook_selection' | 'sequencing' | 'prioritization';
  chosenId: string;
  chosenLabel: string;
  confidence: number;
  topFactors: DecisionFactor[];
  suppressedAlternatives: SuppressedAlternative[];
  recentSignalChanges: SignalChange[];
  confidenceDrivers: string[];
  timestamp: string;
}

export function buildDecisionExplanation(opts: {
  decisionType: DecisionExplanation['decisionType'];
  chosenId: string;
  chosenLabel: string;
  confidence: number;
  factors: DecisionFactor[];
  alternatives: SuppressedAlternative[];
  signalChanges?: SignalChange[];
}): DecisionExplanation {
  const sorted = [...opts.factors].sort((a, b) => b.weight - a.weight);
  const topFactors = sorted.slice(0, 5);

  const confidenceDrivers: string[] = [];
  if (opts.confidence >= 80) confidenceDrivers.push('High data coverage');
  else if (opts.confidence >= 50) confidenceDrivers.push('Moderate signal strength');
  else confidenceDrivers.push('Limited data — low confidence');

  const positives = opts.factors.filter(f => f.impact === 'positive').length;
  const negatives = opts.factors.filter(f => f.impact === 'negative').length;
  if (positives > negatives) confidenceDrivers.push(`${positives} supporting signals vs ${negatives} risks`);
  if (negatives > positives) confidenceDrivers.push(`${negatives} risk signals outweigh ${positives} supporting`);

  const explanation: DecisionExplanation = {
    decisionType: opts.decisionType,
    chosenId: opts.chosenId,
    chosenLabel: opts.chosenLabel,
    confidence: opts.confidence,
    topFactors,
    suppressedAlternatives: opts.alternatives.slice(0, 5),
    recentSignalChanges: opts.signalChanges ?? [],
    confidenceDrivers,
    timestamp: new Date().toISOString(),
  };

  log.debug('Decision explanation built', { type: opts.decisionType, chosen: opts.chosenLabel });
  return explanation;
}

export function formatExplanationSummary(e: DecisionExplanation): string {
  const topStr = e.topFactors
    .slice(0, 3)
    .map(f => `${f.factor} (${f.impact}, ${Math.round(f.weight * 100)}%)`)
    .join(', ');
  const altStr = e.suppressedAlternatives.length > 0
    ? ` | Suppressed: ${e.suppressedAlternatives.map(a => a.label).join(', ')}`
    : '';
  return `[${e.decisionType}] ${e.chosenLabel} (conf: ${e.confidence}%) — Top: ${topStr}${altStr}`;
}

// ── Section 2: System Health Monitoring ────────────────────

export interface SystemHealthMetric {
  metric: string;
  value: number;
  threshold: number;
  status: 'healthy' | 'warning' | 'critical';
  trend: 'improving' | 'degrading' | 'stable';
  sampleWindow: string; // e.g. '24h', '7d'
}

export type AlertState = 'active' | 'acknowledged' | 'resolved' | 'escalated';

export interface SystemAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  category: 'enrichment' | 'playbook' | 'trust' | 'outcome' | 'exploration' | 'dave' | 'system';
  message: string;
  metric: string;
  currentValue: number;
  threshold: number;
  triggeredAt: string;
  acknowledged: boolean;
  state: AlertState;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
  resolution?: string;
  escalatedAt?: string;
  escalationReason?: string;
}

export interface HealthSnapshot {
  timestamp: string;
  metrics: SystemHealthMetric[];
  alerts: SystemAlert[];
  overallStatus: 'healthy' | 'degraded' | 'critical';
}

export interface HealthInputs {
  enrichmentSuccessRate: number;       // 0-100
  enrichmentFailureRate: number;       // 0-100
  playbookRegenerationCount: number;   // in last 7d
  trustDegradationCount: number;       // in last 7d
  outcomeScoreTrend: number;           // -100 to 100 (positive = improving)
  explorationWinRate: number;          // 0-100
  exploitationWinRate: number;         // 0-100
  daveFailureRate: number;             // 0-100
  daveRetryRate: number;               // 0-100
  singlePlaybookConcentration: number; // 0-100 (% of usage from top playbook)
}

const HEALTH_THRESHOLDS = {
  enrichmentFailureRate: { warning: 20, critical: 40 },
  trustDegradationRate: { warning: 3, critical: 8 },
  outcomeScoreTrend: { warning: -10, critical: -25 },
  daveFailureRate: { warning: 15, critical: 30 },
  singlePlaybookConcentration: { warning: 60, critical: 80 },
  playbookRegenerationCount: { warning: 10, critical: 25 },
};

function classifyMetricStatus(value: number, warningThreshold: number, criticalThreshold: number, higherIsBad = true): SystemHealthMetric['status'] {
  if (higherIsBad) {
    if (value >= criticalThreshold) return 'critical';
    if (value >= warningThreshold) return 'warning';
    return 'healthy';
  }
  // Lower is bad (e.g. outcome trend)
  if (value <= criticalThreshold) return 'critical';
  if (value <= warningThreshold) return 'warning';
  return 'healthy';
}

function classifyTrend(value: number): SystemHealthMetric['trend'] {
  if (value > 5) return 'improving';
  if (value < -5) return 'degrading';
  return 'stable';
}

export function computeHealthSnapshot(inputs: HealthInputs): HealthSnapshot {
  const now = new Date().toISOString();
  const metrics: SystemHealthMetric[] = [];
  const alerts: SystemAlert[] = [];

  // Enrichment failure rate
  const enrichStatus = classifyMetricStatus(inputs.enrichmentFailureRate, HEALTH_THRESHOLDS.enrichmentFailureRate.warning, HEALTH_THRESHOLDS.enrichmentFailureRate.critical);
  metrics.push({
    metric: 'enrichment_failure_rate',
    value: inputs.enrichmentFailureRate,
    threshold: HEALTH_THRESHOLDS.enrichmentFailureRate.warning,
    status: enrichStatus,
    trend: 'stable',
    sampleWindow: '24h',
  });
  if (enrichStatus !== 'healthy') {
    alerts.push({
      id: `alert-enrich-${Date.now()}`, severity: enrichStatus === 'critical' ? 'critical' : 'warning',
      category: 'enrichment', message: `Enrichment failure rate at ${inputs.enrichmentFailureRate}%`,
      metric: 'enrichment_failure_rate', currentValue: inputs.enrichmentFailureRate,
      threshold: HEALTH_THRESHOLDS.enrichmentFailureRate.warning, triggeredAt: now, acknowledged: false, state: 'active' as AlertState,
    });
  }

  // Trust degradation
  const trustStatus = classifyMetricStatus(inputs.trustDegradationCount, HEALTH_THRESHOLDS.trustDegradationRate.warning, HEALTH_THRESHOLDS.trustDegradationRate.critical);
  metrics.push({
    metric: 'trust_degradation_count',
    value: inputs.trustDegradationCount,
    threshold: HEALTH_THRESHOLDS.trustDegradationRate.warning,
    status: trustStatus,
    trend: 'stable',
    sampleWindow: '7d',
  });
  if (trustStatus !== 'healthy') {
    alerts.push({
      id: `alert-trust-${Date.now()}`, severity: trustStatus === 'critical' ? 'critical' : 'warning',
      category: 'trust', message: `${inputs.trustDegradationCount} trust degradation events in 7d`,
      metric: 'trust_degradation_count', currentValue: inputs.trustDegradationCount,
      threshold: HEALTH_THRESHOLDS.trustDegradationRate.warning, triggeredAt: now, acknowledged: false, state: 'active' as AlertState,
    });
  }

  // Outcome trend
  const outcomeStatus = classifyMetricStatus(inputs.outcomeScoreTrend, HEALTH_THRESHOLDS.outcomeScoreTrend.warning, HEALTH_THRESHOLDS.outcomeScoreTrend.critical, false);
  metrics.push({
    metric: 'outcome_score_trend',
    value: inputs.outcomeScoreTrend,
    threshold: HEALTH_THRESHOLDS.outcomeScoreTrend.warning,
    status: outcomeStatus,
    trend: classifyTrend(inputs.outcomeScoreTrend),
    sampleWindow: '7d',
  });
  if (outcomeStatus !== 'healthy') {
    alerts.push({
      id: `alert-outcome-${Date.now()}`, severity: outcomeStatus === 'critical' ? 'critical' : 'warning',
      category: 'outcome', message: `Outcome score trending down: ${inputs.outcomeScoreTrend}`,
      metric: 'outcome_score_trend', currentValue: inputs.outcomeScoreTrend,
      threshold: HEALTH_THRESHOLDS.outcomeScoreTrend.warning, triggeredAt: now, acknowledged: false, state: 'active' as AlertState,
    });
  }

  // Dave failure rate
  const daveStatus = classifyMetricStatus(inputs.daveFailureRate, HEALTH_THRESHOLDS.daveFailureRate.warning, HEALTH_THRESHOLDS.daveFailureRate.critical);
  metrics.push({
    metric: 'dave_failure_rate',
    value: inputs.daveFailureRate,
    threshold: HEALTH_THRESHOLDS.daveFailureRate.warning,
    status: daveStatus,
    trend: 'stable',
    sampleWindow: '24h',
  });
  if (daveStatus !== 'healthy') {
    alerts.push({
      id: `alert-dave-${Date.now()}`, severity: daveStatus === 'critical' ? 'critical' : 'warning',
      category: 'dave', message: `Dave failure rate at ${inputs.daveFailureRate}%`,
      metric: 'dave_failure_rate', currentValue: inputs.daveFailureRate,
      threshold: HEALTH_THRESHOLDS.daveFailureRate.warning, triggeredAt: now, acknowledged: false, state: 'active' as AlertState,
    });
  }

  // Playbook concentration
  const concStatus = classifyMetricStatus(inputs.singlePlaybookConcentration, HEALTH_THRESHOLDS.singlePlaybookConcentration.warning, HEALTH_THRESHOLDS.singlePlaybookConcentration.critical);
  metrics.push({
    metric: 'single_playbook_concentration',
    value: inputs.singlePlaybookConcentration,
    threshold: HEALTH_THRESHOLDS.singlePlaybookConcentration.warning,
    status: concStatus,
    trend: 'stable',
    sampleWindow: '7d',
  });
  if (concStatus !== 'healthy') {
    alerts.push({
      id: `alert-conc-${Date.now()}`, severity: concStatus === 'critical' ? 'critical' : 'warning',
      category: 'playbook', message: `Over-reliance: ${inputs.singlePlaybookConcentration}% usage from single playbook`,
      metric: 'single_playbook_concentration', currentValue: inputs.singlePlaybookConcentration,
      threshold: HEALTH_THRESHOLDS.singlePlaybookConcentration.warning, triggeredAt: now, acknowledged: false, state: 'active' as AlertState,
    });
  }

  // Playbook regeneration frequency
  const regenStatus = classifyMetricStatus(inputs.playbookRegenerationCount, HEALTH_THRESHOLDS.playbookRegenerationCount.warning, HEALTH_THRESHOLDS.playbookRegenerationCount.critical);
  metrics.push({
    metric: 'playbook_regeneration_count',
    value: inputs.playbookRegenerationCount,
    threshold: HEALTH_THRESHOLDS.playbookRegenerationCount.warning,
    status: regenStatus,
    trend: 'stable',
    sampleWindow: '7d',
  });

  // Exploration vs exploitation
  metrics.push({
    metric: 'exploration_win_rate',
    value: inputs.explorationWinRate,
    threshold: 0,
    status: 'healthy',
    trend: classifyTrend(inputs.explorationWinRate - inputs.exploitationWinRate),
    sampleWindow: '7d',
  });

  // Overall status
  const hasCritical = metrics.some(m => m.status === 'critical');
  const hasWarning = metrics.some(m => m.status === 'warning');
  const overallStatus: HealthSnapshot['overallStatus'] = hasCritical ? 'critical' : hasWarning ? 'degraded' : 'healthy';

  return { timestamp: now, metrics, alerts, overallStatus };
}

// ── Section 3: Strategic Steering ──────────────────────────

export interface SteeringBias {
  /** Bias toward new-logo vs expansion (0 = balanced, +1 = all new-logo, -1 = all expansion) */
  newLogoVsExpansion: number;
  /** Aggression level: 0 = conservative, 1 = neutral, 2 = aggressive */
  aggressionLevel: number;
  /** Strategy preferences: weight boosts for specific strategy types */
  strategyPreferences: Record<string, number>;
  /** Minimum deal ARR to surface in prioritization (thousands) */
  minimumDealArrK: number;
  /** Override stage priority (e.g., focus on late-stage deals) */
  stagePriorityOverrides: Record<string, number>;
}

const STEERING_STORAGE_KEY = 'system-steering-bias';

export const DEFAULT_STEERING: SteeringBias = {
  newLogoVsExpansion: 0,
  aggressionLevel: 1,
  strategyPreferences: {},
  minimumDealArrK: 0,
  stagePriorityOverrides: {},
};

export function loadSteeringBias(): SteeringBias {
  try {
    const stored = localStorage.getItem(STEERING_STORAGE_KEY);
    if (stored) return { ...DEFAULT_STEERING, ...JSON.parse(stored) };
  } catch {}
  return { ...DEFAULT_STEERING };
}

export function saveSteeringBias(bias: SteeringBias): void {
  try {
    localStorage.setItem(STEERING_STORAGE_KEY, JSON.stringify(bias));
    log.info('Steering bias updated', bias);
  } catch {}
}

export function applySteeringToUrgency(
  baseUrgency: number,
  signals: { isNewLogo: boolean; arrK: number; stage: string },
  bias: SteeringBias,
): number {
  let adjusted = baseUrgency;

  // New logo vs expansion bias
  if (bias.newLogoVsExpansion > 0 && signals.isNewLogo) {
    adjusted += bias.newLogoVsExpansion * 10;
  } else if (bias.newLogoVsExpansion < 0 && !signals.isNewLogo) {
    adjusted += Math.abs(bias.newLogoVsExpansion) * 10;
  }

  // Aggression multiplier
  if (bias.aggressionLevel === 2) adjusted *= 1.15;
  else if (bias.aggressionLevel === 0) adjusted *= 0.85;

  // ARR floor filter
  if (signals.arrK < bias.minimumDealArrK) adjusted *= 0.3;

  // Stage priority overrides
  const stageBoost = bias.stagePriorityOverrides[signals.stage] ?? 0;
  adjusted += stageBoost;

  return Math.round(Math.max(0, Math.min(100, adjusted)));
}

export function applySteeringToPlaybookScore(
  baseScore: number,
  playbookType: string,
  bias: SteeringBias,
): number {
  const pref = bias.strategyPreferences[playbookType] ?? 0;
  let adjusted = baseScore + pref;

  // Aggressive bias boosts action-oriented playbooks
  if (bias.aggressionLevel === 2 && ['urgency', 'close', 'competitive'].includes(playbookType)) {
    adjusted += 5;
  }
  if (bias.aggressionLevel === 0 && ['discovery', 'relationship', 'nurture'].includes(playbookType)) {
    adjusted += 5;
  }

  return Math.max(0, Math.min(100, adjusted));
}

// ── Section 4: Time-Aware Strategy ─────────────────────────

export interface TemporalContext {
  hourOfDay: number;        // 0-23
  dayOfWeek: number;        // 0=Sun, 6=Sat
  dayOfMonth: number;
  monthOfYear: number;      // 1-12
  quarterProgress: number;  // 0-1 (how far into the quarter)
  dealAgeDays: number;
  isEndOfQuarter: boolean;  // last 2 weeks of quarter
  isMonday: boolean;
  isFriday: boolean;
}

export function buildTemporalContext(now: Date, dealCreatedAt?: Date): TemporalContext {
  const month = now.getMonth() + 1;
  const quarterMonth = ((month - 1) % 3) + 1; // 1, 2, or 3 within quarter
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayProgress = (now.getDate() - 1) / daysInMonth;
  const quarterProgress = ((quarterMonth - 1) + dayProgress) / 3;
  const isEndOfQuarter = quarterMonth === 3 && now.getDate() > 15;

  const dealAgeDays = dealCreatedAt
    ? Math.floor((now.getTime() - dealCreatedAt.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return {
    hourOfDay: now.getHours(),
    dayOfWeek: now.getDay(),
    dayOfMonth: now.getDate(),
    monthOfYear: month,
    quarterProgress,
    dealAgeDays,
    isEndOfQuarter,
    isMonday: now.getDay() === 1,
    isFriday: now.getDay() === 5,
  };
}

export interface TemporalAdjustment {
  urgencyModifier: number;      // additive, -20 to +20
  sequencingBias: string | null; // suggest sequence type
  reason: string;
}

export function computeTemporalAdjustment(ctx: TemporalContext): TemporalAdjustment {
  let urgencyMod = 0;
  const reasons: string[] = [];
  let sequencingBias: string | null = null;

  // End of quarter: increase urgency across the board
  if (ctx.isEndOfQuarter) {
    urgencyMod += 15;
    reasons.push('End of quarter — closing pressure');
    sequencingBias = 'close-focused';
  }

  // Monday morning: prioritize planning and outreach
  if (ctx.isMonday && ctx.hourOfDay < 12) {
    urgencyMod += 5;
    reasons.push('Monday morning — fresh outreach window');
  }

  // Friday afternoon: reduce urgency for cold outreach
  if (ctx.isFriday && ctx.hourOfDay >= 14) {
    urgencyMod -= 5;
    reasons.push('Friday afternoon — defer new outreach');
  }

  // Off-hours: reduce urgency for external actions
  if (ctx.hourOfDay < 8 || ctx.hourOfDay >= 19) {
    urgencyMod -= 10;
    reasons.push('Outside business hours');
  }

  // Stale deals get urgency boost
  if (ctx.dealAgeDays > 60) {
    urgencyMod += 10;
    reasons.push(`Deal age ${ctx.dealAgeDays}d — needs attention`);
  } else if (ctx.dealAgeDays > 30) {
    urgencyMod += 5;
    reasons.push(`Deal age ${ctx.dealAgeDays}d — aging`);
  }

  // Mid-quarter: balanced approach
  if (ctx.quarterProgress >= 0.3 && ctx.quarterProgress <= 0.6) {
    reasons.push('Mid-quarter — balanced execution');
  }

  return {
    urgencyModifier: Math.max(-20, Math.min(20, urgencyMod)),
    sequencingBias,
    reason: reasons.join('; ') || 'No temporal adjustments',
  };
}

/**
 * Combines all layers: steering bias + temporal context → final adjusted urgency
 */
export function computeFullyAdjustedUrgency(
  baseUrgency: number,
  signals: { isNewLogo: boolean; arrK: number; stage: string },
  bias: SteeringBias,
  temporal: TemporalContext,
): { urgency: number; explanation: DecisionFactor[] } {
  const steered = applySteeringToUrgency(baseUrgency, signals, bias);
  const tempAdj = computeTemporalAdjustment(temporal);
  const final = Math.max(0, Math.min(100, steered + tempAdj.urgencyModifier));

  const factors: DecisionFactor[] = [
    { factor: 'Base urgency', weight: baseUrgency / 100, impact: baseUrgency >= 50 ? 'positive' : 'neutral', value: `${baseUrgency}` },
  ];

  if (steered !== baseUrgency) {
    factors.push({
      factor: 'Steering adjustment',
      weight: Math.abs(steered - baseUrgency) / 100,
      impact: steered > baseUrgency ? 'positive' : 'negative',
      value: `${steered - baseUrgency > 0 ? '+' : ''}${steered - baseUrgency}`,
    });
  }

  if (tempAdj.urgencyModifier !== 0) {
    factors.push({
      factor: 'Temporal context',
      weight: Math.abs(tempAdj.urgencyModifier) / 100,
      impact: tempAdj.urgencyModifier > 0 ? 'positive' : 'negative',
      value: tempAdj.reason,
    });
  }

  return { urgency: final, explanation: factors };
}

// ── Health History (localStorage) ──────────────────────────

const HEALTH_HISTORY_KEY = 'system-health-history';
const MAX_HEALTH_SNAPSHOTS = 50;

export function recordHealthSnapshot(snapshot: HealthSnapshot): void {
  try {
    const history = JSON.parse(localStorage.getItem(HEALTH_HISTORY_KEY) || '[]') as HealthSnapshot[];
    history.push(snapshot);
    if (history.length > MAX_HEALTH_SNAPSHOTS) history.splice(0, history.length - MAX_HEALTH_SNAPSHOTS);
    localStorage.setItem(HEALTH_HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

export function loadHealthHistory(): HealthSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(HEALTH_HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

/**
 * Detect anomalies by comparing latest snapshot against recent history
 */
export function detectAnomalies(current: HealthSnapshot, history: HealthSnapshot[]): SystemAlert[] {
  if (history.length < 3) return [];

  const anomalies: SystemAlert[] = [];
  const recent = history.slice(-5);

  for (const metric of current.metrics) {
    const historicalValues = recent
      .map(h => h.metrics.find(m => m.metric === metric.metric)?.value)
      .filter((v): v is number => v !== undefined);

    if (historicalValues.length < 3) continue;

    const avg = historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length;
    const stddev = Math.sqrt(historicalValues.reduce((sum, v) => sum + (v - avg) ** 2, 0) / historicalValues.length);

    // Alert if current value is >2 standard deviations from recent average
    if (stddev > 0 && Math.abs(metric.value - avg) > stddev * 2) {
      anomalies.push({
        id: `anomaly-${metric.metric}-${Date.now()}`,
        severity: Math.abs(metric.value - avg) > stddev * 3 ? 'critical' : 'warning',
        category: 'system',
        message: `Anomaly detected: ${metric.metric} = ${metric.value} (avg: ${Math.round(avg)}, stddev: ${Math.round(stddev)})`,
        metric: metric.metric,
        currentValue: metric.value,
        threshold: Math.round(avg + stddev * 2),
        triggeredAt: current.timestamp,
        acknowledged: false,
        state: 'active' as AlertState,
      });
    }
  }

  return anomalies;
}

// ── Section 5: Alert Lifecycle ─────────────────────────────

const ALERT_STORE_KEY = 'system-alerts';
const MAX_STORED_ALERTS = 200;
const ESCALATION_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours

export function acknowledgeAlert(alertId: string, by?: string): SystemAlert | null {
  const alerts = loadAlerts();
  const alert = alerts.find(a => a.id === alertId);
  if (!alert || alert.state !== 'active') return null;
  alert.state = 'acknowledged';
  alert.acknowledged = true;
  alert.acknowledgedAt = new Date().toISOString();
  if (by) alert.acknowledgedBy = by;
  saveAlerts(alerts);
  return alert;
}

export function resolveAlert(alertId: string, resolution: string): SystemAlert | null {
  const alerts = loadAlerts();
  const alert = alerts.find(a => a.id === alertId);
  if (!alert || alert.state === 'resolved') return null;
  alert.state = 'resolved';
  alert.resolvedAt = new Date().toISOString();
  alert.resolution = resolution;
  saveAlerts(alerts);
  return alert;
}

export function escalateAlert(alertId: string, reason: string): SystemAlert | null {
  const alerts = loadAlerts();
  const alert = alerts.find(a => a.id === alertId);
  if (!alert || alert.state === 'resolved') return null;
  alert.state = 'escalated';
  alert.escalatedAt = new Date().toISOString();
  alert.escalationReason = reason;
  saveAlerts(alerts);
  return alert;
}

export function autoEscalateStaleAlerts(nowMs: number = Date.now()): SystemAlert[] {
  const alerts = loadAlerts();
  const escalated: SystemAlert[] = [];
  for (const a of alerts) {
    if (a.state !== 'active') continue;
    const age = nowMs - new Date(a.triggeredAt).getTime();
    if (age > ESCALATION_TIMEOUT_MS) {
      a.state = 'escalated';
      a.escalatedAt = new Date(nowMs).toISOString();
      a.escalationReason = `Unresolved for ${Math.round(age / 3600000)}h`;
      escalated.push(a);
    }
  }
  if (escalated.length > 0) saveAlerts(alerts);
  return escalated;
}

export function persistAlerts(newAlerts: SystemAlert[]): void {
  const existing = loadAlerts();
  existing.push(...newAlerts);
  if (existing.length > MAX_STORED_ALERTS) existing.splice(0, existing.length - MAX_STORED_ALERTS);
  saveAlerts(existing);
}

export function loadAlerts(): SystemAlert[] {
  try {
    return JSON.parse(localStorage.getItem(ALERT_STORE_KEY) || '[]');
  } catch { return []; }
}

function saveAlerts(alerts: SystemAlert[]): void {
  try { localStorage.setItem(ALERT_STORE_KEY, JSON.stringify(alerts)); } catch {}
}

export function computeAlertResolutionStats(): { totalResolved: number; avgResolutionMs: number; escalationRate: number } {
  const alerts = loadAlerts();
  const resolved = alerts.filter(a => a.state === 'resolved' && a.resolvedAt && a.triggeredAt);
  const escalated = alerts.filter(a => a.state === 'escalated');
  const total = alerts.length || 1;
  const durations = resolved.map(a => new Date(a.resolvedAt!).getTime() - new Date(a.triggeredAt).getTime());
  const avgMs = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
  return { totalResolved: resolved.length, avgResolutionMs: avgMs, escalationRate: escalated.length / total };
}

// ── Section 6: System Confidence Score ─────────────────────

export interface SystemConfidence {
  score: number;             // 0-100
  label: 'high' | 'moderate' | 'low' | 'critical';
  components: { name: string; score: number; weight: number }[];
  timestamp: string;
}

export function computeSystemConfidence(inputs: HealthInputs, anomalyCount: number): SystemConfidence {
  const components: SystemConfidence['components'] = [
    { name: 'enrichment_health', score: Math.max(0, 100 - inputs.enrichmentFailureRate * 2), weight: 0.25 },
    { name: 'outcome_stability', score: Math.max(0, Math.min(100, 50 + inputs.outcomeScoreTrend)), weight: 0.25 },
    { name: 'dave_reliability', score: Math.max(0, 100 - inputs.daveFailureRate * 2), weight: 0.15 },
    { name: 'playbook_diversity', score: Math.max(0, 100 - inputs.singlePlaybookConcentration), weight: 0.15 },
    { name: 'anomaly_frequency', score: Math.max(0, 100 - anomalyCount * 20), weight: 0.10 },
    { name: 'trust_stability', score: Math.max(0, 100 - inputs.trustDegradationCount * 10), weight: 0.10 },
  ];

  const score = Math.round(components.reduce((s, c) => s + c.score * c.weight, 0));
  const label: SystemConfidence['label'] =
    score >= 80 ? 'high' : score >= 55 ? 'moderate' : score >= 30 ? 'low' : 'critical';

  return { score, label, components, timestamp: new Date().toISOString() };
}

// ── Section 7: System Modes & Auto-Correction ──────────────

export type SystemMode = 'normal' | 'degraded' | 'recovery' | 'exploration-heavy' | 'conservative';

export interface SystemModeState {
  mode: SystemMode;
  enteredAt: string;
  reason: string;
  adjustments: ModeAdjustment[];
}

export interface ModeAdjustment {
  parameter: string;
  originalValue: number | string;
  adjustedValue: number | string;
  reason: string;
}

export interface AutoCorrectionAction {
  trigger: string;
  action: string;
  parameter: string;
  from: number | string;
  to: number | string;
  timestamp: string;
}

const MODE_STORAGE_KEY = 'system-mode-state';
const CORRECTION_LOG_KEY = 'system-correction-log';
const MAX_CORRECTIONS = 100;

export const MODE_PROFILES: Record<SystemMode, {
  aggressionMultiplier: number;
  explorationRate: number;
  maxConcurrency: number;
  retryMultiplier: number;
  playbookComplexityCap: 'low' | 'medium' | 'high';
}> = {
  normal:             { aggressionMultiplier: 1.0,  explorationRate: 0.07, maxConcurrency: 5, retryMultiplier: 1.0, playbookComplexityCap: 'high' },
  degraded:           { aggressionMultiplier: 0.8,  explorationRate: 0.03, maxConcurrency: 2, retryMultiplier: 1.5, playbookComplexityCap: 'medium' },
  recovery:           { aggressionMultiplier: 0.6,  explorationRate: 0.02, maxConcurrency: 1, retryMultiplier: 2.0, playbookComplexityCap: 'low' },
  'exploration-heavy':{ aggressionMultiplier: 0.9,  explorationRate: 0.20, maxConcurrency: 5, retryMultiplier: 1.0, playbookComplexityCap: 'high' },
  conservative:       { aggressionMultiplier: 0.7,  explorationRate: 0.03, maxConcurrency: 3, retryMultiplier: 1.0, playbookComplexityCap: 'medium' },
};

export function determineSystemMode(inputs: HealthInputs, anomalyCount: number, confidence: SystemConfidence): SystemModeState {
  const adjustments: ModeAdjustment[] = [];
  let mode: SystemMode = 'normal';
  const reasons: string[] = [];

  // Critical failures → recovery
  if (inputs.enrichmentFailureRate > 50 || inputs.daveFailureRate > 40 || confidence.score < 30) {
    mode = 'recovery';
    reasons.push('Critical threshold breach');
    adjustments.push(
      { parameter: 'concurrency', originalValue: 5, adjustedValue: 1, reason: 'Reduce load under critical failure' },
      { parameter: 'playbookComplexity', originalValue: 'high', adjustedValue: 'low', reason: 'Simplify operations' },
    );
  }
  // Degraded state
  else if (inputs.enrichmentFailureRate > 25 || inputs.daveFailureRate > 20 || confidence.score < 55) {
    mode = 'degraded';
    reasons.push('Elevated failure rates');
    adjustments.push(
      { parameter: 'concurrency', originalValue: 5, adjustedValue: 2, reason: 'Reduce concurrency under stress' },
    );
  }
  // Declining outcomes → exploration-heavy
  else if (inputs.outcomeScoreTrend < -15 && inputs.explorationWinRate > inputs.exploitationWinRate) {
    mode = 'exploration-heavy';
    reasons.push('Declining outcomes — exploratory playbooks outperforming');
    adjustments.push(
      { parameter: 'explorationRate', originalValue: 0.07, adjustedValue: 0.20, reason: 'Increase exploration to find better strategies' },
    );
  }
  // High anomalies → conservative
  else if (anomalyCount >= 3) {
    mode = 'conservative';
    reasons.push('Multiple anomalies detected');
    adjustments.push(
      { parameter: 'aggressionMultiplier', originalValue: 1.0, adjustedValue: 0.7, reason: 'Reduce aggression under anomalous conditions' },
    );
  }

  const state: SystemModeState = {
    mode,
    enteredAt: new Date().toISOString(),
    reason: reasons.join('; ') || 'All systems nominal',
    adjustments,
  };

  saveSystemMode(state);
  return state;
}

export function evaluateAutoCorrections(inputs: HealthInputs, currentMode: SystemMode): AutoCorrectionAction[] {
  const actions: AutoCorrectionAction[] = [];
  const now = new Date().toISOString();
  const profile = MODE_PROFILES[currentMode];

  // High enrichment failure → reduce concurrency + enable fallback
  if (inputs.enrichmentFailureRate > 30 && profile.maxConcurrency > 2) {
    actions.push({ trigger: `enrichmentFailureRate=${inputs.enrichmentFailureRate}`, action: 'reduce_concurrency', parameter: 'maxConcurrency', from: profile.maxConcurrency, to: 2, timestamp: now });
  }

  // Declining outcomes → increase exploration
  if (inputs.outcomeScoreTrend < -20 && profile.explorationRate < 0.15) {
    actions.push({ trigger: `outcomeScoreTrend=${inputs.outcomeScoreTrend}`, action: 'increase_exploration', parameter: 'explorationRate', from: profile.explorationRate, to: 0.15, timestamp: now });
  }

  // High Dave error → reduce complexity
  if (inputs.daveFailureRate > 25 && profile.playbookComplexityCap !== 'low') {
    actions.push({ trigger: `daveFailureRate=${inputs.daveFailureRate}`, action: 'reduce_complexity', parameter: 'playbookComplexityCap', from: profile.playbookComplexityCap, to: 'low', timestamp: now });
  }

  // Trust degradation spike → conservative aggression
  if (inputs.trustDegradationCount > 5 && profile.aggressionMultiplier > 0.7) {
    actions.push({ trigger: `trustDegradation=${inputs.trustDegradationCount}`, action: 'reduce_aggression', parameter: 'aggressionMultiplier', from: profile.aggressionMultiplier, to: 0.7, timestamp: now });
  }

  if (actions.length > 0) recordCorrections(actions);
  return actions;
}

export function loadSystemMode(): SystemModeState {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return { mode: 'normal', enteredAt: new Date().toISOString(), reason: 'Default', adjustments: [] };
}

function saveSystemMode(state: SystemModeState): void {
  try { localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function recordCorrections(actions: AutoCorrectionAction[]): void {
  try {
    const existing: AutoCorrectionAction[] = JSON.parse(localStorage.getItem(CORRECTION_LOG_KEY) || '[]');
    existing.push(...actions);
    if (existing.length > MAX_CORRECTIONS) existing.splice(0, existing.length - MAX_CORRECTIONS);
    localStorage.setItem(CORRECTION_LOG_KEY, JSON.stringify(existing));
  } catch {}
}

export function loadCorrectionLog(): AutoCorrectionAction[] {
  try { return JSON.parse(localStorage.getItem(CORRECTION_LOG_KEY) || '[]'); } catch { return []; }
}

/**
 * Full system health evaluation — runs all layers in sequence and returns combined result
 */
export function evaluateFullSystemHealth(inputs: HealthInputs): {
  snapshot: HealthSnapshot;
  confidence: SystemConfidence;
  mode: SystemModeState;
  corrections: AutoCorrectionAction[];
  anomalies: SystemAlert[];
  escalated: SystemAlert[];
} {
  const snapshot = computeHealthSnapshot(inputs);
  const history = loadHealthHistory();
  const anomalies = detectAnomalies(snapshot, history);
  recordHealthSnapshot(snapshot);
  persistAlerts([...snapshot.alerts, ...anomalies]);

  const confidence = computeSystemConfidence(inputs, anomalies.length);
  const mode = determineSystemMode(inputs, anomalies.length, confidence);
  const corrections = evaluateAutoCorrections(inputs, mode.mode);
  const escalated = autoEscalateStaleAlerts();

  log.info('Full system health evaluation', { status: snapshot.overallStatus, confidence: confidence.score, mode: mode.mode, corrections: corrections.length });

  return { snapshot, confidence, mode, corrections, anomalies, escalated };
}

// ── Section 8: Baseline Drift Detection ────────────────────

export interface BaselineSnapshot {
  timestamp: string;
  playbookWeights: Record<string, number>;
  trustDistribution: Record<string, number>; // e.g. { trusted: 60, limited: 30, experimental: 10 }
  outcomeRates: Record<string, number>;       // e.g. { winRate: 35, stageProgressionRate: 50 }
}

export interface DriftResult {
  field: string;
  baselineValue: number;
  currentValue: number;
  driftPercent: number;
  severity: 'none' | 'minor' | 'significant' | 'critical';
}

export interface DriftReport {
  baselineTimestamp: string;
  currentTimestamp: string;
  drifts: DriftResult[];
  overallDrift: number;
  alertTriggered: boolean;
}

const BASELINE_STORAGE_KEY = 'system-baseline-snapshots';
const MAX_BASELINES = 12; // ~3 months of weekly snapshots
const DRIFT_THRESHOLD_MINOR = 10;
const DRIFT_THRESHOLD_SIGNIFICANT = 25;
const DRIFT_THRESHOLD_CRITICAL = 40;

export function recordBaseline(snapshot: BaselineSnapshot): void {
  try {
    const baselines: BaselineSnapshot[] = JSON.parse(localStorage.getItem(BASELINE_STORAGE_KEY) || '[]');
    baselines.push(snapshot);
    if (baselines.length > MAX_BASELINES) baselines.splice(0, baselines.length - MAX_BASELINES);
    localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baselines));
  } catch {}
}

export function loadBaselines(): BaselineSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(BASELINE_STORAGE_KEY) || '[]');
  } catch { return []; }
}

function classifyDrift(pct: number): DriftResult['severity'] {
  if (pct >= DRIFT_THRESHOLD_CRITICAL) return 'critical';
  if (pct >= DRIFT_THRESHOLD_SIGNIFICANT) return 'significant';
  if (pct >= DRIFT_THRESHOLD_MINOR) return 'minor';
  return 'none';
}

export function computeDrift(baseline: BaselineSnapshot, current: BaselineSnapshot): DriftReport {
  const drifts: DriftResult[] = [];

  const allKeys = new Set([
    ...Object.keys(baseline.playbookWeights),
    ...Object.keys(current.playbookWeights),
    ...Object.keys(baseline.trustDistribution),
    ...Object.keys(current.trustDistribution),
    ...Object.keys(baseline.outcomeRates),
    ...Object.keys(current.outcomeRates),
  ]);

  const check = (field: string, bv: number | undefined, cv: number | undefined) => {
    const b = bv ?? 0;
    const c = cv ?? 0;
    const denom = Math.max(Math.abs(b), 1);
    const driftPct = Math.abs(c - b) / denom * 100;
    drifts.push({ field, baselineValue: b, currentValue: c, driftPercent: Math.round(driftPct), severity: classifyDrift(driftPct) });
  };

  for (const k of Object.keys(baseline.playbookWeights)) {
    check(`weight:${k}`, baseline.playbookWeights[k], current.playbookWeights[k]);
  }
  for (const k of Object.keys(baseline.trustDistribution)) {
    check(`trust:${k}`, baseline.trustDistribution[k], current.trustDistribution[k]);
  }
  for (const k of Object.keys(baseline.outcomeRates)) {
    check(`outcome:${k}`, baseline.outcomeRates[k], current.outcomeRates[k]);
  }

  const overallDrift = drifts.length > 0
    ? Math.round(drifts.reduce((s, d) => s + d.driftPercent, 0) / drifts.length)
    : 0;

  const alertTriggered = drifts.some(d => d.severity === 'significant' || d.severity === 'critical');

  return { baselineTimestamp: baseline.timestamp, currentTimestamp: current.timestamp, drifts, overallDrift, alertTriggered };
}

export function detectBaselineDrift(current: BaselineSnapshot): DriftReport | null {
  const baselines = loadBaselines();
  if (baselines.length === 0) return null;
  const latest = baselines[baselines.length - 1];
  const report = computeDrift(latest, current);

  if (report.alertTriggered) {
    const critDrifts = report.drifts.filter(d => d.severity === 'significant' || d.severity === 'critical');
    persistAlerts([{
      id: `drift-${Date.now()}`,
      severity: critDrifts.some(d => d.severity === 'critical') ? 'critical' : 'warning',
      category: 'system',
      message: `Baseline drift detected: ${critDrifts.map(d => d.field).join(', ')}`,
      metric: 'baseline_drift',
      currentValue: report.overallDrift,
      threshold: DRIFT_THRESHOLD_SIGNIFICANT,
      triggeredAt: new Date().toISOString(),
      acknowledged: false,
      state: 'active' as AlertState,
    }]);
  }

  return report;
}

// ── Section 9: Counterfactual Validation ───────────────────

export interface CounterfactualRecord {
  dealId: string;
  timestamp: string;
  chosenPlaybookId: string;
  alternativePlaybookIds: string[];
  chosenOutcome: 'positive' | 'negative' | 'neutral' | 'pending';
  alternativeEstimatedScores: Record<string, number>; // playbookId → estimated score
}

export interface RegretScore {
  dealId: string;
  chosenPlaybookId: string;
  chosenScore: number;
  bestAlternativeId: string;
  bestAlternativeScore: number;
  regret: number; // bestAlt - chosen (0 = no regret, >0 = missed opportunity)
}

const COUNTERFACTUAL_STORAGE_KEY = 'system-counterfactuals';
const MAX_COUNTERFACTUALS = 200;

export function recordCounterfactual(record: CounterfactualRecord): void {
  try {
    const records: CounterfactualRecord[] = JSON.parse(localStorage.getItem(COUNTERFACTUAL_STORAGE_KEY) || '[]');
    records.push(record);
    if (records.length > MAX_COUNTERFACTUALS) records.splice(0, records.length - MAX_COUNTERFACTUALS);
    localStorage.setItem(COUNTERFACTUAL_STORAGE_KEY, JSON.stringify(records));
  } catch {}
}

export function loadCounterfactuals(): CounterfactualRecord[] {
  try {
    return JSON.parse(localStorage.getItem(COUNTERFACTUAL_STORAGE_KEY) || '[]');
  } catch { return []; }
}

export function computeRegretScore(record: CounterfactualRecord): RegretScore {
  const outcomeScore = record.chosenOutcome === 'positive' ? 1 : record.chosenOutcome === 'negative' ? -1 : 0;
  const altEntries = Object.entries(record.alternativeEstimatedScores);
  let bestAltId = record.chosenPlaybookId;
  let bestAltScore = outcomeScore;

  for (const [pbId, score] of altEntries) {
    if (score > bestAltScore) {
      bestAltId = pbId;
      bestAltScore = score;
    }
  }

  return {
    dealId: record.dealId,
    chosenPlaybookId: record.chosenPlaybookId,
    chosenScore: outcomeScore,
    bestAlternativeId: bestAltId,
    bestAlternativeScore: bestAltScore,
    regret: Math.max(0, bestAltScore - outcomeScore),
  };
}

export function computeAggregateRegret(): { totalRegret: number; avgRegret: number; highRegretPlaybooks: string[]; count: number } {
  const records = loadCounterfactuals().filter(r => r.chosenOutcome !== 'pending');
  if (records.length === 0) return { totalRegret: 0, avgRegret: 0, highRegretPlaybooks: [], count: 0 };

  const regrets = records.map(computeRegretScore);
  const total = regrets.reduce((s, r) => s + r.regret, 0);
  const avg = total / regrets.length;

  // Find playbooks that frequently cause regret
  const regretByPlaybook: Record<string, number[]> = {};
  for (const r of regrets) {
    if (r.regret > 0) {
      (regretByPlaybook[r.chosenPlaybookId] ??= []).push(r.regret);
    }
  }

  const highRegretPlaybooks = Object.entries(regretByPlaybook)
    .filter(([, rs]) => rs.length >= 2 && rs.reduce((a, b) => a + b, 0) / rs.length > 0.3)
    .map(([id]) => id);

  return { totalRegret: total, avgRegret: avg, highRegretPlaybooks, count: records.length };
}

// ── Section 10: System Authority Guardrails ────────────────

export interface RolloutStage {
  strategyId: string;
  stage: 'canary' | 'partial' | 'full';
  percentage: number; // 10, 50, or 100
  startedAt: string;
  promotedAt?: string;
  metrics: { attempts: number; successes: number; failures: number };
}

const ROLLOUT_STORAGE_KEY = 'system-rollout-stages';
const PROTECTED_PLAYBOOK_KEY = 'system-protected-playbooks';

export function startRollout(strategyId: string): RolloutStage {
  const stage: RolloutStage = {
    strategyId,
    stage: 'canary',
    percentage: 10,
    startedAt: new Date().toISOString(),
    metrics: { attempts: 0, successes: 0, failures: 0 },
  };
  const rollouts = loadRollouts();
  rollouts[strategyId] = stage;
  saveRollouts(rollouts);
  return stage;
}

export function promoteRollout(strategyId: string): RolloutStage | null {
  const rollouts = loadRollouts();
  const stage = rollouts[strategyId];
  if (!stage) return null;

  const successRate = stage.metrics.attempts > 0 ? stage.metrics.successes / stage.metrics.attempts : 0;
  const minAttempts = stage.stage === 'canary' ? 3 : 5;

  if (stage.metrics.attempts < minAttempts || successRate < 0.5) return stage; // not ready

  if (stage.stage === 'canary') {
    stage.stage = 'partial';
    stage.percentage = 50;
    stage.promotedAt = new Date().toISOString();
  } else if (stage.stage === 'partial') {
    stage.stage = 'full';
    stage.percentage = 100;
    stage.promotedAt = new Date().toISOString();
  }

  rollouts[strategyId] = stage;
  saveRollouts(rollouts);
  return stage;
}

export function recordRolloutOutcome(strategyId: string, success: boolean): void {
  const rollouts = loadRollouts();
  const stage = rollouts[strategyId];
  if (!stage) return;
  stage.metrics.attempts++;
  if (success) stage.metrics.successes++;
  else stage.metrics.failures++;
  rollouts[strategyId] = stage;
  saveRollouts(rollouts);
}

export function getRolloutStage(strategyId: string): RolloutStage | null {
  return loadRollouts()[strategyId] ?? null;
}

export function shouldApplyStrategy(strategyId: string, seed: number): boolean {
  const stage = getRolloutStage(strategyId);
  if (!stage) return true; // no rollout = fully available
  return seed * 100 < stage.percentage;
}

function loadRollouts(): Record<string, RolloutStage> {
  try { return JSON.parse(localStorage.getItem(ROLLOUT_STORAGE_KEY) || '{}'); } catch { return {}; }
}

function saveRollouts(r: Record<string, RolloutStage>): void {
  try { localStorage.setItem(ROLLOUT_STORAGE_KEY, JSON.stringify(r)); } catch {}
}

// Protected playbooks
export function protectPlaybook(playbookId: string): void {
  const protected_ = loadProtectedPlaybooks();
  if (!protected_.includes(playbookId)) {
    protected_.push(playbookId);
    try { localStorage.setItem(PROTECTED_PLAYBOOK_KEY, JSON.stringify(protected_)); } catch {}
  }
}

export function unprotectPlaybook(playbookId: string): void {
  const protected_ = loadProtectedPlaybooks().filter(id => id !== playbookId);
  try { localStorage.setItem(PROTECTED_PLAYBOOK_KEY, JSON.stringify(protected_)); } catch {}
}

export function loadProtectedPlaybooks(): string[] {
  try { return JSON.parse(localStorage.getItem(PROTECTED_PLAYBOOK_KEY) || '[]'); } catch { return []; }
}

export function isPlaybookProtected(playbookId: string): boolean {
  return loadProtectedPlaybooks().includes(playbookId);
}

export function guardWeightChange(currentWeight: number, proposedWeight: number, maxChangePct: number = 0.10): number {
  const maxDelta = currentWeight * maxChangePct;
  const delta = proposedWeight - currentWeight;
  const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, delta));
  return currentWeight + clampedDelta;
}

// ── Section 11: Personal Performance Layer ─────────────────

export interface PersonalPerformanceRecord {
  playbookId: string;
  outcome: 'positive' | 'negative' | 'neutral';
  timestamp: string;
  dealStage?: string;
  hourOfDay?: number;
  dayOfWeek?: number;
}

export interface PersonalProfile {
  totalRecords: number;
  playbookWinRates: Record<string, { wins: number; total: number; rate: number }>;
  bestTimeOfDay: number | null;     // hour with highest win rate
  bestDayOfWeek: number | null;     // day with highest win rate
  topPlaybooks: string[];           // top 3 by win rate (min 3 attempts)
  conversionSignals: { signal: string; strength: number }[];
}

const PERSONAL_PERF_KEY = 'system-personal-performance';
const MAX_PERSONAL_RECORDS = 500;

export function recordPersonalOutcome(record: PersonalPerformanceRecord): void {
  try {
    const records: PersonalPerformanceRecord[] = JSON.parse(localStorage.getItem(PERSONAL_PERF_KEY) || '[]');
    records.push(record);
    if (records.length > MAX_PERSONAL_RECORDS) records.splice(0, records.length - MAX_PERSONAL_RECORDS);
    localStorage.setItem(PERSONAL_PERF_KEY, JSON.stringify(records));
  } catch {}
}

export function loadPersonalRecords(): PersonalPerformanceRecord[] {
  try { return JSON.parse(localStorage.getItem(PERSONAL_PERF_KEY) || '[]'); } catch { return []; }
}

export function computePersonalProfile(): PersonalProfile {
  const records = loadPersonalRecords();
  if (records.length === 0) {
    return { totalRecords: 0, playbookWinRates: {}, bestTimeOfDay: null, bestDayOfWeek: null, topPlaybooks: [], conversionSignals: [] };
  }

  // Playbook win rates
  const byPlaybook: Record<string, { wins: number; total: number }> = {};
  for (const r of records) {
    const entry = byPlaybook[r.playbookId] ??= { wins: 0, total: 0 };
    entry.total++;
    if (r.outcome === 'positive') entry.wins++;
  }
  const playbookWinRates: PersonalProfile['playbookWinRates'] = {};
  for (const [id, stats] of Object.entries(byPlaybook)) {
    playbookWinRates[id] = { ...stats, rate: stats.total > 0 ? stats.wins / stats.total : 0 };
  }

  // Top playbooks (min 3 attempts)
  const topPlaybooks = Object.entries(playbookWinRates)
    .filter(([, s]) => s.total >= 3)
    .sort((a, b) => b[1].rate - a[1].rate)
    .slice(0, 3)
    .map(([id]) => id);

  // Best time of day
  const hourBuckets: Record<number, { wins: number; total: number }> = {};
  for (const r of records) {
    if (r.hourOfDay != null) {
      const b = hourBuckets[r.hourOfDay] ??= { wins: 0, total: 0 };
      b.total++;
      if (r.outcome === 'positive') b.wins++;
    }
  }
  let bestTimeOfDay: number | null = null;
  let bestTimeRate = 0;
  for (const [hour, s] of Object.entries(hourBuckets)) {
    if (s.total >= 3) {
      const rate = s.wins / s.total;
      if (rate > bestTimeRate) { bestTimeRate = rate; bestTimeOfDay = Number(hour); }
    }
  }

  // Best day of week
  const dayBuckets: Record<number, { wins: number; total: number }> = {};
  for (const r of records) {
    if (r.dayOfWeek != null) {
      const b = dayBuckets[r.dayOfWeek] ??= { wins: 0, total: 0 };
      b.total++;
      if (r.outcome === 'positive') b.wins++;
    }
  }
  let bestDayOfWeek: number | null = null;
  let bestDayRate = 0;
  for (const [day, s] of Object.entries(dayBuckets)) {
    if (s.total >= 3) {
      const rate = s.wins / s.total;
      if (rate > bestDayRate) { bestDayRate = rate; bestDayOfWeek = Number(day); }
    }
  }

  // Conversion signals from stage data
  const stageBuckets: Record<string, { wins: number; total: number }> = {};
  for (const r of records) {
    if (r.dealStage) {
      const b = stageBuckets[r.dealStage] ??= { wins: 0, total: 0 };
      b.total++;
      if (r.outcome === 'positive') b.wins++;
    }
  }
  const conversionSignals = Object.entries(stageBuckets)
    .filter(([, s]) => s.total >= 2)
    .map(([signal, s]) => ({ signal, strength: s.wins / s.total }))
    .sort((a, b) => b.strength - a.strength);

  return { totalRecords: records.length, playbookWinRates, bestTimeOfDay, bestDayOfWeek, topPlaybooks, conversionSignals };
}

export function applyPersonalBoost(baseScore: number, playbookId: string, profile: PersonalProfile): number {
  const pbStats = profile.playbookWinRates[playbookId];
  if (!pbStats || pbStats.total < 3) return baseScore; // not enough data

  // Boost high-performing personal playbooks, penalize poor ones
  const avgRate = 0.5;
  const delta = (pbStats.rate - avgRate) * 15; // max ±7.5 boost
  return Math.max(0, Math.min(100, baseScore + delta));
}
