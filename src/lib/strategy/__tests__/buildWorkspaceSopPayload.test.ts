/**
 * buildWorkspaceSopPayload — Phase 3A unit coverage.
 *
 * The helper decides whether a workspace SOP should be shipped to the
 * server for advisory injection. Its rules are intentionally narrow:
 *   • Engine + workspace SOP must be enabled with non-empty rawInstructions.
 *   • `work` (freeform) and any task pipeline must return null.
 *   • Unknown workspace/task strings must return null.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// Reuse the same in-memory localStorage shim pattern used by sibling tests.
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
} from '../strategyConfig';
import { buildWorkspaceSopPayload } from '../buildWorkspaceSopPayload';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

function enableEngine() {
  saveStrategyConfig({ ...getStrategyConfig(), enabled: true });
}

describe('buildWorkspaceSopPayload — disabled paths', () => {
  it('returns null when engine is off', () => {
    expect(buildWorkspaceSopPayload({ workspace: 'brainstorm' })).toBeNull();
  });

  it('returns null for the work surface (freeform)', () => {
    enableEngine();
    updateWorkspaceSop('work', { enabled: true, rawInstructions: 'should not ship' });
    expect(buildWorkspaceSopPayload({ workspace: 'work' })).toBeNull();
  });

  it('returns null when the workspace SOP is disabled', () => {
    enableEngine();
    updateWorkspaceSop('brainstorm', { enabled: false, rawInstructions: 'b' });
    expect(buildWorkspaceSopPayload({ workspace: 'brainstorm' })).toBeNull();
  });

  it('returns null when rawInstructions is empty', () => {
    enableEngine();
    updateWorkspaceSop('brainstorm', { enabled: true, rawInstructions: '   ' });
    expect(buildWorkspaceSopPayload({ workspace: 'brainstorm' })).toBeNull();
  });

  it('returns null during a task pipeline (Discovery Prep guard)', () => {
    enableEngine();
    updateWorkspaceSop('artifacts', { enabled: true, rawInstructions: 'a' });
    expect(
      buildWorkspaceSopPayload({ workspace: 'artifacts', taskType: 'discovery_prep' }),
    ).toBeNull();
  });

  it('returns null for unknown workspace strings', () => {
    enableEngine();
    expect(
      buildWorkspaceSopPayload({ workspace: 'not-a-workspace' as any }),
    ).toBeNull();
  });
});

describe('buildWorkspaceSopPayload — active workspace', () => {
  it('Brainstorm: ships sopId, name, raw instructions', () => {
    enableEngine();
    updateGlobalSop({ enabled: true });
    updateWorkspaceSop('brainstorm', {
      enabled: true,
      name: 'Brainstorm SOP',
      rawInstructions: 'Diverge first. Compress later.',
    });
    const p = buildWorkspaceSopPayload({ workspace: 'brainstorm' });
    expect(p).not.toBeNull();
    expect(p!.sopId).toBe('workspace:brainstorm');
    expect(p!.workspace).toBe('brainstorm');
    expect(p!.name).toBe('Brainstorm SOP');
    expect(p!.rawInstructions).toContain('Diverge');
  });

  it('Refine: trims and caps oversized instructions at 6k chars', () => {
    enableEngine();
    const huge = 'x'.repeat(10_000);
    updateWorkspaceSop('refine', { enabled: true, rawInstructions: huge });
    const p = buildWorkspaceSopPayload({ workspace: 'refine' });
    expect(p).not.toBeNull();
    expect(p!.rawInstructions.length).toBe(6_000);
  });

  it('Deep Research workspace returns its SOP when enabled', () => {
    enableEngine();
    updateWorkspaceSop('deep_research', {
      enabled: true,
      rawInstructions: 'Lead with evidence.',
    });
    const p = buildWorkspaceSopPayload({ workspace: 'deep_research' });
    expect(p!.sopId).toBe('workspace:deep_research');
  });
});
