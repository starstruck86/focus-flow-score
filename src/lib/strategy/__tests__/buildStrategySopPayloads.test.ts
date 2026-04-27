/**
 * buildStrategySopPayloads — Phase 3 unified resolver coverage.
 *
 * The unified helper is the single source of truth for every SOP payload
 * the client emits. Tests focus on:
 *   1. Wire-shape parity with the legacy helpers (no behavior drift).
 *   2. Exclusion rules (work / tasks / unknown strings).
 *   3. The Account Research task SOP attachment.
 *   4. Discovery Prep is intentionally untouched on the task-SOP side.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ── In-memory localStorage shim (mirrors sibling tests) ──────────────────
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
import {
  buildStrategySopPayloads,
  ACCOUNT_RESEARCH_REQUIRED_CHECKS,
} from '../buildStrategySopPayloads';
// Confirm legacy wrappers still resolve to the same thing as the unified
// helper so call-site refactors stay safe.
import { buildResolvedSopsPayload } from '../buildResolvedSopsPayload';
import { buildWorkspaceSopPayload } from '../buildWorkspaceSopPayload';
import { buildGlobalSopPayload } from '../buildGlobalSopPayload';
import { buildAccountResearchSopAttachment } from '../buildAccountResearchSopAttachment';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

function enableEngine() {
  saveStrategyConfig({ ...getStrategyConfig(), enabled: true });
}

describe('buildStrategySopPayloads — engine off', () => {
  it('returns all-null payloads when engine is disabled', () => {
    const out = buildStrategySopPayloads({ workspace: 'brainstorm' });
    expect(out.resolvedSops).toBeNull();
    expect(out.globalSop).toBeNull();
    expect(out.workspaceSop).toBeNull();
    expect(out.taskSop).toBeNull();
  });
});

describe('buildStrategySopPayloads — global SOP only', () => {
  beforeEach(() => {
    enableEngine();
    updateGlobalSop({
      enabled: true,
      name: 'Global SOP',
      rawInstructions: 'Always show your work.',
    });
  });

  it('ships globalSop on Work surface; workspaceSop stays null', () => {
    const out = buildStrategySopPayloads({ workspace: 'work' });
    expect(out.globalSop).not.toBeNull();
    expect(out.globalSop!.sopId).toBe('global');
    expect(out.globalSop!.name).toBe('Global SOP');
    expect(out.globalSop!.rawInstructions).toContain('Always show');
    expect(out.workspaceSop).toBeNull();
    // resolvedSops still summarises what fired.
    expect(out.resolvedSops).not.toBeNull();
    expect(out.resolvedSops!.appliedSopIds).toContain('global');
  });

  it('caps oversized global instructions at 8k chars', () => {
    updateGlobalSop({ enabled: true, rawInstructions: 'g'.repeat(20_000) });
    const out = buildStrategySopPayloads({ workspace: 'work' });
    expect(out.globalSop!.rawInstructions.length).toBe(8_000);
  });

  it('excludes globalSop entirely during a task pipeline', () => {
    const out = buildStrategySopPayloads({ taskType: 'discovery_prep' });
    expect(out.globalSop).toBeNull();
  });
});

describe('buildStrategySopPayloads — global + workspace combinations', () => {
  beforeEach(() => {
    enableEngine();
    updateGlobalSop({ enabled: true, rawInstructions: 'global rule' });
  });

  it('global + brainstorm: ships both, workspaceSop carries brainstorm', () => {
    updateWorkspaceSop('brainstorm', {
      enabled: true,
      name: 'Brainstorm SOP',
      rawInstructions: 'Diverge first.',
    });
    const out = buildStrategySopPayloads({ workspace: 'brainstorm' });
    expect(out.globalSop).not.toBeNull();
    expect(out.workspaceSop).not.toBeNull();
    expect(out.workspaceSop!.workspace).toBe('brainstorm');
    expect(out.workspaceSop!.sopId).toBe('workspace:brainstorm');
  });

  it('global + deep_research: workspaceSop carries deep_research', () => {
    updateWorkspaceSop('deep_research', {
      enabled: true,
      rawInstructions: 'Lead with evidence.',
    });
    const out = buildStrategySopPayloads({ workspace: 'deep_research' });
    expect(out.workspaceSop!.sopId).toBe('workspace:deep_research');
    expect(out.globalSop).not.toBeNull();
  });

  it('global + refine: workspaceSop carries refine', () => {
    updateWorkspaceSop('refine', { enabled: true, rawInstructions: 'Tighten.' });
    const out = buildStrategySopPayloads({ workspace: 'refine' });
    expect(out.workspaceSop!.sopId).toBe('workspace:refine');
  });

  it('Work surface excludes workspaceSop even when one is configured', () => {
    updateWorkspaceSop('work', { enabled: true, rawInstructions: 'should not ship' });
    const out = buildStrategySopPayloads({ workspace: 'work' });
    expect(out.workspaceSop).toBeNull();
  });
});

describe('buildStrategySopPayloads — task SOP', () => {
  it('account_brief: returns the Account Research SOP attachment', () => {
    enableEngine();
    updateTaskSop('account_research', {
      enabled: true,
      name: 'Account Research SOP',
      rawInstructions: 'do the thing',
      parsedSections: {
        nonNegotiables: ['Be specific'],
        requiredOutputs: ['custom output'],
        researchWorkflow: ['step 1', 'step 2'],
      },
    });
    // The unified resolver maps the `account_research` task slot to the
    // attachment shape — callers ask by raw task key here.
    const out = buildStrategySopPayloads({ taskType: 'account_research' });
    expect(out.taskSop).not.toBeNull();
    expect(out.taskSop!.enabled).toBe(true);
    expect(out.taskSop!.nonNegotiables).toEqual(['Be specific']);
    expect(out.taskSop!.researchWorkflow).toEqual(['step 1', 'step 2']);
    // User outputs preserved AND minimum acceptance checks appended.
    expect(out.taskSop!.requiredOutputs).toContain('custom output');
    for (const c of ACCOUNT_RESEARCH_REQUIRED_CHECKS) {
      expect(out.taskSop!.requiredOutputs).toContain(c);
    }
  });

  it('discovery_prep: taskSop is intentionally untouched (returns null)', () => {
    enableEngine();
    updateTaskSop('discovery_prep', {
      enabled: true,
      rawInstructions: 'discovery rules',
    });
    const out = buildStrategySopPayloads({ taskType: 'discovery_prep' });
    // Phase 3 spec: Discovery Prep stays owned by useTaskExecution.
    expect(out.taskSop).toBeNull();
  });

  it('returns null taskSop when account_research is disabled', () => {
    enableEngine();
    updateTaskSop('account_research', { enabled: false });
    const out = buildStrategySopPayloads({ taskType: 'account_research' });
    expect(out.taskSop).toBeNull();
  });
});

describe('buildStrategySopPayloads — input sanitisation', () => {
  it('unknown workspace string is treated as null', () => {
    enableEngine();
    updateWorkspaceSop('brainstorm', { enabled: true, rawInstructions: 'b' });
    const out = buildStrategySopPayloads({ workspace: 'not-a-real-workspace' as any });
    expect(out.workspaceSop).toBeNull();
  });

  it('unknown task string is treated as null and clears taskSop guards', () => {
    enableEngine();
    updateGlobalSop({ enabled: true, rawInstructions: 'g' });
    const out = buildStrategySopPayloads({ taskType: 'mystery_task' as any });
    expect(out.taskSop).toBeNull();
    // Unknown task is null → globalSop is allowed back through.
    expect(out.globalSop).not.toBeNull();
  });

  it('null/undefined inputs do not throw', () => {
    enableEngine();
    expect(() => buildStrategySopPayloads({})).not.toThrow();
    expect(() => buildStrategySopPayloads({ workspace: null, taskType: null })).not.toThrow();
  });
});

describe('buildStrategySopPayloads — legacy wrapper parity', () => {
  beforeEach(() => {
    enableEngine();
    updateGlobalSop({ enabled: true, rawInstructions: 'global' });
    updateWorkspaceSop('brainstorm', { enabled: true, rawInstructions: 'ws' });
    updateTaskSop('account_research', {
      enabled: true,
      parsedSections: { nonNegotiables: ['x'] },
    });
  });

  it('buildResolvedSopsPayload mirrors the unified resolvedSops field', () => {
    const direct = buildStrategySopPayloads({ workspace: 'brainstorm' }).resolvedSops;
    const wrapped = buildResolvedSopsPayload({ workspace: 'brainstorm' });
    expect(wrapped).toEqual(direct);
  });

  it('buildWorkspaceSopPayload mirrors the unified workspaceSop field', () => {
    const direct = buildStrategySopPayloads({ workspace: 'brainstorm' }).workspaceSop;
    const wrapped = buildWorkspaceSopPayload({ workspace: 'brainstorm' });
    expect(wrapped).toEqual(direct);
  });

  it('buildGlobalSopPayload mirrors the unified globalSop field', () => {
    const direct = buildStrategySopPayloads({}).globalSop;
    const wrapped = buildGlobalSopPayload();
    expect(wrapped).toEqual(direct);
  });

  it('buildAccountResearchSopAttachment mirrors the unified taskSop field', () => {
    const direct = buildStrategySopPayloads({ taskType: 'account_research' }).taskSop;
    const wrapped = buildAccountResearchSopAttachment();
    expect(wrapped).toEqual(direct);
  });
});
