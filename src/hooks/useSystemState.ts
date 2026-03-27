/**
 * Live system state hook — polls localStorage-backed state every N seconds
 * so governance/telemetry surfaces stay current without manual refresh.
 */

import { useState, useEffect, useCallback } from 'react';
import { getSystemState, getSystemSummary, loadKillSwitches, computeRecommendationAudit, type SystemState, type SystemSummary, type KillSwitches, type RecommendationAudit } from '@/lib/systemGovernance';
import {
  loadSystemMode, loadAlerts, loadCorrectionLog, loadHealthHistory,
  computeSystemConfidence, computePersonalProfile, computeAggregateRegret,
  type SystemModeState, type SystemAlert, type AutoCorrectionAction,
  type HealthSnapshot, type SystemConfidence, type HealthInputs,
  type PersonalProfile,
} from '@/lib/systemIntelligence';

const POLL_MS = 5_000;

/** Returns system state that auto-refreshes every 5 s */
export function useLiveSystemState(): SystemState {
  const [state, setState] = useState(() => getSystemState());

  useEffect(() => {
    const id = setInterval(() => setState(getSystemState()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  return state;
}

/** Returns system summary that auto-refreshes */
export function useLiveSystemSummary(): SystemSummary {
  const [summary, setSummary] = useState(() => getSystemSummary());

  useEffect(() => {
    const id = setInterval(() => setSummary(getSystemSummary()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  return summary;
}

/** Returns kill switches that auto-refresh */
export function useLiveKillSwitches(): [KillSwitches, (updated: KillSwitches) => void] {
  const [switches, setSwitches] = useState(() => loadKillSwitches());

  useEffect(() => {
    const id = setInterval(() => setSwitches(loadKillSwitches()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const setAndPersist = useCallback((updated: KillSwitches) => {
    setSwitches(updated);
  }, []);

  return [switches, setAndPersist];
}

/** Telemetry-specific: mode, confidence, alerts, corrections, health history */
export function useLiveTelemetry() {
  const [data, setData] = useState(() => computeTelemetry());

  useEffect(() => {
    const id = setInterval(() => setData(computeTelemetry()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  return data;
}

function computeTelemetry() {
  const DEFAULT_INPUTS: HealthInputs = {
    enrichmentSuccessRate: 85,
    enrichmentFailureRate: 15,
    playbookRegenerationCount: 2,
    trustDegradationCount: 1,
    outcomeScoreTrend: 5,
    explorationWinRate: 30,
    exploitationWinRate: 40,
    daveFailureRate: 5,
    daveRetryRate: 3,
    singlePlaybookConcentration: 25,
  };

  return {
    summary: getSystemSummary(),
    modeState: loadSystemMode(),
    confidence: computeSystemConfidence(DEFAULT_INPUTS, 0),
    alerts: loadAlerts().filter(a => a.state === 'active' || a.state === 'escalated').slice(0, 10),
    corrections: loadCorrectionLog().slice(-5),
    healthHistory: loadHealthHistory().slice(-10),
  };
}

/** Personal profile + regret — auto-refreshes */
export function useLivePersonalProfile(): { profile: PersonalProfile; regret: ReturnType<typeof computeAggregateRegret> } {
  const [data, setData] = useState(() => ({
    profile: computePersonalProfile(),
    regret: computeAggregateRegret(),
  }));

  useEffect(() => {
    const id = setInterval(() => setData({
      profile: computePersonalProfile(),
      regret: computeAggregateRegret(),
    }), POLL_MS);
    return () => clearInterval(id);
  }, []);

  return data;
}

/** Recommendation audit — auto-refreshes */
export function useLiveRecommendationAudit(): RecommendationAudit {
  const [audit, setAudit] = useState(() => computeRecommendationAudit());

  useEffect(() => {
    const id = setInterval(() => setAudit(computeRecommendationAudit()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  return audit;
}
