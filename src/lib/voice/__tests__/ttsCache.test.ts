import { describe, it, expect, beforeEach } from 'vitest';
import {
  ttsCacheKey,
  lookupMemoryCache,
  setMemoryCache,
  clearMemoryCache,
  storeInCache,
  recordCacheHit,
  getCacheStats,
  resetCacheStats,
  type TtsCacheKeyInputs,
} from '@/lib/voice/ttsCache';

describe('TTS Cache', () => {
  beforeEach(() => {
    clearMemoryCache();
    resetCacheStats();
  });

  describe('ttsCacheKey', () => {
    it('produces different keys for different text', () => {
      const k1 = ttsCacheKey({ text: 'hello', voiceId: 'v1' });
      const k2 = ttsCacheKey({ text: 'world', voiceId: 'v1' });
      expect(k1).not.toBe(k2);
    });

    it('produces different keys for different voiceId', () => {
      const k1 = ttsCacheKey({ text: 'hello', voiceId: 'v1' });
      const k2 = ttsCacheKey({ text: 'hello', voiceId: 'v2' });
      expect(k1).not.toBe(k2);
    });

    it('produces different keys for different modelId', () => {
      const k1 = ttsCacheKey({ text: 'hello', voiceId: 'v1', modelId: 'turbo' });
      const k2 = ttsCacheKey({ text: 'hello', voiceId: 'v1', modelId: 'premium' });
      expect(k1).not.toBe(k2);
    });

    it('produces different keys for different speed', () => {
      const k1 = ttsCacheKey({ text: 'hello', voiceId: 'v1', speed: 1.0 });
      const k2 = ttsCacheKey({ text: 'hello', voiceId: 'v1', speed: 1.2 });
      expect(k1).not.toBe(k2);
    });

    it('is deterministic for identical inputs', () => {
      const inputs: TtsCacheKeyInputs = { text: 'test', voiceId: 'v1', modelId: 'm1' };
      expect(ttsCacheKey(inputs)).toBe(ttsCacheKey(inputs));
    });
  });

  describe('memory cache', () => {
    it('returns null for missing keys', () => {
      const result = lookupMemoryCache('nonexistent');
      expect(result.blob).toBeNull();
      expect(result.source).toBe('miss');
    });

    it('returns blob for stored keys', () => {
      const blob = new Blob(['audio'], { type: 'audio/mpeg' });
      setMemoryCache('key1', blob);
      const result = lookupMemoryCache('key1');
      expect(result.blob).toBe(blob);
      expect(result.source).toBe('memory');
    });

    it('evicts oldest entry when at capacity', () => {
      for (let i = 0; i < 51; i++) {
        setMemoryCache(`key${i}`, new Blob([`audio${i}`]));
      }
      // First entry should be evicted
      expect(lookupMemoryCache('key0').blob).toBeNull();
      // Last entry should exist
      expect(lookupMemoryCache('key50').blob).not.toBeNull();
    });
  });

  describe('stats', () => {
    it('tracks hits and misses correctly', () => {
      recordCacheHit('memory');
      recordCacheHit('memory');
      recordCacheHit('persistent');
      recordCacheHit('miss');
      const stats = getCacheStats();
      expect(stats.memoryHits).toBe(2);
      expect(stats.persistentHits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });
});
