/**
 * resolveStrategySops — Phase 1 unit coverage.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveStrategyConfig,
  getStrategyConfig,
  updateGlobalSop,
  updateWorkspaceSop,
  updateTaskSop,
} from '../strategyConfig';
import { resolveStrategySops } from '../resolveStrategySops';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

function enableEngine() {
  saveStrategyConfig({ ...getStrategyConfig(), enabled: true });
}

describe('resolveStrategySops — engine off', () => {
  it('returns nothing when the global engine is disabled', () => {
    updateGlobalSop({ enabled: true, rawInstructions: 'be sharp' });
    const r = resolveStrategySops({ workspace: 'brainstorm' });
    expect(r.globalSop).toBeNull();
    expect(r.workspaceSop).toBeNull();
    expect(r.taskSop).toBeNull();
    expect(r.enabledCount).toBe(0);
  });
});

describe('resolveStrategySops — freeform chat', () => {
  it('returns global only', () => {
    enableEngine();
    updateGlobalSop({ enabled: true, rawInstructions: 'global' });
    updateWorkspaceSop('brainstorm', { enabled: true, rawInstructions: 'brain' });

    const r = resolveStrategySops({ workspace: null });
    expect(r.mode).toBe('freeform');
    expect(r.globalSop?.rawInstructions).toBe('global');
    expect(r.workspaceSop).toBeNull();
    expect(r.taskSop).toBeNull();
    expect(r.appliedSopIds).toEqual(['global']);
  });

  it("treats the 'work' surface as free-form", () => {
    enableEngine();
    updateGlobalSop({ enabled: true });
    updateWorkspaceSop('work', { enabled: true });
    const r = resolveStrategySops({ workspace: 'work' });
    expect(r.mode).toBe('freeform');
    expect(r.workspaceSop).toBeNull();
  });
});

describe('resolveStrategySops — workspace mode', () => {
  it('stacks global + workspace SOP for brainstorm', () => {
    enableEngine();
    updateGlobalSop({ enabled: true });
    updateWorkspaceSop('brainstorm', { enabled: true, rawInstructions: 'b' });
    const r = resolveStrategySops({ workspace: 'brainstorm' });
    expect(r.mode).toBe('workspace');
    expect(r.globalSop).not.toBeNull();
    expect(r.workspaceSop?.rawInstructions).toBe('b');
    expect(r.appliedSopIds).toEqual(['global', 'workspace:brainstorm']);
  });

  it('skips disabled workspace SOPs', () => {
    enableEngine();
    updateWorkspaceSop('refine', { enabled: false, rawInstructions: 'r' });
    const r = resolveStrategySops({ workspace: 'refine' });
    expect(r.workspaceSop).toBeNull();
  });
});

describe('resolveStrategySops — task mode', () => {
  it('Discovery Prep stacks global + artifacts workspace + task SOP', () => {
    enableEngine();
    updateGlobalSop({ enabled: true });
    updateWorkspaceSop('artifacts', { enabled: true });
    updateTaskSop('discovery_prep', { enabled: true, rawInstructions: 'dp' });
    const r = resolveStrategySops({ taskType: 'discovery_prep' });
    expect(r.mode).toBe('task');
    expect(r.appliedSopIds).toEqual([
      'global',
      'workspace:artifacts',
      'task:discovery_prep',
    ]);
    expect(r.taskSop?.rawInstructions).toBe('dp');
  });

  it('returns task SOP without artifacts when artifacts SOP is disabled', () => {
    enableEngine();
    updateTaskSop('deal_review', { enabled: true });
    const r = resolveStrategySops({ taskType: 'deal_review' });
    expect(r.workspaceSop).toBeNull();
    expect(r.taskSop?.enabled).toBe(true);
    expect(r.appliedSopIds).toEqual(['task:deal_review']);
  });
});
