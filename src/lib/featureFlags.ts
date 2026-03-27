/**
 * Feature Flags
 *
 * Central feature flag registry for staged rollouts.
 */

const FLAG_STORAGE_KEY = 'system-feature-flags';

export interface FeatureFlags {
  ENABLE_SYSTEM_OS: boolean;
  ENABLE_VOICE_OS: boolean;
}

const DEFAULTS: FeatureFlags = {
  ENABLE_SYSTEM_OS: true,
  ENABLE_VOICE_OS: true,
};

export function loadFeatureFlags(): FeatureFlags {
  try {
    const stored = localStorage.getItem(FLAG_STORAGE_KEY);
    if (stored) return { ...DEFAULTS, ...JSON.parse(stored) };
  } catch {}
  return { ...DEFAULTS };
}

export function setFeatureFlag(key: keyof FeatureFlags, value: boolean): FeatureFlags {
  const flags = loadFeatureFlags();
  flags[key] = value;
  try { localStorage.setItem(FLAG_STORAGE_KEY, JSON.stringify(flags)); } catch {}
  return flags;
}

export function isSystemOSEnabled(): boolean {
  return loadFeatureFlags().ENABLE_SYSTEM_OS;
}

export function isVoiceOSEnabled(): boolean {
  return loadFeatureFlags().ENABLE_VOICE_OS;
}
