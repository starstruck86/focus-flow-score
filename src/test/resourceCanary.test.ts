/**
 * Canary regression suite for the resource enrichment system.
 *
 * Representative edge cases that must remain stable across enrichment logic changes.
 * Tests classification, trust, eligibility, strategy selection, and state transitions.
 */
import { describe, it, expect } from 'vitest';
import { assessTrust, classifySource, computeTrustScore, type ResourceForTrust } from '@/lib/resourceTrust';
import { planStrategy } from '@/lib/resourceStrategyPlanner';
import { isValidTransition } from '@/lib/resourceLifecycle';
import { validateResourceQuality, type ResourceForValidation } from '@/lib/resourceQuality';

// ── Canary Resources ───────────────────────────────────────
const CANARY = {
  trustedYouTube: (): ResourceForTrust => ({
    id: 'canary-yt-trusted',
    title: 'Sales Mastery Podcast Episode 42',
    content: 'A'.repeat(6000),
    content_length: 6000,
    enrichment_status: 'deep_enriched',
    enrichment_version: 2,
    validation_version: 2,
    enriched_at: new Date().toISOString(),
    failure_reason: null,
    file_url: 'https://www.youtube.com/watch?v=abc123',
    resource_type: 'podcast',
    description: 'Comprehensive sales mastery training with key frameworks',
    last_quality_score: 85,
    last_quality_tier: 'complete',
    failure_count: 0,
  }),
  staleBlog: (): ResourceForTrust => ({
    id: 'canary-blog-stale',
    title: 'Old HubSpot Article',
    content: 'B'.repeat(2000),
    content_length: 2000,
    enrichment_status: 'deep_enriched',
    enrichment_version: 0,
    validation_version: 0,
    enriched_at: new Date(Date.now() - 200 * 86400000).toISOString(),
    failure_reason: null,
    file_url: 'https://blog.hubspot.com/old-article',
    resource_type: 'article',
    description: 'An older article',
    last_quality_score: 55,
    last_quality_tier: 'shallow',
    failure_count: 0,
  }),
  quarantinedFailure: (): ResourceForTrust => ({
    id: 'canary-fail-quarantine',
    title: 'Broken Resource',
    content: '',
    content_length: 0,
    enrichment_status: 'failed',
    enrichment_version: 0,
    validation_version: 0,
    enriched_at: null,
    failure_reason: 'All extraction methods failed',
    file_url: 'https://example.com/broken',
    description: null,
    last_quality_score: 5,
    last_quality_tier: 'failed',
    failure_count: 5,
  }),
  authGated: (): ResourceForTrust => ({
    id: 'canary-auth-gated',
    title: 'Skool Community Post',
    content: 'Login required',
    content_length: 14,
    enrichment_status: 'incomplete',
    enrichment_version: 2,
    validation_version: 2,
    enriched_at: null,
    failure_reason: 'Auth-gated source',
    file_url: 'https://skool.com/group/post',
    description: null,
    last_quality_score: 10,
    last_quality_tier: 'failed',
    failure_count: 1,
  }),
  emptyNote: (): ResourceForTrust => ({
    id: 'canary-empty-note',
    title: 'Quick Note',
    content: 'Short note here',
    content_length: 15,
    enrichment_status: 'not_enriched',
    enrichment_version: 0,
    validation_version: 0,
    enriched_at: null,
    failure_reason: null,
    file_url: null,
    resource_type: 'note',
    description: null,
    last_quality_score: null,
    last_quality_tier: null,
    failure_count: 0,
  }),
};

// ── Source Classification ──────────────────────────────────
describe('Source Classification Canary', () => {
  it('classifies YouTube URLs', () => {
    expect(classifySource('https://www.youtube.com/watch?v=abc123')).toBe('youtube_transcript');
    expect(classifySource('https://youtu.be/abc123')).toBe('youtube_transcript');
  });

  it('classifies auth-gated domains', () => {
    expect(classifySource('https://skool.com/group/post')).toBe('auth_gated');
    expect(classifySource('https://app.circle.so/community')).toBe('auth_gated');
    expect(classifySource('https://courses.teachable.com/lesson')).toBe('auth_gated');
  });

  it('classifies PDFs', () => {
    expect(classifySource('https://example.com/doc.pdf')).toBe('pdf_document');
  });

  it('classifies notes without URL', () => {
    expect(classifySource(null, 'note')).toBe('note');
  });

  it('defaults to blog_article for unknown web URLs', () => {
    expect(classifySource('https://example.com/article')).toBe('blog_article');
  });
});

// ── Trust Scoring ──────────────────────────────────────────
describe('Trust Scoring Canary', () => {
  it('trusted YouTube resource scores ≥70', () => {
    const score = computeTrustScore(CANARY.trustedYouTube());
    expect(score.overall).toBeGreaterThanOrEqual(70);
  });

  it('stale blog scores below trusted threshold', () => {
    const score = computeTrustScore(CANARY.staleBlog());
    expect(score.overall).toBeLessThan(70);
  });

  it('quarantined resource scores very low', () => {
    const score = computeTrustScore(CANARY.quarantinedFailure());
    expect(score.overall).toBeLessThan(30);
  });

  it('all dimension scores are within 0-25', () => {
    for (const factory of Object.values(CANARY)) {
      const score = computeTrustScore(factory());
      expect(score.confidence).toBeGreaterThanOrEqual(0);
      expect(score.confidence).toBeLessThanOrEqual(25);
      expect(score.completeness).toBeGreaterThanOrEqual(0);
      expect(score.completeness).toBeLessThanOrEqual(25);
      expect(score.freshness).toBeGreaterThanOrEqual(0);
      expect(score.freshness).toBeLessThanOrEqual(25);
      expect(score.sourceQuality).toBeGreaterThanOrEqual(0);
      expect(score.sourceQuality).toBeLessThanOrEqual(25);
    }
  });
});

// ── Trust Status Classification ────────────────────────────
describe('Trust Status Canary', () => {
  it('high-quality enriched resource → trusted', () => {
    const assessment = assessTrust(CANARY.trustedYouTube());
    expect(assessment.trustStatus).toBe('trusted');
  });

  it('stale resource → stale or limited', () => {
    const assessment = assessTrust(CANARY.staleBlog());
    expect(['stale', 'limited']).toContain(assessment.trustStatus);
  });

  it('repeated failure resource → quarantined', () => {
    const assessment = assessTrust(CANARY.quarantinedFailure());
    expect(assessment.trustStatus).toBe('quarantined');
  });

  it('auth-gated resource → suspect or quarantined', () => {
    const assessment = assessTrust(CANARY.authGated());
    expect(['suspect', 'quarantined']).toContain(assessment.trustStatus);
  });
});

// ── Downstream Eligibility ─────────────────────────────────
describe('Downstream Eligibility Canary', () => {
  it('trusted resource eligible for all strategic purposes', () => {
    const assessment = assessTrust(CANARY.trustedYouTube());
    expect(assessment.eligibility.dave_grounding).toBe(true);
    expect(assessment.eligibility.playbook_generation).toBe(true);
    expect(assessment.eligibility.search).toBe(true);
  });

  it('quarantined resource blocked from strategic purposes', () => {
    const assessment = assessTrust(CANARY.quarantinedFailure());
    expect(assessment.eligibility.dave_grounding).toBe(false);
    expect(assessment.eligibility.playbook_generation).toBe(false);
    expect(assessment.eligibility.strategic_recommendations).toBe(false);
    // Always visible in library
    expect(assessment.eligibility.library_display).toBe(true);
  });

  it('non-enriched resource blocked from enrichment-requiring purposes', () => {
    const assessment = assessTrust(CANARY.emptyNote());
    expect(assessment.eligibility.summary_generation).toBe(false);
    expect(assessment.eligibility.dave_grounding).toBe(false);
  });
});

// ── Strategy Planner ───────────────────────────────────────
describe('Strategy Planner Canary', () => {
  it('defaults to full_enrich for new resources', () => {
    const plan = planStrategy({
      resourceId: 'new-resource',
      sourceUrl: 'https://example.com/article',
      contentSize: 2000,
      failureCount: 0,
      enrichmentStatus: 'not_enriched',
    });
    expect(plan.primaryStrategy).toBe('full_enrich');
    expect(plan.fallbackChain.length).toBeGreaterThan(0);
  });

  it('downgrades strategy for repeated failures', () => {
    const plan = planStrategy({
      resourceId: 'failing-resource',
      sourceUrl: 'https://example.com/article',
      contentSize: 2000,
      failureCount: 3,
      enrichmentStatus: 'failed',
    });
    expect(plan.primaryStrategy).not.toBe('full_enrich');
  });

  it('uses metadata_only for auth-gated sources', () => {
    const plan = planStrategy({
      resourceId: 'gated-resource',
      sourceUrl: 'https://skool.com/group/post',
      contentSize: 100,
      failureCount: 0,
      enrichmentStatus: 'not_enriched',
    });
    expect(plan.primaryStrategy).toBe('metadata_only');
  });

  it('uses summary_first for large content', () => {
    const plan = planStrategy({
      resourceId: 'large-resource',
      sourceUrl: 'https://www.youtube.com/watch?v=huge',
      contentSize: 100000,
      failureCount: 0,
      enrichmentStatus: 'not_enriched',
    });
    expect(plan.primaryStrategy).toBe('summary_first');
  });
});

// ── State Machine Canary ───────────────────────────────────
describe('State Machine Canary', () => {
  it('allows valid transitions', () => {
    expect(isValidTransition('not_enriched', 'queued_for_deep_enrich')).toBe(true);
    expect(isValidTransition('deep_enrich_in_progress', 'deep_enriched')).toBe(true);
    expect(isValidTransition('deep_enrich_in_progress', 'failed')).toBe(true);
    expect(isValidTransition('failed', 'queued_for_deep_enrich')).toBe(true);
  });

  it('blocks invalid transitions', () => {
    expect(isValidTransition('not_enriched', 'deep_enriched')).toBe(false);
    expect(isValidTransition('deep_enriched', 'failed')).toBe(false);
    expect(isValidTransition('duplicate', 'deep_enriched')).toBe(false);
  });
});

// ── Explainability Canary ──────────────────────────────────
describe('Explainability Canary', () => {
  it('provides explanations for every assessment', () => {
    for (const factory of Object.values(CANARY)) {
      const assessment = assessTrust(factory());
      expect(assessment.explanations.length).toBeGreaterThan(0);
      expect(assessment.explanations[0]).toHaveProperty('aspect');
      expect(assessment.explanations[0]).toHaveProperty('decision');
      expect(assessment.explanations[0]).toHaveProperty('reasoning');
    }
  });

  it('quarantined resources have quarantine reasons', () => {
    const assessment = assessTrust(CANARY.quarantinedFailure());
    if (assessment.trustStatus === 'quarantined') {
      expect(assessment.quarantineReasons.length).toBeGreaterThan(0);
    }
});

// ── Post-Extraction KI Floor Invariant ────────────────────
// Mirror of the computeMinKiFloor logic in batch-extract-kis.
// If the edge function changes its floors, these tests must be updated in lockstep.
function computeMinKiFloor(contentLength: number, isLesson: boolean): number {
  if (contentLength < 500) return 0;
  if (isLesson) {
    if (contentLength < 2000) return 3;
    if (contentLength < 5000) return 5;
    if (contentLength < 10000) return 8;
    return 12;
  }
  if (contentLength < 2000) return 1;
  if (contentLength < 5000) return 2;
  return 3;
}

describe('KI Floor Invariant Canary', () => {
  it('lessons < 500 chars have floor 0 (too short)', () => {
    expect(computeMinKiFloor(300, true)).toBe(0);
  });

  it('short lessons (500-2000 chars) require ≥ 3 KIs', () => {
    expect(computeMinKiFloor(800, true)).toBe(3);
    expect(computeMinKiFloor(1999, true)).toBe(3);
  });

  it('medium lessons (2000-5000 chars) require ≥ 5 KIs', () => {
    expect(computeMinKiFloor(3500, true)).toBe(5);
  });

  it('substantial lessons (5000-10000 chars) require ≥ 8 KIs', () => {
    expect(computeMinKiFloor(7000, true)).toBe(8);
  });

  it('large lessons (10000+ chars) require ≥ 12 KIs', () => {
    expect(computeMinKiFloor(14729, true)).toBe(12);
    expect(computeMinKiFloor(50000, true)).toBe(12);
  });

  it('non-lesson content has more conservative floors', () => {
    expect(computeMinKiFloor(1000, false)).toBe(1);
    expect(computeMinKiFloor(3000, false)).toBe(2);
    expect(computeMinKiFloor(8000, false)).toBe(3);
  });

  it('Account Scoring benchmark (14729 chars) floor is ≤ 30', () => {
    // Benchmark produces ~32 KIs; floor of 12 gives 2.5x headroom
    const floor = computeMinKiFloor(14729, true);
    expect(floor).toBeLessThanOrEqual(30);
    expect(floor).toBeGreaterThanOrEqual(10);
  });
});
