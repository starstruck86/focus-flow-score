/**
 * Feature Flags
 *
 * Central feature flag registry for staged rollouts.
 */

const FLAG_STORAGE_KEY = 'system-feature-flags';

export interface FeatureFlags {
  ENABLE_SYSTEM_OS: boolean;
  ENABLE_VOICE_OS: boolean;
  ENABLE_CAPABILITY_AWARENESS: boolean;
  ENABLE_LOOP_NATIVE_SCHEDULER: boolean;
  ENABLE_ROLEPLAY_GROUNDING: boolean;
  ENABLE_ACCOUNT_EXECUTION_MODEL: boolean;
  ENABLE_ACCOUNT_CENTRIC_EXECUTION: boolean;
  ENABLE_EXECUTION_SESSION_LAYER: boolean;
  ENABLE_STRICT_EXECUTION_MODE: boolean;
  ENABLE_SESSION_AUTOPILOT: boolean;
  ENABLE_EXECUTION_MOMENTUM: boolean;
  ENABLE_SALES_BRAIN: boolean;
  ENFORCE_ALLOWLIST: boolean;
}

const DEFAULTS: FeatureFlags = {
  ENABLE_SYSTEM_OS: false,
  ENABLE_VOICE_OS: false,
  ENABLE_CAPABILITY_AWARENESS: false,
  ENABLE_LOOP_NATIVE_SCHEDULER: false,
  ENABLE_ROLEPLAY_GROUNDING: false,
  ENABLE_ACCOUNT_EXECUTION_MODEL: false,
  ENABLE_ACCOUNT_CENTRIC_EXECUTION: false,
  ENABLE_EXECUTION_SESSION_LAYER: false,
  ENABLE_STRICT_EXECUTION_MODE: false,
  ENABLE_SESSION_AUTOPILOT: false,
  ENABLE_EXECUTION_MOMENTUM: false,
  ENABLE_SALES_BRAIN: false,
  ENFORCE_ALLOWLIST: true,
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

export function isCapabilityAwarenessEnabled(): boolean {
  return loadFeatureFlags().ENABLE_CAPABILITY_AWARENESS;
}

export function isLoopNativeSchedulerEnabled(): boolean {
  return loadFeatureFlags().ENABLE_LOOP_NATIVE_SCHEDULER;
}

export function isRoleplayGroundingEnabled(): boolean {
  return loadFeatureFlags().ENABLE_ROLEPLAY_GROUNDING;
}

export function isAccountExecutionModelEnabled(): boolean {
  return loadFeatureFlags().ENABLE_ACCOUNT_EXECUTION_MODEL;
}

export function isAccountCentricExecutionEnabled(): boolean {
  return loadFeatureFlags().ENABLE_ACCOUNT_CENTRIC_EXECUTION;
}

export function isExecutionSessionLayerEnabled(): boolean {
  return loadFeatureFlags().ENABLE_EXECUTION_SESSION_LAYER;
}

export function isStrictExecutionModeEnabled(): boolean {
  return loadFeatureFlags().ENABLE_STRICT_EXECUTION_MODE;
}

export function isSessionAutopilotEnabled(): boolean {
  return loadFeatureFlags().ENABLE_SESSION_AUTOPILOT;
}

export function isExecutionMomentumEnabled(): boolean {
  return loadFeatureFlags().ENABLE_EXECUTION_MOMENTUM;
}

export function isSalesBrainEnabled(): boolean {
  return loadFeatureFlags().ENABLE_SALES_BRAIN;
}
