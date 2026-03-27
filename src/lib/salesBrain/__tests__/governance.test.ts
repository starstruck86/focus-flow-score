/**
 * Sales Brain Governance Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const store: Record<string, string> = {};
beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(k => store[k] ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => { store[k] = v; });
});

import {
  loadDoctrine,
  saveDoctrine,
  defaultGovernance,
  approveDoctrine,
  rejectDoctrine,
  archiveDoctrine,
  mergeDoctrine,
  adjustDoctrineConfidence,
  togglePropagation,
  isDoctrineEligibleForPropagation,
  getActiveDoctrine,
  getPropagationEligibleDoctrine,
  detectDuplicatesAndConflicts,
  getDoctrineReviewQueue,
  type DoctrineEntry,
} from '@/lib/salesBrain/doctrine';

function makeEntry(overrides: Partial<DoctrineEntry> = {}): DoctrineEntry {
  const id = `test-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    chapter: 'cold_calling',
    statement: 'Test doctrine statement',
    tacticalImplication: 'Apply this tactic',
    talkTracks: [],
    antiPatterns: [],
    examples: [],
    sourceInsightIds: ['ins-1'],
    sourceResourceIds: ['res-1'],
    confidence: 0.7,
    freshnessState: 'new',
    version: 1,
    supersedesId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    governance: defaultGovernance('review_needed'),
    ...overrides,
  };
}

describe('Doctrine Governance', () => {
  it('new doctrine defaults to review_needed', () => {
    const entry = makeEntry();
    expect(entry.governance.status).toBe('review_needed');
    expect(entry.governance.propagationEnabled).toBe(false);
  });

  it('only approved doctrine propagates by default', () => {
    const reviewEntry = makeEntry({ governance: defaultGovernance('review_needed') });
    const approvedEntry = makeEntry({ governance: defaultGovernance('approved') });
    expect(isDoctrineEligibleForPropagation(reviewEntry)).toBe(false);
    expect(isDoctrineEligibleForPropagation(approvedEntry)).toBe(true);
  });

  it('rejected doctrine never propagates', () => {
    const entry = makeEntry();
    entry.governance.status = 'rejected';
    entry.governance.propagationEnabled = true; // even if manually set
    expect(isDoctrineEligibleForPropagation(entry)).toBe(false);
  });

  it('superseded doctrine is hidden from active lists', () => {
    const active = makeEntry({ id: 'a1', governance: defaultGovernance('approved') });
    const superseded = makeEntry({ id: 's1' });
    superseded.governance.status = 'superseded';
    saveDoctrine([active, superseded]);
    const activeList = getActiveDoctrine();
    expect(activeList.find(d => d.id === 's1')).toBeUndefined();
    expect(activeList.find(d => d.id === 'a1')).toBeDefined();
  });

  it('approve sets correct governance fields', () => {
    const entry = makeEntry({ id: 'app-1' });
    saveDoctrine([entry]);
    approveDoctrine('app-1');
    const updated = loadDoctrine().find(d => d.id === 'app-1')!;
    expect(updated.governance.status).toBe('approved');
    expect(updated.governance.approvedAt).toBeTruthy();
    expect(updated.governance.propagationEnabled).toBe(true);
  });

  it('reject sets reason and disables propagation', () => {
    const entry = makeEntry({ id: 'rej-1', governance: defaultGovernance('approved') });
    saveDoctrine([entry]);
    rejectDoctrine('rej-1', 'Not accurate');
    const updated = loadDoctrine().find(d => d.id === 'rej-1')!;
    expect(updated.governance.status).toBe('rejected');
    expect(updated.governance.rejectedReason).toBe('Not accurate');
    expect(updated.governance.propagationEnabled).toBe(false);
  });

  it('merge preserves source lineage', () => {
    const source = makeEntry({ id: 'src-1', sourceResourceIds: ['r1', 'r2'], sourceInsightIds: ['i1'] });
    const target = makeEntry({ id: 'tgt-1', sourceResourceIds: ['r3'], sourceInsightIds: ['i2'], governance: defaultGovernance('approved') });
    saveDoctrine([source, target]);
    mergeDoctrine('src-1', 'tgt-1');
    const all = loadDoctrine();
    const merged = all.find(d => d.id === 'tgt-1')!;
    expect(merged.sourceResourceIds).toContain('r1');
    expect(merged.sourceResourceIds).toContain('r2');
    expect(merged.sourceResourceIds).toContain('r3');
    expect(merged.sourceInsightIds).toContain('i1');
    const old = all.find(d => d.id === 'src-1')!;
    expect(old.governance.status).toBe('superseded');
    expect(old.governance.mergedIntoId).toBe('tgt-1');
  });

  it('stale doctrine does not propagate', () => {
    const entry = makeEntry({ freshnessState: 'stale', governance: defaultGovernance('approved') });
    expect(isDoctrineEligibleForPropagation(entry)).toBe(false);
  });

  it('low confidence doctrine does not propagate to restricted targets', () => {
    const entry = makeEntry({ confidence: 0.3, governance: defaultGovernance('approved') });
    expect(isDoctrineEligibleForPropagation(entry, 'dave')).toBe(false);
    expect(isDoctrineEligibleForPropagation(entry, 'playbooks')).toBe(false);
  });

  it('disabled propagation removes eligibility', () => {
    const entry = makeEntry({ governance: defaultGovernance('approved') });
    entry.governance.propagationEnabled = false;
    expect(isDoctrineEligibleForPropagation(entry)).toBe(false);
  });

  it('per-target propagation control works', () => {
    const entry = makeEntry({ confidence: 0.8, governance: defaultGovernance('approved') });
    entry.governance.propagateTargets.roleplay = false;
    expect(isDoctrineEligibleForPropagation(entry, 'dave')).toBe(true);
    expect(isDoctrineEligibleForPropagation(entry, 'roleplay')).toBe(false);
  });

  it('review queue surfaces review_needed items', () => {
    const entry = makeEntry({ id: 'rq-1' });
    saveDoctrine([entry]);
    const queue = getDoctrineReviewQueue();
    expect(queue.length).toBeGreaterThan(0);
    expect(queue[0].entry.id).toBe('rq-1');
    expect(queue[0].queueReason).toContain('Awaiting review');
  });

  it('confidence adjustment works', () => {
    const entry = makeEntry({ id: 'ca-1', confidence: 0.5 });
    saveDoctrine([entry]);
    adjustDoctrineConfidence('ca-1', 0.2);
    const updated = loadDoctrine().find(d => d.id === 'ca-1')!;
    expect(updated.confidence).toBeCloseTo(0.7);
  });

  it('archive disables propagation', () => {
    const entry = makeEntry({ id: 'ar-1', governance: defaultGovernance('approved') });
    saveDoctrine([entry]);
    archiveDoctrine('ar-1');
    const updated = loadDoctrine().find(d => d.id === 'ar-1')!;
    expect(updated.governance.status).toBe('archived');
    expect(updated.governance.propagationEnabled).toBe(false);
  });

  it('legacy entries without governance get hydrated', () => {
    // Simulate pre-governance entry in localStorage
    const legacy = {
      id: 'leg-1', chapter: 'discovery', statement: 'test',
      tacticalImplication: '', talkTracks: [], antiPatterns: [],
      examples: [], sourceInsightIds: [], sourceResourceIds: [],
      confidence: 0.5, freshnessState: 'fresh', version: 1,
      supersedesId: null, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store['sales-brain-doctrine'] = JSON.stringify([legacy]);
    const loaded = loadDoctrine();
    expect(loaded[0].governance).toBeDefined();
    expect(loaded[0].governance.status).toBe('approved'); // legacy = approved
  });
});
