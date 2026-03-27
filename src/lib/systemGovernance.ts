/**
 * System Governance Layer
 *
 * Central control surface that unifies system state, confidence, alerts,
 * auto-correction, kill switches, and explainability into a single API.
 *
 * Feature-flagged via ENABLE_SYSTEM_OS.
 */

import { createLogger } from './logger';
import {
  evaluateFullSystemHealth,
  loadSystemMode,
  loadAlerts,
  loadSteeringBias,
  loadCorrectionLog,
  computeAlertResolutionStats,
  computeAggregateRegret,
  computePersonalProfile,
  detectBaselineDrift,
  type HealthInputs,
  type SystemMode,
  type SystemConfidence,
  type SystemAlert,
  type SteeringBias,
  type AutoCorrectionAction,
  type DriftReport,
  type SystemModeState,
  type HealthSnapshot,
  type DecisionExplanation,
} from './systemIntelligence';

const log = createLogger('SystemGovernance');

// ── Kill Switches ──────────────────────────────────────────

export interface KillSwitches {
  ENRICHMENT_ENABLED: boolean;
  RETRY_ENABLED: boolean;
  RECOMMENDATION_ENABLED: boolean;
  COACHING_ENABLED: boolean;
  AUTO_LEARNING_ENABLED: boolean;
}

const KILL_SWITCH_KEY = 'system-kill-switches';

const DEFAULT_SWITCHES: KillSwitches = {
  ENRICHMENT_ENABLED: true,
  RETRY_ENABLED: true,
  RECOMMENDATION_ENABLED: true,
  COACHING_ENABLED: true,
  AUTO_LEARNING_ENABLED: true,
};

export function loadKillSwitches(): KillSwitches {
  try {
    const stored = localStorage.getItem(KILL_SWITCH_KEY);
    if (stored) return { ...DEFAULT_SWITCHES, ...JSON.parse(stored) };
  } catch {}
  return { ...DEFAULT_SWITCHES };
}

export function saveKillSwitches(switches: KillSwitches): void {
  try {
    localStorage.setItem(KILL_SWITCH_KEY, JSON.stringify(switches));
    log.info('Kill switches updated', switches);
  } catch {}
}

export function toggleKillSwitch(key: keyof KillSwitches, value: boolean): KillSwitches {
  const switches = loadKillSwitches();
  switches[key] = value;
  saveKillSwitches(switches);
  return switches;
}

export function isEnabled(key: keyof KillSwitches): boolean {
  return loadKillSwitches()[key];
}

// ── System State ───────────────────────────────────────────

export interface SystemState {
  systemMode: SystemMode;
  systemConfidence: number;
  confidenceLabel: SystemConfidence['label'];
  activeAlerts: SystemAlert[];
  driftStatus: DriftReport | null;
  currentBiases: SteeringBias;
  activeGuardrails: string[];
  killSwitches: KillSwitches;
  modeState: SystemModeState;
  recentCorrections: AutoCorrectionAction[];
  timestamp: string;
}

export function getSystemState(healthInputs?: HealthInputs): SystemState {
  const switches = loadKillSwitches();
  const biases = loadSteeringBias();
  const alerts = loadAlerts().filter(a => a.state === 'active' || a.state === 'escalated');
  const modeState = loadSystemMode();
  const corrections = loadCorrectionLog().slice(-10);

  // Compute active guardrails
  const guardrails: string[] = [];
  if (!switches.ENRICHMENT_ENABLED) guardrails.push('Enrichment disabled');
  if (!switches.RETRY_ENABLED) guardrails.push('Retries disabled');
  if (!switches.RECOMMENDATION_ENABLED) guardrails.push('Recommendations disabled');
  if (!switches.COACHING_ENABLED) guardrails.push('Coaching disabled');
  if (!switches.AUTO_LEARNING_ENABLED) guardrails.push('Auto-learning disabled');
  if (modeState.mode === 'recovery') guardrails.push('Recovery mode active');
  if (modeState.mode === 'conservative') guardrails.push('Conservative mode active');

  let confidence: SystemConfidence = { score: 75, label: 'moderate', components: [], timestamp: new Date().toISOString() };
  let snapshot: HealthSnapshot | null = null;

  if (healthInputs) {
    const health = evaluateFullSystemHealth(healthInputs);
    confidence = health.confidence;
    snapshot = health.snapshot;
  }

  return {
    systemMode: modeState.mode,
    systemConfidence: confidence.score,
    confidenceLabel: confidence.label,
    activeAlerts: alerts,
    driftStatus: null, // computed on demand via checkDrift()
    currentBiases: biases,
    activeGuardrails: guardrails,
    killSwitches: switches,
    modeState,
    recentCorrections: corrections,
    timestamp: new Date().toISOString(),
  };
}

export function checkDrift(currentBaseline: {
  playbookWeights: Record<string, number>;
  trustDistribution: Record<string, number>;
  outcomeRates: Record<string, number>;
}): DriftReport | null {
  return detectBaselineDrift({
    timestamp: new Date().toISOString(),
    ...currentBaseline,
  });
}

// ── Auto-Correction Facade ─────────────────────────────────

export function applyAutoCorrections(healthInputs: HealthInputs): {
  corrections: AutoCorrectionAction[];
  modeChanged: boolean;
  newMode: SystemMode;
} {
  const before = loadSystemMode();
  const health = evaluateFullSystemHealth(healthInputs);
  const modeChanged = health.mode.mode !== before.mode;
  return {
    corrections: health.corrections,
    modeChanged,
    newMode: health.mode.mode,
  };
}

// ── System Summary (for Dave / UI) ─────────────────────────

export interface SystemSummary {
  health: 'healthy' | 'degraded' | 'critical';
  confidence: number;
  mode: SystemMode;
  activeAlertCount: number;
  criticalAlertCount: number;
  topIssue: string | null;
  recommendation: string;
}

export function getSystemSummary(healthInputs?: HealthInputs): SystemSummary {
  const state = getSystemState(healthInputs);
  const critAlerts = state.activeAlerts.filter(a => a.severity === 'critical');
  const topIssue = state.activeAlerts.length > 0 ? state.activeAlerts[0].message : null;

  let health: SystemSummary['health'] = 'healthy';
  if (state.systemConfidence < 55 || critAlerts.length > 0) health = 'critical';
  else if (state.systemConfidence < 75 || state.activeAlerts.length > 0) health = 'degraded';

  let recommendation = 'System operating normally. Continue execution.';
  if (health === 'critical') recommendation = 'System under stress. Review alerts and consider reducing activity.';
  else if (health === 'degraded') recommendation = 'Minor issues detected. Monitor and address warnings.';

  return {
    health,
    confidence: state.systemConfidence,
    mode: state.systemMode,
    activeAlertCount: state.activeAlerts.length,
    criticalAlertCount: critAlerts.length,
    topIssue,
    recommendation,
  };
}

// ── Audit / Telemetry ──────────────────────────────────────

export interface RecommendationAudit {
  systemRightRate: number;
  userOverrideImpact: number;
  topMisfires: string[];
  confidenceCalibration: number;
}

export function computeRecommendationAudit(): RecommendationAudit {
  const regret = computeAggregateRegret();
  const profile = computePersonalProfile();
  const alertStats = computeAlertResolutionStats();

  const systemRightRate = regret.count > 0
    ? Math.round((1 - regret.avgRegret) * 100)
    : 75; // default when no data

  // User override impact = how much user personal preferences deviate from system defaults
  const overrideImpact = profile.topPlaybooks.length > 0 ? 15 : 0;

  const confidenceCalibration = Math.min(100, Math.round(
    alertStats.totalResolved / Math.max(1, alertStats.totalResolved + alertStats.escalationRate * 10) * 100
  ));

  return {
    systemRightRate,
    userOverrideImpact: overrideImpact,
    topMisfires: regret.highRegretPlaybooks.slice(0, 5),
    confidenceCalibration,
  };
}
