/**
 * resolveStrategySops — Phase 1 unit coverage.
 *
 * Runs under either jsdom or node — provides an in-memory localStorage shim
 * so the suite is environment-agnostic and not blocked by jsdom/canvas
 * native-binding issues in the sandbox.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// Minimal localStorage + window shim so strategyConfig can persist between
// calls regardless of the active vitest environment.
type Store = Map<string, string>;
function installStorageShim() {
  const store: Store = new Map();
  const storage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  (globalThis as any).window = (globalThis as any).window ?? { addEventListener: () => {} };
  (globalThis as any).window.localStorage = storage;
  (globalThis as any).localStorage = storage;
}
installStorageShim();

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

  it('stacks global + refine when entering Refine workspace', () => {
    enableEngine();
    updateGlobalSop({ enabled: true });
    updateWorkspaceSop('refine', { enabled: true, rawInstructions: 'r' });
    const r = resolveStrategySops({ workspace: 'refine' });
    expect(r.mode).toBe('workspace');
    expect(r.appliedSopIds).toEqual(['global', 'workspace:refine']);
    expect(r.enabledCount).toBe(2);
  });

  it('Work surface returns global only even with work workspace SOP enabled', () => {
    enableEngine();
    updateGlobalSop({ enabled: true });
    updateWorkspaceSop('work', { enabled: true });
    const r = resolveStrategySops({ workspace: 'work' });
    expect(r.mode).toBe('freeform');
    expect(r.workspaceSop).toBeNull();
    expect(r.appliedSopIds).toEqual(['global']);
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
