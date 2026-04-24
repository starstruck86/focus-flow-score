/**
 * strategyConfig — defaults, persistence roundtrip, parser, subscribe.
 *
 * Phase 1 unit coverage. Uses jsdom localStorage (vitest default).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  defaultStrategyConfig,
  getStrategyConfig,
  saveStrategyConfig,
  updateStrategyGlobalInstructions,
  updateLibraryBehavior,
  updateDiscoveryPrepSop,
  reparseDiscoveryPrepSop,
  parseDiscoveryPrepSop,
  isDiscoveryPrepSopEnabled,
  subscribeStrategyConfig,
} from '../strategyConfig';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

describe('strategyConfig — defaults', () => {
  it('returns OFF by default with seeded SOP parsed', () => {
    const cfg = defaultStrategyConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.strictMode).toBe(false);
    expect(cfg.selfCorrectOnce).toBe(false);
    expect(cfg.sopContracts.discoveryPrepFullMode.enabled).toBe(false);
    // Seeded SOP parses out non-negotiables and required inputs.
    expect(cfg.sopContracts.discoveryPrepFullMode.nonNegotiables.length).toBeGreaterThan(0);
    expect(cfg.sopContracts.discoveryPrepFullMode.requiredInputs.length).toBeGreaterThan(0);
  });
});

describe('strategyConfig — persistence', () => {
  it('persists global instructions across reads', () => {
    updateStrategyGlobalInstructions('Be direct. Cite sources.');
    expect(getStrategyConfig().globalInstructions).toBe('Be direct. Cite sources.');
  });

  it('persists library behavior toggles', () => {
    updateLibraryBehavior({ neverInventMetrics: false });
    expect(getStrategyConfig().libraryBehavior.neverInventMetrics).toBe(false);
  });

  it('persists Discovery Prep SOP enable + raw text', () => {
    updateDiscoveryPrepSop({ enabled: true, rawSop: 'NON-NEGOTIABLES\n- one\n- two' });
    const sop = getStrategyConfig().sopContracts.discoveryPrepFullMode;
    expect(sop.enabled).toBe(true);
    expect(sop.rawSop).toContain('one');
  });

  it('isDiscoveryPrepSopEnabled requires both engine + SOP enabled', () => {
    updateDiscoveryPrepSop({ enabled: true });
    expect(isDiscoveryPrepSopEnabled()).toBe(false); // engine still OFF
    saveStrategyConfig({ ...getStrategyConfig(), enabled: true });
    expect(isDiscoveryPrepSopEnabled()).toBe(true);
  });
});

describe('strategyConfig — parser', () => {
  it('parses headings and strips bullets / numbering', () => {
    const raw = `
NON-NEGOTIABLES
- alpha
* beta
• gamma

REQUIRED INPUTS:
1. company
2) website

BUILD ORDER
- step one
- step two
`;
    const out = parseDiscoveryPrepSop(raw);
    expect(out.nonNegotiables).toEqual(['alpha', 'beta', 'gamma']);
    expect(out.requiredInputs).toEqual(['company', 'website']);
    expect(out.buildOrder).toEqual(['step one', 'step two']);
  });

  it('ignores unknown sections without throwing', () => {
    const out = parseDiscoveryPrepSop('RANDOM HEADING\n- ignore me');
    expect(out.nonNegotiables).toEqual([]);
  });

  it('reparseDiscoveryPrepSop refreshes the structured contract', () => {
    updateDiscoveryPrepSop({
      rawSop: 'MANDATORY CHECKS\n- subscription model stated',
    });
    const updated = reparseDiscoveryPrepSop();
    expect(updated.mandatoryChecks).toContain('subscription model stated');
    expect(updated.parsedAt).toBeTruthy();
  });
});

describe('strategyConfig — subscribe', () => {
  it('notifies listeners on save', () => {
    let received = '';
    const unsub = subscribeStrategyConfig((next) => {
      received = next.globalInstructions;
    });
    updateStrategyGlobalInstructions('hello');
    expect(received).toBe('hello');
    unsub();
  });

  it('stops notifying after unsubscribe', () => {
    let calls = 0;
    const unsub = subscribeStrategyConfig(() => {
      calls += 1;
    });
    updateStrategyGlobalInstructions('one');
    unsub();
    updateStrategyGlobalInstructions('two');
    expect(calls).toBe(1);
  });
});
