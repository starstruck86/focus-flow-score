/**
 * Sales Brain — Audio Pipeline Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isAudioResource,
  detectAudioSubtype,
  getAudioStrategy,
  scoreTranscriptQuality,
  getAudioFailureDescription,
  createAudioJob,
  failAudioJob,
  completeAudioJob,
  getAudioJobForResource,
  loadAudioJobs,
  saveAudioJobs,
  getAudioPipelineHealth,
  reclassifyAudioFailures,
  retryRetryableAudioJobs,
  moveNonRetryableToManualAssist,
  getAudioStageLabel,
} from '../audioPipeline';

beforeEach(() => {
  localStorage.clear();
});

describe('Audio resource detection', () => {
  it('detects direct MP3 URLs', () => {
    expect(isAudioResource('https://example.com/file.mp3')).toBe(true);
    expect(isAudioResource('https://d3ctxlq1ktw2nl.cloudfront.net/staging/2024-11-11/something.mp3')).toBe(true);
  });

  it('detects Spotify episodes', () => {
    expect(isAudioResource('https://open.spotify.com/episode/abc123')).toBe(true);
  });

  it('detects Apple Podcasts', () => {
    expect(isAudioResource('https://podcasts.apple.com/us/podcast/some-show/id123?i=456')).toBe(true);
    expect(isAudioResource('https://podcasts.apple.com/gr/podcast/show/id1502265369')).toBe(true);
  });

  it('detects podcast CDN domains', () => {
    expect(isAudioResource('https://d3ctxlq1ktw2nl.cloudfront.net/staging/foo')).toBe(true);
  });

  it('does not detect regular web articles', () => {
    expect(isAudioResource('https://example.com/blog/post')).toBe(false);
  });

  it('detects by resource type', () => {
    expect(isAudioResource('https://example.com/page', 'podcast_episode')).toBe(true);
  });
});

describe('Audio subtype detection', () => {
  it('classifies direct audio files', () => {
    expect(detectAudioSubtype('https://example.com/file.mp3')).toBe('direct_audio_file');
    expect(detectAudioSubtype('https://d3ctxlq1ktw2nl.cloudfront.net/staging/2024/file.mp3')).toBe('direct_audio_file');
  });

  it('classifies Spotify episodes vs shows', () => {
    expect(detectAudioSubtype('https://open.spotify.com/episode/abc')).toBe('spotify_episode');
    expect(detectAudioSubtype('https://open.spotify.com/show/abc')).toBe('spotify_show');
  });

  it('classifies Apple Podcast episodes vs shows', () => {
    expect(detectAudioSubtype('https://podcasts.apple.com/us/podcast/show/id123?i=456')).toBe('apple_podcast_episode');
    expect(detectAudioSubtype('https://podcasts.apple.com/us/podcast/show/id123')).toBe('apple_podcast_show');
  });

  it('classifies YouTube', () => {
    expect(detectAudioSubtype('https://youtube.com/watch?v=abc')).toBe('youtube_audio_or_video');
  });

  it('classifies CDN-hosted audio as direct', () => {
    expect(detectAudioSubtype('https://d3ctxlq1ktw2nl.cloudfront.net/staging/data')).toBe('direct_audio_file');
  });

  it('classifies unsupported', () => {
    expect(detectAudioSubtype(null)).toBe('unsupported_audio');
  });
});

describe('Audio strategy', () => {
  it('direct audio has automatic retry', () => {
    const s = getAudioStrategy('direct_audio_file');
    expect(s.retryMode).toBe('automatic');
    expect(s.manualAssistRequired).toBe(false);
  });

  it('Spotify episode is manual-only retry with metadata acceptable', () => {
    const s = getAudioStrategy('spotify_episode');
    expect(s.retryMode).toBe('manual_only');
    expect(s.metadataOnlyAcceptable).toBe(true);
    expect(s.manualAssistRequired).toBe(true);
  });

  it('Spotify show is manual-only', () => {
    const s = getAudioStrategy('spotify_show');
    expect(s.retryMode).toBe('manual_only');
  });

  it('Apple podcast episode is automatic', () => {
    const s = getAudioStrategy('apple_podcast_episode');
    expect(s.retryMode).toBe('automatic');
    expect(s.metadataOnlyAcceptable).toBe(true);
  });

  it('Apple podcast show is manual-only', () => {
    const s = getAudioStrategy('apple_podcast_show');
    expect(s.retryMode).toBe('manual_only');
  });

  it('auth-gated is blocked', () => {
    const s = getAudioStrategy('auth_gated_audio');
    expect(s.retryMode).toBe('blocked');
  });

  it('podcast_episode_page_only is automatic', () => {
    const s = getAudioStrategy('podcast_episode_page_only');
    expect(s.retryMode).toBe('automatic');
  });
});

describe('Transcript quality scoring', () => {
  it('fails empty transcript', () => {
    const r = scoreTranscriptQuality('');
    expect(r.quality).toBe('failed');
  });

  it('fails very short transcript', () => {
    const r = scoreTranscriptQuality('hello world');
    expect(r.quality).toBe('failed');
    expect(r.totalWords).toBe(2);
  });

  it('marks shallow for short content', () => {
    const words = Array(150).fill('sales').join(' ');
    const r = scoreTranscriptQuality(words);
    expect(r.quality).toBe('shallow');
  });

  it('marks usable for decent content', () => {
    const content = Array(300).fill('deal pipeline close objection discovery').join(' ');
    const r = scoreTranscriptQuality(content);
    expect(['usable', 'high_quality']).toContain(r.quality);
  });

  it('detects high repeated lines', () => {
    const lines = Array(100).fill('same line here').join('\n');
    const r = scoreTranscriptQuality(lines);
    expect(['failed', 'shallow']).toContain(r.quality);
  });
});

describe('Failure descriptions', () => {
  it('AUDIO_UNREACHABLE is retryable', () => {
    const d = getAudioFailureDescription('AUDIO_UNREACHABLE');
    expect(d.retryable).toBe(true);
  });

  it('AUTH_REQUIRED is not retryable', () => {
    const d = getAudioFailureDescription('AUTH_REQUIRED');
    expect(d.retryable).toBe(false);
  });

  it('SPOTIFY_NO_DIRECT_AUDIO is not retryable', () => {
    const d = getAudioFailureDescription('SPOTIFY_NO_DIRECT_AUDIO');
    expect(d.retryable).toBe(false);
    expect(d.explanation).toContain('Spotify');
  });

  it('APPLE_ENCLOSURE_NOT_FOUND is retryable', () => {
    const d = getAudioFailureDescription('APPLE_ENCLOSURE_NOT_FOUND');
    expect(d.retryable).toBe(true);
  });

  it('APPLE_FEED_NOT_RESOLVED is retryable', () => {
    const d = getAudioFailureDescription('APPLE_FEED_NOT_RESOLVED');
    expect(d.retryable).toBe(true);
  });

  it('all codes have descriptions', () => {
    const codes = [
      'AUDIO_UNREACHABLE', 'INVALID_CONTENT_TYPE', 'TRANSCRIPT_TOO_SHORT', 'AUTH_REQUIRED',
      'MANUAL_TRANSCRIPT_REQUIRED', 'SPOTIFY_NO_DIRECT_AUDIO', 'SPOTIFY_METADATA_ONLY',
      'APPLE_PAGE_PARSED_NO_FEED', 'APPLE_FEED_NOT_RESOLVED', 'APPLE_ENCLOSURE_NOT_FOUND',
      'TRANSCRIPT_SOURCE_NOT_FOUND', 'CANONICAL_PAGE_NOT_FOUND', 'METADATA_CAPTURED_NO_TRANSCRIPT',
      'PLATFORM_RATE_LIMITED', 'PLATFORM_BLOCKED', 'MANUAL_ASSIST_RECOMMENDED',
    ] as const;
    for (const c of codes) {
      const d = getAudioFailureDescription(c);
      expect(d.explanation.length).toBeGreaterThan(0);
      expect(d.nextAction.length).toBeGreaterThan(0);
    }
  });
});

describe('Stage labels', () => {
  it('all pipeline stages have labels', () => {
    const stages = [
      'queued', 'detecting_source_type', 'resolving_platform_metadata',
      'resolving_canonical_episode_page', 'resolving_rss_feed', 'resolving_audio_enclosure',
      'searching_transcript_source', 'resolving_source', 'downloading_audio', 'transcribing',
      'assembling_transcript', 'quality_check', 'enriching', 'completed', 'failed',
      'needs_manual_assist', 'metadata_only_complete',
    ] as const;
    for (const s of stages) {
      expect(getAudioStageLabel(s).length).toBeGreaterThan(0);
    }
  });
});

describe('Audio job lifecycle', () => {
  it('creates and retrieves audio job', () => {
    const job = createAudioJob('res-1', 'https://example.com/file.mp3');
    expect(job.audioSubtype).toBe('direct_audio_file');
    expect(job.stage).toBe('queued');
    expect(getAudioJobForResource('res-1')).toBeTruthy();
  });

  it('creates job for Spotify episode', () => {
    const job = createAudioJob('res-s1', 'https://open.spotify.com/episode/abc123');
    expect(job.audioSubtype).toBe('spotify_episode');
  });

  it('creates job for Apple podcast episode', () => {
    const job = createAudioJob('res-a1', 'https://podcasts.apple.com/us/podcast/show/id123?i=456');
    expect(job.audioSubtype).toBe('apple_podcast_episode');
  });

  it('fails audio job with correct state', () => {
    createAudioJob('res-2', 'https://example.com/file.mp3');
    const failed = failAudioJob('res-2', 'AUDIO_UNREACHABLE', 'downloading_audio');
    expect(failed?.stage).toBe('failed');
    expect(failed?.retryable).toBe(true);
    expect(failed?.failureCode).toBe('AUDIO_UNREACHABLE');
  });

  it('auth-required goes to needs_manual_assist', () => {
    createAudioJob('res-3', 'https://example.com/file.mp3');
    const failed = failAudioJob('res-3', 'AUTH_REQUIRED', 'resolving_source');
    expect(failed?.stage).toBe('needs_manual_assist');
    expect(failed?.retryable).toBe(false);
  });

  it('spotify failure goes to needs_manual_assist', () => {
    createAudioJob('res-sp', 'https://open.spotify.com/episode/abc');
    const failed = failAudioJob('res-sp', 'SPOTIFY_NO_DIRECT_AUDIO', 'resolving_platform_metadata');
    expect(failed?.stage).toBe('needs_manual_assist');
    expect(failed?.retryable).toBe(false);
  });

  it('completes with quality result', () => {
    createAudioJob('res-4', 'https://example.com/file.mp3');
    const q = scoreTranscriptQuality(Array(500).fill('deal pipeline objection prospect').join(' '));
    const completed = completeAudioJob('res-4', q);
    expect(completed?.stage).toBe('completed');
    expect(completed?.hasTranscript).toBe(true);
  });
});

describe('Audio pipeline health', () => {
  it('computes stats correctly', () => {
    createAudioJob('a1', 'https://example.com/1.mp3');
    createAudioJob('a2', 'https://example.com/2.mp3');
    failAudioJob('a2', 'AUDIO_UNREACHABLE', 'downloading_audio');

    const health = getAudioPipelineHealth();
    expect(health.totalAudio).toBe(2);
    expect(health.queued).toBe(1);
    expect(health.failed).toBe(1);
    expect(health.retryableCount).toBe(2);
  });
});

describe('Recovery tools', () => {
  it('retryRetryableAudioJobs resets retryable failures to queued', () => {
    createAudioJob('r1', 'https://example.com/1.mp3');
    failAudioJob('r1', 'AUDIO_UNREACHABLE', 'downloading_audio');
    const count = retryRetryableAudioJobs();
    expect(count).toBe(1);
    const job = getAudioJobForResource('r1');
    expect(job?.stage).toBe('queued');
  });

  it('moveNonRetryableToManualAssist moves blocked failures', () => {
    createAudioJob('r2', 'https://example.com/1.mp3');
    failAudioJob('r2', 'AUTH_REQUIRED', 'resolving_source');
    const jobs = loadAudioJobs();
    const j = jobs.find(x => x.resourceId === 'r2');
    if (j) { j.stage = 'failed'; j.retryable = false; }
    saveAudioJobs(jobs);

    const count = moveNonRetryableToManualAssist();
    expect(count).toBe(1);
    expect(getAudioJobForResource('r2')?.stage).toBe('needs_manual_assist');
  });

  it('corrupted storage loads safely', () => {
    localStorage.setItem('sales-brain-audio-jobs', 'corrupted{{{');
    expect(loadAudioJobs()).toEqual([]);
  });
});
