/**
 * Phase 4C — Strategy Optimization Feature Flags
 *
 * Separate from the main featureFlags.ts to avoid polluting the
 * global flag namespace. All flags default to FALSE.
 *
 * Priority: env override > runtime override > localStorage > default
 */

const STORAGE_KEY = 'strategy-optimization-flags';

export interface StrategyOptFlags {
  parallel_authoring_enabled: boolean;
  partial_regen_enabled: boolean;
  synthesis_cache_enabled: boolean;
  library_cache_enabled: boolean;
  targeted_remediation_enabled: boolean;
}

const DEFAULTS: StrategyOptFlags = {
  parallel_authoring_enabled: false,
  partial_regen_enabled: false,
  synthesis_cache_enabled: false,
  library_cache_enabled: false,
  targeted_remediation_enabled: false,
};

// Runtime overrides (in-memory only, set via setStrategyFlag)
const runtimeOverrides: Partial<StrategyOptFlags> = {};

/**
 * Load flags with priority: env > runtime > localStorage > default
 */
export function loadStrategyFlags(): StrategyOptFlags {
  const flags = { ...DEFAULTS };

  // localStorage layer
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) Object.assign(flags, JSON.parse(stored));
  } catch {}

  // Runtime override layer
  Object.assign(flags, runtimeOverrides);

  // Env override layer (Vite env vars)
  try {
    const envMap: Record<string, keyof StrategyOptFlags> = {
      VITE_STRATEGY_PARALLEL_AUTHORING: 'parallel_authoring_enabled',
      VITE_STRATEGY_PARTIAL_REGEN: 'partial_regen_enabled',
      VITE_STRATEGY_SYNTHESIS_CACHE: 'synthesis_cache_enabled',
      VITE_STRATEGY_LIBRARY_CACHE: 'library_cache_enabled',
      VITE_STRATEGY_TARGETED_REMEDIATION: 'targeted_remediation_enabled',
    };
    for (const [envKey, flagKey] of Object.entries(envMap)) {
      const val = (import.meta as any).env?.[envKey];
      if (val === 'true') flags[flagKey] = true;
      if (val === 'false') flags[flagKey] = false;
    }
  } catch {}

  return flags;
}

/**
 * Set a flag at runtime (in-memory + localStorage).
 */
export function setStrategyFlag(key: keyof StrategyOptFlags, value: boolean): StrategyOptFlags {
  runtimeOverrides[key] = value;
  const flags = loadStrategyFlags();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    stored[key] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {}
  return flags;
}

/**
 * Check a single flag.
 */
export function isStrategyFlagEnabled(key: keyof StrategyOptFlags): boolean {
  return loadStrategyFlags()[key];
}

/**
 * Get active flags as an object for telemetry enrichment.
 */
export function getActiveExperimentFlags(): Record<string, boolean> {
  const flags = loadStrategyFlags();
  const active: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(flags)) {
    if (v) active[k] = true;
  }
  return active;
}

/**
 * Reset all flags to defaults.
 */
export function resetStrategyFlags(): void {
  Object.keys(runtimeOverrides).forEach(k => delete (runtimeOverrides as any)[k]);
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
