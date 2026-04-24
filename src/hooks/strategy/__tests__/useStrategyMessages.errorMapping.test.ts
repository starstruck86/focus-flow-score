/**
 * Tests for mapSendErrorToFriendlyMessage — the pure helper that translates
 * raw network/provider errors thrown inside useStrategyMessages.sendMessage
 * into user-facing copy. Guarantees the literal "Failed to fetch" /
 * "TypeError" strings never surface to the toast layer.
 */
import { describe, it, expect } from 'vitest';
import { mapSendErrorToFriendlyMessage } from '../useStrategyMessages';

const NETWORK_COPY =
  "Connection hiccup — Strategy couldn't reach the AI provider. Check your network and try again.";
const PROVIDER_COPY =
  'The AI provider is having a moment. Please retry — usually clears in a few seconds.';
const FALLBACK_COPY = 'Something went wrong sending your message. Please try again.';

describe('mapSendErrorToFriendlyMessage', () => {
  it('maps "Failed to fetch" to network copy', () => {
    const out = mapSendErrorToFriendlyMessage(new Error('Failed to fetch'));
    expect(out).toBe(NETWORK_COPY);
    expect(out).not.toMatch(/failed to fetch/i);
  });

  it('maps Safari "Load failed" to network copy', () => {
    expect(mapSendErrorToFriendlyMessage(new Error('Load failed'))).toBe(NETWORK_COPY);
  });

  it('maps TypeError (any message) to network copy', () => {
    const err = new TypeError('NetworkError when attempting to fetch resource.');
    const out = mapSendErrorToFriendlyMessage(err);
    expect(out).toBe(NETWORK_COPY);
    expect(out).not.toMatch(/typeerror/i);
  });

  it('maps "Error 500" (our throw format) to provider copy', () => {
    expect(mapSendErrorToFriendlyMessage(new Error('Error 500'))).toBe(PROVIDER_COPY);
  });

  it('maps "Error 503" to provider copy', () => {
    expect(mapSendErrorToFriendlyMessage(new Error('Error 503'))).toBe(PROVIDER_COPY);
  });

  it('maps a bare "502 Bad Gateway" string to provider copy', () => {
    expect(mapSendErrorToFriendlyMessage(new Error('502 Bad Gateway'))).toBe(PROVIDER_COPY);
  });

  it('maps "Internal Server Error" wording to provider copy', () => {
    expect(mapSendErrorToFriendlyMessage(new Error('Internal Server Error'))).toBe(PROVIDER_COPY);
  });

  it('passes through a clean known-error message untouched', () => {
    const out = mapSendErrorToFriendlyMessage(new Error('Thread is locked for editing.'));
    expect(out).toBe('Thread is locked for editing.');
  });

  it('falls back to generic copy for empty/unknown errors', () => {
    expect(mapSendErrorToFriendlyMessage(new Error(''))).toBe(FALLBACK_COPY);
    expect(mapSendErrorToFriendlyMessage(null)).toBe(FALLBACK_COPY);
    expect(mapSendErrorToFriendlyMessage(undefined)).toBe(FALLBACK_COPY);
    expect(mapSendErrorToFriendlyMessage({})).toBe(FALLBACK_COPY);
  });

  it('never returns the raw "Failed to fetch" or "TypeError" strings', () => {
    const inputs: unknown[] = [
      new Error('Failed to fetch'),
      new TypeError('Failed to fetch'),
      new Error('fetch failed'),
      new Error('NetworkError'),
      { name: 'TypeError', message: 'Failed to fetch' },
    ];
    for (const i of inputs) {
      const out = mapSendErrorToFriendlyMessage(i);
      expect(out).not.toMatch(/failed to fetch/i);
      expect(out).not.toMatch(/^typeerror/i);
      expect(out).not.toMatch(/networkerror/i);
    }
  });
});
