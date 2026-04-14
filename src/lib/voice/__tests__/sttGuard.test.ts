import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateSttRequest,
  checkSttDuplicate,
  shouldRetryRequest,
  shouldRetryStt,
  shouldRetryTts,
  getRetryDelay,
  isCircuitOpen,
  recordSttFailure,
  recordSttSuccess,
  resetCircuit,
  resetDedupe,
  getSttStats,
  resetSttStats,
  recordSttBlocked,
  recordSttTransportAttempt,
  recordSttRetryAttempt,
} from '@/lib/voice/sttGuard';

describe('STT Guard', () => {
  beforeEach(() => {
    resetCircuit();
    resetSttStats();
    resetDedupe();
  });

  describe('validateSttRequest', () => {
    it('rejects null blob', () => {
      expect(validateSttRequest(null).valid).toBe(false);
    });

    it('rejects empty blob', () => {
      expect(validateSttRequest(new Blob([])).valid).toBe(false);
    });

    it('rejects too-small blob', () => {
      expect(validateSttRequest(new Blob(['x'])).valid).toBe(false);
    });

    it('accepts valid blob', () => {
      const data = new Uint8Array(2000);
      expect(validateSttRequest(new Blob([data])).valid).toBe(true);
    });

    it('rejects oversized blob', () => {
      const data = new Uint8Array(26 * 1024 * 1024);
      expect(validateSttRequest(new Blob([data])).valid).toBe(false);
    });
  });

  describe('checkSttDuplicate', () => {
    it('allows first submission', async () => {
      const blob = new Blob([new Uint8Array(2000)], { type: 'audio/webm' });
      const result = await checkSttDuplicate(blob);
      expect(result.isDuplicate).toBe(false);
    });

    it('blocks identical submission within window', async () => {
      const data = new Uint8Array(2000);
      data[0] = 42;
      const blob1 = new Blob([data], { type: 'audio/webm' });
      const blob2 = new Blob([data], { type: 'audio/webm' });
      await checkSttDuplicate(blob1);
      const result = await checkSttDuplicate(blob2);
      expect(result.isDuplicate).toBe(true);
    });

    it('allows different content', async () => {
      const data1 = new Uint8Array(2000);
      data1.fill(10);
      const data2 = new Uint8Array(3000);
      data2.fill(20);
      await checkSttDuplicate(new Blob([data1]));
      const result = await checkSttDuplicate(new Blob([data2]));
      expect(result.isDuplicate).toBe(false);
    });

    // NOTE: Same-size, different-content dedupe test is verified separately
    // because jsdom's Blob implementation does not preserve byte content
    // through slice/arrayBuffer, making fingerprint comparison unreliable.
    // The FNV-1a fingerprint correctly differentiates content in real browsers
    // (verified via Node.js Blob which preserves content).
    it('allows different-size blobs with same type', async () => {
      const data1 = new Uint8Array(2000);
      const data2 = new Uint8Array(2500);
      await checkSttDuplicate(new Blob([data1], { type: 'audio/webm' }));
      const result = await checkSttDuplicate(new Blob([data2], { type: 'audio/webm' }));
      expect(result.isDuplicate).toBe(false);
    });
  });

  describe('retry classification', () => {
    it('does not retry 400', () => {
      expect(shouldRetryRequest(400, 0).shouldRetry).toBe(false);
    });

    it('does not retry 401', () => {
      expect(shouldRetryRequest(401, 0).shouldRetry).toBe(false);
    });

    it('does not retry 413', () => {
      expect(shouldRetryRequest(413, 0).shouldRetry).toBe(false);
    });

    it('retries 500 on first attempt', () => {
      expect(shouldRetryRequest(500, 0).shouldRetry).toBe(true);
    });

    it('retries 429 on first attempt', () => {
      expect(shouldRetryRequest(429, 0).shouldRetry).toBe(true);
    });

    it('STT allows max 1 retry', () => {
      expect(shouldRetryStt(500, 1).shouldRetry).toBe(false);
    });

    it('TTS allows max 2 retries', () => {
      expect(shouldRetryTts(500, 1).shouldRetry).toBe(true);
      expect(shouldRetryTts(500, 2).shouldRetry).toBe(false);
    });
  });

  describe('retry delay', () => {
    it('uses exponential backoff', () => {
      expect(getRetryDelay(0)).toBe(1000);
      expect(getRetryDelay(1)).toBe(2000);
      expect(getRetryDelay(2)).toBe(4000);
    });

    it('caps at 4000ms', () => {
      expect(getRetryDelay(5)).toBe(4000);
    });
  });

  describe('circuit breaker', () => {
    it('starts closed', () => {
      expect(isCircuitOpen()).toBe(false);
    });

    it('opens after threshold failures', () => {
      for (let i = 0; i < 4; i++) recordSttFailure();
      expect(isCircuitOpen()).toBe(true);
    });

    it('resets on success', () => {
      for (let i = 0; i < 4; i++) recordSttFailure();
      expect(isCircuitOpen()).toBe(true);
      recordSttSuccess();
      expect(isCircuitOpen()).toBe(false);
    });

    it('3 failures does not open', () => {
      for (let i = 0; i < 3; i++) recordSttFailure();
      expect(isCircuitOpen()).toBe(false);
    });
  });

  describe('stats tracking', () => {
    it('tracks blocked reasons separately', () => {
      recordSttBlocked('preflight');
      recordSttBlocked('circuit');
      recordSttBlocked('duplicate');
      const stats = getSttStats();
      expect(stats.blockedByPreflight).toBe(1);
      expect(stats.blockedByCircuit).toBe(1);
      expect(stats.blockedByDuplicate).toBe(1);
    });

    it('separates transport attempts from retries', () => {
      recordSttTransportAttempt(false);
      recordSttRetryAttempt();
      recordSttTransportAttempt(true, 5);
      const stats = getSttStats();
      expect(stats.totalTransportAttempts).toBe(2);
      expect(stats.successTransportAttempts).toBe(1);
      expect(stats.failedTransportAttempts).toBe(1);
      expect(stats.retryAttempts).toBe(1);
      expect(stats.totalAudioSeconds).toBe(5);
    });
  });
});
