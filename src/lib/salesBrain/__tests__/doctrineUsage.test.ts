/**
 * Doctrine Usage + Traceability Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store: Record<string, string> = {};
beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(k => store[k] ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => { store[k] = v; });
});

import {
  logDoctrineUsage,
  logDoctrineUsageBatch,
  loadDoctrineUsage,
  getDoctrineUsageForId,
  getDoctrineUsageSummary,
  getRecentDoctrineUsage,
} from '@/lib/salesBrain/doctrineUsage';

import {
  getDoctrineTrace,
  getResourceTrace,
  getInsightTrace,
} from '@/lib/salesBrain/traceability';

import {
  saveDoctrine,
  saveInsights,
  loadDoctrine,
  defaultGovernance,
  mergeDoctrine,
  supersedeDoctrine,
  queueLegacyDoctrineForReview,
  type DoctrineEntry,
  type SalesBrainInsight,
} from '@/lib/salesBrain/doctrine';

function makeEntry(overrides: Partial<DoctrineEntry> = {}): DoctrineEntry {
  const id = `test-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    chapter: 'cold_calling',
    statement: 'Test doctrine',
    tacticalImplication: 'Apply tactic',
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

function makeInsight(overrides: Partial<SalesBrainInsight> = {}): SalesBrainInsight {
  return {
    id: `ins-${Math.random().toString(36).slice(2, 7)}`,
    resourceIds: ['res-1'],
    chapter: 'cold_calling',
    topic: 'Test insight',
    insightText: 'Some insight',
    category: 'tactic',
    personaRelevance: [],
    confidence: 0.6,
    extractedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Doctrine Usage Logging', () => {
  it('logs and retrieves usage events', () => {
    logDoctrineUsage('doc-1', 'dave', 'dave_context');
    logDoctrineUsage('doc-1', 'roleplay', 'roleplay_grounding');
    logDoctrineUsage('doc-2', 'dave', 'dave_context');
    const events = loadDoctrineUsage();
    expect(events.length).toBe(3);
  });

  it('getDoctrineUsageForId filters correctly', () => {
    logDoctrineUsage('doc-a', 'dave');
    logDoctrineUsage('doc-b', 'prep');
    logDoctrineUsage('doc-a', 'roleplay');
    expect(getDoctrineUsageForId('doc-a').length).toBe(2);
    expect(getDoctrineUsageForId('doc-b').length).toBe(1);
  });

  it('getDoctrineUsageSummary aggregates correctly', () => {
    logDoctrineUsage('doc-s', 'dave');
    logDoctrineUsage('doc-s', 'dave');
    logDoctrineUsage('doc-s', 'prep');
    const summary = getDoctrineUsageSummary('doc-s');
    expect(summary.totalUsages).toBe(3);
    expect(summary.byTarget.dave).toBe(2);
    expect(summary.byTarget.prep).toBe(1);
    expect(summary.lastUsedTarget).toBe('prep'); // most recent
  });

  it('batch logging works', () => {
    logDoctrineUsageBatch(['d1', 'd2', 'd3'], 'playbooks', 'playbook_suggestion');
    expect(loadDoctrineUsage().length).toBe(3);
  });

  it('corrupted storage fails safely', () => {
    store['sales-brain-doctrine-usage'] = 'not json{{{';
    expect(loadDoctrineUsage()).toEqual([]);
  });

  it('getRecentDoctrineUsage filters by target', () => {
    logDoctrineUsage('dx', 'dave');
    logDoctrineUsage('dy', 'roleplay');
    expect(getRecentDoctrineUsage('dave').length).toBe(1);
  });
});

describe('Traceability', () => {
  it('getDoctrineTrace returns linked data', () => {
    const ins = makeInsight({ id: 'ins-t1', resourceIds: ['res-t1'] });
    saveInsights([ins]);
    const doc = makeEntry({ id: 'doc-t1', sourceInsightIds: ['ins-t1'], sourceResourceIds: ['res-t1'] });
    saveDoctrine([doc]);
    logDoctrineUsage('doc-t1', 'dave');

    const trace = getDoctrineTrace('doc-t1');
    expect(trace).not.toBeNull();
    expect(trace!.linkedInsights.length).toBe(1);
    expect(trace!.linkedResourceIds).toContain('res-t1');
    expect(trace!.usageEvents.length).toBe(1);
  });

  it('getResourceTrace returns linked doctrine', () => {
    const ins = makeInsight({ id: 'ins-r1', resourceIds: ['res-r1'] });
    saveInsights([ins]);
    const doc = makeEntry({ sourceResourceIds: ['res-r1'] });
    saveDoctrine([doc]);
    const trace = getResourceTrace('res-r1');
    expect(trace.doctrineCount).toBe(1);
    expect(trace.linkedInsights.length).toBe(1);
  });

  it('getInsightTrace returns linked doctrine', () => {
    const ins = makeInsight({ id: 'ins-i1' });
    saveInsights([ins]);
    const doc = makeEntry({ sourceInsightIds: ['ins-i1'] });
    saveDoctrine([doc]);
    const trace = getInsightTrace('ins-i1');
    expect(trace).not.toBeNull();
    expect(trace!.linkedDoctrine.length).toBe(1);
  });

  it('getDoctrineTrace returns null for missing id', () => {
    saveDoctrine([]);
    expect(getDoctrineTrace('nonexistent')).toBeNull();
  });
});

describe('Legacy Doctrine', () => {
  it('legacy hydrated doctrine is marked isLegacyHydrated', () => {
    const legacy = {
      id: 'leg-2', chapter: 'discovery', statement: 'old',
      tacticalImplication: '', talkTracks: [], antiPatterns: [],
      examples: [], sourceInsightIds: [], sourceResourceIds: [],
      confidence: 0.5, freshnessState: 'fresh', version: 1,
      supersedesId: null, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store['sales-brain-doctrine'] = JSON.stringify([legacy]);
    const loaded = loadDoctrine();
    expect(loaded[0].governance.isLegacyHydrated).toBe(true);
  });

  it('new doctrine has isLegacyHydrated false', () => {
    const entry = makeEntry();
    expect(entry.governance.isLegacyHydrated).toBe(false);
  });

  it('queueLegacyDoctrineForReview only re-queues unused legacy', () => {
    const leg = makeEntry({ id: 'leg-q', governance: { ...defaultGovernance('approved'), isLegacyHydrated: true } });
    saveDoctrine([leg]);
    const count = queueLegacyDoctrineForReview();
    expect(count).toBe(1);
    const updated = loadDoctrine().find(d => d.id === 'leg-q')!;
    expect(updated.governance.status).toBe('review_needed');
    expect(updated.governance.propagationEnabled).toBe(false);
  });
});

describe('Supersede', () => {
  it('supersedeDoctrine disables source and sets reference', () => {
    const src = makeEntry({ id: 'sup-s', governance: defaultGovernance('approved') });
    const rep = makeEntry({ id: 'sup-r', governance: defaultGovernance('approved') });
    saveDoctrine([src, rep]);
    supersedeDoctrine('sup-s', 'sup-r', 'Better version');
    const all = loadDoctrine();
    const updated = all.find(d => d.id === 'sup-s')!;
    expect(updated.governance.status).toBe('superseded');
    expect(updated.governance.supersededById).toBe('sup-r');
    expect(updated.governance.propagationEnabled).toBe(false);
  });
});

describe('Merge preserves lineage', () => {
  it('merge adds review note about provenance', () => {
    const src = makeEntry({ id: 'mg-s', sourceResourceIds: ['r1'], governance: defaultGovernance('approved') });
    const tgt = makeEntry({ id: 'mg-t', sourceResourceIds: ['r2'], governance: defaultGovernance('approved') });
    saveDoctrine([src, tgt]);
    mergeDoctrine('mg-s', 'mg-t');
    const all = loadDoctrine();
    const merged = all.find(d => d.id === 'mg-t')!;
    expect(merged.sourceResourceIds).toContain('r1');
    expect(merged.sourceResourceIds).toContain('r2');
    const old = all.find(d => d.id === 'mg-s')!;
    expect(old.governance.mergedIntoId).toBe('mg-t');
  });
});
