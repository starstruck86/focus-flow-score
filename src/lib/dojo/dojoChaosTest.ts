/**
 * Dojo Chaos Testing Framework
 *
 * Injects controlled failures into the Dojo audio pipeline
 * to validate self-healing behavior. Toggle-able via debug panel.
 *
 * NOT active in production by default — must be explicitly enabled.
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('DojoChaos');

// ── Chaos Configuration ───────────────────────────────────────────

export interface ChaosConfig {
  enabled: boolean;
  /** Probability (0-1) that a fetch will timeout */
  fetchTimeoutRate: number;
  /** Probability that a blob will be truncated/corrupt */
  corruptBlobRate: number;
  /** Probability that 'playing' event never fires */
  missingPlayingEventRate: number;
  /** Probability that 'ended' event is delayed by 10s+ */
  delayedEndedRate: number;
  /** Probability of duplicate callback */
  duplicateCallbackRate: number;
  /** Simulate tab visibility change after N chunks */
  tabSwitchAfterChunks: number | null;
  /** Simulate ownership conflict */
  ownershipConflict: boolean;
  /** Delay all fetches by this many ms */
  fetchDelayMs: number;
}

const DEFAULT_CHAOS: ChaosConfig = {
  enabled: false,
  fetchTimeoutRate: 0,
  corruptBlobRate: 0,
  missingPlayingEventRate: 0,
  delayedEndedRate: 0,
  duplicateCallbackRate: 0,
  tabSwitchAfterChunks: null,
  ownershipConflict: false,
  fetchDelayMs: 0,
};

// ── Storage key ───────────────────────────────────────────────────

const CHAOS_KEY = 'dojo_chaos_config';

export function loadChaosConfig(): ChaosConfig {
  try {
    const raw = localStorage.getItem(CHAOS_KEY);
    if (!raw) return DEFAULT_CHAOS;
    return { ...DEFAULT_CHAOS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CHAOS;
  }
}

export function saveChaosConfig(config: ChaosConfig): void {
  try {
    localStorage.setItem(CHAOS_KEY, JSON.stringify(config));
  } catch {
    // Storage full — ignore
  }
}

export function resetChaosConfig(): void {
  try {
    localStorage.removeItem(CHAOS_KEY);
  } catch {
    // ignore
  }
}

// ── Chaos Injection Points ────────────────────────────────────────

/** Should this fetch be made to timeout? */
export function shouldInjectFetchTimeout(config: ChaosConfig): boolean {
  if (!config.enabled) return false;
  const hit = Math.random() < config.fetchTimeoutRate;
  if (hit) log.warn('chaos: injecting fetch timeout');
  return hit;
}

/** Should the blob be corrupted? */
export function shouldInjectCorruptBlob(config: ChaosConfig): boolean {
  if (!config.enabled) return false;
  const hit = Math.random() < config.corruptBlobRate;
  if (hit) log.warn('chaos: injecting corrupt blob');
  return hit;
}

/** Should the 'playing' event be suppressed? */
export function shouldSuppressPlayingEvent(config: ChaosConfig): boolean {
  if (!config.enabled) return false;
  const hit = Math.random() < config.missingPlayingEventRate;
  if (hit) log.warn('chaos: suppressing playing event');
  return hit;
}

/** Should the 'ended' event be delayed? */
export function shouldDelayEnded(config: ChaosConfig): boolean {
  if (!config.enabled) return false;
  const hit = Math.random() < config.delayedEndedRate;
  if (hit) log.warn('chaos: delaying ended event');
  return hit;
}

/** Should a duplicate callback be injected? */
export function shouldInjectDuplicate(config: ChaosConfig): boolean {
  if (!config.enabled) return false;
  const hit = Math.random() < config.duplicateCallbackRate;
  if (hit) log.warn('chaos: injecting duplicate callback');
  return hit;
}

/** Get injected fetch delay */
export function getInjectedFetchDelay(config: ChaosConfig): number {
  if (!config.enabled) return 0;
  return config.fetchDelayMs;
}

// ── Preset Scenarios ──────────────────────────────────────────────

export const CHAOS_PRESETS = {
  /** Light stress — occasional timeouts */
  light: (): ChaosConfig => ({
    ...DEFAULT_CHAOS,
    enabled: true,
    fetchTimeoutRate: 0.1,
    fetchDelayMs: 2000,
  }),

  /** Medium stress — mixed failures */
  medium: (): ChaosConfig => ({
    ...DEFAULT_CHAOS,
    enabled: true,
    fetchTimeoutRate: 0.2,
    corruptBlobRate: 0.1,
    missingPlayingEventRate: 0.1,
    fetchDelayMs: 3000,
  }),

  /** Heavy stress — many failure types */
  heavy: (): ChaosConfig => ({
    ...DEFAULT_CHAOS,
    enabled: true,
    fetchTimeoutRate: 0.3,
    corruptBlobRate: 0.2,
    missingPlayingEventRate: 0.2,
    delayedEndedRate: 0.15,
    duplicateCallbackRate: 0.1,
    fetchDelayMs: 5000,
  }),

  /** Specific: autoplay simulation */
  autoplayBlock: (): ChaosConfig => ({
    ...DEFAULT_CHAOS,
    enabled: true,
    missingPlayingEventRate: 1.0,
  }),

  /** Specific: network hell */
  networkHell: (): ChaosConfig => ({
    ...DEFAULT_CHAOS,
    enabled: true,
    fetchTimeoutRate: 0.5,
    fetchDelayMs: 10000,
  }),

  /** Specific: ownership conflict */
  ownershipFight: (): ChaosConfig => ({
    ...DEFAULT_CHAOS,
    enabled: true,
    ownershipConflict: true,
  }),

  /** Off */
  off: (): ChaosConfig => DEFAULT_CHAOS,
} as const;

export type ChaosPreset = keyof typeof CHAOS_PRESETS;
