/**
 * Tests for the two real ingestion/extraction bugs:
 * Bug 1: Challenger podcast transcripts blocked as "no extraction" despite content
 * Bug 2: Pclub PDF placeholders treated as real content
 */
import { describe, it, expect } from 'vitest';
import { deriveCanonicalStage, deriveBlockedReason, isPlaceholderContent, BLOCKED_LABELS } from '../canonicalLifecycle';

// ── Bug 1: Challenger podcast transcript ────────────────────

describe('Bug 1 — Transcript with content blocked as no_extraction', () => {
  const challengerResource = {
    content_length: 27461,
    content: '## The Go-to-Market as a Team\n\n**Guest:** It\'s definitely a group effort...' + 'x'.repeat(27000),
    manual_content_present: false,
    enrichment_status: 'deep_enriched',
    tags: ['skill:discovery', 'context:enterprise'],
    manual_input_required: false,
    recovery_queue_bucket: null,
    failure_reason: null,
  };
  const noKIs = { total: 0, active: 0, activeWithContexts: 0 };

  it('should NOT classify as uploaded — content exists', () => {
    const stage = deriveCanonicalStage(challengerResource, noKIs);
    expect(stage).not.toBe('uploaded');
  });

  it('should derive blocked_reason as no_extraction (needs extraction)', () => {
    const blocked = deriveBlockedReason(challengerResource, noKIs);
    expect(blocked).toBe('no_extraction');
  });

  it('no_extraction label should be descriptive', () => {
    expect(BLOCKED_LABELS['no_extraction']).toContain('extraction not triggered');
  });

  it('should not be placeholder content', () => {
    expect(isPlaceholderContent(challengerResource.content)).toBe(false);
  });

  it('should reach tagged stage with tags present', () => {
    const stage = deriveCanonicalStage(challengerResource, noKIs);
    expect(stage).toBe('tagged');
  });

  it('should NOT be blocked as empty_content', () => {
    const blocked = deriveBlockedReason(challengerResource, noKIs);
    expect(blocked).not.toBe('empty_content');
  });
});

// ── Bug 2: Pclub PDF placeholder content ────────────────────

describe('Bug 2 — PDF placeholder content treated as real', () => {
  const pclubResource = {
    content_length: 51,
    content: '[Pending parse: exercise-_-add_or_remove_steps-pdf]',
    manual_content_present: false,
    enrichment_status: 'not_enriched',
    tags: [] as string[],
    manual_input_required: false,
    recovery_queue_bucket: null,
    failure_reason: null,
  };
  const noKIs = { total: 0, active: 0, activeWithContexts: 0 };

  it('should detect placeholder content', () => {
    expect(isPlaceholderContent(pclubResource.content)).toBe(true);
  });

  it('should classify stage as uploaded (not content_ready)', () => {
    const stage = deriveCanonicalStage(pclubResource, noKIs);
    expect(stage).toBe('uploaded');
  });

  it('should return placeholder_content as blocked reason', () => {
    const blocked = deriveBlockedReason(pclubResource, noKIs);
    expect(blocked).toBe('placeholder_content');
  });

  it('should NOT return empty_content', () => {
    const blocked = deriveBlockedReason(pclubResource, noKIs);
    expect(blocked).not.toBe('empty_content');
  });

  it('should NOT classify as content_ready', () => {
    const stage = deriveCanonicalStage(pclubResource, noKIs);
    expect(stage).not.toBe('content_ready');
  });
});

// ── isPlaceholderContent edge cases ─────────────────────────

describe('isPlaceholderContent', () => {
  it('detects [Pending parse: filename] pattern', () => {
    expect(isPlaceholderContent('[Pending parse: some-file-pdf]')).toBe(true);
  });

  it('detects [Pending parse] without filename', () => {
    expect(isPlaceholderContent('[Pending parse]')).toBe(true);
  });

  it('does NOT flag real content', () => {
    expect(isPlaceholderContent('## Introduction\n\nThis is real content about sales methodology.')).toBe(false);
  });

  it('treats null/empty as placeholder', () => {
    expect(isPlaceholderContent(null)).toBe(true);
    expect(isPlaceholderContent('')).toBe(true);
    expect(isPlaceholderContent('  ')).toBe(true);
  });

  it('does NOT flag content that mentions pending parse in context', () => {
    expect(isPlaceholderContent('The system shows [Pending parse: file] as a status indicator and other real text')).toBe(false);
  });
});

// ── Rule C: Enriched but 0 KIs must trigger extraction ──────

describe('Rule C — Enriched content with 0 KIs', () => {
  const enrichedResource = {
    content_length: 5000,
    content: 'Real content about sales strategies ' + 'x'.repeat(5000),
    manual_content_present: false,
    enrichment_status: 'enriched',
    tags: ['skill:negotiation'],
    manual_input_required: false,
    recovery_queue_bucket: null,
    failure_reason: null,
  };
  const noKIs = { total: 0, active: 0, activeWithContexts: 0 };

  it('should flag as no_extraction when enriched with 0 KIs', () => {
    const blocked = deriveBlockedReason(enrichedResource, noKIs);
    expect(blocked).toBe('no_extraction');
  });

  it('should also work for content_ready status', () => {
    const r = { ...enrichedResource, enrichment_status: 'content_ready' };
    // content_ready is not in ENRICHED_STATUSES so this won't be no_extraction
    // — it would need enrichment first. This is correct behavior.
    const blocked = deriveBlockedReason(r, noKIs);
    expect(blocked).toBe('none'); // content_ready without enrichment = not yet enriched
  });
});
