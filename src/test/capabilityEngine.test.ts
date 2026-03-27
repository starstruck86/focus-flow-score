import { describe, it, expect, beforeEach } from 'vitest';
import { getCapabilityPrompt, type CapabilityContext } from '@/lib/capabilityEngine';
import { recordCapabilityEvent, getCapabilityEventHistory, getCapabilityStats } from '@/lib/capabilityEvents';
import { setFeatureFlag } from '@/lib/featureFlags';
import { clearInterventionLog } from '@/lib/interventionGuard';

describe('capabilityEngine', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInterventionLog();
  });

  it('returns null when flag is disabled', () => {
    const ctx: CapabilityContext = { dealStage: 'proposal', dealName: 'Test Deal' };
    expect(getCapabilityPrompt(ctx)).toBeNull();
  });

  it('returns a best_practice prompt when flag is enabled and context matches', () => {
    setFeatureFlag('ENABLE_CAPABILITY_AWARENESS', true);
    const ctx: CapabilityContext = { dealStage: 'proposal', dealName: 'Acme Deal', dealRisk: 'high' };
    const prompt = getCapabilityPrompt(ctx);
    expect(prompt).not.toBeNull();
    expect(prompt!.type).toBe('best_practice');
    expect(prompt!.confidence).toBeGreaterThanOrEqual(40);
  });

  it('returns null when no context signals are present', () => {
    setFeatureFlag('ENABLE_CAPABILITY_AWARENESS', true);
    const ctx: CapabilityContext = {};
    const prompt = getCapabilityPrompt(ctx);
    // With no stage, no playbook, no risk — should be null
    expect(prompt).toBeNull();
  });

  it('returns at most one prompt', () => {
    setFeatureFlag('ENABLE_CAPABILITY_AWARENESS', true);
    const ctx: CapabilityContext = {
      dealStage: 'proposal',
      dealName: 'Big Deal',
      dealRisk: 'high',
      recommendedPlaybookTitle: 'Objection Handling',
      recommendedPlaybookType: 'objection',
    };
    const prompt = getCapabilityPrompt(ctx);
    // It should return exactly one or null, never an array
    expect(prompt === null || typeof prompt.id === 'string').toBe(true);
  });

  it('suppresses after max ignores', () => {
    setFeatureFlag('ENABLE_CAPABILITY_AWARENESS', true);
    const ctx: CapabilityContext = { dealStage: 'proposal', dealName: 'Test', dealRisk: 'high' };

    // Get prompt to find its ID
    const prompt = getCapabilityPrompt(ctx);
    if (!prompt) return; // skip if no prompt generated

    // Record 3 ignores
    for (let i = 0; i < 3; i++) {
      recordCapabilityEvent({ promptId: prompt.suppressionKey, eventType: 'ignored' });
    }

    // Clear intervention log so it's not suppressed by cooldown
    clearInterventionLog();
    
    const after = getCapabilityPrompt(ctx);
    // Should be suppressed or return a different prompt
    expect(after === null || after.id !== prompt.id).toBe(true);
  });
});

describe('capabilityEvents', () => {
  beforeEach(() => localStorage.clear());

  it('records and retrieves events', () => {
    recordCapabilityEvent({ promptId: 'test-1', eventType: 'shown', stage: 'proposal' });
    recordCapabilityEvent({ promptId: 'test-1', eventType: 'accepted', stage: 'proposal' });

    const history = getCapabilityEventHistory();
    expect(history.length).toBe(2);
    expect(history[0].eventType).toBe('shown');
    expect(history[1].eventType).toBe('accepted');
  });

  it('computes correct stats', () => {
    recordCapabilityEvent({ promptId: 'a', eventType: 'shown' });
    recordCapabilityEvent({ promptId: 'a', eventType: 'accepted' });
    recordCapabilityEvent({ promptId: 'b', eventType: 'shown' });
    recordCapabilityEvent({ promptId: 'b', eventType: 'ignored' });

    const stats = getCapabilityStats();
    expect(stats.shown).toBe(2);
    expect(stats.accepted).toBe(1);
    expect(stats.ignored).toBe(1);
    expect(stats.acceptRate).toBe(0.5);
  });
});
