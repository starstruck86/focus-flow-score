/**
 * Voice Debug Metrics — Aggregates all voice cost & performance data
 * for the debug/inspection panel.
 *
 * Read-only, never blocks runtime. All data is pulled from other modules.
 * All credit values are labeled as estimates (~).
 */

import { getCacheStats, type CacheStats } from './ttsCache';
import { getSttStats } from './sttGuard';
import { getUsageSummary, type UsageSummary } from './voiceUsageTracker';
import { getVoiceMode, getActiveModel, type VoiceMode, type ModelSelection } from './voiceCostController';

export interface VoiceDebugSnapshot {
  timestamp: number;
  voiceMode: VoiceMode;
  activeModel: ModelSelection;
  cache: CacheStats;
  stt: ReturnType<typeof getSttStats>;
  usage: UsageSummary | null;
}

export function captureDebugSnapshot(): VoiceDebugSnapshot {
  return {
    timestamp: Date.now(),
    voiceMode: getVoiceMode(),
    activeModel: getActiveModel(),
    cache: getCacheStats(),
    stt: getSttStats(),
    usage: getUsageSummary(),
  };
}

/**
 * Format snapshot for display in debug panel.
 * Credit values are labeled with "~" to indicate estimates.
 */
export function formatDebugSnapshot(snap: VoiceDebugSnapshot): Record<string, string | number> {
  const out: Record<string, string | number> = {
    'Voice Mode': snap.voiceMode,
    'TTS Model': snap.activeModel.label,
    'Memory Cache Hits': snap.cache.memoryHits,
    'Persistent Cache Hits': snap.cache.persistentHits,
    'Cache Misses': snap.cache.misses,
    'Memory Cache Entries': snap.cache.memoryEntries,
    'STT Total Calls': snap.stt.totalCalls,
    'STT Success': snap.stt.successCalls,
    'STT Failed': snap.stt.failedCalls,
    'STT Blocked (preflight)': snap.stt.blockedByPreflight,
    'STT Blocked (circuit)': snap.stt.blockedByCircuit,
    'STT Blocked (duplicate)': snap.stt.blockedByDuplicate,
    'STT Retries': snap.stt.retriedCalls,
  };

  if (snap.usage) {
    out['Session Duration (s)'] = Math.round(snap.usage.sessionDurationMs / 1000);
    out['TTS Calls (non-cached)'] = snap.usage.ttsCalls;
    out['TTS Characters'] = snap.usage.ttsCharacters;
    out['Cache Hit Rate'] = `${(snap.usage.cacheHitRate * 100).toFixed(0)}%` as unknown as number;
    out['STT Audio Seconds'] = Math.round(snap.usage.sttAudioSeconds);
    out['~Est. Credits (approx)'] = snap.usage.estimatedCreditsApprox;
    out['Usage Level'] = snap.usage.usageLevel;
  }

  return out;
}
