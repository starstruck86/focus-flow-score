/**
 * System OS Tests
 *
 * Covers: systemGovernance, daveModeDetector, workflowOrchestrator, interventionGuard, featureFlags
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Feature Flags ──────────────────────────────────────────

import { loadFeatureFlags, setFeatureFlag, isSystemOSEnabled } from '@/lib/featureFlags';

describe('featureFlags', () => {
  beforeEach(() => localStorage.clear());

  it('defaults ENABLE_SYSTEM_OS to false (operator must opt-in via localStorage)', () => {
    expect(isSystemOSEnabled()).toBe(false);
  });

  it('sets and reads flags', () => {
    setFeatureFlag('ENABLE_SYSTEM_OS', true);
    expect(isSystemOSEnabled()).toBe(true);
    setFeatureFlag('ENABLE_SYSTEM_OS', false);
    expect(isSystemOSEnabled()).toBe(false);
  });
});

// ── Kill Switches ──────────────────────────────────────────

import { loadKillSwitches, toggleKillSwitch, isEnabled } from '@/lib/systemGovernance';

describe('killSwitches', () => {
  beforeEach(() => localStorage.clear());

  it('defaults all switches to true', () => {
    const s = loadKillSwitches();
    expect(s.ENRICHMENT_ENABLED).toBe(true);
    expect(s.COACHING_ENABLED).toBe(true);
    expect(s.RETRY_ENABLED).toBe(true);
  });

  it('toggles a switch', () => {
    toggleKillSwitch('ENRICHMENT_ENABLED', false);
    expect(isEnabled('ENRICHMENT_ENABLED')).toBe(false);
    toggleKillSwitch('ENRICHMENT_ENABLED', true);
    expect(isEnabled('ENRICHMENT_ENABLED')).toBe(true);
  });
});

// ── System State ───────────────────────────────────────────

import { getSystemState, getSystemSummary, computeRecommendationAudit } from '@/lib/systemGovernance';

describe('systemGovernance', () => {
  beforeEach(() => localStorage.clear());

  it('returns a system state with defaults', () => {
    const state = getSystemState();
    expect(state.systemMode).toBe('normal');
    expect(state.killSwitches.ENRICHMENT_ENABLED).toBe(true);
    expect(state.timestamp).toBeTruthy();
  });

  it('includes kill switch guardrails when disabled', () => {
    toggleKillSwitch('ENRICHMENT_ENABLED', false);
    const state = getSystemState();
    expect(state.activeGuardrails).toContain('Enrichment disabled');
  });

  it('returns system summary', () => {
    const summary = getSystemSummary();
    expect(summary.health).toBeTruthy();
    expect(summary.mode).toBe('normal');
    expect(typeof summary.confidence).toBe('number');
  });

  it('computes recommendation audit', () => {
    const audit = computeRecommendationAudit();
    expect(typeof audit.systemRightRate).toBe('number');
    expect(Array.isArray(audit.topMisfires)).toBe(true);
  });
});

// ── Dave Mode Detector ─────────────────────────────────────

import { detectDaveMode, buildDaveResponse, formatDaveResponseForDisplay } from '@/lib/daveModeDetector';

describe('daveModeDetector', () => {
  it('detects EXECUTE mode', () => {
    expect(detectDaveMode('what should i do next')).toBe('EXECUTE');
    expect(detectDaveMode('create a task for follow up')).toBe('EXECUTE');
  });

  it('detects PREP mode', () => {
    expect(detectDaveMode('prep me for my call with Acme')).toBe('PREP');
    expect(detectDaveMode('meeting brief for tomorrow')).toBe('PREP');
  });

  it('detects COACH mode', () => {
    expect(detectDaveMode('how can i improve my discovery calls')).toBe('COACH');
    expect(detectDaveMode('give me feedback on my last call')).toBe('COACH');
  });

  it('detects ROLEPLAY mode', () => {
    expect(detectDaveMode("let's practice objection handling")).toBe('ROLEPLAY');
    expect(detectDaveMode('start a roleplay scenario')).toBe('ROLEPLAY');
  });

  it('detects DIAGNOSE mode', () => {
    expect(detectDaveMode('system health check')).toBe('DIAGNOSE');
    expect(detectDaveMode("what's wrong with the pipeline")).toBe('DIAGNOSE');
  });

  it('detects RECOVERY via context', () => {
    expect(detectDaveMode('hello', { systemMode: 'recovery' })).toBe('RECOVERY');
  });

  it('overrides to ROLEPLAY when active', () => {
    expect(detectDaveMode('tell me about Acme', { isRoleplayActive: true })).toBe('ROLEPLAY');
  });

  it('defaults to EXECUTE for ambiguous input', () => {
    expect(detectDaveMode('hey dave')).toBe('EXECUTE');
  });

  it('builds a structured response', () => {
    const resp = buildDaveResponse({
      mode: 'EXECUTE',
      recommendation: 'Call Acme Corp',
      topFactors: ['High urgency', 'Close date tomorrow'],
      confidence: 85,
      nextAction: 'Dial Acme main line',
    });
    expect(resp.mode).toBe('EXECUTE');
    expect(resp.confidence).toBe(85);
    expect(resp.reasoning.confidenceDrivers).toContain('Strong signal coverage');
    expect(resp.nextAction).toBe('Dial Acme main line');
  });

  it('formats response for display', () => {
    const resp = buildDaveResponse({
      mode: 'PREP',
      recommendation: 'Research Acme Corp before your 2pm call',
      topFactors: ['Meeting in 2 hours'],
      nextAction: 'Open prep brief',
      confidence: 45,
    });
    const display = formatDaveResponseForDisplay(resp);
    expect(display).toContain('Research Acme Corp');
    expect(display).toContain('Low confidence');
  });
});

// ── Intervention Guard ─────────────────────────────────────

import { shouldSuppressIntervention, recordIntervention, getInterventionStats, clearInterventionLog } from '@/lib/interventionGuard';

describe('interventionGuard', () => {
  beforeEach(() => localStorage.clear());

  it('allows first intervention', () => {
    expect(shouldSuppressIntervention('major_nudge')).toBe(false);
  });

  it('suppresses after recording', () => {
    const now = Date.now();
    recordIntervention('major_nudge', undefined, now);
    expect(shouldSuppressIntervention('major_nudge', undefined, now + 1000)).toBe(true);
  });

  it('allows after cooldown expires', () => {
    const now = Date.now();
    recordIntervention('major_nudge', undefined, now);
    // 6h + 1ms later (matches tuned cooldown)
    expect(shouldSuppressIntervention('major_nudge', undefined, now + 6 * 3600 * 1000 + 1)).toBe(false);
  });

  it('suppresses low-confidence for eligible types', () => {
    expect(shouldSuppressIntervention('major_nudge', 30)).toBe(true);
    expect(shouldSuppressIntervention('pre_call_nudge', 30)).toBe(false);
  });

  it('tracks intervention stats', () => {
    recordIntervention('major_nudge');
    recordIntervention('coach_nudge');
    recordIntervention('coach_nudge');
    const stats = getInterventionStats();
    expect(stats['major_nudge']).toBe(1);
    expect(stats['coach_nudge']).toBe(2);
  });

  it('clears log', () => {
    recordIntervention('major_nudge');
    clearInterventionLog();
    expect(getInterventionStats()['major_nudge']).toBeUndefined();
  });
});

// ── Workflow Orchestrator ──────────────────────────────────

import { getExecutionContext, getPostActionPrompt } from '@/lib/workflowOrchestrator';

describe('workflowOrchestrator', () => {
  beforeEach(() => localStorage.clear());

  const mockDeals = [
    { id: 'd1', name: 'Acme Deal', accountName: 'Acme', urgency: 90, confidence: 80, nextAction: 'Call champion', stage: 'Negotiation', arrK: 50 },
    { id: 'd2', name: 'Beta Deal', accountName: 'Beta', urgency: 60, confidence: 70, nextAction: 'Send proposal', stage: 'Discovery', arrK: 30 },
    { id: 'd3', name: 'Gamma Deal', accountName: 'Gamma', urgency: 40, confidence: 50, nextAction: 'Research', stage: 'Prospecting', arrK: 10 },
    { id: 'd4', name: 'Delta Deal', accountName: 'Delta', urgency: 30, confidence: 40, nextAction: 'Follow up', stage: 'Qualification', arrK: 20 },
  ];

  const mockPlaybooks = [
    { id: 'pb1', title: 'Close Plan', problemType: 'closing', confidence: 85 },
    { id: 'pb2', title: 'Discovery Deep', problemType: 'discovery', confidence: 60 },
  ];

  it('returns top 3 deals sorted by urgency', () => {
    const ctx = getExecutionContext(mockDeals, mockPlaybooks, []);
    expect(ctx.topDeals.length).toBe(3);
    expect(ctx.topDeals[0].id).toBe('d1');
    expect(ctx.topDeals[2].id).toBe('d3');
  });

  it('sets next best action to top deal', () => {
    const ctx = getExecutionContext(mockDeals, mockPlaybooks, []);
    expect(ctx.nextBestAction?.dealId).toBe('d1');
    expect(ctx.nextBestAction?.urgency).toBe(90);
  });

  it('recommends top confidence playbook', () => {
    const ctx = getExecutionContext(mockDeals, mockPlaybooks, []);
    expect(ctx.recommendedPlaybook?.playbookId).toBe('pb1');
  });

  it('returns empty when recommendations disabled', () => {
    toggleKillSwitch('RECOMMENDATION_ENABLED', false);
    const ctx = getExecutionContext(mockDeals, mockPlaybooks, []);
    expect(ctx.topDeals.length).toBe(0);
    expect(ctx.nextBestAction).toBeNull();
    toggleKillSwitch('RECOMMENDATION_ENABLED', true);
  });

  it('caps risk signals at 5', () => {
    const signals = Array.from({ length: 10 }, (_, i) => ({
      type: 'stalled_deal' as const,
      message: `Risk ${i}`,
      severity: 'low' as const,
    }));
    const ctx = getExecutionContext([], [], signals);
    expect(ctx.riskSignals.length).toBe(5);
  });

  it('returns post-action prompts', () => {
    const prompt = getPostActionPrompt('call');
    expect(prompt?.type).toBe('reflection');
    expect(prompt?.actionLabel).toBe('Log Outcome');
  });

  it('suppresses repeated post-action prompts', () => {
    getPostActionPrompt('call');
    const second = getPostActionPrompt('call');
    expect(second).toBeNull(); // suppressed by cooldown
  });
});
