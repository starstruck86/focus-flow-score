/**
 * Tests for the two real ingestion/extraction bugs + post-ingest validation.
 * Uses actual DB resource shapes as acceptance criteria.
 */
import { describe, it, expect } from 'vitest';
import { deriveCanonicalStage, deriveBlockedReason, isPlaceholderContent, BLOCKED_LABELS } from '../canonicalLifecycle';
import { validateResource } from '../postIngestValidation';

// ── Bug 1: Challenger podcast transcript ────────────────────

describe('Bug 1 — Challenger transcript (#106)', () => {
  // Real DB shape
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
    expect(deriveCanonicalStage(challengerResource, noKIs)).not.toBe('uploaded');
  });

  it('should derive blocked_reason as no_extraction', () => {
    expect(deriveBlockedReason(challengerResource, noKIs)).toBe('no_extraction');
  });

  it('no_extraction label mentions extraction not yet run', () => {
    expect(BLOCKED_LABELS['no_extraction']).toContain('extraction not yet run');
  });

  it('should not be placeholder content', () => {
    expect(isPlaceholderContent(challengerResource.content)).toBe(false);
  });

  it('should reach tagged stage', () => {
    expect(deriveCanonicalStage(challengerResource, noKIs)).toBe('tagged');
  });

  it('post-ingest validation catches transcript_extraction_not_triggered', () => {
    const violations = validateResource({
      id: '6e8ea277-558e-46dc-bd09-13dc052f1bb3',
      title: '#106: Accelerating Pipeline with a Unified ABM Strategy',
      resource_type: 'transcript',
      content: challengerResource.content,
      content_length: 27461,
      enrichment_status: 'deep_enriched',
      file_url: 'https://api.spreaker.com/download/episode/58549987/ep106_audio_v1_8528_kristina_jaramillo.mp3',
      current_resource_ki_count: 0,
      extraction_attempt_count: 0,
      host_platform: 'spreaker',
    });
    expect(violations.some(v => v.failure_class === 'transcript_extraction_not_triggered')).toBe(true);
    expect(violations[0].auto_repairable).toBe(true);
    expect(violations[0].repair_action).toBe('queue_extraction');
  });
});

// ── Bug 2: Pclub PDF placeholder content ────────────────────

describe('Bug 2 — Pclub PDF placeholder (exercise_-_add_or_remove_steps)', () => {
  const pclubResource = {
    content_length: 51,
    content: '[Pending parse: exercise_-_add_or_remove_steps-pdf]',
    manual_content_present: false,
    enrichment_status: 'quarantined',
    tags: [] as string[],
    manual_input_required: false,
    recovery_queue_bucket: null,
    failure_reason: 'Score 44 after 2 attempts — auto-fix exhausted',
  };
  const noKIs = { total: 0, active: 0, activeWithContexts: 0 };

  it('should detect placeholder content', () => {
    expect(isPlaceholderContent(pclubResource.content)).toBe(true);
  });

  it('should classify stage as uploaded', () => {
    expect(deriveCanonicalStage(pclubResource, noKIs)).toBe('uploaded');
  });

  it('should return auth_capture_incomplete as blocked reason (no file_url)', () => {
    expect(deriveBlockedReason(pclubResource, noKIs)).toBe('auth_capture_incomplete');
  });

  it('should return placeholder_content when file_url exists', () => {
    expect(deriveBlockedReason({ ...pclubResource, file_url: 'https://example.com/file.pdf' }, noKIs)).toBe('placeholder_content');
  });

  it('post-ingest validation: with file_url → pdf_parse_incomplete', () => {
    const violations = validateResource({
      id: '92dda2c5-d71c-4d7a-ab6b-261c6c173031',
      title: 'exercise_-_add_or_remove_steps-pdf',
      resource_type: 'document',
      content: '[Pending parse: exercise_-_add_or_remove_steps-pdf]',
      content_length: 51,
      enrichment_status: 'quarantined',
      file_url: '9f11e308-4028-4527-b7ba-5ea365dc1441/lesson-assets/627eadf1-8ef7-4ecd-8a69-112fcb638b61/exercise_-_add_or_remove_steps-pdf.pdf',
      current_resource_ki_count: 0,
      extraction_attempt_count: 0,
    });
    expect(violations.some(v => v.failure_class === 'pdf_parse_incomplete')).toBe(true);
    expect(violations[0].auto_repairable).toBe(true);
    expect(violations[0].repair_action).toBe('retry_parse');
  });

  it('post-ingest validation: without file_url → auth_capture_incomplete', () => {
    const violations = validateResource({
      id: '92dda2c5-d71c-4d7a-ab6b-261c6c173031',
      title: 'exercise_-_add_or_remove_steps-pdf',
      resource_type: 'document',
      content: '[Pending parse: exercise_-_add_or_remove_steps-pdf]',
      content_length: 51,
      enrichment_status: 'quarantined',
      file_url: null,
      current_resource_ki_count: 0,
      extraction_attempt_count: 0,
    });
    expect(violations.some(v => v.failure_class === 'auth_capture_incomplete')).toBe(true);
    expect(violations[0].auto_repairable).toBe(false);
    expect(violations[0].repair_action).toBe('re_import_with_auth');
  });
});

// ── isPlaceholderContent edge cases ─────────────────────────

describe('isPlaceholderContent', () => {
  it('detects [Pending parse: filename]', () => {
    expect(isPlaceholderContent('[Pending parse: some-file-pdf]')).toBe(true);
  });

  it('detects [Pending parse]', () => {
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

  it('does NOT flag inline mention', () => {
    expect(isPlaceholderContent('The system shows [Pending parse: file] and other text')).toBe(false);
  });
});

// ── Rule C: Enriched but 0 KIs ──────────────────────────────

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
    expect(deriveBlockedReason(enrichedResource, noKIs)).toBe('no_extraction');
  });

  it('post-ingest validation catches enriched_no_extraction', () => {
    const violations = validateResource({
      id: 'test-enriched',
      title: 'Test Enriched Resource',
      resource_type: 'document',
      content: enrichedResource.content,
      content_length: 5000,
      enrichment_status: 'enriched',
      current_resource_ki_count: 0,
      extraction_attempt_count: 0,
    });
    expect(violations.some(v => v.failure_class === 'enriched_no_extraction')).toBe(true);
  });
});
