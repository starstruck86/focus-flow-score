/**
 * buildResolvedSopsPayload — Phase 2 unit coverage.
 *
 * Verifies the client-side resolver wrapper that produces the lightweight
 * metadata payload sent to `strategy-chat` for shadow logging.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// In-memory localStorage shim — same approach as resolveStrategySops tests.
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
import { buildResolvedSopsPayload } from '../buildResolvedSopsPayload';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

function enableEngine() {
  saveStrategyConfig({ ...getStrategyConfig(), enabled: true });
}

describe('buildResolvedSopsPayload — engine off', () => {
  it('returns null when nothing is enabled', () => {
    expect(buildResolvedSopsPayload({ workspace: 'work' })).toBeNull();
  });
});

describe('buildResolvedSopsPayload — Work surface', () => {
  it('returns global only when only global is enabled (Phase 2 acceptance)', () => {
    enableEngine();
    updateGlobalSop({ enabled: true, rawInstructions: 'g' });
    const p = buildResolvedSopsPayload({ workspace: 'work' });
    expect(p).not.toBeNull();
    expect(p!.mode).toBe('freeform');
    expect(p!.appliedSopIds).toEqual(['global']);
    expect(p!.enabledCount).toBe(1);
  });

  it('does not stack workspace SOP for the work surface', () => {
    enableEngine();
    updateGlobalSop({ enabled: true });
    updateWorkspaceSop('work', { enabled: true, rawInstructions: 'w' });
    const p = buildResolvedSopsPayload({ workspace: 'work' });
    expect(p!.appliedSopIds).toEqual(['global']);
  });
});

describe('buildResolvedSopsPayload — Brainstorm / Refine', () => {
  it('Brainstorm stacks global + brainstorm', () => {
    enableEngine();
    updateGlobalSop({ enabled: true });
    updateWorkspaceSop('brainstorm', { enabled: true, rawInstructions: 'b' });
    const p = buildResolvedSopsPayload({ workspace: 'brainstorm' });
    expect(p!.mode).toBe('workspace');
    expect(p!.appliedSopIds).toEqual(['global', 'workspace:brainstorm']);
    expect(p!.enabledCount).toBe(2);
  });

  it('Refine stacks global + refine', () => {
    enableEngine();
    updateGlobalSop({ enabled: true });
    updateWorkspaceSop('refine', { enabled: true });
    const p = buildResolvedSopsPayload({ workspace: 'refine' });
    expect(p!.appliedSopIds).toEqual(['global', 'workspace:refine']);
  });
});

describe('buildResolvedSopsPayload — Discovery Prep task', () => {
  it('stacks global + artifacts workspace + task SOP', () => {
    enableEngine();
    updateGlobalSop({ enabled: true });
    updateWorkspaceSop('artifacts', { enabled: true });
    updateTaskSop('discovery_prep', { enabled: true, rawInstructions: 'dp' });
    const p = buildResolvedSopsPayload({ taskType: 'discovery_prep' });
    expect(p!.mode).toBe('task');
    expect(p!.appliedSopIds).toEqual([
      'global',
      'workspace:artifacts',
      'task:discovery_prep',
    ]);
    expect(p!.enabledCount).toBe(3);
  });
});

describe('buildResolvedSopsPayload — input sanitisation', () => {
  it('ignores unknown workspace strings', () => {
    enableEngine();
    updateGlobalSop({ enabled: true });
    const p = buildResolvedSopsPayload({ workspace: 'not-a-workspace' as any });
    // Falls back to freeform → just global
    expect(p!.appliedSopIds).toEqual(['global']);
    expect(p!.mode).toBe('freeform');
  });

  it('ignores unknown taskType strings', () => {
    enableEngine();
    updateGlobalSop({ enabled: true });
    const p = buildResolvedSopsPayload({ taskType: 'mystery_task' as any });
    expect(p!.appliedSopIds).toEqual(['global']);
  });
});
