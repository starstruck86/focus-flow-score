import { describe, it, expect } from 'vitest';
import { routeFailure, getFailureBucketActions, type FailureBucket } from '@/lib/failureRouting';

describe('routeFailure', () => {
  it('Spotify episode routes to transcript_required, not generic failed', () => {
    const r = routeFailure(
      'https://open.spotify.com/episode/abc123',
      undefined,
      'failed_quality',
      'Content too weak to enrich',
    );
    // Spotify with quality failure → metadata_only_salvageable (metadata captured)
    expect(r.bucket).toBe('metadata_only_salvageable');
    expect(r.reason).toContain('Spotify');
    expect(r.reason).not.toContain('content too weak');

    const r2 = routeFailure(
      'https://open.spotify.com/episode/abc123',
      undefined,
      'failed_network_transport',
      'Network error',
    );
    expect(r2.bucket).toBe('transcript_required');
    expect(r2.reason).toContain('Spotify');
    expect(r2.reason).toContain('transcript');
  });

  it('Apple podcast routes to audio_resolution_required', () => {
    const r = routeFailure(
      'https://podcasts.apple.com/us/podcast/show/id123?i=456',
      undefined,
      'failed_quality',
      'No matching enclosure found',
    );
    expect(r.bucket).toBe('audio_resolution_required');
    expect(r.reason).toContain('Apple Podcast');
  });

  it('auth-gated page routes to manual_content_required', () => {
    const r = routeFailure(
      'https://community.circle.so/c/resources/some-post',
      undefined,
      'failed_needs_auth',
      'Login required',
    );
    expect(r.bucket).toBe('manual_content_required');
    expect(r.reason).toContain('Login required');
    expect(r.reason).toContain('Manual Assist');
  });

  it('Google Drive file routes to auth_required', () => {
    const r = routeFailure(
      'https://drive.google.com/file/d/abc123/view',
      undefined,
      'failed_needs_auth',
      'Access denied',
    );
    expect(r.bucket).toBe('auth_required');
    expect(r.reason).toContain('Google Drive');
  });

  it('weak content after correct extraction routes to retryable_extraction_failure', () => {
    const r = routeFailure(
      'https://example.com/article',
      undefined,
      'failed_quality',
      'Content too weak to enrich',
    );
    expect(r.bucket).toBe('retryable_extraction_failure');
    // Must not use generic message
    expect(r.reason).not.toBe('Content too weak to enrich');
    expect(r.reason).toContain('Extraction failed');
  });

  it('direct audio file with timeout routes to retryable', () => {
    const r = routeFailure(
      'https://cdn.example.com/episode.mp3',
      undefined,
      'failed_timeout',
      'Request timed out',
    );
    expect(r.bucket).toBe('retryable_extraction_failure');
    expect(r.retryable).toBe(true);
  });

  it('zoom recording routes to transcript_required', () => {
    const r = routeFailure(
      'https://zoom.us/rec/share/abc123',
      undefined,
      'failed_needs_auth',
      'Auth required',
    );
    expect(r.bucket).toBe('transcript_required');
    expect(r.reason).toContain('Zoom');
  });

  it('Google Doc with auth failure routes to auth_required', () => {
    const r = routeFailure(
      'https://docs.google.com/document/d/abc123/edit',
      undefined,
      'failed_needs_auth',
      'Access denied',
    );
    expect(r.bucket).toBe('auth_required');
  });

  it('Google Doc with network failure routes to retryable', () => {
    const r = routeFailure(
      'https://docs.google.com/document/d/abc123/edit',
      undefined,
      'failed_network_transport',
      'Failed to fetch',
    );
    expect(r.bucket).toBe('retryable_extraction_failure');
    expect(r.retryable).toBe(true);
  });

  it('every bucket has at least one row action', () => {
    const buckets: FailureBucket[] = [
      'retryable_extraction_failure',
      'audio_resolution_required',
      'transcript_required',
      'auth_required',
      'manual_content_required',
      'unsupported_source',
      'metadata_only_salvageable',
    ];
    for (const b of buckets) {
      const actions = getFailureBucketActions(b);
      expect(actions.length).toBeGreaterThan(0);
    }
  });

  it('failed resources always have a recovery path (nextAction)', () => {
    const testCases = [
      { url: 'https://open.spotify.com/episode/abc', cat: 'failed_quality' as const },
      { url: 'https://podcasts.apple.com/us/podcast/id123', cat: 'failed_timeout' as const },
      { url: 'https://drive.google.com/file/d/abc/view', cat: 'failed_needs_auth' as const },
      { url: 'https://community.circle.so/post', cat: 'failed_needs_auth' as const },
      { url: 'https://example.com/page', cat: 'failed_unknown' as const },
      { url: 'https://cdn.example.com/ep.mp3', cat: 'failed_timeout' as const },
    ];
    for (const tc of testCases) {
      const r = routeFailure(tc.url, undefined, tc.cat, 'some error');
      expect(r.nextAction).toBeTruthy();
      expect(r.reason).toBeTruthy();
      expect(r.bucket).toBeTruthy();
    }
  });
});
