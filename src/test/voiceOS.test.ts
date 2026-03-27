import { describe, it, expect, beforeEach } from 'vitest';
import { classifyVoiceIntent } from '@/lib/voiceIntent';
import { classifyAndDetect } from '@/lib/daveModeDetector';
import { getConfirmationPolicy } from '@/lib/voiceConfirmation';
import { resolveContextReference, type VoiceOperatingContext } from '@/lib/voiceContext';
import { parseChainedWorkflow, advanceChain } from '@/lib/voiceWorkflows';
import { handleVoiceMetaIntent, setVoiceVerbosity, getVoiceVerbosity } from '@/lib/voiceResponse';
import { recordWorkflow, getAcceptanceMetrics, classifyWorkflow } from '@/lib/acceptanceHarness';
import { logRecommendation, markAccepted, markDismissed, getLedgerMetrics } from '@/lib/recommendationLedger';
import { recordFriction, getFrictionSummary } from '@/lib/frictionSignals';
import { shouldSuppressByContext } from '@/lib/interventionGuard';
import { buildWhyNow, formatWhyNowForVoice } from '@/lib/whyNow';

// ── Helpers ──────────────────────────────────────────────

function emptyVoiceCtx(): VoiceOperatingContext {
  return {
    currentDeal: null, currentPlaybook: null, currentTask: null,
    lastRoleplay: null, pendingAction: null, currentAccount: null,
    lastResponse: null, chainedWorkflow: null, updatedAt: Date.now(),
  };
}

beforeEach(() => {
  localStorage.clear();
});

// ── SECTION 1: Intent Routing ──────────────────────────

describe('voiceOS intent routing', () => {
  it('classifies "walk me through my day" as act', () => {
    const r = classifyVoiceIntent('walk me through my day');
    expect(r.intent).toBe('act');
    expect(r.suggestedRoute).toBe('daily_game_plan');
  });

  it('classifies "prep me for my Acme call" as act with prep route', () => {
    const r = classifyVoiceIntent('prep me for my Acme call');
    expect(r.intent).toBe('act');
    expect(r.suggestedRoute).toBe('prep_meeting');
  });

  it('classifies "start a roleplay" as act with roleplay route', () => {
    const r = classifyVoiceIntent('start a roleplay with a skeptical CFO');
    expect(r.intent).toBe('act');
    expect(r.suggestedRoute).toBe('start_roleplay');
  });

  it('classifies "explain this recommendation" as explain', () => {
    const r = classifyVoiceIntent('explain this recommendation');
    expect(r.intent).toBe('explain');
    expect(r.suggestedRoute).toBe('explain');
  });

  it('classifies "log that they pushed pricing" as act with log route', () => {
    const r = classifyVoiceIntent('log that they pushed pricing');
    expect(r.intent).toBe('act');
    expect(r.suggestedRoute).toBe('log_touch');
  });

  it('classifyAndDetect overrides mode when voice confidence is high', () => {
    const r = classifyAndDetect('explain why this recommendation', {});
    expect(r.daveMode).toBe('COACH');
  });

  it('detects meta-intents', () => {
    expect(classifyVoiceIntent('shorter').meta).toBe('shorter');
    expect(classifyVoiceIntent('repeat that').meta).toBe('repeat');
    expect(classifyVoiceIntent('stop').meta).toBe('stop');
    expect(classifyVoiceIntent('keep going').meta).toBe('continue');
  });
});

// ── SECTION 2: Context Resolution ──────────────────────

describe('voiceOS context resolution', () => {
  it('resolves "practice it" to last roleplay', () => {
    const ctx = emptyVoiceCtx();
    ctx.lastRoleplay = { callType: 'discovery', difficulty: 5 };
    const r = resolveContextReference('practice it', ctx);
    expect(r).toEqual({ call_type: 'discovery', difficulty: '5' });
  });

  it('resolves "log that" to current deal', () => {
    const ctx = emptyVoiceCtx();
    ctx.currentDeal = { id: 'd1', name: 'Acme', accountName: 'Acme Corp' };
    const r = resolveContextReference('log that', ctx);
    expect(r).toEqual({ accountName: 'Acme Corp', dealName: 'Acme' });
  });

  it('resolves "use that" to current playbook', () => {
    const ctx = emptyVoiceCtx();
    ctx.currentPlaybook = { id: 'p1', title: 'Discovery' };
    const r = resolveContextReference('use that', ctx);
    expect(r).toEqual({ playbookId: 'p1', playbookTitle: 'Discovery' });
  });

  it('returns null when no context', () => {
    expect(resolveContextReference('practice it', emptyVoiceCtx())).toBeNull();
  });

  it('resolves "do that again" to last roleplay', () => {
    const ctx = emptyVoiceCtx();
    ctx.lastRoleplay = { callType: 'negotiation', difficulty: 7 };
    const r = resolveContextReference('do that again', ctx);
    expect(r).toEqual({ call_type: 'negotiation', difficulty: '7' });
  });

  it('resolves "send that" to current playbook', () => {
    const ctx = emptyVoiceCtx();
    ctx.currentPlaybook = { id: 'p2', title: 'Objection Handling' };
    const r = resolveContextReference('send that', ctx);
    expect(r).toEqual({ playbookId: 'p2', playbookTitle: 'Objection Handling' });
  });

  it('resolves "that deal" same as "this deal"', () => {
    const ctx = emptyVoiceCtx();
    ctx.currentDeal = { id: 'd2', name: 'Globex', accountName: 'Globex Inc' };
    const r = resolveContextReference('that deal', ctx);
    expect(r).toEqual({ dealId: 'd2', dealName: 'Globex', accountName: 'Globex Inc' });
  });

  it('resolves "prep for it" to current deal', () => {
    const ctx = emptyVoiceCtx();
    ctx.currentDeal = { id: 'd3', name: 'Initech', accountName: 'Initech LLC' };
    const r = resolveContextReference('prep me for it', ctx);
    expect(r).toEqual({ accountName: 'Initech LLC' });
  });
});

// ── SECTION 3: Confirmation Policy ─────────────────────

describe('voiceOS confirmation policy', () => {
  it('no confirmation for read-only tools', () => {
    expect(getConfirmationPolicy('query_opportunities').level).toBe('none');
    expect(getConfirmationPolicy('prep_meeting').level).toBe('none');
    expect(getConfirmationPolicy('start_roleplay').level).toBe('none');
  });

  it('light confirmation for write-light tools', () => {
    expect(getConfirmationPolicy('log_touch').level).toBe('light');
    expect(getConfirmationPolicy('create_task').level).toBe('light');
    expect(getConfirmationPolicy('generate_content').level).toBe('light');
  });

  it('strong confirmation for destructive tools', () => {
    expect(getConfirmationPolicy('update_account').level).toBe('strong');
    expect(getConfirmationPolicy('kill_switch').level).toBe('strong');
    expect(getConfirmationPolicy('move_deal').level).toBe('strong');
  });

  it('defaults unknown tools to light', () => {
    expect(getConfirmationPolicy('unknown_tool_xyz').level).toBe('light');
  });
});

// ── SECTION 4: Chained Workflows ───────────────────────

describe('voiceOS chained workflows', () => {
  it('parses "prep for call then roleplay the CFO"', () => {
    const chain = parseChainedWorkflow('prep me for my call then roleplay the CFO');
    expect(chain).not.toBeNull();
    expect(chain!.steps.length).toBe(2);
    expect(chain!.steps[0].action).toBe('prep_meeting');
    expect(chain!.steps[1].action).toBe('start_roleplay');
  });

  it('returns null for single commands', () => {
    expect(parseChainedWorkflow('prep me for my call')).toBeNull();
  });

  it('advances chain correctly', () => {
    parseChainedWorkflow('prep me for call then roleplay the CFO');
    const next = advanceChain();
    expect(next).not.toBeNull();
    expect(next!.action).toBe('start_roleplay');
    const done = advanceChain();
    expect(done).toBeNull();
  });
});

// ── SECTION 5: Meta-intent handling ────────────────────

describe('voiceOS meta-intents', () => {
  it('shorter sets concise verbosity', () => {
    setVoiceVerbosity('normal');
    handleVoiceMetaIntent('shorter');
    expect(getVoiceVerbosity()).toBe('concise');
  });

  it('more-detail sets detailed verbosity', () => {
    handleVoiceMetaIntent('more-detail');
    expect(getVoiceVerbosity()).toBe('detailed');
  });

  it('stop returns acknowledgment', () => {
    expect(handleVoiceMetaIntent('stop')).toBe('Okay, stopping.');
  });

  it('pause returns acknowledgment', () => {
    expect(handleVoiceMetaIntent('pause')).toContain('Paused');
  });
});

// ── SECTION 6: Acceptance Harness ──────────────────────

describe('acceptance harness', () => {
  it('classifies workflows correctly', () => {
    expect(classifyWorkflow('walk me through my day')).toBe('daily_walkthrough');
    expect(classifyWorkflow('prep me for my call')).toBe('call_prep');
    expect(classifyWorkflow('start a roleplay')).toBe('roleplay');
    expect(classifyWorkflow('random question')).toBe('generic');
  });

  it('records and reports metrics', () => {
    recordWorkflow({ workflowType: 'call_prep', success: true, latencyMs: 500, userAccepted: true, userAbandoned: false, timestamp: Date.now() });
    recordWorkflow({ workflowType: 'call_prep', success: false, latencyMs: 2000, userAccepted: false, userAbandoned: true, failureReason: 'timeout', timestamp: Date.now() });
    const m = getAcceptanceMetrics();
    expect(m.totalWorkflows).toBe(2);
    expect(m.successRate).toBe(0.5);
    expect(m.abandonmentRate).toBe(0.5);
    expect(m.failureTypes['timeout']).toBe(1);
    expect(m.byType['call_prep'].count).toBe(2);
  });
});

// ── SECTION 7: Recommendation Ledger ───────────────────

describe('recommendation ledger', () => {
  it('logs and retrieves metrics', () => {
    const id1 = logRecommendation({ reason: 'high risk', confidence: 80 });
    markAccepted(id1);
    const id2 = logRecommendation({ reason: 'low urgency', confidence: 40 });
    markDismissed(id2);
    const m = getLedgerMetrics();
    expect(m.totalEntries).toBe(2);
    expect(m.ignoredHighConfidenceRate).toBe(0);
  });
});

// ── SECTION 8: Friction Signals ────────────────────────

describe('friction signals', () => {
  it('records and aggregates friction', () => {
    recordFriction('ignored_recommendation', 'prep_hub');
    recordFriction('ignored_recommendation', 'prep_hub');
    recordFriction('ignored_recommendation', 'prep_hub');
    const summary = getFrictionSummary();
    expect(summary.totalFriction).toBe(3);
    expect(summary.topFrictionType).toBe('ignored_recommendation');
    expect(summary.shouldReduceNudges).toBe(true);
  });

  it('tracks severity escalation', () => {
    for (let i = 0; i < 5; i++) recordFriction('rapid_dismiss', 'coach');
    const summary = getFrictionSummary();
    const rapid = summary.signals.find(s => s.frictionType === 'rapid_dismiss');
    expect(rapid!.severity).toBe('high');
    expect(summary.shouldReduceNudges).toBe(true);
  });
});

// ── SECTION 9: Smart Suppression ───────────────────────

describe('smart suppression', () => {
  it('suppresses non-critical during call', () => {
    expect(shouldSuppressByContext({ onCall: true }, 'coach_nudge')).toBe(true);
    expect(shouldSuppressByContext({ onCall: true }, 'risk_alert')).toBe(false);
  });

  it('suppresses coaching during focus block', () => {
    expect(shouldSuppressByContext({ focusBlock: true }, 'coach_nudge')).toBe(true);
    expect(shouldSuppressByContext({ focusBlock: true }, 'risk_alert')).toBe(false);
  });

  it('suppresses all non-critical after hours', () => {
    expect(shouldSuppressByContext({ afterHours: true }, 'major_nudge')).toBe(true);
    expect(shouldSuppressByContext({ afterHours: true }, 'risk_alert')).toBe(false);
  });

  it('suppresses verbose on mobile', () => {
    expect(shouldSuppressByContext({ isMobile: true }, 'playbook_suggestion')).toBe(true);
    expect(shouldSuppressByContext({ isMobile: true }, 'risk_alert')).toBe(false);
  });

  it('degraded mode only allows critical', () => {
    expect(shouldSuppressByContext({ degradedMode: true }, 'coach_nudge')).toBe(true);
    expect(shouldSuppressByContext({ degradedMode: true }, 'risk_alert')).toBe(false);
    expect(shouldSuppressByContext({ degradedMode: true }, 'major_nudge')).toBe(false);
  });
});

// ── SECTION 10: WhyNow Thread ──────────────────────────

describe('whyNow thread', () => {
  it('builds with close-date urgency', () => {
    const thread = buildWhyNow({
      recommendation: 'Send proposal',
      dealName: 'Acme',
      daysUntilClose: 5,
      confidence: 85,
    });
    expect(thread.whyNow).toContain('5 days');
    expect(thread.consequenceIfIgnored).toContain('slip');
    expect(thread.confidence).toBe(85);
  });

  it('builds with risk urgency', () => {
    const thread = buildWhyNow({
      recommendation: 'Re-engage champion',
      dealName: 'Globex',
      riskLevel: 'high',
      confidence: 60,
    });
    expect(thread.whyNow).toContain('high');
  });

  it('formats for voice concisely', () => {
    const thread = buildWhyNow({ recommendation: 'Call Acme', confidence: 70 });
    const voice = formatWhyNowForVoice(thread);
    expect(voice.length).toBeLessThan(200);
  });
});
