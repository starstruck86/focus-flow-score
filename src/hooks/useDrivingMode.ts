/**
 * useDrivingMode — Driving mode toggle for Dave Audio-First sessions.
 *
 * Modes:
 * - 'visual': Standard UI-driven mode
 * - 'audio-first': Audio-first with full Learn/Dojo flows
 * - 'driving': Compressed Learn, auto-chaining, extended silence tolerance
 *
 * Persists to localStorage.
 */

import { useState, useCallback } from 'react';

const STORAGE_KEY = 'dave-driving-mode';

export type DrivingMode = 'visual' | 'audio-first' | 'driving';

export interface DrivingModeConfig {
  /** Use compressed Learn mode */
  useCompressedLearn: boolean;
  /** Auto-chain Learn → Dojo */
  autoChainToDojo: boolean;
  /** Extended silence timeout for road noise (ms) */
  silenceTimeoutMs: number;
  /** Number of silence retries */
  silenceRetries: number;
  /** Barge-in listen window duration (ms) */
  bargeInWindowMs: number;
}

const MODE_CONFIGS: Record<DrivingMode, DrivingModeConfig> = {
  visual: {
    useCompressedLearn: false,
    autoChainToDojo: false,
    silenceTimeoutMs: 60_000,
    silenceRetries: 1,
    bargeInWindowMs: 1500,
  },
  'audio-first': {
    useCompressedLearn: false,
    autoChainToDojo: true,
    silenceTimeoutMs: 60_000,
    silenceRetries: 1,
    bargeInWindowMs: 1500,
  },
  driving: {
    useCompressedLearn: true,
    autoChainToDojo: true,
    silenceTimeoutMs: 75_000,
    silenceRetries: 2,
    bargeInWindowMs: 2000,
  },
};

export function getDrivingModeConfig(mode: DrivingMode): DrivingModeConfig {
  return MODE_CONFIGS[mode];
}

export function useDrivingMode() {
  const [mode, setModeState] = useState<DrivingMode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as DrivingMode | null;
      if (stored && stored in MODE_CONFIGS) return stored;
    } catch { /* noop */ }
    return 'audio-first';
  });

  const setMode = useCallback((m: DrivingMode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch { /* noop */ }
  }, []);

  const config = MODE_CONFIGS[mode];

  return { mode, setMode, config, isDriving: mode === 'driving' };
}
