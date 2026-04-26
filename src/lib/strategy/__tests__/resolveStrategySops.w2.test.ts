/**
 * resolveStrategySops — Phase W2 unit coverage.
 *
 * Verifies the W2 resolver upgrade:
 *   • Every resolution returns a typed WorkspaceContract.
 *   • Unknown / null / custom workspaces fall back to `work`.
 *   • Aliases (e.g. `research`) normalize to canonical keys.
 *   • Contract version, retrieval rules, gate ids, and formatting hints
 *     are exposed on the resolved payload.
 *   • Existing task SOP resolution still works.
 *
 * Mirrors the env-shim pattern from the existing resolver test so it
 * runs under either jsdom or node.
 */
import { describe, it, expect, beforeEach } from 'vitest';

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
  updateTaskSop,
} from '../strategyConfig';
import { resolveStrategySops } from '../resolveStrategySops';
import { ALL_WORKSPACE_KEYS, getWorkspaceContract } from '../workspaceContracts';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

function enableEngine() {
  saveStrategyConfig({ ...getStrategyConfig(), enabled: true });
}

describe('W2 — typed contract is always attached', () => {
  it('returns the matching contract for every canonical workspace', () => {
    for (const key of ALL_WORKSPACE_KEYS) {
      const r = resolveStrategySops({ workspace: key });
      expect(r.workspace).toBe(key);
      expect(r.workspaceContract).toBe(getWorkspaceContract(key));
      expect(r.contractVersion).toBe(getWorkspaceContract(key).version);
      expect(r.retrievalRules).toEqual(getWorkspaceContract(key).retrievalRules);
      expect(r.qualityGateIds.length).toBe(
        getWorkspaceContract(key).qualityGates.length,
      );
      expect(r.outputFormattingHints).toEqual(
        getWorkspaceContract(key).outputFormattingHints,
      );
      expect(r.notes).toEqual([]);
    }
  });

  it('exposes a non-empty contract version (semver-shaped)', () => {
    const r = resolveStrategySops({ workspace: 'brainstorm' });
    expect(r.contractVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('quality gate ids are stable strings', () => {
    const r = resolveStrategySops({ workspace: 'refine' });
    expect(r.qualityGateIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(r.qualityGateIds).toContain('refine.variant_count_and_labels');
  });
});

describe('W2 — workspace key normalization', () => {
  it('null workspace falls back to `work`', () => {
    const r = resolveStrategySops({ workspace: null });
    expect(r.workspace).toBe('work');
    expect(r.workspaceContract.workspace).toBe('work');
    expect(r.notes).toEqual([]); // null is the documented default — no warning note
  });

  it('unknown workspace falls back to `work` with a fallback note', () => {
    const r = resolveStrategySops({ workspace: 'totally_made_up' as any });
    expect(r.workspace).toBe('work');
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0].kind).toBe('workspace_key_fallback');
    expect(r.notes[0].input).toBe('totally_made_up');
    expect(r.notes[0].resolvedTo).toBe('work');
  });

  it('custom workspace ids fall back to `work`', () => {
    const r = resolveStrategySops({ workspace: 'custom:abc123' as any });
    expect(r.workspace).toBe('work');
    expect(r.notes[0].kind).toBe('workspace_key_fallback');
    expect(r.notes[0].detail).toBe('custom-workspace');
  });

  it('alias `research` normalizes to `deep_research`', () => {
    const r = resolveStrategySops({ workspace: 'research' as any });
    expect(r.workspace).toBe('deep_research');
    expect(r.notes[0].kind).toBe('workspace_key_aliased');
    expect(r.notes[0].resolvedTo).toBe('deep_research');
  });

  it('alias `deepResearch` (camelCase) normalizes to `deep_research`', () => {
    const r = resolveStrategySops({ workspace: 'deepResearch' as any });
    expect(r.workspace).toBe('deep_research');
    expect(r.notes[0].kind).toBe('workspace_key_aliased');
  });
});

describe('W2 — back-compat with existing legacy SOP behavior', () => {
  it('global + task SOP still resolves for Discovery Prep', () => {
    enableEngine();
    updateGlobalSop({ enabled: true });
    updateTaskSop('discovery_prep', { enabled: true, rawInstructions: 'dp' });
    const r = resolveStrategySops({ taskType: 'discovery_prep' });
    expect(r.mode).toBe('task');
    expect(r.taskSop?.enabled).toBe(true);
    // W2: contract is also present, defaulted to `work`
    expect(r.workspaceContract.workspace).toBe('work');
  });

  it('engine off still produces a typed contract (composer-safe default)', () => {
    const r = resolveStrategySops({ workspace: 'brainstorm' });
    expect(r.globalSop).toBeNull();
    expect(r.workspaceSop).toBeNull();
    expect(r.workspaceContract.workspace).toBe('brainstorm');
    expect(r.retrievalRules.libraryMode).toBe('opportunistic');
  });
});
